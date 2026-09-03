import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertAuditEnvironment, auditPaths } from './config.mjs';
import {
  findCandidateQuiz,
  loadCandidateState,
  publicSessionCount,
  stateFingerprint,
  withAuditFirestore,
} from './candidate-state.mjs';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function object(value) {
  return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function youtubeVideoId(source) {
  const trimmed = source.trim();
  if (/^[\w-]{11}$/u.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/u.test(parsed.pathname.split('/').filter(Boolean)[0] ?? '')
      ? parsed.pathname.split('/').filter(Boolean)[0]
      : undefined;
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const candidate = parsed.searchParams.get('v')
        ?? (['embed', 'shorts', 'live'].includes(parts[0] ?? '') ? parts[1] : undefined);
      return candidate && /^[\w-]{11}$/u.test(candidate) ? candidate : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function semanticKind(slide) {
  const kind = text(slide.data.kind).toLowerCase();
  if (kind === 'pl') return 'legacy-pl';
  if (['audio', 'music'].includes(kind)) return 'audio';
  if (['video', 'youtube'].includes(kind)) return 'video';
  if (['image', 'picture', 'photo'].includes(kind)) return 'image';
  if (kind === 'free') return 'free';
  if (slide.data.isQuestion === true) return Array.isArray(slide.data.options) && slide.data.options.length >= 2 ? 'choice' : 'free';
  return kind || 'legacy';
}

function sourceFromMedia(entry) {
  const data = object(entry);
  for (const field of ['value', 'source', 'url']) {
    if (typeof data[field] === 'string' && data[field] !== '') return data[field];
  }
  return '';
}

async function main() {
  const { projectId } = assertAuditEnvironment();
  const sourcePath = process.env.EVENT_NIGHT_AUDIT_SOURCE;
  const primaryRoot = process.env.EVENT_NIGHT_AUDIT_PRIMARY_ROOT;
  if (!sourcePath || !primaryRoot || !path.isAbsolute(sourcePath) || !path.isAbsolute(primaryRoot)) {
    throw new Error('Audit source and primary root must be explicit absolute paths.');
  }
  const [realSource, realAllowedRoot] = await Promise.all([
    realpath(sourcePath),
    realpath(path.join(primaryRoot, '.local-data/v1-export')),
  ]);
  const relative = path.relative(realAllowedRoot, realSource);
  if (relative !== 'library.json') {
    throw new Error('Audit source must be the exact read-only .local-data/v1-export/library.json file.');
  }
  const sourceBefore = await readFile(realSource);
  const sourceBeforeHash = sha256(sourceBefore);

  const [{ readV1Library }, { normalizeV1Library }, { transformLibrary }, { writeToFirestoreEmulator }] = await Promise.all([
    import('../migration-v1/lib/read.js'),
    import('../migration-v1/lib/normalize.js'),
    import('../migration-v1/lib/transform.js'),
    import('../migration-v1/lib/write.js'),
  ]);
  const normalized = normalizeV1Library(await readV1Library(realSource));
  const transformed = transformLibrary(normalized, new Date('2026-09-03T00:00:00.000Z'));
  await writeToFirestoreEmulator(transformed);
  const candidate = transformed.filter((quiz) => quiz.data.roundCount === 5 && quiz.data.questionCount === 50);
  if (candidate.length !== 1) throw new Error(`Expected one candidate in the source; found ${candidate.length}.`);
  const quiz = candidate[0];
  const roundPositions = new Map(quiz.rounds.map((round, index) => [round.id, index + 1]));
  const questionPositions = new Map();
  for (const round of quiz.rounds) {
    round.questions.forEach((question, index) => questionPositions.set(question.id, index + 1));
  }
  const typeCounts = {};
  const rawMediaCounts = { audio: 0, video: 0, image: 0, unknown: 0 };
  const usages = [];
  const slides = quiz.slides.map((slide) => {
    const kind = semanticKind(slide);
    typeCounts[kind] = (typeCounts[kind] ?? 0) + (slide.data.isQuestion === true ? 1 : 0);
    const round = slide.roundId ? roundPositions.get(slide.roundId) : undefined;
    const question = questionPositions.get(slide.id);
    const semanticRef = round && question ? `R${round} Q${question}` : `S${slide.data.position}`;
    const media = Array.isArray(slide.data.media) ? slide.data.media : [];
    for (const entry of media) {
      const mediaKind = text(object(entry).kind);
      rawMediaCounts[mediaKind in rawMediaCounts ? mediaKind : 'unknown'] += sourceFromMedia(entry) === '' ? 0 : 1;
    }
    if (kind === 'audio' || kind === 'video') {
      const direct = text(slide.data.mediaSource);
      const mediaSource = direct || sourceFromMedia(media.find((entry) => text(object(entry).kind) === kind));
      const presentation = object(slide.data.presentation);
      const start = number(slide.data.clipStartSeconds) ?? number(presentation.videoStart) ?? number(presentation.audioTrigger);
      const end = number(slide.data.clipEndSeconds) ?? number(presentation.videoEnd);
      const timingStatus = start === null || end === null || start < 0 || end <= start ? 'HUMAN_TIMING_REQUIRED' : 'VALID';
      usages.push({
        semanticRef,
        kind,
        source: mediaSource,
        videoId: youtubeVideoId(mediaSource),
        start,
        end,
        timingStatus,
        recapUsage: true,
      });
    }
    const options = Array.isArray(slide.data.options) ? slide.data.options.map(text) : [];
    return {
      id: slide.id,
      position: slide.data.position,
      kind,
      storedKind: text(slide.data.kind),
      isQuestion: slide.data.isQuestion === true,
      semanticRef,
      round: round ?? null,
      question: question ?? null,
      titleLength: text(slide.data.title).length,
      textLength: text(slide.data.text).length,
      optionCount: options.length,
      maxOptionLength: Math.max(0, ...options.map((value) => value.length)),
    };
  });
  const uniqueById = new Map();
  for (const usage of usages) {
    if (usage.videoId && !uniqueById.has(usage.videoId)) {
      uniqueById.set(usage.videoId, { videoId: usage.videoId, source: usage.source, usages: [] });
    }
    if (usage.videoId) uniqueById.get(usage.videoId).usages.push({ semanticRef: usage.semanticRef, kind: usage.kind });
  }

  const paths = auditPaths();
  await mkdir(paths.localRoot, { recursive: true });
  const state = await withAuditFirestore(projectId, async (db) => {
    const candidateDocument = await findCandidateQuiz(db);
    return {
      candidate: await loadCandidateState(db, candidateDocument.id),
      publicSessions: await publicSessionCount(db),
    };
  });
  const revision = typeof state.candidate.quiz.data.revision === 'number' ? state.candidate.quiz.data.revision : 0;
  const manifest = {
    schemaVersion: 1,
    projectId,
    candidate: {
      quizId: quiz.id,
      title: text(quiz.data.title),
      revision,
      slideCount: quiz.slides.length,
      roundCount: quiz.rounds.length,
      questionCount: quiz.data.questionCount,
    },
    typeCounts,
    rawMediaCounts,
    usages,
    youtubeSources: [...uniqueById.values()],
    invalidSourceUsages: usages.filter((usage) => !usage.videoId).map(({ semanticRef, kind }) => ({ semanticRef, kind })),
    timingIssues: usages.filter((usage) => usage.timingStatus !== 'VALID').map(({ semanticRef, kind, timingStatus }) => ({ semanticRef, kind, timingStatus })),
    slides,
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(paths.beforeState, `${JSON.stringify({
    quizId: quiz.id,
    revision,
    fingerprint: stateFingerprint(state.candidate),
    publicSessionCount: state.publicSessions,
  }, null, 2)}\n`, 'utf8');
  const sourceAfter = await readFile(realSource);
  const sourceAfterHash = sha256(sourceAfter);
  await writeFile(paths.sourceIntegrity, `${JSON.stringify({
    sourcePath: realSource,
    bytes: (await stat(realSource)).size,
    beforeHash: sourceBeforeHash,
    afterPrepareHash: sourceAfterHash,
    match: sourceBeforeHash === sourceAfterHash,
  }, null, 2)}\n`, 'utf8');
  if (sourceBeforeHash !== sourceAfterHash) throw new Error('Read-only source changed while preparing the audit.');
  console.log(JSON.stringify({
    status: 'PASS',
    candidate: {
      revision,
      slides: quiz.slides.length,
      rounds: quiz.rounds.length,
      questions: quiz.data.questionCount,
    },
    typeCounts,
    rawMediaCounts,
    semanticMediaUsages: usages.length,
    uniqueYouTubeSources: uniqueById.size,
    invalidSources: manifest.invalidSourceUsages.length,
    timingIssues: manifest.timingIssues.length,
    sourceHashMatch: true,
  }));
}

await main();
