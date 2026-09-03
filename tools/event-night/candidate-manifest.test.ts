import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'vitest';

import { mapEditorQuiz, mapEditorSlide } from '../../apps/web/src/features/editor/editorMappers';
import { semanticQuestionType } from '../../apps/web/src/features/editor/semanticModel';
import { correctOptionIndex } from '../../apps/web/src/features/editor/validation';
import { preflightFixUrl, runQuizPreflight } from '../../apps/web/src/features/preflight/validation';
import { normalizeV1Library, readV1Library, transformLibrary } from '../migration-v1/src/index';
import type { JsonObject, JsonValue, NormalizedSlide } from '../migration-v1/src/types';

const inputPath = path.resolve('.local-data/v1-export/library.json');
const outputDirectory = path.resolve('.local-data/tomorrow-candidate');
const outputPath = path.join(outputDirectory, 'candidate-manifest.json');

const compact = (value: string) => value
  .normalize('NFKC')
  .trim()
  .replaceAll(/\s+/gu, ' ')
  .toLocaleLowerCase('cs-CZ');

function parsedOptionsString(raw: JsonObject): string[] {
  return typeof raw.optionsStr === 'string'
    ? raw.optionsStr.split(/\r?\n|\|/u).map((item) => item.trim()).filter(Boolean)
    : [];
}

function jsonType(value: JsonValue | undefined): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function positionFromSlideId(slideId: string): number {
  return Number(slideId.replace(/^slide-/u, ''));
}

function classifyAnswer(slide: ReturnType<typeof mapEditorSlide>, source: NormalizedSlide) {
  const answer = compact(slide.correctAnswer);
  const matches = slide.options.filter((option) => compact(option) === answer).length;
  const alternateOptions = parsedOptionsString(source.raw);
  const alternateMatches = alternateOptions.filter((option) => compact(option) === answer).length;
  const deterministicIndex = correctOptionIndex(slide);
  const classification = deterministicIndex !== undefined || matches === 1
    ? 'FALSE_POSITIVE_OR_VALIDATION_DEFECT'
    : alternateMatches === 1
      ? 'DETERMINISTIC_LEGACY_NORMALIZATION_REVIEW'
      : 'REAL_CONTENT_DEFECT_HUMAN_REQUIRED';
  return {
    classification,
    correctStorageType: jsonType(source.correctAnswer),
    optionCount: slide.options.filter((option) => option.trim() !== '').length,
    normalizedMatches: matches,
    alternateOptionCount: alternateOptions.length,
    alternateMatches,
    isLetterToken: /^[a-f]$/u.test(answer),
    isNumericToken: /^\d+$/u.test(answer),
  };
}

function fieldShape(raw: JsonObject, key: string): string {
  const value = raw[key];
  if (typeof value === 'number' && Number.isFinite(value)) return 'finite-number';
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return 'numeric-string';
  return jsonType(value);
}

function classifyTiming(source: NormalizedSlide) {
  const exactPair = source.videoStart !== undefined && source.videoEnd !== undefined;
  const increasing = exactPair && source.videoStart >= 0 && source.videoEnd > source.videoStart;
  return {
    classification: increasing
      ? 'FALSE_POSITIVE_OR_VALIDATION_DEFECT'
      : 'REAL_CONTENT_DEFECT_HUMAN_REQUIRED',
    startShape: fieldShape(source.raw, 'videoStart'),
    endShape: fieldShape(source.raw, 'videoEnd'),
    exactStartPresent: source.videoStart !== undefined,
    exactEndPresent: source.videoEnd !== undefined,
    exactPairIncreasing: increasing,
  };
}

