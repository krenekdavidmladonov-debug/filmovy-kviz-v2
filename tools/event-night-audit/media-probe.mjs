/* global document, window */

import { readFile, writeFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { assertAuditEnvironment, auditPaths } from './config.mjs';

const statuses = ['PLAYABLE', 'PLAYABLE_AFTER_ACTIVATION', 'EMBED_DENIED', 'UNAVAILABLE', 'TIMEOUT', 'INVALID_SOURCE', 'UNVERIFIED'];

async function loadYouTubeApi(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(true);
      return;
    }
    const timeout = window.setTimeout(() => reject(new Error('YouTube IFrame API timeout')), 15_000);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.auditYoutubeApi = 'true';
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('YouTube IFrame API load failed'));
    };
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      resolve(true);
    };
    document.head.append(script);
  }));
}

async function probe(page, videoId, startSeconds) {
  return page.evaluate(({ id, start }) => new Promise((resolve) => {
    const host = document.createElement('div');
    host.dataset.auditPlayerHost = 'true';
    host.style.width = '640px';
    host.style.height = '360px';
    document.body.append(host);
    let player;
    let settled = false;
    let currentTimeAvailable = false;
    let durationAvailable = false;
    let seekAttempted = false;
    let playerCreated = false;
    let playerDestroyed = false;
    const timeout = window.setTimeout(() => finish('TIMEOUT'), 12_000);
    function finish(status, errorCode) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const activeBeforeCleanup = document.querySelectorAll('[data-audit-player-host] iframe').length;
      try {
        const current = player?.getCurrentTime?.();
        const duration = player?.getDuration?.();
        currentTimeAvailable = Number.isFinite(current) && current >= 0;
        durationAvailable = Number.isFinite(duration) && duration > 0;
        player?.stopVideo?.();
        player?.destroy?.();
        playerDestroyed = playerCreated;
      } catch {
        // A remote iframe may disappear between state change and cleanup.
      }
      host.remove();
      resolve({
        status,
        ...(errorCode === undefined ? {} : { errorCode }),
        currentTimeAvailable,
        durationAvailable,
        seekAttempted,
        playerCreated,
        playerDestroyed,
        peakActivePlayers: activeBeforeCleanup,
        activeAfterCleanup: document.querySelectorAll('[data-audit-player-host] iframe').length,
      });
    }
    try {
      player = new window.YT.Player(host, {
        videoId: id,
        playerVars: { controls: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            try {
              player.cueVideoById({ videoId: id, startSeconds: start });
              player.seekTo(start, true);
              seekAttempted = true;
              player.playVideo();
            } catch {
              finish('UNVERIFIED');
            }
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) finish('PLAYABLE');
          },
          onAutoplayBlocked: () => finish('PLAYABLE_AFTER_ACTIVATION'),
          onError: (event) => {
            if (event.data === 101 || event.data === 150) finish('EMBED_DENIED', event.data);
            else if (event.data === 100) finish('UNAVAILABLE', event.data);
            else if (event.data === 2) finish('INVALID_SOURCE', event.data);
            else finish('UNVERIFIED', event.data);
          },
        },
      });
      playerCreated = true;
    } catch {
      finish('UNVERIFIED');
    }
  }), { id: videoId, start: Math.max(0, startSeconds ?? 0) });
}

async function main() {
  const { baseUrl } = assertAuditEnvironment();
  const paths = auditPaths();
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  const browser = await chromium.launch({
    headless: process.env.EVENT_NIGHT_AUDIT_HEADED !== '1',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [];
  let apiAvailable;
  let peakActivePlayers = 0;
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const activation = document.createElement('button');
      activation.id = 'audit-user-activation';
      activation.textContent = 'Activate media audit';
      activation.style.position = 'fixed';
      activation.style.inset = '10px auto auto 10px';
      document.body.append(activation);
    });
    await page.click('#audit-user-activation');
    try {
      await loadYouTubeApi(page);
      apiAvailable = true;
    } catch {
      apiAvailable = false;
    }
    for (const source of manifest.youtubeSources) {
      const usage = manifest.usages.find((item) => item.videoId === source.videoId);
      let result = { status: 'UNVERIFIED', activeAfterCleanup: 0 };
      if (apiAvailable) {
        for (let attempt = 0; attempt <= 2; attempt += 1) {
          await page.click('#audit-user-activation');
          result = await probe(page, source.videoId, usage?.start ?? 0);
          if (!['TIMEOUT', 'UNVERIFIED'].includes(result.status)) break;
        }
      }
      const active = await page.locator('[data-audit-player-host] iframe').count();
      peakActivePlayers = Math.max(peakActivePlayers, active, result.peakActivePlayers ?? 0, result.activeAfterCleanup ?? 0);
      results.push({ ...source, ...result });
      await page.waitForTimeout(350);
    }
    for (const invalid of manifest.invalidSourceUsages) results.push({ ...invalid, status: 'INVALID_SOURCE' });
  } finally {
    await context.close();
    await browser.close();
  }
  const counts = Object.fromEntries(statuses.map((status) => [status, results.filter((result) => result.status === status).length]));
  const report = {
    status: 'COMPLETE',
    apiAvailable,
    uniqueSources: manifest.youtubeSources.length,
    invalidUsages: manifest.invalidSourceUsages.length,
    counts,
    peakActivePlayers,
    activeAfterCleanup: results.reduce((max, result) => Math.max(max, result.activeAfterCleanup ?? 0), 0),
    createdPlayers: results.filter((result) => result.playerCreated).length,
    destroyedPlayers: results.filter((result) => result.playerDestroyed).length,
    results,
  };
  await writeFile(paths.mediaResults, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    apiAvailable,
    uniqueSources: report.uniqueSources,
    counts,
    peakActivePlayers,
    activeAfterCleanup: report.activeAfterCleanup,
  }));
}

await main();
