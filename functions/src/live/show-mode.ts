import { normalizeShowPreferences, parseInterimBackdrop, type InterimBackdrop, type ShowCue, type PublicResultRow } from '@filmovy-kviz/quiz-domain';
import { buildPublicSessionState } from './publication.js';
import { applyLiveSessionAction } from './session-machine.js';
import { displayAnswer } from './publication.js';
import type { InterimReturn, PrivateLiveSession, PrivateSlide } from './types.js';

export function parseInterimReturn(value: unknown): InterimReturn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid interim return.');
  const d = value as Record<string, unknown>;
  const id = (entry: unknown) => typeof entry === 'string' && entry.length > 0 && entry.length <= 1500 && !entry.includes('/');
  if (Object.keys(d).some(k => !['snapshotId', 'slideId', 'slidePosition', 'presentationMode', 'answerRevealed', 'recapQuestionId', 'recapQuestionPosition', 'capturedRevision'].includes(k))
    || !id(d.snapshotId) || !id(d.slideId) || !Number.isSafeInteger(d.slidePosition) || (d.slidePosition as number) < 1
    || !Number.isSafeInteger(d.capturedRevision) || (d.capturedRevision as number) < 0 || typeof d.answerRevealed !== 'boolean'
    || (d.presentationMode !== 'slide' && d.presentationMode !== 'recap')
    || ((d.recapQuestionId === undefined) !== (d.recapQuestionPosition === undefined))
    || (d.recapQuestionId !== undefined && (!id(d.recapQuestionId) || d.presentationMode !== 'recap' || !Number.isSafeInteger(d.recapQuestionPosition) || (d.recapQuestionPosition as number) < 1))) throw new Error('Invalid interim return.');
  return d as unknown as InterimReturn;
}

export function captureInterimReturn(session: PrivateLiveSession, slide: PrivateSlide): InterimReturn {
  if (!session.snapshotId) throw new Error('An event snapshot is required.');
  return { snapshotId: session.snapshotId, slideId: slide.id, slidePosition: slide.position,
    presentationMode: session.presentationMode, answerRevealed: session.answerRevealed,
    ...(session.recapQuestionId === undefined ? {} : { recapQuestionId: session.recapQuestionId }),
    ...(session.recapQuestionPosition === undefined ? {} : { recapQuestionPosition: session.recapQuestionPosition }), capturedRevision: session.revision };
}
export function staticInterimBackdrop(session: PrivateLiveSession, slide: PrivateSlide): InterimBackdrop {
  const publicSlide = buildPublicSessionState({ ...session, answerRevealed: false, presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle' }, slide);
  const keys = ['renderMode', 'slideKind', 'title', 'text', 'options', 'roundTitle', 'questionNumber', 'questionCount', 'design', 'backgroundImage', 'questionImage', 'backgroundOverlay', 'imageLayout'] as const;
  const result: Record<string, unknown> = { renderMode: publicSlide.renderMode, slideKind: publicSlide.slideKind ?? slide.kind, title: publicSlide.title ?? '', text: publicSlide.text ?? '' };
  for (const key of keys) if (publicSlide[key] !== undefined) result[key] = publicSlide[key];
  return parseInterimBackdrop(result);
}
export function restoreInterimReturn(session: PrivateLiveSession, slide: PrivateSlide, selected: PrivateSlide | undefined, allowAnswers: boolean, uid: string, now: unknown) {
  const { interimResults, interimReturn: intent, showCue, ...clean } = session;
  void interimResults; void showCue;
  let updated = applyLiveSessionAction(clean, { type: 'go-to-slide', position: slide.position, slideId: slide.id }, session.revision, uid, now, slide);
  const valid = !!intent && intent.snapshotId === session.snapshotId && intent.slidePosition === slide.position && intent.slideId === slide.id
    && intent.capturedRevision <= session.revision;
  if (!valid) return { session: updated, slide, restored: !intent };
  if (intent.presentationMode === 'recap' && intent.recapQuestionId !== undefined) {
    if (!intent.answerRevealed || !allowAnswers || !selected || slide.kind.toLowerCase() !== 'recap' || !selected.isQuestion
      || selected.id !== intent.recapQuestionId || selected.position !== intent.recapQuestionPosition || selected.position >= slide.position
      || (slide.roundId !== undefined && selected.roundId !== slide.roundId) || displayAnswer(selected.correctAnswer, selected.kind) === undefined)
      return { session: updated, slide, restored: false };
    updated = { ...updated, presentationMode: 'recap', answerRevealed: true, recapQuestionId: selected.id, recapQuestionPosition: selected.position };
    return { session: updated, slide: selected, restored: true };
  }
  if (intent.answerRevealed) {
    if (!allowAnswers || !slide.isQuestion || displayAnswer(slide.correctAnswer, slide.kind) === undefined) return { session: updated, slide, restored: false };
    updated = { ...updated, answerRevealed: true };
  }
  return { session: updated, slide, restored: true };
}
export function makeShowCue(id: string, kind: ShowCue['kind'], preferences: unknown, startedAt: number, motion?: unknown): ShowCue {
  if (motion !== undefined && motion !== 'animate' && motion !== 'static') throw new Error('Invalid cue motion.');
  const prefs = normalizeShowPreferences(preferences);
  const enabled = prefs.motion !== 'none' && (kind !== 'winners' || prefs.winnerAnimation)
    && (!['third', 'second'].includes(kind) || prefs.topThree);
  return { id, kind, intensity: prefs.motion, topThree: prefs.topThree, winnerAnimation: prefs.winnerAnimation,
    motion: motion === 'static' || !enabled ? 'static' : 'animate', startedAt,
    durationMs: enabled && motion !== 'static' ? prefs.motion === 'show' ? kind === 'winners' ? 2400 : 1600 : 650 : 0 };
}
/** Stable private IDs compare only explicitly confirmed versions, never names or live scores. */
export function attachResultMovement(rows: PublicResultRow[], rowTeamIds: readonly string[], current: Record<string, number>, previous?: Record<string, number>): PublicResultRow[] {
  return rows.map((row, index) => {
    const teamId = rowTeamIds[index], old = teamId === undefined ? undefined : previous?.[teamId];
    return { rank: row.rank, teamName: row.teamName, halfPoints: row.halfPoints,
      ...(teamId !== undefined && current[teamId] === row.rank && Number.isSafeInteger(old) && old! > 0 && old! <= 1000 ? { movement: old! - row.rank } : {}) };
  });
}
