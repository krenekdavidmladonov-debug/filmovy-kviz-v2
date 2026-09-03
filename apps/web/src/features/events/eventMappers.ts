import { Timestamp, type DocumentData } from 'firebase/firestore';

import type {
  EventLifecycleStatus,
  EventQuizAssignment,
  EventRecord,
  PublicEventRecord,
  RegistrationStatus,
} from './types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function text(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string') throw new Error(`Neplatné pole akce: ${field}`);
  return value;
}

function integer(data: Record<string, unknown>, field: string, minimum = 0): number {
  const value = data[field];
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`Neplatné pole akce: ${field}`);
  return value as number;
}

function date(value: unknown, field: string): Date {
  if (!(value instanceof Timestamp)) throw new Error(`Neplatné pole akce: ${field}`);
  return value.toDate();
}

function registrationStatus(value: unknown): RegistrationStatus {
  if (value !== 'scheduled' && value !== 'open' && value !== 'paused' && value !== 'full' && value !== 'closed') {
    throw new Error('Neplatný stav registrace.');
  }
  return value;
}

function lifecycleStatus(value: unknown): EventLifecycleStatus {
  if (value !== 'draft' && value !== 'scheduled' && value !== 'ready' && value !== 'live'
    && value !== 'finalizing' && value !== 'completed' && value !== 'cancelled' && value !== 'archived') {
    throw new Error('Neplatný stav akce.');
  }
  return value;
}

function quizAssignment(value: unknown): EventQuizAssignment | undefined {
  if (value === undefined || value === null) return undefined;
  const data = object(value);
  if (data === undefined) throw new Error('Neplatné přiřazení kvízu.');
  return {
    quizId: text(data, 'quizId'),
    quizRevision: integer(data, 'quizRevision'),
    snapshotId: text(data, 'snapshotId'),
    quizTitle: text(data, 'quizTitle'),
    roundCount: integer(data, 'roundCount'),
    questionCount: integer(data, 'questionCount'),
    lockedAt: date(data.lockedAt, 'quizAssignment.lockedAt'),
  };
}

export function mapEvent(id: string, value: DocumentData): EventRecord {
  const data = value as Record<string, unknown>;
  const venue = object(data.venue);
  const scoring = object(data.scoring);
  const assignment = quizAssignment(data.quizAssignment);
  if (venue === undefined || scoring === undefined || scoring.unitScale !== 2
    || scoring.rankingMode !== 'dense' || typeof scoring.started !== 'boolean') {
    throw new Error('Konfigurace akce je neplatná.');
  }
  return {
    id,
    title: text(data, 'title'),
    startsAt: date(data.startsAt, 'startsAt'),
    timeZone: text(data, 'timeZone'),
    venue: { name: text(venue, 'name'), publicLocation: text(venue, 'publicLocation') },
    teamCapacity: integer(data, 'teamCapacity', 1),
    peopleCapacity: integer(data, 'peopleCapacity', 1),
    teamSizeMin: integer(data, 'teamSizeMin', 1),
    teamSizeMax: integer(data, 'teamSizeMax', 1),
    registrationStatus: registrationStatus(data.registrationStatus),
    lifecycleStatus: lifecycleStatus(data.lifecycleStatus),
    scoring: { unitScale: 2, rankingMode: 'dense', started: scoring.started },
    revision: integer(data, 'revision', 1),
    ...(assignment === undefined ? {} : { quizAssignment: assignment }),
  };
}

export function mapPublicEvent(id: string, value: DocumentData): PublicEventRecord {
  const data = value as Record<string, unknown>;
  const teamSize = object(data.teamSize);
  if (teamSize === undefined) throw new Error('Veřejná konfigurace akce je neplatná.');
  return {
    id,
    title: text(data, 'title'),
    startsAt: date(data.startsAt, 'startsAt'),
    timeZone: text(data, 'timeZone'),
    venueName: text(data, 'venueName'),
    publicLocation: text(data, 'publicLocation'),
    registrationStatus: registrationStatus(data.registrationStatus),
    teamSizeMin: integer(teamSize, 'min', 1),
    teamSizeMax: integer(teamSize, 'max', 1),
    revision: integer(data, 'revision', 1),
  };
}
