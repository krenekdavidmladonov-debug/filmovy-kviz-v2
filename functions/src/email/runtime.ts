import { EmailDeliveryError } from './errors.js';
import { mailbox } from './gmail.js';
import { requireEmailEmulator } from './token-vault.js';

export const EMAIL_STAGING_PROJECT = 'filmovy-kviz-v2-staging';
export const EMAIL_KEYRING_SECRET = 'EMAIL_TOKEN_KEYRING';
export interface RegistrationEmailActivation { readonly activatedAtMillis: number; readonly recipient: string }

// No parameter declarations or secret reads during Functions discovery.
export function emailEmulatorRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.FUNCTIONS_EMULATOR === 'true' || Boolean(environment.FIRESTORE_EMULATOR_HOST)
    || (environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT ?? '').startsWith('demo-');
}

export function registrationEmailActivation(environment: NodeJS.ProcessEnv = process.env): RegistrationEmailActivation | null {
  const mode = environment.REGISTRATION_EMAIL_MODE;
  if (mode === undefined || mode === 'off') return null;
  const projects = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT].filter(value => value !== undefined);
  if (environment.FIREBASE_CONFIG !== undefined) {
    try {
      const config = JSON.parse(environment.FIREBASE_CONFIG) as { projectId?: unknown };
      if (!config || config.projectId !== EMAIL_STAGING_PROJECT) throw new Error();
    } catch { throw new EmailDeliveryError('configuration-invalid', false); }
  }
  const cutoff = environment.REGISTRATION_EMAIL_ACTIVATED_AT ?? '';
  if (mode !== 'staging' || emailEmulatorRuntime(environment) || projects.length === 0
    || (environment.FUNCTIONS_EMULATOR !== undefined && environment.FUNCTIONS_EMULATOR !== 'false')
    || projects.some(project => project !== EMAIL_STAGING_PROJECT)
    || Object.keys(environment).some(key => key.endsWith('_EMULATOR_HOST') && Boolean(environment[key]))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cutoff)
    || !Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString() !== cutoff) {
    throw new EmailDeliveryError('configuration-invalid', false);
  }
  return { activatedAtMillis: Date.parse(cutoff), recipient: mailbox(environment.REGISTRATION_EMAIL_ALLOWED_RECIPIENT ?? '') };
}

export function registrationEmailSecrets(environment: NodeJS.ProcessEnv = process.env): string[] {
  return registrationEmailActivation(environment) ? [EMAIL_KEYRING_SECRET] : [];
}

export function registrationEmailEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (registrationEmailActivation(environment)) return true;
  if (!emailEmulatorRuntime(environment)) return false;
  requireEmailEmulator(environment);
  return true;
}

export function registrationEmailRecipientEligible(recipient: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  const activation = registrationEmailActivation(environment);
  return activation ? recipient === activation.recipient : registrationEmailEnabled(environment);
}

// Used again inside the delivery lease transaction, before any secret/provider resolution.
export function allowedRegistrationEmailIntent(intent: Record<string, unknown>, activation: RegistrationEmailActivation): boolean {
  const createdAt = intent.createdAt as { toMillis?: () => number } | undefined;
  return ['registration-confirmed', 'registration-updated', 'registration-cancelled'].includes(intent.type as string)
    && intent.recipient === activation.recipient && typeof createdAt?.toMillis === 'function'
    && Number.isFinite(createdAt.toMillis()) && createdAt.toMillis() >= activation.activatedAtMillis;
}
