/* global document, getComputedStyle, window */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { assertAuditEnvironment, auditPaths, percentile } from './config.mjs';

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
];

async function login(page, baseUrl, email = 'moderator@example.test') {
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
  const emailField = page.getByLabel('E-mail');
  await emailField.waitFor({ state: 'visible' });
  await emailField.fill(email);
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL(/\/admin$/u);
}

function screenshotName(slide, suffix) {
  const position = String(slide.position).padStart(3, '0');
  return `${position}-${slide.kind}-${suffix}.png`.replaceAll(/[^a-z0-9_.-]/giu, '-');
}

async function diagnostics(page) {
  return page.locator('.preview-stage .slide-renderer').evaluate((root) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rootRect = root.getBoundingClientRect();
    const safe = root.querySelector('.slide-safe-area');
    const safeRect = safe?.getBoundingClientRect();
    const major = [...root.querySelectorAll('.slide-centered,.slide-layout,.video-presentation,.question-image-frame,.slide-answer')]
      .filter(visible);
    const outsideSafeArea = safeRect === undefined ? 1 : major.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < safeRect.left - 2 || rect.right > safeRect.right + 2
        || rect.top < safeRect.top - 2 || rect.bottom > safeRect.bottom + 2;
    }).length;
    const textElements = [...root.querySelectorAll('h1,h2,p,li,strong')].filter(visible);
    const textOverflow = textElements.map((element) => {
      const style = getComputedStyle(element);
      const clips = (value) => ['auto', 'clip', 'hidden', 'scroll'].includes(value);
      return {
        horizontal: element.scrollWidth - element.clientWidth,
        vertical: element.scrollHeight - element.clientHeight,
        clipsHorizontal: clips(style.overflowX),
        clipsVertical: clips(style.overflowY),
      };
    });
    // A scroll metric delta on overflow:visible is glyph paint, not clipping;
    // 1-2 px can additionally be CSS sub-pixel rounding.
    const clippedText = textOverflow.filter(({ horizontal, vertical, clipsHorizontal, clipsVertical }) => (
      (clipsHorizontal && horizontal > 2) || (clipsVertical && vertical > 2)
    )).length;
    const zeroSizedImportant = [...root.querySelectorAll('.slide-safe-area,.slide-centered,.slide-layout')]
      .filter((element) => visible(element) && (element.clientWidth === 0 || element.clientHeight === 0)).length;
    const overlapCandidates = [...root.querySelectorAll([
      '.slide-layout > .slide-question-label',
      '.slide-layout > .slide-copy',
      '.slide-layout > .slide-options',
      '.slide-layout > .question-image-frame',
      '.slide-layout > .vinyl-visual',
      '.slide-layout > .slide-answer',
    ].join(','))].filter(visible);
    let overlappingBlocks = 0;
    for (let leftIndex = 0; leftIndex < overlapCandidates.length; leftIndex += 1) {
      const left = overlapCandidates[leftIndex].getBoundingClientRect();
      for (let rightIndex = leftIndex + 1; rightIndex < overlapCandidates.length; rightIndex += 1) {
        const right = overlapCandidates[rightIndex].getBoundingClientRect();
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (overlapWidth > 2 && overlapHeight > 2) overlappingBlocks += 1;
      }
    }
    const brokenImages = [...root.querySelectorAll('img')]
      .filter((image) => image.complete && image.naturalWidth === 0).length;
    const iframeCount = root.querySelectorAll('iframe').length;
    const hasRawError = root.querySelector('.projector-media-error,[data-technical-error]') !== null;
    const spinnerCount = [...root.querySelectorAll('[aria-busy="true"],.loading,.spinner')].filter(visible).length;
    const contentNode = root.querySelector('.slide-centered,.slide-layout,.video-presentation');
    return {
      width: rootRect.width,
      height: rootRect.height,
      ratio: rootRect.width / rootRect.height,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
      verticalOverflow: root.scrollHeight > root.clientHeight + 1,
      outsideSafeArea,
      clippedText,
      maxTextOverflowHorizontal: Math.max(0, ...textOverflow.map(({ horizontal }) => horizontal)),
      maxTextOverflowVertical: Math.max(0, ...textOverflow.map(({ vertical }) => vertical)),
      zeroSizedImportant,
      overlappingBlocks,
      brokenImages,
      iframeCount,
      hasRawError,
      spinnerCount,
      emptySlide: contentNode === null || (!contentNode.textContent?.trim() && contentNode.querySelector('img,iframe') === null),
      domCount: root.querySelectorAll('*').length,
    };
  });
}

