import { youtubeVideoId } from '../presentation/model';
import { semanticQuestionType } from './semanticModel';
import type { EditorSlide, EditorValidationIssue } from './types';

const normalized = (value: string) => value.trim().toLocaleLowerCase('cs-CZ');

export function correctOptionIndex(slide: Pick<EditorSlide, 'options' | 'correctAnswer'>): number | undefined {
  const answer = normalized(slide.correctAnswer);
  if (answer === '') return undefined;
  const exact = slide.options.findIndex((option) => normalized(option) === answer);
  if (exact >= 0) return exact;
  if (/^[a-z]$/u.test(answer)) {
    const index = answer.codePointAt(0)! - 'a'.codePointAt(0)!;
    if (index >= 0 && index < slide.options.length) return index;
  }
  return undefined;
}

export function validateQuestion(slide: EditorSlide): readonly EditorValidationIssue[] {
  if (!slide.isQuestion) return [];
  const type = semanticQuestionType(slide);
  const issues: EditorValidationIssue[] = [];
  const prompt = (slide.text || slide.title).trim();
  if (prompt === '') issues.push({ field: 'prompt', message: 'Doplňte zadání otázky.', severity: 'error' });

  if (type === 'choice' || (type === 'image' && slide.options.length > 0)) {
    if (slide.options.filter((option) => option.trim() !== '').length < 2) {
      issues.push({ field: 'options', message: 'Doplňte alespoň dvě odpovědi.', severity: 'error' });
    }
    if (correctOptionIndex(slide) === undefined) {
      issues.push({ field: 'correctAnswer', message: 'Vyberte právě jednu správnou odpověď.', severity: 'error' });
    }
  } else if (type === 'legacy-pl') {
    if (!['pravda', 'lež', 'lez', 'true', 'false', 'ano', 'ne', '1', '0'].includes(normalized(slide.correctAnswer))) {
      issues.push({ field: 'correctAnswer', message: 'Starší odpověď není standardní Pravda / Lež; zůstane zachována.', severity: 'warning' });
    }
  } else if (type !== 'legacy' && slide.correctAnswer.trim() === '') {
    issues.push({ field: 'correctAnswer', message: 'Doplňte správnou odpověď.', severity: 'error' });
  }

  if (type === 'image' && slide.questionImage.trim() === '') {
    issues.push({ field: 'questionImage', message: 'Doplňte obrázek otázky.', severity: 'error' });
  }
  if (type === 'audio' || type === 'video') {
    if (youtubeVideoId(slide.mediaSource) === undefined) {
      issues.push({ field: 'mediaSource', message: 'Doplňte platný YouTube odkaz nebo video ID.', severity: 'error' });
    }
    if (slide.clipStartSeconds === null) {
      issues.push({ field: 'clipStartSeconds', message: 'Doplňte začátek ukázky.', severity: 'error' });
    }
    if (slide.clipEndSeconds === null) {
      issues.push({ field: 'clipEndSeconds', message: 'Doplňte konec ukázky.', severity: 'error' });
    }
    if (slide.clipStartSeconds !== null && slide.clipStartSeconds < 0) {
      issues.push({ field: 'clipStartSeconds', message: 'Začátek nesmí být záporný.', severity: 'error' });
    }
    if (slide.clipStartSeconds !== null && slide.clipEndSeconds !== null && slide.clipEndSeconds <= slide.clipStartSeconds) {
      issues.push({ field: 'clipEndSeconds', message: 'Konec musí být později než začátek.', severity: 'error' });
    }
  }
  if (type === 'legacy') {
    issues.push({ field: 'legacy', message: 'Obsah obsahuje starší nastavení.', severity: 'warning' });
  }
  return issues;
}

export function hasBlockingIssues(slide: EditorSlide): boolean {
  return validateQuestion(slide).some((issue) => issue.severity === 'error');
}
