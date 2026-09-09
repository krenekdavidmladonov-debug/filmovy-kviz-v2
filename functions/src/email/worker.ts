import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { cloudEmailOrigin, cloudGmailTransport, emailEmulatorRuntime, gmailWorkerSecrets, registrationTokenVault } from './config.js';
import { enqueueEmailTask, processEmailTask } from './task.js';

if (getApps().length === 0) initializeApp();
const region = 'europe-west1';

export const dispatchRegistrationEmail = onDocumentCreated({
  document: 'events/{eventId}/emailIntents/{intentId}', region, retry: true,
}, async event => {
  // Local contract/browser tests drive processEmailTask with injected fake Gmail.
  // Never allow an emulator to call cloud Tasks or obtain Gmail credentials.
  if (emailEmulatorRuntime()) return;
  if (!event.data?.exists) return;
  await enqueueEmailTask(getFunctions().taskQueue('locations/' + region + '/functions/deliverEmailTask'),
    { eventId: event.params.eventId, intentId: event.params.intentId });
});

export const deliverEmailTask = onTaskDispatched({
  region, timeoutSeconds: 60, secrets: gmailWorkerSecrets,
  retryConfig: { maxAttempts: 20, minBackoffSeconds: 120, maxBackoffSeconds: 600, maxDoublings: 3, maxRetrySeconds: 86400 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, async request => {
  if (emailEmulatorRuntime()) throw new Error('Use the injected local email task fixture.');
  await processEmailTask(request.data, { db: getFirestore(), transport: cloudGmailTransport, vault: registrationTokenVault, origin: cloudEmailOrigin });
});
