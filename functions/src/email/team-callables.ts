import { accessActor, securedOnCall, runAccessTransaction } from '../access/authorization.js';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import type { EventTeamEmailIntent } from './intent.js';
import { deliverySummary, MAX_ACCEPTED_ROSTER, MAX_TEAM_MESSAGE_RECIPIENTS, messageCopy, messageId, messageInput,
  recipientSnapshot, teamMessageEventTitle, teamMessageHash, type TeamMessageContent } from './team-message.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
function admin(request: CallableRequest): Promise<string> {
  return Promise.resolve(accessActor(request.auth).uid);
}
const eventRef = (id: string) => getFirestore().collection('events').doc(id);
async function previewIn(transaction: Transaction, eventId: string, uid: string, copy: Pick<TeamMessageContent, 'subject' | 'message'>) {
  const ref = eventRef(eventId), event = (await transaction.get(ref)).data();
  // Follow the existing manual-team operational lifecycle; no new post-event workflow.
  if (!event || !['draft', 'scheduled', 'ready', 'live'].includes(event.lifecycleStatus as string)) throw new HttpsError('failed-precondition', 'V tomto stavu akce nelze vytvořit zprávu týmům.');
  const eventTitle = teamMessageEventTitle(event.title);
  const rows = await transaction.get(ref.collection('registrations').where('status', '==', 'accepted')
    .select('eventId', 'status', 'contactEmail').limit(MAX_ACCEPTED_ROSTER + 1));
  const recipients = recipientSnapshot(eventId, rows.docs.map(doc => ({ id: doc.id, data: doc.data() })));
  const content = { ...copy, eventTitle };
  return { content, recipients, previewFingerprint: teamMessageHash([eventId, uid, content, recipients]) };
}
function metadata(id: string, data: Record<string, unknown>) {
  const content = data.content as TeamMessageContent;
  return { campaignId: id, eventId: data.eventId as string, subject: content.subject, message: content.message, eventTitle: content.eventTitle,
    total: data.total as number, createdAt: (data.createdAt as Timestamp).toDate().toISOString() };
}
const copyFields = ['eventId', 'subject', 'message'];
export const previewEventTeamMessage = securedOnCall('previewEventTeamMessage', options, async request => {
  const data = messageInput(request.data, copyFields), id = messageId(data.eventId), copy = messageCopy(data);
  return runAccessTransaction(getFirestore(), async transaction => {
    const uid = await admin(request), preview = await previewIn(transaction, id, uid, copy);
    return { ...preview.content, total: preview.recipients.length, previewFingerprint: preview.previewFingerprint };
  });
});
export const createEventTeamMessage = securedOnCall('createEventTeamMessage', options, async request => {
  const data = messageInput(request.data, [...copyFields, 'requestId', 'previewFingerprint', 'confirmed']);
  const id = messageId(data.eventId), requestId = messageId(data.requestId), copy = messageCopy(data);
  if (data.confirmed !== true || typeof data.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(data.previewFingerprint)) throw new HttpsError('invalid-argument', 'Nejdřív zobrazte a potvrďte náhled.');
  return runAccessTransaction(getFirestore(), async transaction => {
    const uid = await admin(request), ref = eventRef(id), campaignId = teamMessageHash([id, uid, requestId]);
    const campaignRef = ref.collection('emailCampaigns').doc(campaignId);
    const previous = (await transaction.get(campaignRef)).data(), fingerprint = teamMessageHash(copy);
    // Auth is fresh, but a receipt replay must not reselect today's roster or reopen mail.
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.createdBy !== uid) throw new HttpsError('already-exists', 'Toto ID požadavku už bylo použito s jiným obsahem.');
      return metadata(campaignId, previous);
    }
    const preview = await previewIn(transaction, id, uid, copy);
    if (data.previewFingerprint !== preview.previewFingerprint) throw new HttpsError('aborted', 'Soupiska nebo obsah se změnily. Zobrazte nový náhled.');
    if (!preview.recipients.length) throw new HttpsError('failed-precondition', 'Akce nemá přijaté týmy s emailem.');
    const now = Timestamp.now();
    const campaign = { eventId: id, content: preview.content, total: preview.recipients.length, createdBy: uid, createdAt: now, fingerprint };
    transaction.create(campaignRef, campaign);
    for (const recipient of preview.recipients) {
      const intentId = teamMessageHash([campaignId, recipient.registrationId]);
      const intent: EventTeamEmailIntent = { eventId: id, registrationId: recipient.registrationId, recipient: recipient.recipient,
        type: 'event-team-message', campaignId, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, sentAt: null,
        lastError: null, leaseId: null, leaseUntil: null, nextAttemptAt: null };
      transaction.create(ref.collection('emailIntents').doc(intentId), intent);
    }
    return metadata(campaignId, campaign);
  });
});
export const listEventTeamMessages = securedOnCall('listEventTeamMessages', options, async request => {
  await admin(request);
  const data = messageInput(request.data, ['eventId']), id = messageId(data.eventId), ref = eventRef(id);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Akce neexistuje.');
  const campaigns = await ref.collection('emailCampaigns').orderBy('createdAt', 'desc').limit(20).get();
  return campaigns.docs.map(doc => metadata(doc.id, doc.data()));
});
export const getEventTeamMessage = securedOnCall('getEventTeamMessage', options, async request => {
  const data = messageInput(request.data, ['eventId', 'campaignId']), id = messageId(data.eventId), campaignId = messageId(data.campaignId);
  return runAccessTransaction(getFirestore(), async transaction => {
    await admin(request);
    const ref = eventRef(id), campaign = (await transaction.get(ref.collection('emailCampaigns').doc(campaignId))).data();
    if (!campaign || campaign.eventId !== id) throw new HttpsError('not-found', 'Zpráva neexistuje.');
    const intents = await transaction.get(ref.collection('emailIntents').where('campaignId', '==', campaignId).limit(MAX_TEAM_MESSAGE_RECIPIENTS + 1));
    if (intents.size !== campaign.total || intents.size > MAX_TEAM_MESSAGE_RECIPIENTS) throw new HttpsError('failed-precondition', 'Souhrn zprávy není úplný.');
    return { ...metadata(campaignId, campaign), ...deliverySummary(intents.docs.map(doc => doc.data().status as unknown)) };
  });
});
