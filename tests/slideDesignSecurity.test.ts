import { beforeEach, expect, test, vi } from 'vitest';

const member = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../functions/src/access/authorization', () => ({ currentMembership: () => member }));
import { preserveHiddenFields, protectPrivateMedia, protectSlideFields } from '../functions/src/access/editor-fields';
import { validateSlideInput } from '../functions/src/editor/validation';

const current = {
  position: 1, kind: 'question', isQuestion: true, title: 'Question', text: 'Prompt', options: [], media: [],
  correctAnswer: 'secret', answerImage: 'https://example.test/answer.png', answerExplanation: 'private explanation', moderatorNote: '',
  answerDesign: { accentColor: '#123456', logoImage: 'https://example.test/private-logo.png', futurePrivate: { secret: true } },
};
const input = (patch: Record<string, unknown> = {}) => validateSlideInput({
  kind: 'question', title: 'Question', text: 'Prompt', options: [], media: [], correctAnswer: '', moderatorNote: '',
  presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
  ...patch,
});
beforeEach(() => { member.permissions = []; });

test('redacted saves restore protected answer design and preserve exact unknown private extensions', () => {
  const protectedInput = protectSlideFields(current, input({ design: { textColor: '#fff' } }));
  expect(protectedInput.answerDesign).toEqual({ accentColor: '#123456', logoImage: 'https://example.test/private-logo.png' });
  const restored = preserveHiddenFields(current, { design: { textColor: '#fff' }, answerDesign: {}, correctAnswer: '' });
  expect(restored.answerDesign).toEqual(current.answerDesign);
  expect(restored.correctAnswer).toBe('secret');
  for (const answerDesign of [{}, { backgroundColor: '#000' }, { logoImage: 'https://example.test/public.png' }]) expect(() => protectSlideFields(current, input({ answerDesign }))).toThrow();
});

test('answer read alone permits unchanged design but cannot erase or replace it', () => {
  member.permissions = ['quiz.answers.read'];
  const visibleAnswers = { correctAnswer: current.correctAnswer, answerImage: current.answerImage, answerExplanation: current.answerExplanation, answerDesign: { accentColor: '#123456', logoImage: 'https://example.test/private-logo.png' } };
  expect(() => protectSlideFields(current, input(visibleAnswers))).not.toThrow();
  expect(() => protectSlideFields(current, input({ ...visibleAnswers, answerDesign: {} }))).toThrow();
  expect(() => protectSlideFields(current, input({ ...visibleAnswers, answerDesign: { accentColor: '#fff' } }))).toThrow();
});

test('media attachment permission controls new design images and resetting a legacy background', () => {
  member.permissions = ['quiz.answers.edit', 'quiz.answers.read'];
  const source = { ...current, backgroundImage: 'https://example.test/background.png' };
  const mediaInput = (patch: Record<string, unknown>) => input({ answerImage: source.answerImage, ...patch });
  expect(() => protectSlideFields(source, mediaInput({ backgroundImage: source.backgroundImage, design: { logoImage: 'https://example.test/new.png' } }))).toThrow();
  expect(() => protectSlideFields(source, mediaInput({ backgroundImage: source.backgroundImage, design: { backgroundImage: 'https://example.test/new.png' } }))).toThrow();
  expect(() => protectSlideFields(source, mediaInput({ backgroundImage: source.backgroundImage, resetAppearance: true }))).toThrow();
  expect(() => protectSlideFields(source, mediaInput({ backgroundImage: source.backgroundImage, design: { textColor: '#fff' } }))).not.toThrow();
  member.permissions.push('quiz.media.attach');
  expect(() => protectSlideFields(source, input({ backgroundImage: '', design: {}, resetAppearance: true }))).not.toThrow();
  expect(() => protectSlideFields(source, input({ backgroundImage: source.backgroundImage, design: { logoImage: 'https://example.test/new.png' } }))).not.toThrow();
});

test('hidden answer images cannot be repurposed into public background/logo or result/print designs', () => {
  member.permissions = ['quiz.media.attach'];
  for (const reference of [current.answerImage, current.answerDesign.logoImage]) for (const field of ['backgroundImage', 'logoImage']) expect(() => protectPrivateMedia([{ data: current }], [{ design: { [field]: reference } }])).toThrow();
  expect(() => protectPrivateMedia([{ data: current }], [{ design: { logoImage: 'https://example.test/independent.png' } }])).not.toThrow();
  member.permissions.push('quiz.answers.read');
  expect(() => protectPrivateMedia([{ data: current }], [{ design: { logoImage: current.answerDesign.logoImage } }])).not.toThrow();
});
