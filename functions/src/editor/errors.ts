export type QuizEditorErrorCode =
  | 'invalid-argument'
  | 'already-exists'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted';

export class QuizEditorError extends Error {
  constructor(
    readonly code: QuizEditorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuizEditorError';
  }
}
