import { onRequest } from 'firebase-functions/v2/https';

/** Minimal endpoint that does not initialize Admin SDK or access data. */
export const health = onRequest(
  {
    region: 'europe-west1',
    cors: false,
  },
  (_request, response) => {
    response.status(200).json({ status: 'ok' });
  },
);
