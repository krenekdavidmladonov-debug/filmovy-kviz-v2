import { describe, expect, test } from 'vitest';
import { canDelegate, grantErrors, permissions, rolePresets, scopeAllows, type AccessGrant, type Membership } from '../packages/quiz-domain/src/access';

const all = { mode: 'all', ids: [] } as const;
const grant = (role: AccessGrant['role']): AccessGrant => ({ role, permissions: [...rolePresets[role]], quizzes: { ...all, ids: [] }, events: { ...all, ids: [] } });
const actor = (role: Membership['role']): Membership => ({ ...grant(role), uid: 'actor', status: 'active', version: 1, sessionValidAfter: 0, displayName: '', email: 'actor@example.test' });
describe('personal access policy', () => {
  test('role presets have explicit valid dependencies', () => { for (const role of Object.keys(rolePresets) as AccessGrant['role'][]) expect(grantErrors(grant(role))).toEqual([]); });
  test('permissions never silently add dependencies or deletion', () => {
    const request = { ...grant('viewer'), permissions: ['quiz.answers.edit'] as AccessGrant['permissions'] };
    expect(grantErrors(request).length).toBe(2); expect(request.permissions).toEqual(['quiz.answers.edit']);
    expect(rolePresets.creator).not.toContain('quiz.delete'); expect(rolePresets.moderator).not.toContain('quiz.edit');
  });
  test('only owner can delegate managers or permission to manage people', () => {
    expect(canDelegate(actor('owner'), grant('manager'))).toBe(true);
    for (const role of ['manager', 'creator'] as const) {
      const manager = { ...actor(role), permissions: [...permissions] };
      expect(canDelegate(manager, grant('manager'))).toBe(false);
      expect(canDelegate(manager, { ...grant('creator'), permissions: [...rolePresets.creator, 'users.manage'] })).toBe(false);
      expect(canDelegate(manager, grant('owner'))).toBe(false);
    }
    expect(canDelegate(actor('manager'), grant('creator'))).toBe(true);
  });
  test('selected, empty, own and suspended memberships fail closed', () => {
    expect(scopeAllows({ mode: 'selected', ids: [] }, 'a', 'actor', 'actor')).toBe(false);
    expect(scopeAllows({ mode: 'own', ids: [] }, 'a', 'actor', 'other')).toBe(false);
    expect(scopeAllows({ mode: 'own', ids: [] }, 'a', 'actor', 'actor')).toBe(true);
    expect(canDelegate({ ...actor('owner'), status: 'suspended' }, grant('viewer'))).toBe(false);
    expect(canDelegate({ ...actor('owner'), quizzes: { mode: 'selected', ids: ['a'] } }, { ...grant('creator'), quizzes: { mode: 'selected', ids: ['b'] } })).toBe(false);
  });
});
