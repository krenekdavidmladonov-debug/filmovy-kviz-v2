// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminEventResultsPage } from '../apps/web/src/routes/admin/AdminEventResultsPage';
import { PermissionGate } from '../apps/web/src/features/access/PermissionGate';
import { getHistoricalResults, type HistoricalResults } from '../apps/web/src/features/events/historicalResultsRepository';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: () => access.allowed }) }));
vi.mock('../apps/web/src/features/events/historicalResultsRepository', () => ({ getHistoricalResults: vi.fn() }));
const available: HistoricalResults = { status: 'available', eventTitle: 'Dokončená generálka', completedAt: new Date('2026-09-17T18:20:00Z'),
  rows: [{ rank: 1, teamName: 'QA Alfa', halfPoints: 34 }, { rank: 2, teamName: 'QA Beta — dlouhý název', halfPoints: 26 }, { rank: 3, teamName: 'QA Delta', halfPoints: 19 }, { rank: 4, teamName: 'QA Gamma', halfPoints: 6 }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); access.allowed = true;
  vi.mocked(getHistoricalResults).mockReset().mockResolvedValue(available);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  const router = createMemoryRouter([{ path: '/admin/events/:eventId/results', element: <PermissionGate requires={['event.read']}><AdminEventResultsPage /></PermissionGate> }], { initialEntries: ['/admin/events/event/results'] });
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}
it('renders read-only confirmed ranks and Czech half-points, with no live/edit controls', async () => {
  await render();
  expect(host.textContent).toContain('Dokončeno'); expect(host.textContent).toContain('Pouze pro čtení');
  expect([...host.querySelectorAll('tbody tr')].map(row => [...row.children].map(c => c.textContent))).toEqual([
    ['1.', 'QA Alfa', '17'], ['2.', 'QA Beta — dlouhý název', '13'], ['3.', 'QA Delta', '9,5'], ['4.', 'QA Gamma', '3'],
  ]);
  expect(host.querySelectorAll('button,input,select,textarea')).toHaveLength(0);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/admin/events/event');
});
it.each(['unavailable', 'not-completed'] as const)('explains %s without rendering invented rows', async status => {
  vi.mocked(getHistoricalResults).mockResolvedValue({ status, eventTitle: 'Akce' }); await render();
  expect(host.textContent).toContain(status === 'unavailable' ? 'Konečné výsledky této akce nejsou k dispozici.' : 'Akce ještě není dokončená.');
  expect(host.querySelector('table')).toBeNull();
});
it('does not load or display history without the route permission', async () => {
  access.allowed = false; await render(); expect(getHistoricalResults).not.toHaveBeenCalled(); expect(host.querySelector('table')).toBeNull();
});
it('handles scoped permission denial without a misleading missing-version message', async () => {
  vi.mocked(getHistoricalResults).mockRejectedValue({ code: 'permission-denied' }); await render();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('nemáte přístup');
  expect(host.textContent).not.toContain('nejsou k dispozici');
});
it('shows loading, discards an old route response, and permits a read retry after network failure', async () => {
  let resolveFirst!: (value: HistoricalResults) => void;
  vi.mocked(getHistoricalResults).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockRejectedValueOnce({ code: 'unavailable' });
  const router = await render(); expect(host.textContent).toContain('Načítám konečné výsledky');
  await act(async () => router.navigate('/admin/events/other/results'));
  await act(async () => resolveFirst(available));
  expect(host.querySelector('table')).toBeNull(); expect(host.textContent).toContain('Zkontrolujte připojení');
  vi.mocked(getHistoricalResults).mockResolvedValue(available);
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelectorAll('tbody tr')).toHaveLength(4);
});
