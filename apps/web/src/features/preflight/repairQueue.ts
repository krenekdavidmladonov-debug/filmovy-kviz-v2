import { buildSemanticQuizModel, semanticQuestionType } from '../editor/semanticModel';
import type { EditorQuiz, EditorSlide } from '../editor/types';
import type { PreflightIssue, PreflightResult } from './types';

export type RepairKind = 'choice-answer' | 'video-timing' | 'unsupported';

export interface RepairQueueItem {
  readonly key: string;
  readonly kind: RepairKind;
  readonly issue: PreflightIssue;
  readonly slide?: EditorSlide;
}

const choiceCodes = new Set(['CHOICE_CORRECT_INVALID', 'CHOICE_CORRECT_MISSING']);
const timingCodes = new Set([
  'CLIP_START_MISSING', 'CLIP_START_INVALID', 'CLIP_END_MISSING', 'CLIP_END_INVALID', 'CLIP_RANGE_INVALID',
]);

export function repairIssueKey(issue: PreflightIssue): string {
  return [
    issue.code,
    issue.reference.roundId ?? '',
    issue.reference.questionId ?? '',
    issue.fixTarget?.field ?? '',
  ].join(':');
}

export function buildRepairQueue(quiz: EditorQuiz, result: PreflightResult): readonly RepairQueueItem[] {
  const model = buildSemanticQuizModel(quiz);
  return result.issues.filter((issue) => issue.severity === 'BLOCKER').map((issue) => {
    const questionId = issue.reference.questionId;
    const slide = questionId === undefined ? undefined : model.slideById.get(questionId);
    const type = slide === undefined ? undefined : semanticQuestionType(slide);
    const kind: RepairKind = slide !== undefined && type === 'choice' && choiceCodes.has(issue.code)
      ? 'choice-answer'
      : slide !== undefined && type === 'video' && timingCodes.has(issue.code)
        ? 'video-timing'
        : 'unsupported';
    return {
      key: repairIssueKey(issue),
      kind,
      issue,
      ...(slide === undefined ? {} : { slide }),
    };
  });
}

export function nextRepairKey(
  previous: readonly RepairQueueItem[],
  currentKey: string,
  latest: readonly RepairQueueItem[],
): string | undefined {
  const available = new Set(latest.map((item) => item.key));
  const currentIndex = previous.findIndex((item) => item.key === currentKey);
  const ordered = currentIndex < 0
    ? previous
    : [...previous.slice(currentIndex + 1), ...previous.slice(0, currentIndex)];
  return ordered.find((item) => available.has(item.key))?.key ?? latest[0]?.key;
}

export function humanRepairType(item: RepairQueueItem): string {
  if (item.kind === 'choice-answer') return 'Správná možnost není jednoznačně určená';
  if (item.kind === 'video-timing') return 'Video nemá platný začátek a konec';
  return item.issue.message;
}
