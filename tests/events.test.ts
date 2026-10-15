import { describe, expect, test } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../packages/quiz-domain/src/index';
import {
  buildPublicEventProjection,
  canArchiveEvent,
  canCancelEvent,
  canLockQuiz,
  canMutateEvent,
  defaultScoringConfiguration,
  validateEventCapacity,
  validateEventConfiguration,
} from '../functions/src/events/model';
import {
  buildQuizSnapshotMetadata,
  decidePreflightLock,
  snapshotWriteCount,
} from '../functions/src/events/snapshot-model';

const validConfiguration = {
  title: 'Filmový večer',
  startsAt: new Date('2026-10-20T17:00:00.000Z'),
  timeZone: 'Europe/Prague',
  venue: { name: 'Kulturní dům', publicLocation: 'Hlavní sál' },
  teamCapacity: 20,
  peopleCapacity: 120,
  teamSizeMin: 2,
  teamSizeMax: 6,
} as const;

function slide(overrides: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'free', kind: 'free', isQuestion: true,
    roundId: 'round-1', roundTitle: 'Kolo 1', title: '', text: 'Otázka', moderatorNote: '',
    options: [], correctAnswer: 'Odpověď', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...overrides,
  };
}

const quiz: EditorQuiz = {
  id: 'quiz-1', title: 'Kvíz', description: 'Popis', revision: 7,
  slideCount: 1, roundCount: 1, questionCount: 1, slides: [slide()],
};

test('immutable event source stores appearance and safe static result templates at lock time', () => {
  const authored: EditorQuiz = { ...quiz, printTemplate: { title: 'Team sheet', layout: 'compact', logoImage: 'https://example.test/logo.png' }, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundImage: '', backgroundOverlay: 30, imageLayout: 'split' }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } };
  const frozen = JSON.parse(JSON.stringify(buildQuizSnapshotMetadata(authored, { warningCount: 0 }, 'admin', 'now'))) as Record<string, unknown>;
  const laterSource = { ...authored, defaultDesign: { textColor: '#000' }, resultTemplates: { final: { title: 'Changed later' } } };
  expect(laterSource.resultTemplates.final.title).toBe('Changed later');
  expect(frozen).toMatchObject({ quizRevision: 7, printTemplate: authored.printTemplate, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundOverlay: 30 }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } });
});

describe('event configuration', () => {
  test('accepts separate team, people, and per-team limits', () => {
    expect(validateEventCapacity(validConfiguration)).toEqual([]);
    expect(validateEventConfiguration(validConfiguration)).toEqual([]);
  });

  test.each([
    [{ teamCapacity: 0 }, 'teamCapacity'],
    [{ peopleCapacity: 0 }, 'peopleCapacity'],
    [{ teamSizeMin: 0 }, 'teamSizeMin'],
    [{ teamSizeMin: 7, teamSizeMax: 6 }, 'teamSizeMax'],
    [{ peopleCapacity: 5, teamSizeMax: 6 }, 'teamSizeMax'],
  ])('rejects malformed capacity configuration %o', (change, field) => {
    const issues = validateEventCapacity({ ...validConfiguration, ...change });
    expect(issues.some((item) => item.includes(field))).toBe(true);
  });

  test('uses half-point integer units and dense ranking by default', () => {
    expect(defaultScoringConfiguration).toEqual({ unitScale: 2, rankingMode: 'dense', started: false });
  });
});

describe('event lifecycle', () => {
  test('limits normal edits, cancellation, archive, and relock explicitly', () => {
    expect(canMutateEvent('scheduled')).toBe(true);
    expect(canMutateEvent('live')).toBe(false);
    expect(canCancelEvent('live')).toBe(true);
    expect(canCancelEvent('completed')).toBe(false);
    expect(canArchiveEvent('cancelled')).toBe(true);
    expect(canArchiveEvent('ready')).toBe(false);
    expect(canLockQuiz('ready', false)).toBe(true);
    expect(canLockQuiz('ready', true)).toBe(false);
  });
});

describe('public event projection', () => {
  test('contains only the explicit public allowlist', () => {
    const projection = buildPublicEventProjection({
      ...validConfiguration,
      startsAt: 'timestamp',
      registrationStatus: 'scheduled',
      registrationPublished: false,
      acceptedTeams: 0,
      acceptedPeople: 0,
      registrationOpensAt: null,
      registrationClosesAt: null,
      revision: 3,
      updatedAt: 'updated',
    });
    expect(projection).toEqual({
      title: 'Filmový večer', startsAt: 'timestamp', timeZone: 'Europe/Prague',
      venueName: 'Kulturní dům', publicLocation: 'Hlavní sál',
      registrationStatus: 'scheduled', registrationPublished: false, availability: 'scheduled',
      teamSize: { min: 2, max: 6 }, revision: 3, updatedAt: 'updated',
      capacity: { teams: { accepted: 0, maximum: 20 }, people: { accepted: 0, maximum: 120 } },
      registrationWindow: { opensAt: null, closesAt: null },
    });
    expect(projection).not.toHaveProperty('quizAssignment');
    expect(JSON.stringify(projection)).not.toMatch(/answer|email|organizer|contact/iu);
  });
});

describe('quiz snapshot and preflight lock policy', () => {
  test('requires acknowledgement for warnings and always denies blockers', () => {
    expect(decidePreflightLock({ blockerCount: 1, warningCount: 0 }, true)).toBe('BLOCKED');
    expect(decidePreflightLock({ blockerCount: 0, warningCount: 2 }, false)).toBe('WARNINGS_REQUIRE_ACKNOWLEDGEMENT');
    expect(decidePreflightLock({ blockerCount: 0, warningCount: 2 }, true)).toBe('ALLOW');
    expect(decidePreflightLock({ blockerCount: 0, warningCount: 0 }, false)).toBe('ALLOW');
  });

  test('builds immutable snapshot metadata for the exact quiz revision', () => {
    const metadata = buildQuizSnapshotMetadata(quiz, { warningCount: 0 }, 'admin-1', 'now');
    expect(metadata).toMatchObject({
      status: 'ready', quizId: 'quiz-1', quizRevision: 7, slideCount: 1,
      roundCount: 1, questionCount: 1, createdBy: 'admin-1', createdAt: 'now',
      preflight: { status: 'READY', blockerCount: 0, warningCount: 0 },
    });
  });

  test('accounts for root, event, and public writes in the transaction budget', () => {
    expect(snapshotWriteCount(315, 23)).toBe(342);
  });
});
