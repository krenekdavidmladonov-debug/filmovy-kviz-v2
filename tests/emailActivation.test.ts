/* eslint @typescript-eslint/require-await: off -- SDK mocks perform no network IO. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { allowedRegistrationEmailIntent, registrationEmailActivation, registrationEmailEnabled, registrationEmailRecipientEligible, registrationEmailSecrets } from '../functions/src/email/runtime';

const sdk = vi.hoisted(() => ({ firestore: vi.fn(), queue: vi.fn(), enqueue: vi.fn(async () => {}), defineSecret: vi.fn(), defineString: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/app/index.js', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', async () => ({ ...await import('../functions/node_modules/firebase-admin/lib/firestore/index.js'), getFirestore: sdk.firestore }));
vi.mock('../functions/node_modules/firebase-admin/lib/esm/functions/index.js', () => ({ getFunctions: () => ({ taskQueue: sdk.queue }) }));
vi.mock('../functions/node_modules/firebase-functions/lib/params/index.js', () => ({ defineSecret: sdk.defineSecret, defineString: sdk.defineString }));

const cutoff = '2031-10-13T10:00:00.000Z';
const cloud = { GCLOUD_PROJECT: 'filmovy-kviz-v2-staging', REGISTRATION_EMAIL_MODE: 'staging', REGISTRATION_EMAIL_ACTIVATED_AT: cutoff,
  REGISTRATION_EMAIL_ALLOWED_RECIPIENT: 'approved@example.test' };
const intent = (patch: Record<string, unknown> = {}) => ({ eventId: 'event', registrationId: 'registration', type: 'registration-confirmed', recipient: 'approved@example.test',
  createdAt: Timestamp.fromMillis(Date.parse(cutoff)), ...patch });
const activation = { activatedAtMillis: Date.parse(cutoff), recipient: 'approved@example.test' };
const envNames = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG', 'FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
  'REGISTRATION_EMAIL_MODE', 'REGISTRATION_EMAIL_ACTIVATED_AT', 'REGISTRATION_EMAIL_ALLOWED_RECIPIENT'];
function installEnv(values: NodeJS.ProcessEnv) {
  const emulatorNames = [...Object.keys(process.env), ...Object.keys(values)].filter(name => name.endsWith('_EMULATOR_HOST'));
  for (const name of new Set([...envNames, ...emulatorNames])) vi.stubEnv(name, values[name]);
}
beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); installEnv({}); sdk.firestore.mockReturnValue({}); sdk.queue.mockReturnValue({ enqueue: sdk.enqueue }); });
afterEach(() => vi.unstubAllEnvs());

describe('registration-only explicit server activation', () => {
  test('defaults off even with secrets/config values present; no keyring binding', () => {
    expect(registrationEmailActivation({ ...cloud, REGISTRATION_EMAIL_MODE: undefined, EMAIL_TOKEN_KEYRING: 'not-read' })).toBeNull();
    expect(registrationEmailSecrets({ ...cloud, REGISTRATION_EMAIL_MODE: 'off' })).toEqual([]);
    expect(registrationEmailEnabled({ GCLOUD_PROJECT: 'filmovy-kviz-v2-staging' })).toBe(false);
  });
  test('requires exact staging and binds only the keyring', () => {
    expect(registrationEmailActivation(cloud)).toEqual(activation);
    expect(registrationEmailSecrets(cloud)).toEqual(['EMAIL_TOKEN_KEYRING']);
    expect(registrationEmailActivation({ ...cloud, GOOGLE_CLOUD_PROJECT: cloud.GCLOUD_PROJECT, FIREBASE_CONFIG: JSON.stringify({ projectId: cloud.GCLOUD_PROJECT }) })).toEqual(activation);
  });
  const invalid: NodeJS.ProcessEnv[] = [
    { ...cloud, REGISTRATION_EMAIL_MODE: 'true' }, { ...cloud, REGISTRATION_EMAIL_MODE: '' },
    { ...cloud, GCLOUD_PROJECT: 'foreign-project' }, { ...cloud, GCLOUD_PROJECT: undefined },
    { ...cloud, GOOGLE_CLOUD_PROJECT: 'foreign-project' }, { ...cloud, FIREBASE_CONFIG: '{' },
    { ...cloud, FIREBASE_CONFIG: JSON.stringify({ projectId: 'foreign-project' }) },
    { ...cloud, REGISTRATION_EMAIL_ACTIVATED_AT: undefined }, { ...cloud, REGISTRATION_EMAIL_ACTIVATED_AT: '2031-02-30T00:00:00.000Z' },
    { ...cloud, REGISTRATION_EMAIL_ACTIVATED_AT: '2031-10-13T10:00:00Z' },
    { ...cloud, REGISTRATION_EMAIL_ALLOWED_RECIPIENT: undefined }, { ...cloud, REGISTRATION_EMAIL_ALLOWED_RECIPIENT: 'a@example.test,b@example.test' },
    { ...cloud, REGISTRATION_EMAIL_ALLOWED_RECIPIENT: 'a@example.test\r\nBcc: b@example.test' },
    { ...cloud, FUNCTIONS_EMULATOR: 'true' }, { ...cloud, FUNCTIONS_EMULATOR: 'yes' },
    { ...cloud, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { ...cloud, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { ...cloud, GCLOUD_PROJECT: 'demo-filmovy-kviz-v2' },
  ];
  invalid.forEach((environment, index) => test('rejects malformed/conflicting activation ' + index, () => {
    expect(() => registrationEmailActivation(environment)).toThrow('configuration-invalid');
    expect(() => registrationEmailSecrets(environment)).toThrow('configuration-invalid');
  }));
  test('emulator intents require demo plus bounded loopback, not a cloud opt-in', () => {
    expect(registrationEmailEnabled({ GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(true);
    for (const values of [{ GCLOUD_PROJECT: 'demo-test' }, { GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: 'remote.test:8080' },
      { GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: 'localhost:99999' }, { GCLOUD_PROJECT: cloud.GCLOUD_PROJECT, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }]) {
      expect(() => registrationEmailEnabled(values)).toThrow('not configured');
    }
  });
  test('intent filter admits only the exact mailbox and three new registration types', () => {
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled']) expect(allowedRegistrationEmailIntent(intent({ type }), activation)).toBe(true);
    for (const patch of [{ type: 'event-team-message' }, { type: 'registration-typo' }, { recipient: 'other@example.test' },
      { createdAt: Timestamp.fromMillis(activation.activatedAtMillis - 1) }, { createdAt: undefined }, { createdAt: { toMillis: () => NaN } }]) {
      expect(allowedRegistrationEmailIntent(intent(patch), activation)).toBe(false);
    }
  });
  test('recipient eligibility leaves other cloud registrations without email, while retaining local fake coverage', () => {
    expect(registrationEmailRecipientEligible('approved@example.test', cloud)).toBe(true);
    expect(registrationEmailRecipientEligible('other@example.test', cloud)).toBe(false);
    expect(registrationEmailRecipientEligible('approved@example.test', { GCLOUD_PROJECT: cloud.GCLOUD_PROJECT })).toBe(false);
    expect(registrationEmailRecipientEligible('other@example.test', { GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toBe(true);
  });
});

describe('SDK discovery and invocation without credentials/network', () => {
  test('foreign recipient create reaches domain transaction without opening a vault or persisting an envelope', async () => {
    installEnv(cloud);
    const doc = { id: 'synthetic', path: 'events/event/emailIntents/intent', collection: () => ({ doc: () => doc }) };
    const runTransaction = vi.fn(async () => { throw new Error('Synthetic domain boundary'); });
    sdk.firestore.mockReturnValue({ collection: () => ({ doc: () => doc }), runTransaction });
    const { createEventRegistration } = await import('../functions/src/registrations/callables');
    await expect(createEventRegistration.run({ data: { eventId: 'event', teamName: 'Synthetic team', memberCount: 4, contactEmail: 'other@example.test' } } as Parameters<typeof createEventRegistration.run>[0])).rejects.toThrow('Synthetic domain boundary');
    expect(runTransaction).toHaveBeenCalledOnce();
  });
  test('all registration email types skip outbox and summary writes for other cloud recipients', async () => {
    installEnv(cloud);
    const { enqueueRegistrationEmail } = await import('../functions/src/email/intent');
    const create = vi.fn(), update = vi.fn(), collection = vi.fn(() => ({ doc: () => ({}) }));
    const eventRef = { id: 'event', collection } as unknown as Parameters<typeof enqueueRegistrationEmail>[1];
    const registrationRef = { id: 'registration' } as Parameters<typeof enqueueRegistrationEmail>[2];
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
      enqueueRegistrationEmail({ create, update } as unknown as Parameters<typeof enqueueRegistrationEmail>[0], eventRef, registrationRef,
        'intent', type, {}, { contactEmail: 'other@example.test' }, Timestamp.now());
    }
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(collection).not.toHaveBeenCalled();
  });
  for (const enabled of [false, true]) test('create binding and worker metadata: opt-in ' + enabled, async () => {
    installEnv(enabled ? cloud : { GCLOUD_PROJECT: cloud.GCLOUD_PROJECT });
    const { createEventRegistration, updateEventRegistration, cancelEventRegistration } = await import('../functions/src/registrations/callables');
    const { deliverEmailTask } = await import('../functions/src/email/worker');
    expect(createEventRegistration.__endpoint.secretEnvironmentVariables ?? []).toEqual(enabled ? [{ key: 'EMAIL_TOKEN_KEYRING' }] : []);
    expect(updateEventRegistration.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
    expect(cancelEventRegistration.__endpoint.secretEnvironmentVariables ?? []).toEqual([]);
    expect(deliverEmailTask.__endpoint.secretEnvironmentVariables ?? []).toEqual(enabled
      ? ['EMAIL_TOKEN_KEYRING', 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'].map(key => ({ key })) : []);
    // Runtime metadata includes invoker although this SDK's endpoint type omits it.
    expect(deliverEmailTask.__endpoint.taskQueueTrigger).toMatchObject({ invoker: ['private'] });
    expect(sdk.defineSecret).not.toHaveBeenCalled(); expect(sdk.defineString).not.toHaveBeenCalled();
  });
  test('off worker does not access Firestore, task queue, vault or provider', async () => {
    installEnv({ GCLOUD_PROJECT: cloud.GCLOUD_PROJECT });
    const { dispatchRegistrationEmail, deliverEmailTask } = await import('../functions/src/email/worker');
    sdk.firestore.mockClear();
    await dispatchRegistrationEmail.run({ data: { exists: true, data: () => intent() }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    await expect(deliverEmailTask.run({ data: { eventId: 'event', intentId: 'intent' } } as Parameters<typeof deliverEmailTask.run>[0])).rejects.toThrow('disabled');
    expect(sdk.firestore).not.toHaveBeenCalled(); expect(sdk.queue).not.toHaveBeenCalled();
  });
  test('emulator worker never dispatches or delivers cloud tasks', async () => {
    installEnv({ GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: 'localhost:8080' });
    const { dispatchRegistrationEmail, deliverEmailTask } = await import('../functions/src/email/worker');
    sdk.firestore.mockClear();
    await dispatchRegistrationEmail.run({ data: { exists: true, data: () => intent() }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    await expect(deliverEmailTask.run({ data: { eventId: 'event', intentId: 'intent' } } as Parameters<typeof deliverEmailTask.run>[0])).rejects.toThrow('disabled');
    expect(sdk.firestore).not.toHaveBeenCalled(); expect(sdk.queue).not.toHaveBeenCalled();
  });
  test('dispatch only schedules a newly created allowed intent, without scans/backfill', async () => {
    installEnv(cloud);
    const { dispatchRegistrationEmail } = await import('../functions/src/email/worker');
    for (const patch of [{ type: 'event-team-message' }, { recipient: 'other@example.test' }, { createdAt: Timestamp.fromMillis(activation.activatedAtMillis - 1) }]) {
      await dispatchRegistrationEmail.run({ data: { exists: true, data: () => intent(patch) }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    }
    expect(sdk.queue).not.toHaveBeenCalled();
    await dispatchRegistrationEmail.run({ data: { exists: true, data: () => intent() }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    expect(sdk.queue).toHaveBeenCalledExactlyOnceWith('locations/europe-west1/functions/deliverEmailTask');
    expect(sdk.enqueue).toHaveBeenCalledOnce();
  });
  test('delivery rereads the current intent inside lease claim: denied intents cause zero writes/secret reads', async () => {
    installEnv(cloud);
    const { deliverEmailTask } = await import('../functions/src/email/worker');
    const eventRef = {};
    const ref = { path: 'events/event/emailIntents/intent', parent: { parent: eventRef } };
    const update = vi.fn();
    for (const patch of [{ type: 'event-team-message' }, { recipient: 'other@example.test' }, { createdAt: Timestamp.fromMillis(activation.activatedAtMillis - 1) }]) {
      const get = vi.fn(async (selected: unknown) => selected === eventRef ? { data: () => ({ lifecycleStatus: 'ready' }) } : { exists: true, data: () => intent(patch) });
      const runTransaction = vi.fn(async (callback: (tx: { get: typeof get; update: typeof update }) => Promise<unknown>) => callback({ get, update }));
      sdk.firestore.mockReturnValue({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ref }) }) }), runTransaction });
      await deliverEmailTask.run({ data: { eventId: 'event', intentId: 'intent' } } as Parameters<typeof deliverEmailTask.run>[0]);
      expect(get).toHaveBeenCalledTimes(2); expect(runTransaction).toHaveBeenCalledOnce(); expect(update).not.toHaveBeenCalled();
    }
    expect(sdk.defineSecret).not.toHaveBeenCalled(); expect(sdk.queue).not.toHaveBeenCalled();
  });
});
