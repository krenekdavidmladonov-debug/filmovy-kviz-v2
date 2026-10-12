import { describe, expect, test } from 'vitest';
import { mapEditorSlide, directMediaKind, youtubeVideoId } from '../packages/quiz-domain/src/index';
import { applyKnownSlideUpdate } from '../functions/src/editor/model';
import { validateSlideInput } from '../functions/src/editor/validation';
import { publicMediaAllowed } from '../functions/src/media/model';
const stored = {
  kind: 'image', position: 1, isQuestion: true, title: '', text: 'Syntetické zadání', correctAnswer: 'Soukromá odpověď', options: [],
  media: [{ role: 'prompt', kind: 'image', value: 'https://example.test/prompt.png', vendor: 12 }, { role: 'answer', kind: 'image', value: 'https://example.test/answer.png' }, { role: 'background', kind: 'image', value: 'https://example.test/background.png' }],
  presentation: { unknownControl: { retained: true } }, legacy: { raw: { keep: true } }, unknownTop: { keep: true },
};
describe('media authoring boundaries', () => {
  test('unchanged roles preserve exact absent keys and legacy; empty is explicit removal after reload', () => {
    const view = mapEditorSlide('slide', stored);
    const input = validateSlideInput({ ...view, text: 'Upravený text' });
    const saved = applyKnownSlideUpdate(stored, input);
    for (const key of ['media', 'legacy', 'unknownTop', 'correctAnswer']) expect(saved[key]).toEqual(stored[key as keyof typeof stored]);
    for (const key of ['questionImage', 'answerImage', 'backgroundImage']) expect(saved).not.toHaveProperty(key);
    const removed = applyKnownSlideUpdate(stored, validateSlideInput({ ...view, answerImage: '', backgroundImage: '' }));
    const reloaded = mapEditorSlide('slide', removed);
    expect(reloaded.answerImage).toBe(''); expect(reloaded.backgroundImage).toBe(''); expect(reloaded.questionImage).toBe(view.questionImage);
    expect(removed.media).toEqual(stored.media); expect(removed.legacy).toEqual(stored.legacy);
  });
  test('source replacement requires valid new interval; unchanged imported sentinel survives text save', () => {
    const old = { ...stored, kind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 0, presentation: { videoStart: 0, videoEnd: 0 } };
    const view = mapEditorSlide('slide', old);
    const saved = applyKnownSlideUpdate(old, validateSlideInput({ ...view, text: 'Nové zadání' }));
    expect(saved.clipStartSeconds).toBe(0); expect(saved).not.toHaveProperty('clipEndSeconds');
    expect(() => applyKnownSlideUpdate(old, validateSlideInput({ ...view, mediaSource: 'https://example.test/new.wav' }))).toThrow(/začátek/);
    expect(() => applyKnownSlideUpdate(old, validateSlideInput({ ...view, mediaSource: 'https://example.test/page.html', clipStartSeconds: 0, clipEndSeconds: 2 }))).toThrow(/zdroj/);
  });
  test('URL adapters recognize supported files and YouTube variants, never active schemes or credentials', () => {
    expect(directMediaKind('https://example.test/sound.wav?version=2')).toBe('audio');
    expect(directMediaKind('https://example.test/movie.mp4')).toBe('video');
    for (const path of ['https://youtu.be/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk']) expect(youtubeVideoId(path)).toBe('abcdefghijk');
    for (const path of ['javascript:alert(1)', 'blob:local', 'file:///sound.wav', 'https://user:secret@example.test/a.wav', 'https://example.test/frame.html']) expect(directMediaKind(path)).toBeUndefined();
    expect(youtubeVideoId('javascript://youtube.com/watch?v=abcdefghijk')).toBeUndefined();
  });
  test('background can be public while answer stays private until explicit reveal; navigation revokes both', () => {
    const bg = 'quiz-asset:quiz/' + 'a'.repeat(64), answer = 'quiz-asset:quiz/' + 'b'.repeat(64);
    const state = { status: 'active', slideKind: 'image', backgroundImage: bg, answerImage: answer, answerRevealed: false };
    expect(publicMediaAllowed(state, bg, 'image')).toBe(true); expect(publicMediaAllowed(state, answer, 'image')).toBe(false);
    expect(publicMediaAllowed({ ...state, answerRevealed: true }, answer, 'image')).toBe(true);
    expect(publicMediaAllowed({ ...state, status: 'ended' }, bg, 'image')).toBe(false);
    expect(publicMediaAllowed({ ...state, backgroundImage: undefined }, bg, 'image')).toBe(false);
  });
});
