import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeV1Library } from './normalize.js';
import { readV1Library } from './read.js';
import type { JsonValue, NormalizedMedia, NormalizedSlide } from './types.js';

const inputPath = path.resolve('.local-data/v1-export/library.json');
const outputPath = path.resolve('.local-data/v1-analysis/behavior-inventory.json');

type Counter = Map<string, number>;

function increment(counter: Counter, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function ordered(counter: Counter, key = 'value'): Record<string, string | number>[] {
  return [...counter.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ [key]: value, count }));
}

function shape(value: JsonValue | undefined): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function meaningful(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some(meaningful);
  return Object.values(value).some(meaningful);
}

function numeric(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function summarizeFields(slides: readonly NormalizedSlide[]) {
  const names = [...new Set(slides.flatMap((slide) => Object.keys(slide.raw)))].sort();
  return names.map((field) => {
    const shapes: Counter = new Map();
    let presentCount = 0;
    let meaningfulCount = 0;
    for (const slide of slides) {
      const value = slide.raw[field];
      if (value !== undefined) {
        presentCount += 1;
        increment(shapes, shape(value));
      }
      if (meaningful(value)) meaningfulCount += 1;
    }
    return {
      field,
      presentCount,
      meaningfulCount,
      alwaysPresent: presentCount === slides.length,
      alwaysMeaningful: meaningfulCount === slides.length,
      shapes: ordered(shapes, 'shape'),
    };
  });
}

const variantFields = [
  'title', 'text', 'note', 'roundHeader', 'options', 'optionsStr', 'correct', 'correctAnswer',
  'mediaRaw', 'media', 'bgImage', 'bgRaw', 'answerImg', 'bgOverlay', 'answerOverlay',
  'audioTrigger', 'videoStart', 'videoEnd', 'qCount', 'recapOverrides', 'id',
] as const;

function summarizeVariants(slides: readonly NormalizedSlide[]) {
  const variants: Counter = new Map();
  for (const slide of slides) {
    const fields = variantFields.filter((field) => meaningful(slide.raw[field]));
    increment(variants, fields.length === 0 ? '<no-meaningful-fields>' : fields.join(','));
  }
  return ordered(variants, 'meaningfulFields')
    .sort((left, right) => Number(right.count) - Number(left.count)
      || String(left.meaningfulFields).localeCompare(String(right.meaningfulFields)));
}

function summarizeOptions(slides: readonly NormalizedSlide[]) {
  const lengths: Counter = new Map();
  const rawSources: Counter = new Map();
  const itemShapes: Counter = new Map();
  const contentQuality: Counter = new Map();
  const sourceAgreement: Counter = new Map();
  for (const slide of slides) {
    increment(lengths, String(slide.options.length));
    for (const option of slide.options) increment(itemShapes, shape(option));
    const nonEmptyItems = slide.options.filter(meaningful).length;
    increment(contentQuality, slide.options.length === 0
      ? 'no-items'
      : nonEmptyItems === 0
        ? 'all-items-empty'
        : nonEmptyItems === slide.options.length ? 'all-items-non-empty' : 'mixed-empty-items');
    const sources = [
      Array.isArray(slide.raw.options) && slide.raw.options.length > 0 ? 'options' : '',
      typeof slide.raw.optionsStr === 'string' && slide.raw.optionsStr.trim() !== '' ? 'optionsStr' : '',
    ].filter(Boolean);
    increment(rawSources, sources.length === 0 ? '<none>' : sources.join('+'));
    if (typeof slide.raw.optionsStr === 'string' && slide.raw.optionsStr.trim() !== '') {
      const fromString = slide.raw.optionsStr.split(/\r?\n|\|/u).map((option) => option.trim()).filter(Boolean);
      const fromArray = Array.isArray(slide.raw.options)
        ? slide.raw.options.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
        : [];
      increment(sourceAgreement, JSON.stringify(fromArray) === JSON.stringify(fromString) ? 'equivalent' : 'different');
    }
  }
  return {
    lengths: ordered(lengths, 'length'),
    rawSources: ordered(rawSources, 'source'),
    itemShapes: ordered(itemShapes, 'shape'),
    contentQuality: ordered(contentQuality, 'quality'),
    optionsAndOptionsStrAgreement: ordered(sourceAgreement, 'comparison'),
  };
}

function isYoutube(media: NormalizedMedia): boolean {
  return media.domain === 'youtube.com' || media.domain === 'www.youtube.com'
    || media.domain === 'm.youtube.com' || media.domain === 'youtu.be'
    || media.domain === 'www.youtube-nocookie.com';
}

function mediaCategory(media: NormalizedMedia): string {
  if (isYoutube(media)) return `youtube-${media.kind}`;
  if (media.sourceField === 'media.src' && typeof media.value === 'string'
    && /^[A-Za-z0-9_-]{11}$/u.test(media.value)) return `youtube-${media.kind}-legacy-id`;
  if (media.validUrl === true && media.kind === 'image') return 'direct-image-url';
  if (media.validUrl === true && media.kind === 'audio') return 'direct-audio-url';
  if (media.validUrl === true && media.kind === 'video') return 'direct-video-url';
  if (media.validUrl === true) return 'other-external-provider';
  return 'ambiguous-or-legacy';
}

function summarizeMedia(slides: readonly NormalizedSlide[]) {
  const categories: Counter = new Map();
  const kinds: Counter = new Map();
  const roles: Counter = new Map();
  const sourceFields: Counter = new Map();
  const bySlideType: Counter = new Map();
  let youtubeAudioSlides = 0;
  let youtubeVideoSlides = 0;
  let externalImageSlides = 0;
  let answerImageSlides = 0;
  const rawMediaObjectKeys: Counter = new Map();
  const rawMediaObjectFieldShapes: Counter = new Map();
  const rawMediaSourceShapes: Counter = new Map();
  const rawMediaTypeValues: Counter = new Map();
  for (const slide of slides) {
    for (const media of slide.media) {
      increment(categories, mediaCategory(media));
      increment(kinds, media.kind);
      increment(roles, media.role);
      increment(sourceFields, media.sourceField);
      increment(bySlideType, `${slide.sourceType}|${media.kind}|${media.role}|${mediaCategory(media)}`);
    }
    if (slide.media.some((media) => media.kind === 'audio' && isYoutube(media))) youtubeAudioSlides += 1;
    if (slide.media.some((media) => media.kind === 'video' && isYoutube(media))) youtubeVideoSlides += 1;
    if (slide.media.some((media) => media.kind === 'image' && media.validUrl === true)) externalImageSlides += 1;
    if (slide.media.some((media) => media.role === 'answer')) answerImageSlides += 1;
    const rawMedia = slide.raw.media;
    if (rawMedia !== null && !Array.isArray(rawMedia) && typeof rawMedia === 'object') {
      increment(rawMediaObjectKeys, Object.keys(rawMedia).sort().join(',') || '<empty-object>');
      for (const [field, value] of Object.entries(rawMedia)) {
        increment(rawMediaObjectFieldShapes, `${field}|${shape(value)}`);
      }
      const source = rawMedia.src;
      if (typeof source === 'string') {
        let sourceShape = 'other-string';
        if (source.trim() === '') sourceShape = 'empty-string';
        else if (/^https?:\/\//iu.test(source)) sourceShape = 'http-url';
        else if (/^[A-Za-z0-9_-]{11}$/u.test(source)) sourceShape = 'youtube-id-shaped';
        increment(rawMediaSourceShapes, sourceShape);
      } else {
        increment(rawMediaSourceShapes, shape(source));
      }
      if (typeof rawMedia.type === 'string') {
        const safeType = rawMedia.type === 'image' || rawMedia.type === 'youtube'
          ? rawMedia.type
          : rawMedia.type.trim() === '' ? '<empty>' : '<other>';
        increment(rawMediaTypeValues, safeType);
      }
    }
  }
  return {
    totalReferences: slides.reduce((sum, slide) => sum + slide.media.length, 0),
    categories: ordered(categories, 'category'),
    kinds: ordered(kinds, 'kind'),
    roles: ordered(roles, 'role'),
    sourceFields: ordered(sourceFields, 'sourceField'),
    bySlideType: ordered(bySlideType, 'signature'),
    youtubeAudioSlides,
    youtubeVideoSlides,
    externalImageSlides,
    answerImageSlides,
    rawMediaObjects: {
      keySignatures: ordered(rawMediaObjectKeys, 'fields'),
      fieldShapes: ordered(rawMediaObjectFieldShapes, 'fieldShape'),
      sourceShapes: ordered(rawMediaSourceShapes, 'sourceShape'),
      typeValues: ordered(rawMediaTypeValues),
    },
  };
}

function summarizeNumericField(slides: readonly NormalizedSlide[], field: string) {
  const rawShapes: Counter = new Map();
  const values: Counter = new Map();
  const parsed: number[] = [];
  let missing = 0;
  for (const slide of slides) {
    const value = slide.raw[field];
    increment(rawShapes, shape(value));
    const numberValue = numeric(value);
    if (numberValue === undefined) {
      missing += 1;
      continue;
    }
    parsed.push(numberValue);
    increment(values, String(numberValue));
  }
  return {
    rawShapes: ordered(rawShapes, 'shape'),
    parsedCount: parsed.length,
    missingOrInvalidCount: missing,
    zeroCount: parsed.filter((value) => value === 0).length,
    positiveCount: parsed.filter((value) => value > 0).length,
    negativeCount: parsed.filter((value) => value < 0).length,
    min: parsed.length === 0 ? null : Math.min(...parsed),
    max: parsed.length === 0 ? null : Math.max(...parsed),
    values: ordered(values),
  };
}

function summarizeTiming(slides: readonly NormalizedSlide[]) {
  const byType = Object.fromEntries([...new Set(slides.map((slide) => slide.sourceType))].sort().map((type) => {
    const selected = slides.filter((slide) => slide.sourceType === type);
    let startGreaterThanEnd = 0;
    let positiveStartMissingEnd = 0;
    let missingStartPositiveEnd = 0;
    let positiveSegment = 0;
    const durations: number[] = [];
    for (const slide of selected) {
      const start = numeric(slide.raw.videoStart);
      const end = numeric(slide.raw.videoEnd);
      if (start !== undefined && end !== undefined && start > end) startGreaterThanEnd += 1;
      if ((start ?? 0) > 0 && (end === undefined || end === 0)) positiveStartMissingEnd += 1;
      if ((start === undefined || start === 0) && (end ?? 0) > 0) missingStartPositiveEnd += 1;
      if ((start ?? 0) >= 0 && (end ?? 0) > (start ?? 0)) {
        positiveSegment += 1;
        durations.push((end ?? 0) - (start ?? 0));
      }
    }
    return [type, {
      count: selected.length,
      videoStart: summarizeNumericField(selected, 'videoStart'),
      videoEnd: summarizeNumericField(selected, 'videoEnd'),
      audioTrigger: summarizeNumericField(selected, 'audioTrigger'),
      startGreaterThanEnd,
      positiveStartMissingEnd,
      missingStartPositiveEnd,
      positiveSegment,
      segmentDuration: {
        min: durations.length === 0 ? null : Math.min(...durations),
        max: durations.length === 0 ? null : Math.max(...durations),
        average: durations.length === 0 ? null : Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)),
      },
    }];
  }));
  return {
    overall: {
      videoStart: summarizeNumericField(slides, 'videoStart'),
      videoEnd: summarizeNumericField(slides, 'videoEnd'),
      audioTrigger: summarizeNumericField(slides, 'audioTrigger'),
    },
    byType,
  };
}

