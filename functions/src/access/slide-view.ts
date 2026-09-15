import { mapEditorSlide } from '@filmovy-kviz/quiz-domain';

/** Nominal text fields must not stringify private nested legacy metadata. */
export function slideView(slideId: string, data: Record<string, unknown>, answers: boolean, notes: boolean) {
  const safeData = { ...data };
  for (const key of ['title', 'text']) if (typeof safeData[key] !== 'string') safeData[key] = '';
  if (Array.isArray(safeData.mediaSource)) safeData.mediaSource = '';
  if (Array.isArray(safeData.options)) safeData.options = safeData.options.map((value: unknown) => typeof value === 'string' ? value : '');
  const slide = mapEditorSlide(slideId, safeData);
  return { ...slide, correctAnswer: answers ? slide.correctAnswer : '', answerImage: answers ? slide.answerImage : '',
    answerExplanation: answers ? slide.answerExplanation : '', moderatorNote: notes ? slide.moderatorNote : '',
    media: slide.media.filter(m => m.role === 'prompt' || m.role === 'background' || (answers && m.role === 'answer')),
    presentation: { ...slide.presentation, answerOverlay: answers ? slide.presentation.answerOverlay : null } };
}
