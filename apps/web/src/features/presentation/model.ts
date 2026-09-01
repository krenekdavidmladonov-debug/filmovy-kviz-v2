import type {
  MediaPlaybackCommand,
  NormalizedSlideRenderModel,
  SlideContentKind,
  SlideMediaReference,
  SlideRenderInput,
  SlideRenderMode,
} from './types';

const questionKinds = new Set(['question', 'text', 'classic']);
const imageKinds = new Set(['image', 'picture', 'photo']);
const audioKinds = new Set(['audio', 'music']);
const videoKinds = new Set(['video', 'youtube']);
const roundKinds = new Set(['round', 'roundheader', 'round-header', 'section']);

export const defaultRules = [
  'Hrajte fér.',
  'Během otázek nepoužívejte mobil ani internet.',
  'Respektujte organizátory a ostatní týmy.',
  'Užijte si filmový večer.',
] as const;

export function generatedAgendaOptions(rounds: readonly { readonly title: string }[]): readonly string[] {
  return rounds.map((round, index) => `${index + 1}. KOLO${round.title.trim() === '' ? '' : ` – ${round.title.trim()}`}`);
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clampOverlay(value: unknown): number {
  const normalized = finiteNonNegative(value);
  return normalized === undefined ? 0 : Math.min(100, normalized);
}

function mediaSource(
  media: readonly SlideMediaReference[],
  role: string,
  kind?: string,
): string | undefined {
  return media.find((item) => item.role === role && (kind === undefined || item.kind === kind) && item.source !== '')?.source;
}

function contentKind(kind: string): SlideContentKind {
  const normalized = kind.toLowerCase();
  if (questionKinds.has(normalized)) return 'question';
  if (normalized === 'free') return 'free';
  if (imageKinds.has(normalized)) return 'image';
  if (audioKinds.has(normalized)) return 'audio';
  if (videoKinds.has(normalized)) return 'video';
  if (normalized === 'pl') return 'pl';
  if (normalized === 'intro') return 'intro';
  if (roundKinds.has(normalized)) return 'roundIntro';
  if (normalized === 'agenda') return 'agenda';
  if (normalized === 'rules') return 'rules';
  if (normalized === 'recap') return 'recap';
  if (normalized === 'end') return 'end';
  if (normalized === 'title' || normalized === 'info') return 'info';
  return 'legacy';
}

function modeForKind(kind: SlideContentKind): SlideRenderMode {
  if (kind === 'recap') return 'recap';
  if (kind === 'intro' || kind === 'roundIntro') return 'roundIntro';
  if (kind === 'agenda') return 'agenda';
  if (kind === 'rules') return 'rules';
  if (kind === 'end') return 'end';
  return 'question';
}

function questionNumbers(input: SlideRenderInput): { questionNumber?: number; questionCount?: number } {
  const explicitNumber = finiteNonNegative(input.questionNumber);
  const explicitCount = finiteNonNegative(input.questionCount);
  if (explicitNumber !== undefined && explicitNumber >= 1 && Number.isInteger(explicitNumber)
    && explicitCount !== undefined && explicitCount >= explicitNumber && Number.isInteger(explicitCount)) {
    return { questionNumber: explicitNumber, questionCount: explicitCount };
  }
  const source = input.presentation?.sourceQuestionNumber;
  const match = typeof source === 'string' ? /^\s*(\d+)\s*\/\s*(\d+)\s*$/u.exec(source) : null;
  if (match === null) return {};
  const questionNumber = Number(match[1]);
  const questionCount = Number(match[2]);
  return questionNumber >= 1 && questionCount >= questionNumber ? { questionNumber, questionCount } : {};
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function youtubeVideoId(source: string): string | undefined {
  const trimmed = source.trim();
  if (/^[\w-]{11}$/u.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/u.test(id) ? id : undefined;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const candidate = parsed.searchParams.get('v')
        ?? (['embed', 'shorts', 'live'].includes(pathParts[0] ?? '') ? pathParts[1] : undefined);
      return candidate && /^[\w-]{11}$/u.test(candidate) ? candidate : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildSlideRenderModel(
  input: SlideRenderInput,
  requestedMode?: SlideRenderMode,
): NormalizedSlideRenderModel {
  const kind = contentKind(input.kind);
  const numbers = questionNumbers(input);
  const presentationStart = finiteNonNegative(input.presentation?.clipStartSeconds)
    ?? finiteNonNegative(input.presentation?.videoStart);
  const presentationEnd = finiteNonNegative(input.presentation?.clipEndSeconds)
    ?? finiteNonNegative(input.presentation?.videoEnd);
  const clipStartSeconds = finiteNonNegative(input.clipStartSeconds) ?? presentationStart ?? 0;
  const endCandidate = finiteNonNegative(input.clipEndSeconds) ?? presentationEnd;
  const clipEndSeconds = endCandidate !== undefined && endCandidate > clipStartSeconds ? endCandidate : undefined;
  const promptImage = mediaSource(input.media, 'prompt', 'image');
  const promptAudio = mediaSource(input.media, 'prompt', 'audio');
  const promptVideo = mediaSource(input.media, 'prompt', 'video');
  const fallbackMedia = kind === 'audio' ? promptAudio : kind === 'video' ? promptVideo : undefined;
  const backgroundOverlay = clampOverlay(input.backgroundOverlay ?? input.presentation?.backgroundOverlay);
  const isQuestionLike = ['question', 'free', 'image', 'audio', 'video', 'pl'].includes(kind);
  return {
    contentKind: kind,
    renderMode: requestedMode ?? modeForKind(kind),
    title: input.title,
    text: input.text,
    options: input.options,
    ...numbers,
    ...(input.backgroundImage ?? mediaSource(input.media, 'background', 'image')
      ? { backgroundImage: input.backgroundImage ?? mediaSource(input.media, 'background', 'image') }
      : {}),
    ...(input.questionImage ?? (kind === 'image' ? promptImage : undefined)
      ? { questionImage: input.questionImage ?? promptImage }
      : {}),
    ...(input.answerImage ?? mediaSource(input.media, 'answer', 'image')
      ? { answerImage: input.answerImage ?? mediaSource(input.media, 'answer', 'image') }
      : {}),
    ...(input.mediaSource ?? fallbackMedia ? { mediaSource: input.mediaSource ?? fallbackMedia } : {}),
    backgroundOverlay,
    clipStartSeconds,
    ...(clipEndSeconds === undefined ? {} : { clipEndSeconds }),
    ...(input.revealedAnswer === undefined ? {} : { revealedAnswer: input.revealedAnswer }),
    isQuestionLike,
    isLegacyPl: kind === 'pl',
  };
}

export function formatPlAnswer(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('cs-CZ');
  if (['true', '1', 'ano', 'pravda'].includes(normalized)) return 'PRAVDA';
  if (['false', '0', 'ne', 'lež', 'lez'].includes(normalized)) return 'LEŽ';
  return value;
}

export interface ProjectorMediaPlan {
  readonly mountPlayer: boolean;
  readonly showQuestion: boolean;
  readonly vinylPlaying: boolean;
  readonly startSeconds: number;
  readonly endSeconds?: number;
}

export function projectorMediaPlan(
  model: NormalizedSlideRenderModel,
  command: MediaPlaybackCommand,
  locallyFinished = false,
): ProjectorMediaPlan {
  const playing = (command === 'play' || command === 'replay') && !locallyFinished;
  if (model.renderMode === 'recap' && (model.contentKind === 'audio' || model.contentKind === 'video')) {
    return { mountPlayer: model.mediaSource !== undefined, showQuestion: true, vinylPlaying: false, startSeconds: 0 };
  }
  if (model.contentKind === 'audio') {
    return { mountPlayer: false, showQuestion: true, vinylPlaying: playing, startSeconds: model.clipStartSeconds,
      ...(model.clipEndSeconds === undefined ? {} : { endSeconds: model.clipEndSeconds }) };
  }
  if (model.contentKind === 'video') {
    return { mountPlayer: playing && model.mediaSource !== undefined, showQuestion: !playing, vinylPlaying: false,
      startSeconds: model.clipStartSeconds,
      ...(model.clipEndSeconds === undefined ? {} : { endSeconds: model.clipEndSeconds }) };
  }
  return { mountPlayer: false, showQuestion: true, vinylPlaying: false, startSeconds: 0 };
}
