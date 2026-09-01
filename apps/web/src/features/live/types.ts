export type LiveSessionStatus = 'waiting' | 'active' | 'ended';

export interface LiveControlState {
  readonly sessionId: string;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly slideCount: number;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly currentSlideId?: string;
  readonly answerRevealed: boolean;
  readonly revision: number;
}

export interface LiveControlSlide {
  readonly id: string;
  readonly position: number;
  readonly kind: string;
  readonly isQuestion: boolean;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly correctAnswer?: string;
}

export interface PublicMedia {
  readonly role: 'prompt' | 'background';
  readonly kind: 'image' | 'audio' | 'video' | 'unknown';
  readonly source: string;
}

export interface PublicLiveState {
  readonly sessionId: string;
  readonly quizTitle: string;
  readonly status: LiveSessionStatus;
  readonly slidePosition: number;
  readonly slideKind?: string;
  readonly title?: string;
  readonly text?: string;
  readonly options: readonly string[];
  readonly media: readonly PublicMedia[];
  readonly answerRevealed: boolean;
  readonly revealedAnswer?: string;
  readonly answerImage?: string;
  readonly revision: number;
}

export interface LiveActionResponse {
  readonly sessionId: string;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly answerRevealed: boolean;
  readonly revision: number;
}
