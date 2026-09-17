import { describe, expect, test } from 'vitest';
import { canDelegate, grantErrors, permissions, rolePresets, scopeAllows, type AccessGrant, type Membership } from '../packages/quiz-domain/src/access';
import { createEventFormAuth } from './browser/events-form-ux.auth';

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

describe('isolated event-form Auth fixture', () => {
  test.each([null, 'admin'])('form administrator %s can create/manage events without unrelated powers', profile => {
    const auth = createEventFormAuth(profile);
    expect(auth.role).toBe('admin');
    expect(auth.membership?.role).toBe('manager');
    expect(auth.can('event.read')).toBe(true);
    expect(auth.can('event.create')).toBe(true);
    expect(auth.can('event.manage')).toBe(true);
    for (const permission of ['event.delete', 'users.manage', 'quiz.edit', 'event.contacts'] as const) expect(auth.can(permission)).toBe(false);
  });
  test('moderator remains a signed-in reader without mutation rights', () => {
    const auth = createEventFormAuth('moderator');
    expect(auth.role).toBe('moderator');
    expect(auth.membership?.role).toBe('moderator');
    expect(auth.can('event.read')).toBe(true);
    for (const permission of ['event.create', 'event.manage', 'event.delete', 'users.manage'] as const) expect(auth.can(permission)).toBe(false);
  });
  test('identity, membership and loading state agree for both supported profiles', () => {
    for (const profile of ['admin', 'moderator']) {
      const auth = createEventFormAuth(profile);
      expect(auth.currentUser?.uid).toBe(auth.membership?.uid);
      expect(auth.currentUser?.email).toBe(auth.membership?.email);
      expect(auth.currentUser?.emailVerified).toBe(true);
      expect(auth.membership?.status).toBe('active');
      expect(auth.loading).toBe(false);
      expect(auth.initializationError).toBeNull();
      expect(grantErrors(auth.membership!)).toEqual([]);
      expect(scopeAllows(auth.membership!.events, 'synthetic-event', auth.currentUser!.uid)).toBe(true);
      expect(scopeAllows(auth.membership!.events, 'other-event', auth.currentUser!.uid)).toBe(false);
      expect(scopeAllows(auth.membership!.quizzes, 'any-quiz', auth.currentUser!.uid)).toBe(false);
    }
  });
  test('unknown profiles, unknown/missing permissions and inactive membership fail closed', () => {
    for (const profile of ['', 'owner', 'unexpected']) {
      const auth = createEventFormAuth(profile);
      expect(auth.currentUser).toBeNull();
      expect(auth.membership).toBeNull();
      expect(auth.role).toBeNull();
      expect(permissions.some(permission => auth.can(permission))).toBe(false);
    }
    const auth = createEventFormAuth('admin');
    expect(Reflect.apply(auth.can, undefined, ['unknown.permission'])).toBe(false);
    expect(Reflect.apply(auth.can, undefined, [])).toBe(false);
    auth.membership!.status = 'suspended';
    expect(permissions.some(permission => auth.can(permission))).toBe(false);
  });
  test('credential operations fail locally without a real Auth session', async () => {
    const auth = createEventFormAuth('admin');
    await expect(auth.signIn('staff@example.test', 'synthetic-only')).rejects.toThrow('isolated event-form fixture');
    await expect(auth.signOut()).rejects.toThrow('isolated event-form fixture');
    await expect(auth.currentUser!.getIdToken()).rejects.toThrow('isolated event-form fixture');
  });
});
