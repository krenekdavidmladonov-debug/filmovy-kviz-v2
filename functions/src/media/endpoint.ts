import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { parseQuizAsset, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { assetPath, mediaByteRange, mediaId, publicMediaAllowed } from './model.js';
import { mediaBucket } from './storage.js';
import { freshIdentity, type AuthIdentity } from '../access/authorization.js';
import { authorizePrivateMedia } from '../access/media.js';

export const readQuizMedia = onRequest({ region: 'europe-west1', cors: true, maxInstances: 10, timeoutSeconds: 60 }, async (request, response) => {
  response.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') { response.status(405).end(); return; }
  const reference = request.query.reference, parsed = parseQuizAsset(reference);
  if (!parsed || typeof reference !== 'string' || Object.keys(request.query).some(key => !['reference','sessionId','snapshotId'].includes(key)) || (request.query.sessionId !== undefined && request.query.snapshotId !== undefined)) { response.status(400).end(); return; }
  try {
    const snapshotId = request.query.snapshotId === undefined ? undefined : mediaId(request.query.snapshotId);
    let auth: AuthIdentity;
    const db = getFirestore();
    const publicRef = request.query.sessionId === undefined ? null : db.doc('publicSessions/' + mediaId(request.query.sessionId));
    const publication = publicRef ? await publicRef.get() : null;
    if (publicRef) {
      if (!publicMediaAllowed(publication?.data(), reference)) { response.status(404).end(); return; }
    } else {
      const bearer = request.get('authorization');
      if (!bearer?.startsWith('Bearer ')) { response.status(403).end(); return; }
      const claims = await getAuth().verifyIdToken(bearer.slice(7), true);
      auth = { uid: claims.uid, token: claims };
      await freshIdentity(auth);
      await authorizePrivateMedia(auth, reference, snapshotId);
    }
    const asset = (await db.doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId).get()).data();
    if (!asset || asset.quizId !== parsed.quizId || asset.status !== 'ready' || !validOwnedMedia(asset.kind, asset.contentType, asset.size) || typeof asset.generation !== 'string') { response.status(404).end(); return; }
    if (publicRef && !publicMediaAllowed(publication?.data(), reference, asset.kind)) { response.status(404).end(); return; }
    const size = asset.size as number;
    let range;
    try { range = mediaByteRange(request.get('range'), size); }
    catch { response.status(416).set('Content-Range', 'bytes */' + size).end(); return; }
    const file = mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: asset.generation });
    const [bytes] = await file.download(range ?? {});
    // Recheck current authority after IO; an unrelated reveal must not break an allowed image.
    if (publicRef && !publicMediaAllowed((await publicRef.get()).data(), reference, asset.kind)) { response.status(404).end(); return; }
    if (!publicRef) await authorizePrivateMedia(auth, reference, snapshotId);
    response.set('Content-Type', asset.contentType as string).set('Accept-Ranges', 'bytes').set('Content-Length', String(bytes.length));
    if (range) response.status(206).set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size);
    response.send(bytes);
  } catch { response.status(404).end(); }
});
