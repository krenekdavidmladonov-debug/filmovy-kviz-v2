import { access, readFile, writeFile } from 'node:fs/promises';

import { auditPaths } from './config.mjs';

async function optionalJson(file) {
  try {
    await access(file);
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const paths = auditPaths();
  const [manifest, visual, media, network, readonly, source] = await Promise.all([
    optionalJson(paths.manifest),
    optionalJson(paths.visualResults),
    optionalJson(paths.mediaResults),
    optionalJson(paths.networkResults),
    optionalJson(`${paths.localRoot}/readonly-verification.json`),
    optionalJson(paths.sourceIntegrity),
  ]);
  const priorities = (priority) => visual?.findings?.filter((finding) => finding.priority === priority).length ?? 0;
  const summary = {
    schemaVersion: 1,
    candidate: manifest === null ? null : {
      revision: manifest.candidate.revision,
      slides: manifest.candidate.slideCount,
      rounds: manifest.candidate.roundCount,
      questions: manifest.candidate.questionCount,
      typeCounts: manifest.typeCounts,
    },
    readiness: visual === null ? null : {
      blockersBefore: visual.blockersBefore,
      blockersAfter: visual.blockersAfter,
      warningsBefore: visual.warningsBefore,
      warningsAfter: visual.warningsAfter,
    },
    media: manifest === null ? null : {
      rawReferenceCounts: manifest.rawMediaCounts,
      semanticUsages: manifest.usages.length,
      uniqueYouTubeSources: manifest.youtubeSources.length,
      timingIssues: manifest.timingIssues,
      actualProbeExecuted: media?.actualProbeExecuted ?? (media === null ? null : true),
      classifications: media?.counts ?? null,
      peakActivePlayers: media?.peakActivePlayers ?? null,
      activeAfterCleanup: media?.activeAfterCleanup ?? null,
      createdPlayers: media?.createdPlayers ?? null,
      destroyedPlayers: media?.destroyedPlayers ?? null,
    },
    visual: visual === null ? null : {
      sourceSlides: visual.sourceSlides,
      slideViewportChecks: visual.slideViewportChecks,
      viewports: visual.viewports,
      screenshots: visual.galleryItems.length,
      P0: priorities('P0'),
      P1: priorities('P1'),
      P2: priorities('P2'),
      P3: priorities('P3'),
      consoleErrors: visual.browser.consoleErrors.length,
      pageErrors: visual.browser.pageErrors.length,
      failedRequests: visual.browser.failedRequests.length,
      performance: visual.performance,
    },
    network,
    readonly: readonly === null ? null : {
      status: readonly.status,
      revisionBefore: readonly.revisionBefore,
      revisionAfter: readonly.revisionAfter,
      candidateUnchanged: readonly.candidateUnchanged,
      candidateSessionsAfter: readonly.candidateSessionsAfter,
    },
    source: source === null ? null : { bytes: source.bytes, match: source.match },
  };
  await writeFile(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', summary: paths.summary }));
}

await main();
