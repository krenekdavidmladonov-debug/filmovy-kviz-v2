import { securedOnCall } from '../access/authorization.js';
import { authorizeStaff } from '../live/callables.js';
import { parseScoreRequest } from './validation.js';
import { commitScore } from './core.js';

export const saveEventScore = securedOnCall('saveEventScore', { region: 'europe-west1', cors: true }, async request => {
  const actor = authorizeStaff(request.auth);
  return commitScore(parseScoreRequest(request.data), () => Promise.resolve({ key: actor.uid, audit: { actorUid: actor.uid } }));
});
