import { FirebaseError } from 'firebase/app';

import type { QuestionType, QuizStatus, RoundType } from './types';

export const quizStatusLabels: Readonly<Record<QuizStatus, string>> = {
  draft: 'Koncept',
  ready: 'Připravený',
  archived: 'Archivovaný',
};

export const questionTypeLabels: Readonly<Record<QuestionType, string>> = {
  text: 'Textová',
  image: 'Obrázková',
  audio: 'Audio',
};

export const roundTypeLabels: Readonly<Record<RoundType, string>> = {
  classic: 'Klasické kolo',
  picture: 'Obrázkové kolo',
  audio: 'Audio kolo',
};

const dateFormatter = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatQuizDate(value: Date): string {
  return dateFormatter.format(value);
}

export function getQuizDataError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === 'permission-denied') {
      return 'Vaše relace už nemá oprávnění číst knihovnu. Odhlaste se a přihlaste se znovu.';
    }

    if (error.code === 'unavailable') {
      return 'Firestore Emulator není dostupný. Zkontrolujte, že běží na portu 8080.';
    }
  }

  return 'Knihovnu se nepodařilo načíst. Zkuste to prosím znovu.';
}
