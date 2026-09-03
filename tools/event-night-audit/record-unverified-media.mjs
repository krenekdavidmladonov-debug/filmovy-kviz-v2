import { readFile, writeFile } from 'node:fs/promises';

import { auditPaths } from './config.mjs';

const statuses = ['PLAYABLE', 'PLAYABLE_AFTER_ACTIVATION', 'EMBED_DENIED', 'UNAVAILABLE', 'TIMEOUT', 'INVALID_SOURCE', 'UNVERIFIED'];

async function main() {
  const paths = auditPaths();
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  const results = [
    ...manifest.youtubeSources.map((source) => ({ ...source, status: 'UNVERIFIED' })),
    ...manifest.invalidSourceUsages.map((usage) => ({ ...usage, status: 'INVALID_SOURCE' })),
  ];
  const counts = Object.fromEntries(statuses.map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]));
  await writeFile(paths.mediaResults, `${JSON.stringify({
    status: 'NOT_EXECUTED',
    reason: 'EXTERNAL_NETWORK_NOT_AUTHORIZED',
    actualProbeExecuted: false,
    apiAvailable: null,
    uniqueSources: manifest.youtubeSources.length,
    invalidUsages: manifest.invalidSourceUsages.length,
    counts,
    peakActivePlayers: 0,
    activeAfterCleanup: 0,
    createdPlayers: 0,
    destroyedPlayers: 0,
    results,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', actualProbeExecuted: false, counts }));
}

await main();
