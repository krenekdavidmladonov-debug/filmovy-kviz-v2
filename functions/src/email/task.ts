import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

import { deliverRegistrationEmail, type EmailTransport } from './delivery.js';
import { EmailDeliveryError } from './errors.js';
import type { TokenVault } from './token-vault.js';

export interface EmailTask { readonly eventId: string; readonly intentId: string }
export function emailTask(data: unknown): EmailTask {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid email task.');
  const record = data as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'eventId,intentId' || ![record.eventId, record.intentId].every(value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,150}$/u.test(value))) throw new Error('Invalid email task.');
  return { eventId: record.eventId as string, intentId: record.intentId as string };
}
export interface EmailTaskQueue {
  enqueue(data: EmailTask, options: { id: string; dispatchDeadlineSeconds: number }): Promise<void>;
}
export async function enqueueEmailTask(queue: EmailTaskQueue, data: unknown): Promise<void> {
  const task = emailTask(data);
  const id = createHash('sha256').update('events/' + task.eventId + '/emailIntents/' + task.intentId).digest('hex');
  try { await queue.enqueue(task, { id, dispatchDeadlineSeconds: 60 }); return; }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'functions/task-already-exists') return;
  }
  // Do not attach a queue exception: it may contain request metadata.
  throw new Error('Email dispatch unavailable.');
}
export async function processEmailTask(data: unknown, deps: {
  db: Firestore; transport: EmailTransport | (() => EmailTransport); vault: TokenVault | (() => TokenVault);
  origin: string | (() => string); clock?: () => number;
}): Promise<void> {
  const task = emailTask(data);
  const result = await deliverRegistrationEmail(deps.db, deps.db.collection('events').doc(task.eventId).collection('emailIntents').doc(task.intentId),
    deps.transport, deps.vault, deps.origin, deps.clock);
  if (result === 'busy' || result === 'pending') throw new EmailDeliveryError('provider-unavailable', true);
}
