export type LiveSessionStatus = 'waiting' | 'active' | 'ended';
export type LivePresentationMode = 'slide' | 'recap';
export type LiveRenderMode = 'question' | 'recap' | 'roundIntro' | 'agenda' | 'rules' | 'end';
export type LiveMediaCommand = 'idle' | 'play' | 'stop' | 'replay' | 'finished' | 'error';
export type LiveMediaPlaybackState = 'idle' | 'preparing' | 'ready' | 'playing' | 'finished' | 'error';

export interface PrivateLiveSession {
  readonly sessionId: string;
  readonly eventId?: string;
  readonly snapshotId?: string;
  readonly interimResults?: { versionId: string; roundNumber: number; page: number; pageCount: number };
  readonly finalReveal?: FinalRevealState;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly slideCount: number;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly currentSlideId?: string;
  readonly answerRevealed: boolean;
  readonly presentationMode: LivePresentationMode;
  readonly recapQuestionPosition?: number;
  readonly recapQuestionId?: string;
  readonly mediaCommand: LiveMediaCommand;
  readonly mediaPlaybackState: LiveMediaPlaybackState;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly revision: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: unknown;
  readonly startedAt: unknown;
  readonly endedAt: unknown;
  readonly updatedAt: unknown;
}

export interface PrivateSlide {
  readonly id: string;
  readonly position: number;
  readonly kind: string;
  readonly isQuestion: boolean;
  readonly roundId?: string;
  readonly roundTitle?: string;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly title: string;
  readonly text: string;
  readonly options: readonly unknown[];
  readonly media: readonly unknown[];
  readonly presentation: unknown;
  readonly backgroundImage?: unknown;
  readonly questionImage?: unknown;
  readonly answerImage?: unknown;
  readonly imageLayout?: unknown;
  readonly answerExplanation?: unknown;
  readonly mediaSource?: unknown;
  readonly backgroundOverlay?: unknown;
  readonly clipStartSeconds?: unknown;
  readonly clipEndSeconds?: unknown;
  readonly correctAnswer?: unknown;
  readonly moderatorNote?: unknown;
  readonly legacy?: unknown;
}

export interface PublicMedia {
  readonly role: 'prompt' | 'background';
  readonly kind: 'image' | 'audio' | 'video' | 'unknown';
  readonly source: string;
}

export interface PublicPresentation {
  readonly backgroundOverlay?: number;
  readonly answerOverlay?: number;
  readonly sourceQuestionNumber?: string;
}

export interface PublicLiveSession {
  readonly sessionId: string;
  readonly status: LiveSessionStatus;
  readonly quizTitle: string;
  readonly slidePosition: number;
  readonly answerRevealed: boolean;
  readonly presentationMode: LivePresentationMode;
  readonly renderMode: LiveRenderMode;
  readonly mediaCommand: LiveMediaCommand;
  readonly mediaPlaybackState: LiveMediaPlaybackState;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly revision: number;
  readonly updatedAt: unknown;
  readonly slideKind?: string;
  readonly title?: string;
  readonly text?: string;
  readonly options?: readonly string[];
  readonly media?: readonly PublicMedia[];
  readonly presentation?: PublicPresentation;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number;
  readonly clipStartSeconds?: number;
  readonly clipEndSeconds?: number;
  readonly recapQuestionPosition?: number;
  readonly revealedAnswer?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
}

export type LiveSessionAction =
  | { readonly type: 'go-to-slide'; readonly position: number; readonly slideId: string }
  | { readonly type: 'next-slide'; readonly slideId: string }
  | { readonly type: 'previous-slide'; readonly slideId: string }
  | { readonly type: 'reveal-answer' }
  | { readonly type: 'hide-answer' }
  | { readonly type: 'select-recap-question'; readonly position: number; readonly slideId: string }
  | { readonly type: 'play-media' }
  | { readonly type: 'stop-media' }
  | { readonly type: 'replay-media' }
  | { readonly type: 'finish-media' }
  | { readonly type: 'start-intro' }
  | { readonly type: 'end-session' };
import type { FinalRevealState } from '@filmovy-kviz/quiz-domain';
