import type { EditorQuiz, PreflightResult } from '@filmovy-kviz/quiz-domain';

export type PreflightLockDecision = 'ALLOW' | 'BLOCKED' | 'WARNINGS_REQUIRE_ACKNOWLEDGEMENT';

export function decidePreflightLock(
  preflight: Pick<PreflightResult, 'blockerCount' | 'warningCount'>,
  acknowledgeWarnings: boolean,
): PreflightLockDecision {
  if (preflight.blockerCount > 0) return 'BLOCKED';
  if (preflight.warningCount > 0 && !acknowledgeWarnings) return 'WARNINGS_REQUIRE_ACKNOWLEDGEMENT';
  return 'ALLOW';
}

export function snapshotWriteCount(slideCount: number, roundCount: number): number {
  return slideCount + roundCount + 4;
}

export function buildQuizSnapshotMetadata(
  quiz: EditorQuiz,
  preflight: Pick<PreflightResult, 'warningCount'>,
  actorId: string,
  createdAt: unknown,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: 'ready',
    quizId: quiz.id,
    quizRevision: quiz.revision,
    quizTitle: quiz.title,
    description: quiz.description,
    slideCount: quiz.slideCount,
    roundCount: quiz.roundCount,
    questionCount: quiz.questionCount,
    preflight: {
      status: preflight.warningCount > 0 ? 'READY_WITH_WARNINGS' : 'READY',
      blockerCount: 0,
      warningCount: preflight.warningCount,
    },
    createdAt,
    createdBy: actorId,
  };
}
