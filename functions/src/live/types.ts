export type LiveSessionStatus = 'waiting' | 'active' | 'ended';

export interface PrivateLiveSession {
  readonly sessionId: string;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly slideCount: number;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly currentSlideId?: string;
  readonly answerRevealed: boolean;
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
  readonly title: string;
  readonly text: string;
  readonly options: readonly unknown[];
  readonly media: readonly unknown[];
  readonly presentation: unknown;
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
  readonly videoStart?: number;
  readonly videoEnd?: number;
  readonly audioTrigger?: number;
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
  readonly revision: number;
  readonly updatedAt: unknown;
  readonly slideKind?: string;
  readonly title?: string;
  readonly text?: string;
  readonly options?: readonly string[];
  readonly media?: readonly PublicMedia[];
  readonly presentation?: PublicPresentation;
  readonly revealedAnswer?: string;
  readonly answerImage?: string;
}

export type LiveSessionAction =
  | { readonly type: 'go-to-slide'; readonly position: number; readonly slideId: string }
  | { readonly type: 'next-slide'; readonly slideId: string }
  | { readonly type: 'previous-slide'; readonly slideId: string }
  | { readonly type: 'reveal-answer' }
  | { readonly type: 'hide-answer' }
  | { readonly type: 'end-session' };
