import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import { assertAuditEnvironment, assertAuditMode, auditPaths } from './config.mjs';

function runNode(label, script, args = [], extraEnvironment = {}) {
  console.log(`[audit] ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function runPnpm(label, args, extraEnvironment = {}) {
  const pnpmScript = process.env.npm_execpath;
  if (!pnpmScript) throw new Error('Run the audit through pnpm so the pinned package manager is used.');
  console.log(`[audit] ${label}`);
  const result = spawnSync(process.execPath, [pnpmScript, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

async function main() {
  assertAuditEnvironment();
  const mode = assertAuditMode(process.argv[2] ?? process.env.EVENT_NIGHT_AUDIT_MODE ?? 'all');
  const paths = auditPaths();
  runNode('seed isolated Authentication Emulator', 'functions/lib/dev/seed-auth.js');
  runNode('create isolated emulator candidate from the read-only source', 'tools/event-night-audit/prepare-data.mjs');
  runNode('seed isolated synthetic browser fixtures', 'functions/lib/dev/seed-quizzes.js');

  if (mode === 'visual' || mode === 'all') {
    runNode('production-like private visual sweep', 'tools/event-night-audit/visual-audit.mjs');
    runNode('generate local-only visual gallery and physical shortlist', 'tools/event-night-audit/gallery.mjs');
  }
  if (mode === 'media' || mode === 'all') {
    runNode('sequential actual YouTube probe', 'tools/event-night-audit/media-probe.mjs');
  }
  if (mode === 'network' || mode === 'all') {
    runPnpm('synthetic projector, recap and network/error browser matrix', [
      'exec', 'playwright', 'test',
      'tests/browser/projector-lifecycle.spec.ts',
      'tests/browser/projector-recap-authority.spec.ts',
      'tests/browser/event-night-audit-network.spec.ts',
      'tests/browser/ux-foundation.spec.ts',
      '--config', 'playwright.config.ts',
    ], {
      BROWSER_E2E_BASE_URL: process.env.EVENT_NIGHT_AUDIT_BASE_URL,
      EVENT_NIGHT_AUDIT_NETWORK: '1',
    });
    const observation = JSON.parse(await readFile(
      `${paths.localRoot}/network-browser-observation.json`,
      'utf8',
    ));
    const findings = [];
    if (observation.offlineCopy === 'GENERIC_CONNECTION_ERROR_VISIBLE') {
      findings.push({ priority: 'P2', code: 'OFFLINE_SAFETY_COPY_OVERWRITTEN' });
    }
    if (observation.syntheticImageFallback === 'MISSING') {
      findings.push({ priority: 'P2', code: 'SYNTHETIC_IMAGE_BROKEN_FALLBACK_MISSING' });
    }
    await writeFile(paths.networkResults, `${JSON.stringify({
      status: findings.length === 0 ? 'PASS' : 'PASS_WITH_FINDINGS',
      offlineBeforeLoad: 'COVERED_BY_SYNTHETIC_BOUNDARY',
      offlineDuringPreparing: 'COVERED_BY_MEDIA_ERROR_BOUNDARY',
      offlineAfterPlaying: 'COVERED_BY_PROJECTOR_CLEAR_AND_RECOVERY',
      apiLoaderFailureRetry: 'COVERED_BY_PLAYER_ERROR_RETRY',
      projectorRefresh: 'PASS',
      projectorCloseReopen: 'PASS',
      fullscreenRejectFallback: 'PASS',
      osLevelNetworkCycle: 'HUMAN_QA_REQUIRED',
      findings,
    }, null, 2)}\n`, 'utf8');
  }

  runNode('verify candidate stayed byte-semantically unchanged', 'tools/event-night-audit/verify-readonly.mjs');
  runNode('write sanitized local summary', 'tools/event-night-audit/summarize.mjs');
}

await main();
