import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { authorizeStaff } from '../live/callables.js';
import { parseScoreRequest } from './validation.js';
import { commitScore } from './core.js';

export const saveEventScore = onCall({ region: 'europe-west1', cors: true }, async request => {
  const actor = authorizeStaff(request.auth);
  const user = await getAuth().getUser(actor.uid).catch(() => null);
  if (!user || user.disabled || !['admin', 'moderator'].includes(user.customClaims?.role as string)) throw new HttpsError('permission-denied', 'Current staff access is required.');
  return commitScore(parseScoreRequest(request.data), () => Promise.resolve({ key: actor.uid, audit: { actorUid: actor.uid } }));
});
