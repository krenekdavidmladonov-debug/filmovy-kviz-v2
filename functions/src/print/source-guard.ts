import { PrintCenterError } from './errors.js';

/** A relock/delete during generation must not hand out an obsolete PDF. */
export function assertCurrentPrintSource(original: Record<string, unknown>, current: unknown, snapshot: Record<string, unknown> | undefined, eventId: string): void {
  const assignment = typeof current === 'object' && current !== null && !Array.isArray(current) ? current as Record<string, unknown> : undefined;
  if (!assignment || !snapshot || snapshot.status !== 'ready' || snapshot.eventId !== eventId || typeof original.quizId !== 'string' || !Number.isInteger(original.quizRevision) || assignment.snapshotId !== original.snapshotId || assignment.quizId !== original.quizId || assignment.quizRevision !== original.quizRevision || snapshot.quizId !== original.quizId || snapshot.quizRevision !== original.quizRevision) {
    throw new PrintCenterError(409, 'print-source-changed', 'Připravený kvíz se během generování změnil. Obnovte náhled dokumentu.');
  }
}
