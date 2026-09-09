import { randomUUID } from 'node:crypto';

import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

import type { RegistrationEmailIntent } from './intent.js';
import { managementUrl, registrationEmail, type EmailBody } from './templates.js';
import type { TokenEnvelope, TokenVault } from './token-vault.js';

export interface EmailMessage extends EmailBody {
  readonly idempotencyKey: string;
  readonly to: string;
}

export interface EmailTransport {
  // Must deduplicate accepted mail by this key, including an accepted request whose
  // response was lost. A bare SMTP adapter cannot satisfy this contract.
  send(message: EmailMessage): Promise<void>;
}

// Server-internal worker primitive. Deliberately not exported as a callable/trigger.
// Recipient and content always come from a committed, server-owned domain intent.
export async function deliverRegistrationEmail(db: Firestore, ref: DocumentReference, transport: EmailTransport, vault: TokenVault, origin: string) {
  if (!/^events\/[^/]+\/emailIntents\/[^/]+$/u.test(ref.path)) throw new Error('Invalid email intent path.');
  const leaseId = randomUUID();
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const intent = snapshot.data() as RegistrationEmailIntent;
    const now = Timestamp.now();
    if (intent.status === 'sent' || (intent.leaseUntil && intent.leaseUntil.toMillis() > now.toMillis())) return null;
    const registrationRef = db.collection('events').doc(intent.eventId).collection('registrations').doc(intent.registrationId);
    const registration = await transaction.get(registrationRef);
    const summary = registration.data()?.emailDelivery as { intentId?: string } | undefined;
    transaction.update(ref, { status: 'pending', attempts: intent.attempts + 1, updatedAt: now, leaseId, leaseUntil: Timestamp.fromMillis(now.toMillis() + 120_000) });
    if (summary?.intentId === ref.id) transaction.update(registrationRef, { emailDelivery: { intentId: ref.id, type: intent.type, status: 'pending', updatedAt: now } });
    return intent;
  });
  if (!claimed) return 'unchanged' as const;
  const registrationRef = db.collection('events').doc(claimed.eventId).collection('registrations').doc(claimed.registrationId);
  const secretRef = db.collection('events').doc(claimed.eventId).collection('emailSecrets').doc(ref.id);
  let status: 'sent' | 'failed' = 'sent';
  try {
    let link: string | undefined;
    if (claimed.type === 'registration-confirmed') {
      const envelope = (await secretRef.get()).data()?.envelope as TokenEnvelope | undefined;
      if (!envelope) throw new Error();
      const token = vault.open(envelope, ref.path);
      link = managementUrl(origin, claimed.eventId, claimed.registrationId, token);
    }
    const body = registrationEmail(claimed.type, claimed.content, link);
    await transport.send({ idempotencyKey: ref.path, to: claimed.recipient, ...body });
  } catch {
    // No exception interpolation: provider errors may contain the entire secret email.
    status = 'failed';
  }
  const recorded = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const registration = await transaction.get(registrationRef);
    if (current.data()?.leaseId !== leaseId) return false;
    const now = Timestamp.now();
    transaction.update(ref, { status, updatedAt: now, sentAt: status === 'sent' ? now : null,
      lastError: status === 'failed' ? 'delivery-unavailable' : null, leaseId: null, leaseUntil: null });
    const summary = registration.data()?.emailDelivery as { intentId?: string } | undefined;
    // Finishing older mail must not overwrite a newer operation's organizer status.
    if (summary?.intentId === ref.id) transaction.update(registrationRef, { emailDelivery: { intentId: ref.id, type: claimed.type, status, updatedAt: now } });
    // Retain the protected envelope for a lost create-response retry. It is never
    // readable by staff; cloud rollout must define coordinated receipt/key retention.
    return true;
  });
  return recorded ? status : 'unchanged';
}