test('selects and records a sanitised tomorrow candidate', async () => {
  const sourceBytes = await readFile(inputPath);
  const snapshot = await readV1Library(inputPath);
  const normalized = normalizeV1Library(snapshot);
  const transformed = transformLibrary(normalized, new Date('2026-01-01T00:00:00.000Z'));
  const reports = transformed.map((quiz, index) => {
    const slides = quiz.slides.map((slide) => mapEditorSlide(slide.id, slide.data));
    const editorQuiz = mapEditorQuiz(quiz.id, { ...quiz.data, revision: 0 }, slides);
    return { quiz: editorQuiz, source: normalized[index]!, preflight: runQuizPreflight(editorQuiz) };
  }).sort((left, right) => left.preflight.blockerCount - right.preflight.blockerCount
    || left.preflight.warningCount - right.preflight.warningCount
    || left.preflight.questionCount - right.preflight.questionCount
    || left.quiz.id.localeCompare(right.quiz.id));

  const candidate = reports[0]!;
  const blockers = candidate.preflight.issues
    .filter((issue) => issue.severity === 'BLOCKER')
    .map((issue) => {
      const questionId = issue.reference.questionId;
      const source = questionId === undefined
        ? undefined
        : candidate.source.slides.find((slide) => slide.position === positionFromSlideId(questionId));
      const editorSlide = questionId === undefined
        ? undefined
        : candidate.quiz.slides.find((slide) => slide.id === questionId);
      const reference = {
        round: issue.reference.roundPosition,
        question: issue.reference.questionNumber,
        questionType: issue.reference.questionType,
        issueCode: issue.code,
        fixPath: issue.fixTarget === undefined ? undefined : preflightFixUrl(candidate.quiz.id, issue.fixTarget),
      };
      if (source === undefined || editorSlide === undefined) {
        return { ...reference, classification: 'UNSUPPORTED_TECHNICAL_DEFECT' };
      }
      if (issue.category === 'ANSWER') return { ...reference, ...classifyAnswer(editorSlide, source) };
      if (issue.category === 'TIMING') return { ...reference, ...classifyTiming(source) };
      return { ...reference, classification: 'REAL_CONTENT_DEFECT_HUMAN_REQUIRED' };
    });

  const classificationCounts = Object.fromEntries(
    [...new Set(blockers.map((item) => item.classification))].sort().map((classification) => [
      classification,
      blockers.filter((item) => item.classification === classification).length,
    ]),
  );
  const typeCounts = Object.fromEntries(
    [...new Set(candidate.quiz.slides.filter((slide) => slide.isQuestion).map(semanticQuestionType))]
      .sort()
      .map((type) => [type, candidate.quiz.slides.filter(
        (slide) => slide.isQuestion && semanticQuestionType(slide) === type,
      ).length]),
  );
  const manifest = {
    schemaVersion: 1,
    projectId: 'demo-filmovy-kviz-v2',
    generatedAtUtc: new Date().toISOString(),
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    selectionPolicy: ['blockers', 'warnings', 'questions', 'documentId'],
    candidate: {
      quizId: candidate.quiz.id,
      title: candidate.quiz.title,
      rounds: candidate.preflight.roundCount,
      questions: candidate.preflight.questionCount,
      blockers: candidate.preflight.blockerCount,
      warnings: candidate.preflight.warningCount,
      status: candidate.preflight.status,
      typeCounts,
    },
    classificationCounts,
    blockers,
    allQuizzes: reports.map((item) => ({
      quizId: item.quiz.id,
      rounds: item.preflight.roundCount,
      questions: item.preflight.questionCount,
      blockers: item.preflight.blockerCount,
      warnings: item.preflight.warningCount,
    })),
    containsPrivateAnswerValues: false,
    containsQuestionText: false,
    containsMediaUrls: false,
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.info(JSON.stringify({
    status: 'PASS',
    candidate: manifest.candidate,
    classificationCounts,
    output: '.local-data/tomorrow-candidate/candidate-manifest.json',
  }));
  expect(blockers).toHaveLength(candidate.preflight.blockerCount);
  expect(manifest.containsPrivateAnswerValues).toBe(false);
});
