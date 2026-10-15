// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminEventDetailPage } from '../apps/web/src/routes/admin/AdminEventDetailPage';
import { getEvent } from '../apps/web/src/features/events/eventRepository';
import { listQuizzes } from '../apps/web/src/features/quizzes/quizRepository';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import type { EventRecord } from '../apps/web/src/features/events/types';
import type { QuizSummary } from '../apps/web/src/features/quizzes/types';
import { eventFormRecord } from './browser/events-form-ux.data';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: () => access.allowed, currentUser: { uid: 'test' } }) }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: vi.fn() }));
vi.mock('../apps/web/src/features/quizzes/quizRepository', () => ({ listQuizzes: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventApi', () => ({ eventActionError: () => 'Chyba', lockEventQuiz: vi.fn(), updateEvent: vi.fn() }));
vi.mock('../apps/web/src/features/events/EventActions', () => ({ EventActions: () => null, lifecycleLabels: {} }));
vi.mock('../apps/web/src/features/leaderboard/EventLiveButton', () => ({ EventLiveButton: () => null }));
vi.mock('../apps/web/src/features/referee/RefereeAccessPanel', () => ({ RefereeAccessPanel: () => null }));
vi.mock('../apps/web/src/features/events/ManualTeamDialog', () => ({ ManualTeamDialog: () => null }));
vi.mock('../apps/web/src/features/events/RegistrationSharePanel', () => ({ RegistrationSharePanel: () => null }));
let host: HTMLDivElement, root: Root;
const assignment = { quizId: 'quiz', quizRevision: 1, snapshotId: 'snapshot', quizTitle: 'Připravený kvíz', roundCount: 1, questionCount: 1, lockedAt: new Date() };
const summary: QuizSummary = { id: 'quiz', title: 'Nabídka kvízu', description: '', status: 'draft', roundCount: 1, questionCount: 1,
  createdAt: new Date(), updatedAt: new Date(), createdBy: 'test', updatedBy: 'test' };
const record = (patch: Partial<EventRecord> = {}): EventRecord => ({ ...eventFormRecord(), quizAssignment: assignment, ...patch });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); access.allowed = true;
  vi.mocked(getEvent).mockReset().mockResolvedValue(record());
  vi.mocked(listQuizzes).mockReset().mockResolvedValue([summary]);
  vi.mocked(getEditorQuiz).mockReset().mockResolvedValue({ id: 'quiz', title: 'Prázdný kvíz', description: '', revision: 1, slideCount: 0, roundCount: 0, questionCount: 0, slides: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  const router = createMemoryRouter([{ path: '/admin/events/:eventId', element: <AdminEventDetailPage /> }], { initialEntries: ['/admin/events/' + record().id] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
it.each<Partial<EventRecord>>([
  { liveSessionId: 'live' }, { scoring: { unitScale: 2, rankingMode: 'dense', started: true } },
  { lifecycleStatus: 'completed' }, { lifecycleStatus: 'cancelled' }, { disposition: 'archived' }, { disposition: 'trash' },
])('does not fetch the library or private source quiz when assignment is immutable: %j', async patch => {
  vi.mocked(getEvent).mockResolvedValue(record(patch)); await render();
  expect(host.textContent).toContain('Připravený kvíz');
  expect(listQuizzes).not.toHaveBeenCalled(); expect(getEditorQuiz).not.toHaveBeenCalled();
});
it('does not read quiz content without the complete selection permissions', async () => {
  access.allowed = false; await render(); expect(listQuizzes).not.toHaveBeenCalled(); expect(getEditorQuiz).not.toHaveBeenCalled();
});
it('compares the source on request without changing the version of an ongoing event', async () => {
  vi.mocked(getEvent).mockResolvedValue(record({ liveSessionId: 'live' }));
  vi.mocked(getEditorQuiz).mockResolvedValue({ id: 'quiz', title: 'Novější kvíz', description: '', revision: 4, slideCount: 0, roundCount: 0, questionCount: 0, slides: [] });
  await render();
  expect(getEditorQuiz).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Ověřit novější změny v knihovně')!.click());
  expect(host.textContent).toContain('V knihovně je novější verze 4');
  expect(host.textContent).toContain('Tato akce stále používá připravenou verzi 1');
  expect(host.querySelector('[data-testid="event-quiz-assignment"]')?.textContent).toContain('Zdrojová revize 1');
});
it('shows the event before the optional library arrives, then runs real preflight and keeps blockers enforced', async () => {
  let resolve!: (quizzes: readonly QuizSummary[]) => void;
  vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); expect(host.textContent).toContain('Týmy a kapacita'); expect(host.textContent).toContain('Načítám nabídku');
  expect(getEditorQuiz).not.toHaveBeenCalled();
  await act(async () => resolve([summary]));
  expect(getEditorQuiz).toHaveBeenCalledWith('quiz');
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('BLOCKED');
  const prepare = [...host.querySelectorAll('button')].find(button => button.textContent === 'Aktualizovat kvíz pro akci');
  expect(prepare?.disabled).toBe(true);
});
it('keeps the event usable after a library failure and offers a working retry', async () => {
  vi.mocked(listQuizzes).mockRejectedValueOnce(new Error('offline')); await render();
  expect(host.textContent).toContain('Týmy a kapacita'); expect(host.querySelector('[role=alert]')?.textContent).toContain('Nabídku kvízů');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Zkusit znovu')!.click());
  expect(listQuizzes).toHaveBeenCalledTimes(2); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('ignores an earlier event response after the route changes', async () => {
  let resolve!: (event: EventRecord) => void;
  vi.mocked(getEvent).mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValueOnce(record({ id: 'other', title: 'Jiná dokončená akce', lifecycleStatus: 'completed' }));
  const router = await render(); await act(async () => router.navigate('/admin/events/other'));
  await act(async () => resolve(record()));
  expect(host.textContent).toContain('Jiná dokončená akce'); expect(listQuizzes).not.toHaveBeenCalled();
});
it('ignores the optional library response after navigating to an immutable event', async () => {
  let resolve!: (quizzes: readonly QuizSummary[]) => void;
  vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const router = await render();
  vi.mocked(getEvent).mockResolvedValue(record({ id: 'other', lifecycleStatus: 'completed' }));
  await act(async () => router.navigate('/admin/events/other'));
  await act(async () => resolve([summary]));
  expect(getEditorQuiz).not.toHaveBeenCalled(); expect(host.querySelector('select')).toBeNull();
});
