export type QuizStatus = 'draft' | 'ready' | 'archived';
export type QuestionType = 'text' | 'image' | 'audio';
export type RoundType = 'classic' | 'picture' | 'audio';

export interface QuizSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: QuizStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly roundCount: number;
  readonly questionCount: number;
}

export interface QuizQuestion {
  readonly id: string;
  readonly type: QuestionType;
  readonly prompt: string;
  readonly position: number;
}

export interface QuizRound {
  readonly id: string;
  readonly title: string;
  readonly type: RoundType;
  readonly position: number;
  readonly questionCount: number;
  readonly questions: readonly QuizQuestion[];
}

export interface QuizDetail extends QuizSummary {
  readonly rounds: readonly QuizRound[];
}
