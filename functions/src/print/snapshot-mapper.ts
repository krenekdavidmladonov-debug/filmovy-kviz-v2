import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import type { PrintEvent, PrintQuestionKind } from './types.js';

interface SnapshotDocument {
  id: string;
  data: Record<string, unknown>;
}

const QUESTION_KINDS = new Set<PrintQuestionKind>([
  'choice',
  'free',
  'pl',
  'image',
  'audio',
  'video',
]);

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new PrintCenterError(422, 'invalid-snapshot', `Snapshot nemá platné pole ${field}.`);
  }
  return value.trim().normalize('NFC');
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new PrintCenterError(422, 'invalid-snapshot', `Snapshot nemá platné pole ${field}.`);
  }
  return value as number;
}

function questionKind(value: unknown): PrintQuestionKind {
  const kind = value === 'question' ? 'choice' : value;
  if (typeof kind !== 'string' || !QUESTION_KINDS.has(kind as PrintQuestionKind)) {
    throw new PrintCenterError(422, 'invalid-snapshot', 'Snapshot obsahuje nepodporovaný typ otázky.');
  }
  return kind as PrintQuestionKind;
}

function choiceLabel(data: Record<string, unknown>, answer: string): string | undefined {
  if (!Array.isArray(data.options)) return undefined;
  const index = data.options.findIndex((option) => option === answer);
  if (index < 0 || index > 25) return undefined;
  return String.fromCharCode(65 + index);
}

export function mapSnapshotToPrintEvent(
  eventData: Record<string, unknown>,
  snapshotData: Record<string, unknown>,
  roundDocuments: SnapshotDocument[],
  slideDocuments: SnapshotDocument[],
): PrintEvent {
  if (snapshotData.status !== 'ready') {
    throw new PrintCenterError(409, 'snapshot-not-ready', 'Snapshot kvízu není připravený pro tisk.');
  }
  if (roundDocuments.length === 0 || roundDocuments.length > PRINT_LIMITS.rounds) {
    throw new PrintCenterError(422, 'round-limit', 'Počet kol není vhodný pro tisk.');
  }
  if (slideDocuments.length > PRINT_LIMITS.slides) {
    throw new PrintCenterError(422, 'slide-limit', 'Snapshot obsahuje příliš mnoho slidů.');
  }

  const sortedRounds = [...roundDocuments].sort(
    (left, right) => positiveInteger(left.data.position, 'round.position') - positiveInteger(right.data.position, 'round.position'),
  );
  const roundIndex = new Map(sortedRounds.map((round, index) => [round.id, index]));
  const questionsByRound = sortedRounds.map(() => [] as Array<{
    position: number;
    kind: PrintQuestionKind;
    answer: string;
    choiceLabel?: string;
  }>);

  for (const slide of slideDocuments) {
    if (slide.data.isQuestion !== true) continue;
    const roundId = slide.data.roundId;
    if (typeof roundId !== 'string' || !roundIndex.has(roundId)) {
      throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nepatří do známého kola.');
    }
    const answer = requiredText(slide.data.correctAnswer, 'slide.correctAnswer');
    const kind = questionKind(slide.data.kind);
    const targetQuestions = questionsByRound[roundIndex.get(roundId)!];
    if (!targetQuestions) {
      throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nepatří do známého kola.');
    }
    targetQuestions.push({
      position: positiveInteger(slide.data.position, 'slide.position'),
      kind,
      answer,
      ...(kind === 'choice' && choiceLabel(slide.data, answer)
        ? { choiceLabel: choiceLabel(slide.data, answer) }
        : {}),
    });
  }

  const questionCount = questionsByRound.reduce((total, questions) => total + questions.length, 0);
  if (questionCount === 0 || questionCount > PRINT_LIMITS.questions) {
    throw new PrintCenterError(422, 'question-limit', 'Počet otázek není vhodný pro tisk.');
  }

  return {
    title: requiredText(eventData.title, 'event.title'),
    quiz: {
      title: requiredText(snapshotData.quizTitle, 'snapshot.quizTitle'),
      rounds: sortedRounds.map((round, roundOffset) => ({
        number: roundOffset + 1,
        title: requiredText(round.data.title, 'round.title'),
        questions: (questionsByRound[roundOffset] ?? [])
          .sort((left, right) => left.position - right.position)
          .map((question, questionOffset) => ({
            number: questionOffset + 1,
            kind: question.kind,
            answer: question.answer,
            ...(question.choiceLabel ? { choiceLabel: question.choiceLabel } : {}),
          })),
      })),
    },
  };
}

export function answerDisplay(answer: { answer: string; choiceLabel?: string }): string {
  return answer.choiceLabel ? `${answer.choiceLabel} — ${answer.answer}` : answer.answer;
}
