import type {
  EditorValidationCategory,
  EditorValidationCode,
  SemanticQuestionType,
} from '../editor/types';

export type PreflightSeverity = 'BLOCKER' | 'WARNING';
export type PreflightStatus = 'BLOCKED' | 'READY_WITH_WARNINGS' | 'READY';
export type PreflightSource = 'SAVED_QUIZ' | 'LOCAL_DRAFT';
export type PreflightCategory = EditorValidationCategory | 'PROJECTOR';

export type PreflightIssueCode = EditorValidationCode
  | 'QUIZ_TITLE_MISSING'
  | 'QUIZ_HAS_NO_ROUNDS'
  | 'ROUND_TITLE_MISSING'
  | 'ROUND_HAS_NO_QUESTIONS'
  | 'ROUND_QUESTION_NUMBERING_INVALID'
  | 'ROUNDLESS_QUESTIONS'
  | 'AGENDA_OUT_OF_DATE'
  | 'MEDIA_ONLINE_UNVERIFIED'
  | 'IMAGE_ONLINE_UNVERIFIED'
  | 'UNSAVED_CHANGES';

export interface PreflightReference {
  readonly quizId: string;
  readonly roundId?: string;
  readonly roundPosition?: number;
  readonly roundTitle?: string;
  readonly questionId?: string;
  readonly questionNumber?: number;
  readonly questionType?: SemanticQuestionType;
}

export interface PreflightFixTarget {
  readonly kind: 'quiz' | 'round' | 'question' | 'system';
  readonly roundId?: string;
  readonly questionId?: string;
  readonly systemKey?: 'agenda';
  readonly field?: string;
}

export interface PreflightIssue {
  readonly severity: PreflightSeverity;
  readonly code: PreflightIssueCode;
  readonly category: PreflightCategory;
  readonly message: string;
  readonly reference: PreflightReference;
  readonly fixTarget?: PreflightFixTarget;
}

export interface PreflightCategoryCount {
  readonly blockers: number;
  readonly warnings: number;
}

export interface PreflightResult {
  readonly status: PreflightStatus;
  readonly source: PreflightSource;
  readonly validationDurationMs: number;
  readonly roundCount: number;
  readonly questionCount: number;
  readonly validAnswerCount: number;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly issues: readonly PreflightIssue[];
  readonly categories: Readonly<Record<PreflightCategory, PreflightCategoryCount>>;
}
