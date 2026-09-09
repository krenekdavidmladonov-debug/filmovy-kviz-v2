import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

export interface TokenEnvelope {
  readonly version: 1;
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface TokenVault {
  seal(token: string, context: string): TokenEnvelope;
  open(envelope: TokenEnvelope, context: string): string;
}

// Only ciphertext is persisted, separately from both registrations and email audit.
// A future cloud key resolver must retain old key versions while pending mail exists.
export function createTokenVault(keyId: string, key: Buffer): TokenVault {
  if (key.length !== 32 || !keyId) throw new Error('Invalid token protection configuration.');
  return {
    seal(token, context) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return { version: 1, keyId, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    },
    open(envelope, context) {
      try {
        if (envelope.version !== 1 || envelope.keyId !== keyId) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        // Never expose crypto input or nested exceptions to callers/logs.
        throw new Error('Management link protection is unavailable.');
      }
    },
  };
}

export function requireEmailEmulator(environment: NodeJS.ProcessEnv = process.env): string {
  const project = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  const endpoint = /^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u.exec(environment.FIRESTORE_EMULATOR_HOST ?? '');
  if (!project?.startsWith('demo-') || !endpoint || Number(endpoint[1]) > 65535) {
    throw new HttpsError('failed-precondition', 'Registration email link protection is not configured.');
  }
  return project;
}

export function emulatorTokenVault(environment: NodeJS.ProcessEnv = process.env): TokenVault {
  const project = requireEmailEmulator(environment);
  // Public synthetic fixture, NOT a cloud secret. Both project and host must be local.
  const key = createHash('sha256').update(`email-emulator-fixture-v1:${project}`).digest();
  return createTokenVault('demo-fixture-v1', key);
}

// No cloud key, environment-secret fallback, or provider is configured in this slice.
export const registrationTokenVault = emulatorTokenVault;
