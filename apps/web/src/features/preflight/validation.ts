import { buildSemanticQuizModel, semanticQuestionType } from '../editor/semanticModel';
import type { EditorQuiz, EditorSlide } from '../editor/types';
import { validateQuestion } from '../editor/validation';
import { generatedAgendaOptions, isSafeHttpUrl, youtubeVideoId } from '../presentation/model';
import type {
  PreflightCategory,
  PreflightFixTarget,
  PreflightIssue,
  PreflightResult,
  PreflightSource,
} from './types';

const categories: readonly PreflightCategory[] = [
  'STRUCTURE', 'ANSWER', 'MEDIA', 'TIMING', 'IMAGE', 'LEGACY', 'PROJECTOR',
];

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.trim() === right[index]?.trim());
}

function fixTarget(field: string, roundId: string, questionId: string): PreflightFixTarget {
  return { kind: 'question', roundId, questionId, field };
}

export function preflightFixUrl(quizId: string, target: PreflightFixTarget): string {
  const params = new URLSearchParams();
  if (target.roundId !== undefined) params.set('roundId', target.roundId);
  if (target.questionId !== undefined) params.set('questionId', target.questionId);
  if (target.systemKey !== undefined) params.set('section', target.systemKey);
  if (target.field !== undefined) params.set('field', target.field);
  const query = params.toString();
  return `/admin/quizzes/${encodeURIComponent(quizId)}/edit${query === '' ? '' : `?${query}`}`;
}

