import type { MediaPlaybackCommand, SlidePresentationInput } from '../presentation/types';

export type LiveSessionStatus = 'waiting' | 'active' | 'ended';
export type LivePresentationMode = 'slide' | 'recap';
export type LiveRenderMode = 'question' | 'recap' | 'roundIntro' | 'agenda' | 'rules' | 'end';

export interface LiveControlState {
  readonly sessionId: string;
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
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly revision: number;
}

export interface LiveControlMedia {
  readonly role: string;
  readonly kind: string;
  readonly source: string;
}

export interface LiveControlSlide {
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
  readonly options: readonly string[];
  readonly media: readonly LiveControlMedia[];
  readonly presentation: SlidePresentationInput;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number;
  readonly clipStartSeconds?: number;
  readonly clipEndSeconds?: number;
  readonly correctAnswer?: string;
  readonly moderatorNote?: string;
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
  readonly presentation: SlidePresentationInput;
  readonly presentationMode: LivePresentationMode;
  readonly renderMode: LiveRenderMode;
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number;
  readonly clipStartSeconds?: number;
  readonly clipEndSeconds?: number;
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
  readonly presentationMode: LivePresentationMode;
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaGeneration: number;
  readonly revision: number;
}
