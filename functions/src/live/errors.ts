export type LiveSessionErrorCode =
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted';

export class LiveSessionError extends Error {
  constructor(
    readonly code: LiveSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LiveSessionError';
  }
}
