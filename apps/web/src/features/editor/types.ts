export const editableSlideKinds = [
  'intro', 'agenda', 'rules', 'recap', 'end', 'title', 'info', 'round', 'roundheader', 'round-header', 'section',
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
] as const;

export type EditableSlideKind = typeof editableSlideKinds[number];
export type EditorMediaKind = 'image' | 'audio' | 'video' | 'unknown';
export type EditorMediaRole = 'prompt' | 'answer' | 'background' | 'unknown';

export interface EditorMedia {
  readonly sourceIndex?: number;
  readonly role: EditorMediaRole;
  readonly kind: EditorMediaKind;
  readonly source: string;
}

export interface EditorPresentation {
  readonly videoStart: number | null;
  readonly videoEnd: number | null;
  readonly audioTrigger: number | null;
  readonly backgroundOverlay: number | null;
  readonly answerOverlay: number | null;
  readonly sourceQuestionNumber: string | null;
}

export interface EditorSlide {
  readonly id: string;
  readonly position: number;
  readonly storedKind: string;
  readonly kind: EditableSlideKind;
  readonly isQuestion: boolean;
  readonly roundId?: string;
  readonly title: string;
  readonly text: string;
  readonly moderatorNote: string;
  readonly options: readonly string[];
  readonly correctAnswer: string;
  readonly media: readonly EditorMedia[];
  readonly presentation: EditorPresentation;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage: string;
  readonly questionImage: string;
  readonly answerImage: string;
  readonly mediaSource: string;
  readonly backgroundOverlay: number | null;
  readonly clipStartSeconds: number | null;
  readonly clipEndSeconds: number | null;
  readonly hasLegacyData: boolean;
}

export interface EditorQuiz {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly revision: number;
  readonly slideCount: number;
  readonly questionCount: number;
  readonly roundCount: number;
  readonly slides: readonly EditorSlide[];
}

export interface EditorMutationResponse {
  readonly quizId: string;
  readonly revision: number;
  readonly slideCount: number;
  readonly questionCount: number;
  readonly roundCount: number;
  readonly selectedSlideId?: string;
}