function summarizeImagePresentation(slides: readonly NormalizedSlide[]) {
  const relations: Counter = new Map();
  const backgroundByType: Counter = new Map();
  const answerByType: Counter = new Map();
  const overlays: Counter = new Map();
  for (const slide of slides) {
    const flags = ['bgImage', 'bgRaw', 'mediaRaw', 'media', 'answerImg']
      .filter((field) => meaningful(slide.raw[field]));
    increment(relations, flags.length === 0 ? '<none>' : flags.join('+'));
    if (meaningful(slide.raw.bgImage)) increment(backgroundByType, slide.sourceType);
    if (meaningful(slide.raw.answerImg)) increment(answerByType, slide.sourceType);
    const background = numeric(slide.raw.bgOverlay);
    const answer = numeric(slide.raw.answerOverlay);
    increment(overlays, `background:${background ?? 'missing'}|answer:${answer ?? 'missing'}`);
  }
  return {
    backgroundImageSlides: slides.filter((slide) => meaningful(slide.raw.bgImage)).length,
    backgroundRawSlides: slides.filter((slide) => meaningful(slide.raw.bgRaw)).length,
    answerImageSlides: slides.filter((slide) => meaningful(slide.raw.answerImg)).length,
    backgroundImageWithPositiveOverlay: slides.filter((slide) => meaningful(slide.raw.bgImage) && (numeric(slide.raw.bgOverlay) ?? 0) > 0).length,
    backgroundImageWithoutPositiveOverlay: slides.filter((slide) => meaningful(slide.raw.bgImage) && (numeric(slide.raw.bgOverlay) ?? 0) <= 0).length,
    positiveOverlayWithoutBackgroundImage: slides.filter((slide) => !meaningful(slide.raw.bgImage) && (numeric(slide.raw.bgOverlay) ?? 0) > 0).length,
    answerImageWithPositiveOverlay: slides.filter((slide) => meaningful(slide.raw.answerImg) && (numeric(slide.raw.answerOverlay) ?? 0) > 0).length,
    relations: ordered(relations, 'fields'),
    backgroundByType: ordered(backgroundByType, 'type'),
    answerByType: ordered(answerByType, 'type'),
    overlayCombinations: ordered(overlays, 'combination'),
    backgroundOverlay: summarizeNumericField(slides, 'bgOverlay'),
    answerOverlay: summarizeNumericField(slides, 'answerOverlay'),
    overlayByType: Object.fromEntries([...new Set(slides.map((slide) => slide.sourceType))].sort().map((type) => {
      const selected = slides.filter((slide) => slide.sourceType === type);
      return [type, {
        backgroundOverlay: summarizeNumericField(selected, 'bgOverlay'),
        answerOverlay: summarizeNumericField(selected, 'answerOverlay'),
      }];
    })),
  };
}

