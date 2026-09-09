import type { EmailMessage, EmailTransport } from '../email/delivery.js';
import { GmailEmailTransport, GMAIL_SEND_SCOPE, type GmailFetch } from '../email/gmail.js';
import { requireEmailEmulator } from '../email/token-vault.js';

// In-memory HTTP fake. No network call, cloud credentials or deployed export.
// Deliberately records duplicate submissions: Gmail promises no Message-ID dedup.
export class FakeGmailProvider implements EmailTransport {
  readonly messages = new Map<string, EmailMessage>();
  readonly submissions: string[] = [];
  nextFailure: 'before-accept' | 'after-accept' | 'invalid-grant' | 'rate-limit' | null = null;


  constructor() { requireEmailEmulator(); }
  async send(message: EmailMessage): Promise<void> {
    const projectId = requireEmailEmulator();
    const http: GmailFetch = (url, init) => Promise.resolve().then(() => {
      requireEmailEmulator();
      if (url === 'https://oauth2.googleapis.com/token') {
        if (this.nextFailure === 'invalid-grant') { this.nextFailure = null; return Response.json({ error: 'invalid_grant' }, { status: 400 }); }
        return Response.json({ access_token: 'synthetic-access-token', token_type: 'Bearer', scope: GMAIL_SEND_SCOPE });
      }
      if (url !== 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') throw new Error('Unexpected fake request.');
      const failure = this.nextFailure;
      this.nextFailure = null;
      if (failure === 'before-accept') return Response.json({}, { status: 503 });
      if (failure === 'rate-limit') return Response.json({}, { status: 429 });
      const raw = (JSON.parse(init.body as string) as { raw: string }).raw;
      this.submissions.push(raw);
      this.messages.set(message.idempotencyKey, { ...message });
      if (failure === 'after-accept') throw new Error('Synthetic response loss.');
      return Response.json({ id: 'synthetic-' + this.submissions.length });
    });
    const transport = new GmailEmailTransport({ projectId, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
      refreshToken: 'synthetic-refresh', sender: 'sender@example.test', replyTo: 'reply@example.test' }, http);
    await transport.send(message);
  }
}
