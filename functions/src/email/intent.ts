import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

import type { RegistrationEmailContent, RegistrationEmailType } from './templates.js';

export type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed';
interface EmailIntentState {
  readonly eventId: string;
  readonly registrationId: string;
  readonly recipient: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly sentAt: Timestamp | null;
  readonly lastError: import('./errors.js').DeliveryErrorCode | null;
  readonly nextAttemptAt?: Timestamp | null;
  readonly leaseId: string | null;
  readonly leaseUntil: Timestamp | null;
}

export interface RegistrationEmailIntent extends EmailIntentState {
  readonly type: RegistrationEmailType;
  readonly content: RegistrationEmailContent;
}
export interface EventTeamEmailIntent extends EmailIntentState {
  readonly type: 'event-team-message';
  readonly campaignId: string;
}
export type EmailIntent = RegistrationEmailIntent | EventTeamEmailIntent;

// Called only after the domain transaction has authorized and validated its operation.
// No raw token, full URL, provider body or client-supplied destination enters the audit.
export function enqueueRegistrationEmail(transaction: Transaction, eventRef: DocumentReference, registrationRef: DocumentReference,
  intentId: string, type: RegistrationEmailType, event: Record<string, unknown>, registration: Record<string, unknown>, now: Timestamp) {
  const venue = event.venue as { name: string; publicLocation: string };
  const intent: RegistrationEmailIntent = {
    eventId: eventRef.id, registrationId: registrationRef.id, type,
    recipient: registration.contactEmail as string,
    content: { eventTitle: event.title as string, startsAtMillis: (event.startsAt as Timestamp).toMillis(), timeZone: event.timeZone as string,
      venueName: venue.name, publicLocation: venue.publicLocation, teamName: registration.teamName as string, memberCount: registration.memberCount as number },
    status: 'pending', nextAttemptAt: null, attempts: 0, lastError: null, createdAt: now, updatedAt: now, sentAt: null, leaseId: null, leaseUntil: null,
  };
  transaction.create(eventRef.collection('emailIntents').doc(intentId), intent);
  transaction.update(registrationRef, { emailDelivery: { intentId, type, status: 'pending', updatedAt: now } });
}
