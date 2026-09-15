import { getFirestore, Timestamp, type DocumentSnapshot, type Query, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { mapEditorQuiz, mapEditorSlide, quizAssetReference, type Membership } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, type AuthIdentity, type Resource } from './authorization.js';

const db = () => getFirestore();
export function pick(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(k => data[k] === null || data[k] instanceof Timestamp || ['string', 'boolean', 'number'].includes(typeof data[k])).map(k => [k, data[k]]));
}
export function wire(value: unknown): unknown {
  if (value instanceof Timestamp) return { $timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, wire(v)]));
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1500 || value.includes('/')) throw new HttpsError('invalid-argument', 'Neplatný identifikátor.');
  return value;
}
function stored(doc: DocumentSnapshot) {
  const data = doc.data();
  if (!data) throw new HttpsError('not-found', 'Obsah není dostupný.');
  return data;
}
const quizFields = ['title', 'description', 'status', 'revision', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'roundCount', 'questionCount', 'slideCount'];
const roundFields = ['title', 'type', 'position', 'questionCount', 'slideCount'];
const eventFields = ['title', 'startsAt', 'timeZone', 'teamCapacity', 'peopleCapacity', 'teamSizeMin', 'teamSizeMax', 'acceptedTeams', 'acceptedPeople', 'registrationPublished', 'registrationOpensAt', 'registrationClosesAt', 'registrationStatus', 'lifecycleStatus', 'revision', 'liveSessionId', 'createdBy'];
function eventView(data: Record<string, unknown>) {
  return { ...pick(data, eventFields), venue: pick((data.venue ?? {}) as Record<string, unknown>, ['name', 'publicLocation']),
    scoring: pick((data.scoring ?? {}) as Record<string, unknown>, ['unitScale', 'rankingMode', 'started']),
    quizAssignment: data.quizAssignment ? pick(data.quizAssignment as Record<string, unknown>, ['quizId', 'quizRevision', 'snapshotId', 'quizTitle', 'roundCount', 'questionCount', 'lockedAt']) : null };
}
export function slideView(slideId: string, data: Record<string, unknown>, answers: boolean, notes: boolean) {
  // Shared mapper is an allowlist; no legacy/raw extension can enter the response.
  const safeData = { ...data };
  // Legacy objects in nominal text fields must never serialize hidden nested metadata.
  for (const key of ['title', 'text']) if (typeof safeData[key] !== 'string') safeData[key] = '';
  if (Array.isArray(safeData.options)) safeData.options = safeData.options.map((value: unknown) => typeof value === 'string' ? value : '');
  const slide = mapEditorSlide(slideId, safeData);
  return { ...slide, correctAnswer: answers ? slide.correctAnswer : '', answerImage: answers ? slide.answerImage : '',
    answerExplanation: answers ? slide.answerExplanation : '', moderatorNote: notes ? slide.moderatorNote : '',
    media: slide.media.filter(m => (m.role === 'prompt' || m.role === 'background' || (answers && m.role === 'answer'))),
    presentation: { ...slide.presentation, answerOverlay: answers ? slide.presentation.answerOverlay : null } };
}
async function scopedList(tx: Transaction, kind: 'quiz' | 'event', member: Membership) {
  const scope = kind === 'quiz' ? member.quizzes : member.events;
  const collection = db().collection(kind === 'quiz' ? 'quizzes' : 'events');
  if (scope.mode === 'none' || (scope.mode === 'selected' && !scope.ids.length)) return [];
  if (scope.mode === 'selected') {
    const docs = await tx.getAll(...scope.ids.map(value => collection.doc(value)));
    return docs.filter(d => d.exists);
  }
  const query: Query = scope.mode === 'own' ? collection.where('createdBy', '==', member.uid) : collection;
  const result = await tx.get(query.limit(501));
  if (result.size > 500) throw new HttpsError('resource-exhausted', 'Knihovna je příliš velká pro tento přehled.');
  return result.docs;
}
/** An event authorizes only its assigned immutable snapshot, never the source quiz. */
export async function snapshotResource(auth: AuthIdentity, snapshotId: string, tx: Transaction): Promise<Resource> {
  const matches = await tx.get(db().collection('events').where('quizAssignment.snapshotId', '==', snapshotId).limit(2));
  if (matches.size !== 1) throw new HttpsError('permission-denied', 'Připravený kvíz není dostupný.');
  const resource: Resource = { kind: 'event', id: matches.docs[0]!.id };
  await authorize(auth, ['event.read'], resource, tx);
  return resource;
}
export const readAccessData = onCall({ region: 'europe-west1', cors: true, maxInstances: 20 }, async request => {
  await freshIdentity(request.auth);
  const data = request.data as Record<string, unknown>;
  if (!data || typeof data.operation !== 'string') throw new HttpsError('invalid-argument', 'Chybí typ načtení.');
  return db().runTransaction(async tx => {
    if (data.operation === 'quizzes' || data.operation === 'events') {
      const kind = data.operation === 'quizzes' ? 'quiz' : 'event';
      const member = await authorize(request.auth, [kind === 'quiz' ? 'quiz.read' : 'event.read'], undefined, tx);
      const docs = await scopedList(tx, kind, member);
      return wire(docs.map(d => ({ id: d.id, data: kind === 'quiz' ? pick(stored(d), quizFields) : eventView(stored(d)) })));
    }
    if (['editor', 'quiz', 'quizSlides', 'mediaAssets'].includes(String(data.operation))) {
      const quizId = id(data.quizId), resource: Resource = { kind: 'quiz', id: quizId };
      const member = await authorize(request.auth, ['quiz.read'], resource, tx);
      const ref = db().doc(`quizzes/${quizId}`), root = stored(await tx.get(ref));
      const slides = await tx.get(ref.collection('slides').orderBy('position').limit(401));
      if (slides.size > 400) throw new HttpsError('resource-exhausted', 'Kvíz je příliš velký.');
      const mapped = slides.docs.map(d => slideView(d.id, d.data(), member.permissions.includes('quiz.answers.read'), member.permissions.includes('quiz.notes.read')));
      if (data.operation === 'quizSlides') return wire(mapped);
      if (data.operation === 'mediaAssets') {
        const assets = await tx.get(ref.collection('mediaAssets').limit(201));
        if (assets.size > 200) throw new HttpsError('resource-exhausted', 'Příliš mnoho médií.');
        const visibleSources = new Set(mapped.flatMap(s => [s.backgroundImage, s.questionImage, s.answerImage, s.mediaSource, ...s.media.map(m => m.source)]));
        return wire(assets.docs.filter(d => member.permissions.includes('quiz.answers.read') || visibleSources.has(quizAssetReference(quizId, d.id))).map(d => ({ id: d.id, data: pick(d.data(), ['quizId', 'assetId', 'kind', 'contentType', 'size', 'status', 'createdBy', 'createdAt', 'generation']) })));
      }
      const rounds = await tx.get(ref.collection('rounds').orderBy('position').limit(401));
      const titles = new Map(rounds.docs.map(d => [d.id, String(d.data().title ?? '')]));
      if (data.operation === 'editor') return wire(mapEditorQuiz(quizId, root, mapped.map(s => s.roundTitle !== undefined || !s.roundId ? s : { ...s, roundTitle: titles.get(s.roundId) })));
      const roundViews = [];
      for (const round of rounds.docs) {
        const questions = await tx.get(round.ref.collection('questions').orderBy('position').limit(401));
        roundViews.push({ id: round.id, data: pick(round.data(), roundFields), questions: questions.docs.map(q => ({ id: q.id, data: pick(q.data(), ['prompt', 'type', 'position']) })) });
      }
      return wire({ id: quizId, data: pick(root, quizFields), rounds: roundViews });
    }
    if (data.operation === 'snapshotRounds' || data.operation === 'snapshotSlides') {
      const snapshotId = id(data.snapshotId), resource = await snapshotResource(request.auth, snapshotId, tx);
      const member = await authorize(request.auth, ['event.read'], resource, tx);
      const rows = await tx.get(db().collection(`quizSnapshots/${snapshotId}/${data.operation === 'snapshotRounds' ? 'rounds' : 'slides'}`).orderBy('position').limit(401));
      return wire(rows.docs.map(d => data.operation === 'snapshotRounds' ? { id: d.id, data: pick(d.data(), roundFields) } : slideView(d.id, d.data(), member.permissions.includes('event.answers.read'), member.permissions.includes('event.notes.read'))));
    }
    if (['event', 'registrations', 'roster'].includes(String(data.operation))) {
      const eventId = id(data.eventId), resource: Resource = { kind: 'event', id: eventId };
      await authorize(request.auth, data.operation === 'registrations' ? ['event.read', 'event.contacts'] : ['event.read'], resource, tx);
      const ref = db().doc(`events/${eventId}`);
      if (data.operation === 'event') return wire({ id: eventId, data: eventView(stored(await tx.get(ref))) });
      const rows = await tx.get(ref.collection('registrations').limit(1001));
      if (rows.size > 1000) throw new HttpsError('resource-exhausted', 'Příliš mnoho týmů.');
      return wire(rows.docs.map(d => ({ id: d.id, data: {
        ...pick(d.data(), data.operation === 'roster' ? ['teamName', 'status'] : ['eventId', 'teamName', 'memberCount', 'contactEmail', 'source', 'revision', 'status', 'createdAt', 'updatedAt', 'cancelledAt']),
        ...(data.operation === 'registrations' && d.data().emailDelivery ? { emailDelivery: pick(d.data().emailDelivery as Record<string, unknown>, ['status', 'updatedAt']) } : {}),
      } })));
    }
    throw new HttpsError('invalid-argument', 'Neznámý typ načtení.');
  });
});
