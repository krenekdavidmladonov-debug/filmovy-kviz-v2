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
  readonly roundTitle?: string;
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

export type CreatableQuestionType = 'choice' | 'free' | 'image' | 'audio' | 'video';
export type SemanticQuestionType = CreatableQuestionType | 'legacy-pl' | 'legacy';

export type EditorValidationCategory = 'STRUCTURE' | 'ANSWER' | 'MEDIA' | 'TIMING' | 'IMAGE' | 'LEGACY';

export type EditorValidationCode =
  | 'QUESTION_PROMPT_MISSING'
  | 'QUESTION_RENDERER_UNSUPPORTED'
  | 'ANSWER_MISSING'
  | 'CHOICE_OPTIONS_TOO_FEW'
  | 'CHOICE_CORRECT_MISSING'
  | 'CHOICE_CORRECT_INVALID'
  | 'PL_ANSWER_INVALID'
  | 'IMAGE_SOURCE_MISSING'
  | 'IMAGE_SOURCE_INVALID'
  | 'ANSWER_IMAGE_INVALID'
  | 'BACKGROUND_IMAGE_INVALID'
  | 'MEDIA_SOURCE_MISSING'
  | 'MEDIA_SOURCE_INVALID'
  | 'CLIP_START_MISSING'
  | 'CLIP_START_INVALID'
  | 'CLIP_END_MISSING'
  | 'CLIP_END_INVALID'
  | 'CLIP_RANGE_INVALID'
  | 'LEGACY_LIMITED';

export interface EditorValidationIssue {
  readonly code: EditorValidationCode;
  readonly category: EditorValidationCategory;
  readonly field: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
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
