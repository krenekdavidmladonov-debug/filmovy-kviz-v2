import { describe, expect, test } from 'vitest';
import { eventDisposition, eventOperational, hasPermission, pragueDateTime, pragueInstant, rolePresets, transitionProblem, type Membership } from '../packages/quiz-domain/src/index';

describe('event lifecycle and old documents', () => {
  test('missing overlay remains visible; archive retains outcome', () => {
    expect(eventDisposition({ lifecycleStatus: 'ready' })).toBe('active');
    expect(eventDisposition({ lifecycleStatus: 'archived' })).toBe('archived');
    expect(eventOperational({ lifecycleStatus: 'ready', disposition: 'trash' })).toBe(false);
    for (const lifecycleStatus of ['completed', 'cancelled']) expect(transitionProblem({ lifecycleStatus }, 'archive')).toBeNull();
    expect(transitionProblem({ lifecycleStatus: 'completed' }, 'cancel')).toBeTruthy();
    expect(transitionProblem({ lifecycleStatus: 'ready', hasActiveSession: true }, 'trash')).toBeTruthy();
    expect(transitionProblem({ disposition: 'deleting' }, 'restore')).toBeTruthy();
    expect(transitionProblem({ lifecycleStatus: 'cancelled', scoring: { started: true } }, 'prepare')).toBeTruthy();
  });
  test('only owner defaults or explicit deletion grant authorize deletion', () => {
    expect(rolePresets.manager).not.toContain('event.delete');
    expect(rolePresets.moderator).not.toContain('event.delete');
    expect(rolePresets.referee).not.toContain('event.delete');
    expect(hasPermission({ role: 'owner', permissions: [] } as unknown as Membership, 'event.delete')).toBe(true);
    expect(hasPermission({ role: 'manager', permissions: ['event.manage'] } as unknown as Membership, 'event.delete')).toBe(false);
  });
});
describe('Prague wall time, independent of browser time zone', () => {
  test('winter and summer round trips', () => {
    expect(pragueInstant('2026-01-20T19:30')).toBe('2026-01-20T18:30:00.000Z');
    expect(pragueInstant('2026-07-20T19:30')).toBe('2026-07-20T17:30:00.000Z');
    expect(pragueDateTime(new Date('2026-07-20T17:30:00Z'))).toBe('2026-07-20T19:30');
  });
  test('nonexistent and ambiguous times require correction or explicit offset', () => {
    expect(() => pragueInstant('2026-03-29T02:30')).toThrow('neexistuje');
    expect(() => pragueInstant('2026-10-25T02:30')).toThrow('dvakrát');
    expect(pragueInstant('2026-10-25T02:30', '+02:00')).toBe('2026-10-25T00:30:00.000Z');
    expect(pragueInstant('2026-10-25T02:30', '+01:00')).toBe('2026-10-25T01:30:00.000Z');
  });
});
