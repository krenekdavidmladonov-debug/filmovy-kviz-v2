import { isSafeHttpUrl, youtubeVideoId } from '../presentation/model';
import { questionPrompt, semanticQuestionType } from './semanticModel';
import type { EditorSlide, EditorValidationIssue } from './types';

const normalized = (value: string) => value.trim().toLocaleLowerCase('cs-CZ');
const rendererQuestionKinds = new Set([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);

function issue(
  code: EditorValidationIssue['code'],
  category: EditorValidationIssue['category'],
  field: string,
  message: string,
  severity: EditorValidationIssue['severity'] = 'error',
): EditorValidationIssue {
  return { code, category, field, message, severity };
}

export function correctOptionIndex(slide: Pick<EditorSlide, 'options' | 'correctAnswer'>): number | undefined {
  const answer = normalized(slide.correctAnswer);
  if (answer === '') return undefined;
  const exactMatches = slide.options
    .map((option, index) => ({ index, value: normalized(option) }))
    .filter((option) => option.value !== '' && option.value === answer);
  if (exactMatches.length === 1) return exactMatches[0]!.index;
  if (exactMatches.length > 1) return undefined;
  if (/^[a-z]$/u.test(answer)) {
    const index = answer.codePointAt(0)! - 'a'.codePointAt(0)!;
    if (index >= 0 && index < slide.options.length && normalized(slide.options[index] ?? '') !== '') return index;
  }
  return undefined;
}

export function validateQuestion(slide: EditorSlide): readonly EditorValidationIssue[] {
  if (!slide.isQuestion) return [];
  const type = semanticQuestionType(slide);
  const issues: EditorValidationIssue[] = [];
  const prompt = questionPrompt(slide).trim();
  if (prompt === '') issues.push(issue('QUESTION_PROMPT_MISSING', 'STRUCTURE', 'prompt', 'Chybí zadání otázky.'));
  if (!rendererQuestionKinds.has(slide.kind.toLowerCase())) {
    issues.push(issue('QUESTION_RENDERER_UNSUPPORTED', 'STRUCTURE', 'prompt', 'Tento obsah renderer neumí bezpečně zobrazit jako otázku.'));
  }

  if (type === 'choice' || (type === 'image' && slide.options.length > 0)) {
    if (slide.options.filter((option) => option.trim() !== '').length < 2) {
      issues.push(issue('CHOICE_OPTIONS_TOO_FEW', 'ANSWER', 'options', 'Doplňte alespoň dvě platné možnosti.'));
    }
    if (slide.correctAnswer.trim() === '') {
      issues.push(issue('CHOICE_CORRECT_MISSING', 'ANSWER', 'correctAnswer', 'Chybí správná možnost.'));
    } else if (correctOptionIndex(slide) === undefined) {
      issues.push(issue('CHOICE_CORRECT_INVALID', 'ANSWER', 'correctAnswer', 'Správná odpověď neodpovídá právě jedné platné možnosti.'));
    }
  } else if (type === 'legacy-pl') {
    if (!['pravda', 'lež', 'lez', 'true', 'false', 'ano', 'ne', '1', '0'].includes(normalized(slide.correctAnswer))) {
      issues.push(issue('PL_ANSWER_INVALID', 'ANSWER', 'correctAnswer', 'Správná odpověď musí být Pravda nebo Lež.'));
    } else {
      issues.push(issue('LEGACY_LIMITED', 'LEGACY', 'legacy', 'Starší typ Pravda / Lež má omezené možnosti úprav.', 'warning'));
    }
  } else if (slide.correctAnswer.trim() === '') {
    issues.push(issue('ANSWER_MISSING', 'ANSWER', 'correctAnswer', 'Chybí správná odpověď.'));
  }
  if (type === 'legacy') {
    issues.push(issue('LEGACY_LIMITED', 'LEGACY', 'legacy', 'Starší typ otázky má omezené možnosti úprav.', 'warning'));
  }

  if (type === 'image') {
    if (slide.questionImage.trim() === '') {
      issues.push(issue('IMAGE_SOURCE_MISSING', 'IMAGE', 'questionImage', 'Chybí obrázek otázky.'));
    } else if (!isSafeHttpUrl(slide.questionImage)) {
      issues.push(issue('IMAGE_SOURCE_INVALID', 'IMAGE', 'questionImage', 'Obrázek otázky nemá platnou HTTP(S) adresu.'));
    }
  }
  if (type === 'audio' || type === 'video') {
    if (slide.mediaSource.trim() === '') {
      issues.push(issue('MEDIA_SOURCE_MISSING', 'MEDIA', 'mediaSource', 'Chybí zdroj ukázky.'));
    } else if (youtubeVideoId(slide.mediaSource) === undefined) {
      issues.push(issue('MEDIA_SOURCE_INVALID', 'MEDIA', 'mediaSource', 'Zdroj není platný YouTube odkaz ani video ID.'));
    }
    if (slide.clipStartSeconds === null) {
      issues.push(issue('CLIP_START_MISSING', 'TIMING', 'clipStartSeconds', 'Chybí začátek ukázky.'));
    } else if (!Number.isFinite(slide.clipStartSeconds) || slide.clipStartSeconds < 0) {
      issues.push(issue('CLIP_START_INVALID', 'TIMING', 'clipStartSeconds', 'Začátek ukázky musí být platný nezáporný čas.'));
    }
    if (slide.clipEndSeconds === null) {
      issues.push(issue('CLIP_END_MISSING', 'TIMING', 'clipEndSeconds', 'Chybí konec ukázky.'));
    } else if (!Number.isFinite(slide.clipEndSeconds) || slide.clipEndSeconds < 0) {
      issues.push(issue('CLIP_END_INVALID', 'TIMING', 'clipEndSeconds', 'Konec ukázky musí být platný nezáporný čas.'));
    } else if (slide.clipStartSeconds !== null && Number.isFinite(slide.clipStartSeconds)
      && slide.clipStartSeconds >= 0 && slide.clipEndSeconds <= slide.clipStartSeconds) {
      issues.push(issue('CLIP_RANGE_INVALID', 'TIMING', 'clipEndSeconds', 'Konec ukázky musí být po začátku.'));
    }
  }
  if (slide.answerImage.trim() !== '' && !isSafeHttpUrl(slide.answerImage)) {
    issues.push(issue('ANSWER_IMAGE_INVALID', 'IMAGE', 'answerImage', 'Obrázek odpovědi nemá platnou HTTP(S) adresu.', 'warning'));
  }
  if (slide.backgroundImage.trim() !== '' && !isSafeHttpUrl(slide.backgroundImage)) {
    issues.push(issue('BACKGROUND_IMAGE_INVALID', 'IMAGE', 'backgroundImage', 'Pozadí nemá platnou HTTP(S) adresu.', 'warning'));
  }
  return issues;
}

export function hasBlockingIssues(slide: EditorSlide): boolean {
  return validateQuestion(slide).some((issue) => issue.severity === 'error');
}