function summarizeLegacyControls(slides: readonly NormalizedSlide[]) {
  const questionNumberPatterns: Counter = new Map();
  const questionNumberMasks: Counter = new Map();
  const questionNumbers: number[] = [];
  const questionNumberLengths: number[] = [];
  const recapLengths: Counter = new Map();
  const recapItemShapes: Counter = new Map();
  const recapItemKeySignatures: Counter = new Map();
  const recapItemFieldShapes: Counter = new Map();
  for (const slide of slides) {
    const questionNumber = slide.raw.qCount;
    if (typeof questionNumber !== 'string' || questionNumber.trim() === '') {
      increment(questionNumberPatterns, 'empty');
    } else if (/^\d+$/u.test(questionNumber.trim())) {
      increment(questionNumberPatterns, 'integer-string');
      questionNumbers.push(Number(questionNumber));
    } else {
      increment(questionNumberPatterns, 'other-string');
      const trimmed = questionNumber.trim();
      questionNumberLengths.push(trimmed.length);
      const mask = trimmed.replace(/\d+/gu, '#').replace(/\p{L}+/gu, 'L');
      increment(questionNumberMasks, mask);
    }
    if (Array.isArray(slide.raw.recapOverrides)) {
      increment(recapLengths, String(slide.raw.recapOverrides.length));
      for (const item of slide.raw.recapOverrides) {
        increment(recapItemShapes, shape(item));
        if (item !== null && !Array.isArray(item) && typeof item === 'object') {
          increment(recapItemKeySignatures, Object.keys(item).sort().join(',') || '<empty-object>');
          for (const [field, value] of Object.entries(item)) {
            increment(recapItemFieldShapes, `${field}|${shape(value)}`);
          }
        }
      }
    }
  }
  return {
    qCount: {
      patterns: ordered(questionNumberPatterns, 'pattern'),
      structuralMasks: ordered(questionNumberMasks, 'mask'),
      nonEmptyLengthMin: questionNumberLengths.length === 0 ? null : Math.min(...questionNumberLengths),
      nonEmptyLengthMax: questionNumberLengths.length === 0 ? null : Math.max(...questionNumberLengths),
      numericMin: questionNumbers.length === 0 ? null : Math.min(...questionNumbers),
      numericMax: questionNumbers.length === 0 ? null : Math.max(...questionNumbers),
    },
    recapOverrides: {
      slideCount: slides.filter((slide) => Array.isArray(slide.raw.recapOverrides)).length,
      lengths: ordered(recapLengths, 'length'),
      itemShapes: ordered(recapItemShapes, 'shape'),
      itemKeySignatures: ordered(recapItemKeySignatures, 'fields'),
      itemFieldShapes: ordered(recapItemFieldShapes, 'fieldShape'),
    },
  };
}

