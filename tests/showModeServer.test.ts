import { describe, expect, test } from 'vitest';
import { attachResultMovement, captureInterimReturn, makeShowCue, restoreInterimReturn, staticInterimBackdrop } from '../functions/src/live/show-mode';
import { applyLiveSessionAction } from '../functions/src/live/session-machine';
import { buildPublicSessionState } from '../functions/src/live/publication';
import { defaultShowPreferences } from '../packages/quiz-domain/src/show-mode';
import type { PrivateLiveSession, PrivateSlide } from '../functions/src/live/types';

const question: PrivateSlide = { id: 'q1', position: 1, kind: 'question', isQuestion: true, roundId: 'r1', title: 'Otázka', text: 'Veřejný prompt', options: [], media: [], presentation: {}, correctAnswer: 'ANSWER-CANARY', answerImage: 'https://example.test/answer.png', moderatorNote: 'PRIVATE-NOTE', answerDesign: { backgroundImage: 'https://example.test/answer-background.png' } };
const recap: PrivateSlide = { ...question, id: 'recap', position: 2, kind: 'recap', isQuestion: false };
const session = (change: Partial<PrivateLiveSession> = {}): PrivateLiveSession => ({ sessionId: 'session', eventId: 'event', snapshotId: 'snapshot', quizId: 'quiz', quizTitle: 'Syntetický kvíz', slideCount: 2, status: 'active', currentSlideId: 'q1', currentSlidePosition: 1, answerRevealed: true, presentationMode: 'slide', mediaCommand: 'play', mediaPlaybackState: 'playing', mediaGeneration: 3, introGeneration: 0, revision: 7, createdBy: 'staff', updatedBy: 'staff', createdAt: 1, startedAt: 1, endedAt: null, updatedAt: 2, ...change });
const enter = (before: PrivateLiveSession, slide: PrivateSlide): PrivateLiveSession => ({ ...applyLiveSessionAction(before, { type: 'go-to-slide', slideId: slide.id, position: slide.position }, before.revision, 'staff', 3, slide), interimReturn: captureInterimReturn(before, slide), interimResults: { versionId: 'a'.repeat(64), roundNumber: 1, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 } });
describe('trusted interim return and static background', () => {
  test('capture has intent only; overlay background omits answer and all playback sources', () => {
    const before = session();
    const intent = captureInterimReturn(before, question);
    expect(intent).toMatchObject({ answerRevealed: true, capturedRevision: 7 });
    expect(JSON.stringify(intent)).not.toContain('ANSWER-CANARY');
    const backdrop = staticInterimBackdrop(enter(before, question), question);
    expect(backdrop.text).toBe('Veřejný prompt');
    const wire = JSON.stringify(backdrop);
    for (const secret of ['ANSWER-CANARY', 'answer.png', 'answer-background', 'PRIVATE-NOTE', 'mediaSource', 'answerRevealed']) expect(wire).not.toContain(secret);
  });
  test('same explicit answer returns from authoritative source, always stopped/new generation', () => {
    const during = enter(session(), question);
    const result = restoreInterimReturn({ ...during, revision: 12 }, question, undefined, true, 'staff', 4);
    expect(result.restored).toBe(true); expect(result.session.answerRevealed).toBe(true);
    expect(result.session.revision).toBe(13); expect(result.session.mediaGeneration).toBe(during.mediaGeneration + 1);
    expect(result.session.mediaPlaybackState).toBe('idle'); expect(result.session.interimReturn).toBeUndefined();
    expect(buildPublicSessionState(result.session, { ...question, correctAnswer: 'AUTHORITATIVE-ANSWER' }).revealedAnswer).toBe('AUTHORITATIVE-ANSWER');
    const denied = restoreInterimReturn(during, question, undefined, false, 'staff', 4);
    expect(denied.restored).toBe(false); expect(buildPublicSessionState(denied.session, denied.slide).revealedAnswer).toBeUndefined();
  });
  test('exact recap selection returns, foreign snapshot/round/missing selection fails closed', () => {
    const before = session({ currentSlideId: recap.id, currentSlidePosition: 2, presentationMode: 'recap', recapQuestionId: question.id, recapQuestionPosition: 1 });
    const during = enter(before, recap);
    const restored = restoreInterimReturn(during, recap, question, true, 'staff', 4);
    expect(restored.restored).toBe(true); expect(restored.session.recapQuestionId).toBe(question.id);
    expect(buildPublicSessionState(restored.session, restored.slide).revealedAnswer).toBe('ANSWER-CANARY');
    for (const selected of [undefined, { ...question, roundId: 'foreign' }, { ...question, id: 'foreign' }]) {
      const denied = restoreInterimReturn(during, recap, selected, true, 'staff', 4);
      expect(denied.restored).toBe(false); expect(denied.session.recapQuestionId).toBeUndefined();
    }
    const wrongSnapshot = restoreInterimReturn({ ...during, snapshotId: 'new-snapshot' }, recap, question, true, 'staff', 4);
    expect(wrongSnapshot.restored).toBe(false); expect(wrongSnapshot.session.answerRevealed).toBe(false);
  });
  test('navigation and END remove return intent/cue and cannot replay old media', () => {
    const during = enter(session(), question);
    const cue = makeShowCue('b'.repeat(64), 'interim', undefined, 10);
    const ended = applyLiveSessionAction({ ...during, showCue: cue }, { type: 'end-session' }, during.revision, 'staff', 4);
    expect(ended.interimReturn).toBeUndefined(); expect(ended.showCue).toBeUndefined(); expect(ended.answerRevealed).toBe(false);
  });
});
describe('cue settings and confirmed stable-ID movement', () => {
  test('server respects all intensity, podium/winner and explicit static switches', () => {
    const id = 'c'.repeat(64);
    expect(makeShowCue(id, 'winners', undefined, 1)).toMatchObject({ intensity: 'subtle', motion: 'animate', durationMs: 650 });
    expect(makeShowCue(id, 'winners', { ...defaultShowPreferences, motion: 'show' }, 1).durationMs).toBe(2400);
    for (const prefs of [{ ...defaultShowPreferences, motion: 'none' }, { ...defaultShowPreferences, winnerAnimation: false }]) expect(makeShowCue(id, 'winners', prefs, 1).motion).toBe('static');
    expect(makeShowCue(id, 'third', { ...defaultShowPreferences, topThree: false }, 1).motion).toBe('static');
    expect(makeShowCue(id, 'interim', undefined, 1, 'static').durationMs).toBe(0);
  });
  test('renamed teams and equal names use stable identities; no prior version means no movement', () => {
    const rows = [{ rank: 1, teamName: 'Stejný název', halfPoints: 6 }, { rank: 1, teamName: 'Stejný název', halfPoints: 6 }];
    expect(attachResultMovement(rows, ['one', 'two'], { one: 1, two: 1 }, { one: 3, two: 1 }).map(r => r.movement)).toEqual([2, 0]);
    expect(attachResultMovement(rows, ['one', 'new'], { one: 1, new: 1 }, { one: 2 })[1]!.movement).toBeUndefined();
    expect(attachResultMovement(rows, ['one', 'two'], { one: 1, two: 1 })).toEqual(rows);
    expect(JSON.stringify(attachResultMovement(rows, ['one', 'two'], { one: 1, two: 1 }, { one: 3, two: 1 }))).not.toContain('teamId');
  });
});
