import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeV1Library } from './normalize.js';
import { readV1Library } from './read.js';
import { isJsonObjectValue } from './transform.js';
import { calculateSourceStats } from './validate.js';
import type { JsonValue, NormalizedSlide } from './types.js';

const inputPath = path.resolve('.local-data/v1-export/library.json');
const outputPath = path.resolve('.local-data/v1-analysis/inventory.json');
const knownTypes = new Set(['agenda', 'audio', 'end', 'free', 'image', 'intro', 'question', 'recap', 'video']);
const partialTypes = new Set(['pl']);
const knownFields = new Set([
  'answerImg', 'answerOverlay', 'audioTrigger', 'bgImage', 'bgOverlay', 'correct', 'correctAnswer',
  'media', 'mediaRaw', 'note', 'options', 'optionsStr', 'qCount', 'roundHeader', 'text', 'title',
  'type', 'videoEnd', 'videoStart',
]);
const partialFields = new Set(['bgRaw', 'id', 'recapOverrides']);

function shape(value: JsonValue | undefined): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function entries(map: Map<string, number>, keyName: string): Record<string, string | number>[] {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({ [keyName]: key, count }));
}

function statusForType(type: string): 'KNOWN' | 'PARTIALLY_MAPPED' | 'UNKNOWN' {
  if (knownTypes.has(type)) return 'KNOWN';
  if (partialTypes.has(type)) return 'PARTIALLY_MAPPED';
  return 'UNKNOWN';
}

function statusForField(field: string): 'KNOWN' | 'PARTIALLY_MAPPED' | 'UNKNOWN' {
  if (knownFields.has(field)) return 'KNOWN';
  if (partialFields.has(field)) return 'PARTIALLY_MAPPED';
  return 'UNKNOWN';
}

function nonEmpty(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

function analyzeSlides(slides: readonly NormalizedSlide[]) {
  const types = new Map<string, number>();
  const fields = new Map<string, number>();
  const fieldShapes = new Map<string, number>();
  const combinations = new Map<string, number>();
  const optionLengths = new Map<string, number>();
  const optionItemShapes = new Map<string, number>();
  const correctVariants = new Map<string, number>();
  for (const slide of slides) {
    increment(types, slide.sourceType || '<missing>');
    const names = Object.keys(slide.raw).sort();
    increment(combinations, `${slide.sourceType || '<missing>'}|${names.join(',')}`);
    for (const [field, value] of Object.entries(slide.raw)) {
      increment(fields, field);
      increment(fieldShapes, `${field}|${shape(value)}`);
    }
    increment(optionLengths, String(slide.options.length));
    for (const option of slide.options) increment(optionItemShapes, shape(option));
    for (const field of ['correct', 'correctAnswer']) {
      const value = slide.raw[field];
      if (value !== undefined) {
        increment(correctVariants, `${field}|${shape(value)}|${nonEmpty(value) ? 'non-empty' : 'empty'}`);
      }
    }
  }
  return {
    types: [...types.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => ({
      type,
      count,
      status: statusForType(type),
    })),
    fields: [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([field, count]) => ({
      field,
      count,
      status: statusForField(field),
    })),
    fieldShapes: entries(fieldShapes, 'shape'),
    combinations: entries(combinations, 'signature'),
    optionLengths: entries(optionLengths, 'length'),
    optionItemShapes: entries(optionItemShapes, 'shape'),
    correctVariants: entries(correctVariants, 'variant'),
  };
}

async function createInventory(): Promise<void> {
  const snapshot = await readV1Library(inputPath);
  const quizzes = normalizeV1Library(snapshot);
  const allSlides = quizzes.flatMap((quiz) => quiz.slides);
  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: '.local-data/v1-export/library.json',
    totals: calculateSourceStats(quizzes),
    quizzes: quizzes.map((quiz) => {
      const stats = calculateSourceStats([quiz]);
      const nestedMetadata = quiz.legacyMetadata.data;
      const settings = isJsonObjectValue(nestedMetadata) ? nestedMetadata.settings : undefined;
      return {
        documentId: quiz.id,
        title: quiz.title,
        ...stats,
        slideTypes: analyzeSlides(quiz.slides).types.map(({ type, count }) => ({ type, count })),
        settingsFields: isJsonObjectValue(settings) ? Object.keys(settings).sort() : [],
        mediaDomains: [...new Set(quiz.slides.flatMap((slide) => slide.media.flatMap(
          (media) => media.domain === undefined ? [] : [media.domain],
        )))].sort(),
      };
    }),
    structure: analyzeSlides(allSlides),
    unknownTypes: [...new Set(allSlides.filter((slide) => statusForType(slide.sourceType) === 'UNKNOWN')
      .map((slide) => slide.sourceType))].sort(),
    partiallyMappedTypes: [...new Set(allSlides.filter((slide) => statusForType(slide.sourceType) === 'PARTIALLY_MAPPED')
      .map((slide) => slide.sourceType))].sort(),
    unknownFields: [...new Set(allSlides.flatMap((slide) => slide.unknownFields))].sort(),
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(inventory, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  await rename(temporaryPath, outputPath);
  console.log(`Wrote sanitized structural inventory for ${quizzes.length} quizzes and ${allSlides.length} slides.`);
}

void createInventory().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Unknown inventory failure.';
  console.error(JSON.stringify({ status: 'FAILED', error: name, message }, null, 2));
  process.exitCode = 1;
});
