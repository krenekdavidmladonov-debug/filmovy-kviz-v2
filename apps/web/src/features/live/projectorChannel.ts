import type { PublicLiveState } from './types';

export type ProjectorChannelMessage =
  | { readonly type: 'public-state'; readonly state: PublicLiveState }
  | { readonly type: 'playback-finished'; readonly sessionId: string; readonly mediaGeneration: number };

export interface ProjectorChannel {
  postMessage(message: unknown): void;
  setMessageHandler(handler: (data: unknown) => void): void;
  close(): void;
}

export function sanitizedChannelState(state: PublicLiveState): PublicLiveState {
  return {
    sessionId: state.sessionId,
    quizTitle: state.quizTitle,
    status: state.status,
    slidePosition: state.slidePosition,
    ...(state.slideKind === undefined ? {} : { slideKind: state.slideKind }),
    ...(state.title === undefined ? {} : { title: state.title }),
    ...(state.text === undefined ? {} : { text: state.text }),
    options: [...state.options],
    media: state.media.map((item) => ({ role: item.role, kind: item.kind, source: item.source })),
    presentation: {
      ...(state.presentation.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.presentation.backgroundOverlay }),
      ...(state.presentation.answerOverlay === undefined ? {} : { answerOverlay: state.presentation.answerOverlay }),
      ...(state.presentation.sourceQuestionNumber === undefined ? {} : { sourceQuestionNumber: state.presentation.sourceQuestionNumber }),
    },
    presentationMode: state.presentationMode,
    renderMode: state.renderMode,
    mediaCommand: state.mediaCommand,
    mediaGeneration: state.mediaGeneration,
    introGeneration: state.introGeneration,
    ...(state.questionNumber === undefined ? {} : { questionNumber: state.questionNumber }),
    ...(state.questionCount === undefined ? {} : { questionCount: state.questionCount }),
    ...(state.backgroundImage === undefined ? {} : { backgroundImage: state.backgroundImage }),
    ...(state.questionImage === undefined ? {} : { questionImage: state.questionImage }),
    ...(state.mediaSource === undefined ? {} : { mediaSource: state.mediaSource }),
    ...(state.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.backgroundOverlay }),
    ...(state.clipStartSeconds === undefined ? {} : { clipStartSeconds: state.clipStartSeconds }),
    ...(state.clipEndSeconds === undefined ? {} : { clipEndSeconds: state.clipEndSeconds }),
    answerRevealed: state.answerRevealed,
    ...(state.revealedAnswer === undefined ? {} : { revealedAnswer: state.revealedAnswer }),
    ...(state.answerImage === undefined ? {} : { answerImage: state.answerImage }),
    revision: state.revision,
  };
}

export function projectorChannelName(sessionId: string): string {
  return `filmovy-kviz-projector-${sessionId}`;
}

export function openProjectorChannel(sessionId: string): ProjectorChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  const channel = new BroadcastChannel(projectorChannelName(sessionId));
  return {
    postMessage: (message) => channel.postMessage(message),
    setMessageHandler: (handler) => { channel.onmessage = (event) => handler(event.data as unknown); },
    close: () => channel.close(),
  };
}

export function broadcastPublicState(channel: ProjectorChannel | undefined, state: PublicLiveState): void {
  channel?.postMessage({ type: 'public-state', state: sanitizedChannelState(state) } satisfies ProjectorChannelMessage);
}

export function broadcastPlaybackFinished(channel: ProjectorChannel | undefined, sessionId: string, mediaGeneration: number): void {
  channel?.postMessage({ type: 'playback-finished', sessionId, mediaGeneration } satisfies ProjectorChannelMessage);
}

export function isProjectorChannelMessage(value: unknown): value is ProjectorChannelMessage {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'playback-finished') {
    return typeof message.sessionId === 'string' && Number.isInteger(message.mediaGeneration);
  }
  if (message.type !== 'public-state' || message.state === null || typeof message.state !== 'object') return false;
  const state = message.state as Record<string, unknown>;
  return typeof state.sessionId === 'string' && typeof state.revision === 'number';
}
