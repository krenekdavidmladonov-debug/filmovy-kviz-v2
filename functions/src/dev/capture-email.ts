import type { EmailMessage, EmailTransport } from '../email/delivery.js';
import { requireEmailEmulator } from '../email/token-vault.js';

// Local test process only. No HTTP endpoint, disk capture, logging, or deployment export.
export class CaptureEmailTransport implements EmailTransport {
  readonly messages = new Map<string, EmailMessage>();
  nextFailure: 'before-accept' | 'after-accept' | null = null;

  constructor() { requireEmailEmulator(); }

  send(message: EmailMessage): Promise<void> {
    requireEmailEmulator();
    const failure = this.nextFailure;
    this.nextFailure = null;
    const accepted = this.messages.get(message.idempotencyKey);
    if (accepted && JSON.stringify(accepted) !== JSON.stringify(message)) return Promise.reject(new Error('Synthetic idempotency payload mismatch.'));
    if (failure === 'before-accept') return Promise.reject(new Error('Synthetic delivery failure.'));
    if (!this.messages.has(message.idempotencyKey)) this.messages.set(message.idempotencyKey, { ...message });
    if (failure === 'after-accept') return Promise.reject(new Error('Synthetic lost response.'));
    return Promise.resolve();
  }
}
