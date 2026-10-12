// @vitest-environment happy-dom
import React, { act, useEffect, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lazyAdminRoute } from '../apps/web/src/app/lazyAdminRoute';
import { RequireStaff } from '../apps/web/src/routes/admin/RequireStaff';
import { AdminLoading } from '../apps/web/src/routes/admin/AdminLoading';

const access = vi.hoisted(() => ({ allowed: true, signedIn: true, staff: true }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  can: () => access.allowed, currentUser: access.signedIn ? { uid: 'test' } : null,
  role: access.staff ? 'admin' : null, loading: false,
}) }));
let host: HTMLDivElement, root: Root;
const readPrivateData = vi.fn();
function Page() { useEffect(() => { readPrivateData(); }, []); return <h1>Knihovna</h1>; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  access.allowed = true; access.signedIn = true; access.staff = true; readPrivateData.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(load: () => Promise<ComponentType>, initial = '/admin') {
  const router = createMemoryRouter([
    { path: '/admin', element: <RequireStaff />, HydrateFallback: AdminLoading, children: [
      { index: true, element: <h1>Přehled</h1> },
      { path: 'quizzes', lazy: lazyAdminRoute(load, ['quiz.read']) },
    ] },
    { path: '/admin/login', element: <h1>Přihlášení</h1> },
    { path: '/admin/no-access', element: <h1>Bez přístupu</h1> },
  ], { initialEntries: [initial] });
  await act(async () => root.render(<RouterProvider router={router} />)); return router;
}
it('keeps the current screen and announces navigation while a module loads, then starts page reads', async () => {
  let resolve!: (page: ComponentType) => void;
  const router = await render(() => new Promise(done => { resolve = done; }));
  let navigation!: Promise<void>;
  await act(async () => { navigation = router.navigate('/admin/quizzes'); });
  expect(host.textContent).toContain('Přehled');
  expect(host.querySelector('[role=status]')?.textContent).toContain('Otevírám stránku');
  expect(readPrivateData).not.toHaveBeenCalled();
  await act(async () => { resolve(Page); await navigation; });
  expect(host.textContent).toContain('Knihovna'); expect(readPrivateData).toHaveBeenCalledOnce();
  expect(host.querySelector('[role=status]')).toBeNull();
});
it('renders a fallback for a cold deep link and checks permissions before mounting private content', async () => {
  access.allowed = false;
  let resolve!: (page: ComponentType) => void;
  await render(() => new Promise(done => { resolve = done; }), '/admin/quizzes');
  expect(host.textContent).toContain('Ověřuji přihlášení');
  await act(async () => { resolve(Page); });
  expect(host.textContent).toContain('Tato činnost není dostupná'); expect(readPrivateData).not.toHaveBeenCalled();
});
it.each(['signedIn', 'staff'] as const)('retains the %s guard on a lazy deep link', async field => {
  access[field] = false; await render(async () => Page, '/admin/quizzes');
  expect(host.textContent).toContain(field === 'signedIn' ? 'Přihlášení' : 'Bez přístupu');
  expect(readPrivateData).not.toHaveBeenCalled();
});
it('does not mount an abandoned lazy destination after navigating elsewhere', async () => {
  let resolve!: (page: ComponentType) => void;
  const router = await render(() => new Promise(done => { resolve = done; }));
  let navigation!: Promise<void>;
  await act(async () => { navigation = router.navigate('/admin/quizzes'); });
  await act(async () => router.navigate('/admin'));
  await act(async () => { resolve(Page); await navigation; });
  expect(host.textContent).toContain('Přehled'); expect(readPrivateData).not.toHaveBeenCalled();
});
