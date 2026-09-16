// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AdminPage } from '../apps/web/src/routes/admin/AdminPage';
import { AdminShell } from '../apps/web/src/app/AdminShell';
import { listQuizzes } from '../apps/web/src/features/quizzes/quizRepository';
import type { QuizSummary } from '../apps/web/src/features/quizzes/types';

const permissions = vi.hoisted(() => new Set<string>());
vi.mock('../apps/web/src/auth/AuthProvider', () => {
  const can = (permission: string) => permissions.has(permission);
  return { useAuth: () => ({ can, membership: { role: 'viewer' }, currentUser: { email: 'fixture@example.test' }, signOut: vi.fn() }) };
});
vi.mock('../apps/web/src/features/quizzes/quizRepository', () => ({ listQuizzes: vi.fn() }));

const quiz = (id: string, status: QuizSummary['status']): QuizSummary => ({
  id, status, title: `Kvíz ${id}`, description: '', createdAt: new Date('2026-08-01T12:00:00Z'),
  updatedAt: new Date('2026-08-28T12:00:00Z'), createdBy: 'fixture', updatedBy: 'fixture', roundCount: 0, questionCount: 0,
});
let root: Root;
let container: HTMLDivElement;
async function render(element = <AdminPage />) {
  await act(async () => { root.render(<MemoryRouter>{element}</MemoryRouter>); });
}
const links = () => [...container.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  permissions.clear();
  vi.mocked(listQuizzes).mockReset().mockResolvedValue([quiz('ready', 'ready'), quiz('draft', 'draft')]);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('overview actions and existing data boundaries', () => {
  test.each([
    [['quiz.read', 'quiz.create', 'quiz.edit', 'event.read', 'event.create'], ['Nový kvíz', 'Vytvořit akci', 'Kvízy', 'Akce']],
    [['quiz.read', 'event.read'], ['Kvízy', 'Akce']],
    [['quiz.read', 'quiz.create'], ['Nový kvíz', 'Kvízy']],
    [['event.read', 'event.create'], ['Vytvořit akci', 'Akce']],
  ])('only exposes actions allowed by %j', async (allowed, expected) => {
    allowed.forEach(permission => permissions.add(permission));
    await render();
    expect([...container.querySelectorAll('.dashboard-actions a')].map(link => link.textContent)).toEqual(expected);
    expect(listQuizzes).toHaveBeenCalledTimes(allowed.includes('quiz.read') ? 1 : 0);
    for (const [label, href] of [['Nový kvíz', '/admin/quizzes/new'], ['Vytvořit akci', '/admin/events/new'], ['Kvízy', '/admin/quizzes'], ['Akce', '/admin/events']]) {
      if (expected.includes(label!)) expect(links()).toContainEqual([label, href]);
    }
  });
  test('continues the first draft, uses the existing date and keeps the read-only destination', async () => {
    permissions.add('quiz.read'); await render();
    expect(container.querySelector('.continue-card h2')?.textContent).toBe('Kvíz draft');
    expect(links()).toContainEqual(['Otevřít detail', '/admin/quizzes/draft']);
    expect(container.querySelector('.continue-card .card-meta')?.textContent).toContain('28. 8. 2026');
    expect(container.textContent).not.toContain('Kvíz je připravený k další práci');
    expect(container.textContent).not.toContain('Naposledy otevřeno');
  });
  test('keeps the edit destination and falls back to the first quiz when there is no draft', async () => {
    permissions.add('quiz.read'); permissions.add('quiz.edit');
    vi.mocked(listQuizzes).mockResolvedValue([quiz('ready', 'ready')]); await render();
    expect(links()).toContainEqual(['Pokračovat v úpravách', '/admin/quizzes/ready/edit']);
  });
  test.each([true, false])('empty library gives a next step appropriate to create permission: %s', async canCreate => {
    permissions.add('quiz.read'); if (canCreate) permissions.add('quiz.create');
    vi.mocked(listQuizzes).mockResolvedValue([]); await render();
    expect(container.querySelector('.dashboard-empty')?.textContent).toContain(canCreate ? 'Začněte tlačítkem Nový kvíz' : 'Požádejte správce o přístup');
    expect(container.querySelector('.continue-card')).toBeNull();
  });
  test('no quiz permission means no library read, with the account offered instead', async () => {
    await render(); expect(listQuizzes).not.toHaveBeenCalled();
    expect(links()).toContainEqual(['osobním účtu', '/account']);
    expect(container.querySelector('.dashboard-empty')).toBeNull();
  });
  test('preserves loading, then a recoverable error without showing an empty library', async () => {
    permissions.add('quiz.read');
    let fail!: (error: Error) => void;
    vi.mocked(listQuizzes).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    await render(); expect(container.textContent).toContain('Načítám přehled');
    await act(async () => { fail(new Error('Local fixture failure')); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Přehled se nepodařilo načíst');
    expect(container.querySelector('.dashboard-empty')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('.human-error button')!.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('.continue-card')).not.toBeNull();
    expect(listQuizzes).toHaveBeenCalledTimes(2);
  });
});

describe('existing environment configuration', () => {
  test.each(['staging', 'production', 'development', undefined])('shows the test label and visible restriction only for staging: %s', async environment => {
    vi.stubEnv('VITE_APP_ENV', environment); await render(<AdminShell />);
    expect(container.querySelectorAll('.admin-environment-label')).toHaveLength(environment === 'staging' ? 2 : 0);
    expect(container.querySelector('[role="note"]')?.textContent ?? '').toBe(environment === 'staging' ? 'Pro zkoušení používejte pouze smyšlená data.' : '');
    expect(container.textContent).not.toContain('STAGING');
    expect(listQuizzes).not.toHaveBeenCalled();
  });
});
