import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

import { EmailDeliveryError } from './errors.js';
import { GmailEmailTransport } from './gmail.js';
import { createTokenVault, emulatorTokenVault, type TokenVault } from './token-vault.js';

export const emailKeyring: ReturnType<typeof defineSecret> = defineSecret('EMAIL_TOKEN_KEYRING');
const clientId = defineSecret('GMAIL_OAUTH_CLIENT_ID');
const clientSecret = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');
const refreshToken = defineSecret('GMAIL_OAUTH_REFRESH_TOKEN');
const sender = defineString('GMAIL_SENDER_EMAIL', { default: '' });
const replyTo = defineString('GMAIL_REPLY_TO', { default: '' });
const linkOrigin = defineString('EMAIL_PUBLIC_ORIGIN', { default: '' });

export function emailEmulatorRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST)
    || (process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '').startsWith('demo-');
}
// Local Functions discovery never resolves actual Secret Manager values.
export const registrationEmailSecrets: ReturnType<typeof defineSecret>[] = emailEmulatorRuntime() ? [] : [emailKeyring];
export const gmailWorkerSecrets: ReturnType<typeof defineSecret>[] = emailEmulatorRuntime() ? [] : [emailKeyring, clientId, clientSecret, refreshToken];

export function keyringVault(serialized: string): TokenVault {
  try {
    const data = JSON.parse(serialized) as { activeKeyId: string; keys: Record<string, string> };
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(data.activeKeyId) || !data.keys || Array.isArray(data.keys) || Object.keys(data.keys).length > 10) throw new Error();
    const vaults = new Map(Object.entries(data.keys).map(([id, value]) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(id) || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) throw new Error();
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) throw new Error();
      return [id, createTokenVault(id, key)] as const;
    }));
    const active = vaults.get(data.activeKeyId);
    if (!active) throw new Error();
    return { seal: (token, context) => active.seal(token, context), open: (envelope, context) => {
      const selected = vaults.get(envelope.keyId);
      if (!selected) throw new Error('Management link protection is unavailable.');
      return selected.open(envelope, context);
    } };
  } catch { throw new EmailDeliveryError('configuration-invalid', false); }
}

export function registrationTokenVault(): TokenVault {
  try {
    if (emailEmulatorRuntime()) return emulatorTokenVault();
    return keyringVault(emailKeyring.value());
  } catch { throw new HttpsError('failed-precondition', 'Registration email link protection is not configured.'); }
}

export function cloudEmailOrigin(): string {
  // Only the existing V2 staging surface is prepared in this slice. No V1 target.
  if (emailEmulatorRuntime() || linkOrigin.value() !== 'https://filmovy-kviz-v2-staging.web.app') throw new EmailDeliveryError('configuration-invalid', false);
  return linkOrigin.value();
}

export function cloudGmailTransport(): GmailEmailTransport {
  if (emailEmulatorRuntime()) throw new EmailDeliveryError('configuration-invalid', false);
  return new GmailEmailTransport({ clientId: clientId.value(), clientSecret: clientSecret.value(), refreshToken: refreshToken.value(),
    sender: sender.value(), replyTo: replyTo.value(), projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '' }, fetch);
}
