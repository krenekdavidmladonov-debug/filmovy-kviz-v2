import { onRequest } from 'firebase-functions/v2/https';

export {
  createLiveSession,
  endLiveSession,
  finishMedia,
  goToSlide,
  hideAnswer,
  nextSlide,
  playMedia,
  previousSlide,
  replayMedia,
  revealAnswer,
  selectRecapQuestion,
  startIntro,
  stopMedia,
} from './live/callables.js';

export {
  createQuizSlide,
  deleteQuizSlide,
  duplicateQuizSlide,
  moveQuizSlide,
  updateQuizMetadata,
  updateQuizSlide,
} from './editor/callables.js';

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