export function runQuizPreflight(
  quiz: EditorQuiz,
  options: { readonly source?: PreflightSource; readonly hasUnsavedChanges?: boolean } = {},
): PreflightResult {
  const validationStartedAt = performance.now();
  const model = buildSemanticQuizModel(quiz);
  const issues: PreflightIssue[] = [];
  const source = options.source ?? 'SAVED_QUIZ';
  const quizReference = { quizId: quiz.id } as const;

  if (quiz.title.trim() === '') {
    issues.push({
      severity: 'BLOCKER', code: 'QUIZ_TITLE_MISSING', category: 'STRUCTURE',
      message: 'Chybí název kvízu.', reference: quizReference,
      fixTarget: { kind: 'quiz', field: 'quizTitle' },
    });
  }
  if (model.rounds.every((round) => round.id === 'roundless')) {
    issues.push({
      severity: 'BLOCKER', code: 'QUIZ_HAS_NO_ROUNDS', category: 'STRUCTURE',
      message: 'Kvíz nemá žádné kolo.', reference: quizReference,
    });
  }
  if (options.hasUnsavedChanges === true) {
    issues.push({
      severity: 'BLOCKER', code: 'UNSAVED_CHANGES', category: 'STRUCTURE',
      message: 'Nejdříve uložte změny v editoru.', reference: quizReference,
    });
  }

  let validAnswerCount = 0;
  for (const round of model.rounds) {
    const roundReference = {
      quizId: quiz.id,
      roundId: round.id,
      roundPosition: round.position,
      roundTitle: round.title,
    } as const;
    const hasStoredRoundTitle = (round.settingsSlide?.title.trim() ?? '') !== ''
      || round.slides.some((slide) => (slide.roundTitle?.trim() ?? '') !== '');
    if (round.id !== 'roundless' && !hasStoredRoundTitle) {
      issues.push({
        severity: 'BLOCKER', code: 'ROUND_TITLE_MISSING', category: 'STRUCTURE',
        message: 'Kolo nemá název.', reference: roundReference,
        fixTarget: { kind: 'round', roundId: round.id, field: 'roundTitle' },
      });
    }
    if (round.questions.length === 0) {
      issues.push({
        severity: 'BLOCKER', code: 'ROUND_HAS_NO_QUESTIONS', category: 'STRUCTURE',
        message: 'Kolo neobsahuje žádnou otázku.', reference: roundReference,
        fixTarget: { kind: 'round', roundId: round.id },
      });
    }
    if (round.id === 'roundless') {
      issues.push({
        severity: 'BLOCKER', code: 'ROUNDLESS_QUESTIONS', category: 'STRUCTURE',
        message: 'Otázky nejsou přiřazené ke skutečnému kolu.', reference: roundReference,
      });
    }

    for (const [index, question] of round.questions.entries()) {
      const reference = {
        ...roundReference,
        questionId: question.slide.id,
        questionNumber: question.number,
        questionType: question.type,
      } as const;
      if (question.number !== index + 1) {
        issues.push({
          severity: 'BLOCKER', code: 'ROUND_QUESTION_NUMBERING_INVALID', category: 'STRUCTURE',
          message: 'Číslování otázek v kole není souvislé.', reference,
          fixTarget: fixTarget('order', round.id, question.slide.id),
        });
      }
      const questionIssues = validateQuestion(question.slide);
      if (!questionIssues.some((item) => item.category === 'ANSWER' && item.severity === 'error')) {
        validAnswerCount += 1;
      }
      for (const questionIssue of questionIssues) {
        issues.push({
          severity: questionIssue.severity === 'error' ? 'BLOCKER' : 'WARNING',
          code: questionIssue.code,
          category: questionIssue.category,
          message: questionIssue.message,
          reference,
          fixTarget: fixTarget(questionIssue.field, round.id, question.slide.id),
        });
      }

      const type = semanticQuestionType(question.slide);
      if ((type === 'audio' || type === 'video') && youtubeVideoId(question.slide.mediaSource) !== undefined) {
        issues.push({
          severity: 'WARNING', code: 'MEDIA_ONLINE_UNVERIFIED', category: 'MEDIA',
          message: 'Dostupnost a přehratelnost YouTube ukázky nelze předem zaručit.', reference,
          fixTarget: fixTarget('mediaSource', round.id, question.slide.id),
        });
      }
      if (type === 'image' && isSafeHttpUrl(question.slide.questionImage)) {
        issues.push({
          severity: 'WARNING', code: 'IMAGE_ONLINE_UNVERIFIED', category: 'IMAGE',
          message: 'Dostupnost externího obrázku nelze předem zaručit.', reference,
          fixTarget: fixTarget('questionImage', round.id, question.slide.id),
        });
      }
    }
  }

  const agenda = model.introduction.find((section) => section.key === 'agenda')?.slide;
  if (agenda !== undefined && !sameStrings(agenda.options, generatedAgendaOptions(model.rounds))) {
    issues.push({
      severity: 'WARNING', code: 'AGENDA_OUT_OF_DATE', category: 'STRUCTURE',
      message: 'Uložený harmonogram neodpovídá aktuálním kolům.', reference: quizReference,
      fixTarget: { kind: 'system', systemKey: 'agenda', field: 'agenda' },
    });
  }

  const countFor = (category: PreflightCategory) => ({
    blockers: issues.filter((item) => item.category === category && item.severity === 'BLOCKER').length,
    warnings: issues.filter((item) => item.category === category && item.severity === 'WARNING').length,
  });
  const categoryCounts = Object.fromEntries(categories.map((category) => [category, countFor(category)])) as Record<PreflightCategory, ReturnType<typeof countFor>>;
  const blockerCount = issues.filter((item) => item.severity === 'BLOCKER').length;
  const warningCount = issues.filter((item) => item.severity === 'WARNING').length;
  return {
    status: blockerCount > 0 ? 'BLOCKED' : warningCount > 0 ? 'READY_WITH_WARNINGS' : 'READY',
    source,
    validationDurationMs: performance.now() - validationStartedAt,
    roundCount: model.rounds.length,
    questionCount: model.rounds.reduce((total, round) => total + round.questions.length, 0),
    validAnswerCount,
    blockerCount,
    warningCount,
    issues,
    categories: categoryCounts,
  };
}

export function quizWithDraft(
  quiz: EditorQuiz,
  values: {
    readonly title: string;
    readonly description: string;
    readonly draft: EditorSlide | null;
    readonly pendingPosition?: number;
    readonly roundId?: string;
    readonly roundTitle?: string;
  },
): EditorQuiz {
  let slides = [...quiz.slides];
  if (values.draft !== null) {
    const existingIndex = slides.findIndex((slide) => slide.id === values.draft?.id);
    if (existingIndex >= 0) slides[existingIndex] = values.draft;
    else if (values.pendingPosition !== undefined) {
      const pendingPosition = values.pendingPosition;
      slides = slides.map((slide) => slide.position >= pendingPosition
        ? { ...slide, position: slide.position + 1 }
        : slide);
      slides.push({ ...values.draft, position: pendingPosition });
    }
  }
  if (values.roundId !== undefined && values.roundTitle !== undefined) {
    slides = slides.map((slide) => slide.roundId === values.roundId
      ? { ...slide, roundTitle: values.roundTitle, ...(slide.id === values.draft?.id ? { title: values.roundTitle } : {}) }
      : slide);
  }
  slides.sort((left, right) => left.position - right.position);
  return {
    ...quiz,
    title: values.title,
    description: values.description,
    slideCount: slides.length,
    questionCount: slides.filter((slide) => slide.isQuestion).length,
    slides,
  };
}
