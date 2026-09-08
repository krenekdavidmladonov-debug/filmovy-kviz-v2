// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminEventScoringPage } from '../apps/web/src/routes/admin/AdminEventScoringPage';

vi.mock('../apps/web/src/features/scoring/api', () => ({
  loadRounds: vi.fn().mockResolvedValue([{ id: 'r1', title: 'První' }, { id: 'r2', title: 'Druhé' }]),
  watchScoringEvent: (_id: string, receive: (snapshot: string, allowed: boolean) => void) => { receive('s', true); return () => undefined; },
  watchRoster: (_id: string, receive: (teams: { id: string; name: string; accepted: boolean }[]) => void) => { receive([{ id: 't', name: 'Tým', accepted: true }]); return () => undefined; },
  watchScores: (_id: string, receive: (scores: object) => void) => { receive({}); return () => undefined; },
  saveScore: vi.fn(), loadHistory: vi.fn(),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.confirm = vi.fn(() => false);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('protects unsaved values on round changes, route navigation and browser unload', async () => {
  const router = createMemoryRouter([
    { path: '/admin/events/:eventId/scoring', element: <AdminEventScoringPage /> },
    { path: '/admin/events/:eventId', element: <p>Detail</p> },
  ], { initialEntries: ['/admin/events/e/scoring'] });
  await act(async () => root.render(<RouterProvider router={router} />));
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2,5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'r2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select.value).toBe('r1'); expect(input.value).toBe('2,5');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => router.navigate('/admin/events/e'));
  expect(router.state.location.pathname).toBe('/admin/events/e/scoring');
  expect(input.value).toBe('2,5');
  window.confirm = vi.fn(() => true);
  await act(async () => { select.value = 'r2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select.value).toBe('r2'); expect(host.querySelector('input')!.value).toBe('');
  await act(async () => router.navigate('/admin/events/e'));
  expect(router.state.location.pathname).toBe('/admin/events/e');
});
