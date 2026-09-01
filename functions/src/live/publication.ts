import { LiveSessionError } from './errors.js';
import type {
  PrivateLiveSession,
  PrivateSlide,
  PublicLiveSession,
  PublicMedia,
  PublicPresentation,
} from './types.js';

const maximumPublicTextLength = 20_000;
const publicMediaKinds = new Set<PublicMedia['kind']>(['image', 'audio', 'video', 'unknown']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function publicText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, maximumPublicTextLength);
}

function publicNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeOptions(options: readonly unknown[]): readonly string[] {
  return options.flatMap((option) => {
    if (typeof option === 'string') return [option.slice(0, maximumPublicTextLength)];
    if (typeof option === 'number' && Number.isFinite(option)) return [String(option)];
    if (typeof option === 'boolean') return [String(option)];
    return [];
  });
}

function sanitizePresentation(value: unknown): PublicPresentation {
  if (!isObject(value)) return {};
  const result: PublicPresentation = {
    ...(publicNumber(value.videoStart) === undefined ? {} : { videoStart: publicNumber(value.videoStart) }),
    ...(publicNumber(value.videoEnd) === undefined ? {} : { videoEnd: publicNumber(value.videoEnd) }),
    ...(publicNumber(value.audioTrigger) === undefined ? {} : { audioTrigger: publicNumber(value.audioTrigger) }),
    ...(publicNumber(value.backgroundOverlay) === undefined ? {} : { backgroundOverlay: publicNumber(value.backgroundOverlay) }),
    ...(publicNumber(value.answerOverlay) === undefined ? {} : { answerOverlay: publicNumber(value.answerOverlay) }),
    ...(publicText(value.sourceQuestionNumber) === undefined ? {} : { sourceQuestionNumber: publicText(value.sourceQuestionNumber) }),
  };
  return result;
}

function mediaSource(value: Record<string, unknown>): string | undefined {
  return publicText(value.url) ?? publicText(value.value);
}

function sanitizeMedia(media: readonly unknown[]): readonly PublicMedia[] {
  return media.flatMap((item) => {
    if (!isObject(item) || (item.role !== 'prompt' && item.role !== 'background')) return [];
    const source = mediaSource(item);
    const kind = publicMediaKinds.has(item.kind as PublicMedia['kind'])
      ? item.kind as PublicMedia['kind']
      : 'unknown';
    return source === undefined ? [] : [{ role: item.role, kind, source }];
  });
}

function answerImage(media: readonly unknown[]): string | undefined {
  for (const item of media) {
    if (!isObject(item) || item.role !== 'answer') continue;
    const source = mediaSource(item);
    if (source !== undefined) return source;
  }
  return undefined;
}

export function displayAnswer(value: unknown): string | undefined {
  let rendered: string | undefined;
  if (typeof value === 'string') rendered = value;
  if (typeof value === 'number' && Number.isFinite(value)) rendered = String(value);
  if (typeof value === 'boolean') rendered = String(value);
  if (Array.isArray(value) && value.length > 0 && value.every((item) => (
    typeof item === 'string'
    || typeof item === 'boolean'
    || (typeof item === 'number' && Number.isFinite(item))
  ))) {
    rendered = value.map(String).join(', ');
  }
  if (rendered === undefined || rendered.trim().length === 0) return undefined;
  return rendered.slice(0, maximumPublicTextLength);
}

export function buildPublicSessionState(
  session: PrivateLiveSession,
  slide?: PrivateSlide,
): PublicLiveSession {
  const base: PublicLiveSession = {
    sessionId: session.sessionId,
    status: session.status,
    quizTitle: session.quizTitle,
    slidePosition: session.currentSlidePosition,
    answerRevealed: session.answerRevealed,
    revision: session.revision,
    updatedAt: session.updatedAt,
  };

  if (session.status !== 'active') return { ...base, answerRevealed: false };
  if (slide === undefined || slide.position !== session.currentSlidePosition) {
    throw new LiveSessionError('failed-precondition', 'Active session slide is unavailable.');
  }

  const title = publicText(slide.title) ?? '';
  const text = publicText(slide.text) ?? '';
  const result: PublicLiveSession = {
    ...base,
    slideKind: publicText(slide.kind) ?? 'legacy',
    title,
    text,
    options: sanitizeOptions(slide.options),
    media: sanitizeMedia(slide.media),
    presentation: sanitizePresentation(slide.presentation),
  };

  if (!session.answerRevealed) return result;
  const revealedAnswer = displayAnswer(slide.correctAnswer);
  if (revealedAnswer === undefined) {
    throw new LiveSessionError('failed-precondition', 'This slide has no displayable answer.');
  }
  const image = answerImage(slide.media);
  return {
    ...result,
    answerRevealed: true,
    revealedAnswer,
    ...(image === undefined ? {} : { answerImage: image }),
  };
}
