import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { initializeApp as clientApp, deleteApp as deleteClient } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { permissions, rolePresets } from '../../packages/quiz-domain/lib/access.js';

const { projectId, authEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(process.env, 'Personal access tests');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), db = getFirestore(app), auth = adminAuth(app);
const prefix = 'access-' + randomBytes(5).toString('hex'), password = randomBytes(24).toString('base64url') + '!';
const accounts = [], documents = [];
let passed = 0;
const none = () => ({ mode: 'none', ids: [] }), all = () => ({ mode: 'all', ids: [] });
const selected = ids => ({ mode: 'selected', ids });
const quizA = prefix + '-a', quizB = prefix + '-b', eventA = prefix + '-event-a', eventB = prefix + '-event-b';
async function put(path, data) { await db.doc(path).set(data); documents.push(path); }
async function account(label, grant, emailVerified = true, claims = {}) {
  const uid = `${prefix}-${label}`, email = `${uid}@example.test`;
  await auth.createUser({ uid, email, emailVerified, password, displayName: label });
  await auth.setCustomUserClaims(uid, claims);
  if (grant) await put(`memberships/${uid}`, { ...grant, uid, email, displayName: label, status: 'active', version: 1, sessionValidAfter: 0 });
  const app = clientApp({ projectId, apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com` }, uid);
  const identity = getAuth(app); connectAuthEmulator(identity, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);
  await signInWithEmailAndPassword(identity, email, password);
  const result = { uid, email, app, identity, call: async (name, data = {}) => (await httpsCallable(functions, name)(data)).data };
  accounts.push(result); return result;
}
async function denied(action, code = 'functions/permission-denied') { await assert.rejects(action, error => error.code === code); }
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
const payload = slide => Object.fromEntries(['kind', 'title', 'text', 'moderatorNote', 'options', 'correctAnswer', 'media', 'presentation', 'backgroundImage', 'questionImage', 'answerImage', 'mediaSource', 'backgroundOverlay', 'clipStartSeconds', 'clipEndSeconds', 'authoringStatus', 'answerMode', 'imageLayout', 'answerExplanation'].filter(k => slide[k] !== undefined).map(k => [k, slide[k]]));
try {
  await db.doc('accessControl/state').set({ collaborationEnabled: true, revision: 0 });
  const owner = await account('owner', { role: 'owner', permissions, quizzes: all(), events: all() });
  const creator = await account('creator', { role: 'creator', permissions: [...rolePresets.creator], quizzes: selected([quizA]), events: none() });
  const structure = await account('structure', { role: 'creator', permissions: ['quiz.read', 'quiz.edit'], quizzes: selected([quizA]), events: none() });
  const moderator = await account('moderator', { role: 'moderator', permissions: [...rolePresets.moderator], quizzes: none(), events: selected([eventA]) });
  const referee = await account('referee', { role: 'referee', permissions: [...rolePresets.referee], quizzes: none(), events: selected([eventA]) });
  const viewer = await account('viewer', { role: 'viewer', permissions: [...rolePresets.viewer], quizzes: selected([quizA]), events: selected([eventA]) }, true, { role: 'admin' });
  const manager = await account('manager', { role: 'manager', permissions, quizzes: selected([quizA]), events: selected([eventA]) });
  const legacy = await account('legacy-admin', null, true, { role: 'admin' });
  for (const id of [quizA, quizB]) {
    await put(`quizzes/${id}`, { title: id, description: '', status: 'draft', revision: 1, slideCount: 2, roundCount: 1, questionCount: 1, createdBy: creator.uid, updatedBy: owner.uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await put(`quizzes/${id}/rounds/round`, { title: 'Round', position: 1, type: 'classic', questionCount: 1, slideCount: 2 });
    await put(`quizzes/${id}/slides/header`, { kind: 'round', title: 'Round', position: 1, roundId: 'round', isQuestion: false });
    await put(`quizzes/${id}/slides/question`, { kind: 'text', title: 'Question', text: 'Prompt', position: 2, roundId: 'round', isQuestion: true, authoringStatus: 'ready', answerMode: 'open', options: [],
      correctAnswer: 'ANSWER_PRIVATE_SENTINEL', moderatorNote: 'NOTE_PRIVATE_SENTINEL', answerExplanation: 'EXPLANATION_PRIVATE_SENTINEL', legacy: { raw: { value: 'RAW_PRIVATE_SENTINEL' } }, unknownExtension: { keep: true } });
    await put(`quizzes/${id}/rounds/round/questions/question`, { prompt: 'Prompt', type: 'text', position: 1, correctAnswer: 'ANSWER_PRIVATE_SENTINEL' });
  }
  for (const id of [eventA, eventB]) {
    const snapshotId = id + '-snapshot';
    await put(`events/${id}`, { title: id, startsAt: Timestamp.now(), timeZone: 'Europe/Prague', venue: { name: 'Local venue', publicLocation: 'Local' }, teamCapacity: 10, peopleCapacity: 50, teamSizeMin: 1, teamSizeMax: 5,
      acceptedTeams: 1, acceptedPeople: 2, revision: 1, createdBy: owner.uid, registrationPublished: false, registrationStatus: 'closed', lifecycleStatus: 'ready', scoring: { unitScale: 2, rankingMode: 'dense', started: false },
      quizAssignment: { quizId: quizA, quizRevision: 1, snapshotId, quizTitle: 'Snapshot', roundCount: 1, questionCount: 1, lockedAt: Timestamp.now() } });
    await put(`quizSnapshots/${snapshotId}`, { quizId: quizA, slideCount: 2, title: 'Snapshot' });
    await put(`quizSnapshots/${snapshotId}/rounds/round`, { title: 'Round', position: 1 });
    await put(`quizSnapshots/${snapshotId}/slides/question`, (await db.doc(`quizzes/${quizA}/slides/question`).get()).data());
    await put(`events/${id}/registrations/team`, { eventId: id, teamName: 'Synthetic team', status: 'accepted', contactEmail: 'CONTACT_PRIVATE_SENTINEL@example.test', memberCount: 2, source: 'online', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  }
  await test('legacy admin claim without membership is denied', () => denied(() => legacy.call('createQuiz', { title: 'Denied', requestId: prefix })));
  await test('scoped query returns A only; B cannot be read by guessing its URL', async () => {
    const rows = await creator.call('readAccessData', { operation: 'quizzes' }); assert.deepEqual(rows.map(r => r.id), [quizA]);
    await denied(() => creator.call('readAccessData', { operation: 'editor', quizId: quizB }));
  });
  await test('all legacy quiz mutations reject a foreign quiz before business validation', async () => {
    for (const name of ['updateQuizMetadata', 'updateQuizSlide', 'createQuizSlide', 'duplicateQuizSlide', 'deleteQuizSlide', 'moveQuizSlide', 'updateQuizRound', 'reorderQuizQuestion', 'moveQuizQuestionToRound', 'duplicateQuizRound', 'moveQuizRound', 'removeQuizRound', 'repairQuizPreflightIssue', 'createQuizRound', 'beginQuizMediaUpload', 'finalizeQuizMediaUpload']) {
      await denied(() => creator.call(name, { quizId: quizB, expectedRevision: 1, kind: 'video-timing' }));
    }
  });
  await test('viewer with stale admin claim receives no private answer, note, raw, or contact', async () => {
    const malformed = db.doc(`quizzes/${quizA}/slides/question`);
    await malformed.update({ mediaSource: [{ raw: 'RAW_PRIVATE_SENTINEL' }] });
    for (const request of [{ operation: 'editor', quizId: quizA }, { operation: 'quiz', quizId: quizA }, { operation: 'snapshotSlides', snapshotId: eventA + '-snapshot' }, { operation: 'roster', eventId: eventA }]) {
      const response = JSON.stringify(await viewer.call('readAccessData', request));
      for (const secret of ['ANSWER_PRIVATE_SENTINEL', 'NOTE_PRIVATE_SENTINEL', 'RAW_PRIVATE_SENTINEL', 'EXPLANATION_PRIVATE_SENTINEL', 'CONTACT_PRIVATE_SENTINEL']) assert.equal(response.includes(secret), false);
    }
    await denied(() => viewer.call('readAccessData', { operation: 'registrations', eventId: eventA }));
    await denied(() => viewer.call('updateQuizMetadata', { quizId: quizA }));
    await malformed.update({ mediaSource: FieldValue.delete() });
  });
  await test('redacted structure save preserves exact unseen and legacy fields', async () => {
    const before = (await db.doc(`quizzes/${quizA}/slides/question`).get()).data();
    const quiz = await structure.call('readAccessData', { operation: 'editor', quizId: quizA });
    const slide = quiz.slides.find(s => s.id === 'question');
    await structure.call('updateQuizSlide', { quizId: quizA, slideId: slide.id, expectedRevision: quiz.revision, slide: { ...payload(slide), text: 'Edited prompt' } });
    const after = (await db.doc(`quizzes/${quizA}/slides/question`).get()).data();
    for (const key of ['correctAnswer', 'moderatorNote', 'answerExplanation', 'legacy', 'unknownExtension']) assert.deepEqual(after[key], before[key]);
    await denied(() => structure.call('updateQuizSlide', { quizId: quizA, slideId: slide.id, expectedRevision: quiz.revision + 1, slide: { ...payload(slide), correctAnswer: 'Forged answer' } }));
  });
  await test('event-only actors cannot read source quiz or another event snapshot', async () => {
    const rows = await moderator.call('readAccessData', { operation: 'snapshotSlides', snapshotId: eventA + '-snapshot' }); assert.equal(rows[0].correctAnswer, 'ANSWER_PRIVATE_SENTINEL');
    await denied(() => moderator.call('readAccessData', { operation: 'editor', quizId: quizA }));
    await denied(() => moderator.call('readAccessData', { operation: 'snapshotSlides', snapshotId: eventB + '-snapshot' }));
    for (const name of ['updateEvent', 'cancelEvent', 'archiveEvent', 'configureEventRegistration', 'adminAddEventTeam', 'adminUpdateEventTeam', 'adminCancelEventRegistration', 'createEventLiveSession', 'previewInterimResults', 'controlInterimResults', 'previewFinalResults', 'controlFinalReveal', 'listRefereeAccess', 'issueRefereeAccess', 'changeRefereeAccess', 'previewEventTeamMessage', 'createEventTeamMessage', 'listEventTeamMessages', 'getEventTeamMessage']) await denied(() => moderator.call(name, { eventId: eventB }));
  });
  await test('snapshot export cannot turn event-note access into forbidden source-note access', async () => {
    const exporter = await account('restricted-exporter', { role: 'manager', permissions: ['quiz.read', 'quiz.export', 'quiz.answers.read', 'event.read', 'event.manage', 'event.notes.read'], quizzes: selected([quizA]), events: selected([eventA]) });
    const before = (await db.doc(`events/${eventA}`).get()).get('quizAssignment');
    await denied(() => exporter.call('lockEventQuiz', { quizId: quizA, eventId: eventA, expectedRevision: 1, expectedQuizRevision: 2, acknowledgeWarnings: true }));
    assert.deepEqual((await db.doc(`events/${eventA}`).get()).get('quizAssignment'), before);
  });
  await test('referee scores only assigned event; viewer cannot score', async () => {
    const score = { eventId: eventA, snapshotId: eventA + '-snapshot', teamId: 'team', roundId: 'round', requestId: prefix, expectedRevision: 0, halfPoints: 4, reason: '' };
    await referee.call('saveEventScore', score);
    await denied(() => referee.call('saveEventScore', { ...score, eventId: eventB }));
    await denied(() => viewer.call('saveEventScore', score));
  });
  await test('live permission alone cannot disclose hidden answers through reveal or recap', async () => {
    const transport = await account('transport-only', { role: 'moderator', permissions: ['event.read', 'event.live'], quizzes: none(), events: selected([eventA]) });
    const sessionId = prefix + '-restricted-session'; await put(`sessions/${sessionId}`, { eventId: eventA, quizId: quizA });
    for (const name of ['revealAnswer', 'selectRecapQuestion']) await denied(() => transport.call(name, { sessionId, expectedRevision: 0, position: 2 }));
  });
  await test('self escalation and delegation outside manager scope are rejected', async () => {
    const own = await manager.call('getMyAccess');
    await denied(() => manager.call('updateAccessMembership', { uid: manager.uid, expectedVersion: 1, status: 'active', grant: { role: 'manager', permissions, quizzes: all(), events: all() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-outside@example.test`, grant: { role: 'creator', permissions: rolePresets.creator, quizzes: selected([quizB]), events: none() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-owner@example.test`, grant: { role: 'owner', permissions: own.member.permissions, quizzes: none(), events: none() } }));
    await denied(() => creator.call('deleteQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: 2 }));
    await denied(() => creator.call('deleteQuizSlide', { quizId: quizA, slideId: 'question', expectedRevision: 2, mode: 'move' }));
    await denied(() => creator.call('removeQuizRound', { quizId: quizA, roundId: 'round', expectedRevision: 2, mode: 'move', targetRoundId: 'other' }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-manager@example.test`, grant: { role: 'manager', permissions: ['users.manage'], quizzes: none(), events: none() } }));
    await denied(() => manager.call('createAccessInvitation', { email: `${prefix}-hidden-manager@example.test`, grant: { role: 'creator', permissions: ['users.manage'], quizzes: none(), events: none() } }));
  });
  await test('own-scope manager delegates only resources with authoritative matching ownership', async () => {
    const ownManager = await account('own-manager', { role: 'manager', permissions, quizzes: { mode: 'own', ids: [] }, events: none() });
    const resourceId = prefix + '-owned'; await put(`quizzes/${resourceId}`, { createdBy: ownManager.uid });
    const recipient = await account('owned-recipient', null);
    const ownGrant = { role: 'viewer', permissions: ['quiz.read'], quizzes: selected([resourceId]), events: none() };
    const invite = await ownManager.call('createAccessInvitation', { email: recipient.email, grant: ownGrant }); documents.push(`accessInvites/${invite.inviteId}`);
    await denied(() => ownManager.call('createAccessInvitation', { email: `${prefix}-foreign-own@example.test`, grant: { ...ownGrant, quizzes: selected([quizA]) } }));
    await db.doc(`quizzes/${resourceId}`).update({ createdBy: owner.uid });
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    await db.doc(`quizzes/${resourceId}`).update({ createdBy: ownManager.uid });
    await recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }); documents.push(`memberships/${recipient.uid}`);
    assert.deepEqual((await db.doc(`memberships/${recipient.uid}`).get()).get('quizzes'), selected([resourceId]));
  });
  const invited = await account('invited', null), wrong = await account('wrong-email', null), unverified = await account('unverified', null, false);
  const grant = { role: 'creator', permissions: rolePresets.creator, quizzes: selected([quizA]), events: none() };
  let invitation;
  await test('invitation stores hash only and leaves the issuing administrator session unchanged', async () => {
    const uid = owner.identity.currentUser.uid;
    invitation = await owner.call('createAccessInvitation', { email: invited.email, grant });
    documents.push(`accessInvites/${invitation.inviteId}`);
    const stored = (await db.doc(`accessInvites/${invitation.inviteId}`).get()).data();
    assert.ok(stored.tokenHash); assert.equal(JSON.stringify(stored).includes(invitation.token), false);
    assert.equal(owner.identity.currentUser.uid, uid);
    assert.ok(stored.expiresAt > Date.now() + 6 * 86400000);
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
    await denied(() => unverified.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
  });
  await test('reissue invalidates old token; concurrent acceptance succeeds once for an existing Auth identity', async () => {
    const renewed = await owner.call('changeAccessInvitation', { inviteId: invitation.inviteId, expectedVersion: 1, action: 'reissue' });
    await denied(() => invited.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: invitation.token }));
    const results = await Promise.allSettled([1, 2].map(() => invited.call('acceptAccessInvitation', { inviteId: invitation.inviteId, token: renewed.token, grant: { role: 'owner' } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    documents.push(`memberships/${invited.uid}`);
    const actual = (await db.doc(`memberships/${invited.uid}`).get()).data(); assert.equal(actual.role, 'creator'); assert.deepEqual(actual.quizzes, selected([quizA])); assert.equal(actual.permissions.includes('quiz.delete'), false);
  });
  await test('revoked and expired invitations fail closed', async () => {
    const invite = await owner.call('createAccessInvitation', { email: wrong.email, grant }); documents.push(`accessInvites/${invite.inviteId}`);
    await owner.call('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: 1, action: 'revoke' });
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    const next = await owner.call('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: 2, action: 'reissue' });
    await db.doc(`accessInvites/${invite.inviteId}`).update({ expiresAt: Date.now() - 1 });
    await denied(() => wrong.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: next.token }));
  });
  await test('invitation activation gate and current issuer revocation are enforced transactionally', async () => {
    const recipient = await account('paused-invite', null);
    const invite = await manager.call('createAccessInvitation', { email: recipient.email, grant }); documents.push(`accessInvites/${invite.inviteId}`);
    await db.doc('accessControl/state').update({ collaborationEnabled: false });
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }), 'functions/failed-precondition');
    await denied(() => owner.call('createAccessInvitation', { email: `${prefix}-paused@example.test`, grant }), 'functions/failed-precondition');
    await db.doc('accessControl/state').update({ collaborationEnabled: true });
    const current = (await db.doc(`memberships/${manager.uid}`).get()).data();
    const managerGrant = { role: current.role, permissions: current.permissions, quizzes: current.quizzes, events: current.events };
    await owner.call('updateAccessMembership', { uid: manager.uid, expectedVersion: current.version, status: 'suspended', grant: managerGrant });
    await denied(() => recipient.call('acceptAccessInvitation', { inviteId: invite.inviteId, token: invite.token }));
    assert.equal((await db.doc(`memberships/${recipient.uid}`).get()).exists, false);
  });
  await test('suspension rejects an old token for read, save and upload', async () => {
    const oldToken = await creator.identity.currentUser.getIdToken();
    await owner.call('updateAccessMembership', { uid: creator.uid, expectedVersion: 1, status: 'suspended', grant });
    assert.equal(await creator.identity.currentUser.getIdToken() === oldToken, true);
    await denied(() => creator.call('readAccessData', { operation: 'editor', quizId: quizA }));
    await denied(() => creator.call('updateQuizMetadata', { quizId: quizA, expectedRevision: 2, quiz: { title: 'Late save', description: '' } }));
    await denied(() => creator.call('beginQuizMediaUpload', { quizId: quizA }));
  });
  await test('a new quiz is explicitly added to a creator scope that started empty', async () => {
    const fresh = await account('new-creator', { ...grant, quizzes: selected([]) });
    const created = await fresh.call('createQuiz', { title: 'New authorized quiz', requestId: prefix }); documents.push(`quizzes/${created.quizId}`);
    const read = await fresh.call('readAccessData', { operation: 'editor', quizId: created.quizId }); assert.equal(read.id, created.quizId);
  });
  await test('concurrent owner removal cannot leave zero active owners', async () => {
    const second = await account('second-owner', { role: 'owner', permissions, quizzes: all(), events: all() });
    const demotion = { role: 'manager', permissions, quizzes: all(), events: all() };
    const results = await Promise.allSettled([owner.call('updateAccessMembership', { uid: second.uid, expectedVersion: 1, status: 'suspended', grant: demotion }), second.call('updateAccessMembership', { uid: owner.uid, expectedVersion: 1, status: 'suspended', grant: demotion })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const owners = await db.collection('memberships').where('role', '==', 'owner').where('status', '==', 'active').get(); assert.equal(owners.size, 1);
  });
  console.log(`Personal access emulator contracts: ${passed} passed. No credentials or invitation tokens logged.`);
} finally {
  for (const account of accounts) { await deleteClient(account.app); await auth.deleteUser(account.uid).catch(() => {}); }
  for (const path of [...new Set(documents)].reverse()) await db.recursiveDelete(db.doc(path));
  const audit = await db.collection('accessAudit').get();
  for (const entry of audit.docs) if (String(entry.data().actorUid).startsWith(prefix)) await entry.ref.delete();
  await deleteApp(app);
}