async function main() {
  const { baseUrl } = assertAuditEnvironment();
  const paths = auditPaths();
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  await mkdir(paths.screenshots, { recursive: true });
  const browser = await chromium.launch({
    headless: process.env.EVENT_NIGHT_AUDIT_HEADED !== '1',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    class AuditVisualPlayer {
      constructor(element, options) {
        this.element = element;
        this.options = options;
        const placeholder = document.createElement('div');
        placeholder.dataset.auditYoutubePlaceholder = 'true';
        placeholder.style.cssText = 'width:100%;height:100%;background:#000;display:grid;place-items:center;color:#aaa';
        placeholder.textContent = 'YOUTUBE PLAYER — LOCAL VISUAL MOCK';
        element.append(placeholder);
        queueMicrotask(() => options.events.onReady());
      }
      cueVideoById() {}
      loadVideoById() { queueMicrotask(() => this.options.events.onStateChange({ data: 1 })); }
      pauseVideo() {}
      seekTo() {}
      getCurrentTime() { return 0; }
      destroy() { this.element.replaceChildren(); }
    }
    window.YT = { Player: AuditVisualPlayer, PlayerState: { ENDED: 0, PLAYING: 1 } };
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' }));

  try {
    await login(page, baseUrl);
    await page.goto(`${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/readiness`, { waitUntil: 'domcontentloaded' });
    const readiness = page.locator('[data-preflight-status]');
    await readiness.waitFor({ state: 'visible' });
    const blockersBefore = Number(await readiness.getAttribute('data-blocker-count'));
    const warningsBefore = Number(await readiness.getAttribute('data-warning-count'));

    await page.goto(`${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('.round-first-editor').waitFor({ state: 'visible' });
    await page.addStyleTag({ content: `
      .round-editor-preview { position: fixed !important; inset: 0 !important; z-index: 9999 !important; width: 100vw !important; height: 100vh !important; max-height: none !important; padding: 0 !important; overflow: hidden !important; background: #000 !important; }
      .round-editor-preview > .preview-heading,
      .round-editor-preview > .local-preview-label,
      .round-editor-preview > .answer-preview-toggle,
      .round-editor-preview > .field-help { visibility: hidden !important; position: absolute !important; }
      .round-editor-preview .preview-stage { width: 100vw !important; height: 100vh !important; border: 0 !important; border-radius: 0 !important; }
      .round-editor-preview .slide-renderer { width: 100vw !important; height: 100vh !important; min-height: 0 !important; aspect-ratio: 16 / 9 !important; border: 0 !important; border-radius: 0 !important; }
    ` });

    const findings = [];
    const transitions = [];
    const galleryItems = [];
    const domCounts = [];
    const textOverflowHorizontal = [];
    const textOverflowVertical = [];
    let slidesChecked = 0;
    for (const [viewportIndex, viewport] of viewports.entries()) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const orderedSlides = viewportIndex % 2 === 0 ? manifest.slides : [...manifest.slides].reverse();
      for (const slide of orderedSlides) {
        const selector = `[data-audit-slide-id="${slide.id}"]`;
        const control = page.locator(selector).first();
        if (await control.count() === 0) {
          findings.push({ priority: 'P1', code: 'SLIDE_NOT_SELECTABLE', semanticRef: slide.semanticRef, viewport: viewport.name });
          continue;
        }
        const started = performance.now();
        await control.evaluate((element) => element.click());
        const preview = page.locator('.preview-stage');
        await preview.waitFor({ state: 'visible' });
        try {
          await page.waitForFunction((position) => (
            document.querySelector('.preview-stage')?.getAttribute('data-slide-position') === String(position)
          ), slide.position, { timeout: 3_000 });
        } catch {
          const displayedPosition = await preview.getAttribute('data-slide-position');
          findings.push({
            priority: 'P1',
            code: 'SLIDE_SELECTION_STALE',
            semanticRef: slide.semanticRef,
            viewport: viewport.name,
            displayedPosition,
          });
          console.log(JSON.stringify({ status: 'VISUAL_SELECTION_MISMATCH', semanticRef: slide.semanticRef, viewport: viewport.name }));
          continue;
        }
        transitions.push(performance.now() - started);
        await page.waitForTimeout(25);
        const result = await diagnostics(page);
        slidesChecked += 1;
        domCounts.push(result.domCount);
        textOverflowHorizontal.push(result.maxTextOverflowHorizontal);
        textOverflowVertical.push(result.maxTextOverflowVertical);
        const checks = [
          ['CANVAS_RATIO', Math.abs(result.ratio - (16 / 9)) > 0.01, 'P1'],
          ['HORIZONTAL_OVERFLOW', result.horizontalOverflow, 'P1'],
          ['VERTICAL_OVERFLOW', result.verticalOverflow, 'P1'],
          ['OUTSIDE_SAFE_AREA', result.outsideSafeArea > 0, 'P1'],
          ['TEXT_CLIPPING', result.clippedText > 0, 'P1'],
          ['ZERO_SIZE_IMPORTANT', result.zeroSizedImportant > 0, 'P1'],
          ['MAIN_BLOCK_OVERLAP', result.overlappingBlocks > 0, 'P1'],
          ['BROKEN_IMAGE', result.brokenImages > 0, 'P2'],
          ['MULTIPLE_PLAYERS', result.iframeCount > 1, 'P1'],
          ['RAW_PROJECTOR_ERROR', result.hasRawError, 'P1'],
          ['INFINITE_SPINNER', result.spinnerCount > 0, 'P1'],
          ['EMPTY_SLIDE', result.emptySlide, 'P1'],
        ];
        for (const [code, failed, priority] of checks) {
          if (failed) findings.push({ priority, code, semanticRef: slide.semanticRef, viewport: viewport.name });
        }
        if (viewport === viewports[0]) {
          const questionFile = screenshotName(slide, 'question');
          await page.locator('.preview-stage .slide-renderer').screenshot({ path: `${paths.screenshots}/${questionFile}` });
          galleryItems.push({ semanticRef: slide.semanticRef, kind: slide.kind, mode: 'question', file: questionFile });
          if (slide.isQuestion) {
            const answerToggle = page.locator('.answer-preview-toggle input');
            await answerToggle.evaluate((element) => element.click());
            await page.waitForTimeout(25);
            const recapFile = screenshotName(slide, 'recap');
            await page.locator('.preview-stage .slide-renderer').screenshot({ path: `${paths.screenshots}/${recapFile}` });
            galleryItems.push({ semanticRef: slide.semanticRef, kind: slide.kind, mode: 'private-recap', file: recapFile });
            await answerToggle.evaluate((element) => element.click());
          }
        }
      }
    }

    const mobileContext = await browser.newContext();
    const mobilePage = await mobileContext.newPage();
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    await login(mobilePage, baseUrl);
    await mobilePage.goto(`${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/edit`, { waitUntil: 'domcontentloaded' });
    const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await mobileContext.close();
    if (mobileOverflow) findings.push({ priority: 'P2', code: 'ADMIN_MOBILE_HORIZONTAL_OVERFLOW', semanticRef: 'ADMIN', viewport: '390x844' });

    await page.goto(`${baseUrl}/admin/quizzes/${encodeURIComponent(manifest.candidate.quizId)}/readiness`, { waitUntil: 'domcontentloaded' });
    const afterReadiness = page.locator('[data-preflight-status]');
    await afterReadiness.waitFor({ state: 'visible' });
    const blockersAfter = Number(await afterReadiness.getAttribute('data-blocker-count'));
    const warningsAfter = Number(await afterReadiness.getAttribute('data-warning-count'));
    const results = {
      status: 'COMPLETE',
      candidateRevision: manifest.candidate.revision,
      blockersBefore,
      warningsBefore,
      blockersAfter,
      warningsAfter,
      viewports: [...viewports.map((viewport) => viewport.name), '390x844-admin'],
      sourceSlides: manifest.slides.length,
      slideViewportChecks: slidesChecked,
      galleryItems,
      findings,
      performance: {
        transitions: transitions.length,
        forwardSweeps: 2,
        reverseSweeps: 2,
        medianMs: Math.round(percentile(transitions, 0.5)),
        p95Ms: Math.round(percentile(transitions, 0.95)),
        domMin: Math.min(...domCounts),
        domMax: Math.max(...domCounts),
        domGrowthFromFirstToLast: domCounts.at(-1) - domCounts[0],
        maxTextOverflowHorizontal: Math.max(...textOverflowHorizontal),
        maxTextOverflowVertical: Math.max(...textOverflowVertical),
      },
      browser: {
        consoleErrors,
        pageErrors,
        failedRequests,
      },
    };
    await writeFile(paths.visualResults, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: 'COMPLETE',
      sourceSlides: manifest.slides.length,
      slideViewportChecks: slidesChecked,
      screenshots: galleryItems.length,
      blockerCounts: [blockersBefore, blockersAfter],
      warningCounts: [warningsBefore, warningsAfter],
      findings: {
        P0: findings.filter((finding) => finding.priority === 'P0').length,
        P1: findings.filter((finding) => finding.priority === 'P1').length,
        P2: findings.filter((finding) => finding.priority === 'P2').length,
        P3: findings.filter((finding) => finding.priority === 'P3').length,
      },
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      performance: results.performance,
    }));
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
