/* eslint @typescript-eslint/require-await: off -- SDK mocks perform no network IO. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { allowedRegistrationEmailIntent, futurePublicRegistrationEligible, registrationEmailActivation, registrationEmailEnabled, registrationEmailRecipientEligible, registrationEmailSecrets } from '../functions/src/email/runtime';

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
  'REGISTRATION_EMAIL_MODE', 'REGISTRATION_EMAIL_ACTIVATED_AT', 'REGISTRATION_EMAIL_ALLOWED_RECIPIENT', 'REGISTRATION_EMAIL_RECIPIENT_POLICY'];
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
  test('selected policy is the unchanged default; unknown policies fail closed', () => {
    expect(registrationEmailActivation({ ...cloud, REGISTRATION_EMAIL_RECIPIENT_POLICY: 'selected' })).toEqual(activation);
    for (const policy of ['', 'all', '*', 'future']) expect(() => registrationEmailActivation({ ...cloud, REGISTRATION_EMAIL_RECIPIENT_POLICY: policy })).toThrow('configuration-invalid');
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

describe('future public registration email opt-in', () => {
  const futureCloud = { ...cloud, REGISTRATION_EMAIL_RECIPIENT_POLICY: 'future-public-registration' };
  const future = { activatedAtMillis: Date.parse(cutoff), recipientPolicy: 'future-public-registration' as const };
  const createdAt = Timestamp.fromMillis(future.activatedAtMillis);
  const registration = (patch: Record<string, unknown> = {}) => ({ createdAt, managementTokenHash: 'a'.repeat(64), contactEmail: 'new@example.test', ...patch });
  const futureIntent = (patch: Record<string, unknown> = {}) => intent({ recipient: 'new@example.test', recipientPolicy: future.recipientPolicy, registrationCreatedAt: createdAt, ...patch });
  test('only explicit policy widens recipients; old private selected value may remain unused', () => {
    expect(registrationEmailActivation(futureCloud)).toEqual(future);
    expect(registrationEmailActivation({ ...futureCloud, REGISTRATION_EMAIL_ALLOWED_RECIPIENT: undefined })).toEqual(future);
    expect(registrationEmailSecrets(futureCloud)).toEqual(['EMAIL_TOKEN_KEYRING']);
    expect(registrationEmailRecipientEligible('new@example.test', futureCloud)).toBe(true);
    expect(registrationEmailRecipientEligible('new@example.test', cloud)).toBe(false);
    expect(registrationEmailRecipientEligible('bad\r\nBcc: hidden@example.test', futureCloud)).toBe(false);
    expect(() => registrationEmailActivation({ ...futureCloud, GCLOUD_PROJECT: 'foreign-project' })).toThrow('configuration-invalid');
    expect(() => registrationEmailActivation({ ...futureCloud, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow('configuration-invalid');
  });
  test('canonical online registration must originate after cutoff, regardless of fresh operation time', () => {
    expect(futurePublicRegistrationEligible(registration(), future.activatedAtMillis, future)).toBe(true);
    for (const patch of [{ source: 'manual' }, { managementTokenHash: null }, { managementTokenHash: 'client' },
      { createdAt: Timestamp.fromMillis(future.activatedAtMillis - 1) }, { createdAt: undefined },
      { createdAt: Timestamp.fromMillis(future.activatedAtMillis + 1) }]) {
      expect(futurePublicRegistrationEligible(registration(patch), future.activatedAtMillis, future)).toBe(false);
    }
    expect(futurePublicRegistrationEligible(registration(), future.activatedAtMillis - 1, future)).toBe(false);
    expect(futurePublicRegistrationEligible(registration(), future.activatedAtMillis, activation)).toBe(false);
  });
  test('all three types require new server marker and both dates; old backlog and team messages remain denied', () => {
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled']) expect(allowedRegistrationEmailIntent(futureIntent({ type }), future)).toBe(true);
    for (const patch of [{ recipientPolicy: undefined }, { recipientPolicy: 'selected' }, { registrationCreatedAt: undefined },
      { registrationCreatedAt: Timestamp.fromMillis(future.activatedAtMillis - 1) }, { createdAt: Timestamp.fromMillis(future.activatedAtMillis - 1) },
      { registrationCreatedAt: Timestamp.fromMillis(future.activatedAtMillis + 1) }, { type: 'event-team-message' }, { recipient: 'invalid' }]) {
      expect(allowedRegistrationEmailIntent(futureIntent(patch), future)).toBe(false);
    }
    expect(allowedRegistrationEmailIntent(intent(), future)).toBe(false); // Historical selected task, even with the new cutoff timestamp.
    expect(allowedRegistrationEmailIntent(futureIntent(), { ...future, activatedAtMillis: future.activatedAtMillis + 1 })).toBe(false); // New activation never admits an older batch.
    expect(allowedRegistrationEmailIntent(intent(), activation)).toBe(true);
  });
  test('enqueue records server canonical provenance, never creates old/manual messages or summaries', async () => {
    installEnv(futureCloud);
    const { enqueueRegistrationEmail } = await import('../functions/src/email/intent');
    const create = vi.fn(), update = vi.fn(), ref = { id: 'intent' };
    const eventRef = { id: 'event', collection: () => ({ doc: () => ref }) } as unknown as Parameters<typeof enqueueRegistrationEmail>[1];
    const registrationRef = { id: 'registration' } as Parameters<typeof enqueueRegistrationEmail>[2];
    const tx = { create, update } as unknown as Parameters<typeof enqueueRegistrationEmail>[0];
    const event = { title: 'Synthetic', startsAt: createdAt, timeZone: 'Europe/Prague', venue: { name: 'Synthetic', publicLocation: 'Synthetic' } };
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
      expect(enqueueRegistrationEmail(tx, eventRef, registrationRef, 'intent', type, event, registration({ teamName: 'Synthetic', memberCount: 2 }), createdAt)).toBe(true);
      expect(create.mock.lastCall?.[1]).toMatchObject({ type, recipientPolicy: 'future-public-registration', registrationCreatedAt: createdAt, recipient: 'new@example.test' });
    }
    expect(create).toHaveBeenCalledTimes(3); expect(update).toHaveBeenCalledTimes(3); create.mockClear(); update.mockClear();
    for (const patch of [{ source: 'manual' }, { createdAt: Timestamp.fromMillis(future.activatedAtMillis - 1) }, { managementTokenHash: null }]) {
      expect(enqueueRegistrationEmail(tx, eventRef, registrationRef, 'intent', 'registration-updated', event, registration(patch), createdAt)).toBe(false);
    }
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  test('dispatcher denies unmarked old tasks and new changes to old registrations before enqueue', async () => {
    installEnv(futureCloud); const { dispatchRegistrationEmail } = await import('../functions/src/email/worker');
    for (const patch of [{ recipientPolicy: undefined }, { registrationCreatedAt: Timestamp.fromMillis(future.activatedAtMillis - 1) }, { type: 'event-team-message' }]) {
      await dispatchRegistrationEmail.run({ data: { exists: true, data: () => futureIntent(patch) }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    }
    expect(sdk.enqueue).not.toHaveBeenCalled();
    await dispatchRegistrationEmail.run({ data: { exists: true, data: () => futureIntent() }, params: { eventId: 'event', intentId: 'intent' } } as unknown as Parameters<typeof dispatchRegistrationEmail.run>[0]);
    expect(sdk.enqueue).toHaveBeenCalledOnce();
  });
  test('worker rejects old/unmarked/manual-shaped intents without lease writes or provider/vault resolution', async () => {
    installEnv(futureCloud); const { deliverEmailTask } = await import('../functions/src/email/worker');
    const eventRef = {}, ref = { path: 'events/event/emailIntents/intent', parent: { parent: eventRef } }, update = vi.fn();
    for (const patch of [{ recipientPolicy: undefined }, { registrationCreatedAt: Timestamp.fromMillis(future.activatedAtMillis - 1) }, { type: 'event-team-message' }]) {
      const get = vi.fn(async (selected: unknown) => selected === eventRef ? { data: () => ({ lifecycleStatus: 'ready' }) } : { exists: true, data: () => futureIntent(patch) });
      const runTransaction = vi.fn(async (callback: (tx: { get: typeof get; update: typeof update }) => Promise<unknown>) => callback({ get, update }));
      sdk.firestore.mockReturnValue({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ref }) }) }), runTransaction });
      await deliverEmailTask.run({ data: { eventId: 'event', intentId: 'intent' } } as Parameters<typeof deliverEmailTask.run>[0]);
      expect(get).toHaveBeenCalledTimes(2); expect(update).not.toHaveBeenCalled();
    }
    expect(sdk.queue).not.toHaveBeenCalled();
  });
  test('actual public create/update/cancel handlers mint only future canonical provenance and preserve retries/noops', async () => {
    installEnv(futureCloud);
    vi.stubEnv('EMAIL_TOKEN_KEYRING', JSON.stringify({ activeKeyId: 'synthetic', keys: { synthetic: Buffer.alloc(32, 7).toString('base64') } }));
    const { Timestamp: AdminTimestamp } = await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
    const records = new Map<string, Record<string, unknown>>(); let sequence = 0;
    const snapshot = (selected: { path: string }) => ({ id: selected.path.split('/').at(-1), exists: records.has(selected.path), data: () => records.has(selected.path) ? { ...records.get(selected.path)! } : undefined });
    interface FakeReference { id: string; path: string; collection: (name: string) => { doc: (id?: string) => FakeReference } }
    const reference = (selected: string): FakeReference => ({ id: selected.split('/').at(-1)!, path: selected, collection: name => ({ doc: child => reference(selected + '/' + name + '/' + (child ?? 'generated-' + ++sequence)) }) });
    const db = { collection: (name: string) => ({ doc: (child?: string) => reference(name + '/' + (child ?? 'generated-' + ++sequence)) }), doc: reference,
      runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const writes: (() => void)[] = [];
        const tx = { get: async (ref: FakeReference) => snapshot(ref),
          create: (ref: FakeReference, data: Record<string, unknown>) => { expect(records.has(ref.path)).toBe(false); writes.push(() => { records.set(ref.path, data); }); },
          update: (ref: FakeReference, data: Record<string, unknown>) => { writes.push(() => { records.set(ref.path, { ...records.get(ref.path)!, ...data }); }); },
          set: (ref: FakeReference, data: Record<string, unknown>) => { writes.push(() => { records.set(ref.path, data); }); },
          delete: (ref: FakeReference) => { writes.push(() => { records.delete(ref.path); }); } };
        const result = await callback(tx); writes.forEach(write => { write(); }); return result;
      } };
    sdk.firestore.mockReturnValue(db);
    const event = { revision: 1, lifecycleStatus: 'scheduled', registrationPublished: true, registrationOpensAt: AdminTimestamp.fromMillis(future.activatedAtMillis - 60000),
      registrationClosesAt: AdminTimestamp.fromMillis(future.activatedAtMillis + 60000), teamCapacity: 20, peopleCapacity: 40, teamSizeMin: 1, teamSizeMax: 4,
      title: 'Synthetic', startsAt: AdminTimestamp.fromMillis(future.activatedAtMillis + 100000), timeZone: 'Europe/Prague', venue: { name: 'Synthetic', publicLocation: 'Synthetic' } };
    records.set('events/event', event);
    const handlers = await import('../functions/src/registrations/callables');
    const invoke = (name: 'createEventRegistration' | 'updateEventRegistration' | 'cancelEventRegistration', data: Record<string, unknown>) => handlers[name].run({ data } as Parameters<typeof handlers[typeof name]['run']>[0]) as Promise<Record<string, unknown>>;
    const intents = () => [...records].filter(([name]) => /^events\/event\/emailIntents\/[^/]+$/u.test(name)).map(([, data]) => data);
    const secrets = () => [...records.keys()].filter(name => name.includes('/emailSecrets/'));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(future.activatedAtMillis - 1000);
      const oldInput = { eventId: 'event', teamName: 'Old registration', memberCount: 2, contactEmail: 'old@example.test', requestKey: 'a'.repeat(43), recipientPolicy: 'future-public-registration', registrationCreatedAt: createdAt };
      const old = await invoke('createEventRegistration', oldInput);
      expect(intents()).toHaveLength(0); expect(secrets()).toHaveLength(0);
      vi.setSystemTime(future.activatedAtMillis + 1000);
      await invoke('updateEventRegistration', { ...oldInput, teamName: 'Old changed now', registrationId: old.registrationId, token: old.managementToken, requestId: 'old-update', createdAt, registrationCreatedAt: createdAt });
      await invoke('cancelEventRegistration', { eventId: 'event', registrationId: old.registrationId, token: old.managementToken, recipientPolicy: 'future-public-registration', registrationCreatedAt: createdAt });
      expect(intents()).toHaveLength(0); expect(secrets()).toHaveLength(0);
      const input = { eventId: 'event', teamName: 'New registration', memberCount: 2, contactEmail: 'new@example.test', requestKey: 'b'.repeat(43),
        source: 'manual', recipientPolicy: 'selected', registrationCreatedAt: AdminTimestamp.fromMillis(0), createdAt: AdminTimestamp.fromMillis(0) };
      const team = await invoke('createEventRegistration', input), original = intents()[0]!;
      expect(intents()).toHaveLength(1); expect(secrets()).toHaveLength(1); expect(original.recipientPolicy).toBe('future-public-registration');
      expect((original.registrationCreatedAt as { toMillis: () => number }).toMillis()).toBe(future.activatedAtMillis + 1000);
      expect(team).not.toHaveProperty('recipientPolicy'); expect(team).not.toHaveProperty('registrationCreatedAt');
      const replay = await invoke('createEventRegistration', input);
      expect(replay.registrationId).toBe(team.registrationId); expect(replay.managementToken === team.managementToken).toBe(true); expect(intents()).toHaveLength(1); expect(secrets()).toHaveLength(1);
      const managed = { eventId: 'event', registrationId: team.registrationId, token: team.managementToken, teamName: input.teamName, memberCount: 2, contactEmail: input.contactEmail };
      await invoke('updateEventRegistration', { ...managed, requestId: 'noop' }); expect(intents()).toHaveLength(1);
      const changed = { ...managed, teamName: 'New changed', requestId: 'change' };
      await invoke('updateEventRegistration', changed); await invoke('updateEventRegistration', changed); expect(intents()).toHaveLength(2);
      await invoke('cancelEventRegistration', managed); await invoke('cancelEventRegistration', managed); expect(intents()).toHaveLength(3);
      expect(intents().map(value => value.type)).toEqual(['registration-confirmed', 'registration-updated', 'registration-cancelled']);
      expect(intents().every(value => allowedRegistrationEmailIntent(value, future))).toBe(true);
    } finally { vi.useRealTimers(); }
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
