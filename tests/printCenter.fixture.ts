import type { PrintEvent, PrintQuestionKind, PrintTeam } from '../functions/src/print/types';

export function syntheticPrintEvent(): PrintEvent {
  const kinds: PrintQuestionKind[] = ['choice', 'free', 'pl', 'audio', 'video', 'image'];
  return {
    title: 'Filmový večer: Žluťoučký kůň a příliš dlouhý název akce pro ověření sazby',
    quiz: {
      title: 'Syntetický kvíz bez produkčních dat',
      rounds: Array.from({ length: 5 }, (_, roundIndex) => ({
        number: roundIndex + 1,
        title: `Kolo ${roundIndex + 1} — české znaky ěščřžýáíé`,
        questions: Array.from({ length: 10 }, (_, questionIndex) => {
          const kind = kinds[(roundIndex * 10 + questionIndex) % kinds.length] ?? 'free';
          const answer = kind === 'pl'
            ? (questionIndex % 2 === 0 ? 'Pravda' : 'Lež')
            : kind === 'choice'
              ? 'Správná syntetická možnost B'
              : `Syntetická odpověď ${questionIndex + 1} s diakritikou a dlouhým textem, který bezpečně ověřuje zalamování bez skutečného obsahu.`;
          return {
            number: questionIndex + 1,
            kind,
            answer,
            ...(kind === 'choice' ? { choiceLabel: 'B' } : {}),
          };
        }),
      })),
    },
  };
}

export function syntheticTeams(count = 20): PrintTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    name: index === count - 1
      ? `Tým ${index + 1} — Neobyčejně dlouhý český název Žluťoučkých koní`
      : `Tým ${String(index + 1).padStart(2, '0')}`,
  }));
}

export function syntheticSnapshotDocuments() {
  const rounds = Array.from({ length: 5 }, (_, index) => ({
    id: `round-${index + 1}`,
    data: { position: index + 1, title: `Syntetické kolo ${index + 1}` },
  }));
  const slides = rounds.flatMap((round, roundIndex) => Array.from({ length: 10 }, (_, questionIndex) => {
    const kind = questionIndex % 5 === 0 ? 'question' : questionIndex % 5 === 1 ? 'free' : questionIndex % 5 === 2 ? 'pl' : questionIndex % 5 === 3 ? 'audio' : 'video';
    return {
      id: `private-slide-${roundIndex + 1}-${questionIndex + 1}`,
      data: {
        roundId: round.id,
        position: roundIndex * 10 + questionIndex + 1,
        isQuestion: true,
        kind,
        correctAnswer: kind === 'question' ? 'Možnost B' : kind === 'pl' ? 'Pravda' : `Odpověď ${questionIndex + 1}`,
        options: kind === 'question' ? ['Možnost A', 'Možnost B', 'Možnost C'] : [],
        text: 'TAJNÝ TEXT OTÁZKY',
        moderatorNote: 'TAJNÁ POZNÁMKA',
        mediaSource: 'TAJNÉ-MEDIA-ID',
        legacy: { raw: 'TAJNÝ LEGACY RAW' },
      },
    };
  }));
  return { rounds, slides };
}
