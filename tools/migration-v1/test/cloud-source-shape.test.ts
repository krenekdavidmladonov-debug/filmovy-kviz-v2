import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { sourceReader } from '../src/cloud-adapters.js';
import { createSourceArtifact, transformedArtifact, validateSourceArtifact } from '../src/cloud-contract.js';
import { normalizeV1Library, normalizeV1Slide } from '../src/normalize.js';
import { sanitizeLibrary, sanitizeSlide } from '../src/sanitize.js';
import { transformLibrary } from '../src/transform.js';
import { calculateOutputStats, validateNormalizedInput, validateOutput } from '../src/validate.js';
import type { JsonObject, V1LibrarySnapshot } from '../src/types.js';

const sourceProject = 'source-fixture-project';
const selection = { sourceProject, targetProject: 'filmovy-kviz-v2-staging' };
const time = new Date('2026-01-01T00:00:00Z');
async function fixture(): Promise<V1LibrarySnapshot> {
  return JSON.parse(await readFile(new URL('./fixtures/cloud-null-media.json', import.meta.url), 'utf8')) as V1LibrarySnapshot;
}
function slides(input: V1LibrarySnapshot): JsonObject[] {
  return (input.documents[0]!.data.data as JsonObject).quiz as JsonObject[];
}

describe('observed V1 nullable media structure (synthetic content)', () => {
  test('exports nested global streams with null media through the read-only source API', async () => {
    const input = await fixture();
    let reads = 0;
    const reader = sourceReader({ getLibrary: () => { reads++; return Promise.resolve(input.documents); } });
    expect(Object.keys(reader).sort()).toEqual(['close', 'readLibrary']);
    const snapshot = await reader.readLibrary();
    await reader.close();
    const artifact = createSourceArtifact(snapshot, sourceProject, time);
    expect(reads).toBe(1);
    expect(artifact.counts).toEqual({ quizzes: 2, slides: 14, rounds: 3, questions: 7, correctAnswers: 7, images: 1, audio: 1, video: 1 });
    expect(validateSourceArtifact(artifact, selection)).toEqual(artifact);
    expect(sanitizeLibrary(snapshot)).toEqual(snapshot);
    const rawSlides = snapshot.documents[0]!.data.slides as JsonObject[];
    expect(rawSlides[0]!.media).toBeNull();
    expect(rawSlides[3]!.media).toEqual({ type: 'image', src: 'https://media.example.test/image.png' });
  });

  test('cloud and legacy normalization preserve the same rounds, questions, answers and ordering', async () => {
    const input = await fixture();
    const legacy = normalizeV1Library(input);
    const cloud = normalizeV1Library(sanitizeLibrary(input));
    const before = transformLibrary(legacy, time);
    const after = transformLibrary(cloud, time);
    validateNormalizedInput(cloud);
    validateOutput(cloud, after);
    expect(after).toEqual(before);
    expect(calculateOutputStats(after).correctAnswers).toBe(7);
    const quiz = after[0]!;
    expect(quiz.rounds.map(r => [r.data.title, r.data.position, r.questions.length])).toEqual([
      ['Round 1', 1, 4], ['Round 2', 2, 1],
    ]);
    expect(quiz.slides.map(s => s.data.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(quiz.rounds.flatMap(r => r.questions.map(q => q.data.sourceSlidePosition))).toEqual([3, 4, 5, 6, 8]);
    expect(quiz.rounds.map(r => r.questions.map(q => q.data.position))).toEqual([[1, 2, 3, 4], [1]]);
    for (const q of after) {
      expect(new Set(q.slides.map(s => s.id)).size).toBe(q.slides.length);
      expect(new Set(q.rounds.flatMap(r => r.questions.map(s => s.id))).size).toBe(q.data.questionCount);
    }
    expect(quiz.rounds[0]!.questions.map(q => q.data.correctAnswer)).toEqual(['A', 'Test image answer', 'Test audio answer', 'Test video answer']);
  });

  test('keeps media deduplication, timing and private nullable legacy data', async () => {
    const output = transformedArtifact(createSourceArtifact(await fixture(), sourceProject, time))[0]!;
    expect(output.slides[2]!.data.media).toEqual([]);
    expect((output.slides[2]!.data.legacy as JsonObject).raw).toMatchObject({ media: null });
    expect(output.slides[3]!.data.media).toHaveLength(1);
    expect(output.slides[3]!.data.questionImage).toBe('https://media.example.test/image.png');
    expect(output.slides[4]!.data.mediaSource).toBe('abcdefghijk');
    expect(output.rounds[0]!.questions[2]!.data.audioTrigger).toBe(35);
    expect(output.slides[5]!.data.media).toHaveLength(1);
    expect(output.slides[5]!.data).toMatchObject({ clipStartSeconds: 12, clipEndSeconds: 20 });
    expect(output.data).not.toHaveProperty('correctAnswer');
    expect(output.data.legacy).toMatchObject({ sourceProject, sourceCollection: 'library', sourceId: output.id, transformVersion: 2 });
  });

  test('removes fake sensitive metadata without weakening the allowlist', async () => {
    const artifact = createSourceArtifact(await fixture(), sourceProject, time);
    const serialized = JSON.stringify({ artifact, output: transformedArtifact(artifact) });
    for (const forbidden of ['email', 'phone', 'token', 'secret', 'unknownSensitiveField', 'fake@example.test', 'FAKE_PHONE', 'FAKE_TOKEN', 'FAKE_SECRET', 'DROP_ME']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('null media still allows the existing mediaRaw prompt fallback', () => {
    const slide = normalizeV1Slide({ type: 'image', media: null, mediaRaw: 'https://media.example.test/fallback.png' }, 0);
    expect(slide.media).toHaveLength(1);
    expect(slide.media[0]).toMatchObject({ role: 'prompt', kind: 'image', value: 'https://media.example.test/fallback.png' });
    expect(slide.raw.media).toBeNull();
  });

  test.each([null, [], 'invalid', 1, true])('rejects malformed slide roots: %j', value => {
    expect(() => sanitizeSlide(value)).toThrow(/Expected quiz-content object/u);
  });
  test.each([[], '', 'opaque-media', 1, false])('keeps rejecting malformed non-null media: %j', media => {
    expect(() => sanitizeSlide({ type: 'intro', media })).toThrow(/Expected quiz-content object/u);
  });
  test.each([null, [], 'invalid'])('keeps rejecting malformed library document roots: %j', value => {
    expect(() => sanitizeLibrary({ schemaVersion: 1, collection: 'library', documents: [{ id: 'bad', data: value }] } as unknown as V1LibrarySnapshot)).toThrow(/Expected quiz-content object/u);
  });
  test('still blocks missing arrays, missing answers, unknown types and invalid timing', async () => {
    expect(() => sanitizeLibrary({ schemaVersion: 1, collection: 'library', documents: [{ id: 'missing', data: { name: 'Missing' } }] })).toThrow(/missing source slide array/u);
    const missing = await fixture(); delete slides(missing)[2]!.correct;
    expect(() => createSourceArtifact(missing, sourceProject, time)).toThrow(/no preserved correct answer/u);
    const unknown = await fixture(); slides(unknown)[2]!.type = 'unknown-significant-type';
    expect(() => createSourceArtifact(unknown, sourceProject, time)).toThrow(/UNMAPPED/u);
    const timing = await fixture(); slides(timing)[5]!.videoStart = 30;
    expect(() => createSourceArtifact(timing, sourceProject, time)).toThrow(/videoStart is after videoEnd/u);
  });
});