async function main(): Promise<void> {
  const snapshot = await readV1Library(inputPath);
  const quizzes = normalizeV1Library(snapshot);
  const slides = quizzes.flatMap((quiz) => quiz.slides);
  const slideTypes = [...new Set(slides.map((slide) => slide.sourceType))].sort();
  const report = {
    schemaVersion: 1,
    source: '.local-data/v1-export/library.json',
    scope: { quizzes: quizzes.length, slides: slides.length, types: slideTypes.length },
    types: Object.fromEntries(slideTypes.map((type) => {
      const selected = slides.filter((slide) => slide.sourceType === type);
      return [type, {
        count: selected.length,
        fields: summarizeFields(selected),
        meaningfulVariants: summarizeVariants(selected),
        options: summarizeOptions(selected),
      }];
    })),
    media: summarizeMedia(slides),
    timing: summarizeTiming(slides),
    images: summarizeImagePresentation(slides),
    legacyControls: summarizeLegacyControls(slides),
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  await rename(temporaryPath, outputPath);
  console.log(`Wrote sanitized behavior inventory for ${quizzes.length} quizzes, ${slides.length} slides, and ${slideTypes.length} types.`);
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Unknown behavior inventory failure.';
  console.error(JSON.stringify({ status: 'FAILED', error: name, message }, null, 2));
  process.exitCode = 1;
});
