import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { SlideDesignFields, designContrastWarning, designDefaults } from '../apps/web/src/features/editor/SlideDesignFields';
import { ResultTemplatePreview } from '../apps/web/src/features/editor/ResultTemplatePreview';
import { EditorPreview } from '../apps/web/src/features/editor/EditorForms';
import { practiceSlides } from '../apps/web/src/features/editor/QuizPractice';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';

const question: EditorSlide = { id: 'q', position: 2, kind: 'free', storedKind: 'free', isQuestion: true, title: '', text: 'Otázka', options: [], correctAnswer: 'Soukromá odpověď', moderatorNote: '', media: [], hasLegacyData: false, backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null, presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null } };

test('visual controls expose inherited values and local overrides without copying them on render', () => {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(<SlideDesignFields scope="slide" inherited={{ accentColor: '#112233' }} value={{ textAlign: 'right' }} disabled onChange={onChange} />);
  expect(html).toContain('value="#112233"');
  expect(html).toContain('Děděné');
  expect(html).toContain('Vlastní');
  expect(html).toContain('Obnovit výchozí vzhled');
  expect(html).toContain('disabled=""');
  expect(onChange).not.toHaveBeenCalled();
});

test('contrast warning handles shorthand colors and never blocks editing', () => {
  expect(designContrastWarning({ backgroundColor: '#fff', textColor: '#fff' })).toBe(true);
  expect(designContrastWarning({ backgroundColor: '#000', textColor: '#fff' })).toBe(false);
  expect(designContrastWarning(designDefaults)).toBe(false);
  const html = renderToStaticMarkup(<SlideDesignFields scope="slide" value={{ backgroundColor: '#fff', textColor: '#fff' }} disabled={false} onChange={vi.fn()} />);
  expect(html).toContain('uložení je možné');
});

test('layout-only legacy override can reset while inherited appearance cannot', () => {
  const render = (legacyResetAvailable: boolean) => renderToStaticMarkup(<SlideDesignFields scope="slide" value={{}} legacy={{ backgroundImage: 'https://example.test/default.png' }} legacyResetAvailable={legacyResetAvailable} disabled={false} onChange={vi.fn()} />);
  expect(render(true)).toContain('class="secondary-button">Obnovit výchozí vzhled');
  expect(render(false)).toContain('class="secondary-button" disabled="">Obnovit výchozí vzhled');
});

test('result template controls omit question-only settings and unsupported image layout', () => {
  const html = renderToStaticMarkup(<SlideDesignFields scope="results" value={{}} disabled={false} onChange={vi.fn()} />);
  for (const label of ['Zobrazit číslo otázky', 'Zobrazit název kola', 'Zobrazení obrázku', 'Obraz v hlavní roli']) expect(html).not.toContain(label);
  expect(html).toContain('Zobrazit logo');
});

test('private preview does not use answer-only visual overrides before explicit reveal', () => {
  const slide = { ...question, design: { backgroundColor: '#112233' }, answerDesign: { backgroundColor: '#aabbcc' } };
  const render = (showAnswer: boolean) => renderToStaticMarkup(<EditorPreview slide={slide} quizTitle="Kvíz" showAnswer={showAnswer} onShowAnswer={vi.fn()} onEdit={vi.fn()} />);
  expect(render(false)).toContain('#112233');
  expect(render(false)).not.toContain('#aabbcc');
  expect(render(false)).not.toContain('Soukromá odpověď');
  expect(render(true)).toContain('#aabbcc');
  expect(render(true)).toContain('Soukromá odpověď');
  expect(render(false)).toContain('Upravit slide');
});

test('result template preview shares real results rendering while labelling sample data', () => {
  const html = renderToStaticMarkup(<ResultTemplatePreview kind="interim" template={{ title: 'Naše pořadí', design: { accentColor: '#112233' } }} onEdit={vi.fn()} />);
  expect(html).toContain('Naše pořadí');
  expect(html).toContain('results-canvas');
  expect(html).toContain('Ukázka rozložení');
  expect(html).toContain('Ukázkový tým');
  expect(html).not.toContain('publicSessions');
});

test('rehearsal skips hidden standalone information while preserving even malformed hidden questions', () => {
  const info = { ...question, id: 'info', position: 1, kind: 'info' as const, isQuestion: false, hidden: true };
  const quiz: EditorQuiz = { id: 'quiz', title: 'Kvíz', description: '', revision: 1, slideCount: 2, questionCount: 1, roundCount: 0, slides: [info, { ...question, hidden: true }] };
  expect(practiceSlides(quiz).map(slide => slide.id)).toEqual(['q']);
  expect(quiz.slides).toHaveLength(2);
});
