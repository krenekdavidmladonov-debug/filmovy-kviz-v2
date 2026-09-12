import { describe, expect, test } from 'vitest';

import { mapEditorQuiz, mapEditorSlide } from '../apps/web/src/features/editor/editorMappers';
import { QuizEditorError } from '../functions/src/editor/errors';
import {
  applyKnownSlideUpdate,
  assertRevision,
  mergeEditorMedia,
  quizCreationIdentity,
  sortedSlides,
} from '../functions/src/editor/model';
import { requestedQuizCreation, validateSlideInput } from '../functions/src/editor/validation';
import { requestedPreflightRepair } from '../functions/src/editor/repair';

function slideInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'question',
    title: 'Syntetický titulek',
    text: 'Syntetické zadání',
    moderatorNote: 'Soukromá poznámka',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'Soukromá odpověď',
    media: [],
    presentation: {
      videoStart: null,
      videoEnd: null,
      audioTrigger: null,
      backgroundOverlay: null,
      answerOverlay: null,
      sourceQuestionNumber: null,
    },
    ...overrides,
  };
}

describe('quiz editor lossless model', () => {
  test('updates known fields while preserving legacy.raw and unknown fields exactly', () => {
    const legacy = { raw: { unexplained: ['keep', 42], correct: 'private sentinel' } };
    const current = {
      position: 7,
      kind: 'question',
      isQuestion: true,
      title: 'Původní',
      text: 'Původní text',
      options: [],
      media: [{ role: 'prompt', kind: 'image', value: 'https://old.example.test/a.jpg', vendorToken: 'keep' }],
      presentation: { recapOverrides: [{ keep: true }], videoStart: 1 },
      legacy,
      futureTopLevel: { nested: true },
    };
    const input = validateSlideInput(slideInput({
      media: [{ sourceIndex: 0, role: 'background', kind: 'image', source: 'https://new.example.test/b.jpg' }],
      presentation: {
        videoStart: 2, videoEnd: 5, audioTrigger: null,
        backgroundOverlay: 60, answerOverlay: null, sourceQuestionNumber: '2/8',
      },
    }));

    const updated = applyKnownSlideUpdate(current, input);
    expect(updated.legacy).toEqual(legacy);
    expect(updated.futureTopLevel).toEqual({ nested: true });
    expect(updated.presentation).toEqual({
      recapOverrides: [{ keep: true }], videoStart: 2, videoEnd: 5,
      backgroundOverlay: 60, sourceQuestionNumber: '2/8',
    });
    expect(updated.media).toEqual([{
      role: 'background', kind: 'image', value: 'https://new.example.test/b.jpg',
      vendorToken: 'keep', url: 'https://new.example.test/b.jpg', domain: 'new.example.test', validUrl: true,
    }]);
  });

  test('keeps an unknown stored kind when the editor uses the legacy fallback', () => {
    const updated = applyKnownSlideUpdate({
      kind: 'future-widget', isQuestion: true, options: [], media: [], presentation: {},
    }, validateSlideInput(slideInput({ kind: 'legacy' })));
    expect(updated.kind).toBe('future-widget');
    expect(updated.isQuestion).toBe(true);
  });

  test('preserves the presence of explicit empty private V1 fields', () => {
    const updated = applyKnownSlideUpdate({
      kind: 'intro', isQuestion: false, options: [], media: [], presentation: {},
      moderatorNote: '', correctAnswer: '',
    }, validateSlideInput(slideInput({ kind: 'intro', moderatorNote: '', correctAnswer: '' })));
    expect(Object.hasOwn(updated, 'moderatorNote')).toBe(true);
    expect(Object.hasOwn(updated, 'correctAnswer')).toBe(true);
  });

  test('round-trips the imported 0/0 timing sentinel without losing private or opaque fields', () => {
    const originalMedia = [{
      role: 'prompt', kind: 'video', value: 'synthetic-video-reference', opaqueVendorField: 'keep',
    }];
    const originalLegacy = {
      source: 'synthetic-import', raw: { answerHint: 'private sentinel', unknownArray: [1, 2, 3] },
    };
    const current = {
      position: 2,
      kind: 'question',
      isQuestion: true,
      roundId: 'imported-round',
      title: 'Importovaná otázka',
      text: 'Původní syntetické zadání',
      moderatorNote: 'Soukromá poznámka',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 'Soukromá odpověď',
      media: originalMedia,
      presentation: {
        videoStart: 0,
        videoEnd: 0,
        sourceQuestionNumber: '1/1',
        futurePresentationField: { preserve: true },
      },
      clipStartSeconds: 0,
      legacy: originalLegacy,
      futureTopLevel: { preserve: true },
    };

    const mapped = mapEditorSlide('imported-slide', current);
    expect(mapped.clipStartSeconds).toBeNull();
    expect(mapped.clipEndSeconds).toBeNull();
    const explicitNullEnd = mapEditorSlide('not-the-import-sentinel', {
      ...current,
      clipEndSeconds: null,
    });
    expect(explicitNullEnd.clipStartSeconds).toBe(0);
    expect(explicitNullEnd.clipEndSeconds).toBe(0);

    const updated = applyKnownSlideUpdate(current, validateSlideInput({
      kind: mapped.kind,
      title: mapped.title,
      text: 'Upravené syntetické zadání',
      moderatorNote: mapped.moderatorNote,
      options: mapped.options,
      correctAnswer: mapped.correctAnswer,
      media: mapped.media,
      presentation: mapped.presentation,
      backgroundImage: mapped.backgroundImage,
      questionImage: mapped.questionImage,
      answerImage: mapped.answerImage,
      mediaSource: mapped.mediaSource,
      backgroundOverlay: mapped.backgroundOverlay,
      clipStartSeconds: mapped.clipStartSeconds,
      clipEndSeconds: mapped.clipEndSeconds,
    }));

    expect(updated.text).toBe('Upravené syntetické zadání');
    expect(updated.correctAnswer).toBe(current.correctAnswer);
    expect(updated.media).toEqual(originalMedia);
    expect(updated.legacy).toEqual(originalLegacy);
    expect(updated.futureTopLevel).toEqual({ preserve: true });
    expect(updated.presentation).toEqual(current.presentation);
    expect(updated.clipStartSeconds).toBe(0);
    expect(Object.hasOwn(updated, 'clipEndSeconds')).toBe(false);
  });

  test('keeps unmentioned mixed media, deletes an explicit empty patch, and appends safely', () => {
    const result = mergeEditorMedia([
      { role: 'prompt', kind: 'audio', value: 'audio-ref', opaque: 1 },
      { role: 'unknown', kind: 'unknown', value: 'legacy-ref', opaque: 2 },
    ], [
      { sourceIndex: 0, role: 'prompt', kind: 'audio', source: '' },
      { role: 'prompt', kind: 'video', source: 'https://video.example.test/watch' },
    ]);
    expect(result).toEqual([
      { role: 'unknown', kind: 'unknown', value: 'legacy-ref', opaque: 2 },
      { role: 'prompt', kind: 'video', value: 'https://video.example.test/watch', url: 'https://video.example.test/watch', domain: 'video.example.test', validUrl: true },
    ]);
  });

  test('preserves unknown media classifications and malformed known values on an unchanged fallback save', () => {
    const updated = applyKnownSlideUpdate({
      kind: 'question', isQuestion: true,
      title: { localized: 'keep' }, text: 'Text', options: ['A', { future: true }],
      correctAnswer: { structured: true },
      media: [{ role: 'future-role', kind: 'future-kind', value: 'opaque-ref', opaque: true }],
      presentation: { videoStart: 'future-expression' },
    }, validateSlideInput(slideInput({
      title: JSON.stringify({ localized: 'keep' }),
      options: ['A', JSON.stringify({ future: true })],
      correctAnswer: JSON.stringify({ structured: true }),
      media: [{ sourceIndex: 0, role: 'unknown', kind: 'unknown', source: 'opaque-ref' }],
    })));
    expect(updated.title).toEqual({ localized: 'keep' });
    expect(updated.options).toEqual(['A', { future: true }]);
    expect(updated.correctAnswer).toEqual({ structured: true });
    expect(updated.media).toEqual([{ role: 'future-role', kind: 'future-kind', value: 'opaque-ref', opaque: true }]);
    expect(updated.presentation).toEqual({ videoStart: 'future-expression' });
  });

  test.each([0, 4, 5, 6])('accepts a general options array of length %i', (length) => {
    expect(validateSlideInput(slideInput({
      options: Array.from({ length }, (_, index) => `Volba ${index}`),
    })).options).toHaveLength(length);
  });

  test('rejects malformed timing, unsafe image URLs, and inconsistent ordering', () => {
    expect(() => validateSlideInput(slideInput({
      presentation: { videoStart: 9, videoEnd: 3, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    }))).toThrow('videoStart');
    expect(() => validateSlideInput(slideInput({
      media: [{ role: 'answer', kind: 'image', source: 'javascript:alert(1)' }],
    }))).toThrow('http');
    expect(() => sortedSlides([
      { id: 'a', data: { position: 1 } }, { id: 'b', data: { position: 3 } },
    ])).toThrow('contiguous');
  });

  test('rejects a stale quiz revision', () => {
    expect(() => assertRevision({ revision: 8 }, 7)).toThrow(QuizEditorError);
    expect(() => assertRevision({ revision: 8 }, 7)).toThrow('another editor');
  });

  test('accepts only narrow repair request shapes', () => {
    expect(requestedPreflightRepair({
      quizId: 'quiz', slideId: 'slide', expectedRevision: 2,
      kind: 'choice-answer', optionIndex: 5,
    })).toEqual({ kind: 'choice-answer', optionIndex: 5 });
    expect(requestedPreflightRepair({
      quizId: 'quiz', slideId: 'slide', expectedRevision: 2,
      kind: 'video-timing', clipStartSeconds: 1.5, clipEndSeconds: 7,
    })).toEqual({ kind: 'video-timing', clipStartSeconds: 1.5, clipEndSeconds: 7 });
  });

  test('validates and normalizes only the narrow create-quiz request shape', () => {
    expect(requestedQuizCreation({ title: '  Nový syntetický kvíz  ', requestId: 'request-1' })).toEqual({
      title: 'Nový syntetický kvíz',
      requestId: 'request-1',
    });
    expect(() => requestedQuizCreation({ title: '   ', requestId: 'request-1' })).toThrow('title');
    expect(() => requestedQuizCreation({ title: 'Kvíz', requestId: 'bad/request' })).toThrow('requestId');
    expect(() => requestedQuizCreation({
      title: 'Kvíz', requestId: 'request-1', status: 'ready',
    })).toThrow('creation request');
  });

  test('derives an idempotent quiz identity without mixing title into the document id', () => {
    const first = quizCreationIdentity('admin-uid', 'stable-request', 'První název');
    const retry = quizCreationIdentity('admin-uid', 'stable-request', 'První název');
    const conflictingRetry = quizCreationIdentity('admin-uid', 'stable-request', 'Jiný název');
    const separateRequest = quizCreationIdentity('admin-uid', 'other-request', 'První název');

    expect(retry).toEqual(first);
    expect(conflictingRetry.quizId).toBe(first.quizId);
    expect(conflictingRetry.fingerprint).not.toBe(first.fingerprint);
    expect(separateRequest.quizId).not.toBe(first.quizId);
    expect(first.quizId).toMatch(/^quiz_[a-f0-9]{64}$/u);
  });
});

describe('quiz editor tolerant Firestore mapper', () => {
  test('maps an unknown type to a locked legacy fallback without exposing raw data', () => {
    const slide = mapEditorSlide('synthetic', {
      position: 1,
      kind: 'future-widget',
      isQuestion: true,
      title: 'Budoucí typ',
      text: 'Syntetický text',
      options: ['A', 'B', 'C', 'D', 'E'],
      correctAnswer: 'Soukromá odpověď',
      media: [{ role: 'mystery', kind: 'widget', value: 'opaque-ref', opaque: true }],
      presentation: { videoStart: 2, unknownControl: true },
      legacy: { raw: { unknownControl: true } },
    });
    expect(slide).toMatchObject({ storedKind: 'future-widget', kind: 'legacy', hasLegacyData: true });
    expect(slide.media[0]).toEqual({ sourceIndex: 0, role: 'unknown', kind: 'unknown', source: 'opaque-ref' });
    expect('legacy' in slide).toBe(false);
  });

  test('accepts migrated quizzes without revision as revision zero', () => {
    const slide = mapEditorSlide('slide-001', {
      position: 1, kind: 'intro', isQuestion: false, title: 'Intro', text: '', options: [], media: [], presentation: {},
    });
    const quiz = mapEditorQuiz('quiz', {
      title: 'Syntetický kvíz', description: '', slideCount: 1, questionCount: 0, roundCount: 0,
    }, [slide]);
    expect(quiz.revision).toBe(0);
  });
});


describe('private authoring drafts and independent answers', () => {
  test('persists a safe incomplete draft without losing opaque legacy fields', () => {
    const input = validateSlideInput(slideInput({kind:'audio', authoringStatus:'draft', answerMode:'choice', options:['','',''], correctAnswer:'', text:'', mediaSource:'https://example.test/clip.wav', clipStartSeconds:0, clipEndSeconds:null}));
    const updated = applyKnownSlideUpdate({position:1, legacy:{raw:{keep:42}}}, input);
    expect(updated).toMatchObject({authoringStatus:'draft', answerMode:'choice', legacy:{raw:{keep:42}}});
    expect(() => applyKnownSlideUpdate(updated, {...input,authoringStatus:'ready'})).toThrow('Otázka není dokončená');
  });
  test.each([{authoringStatus:'published'}, {answerMode:'anything'}, {imageLayout:'anything'}, {answerExplanation:{}}, {authoringStatus:'draft',clipStartSeconds:9,clipEndSeconds:2}, {authoringStatus:'draft',options:[{}]}])('draft marker never permits malformed data %j', fields => {
    expect(() => validateSlideInput(slideInput(fields))).toThrow();
  });
  test.each(['image','audio','video'])('ready %s can have choices or an open answer and round-trips explanation/layout', kind => {
    for (const answerMode of ['choice','open'] as const) {
      const fields = {kind,authoringStatus:'ready',answerMode,options:answerMode==='choice'?['First','Second']:[],correctAnswer:'Second',questionImage:'https://example.test/prompt.png',mediaSource:kind==='audio'?'https://example.test/a.wav':kind==='video'?'https://example.test/v.webm':'',clipStartSeconds:1,clipEndSeconds:3,imageLayout:'stacked',answerExplanation:'After reveal'};
      const updated=applyKnownSlideUpdate({position:1},validateSlideInput(slideInput(fields)));
      expect(mapEditorSlide('q',updated)).toMatchObject({answerMode,authoringStatus:'ready',imageLayout:'stacked',answerExplanation:'After reveal'});
    }
  });
  test('new choices accept 2–6 values, reject ambiguous or excessive values, preserve absent legacy contract', () => {
    for (const count of [2,3,4,5,6]) {
      const options=Array.from({length:count},(_,i)=>'Value '+i);
      expect(applyKnownSlideUpdate({position:1},validateSlideInput(slideInput({authoringStatus:'ready',answerMode:'choice',options,correctAnswer:options.at(-1)})))).toMatchObject({options});
    }
    for (const options of [['same','same'],['a',''],['a','b','c','d','e','f','g']]) expect(() => applyKnownSlideUpdate({position:1},validateSlideInput(slideInput({authoringStatus:'ready',answerMode:'choice',options,correctAnswer:options[0]})))).toThrow();
    expect(applyKnownSlideUpdate({position:1},validateSlideInput(slideInput()))).not.toHaveProperty('authoringStatus');
  });
});
