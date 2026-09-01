import { FunctionsError, httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { EditorMutationResponse, EditorSlide } from './types';

export const staleEditorMessage = 'Kvíz byl mezitím změněn v jiném okně. Načtěte prosím aktuální verzi a své změny zopakujte.';

function callable(name: string) {
  return httpsCallable<Record<string, unknown>, EditorMutationResponse>(getFirebaseServices().functions, name);
}

function slidePayload(slide: EditorSlide) {
  return {
    kind: slide.kind,
    title: slide.title,
    text: slide.text,
    moderatorNote: slide.moderatorNote,
    options: [...slide.options],
    correctAnswer: slide.correctAnswer,
    media: slide.media.map((media) => ({ ...media })),
    presentation: { ...slide.presentation },
  };
}

async function invoke(name: string, data: Record<string, unknown>): Promise<EditorMutationResponse> {
  try {
    return (await callable(name)(data)).data;
  } catch (error) {
    if (error instanceof FunctionsError && error.code === 'functions/aborted') {
      throw new Error(staleEditorMessage, { cause: error });
    }
    throw error;
  }
}

export const updateQuizMetadata = (quizId: string, revision: number, title: string, description: string) => (
  invoke('updateQuizMetadata', { quizId, expectedRevision: revision, quiz: { title, description } })
);
export const updateQuizSlide = (quizId: string, revision: number, slide: EditorSlide) => (
  invoke('updateQuizSlide', { quizId, slideId: slide.id, expectedRevision: revision, slide: slidePayload(slide) })
);
export const createQuizSlide = (quizId: string, revision: number, position: number, slide: EditorSlide) => (
  invoke('createQuizSlide', { quizId, expectedRevision: revision, position, slide: slidePayload(slide) })
);
export const duplicateQuizSlide = (quizId: string, revision: number, slideId: string) => (
  invoke('duplicateQuizSlide', { quizId, slideId, expectedRevision: revision })
);
export const deleteQuizSlide = (quizId: string, revision: number, slideId: string) => (
  invoke('deleteQuizSlide', { quizId, slideId, expectedRevision: revision })
);
export const moveQuizSlide = (quizId: string, revision: number, slideId: string, direction: -1 | 1) => (
  invoke('moveQuizSlide', { quizId, slideId, direction, expectedRevision: revision })
);
