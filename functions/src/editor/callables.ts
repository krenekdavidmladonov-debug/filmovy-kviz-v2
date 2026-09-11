import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { QuizEditorError } from './errors.js';
import {
  applyKnownSlideUpdate,
  assertRevision,
  createSlideData,
  duplicateSlideData,
  isQuestionKind,
  isRoundKind,
  questionTypeForKind,
  quizCreationIdentity,
  quizRevision,
  sortedSlides,
  type StoredEditorSlide,
} from './model.js';
import type { EditorQuizMutationResponse, EditorSlideKind } from './types.js';
import { applyPreflightRepair, requestedPreflightRepair } from './repair.js';
import {
  expectedRevision,
  isObject,
  requestedDirection,
  requestedPosition,
  requestedRoundRemovalMode,
  requestedRoundTitle,
  requestedQuizCreation,
  requestedSlide,
  requiredId,
  validateQuizMetadata,
} from './validation.js';

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;
const maximumSlideCount = 400;

interface AdminActor {
  readonly uid: string;
  readonly role: 'admin';
}

interface QuizState {
  readonly quizId: string;
  readonly quizRef: FirebaseFirestore.DocumentReference;
  readonly quiz: Record<string, unknown>;
  readonly revision: number;
  readonly slides: readonly StoredEditorSlide[];
}

export function authorizeEditorAdmin(auth: CallableRequest<unknown>['auth']): AdminActor {
  if (auth === undefined) throw new HttpsError('unauthenticated', 'Authentication is required.');
  if (auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an administrator can edit quizzes.');
  }
  return { uid: auth.uid, role: 'admin' };
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new QuizEditorError('failed-precondition', `${location} is malformed.`);
  return value;
}

function requiredStoredCount(quiz: Record<string, unknown>, field: string): number {
  const value = quiz[field];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new QuizEditorError('failed-precondition', 'Quiz counters are malformed.');
  }
  return value as number;
}

async function loadQuizState(
  transaction: Transaction,
  quizId: string,
  revision: number,
): Promise<QuizState> {
  const quizRef = db.collection('quizzes').doc(quizId);
  const quizSnapshot = await transaction.get(quizRef);
  if (!quizSnapshot.exists) throw new QuizEditorError('not-found', 'Quiz was not found.');
  const quiz = snapshotData(quizSnapshot, 'Quiz');
  const currentRevision = assertRevision(quiz, revision);
  const slideSnapshot = await transaction.get(quizRef.collection('slides').orderBy('position'));
  const slides = sortedSlides(slideSnapshot.docs.map((document) => ({
    id: document.id,
    data: snapshotData(document, 'Quiz slide'),
  })));
  if (slides.length !== requiredStoredCount(quiz, 'slideCount')) {
    throw new QuizEditorError('failed-precondition', 'Quiz slideCount does not match its ordered slides.');
  }
  if (slides.length > maximumSlideCount) {
    throw new QuizEditorError('failed-precondition', 'Quiz is too large for one safe editor transaction.');
  }
  return { quizId, quizRef, quiz, revision: currentRevision, slides };
}

function storedKind(slide: StoredEditorSlide): EditorSlideKind {
  const value = slide.data.kind;
  if (typeof value !== 'string') throw new QuizEditorError('failed-precondition', 'Quiz slide kind is malformed.');
  return value as EditorSlideKind;
}

function slideRoundId(slide: StoredEditorSlide): string | undefined {
  return typeof slide.data.roundId === 'string' && slide.data.roundId.length > 0
    ? slide.data.roundId
    : undefined;
}

function stateCounts(slides: readonly StoredEditorSlide[]) {
  const roundIds = new Set(slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  return {
    slideCount: slides.length,
    questionCount: slides.filter((slide) => slide.data.isQuestion === true).length,
    roundCount: roundIds.size,
  };
}

function publicResponse(
  state: QuizState,
  slides: readonly StoredEditorSlide[],
  selectedSlideId?: string,
): EditorQuizMutationResponse {
  return {
    quizId: state.quizId,
    revision: state.revision + 1,
    ...stateCounts(slides),
    ...(selectedSlideId === undefined ? {} : { selectedSlideId }),
  };
}

function orderedWithPositions(slides: readonly StoredEditorSlide[]): readonly StoredEditorSlide[] {
  const positioned: StoredEditorSlide[] = slides.map((slide, index) => ({
    id: slide.id,
    data: { ...slide.data, position: index + 1 },
  }));
  const groups = new Map<string, typeof positioned>();
  for (const slide of positioned) {
    const roundId = slideRoundId(slide);
    if (roundId === undefined) continue;
    const group = groups.get(roundId) ?? [];
    group.push(slide);
    groups.set(roundId, group);
  }
  for (const group of groups.values()) {
    const questions = group.filter((slide) => slide.data.isQuestion === true);
    const header = group.find((slide) => isRoundKind(storedKind(slide)));
    const existingTitle = group.map((slide) => slide.data.roundTitle).find((value): value is string => typeof value === 'string');
    const roundTitle = typeof header?.data.title === 'string' && header.data.title.trim().length > 0
      ? header.data.title : existingTitle;
    group.forEach((slide) => {
      if (roundTitle !== undefined) slide.data.roundTitle = roundTitle;
      const questionIndex = questions.findIndex((question) => question.id === slide.id);
      if (questionIndex >= 0) {
        slide.data.questionNumber = questionIndex + 1;
        slide.data.questionCount = questions.length;
      } else {
        delete slide.data.questionNumber;
        delete slide.data.questionCount;
      }
    });
  }
  return positioned;
}

function derivedPresentation(data: Record<string, unknown>): Record<string, unknown> {
  return isObject(data.presentation) ? data.presentation : {};
}

function writeDerivedState(
  transaction: Transaction,
  state: QuizState,
  slides: readonly StoredEditorSlide[],
): void {
  const storedRoundIds = new Set(state.slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  const groups = new Map<string, StoredEditorSlide[]>();
  for (const slide of slides) {
    const roundId = slideRoundId(slide);
    if (roundId === undefined) continue;
    const group = groups.get(roundId) ?? [];
    group.push(slide);
    groups.set(roundId, group);
  }

  let roundPosition = 0;
  for (const [roundId, group] of groups) {
    roundPosition += 1;
    const header = group.find((slide) => isRoundKind(storedKind(slide)));
    const questions = group.filter((slide) => slide.data.isQuestion === true);
    const inferredType = questions.length > 0 && questions.every((slide) => ['audio', 'music'].includes(String(slide.data.kind)))
      ? 'audio'
      : questions.length > 0 && questions.every((slide) => ['image', 'picture', 'photo'].includes(String(slide.data.kind))) ? 'picture' : 'classic';
    transaction.set(state.quizRef.collection('rounds').doc(roundId), {
      position: roundPosition,
      ...(storedRoundIds.has(roundId) ? {} : { type: inferredType }),
      slideCount: group.length,
      questionCount: questions.length,
      sourceSlideStart: group[0]?.data.position,
      sourceSlideEnd: group[group.length - 1]?.data.position,
      ...(header === undefined
        ? {}
        : { title: typeof header.data.title === 'string' ? header.data.title : `Kolo ${roundPosition}` }),
    }, { merge: true });

    questions.forEach((slide, index) => {
      const kind = storedKind(slide);
      const presentation = derivedPresentation(slide.data);
      const presentationField = (field: string): unknown => (
        Object.hasOwn(presentation, field) ? presentation[field] : FieldValue.delete()
      );
      const correctAnswer = Object.hasOwn(slide.data, 'correctAnswer')
        ? slide.data.correctAnswer
        : FieldValue.delete();
      const moderatorNote = Object.hasOwn(slide.data, 'moderatorNote')
        ? slide.data.moderatorNote
        : FieldValue.delete();
      transaction.set(state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slide.id), {
        position: index + 1,
        prompt: typeof slide.data.text === 'string' && slide.data.text.length > 0
          ? slide.data.text
          : typeof slide.data.title === 'string' ? slide.data.title : '',
        type: questionTypeForKind(kind),
        sourceSlideId: slide.id,
        sourceSlidePosition: slide.data.position,
        options: Array.isArray(slide.data.options) ? slide.data.options : [],
        media: Array.isArray(slide.data.media) ? slide.data.media : [],
        videoStart: presentationField('videoStart'),
        videoEnd: presentationField('videoEnd'),
        audioTrigger: presentationField('audioTrigger'),
        backgroundOverlay: presentationField('backgroundOverlay'),
        answerOverlay: presentationField('answerOverlay'),
        sourceQuestionNumber: presentationField('sourceQuestionNumber'),
        correctAnswer,
        moderatorNote,
      }, { merge: true });
    });
  }
}

function writeQuizState(
  transaction: Transaction,
  state: QuizState,
  slides: readonly StoredEditorSlide[],
  actor: AdminActor,
): EditorQuizMutationResponse {
  const derivedRoundIds = new Set(slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  const derivedQuestions = slides.filter((slide) => slide.data.isQuestion === true && slideRoundId(slide) !== undefined).length;
  const estimatedWrites = slides.length + derivedQuestions + derivedRoundIds.size + 3;
  if (estimatedWrites > 475) {
    throw new QuizEditorError('failed-precondition', 'Quiz is too large for one safe editor transaction.');
  }
  const now = Timestamp.now();
  for (const slide of slides) {
    transaction.set(state.quizRef.collection('slides').doc(slide.id), slide.data);
  }
  writeDerivedState(transaction, state, slides);
  const counts = stateCounts(slides);
  transaction.update(state.quizRef, {
    ...counts,
    revision: state.revision + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
  return publicResponse(state, slides);
}

function deleteOldDerivedQuestion(
  transaction: Transaction,
  state: QuizState,
  slide: StoredEditorSlide,
): void {
  const roundId = slideRoundId(slide);
  if (roundId !== undefined && slide.data.isQuestion === true) {
    transaction.delete(state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slide.id));
  }
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof QuizEditorError) throw new HttpsError(error.code, error.message);
  throw new HttpsError('internal', 'Quiz editor operation failed.');
}

export const createQuiz = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const creation = requestedQuizCreation(request.data);
    const identity = quizCreationIdentity(actor.uid, creation.requestId, creation.title);
    const quizRef = db.collection('quizzes').doc(identity.quizId);
    return await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(quizRef);
      if (existing.exists) {
        const quiz = snapshotData(existing, 'Quiz');
        if (quiz.createdBy !== actor.uid || quiz.creationFingerprint !== identity.fingerprint) {
          throw new QuizEditorError('already-exists', 'requestId was already used for another quiz creation.');
        }
        return {
          quizId: identity.quizId,
          revision: quizRevision(quiz),
          slideCount: requiredStoredCount(quiz, 'slideCount'),
          questionCount: requiredStoredCount(quiz, 'questionCount'),
          roundCount: requiredStoredCount(quiz, 'roundCount'),
        };
      }
      const now = Timestamp.now();
      transaction.create(quizRef, {
        schemaVersion: 1,
        title: creation.title,
        description: '',
        status: 'draft',
        revision: 0,
        slideCount: 0,
        questionCount: 0,
        roundCount: 0,
        creationFingerprint: identity.fingerprint,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
      });
      return {
        quizId: identity.quizId,
        revision: 0,
        slideCount: 0,
        questionCount: 0,
        roundCount: 0,
      };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const updateQuizMetadata = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const revision = expectedRevision(request.data);
    if (!isObject(request.data)) throw new HttpsError('invalid-argument', 'Request data is required.');
    const metadata = validateQuizMetadata(request.data.quiz);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      transaction.update(state.quizRef, {
        ...metadata,
        revision: state.revision + 1,
        updatedAt: Timestamp.now(),
        updatedBy: actor.uid,
      });
      return publicResponse(state, state.slides);
    });
  } catch (error) {
    return mapError(error);
  }
});

export const updateQuizSlide = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const input = requestedSlide(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const currentIsRound = isRoundKind(storedKind(current));
      if (currentIsRound !== isRoundKind(input.kind)) {
        throw new QuizEditorError('invalid-argument', 'Round headers cannot be converted to another slide type.');
      }
      const updated = orderedWithPositions(state.slides.map((slide) => {
        if (slide.id !== slideId) return slide;
        const data = applyKnownSlideUpdate(slide.data, input);
        if (slideRoundId(slide) === undefined && data.isQuestion === true) {
          data.roundId = state.quizRef.collection('rounds').doc().id;
        }
        return { id: slide.id, data };
      }));
      if (current.data.isQuestion === true && !updated.find((slide) => slide.id === slideId)?.data.isQuestion) {
        deleteOldDerivedQuestion(transaction, state, current);
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const repairQuizPreflightIssue = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const repair = requestedPreflightRepair(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const applied = applyPreflightRepair(current, repair);
      transaction.set(state.quizRef.collection('slides').doc(slideId), applied.slide.data);
      const roundId = slideRoundId(current);
      if (applied.kind === 'choice-answer' && roundId !== undefined && applied.privateCorrectAnswer !== undefined) {
        transaction.set(
          state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slideId),
          { correctAnswer: applied.privateCorrectAnswer },
          { merge: true },
        );
      }
      transaction.update(state.quizRef, {
        revision: state.revision + 1,
        updatedAt: Timestamp.now(),
        updatedBy: actor.uid,
      });
      return { ...publicResponse(state, state.slides, slideId) };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const createQuizSlide = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const revision = expectedRevision(request.data);
    const position = requestedPosition(request.data);
    const input = requestedSlide(request.data);
    const quizRef = db.collection('quizzes').doc(quizId);
    const slideRef = quizRef.collection('slides').doc();
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if (state.slides.length >= maximumSlideCount || position > state.slides.length + 1) {
        throw new QuizEditorError('invalid-argument', 'Slide position is outside the quiz range.');
      }
      const before = state.slides[position - 2];
      const inheritedRoundId = before === undefined ? undefined : slideRoundId(before);
      const roundId = isRoundKind(input.kind) || (inheritedRoundId === undefined && isQuestionKind(input.kind))
        ? quizRef.collection('rounds').doc().id
        : inheritedRoundId;
      const created: StoredEditorSlide = {
        id: slideRef.id,
        data: createSlideData(input, position, roundId),
      };
      const updated = orderedWithPositions([
        ...state.slides.slice(0, position - 1),
        created,
        ...state.slides.slice(position - 1),
      ]);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideRef.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const duplicateQuizSlide = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const quizRef = db.collection('quizzes').doc(quizId);
    const duplicateRef = quizRef.collection('slides').doc();
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if (state.slides.length >= maximumSlideCount) {
        throw new QuizEditorError('failed-precondition', 'Quiz reached the safe slide limit.');
      }
      const index = state.slides.findIndex((slide) => slide.id === slideId);
      const source = state.slides[index];
      if (source === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const data = duplicateSlideData(source.data, index + 2);
      if (isRoundKind(storedKind(source))) data.roundId = quizRef.collection('rounds').doc().id;
      const duplicate: StoredEditorSlide = { id: duplicateRef.id, data };
      const updated = orderedWithPositions([
        ...state.slides.slice(0, index + 1), duplicate, ...state.slides.slice(index + 1),
      ]);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: duplicateRef.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const deleteQuizSlide = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if (state.slides.length <= 1) {
        throw new QuizEditorError('failed-precondition', 'A quiz must keep at least one slide.');
      }
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const roundId = slideRoundId(current);
      if (isRoundKind(storedKind(current)) && roundId !== undefined
        && state.slides.some((slide) => slide.id !== slideId && slideRoundId(slide) === roundId)) {
        throw new QuizEditorError('failed-precondition', 'Move or delete the slides in this round before deleting its header.');
      }
      deleteOldDerivedQuestion(transaction, state, current);
      transaction.delete(state.quizRef.collection('slides').doc(slideId));
      const updated = orderedWithPositions(state.slides.filter((slide) => slide.id !== slideId));
      if (roundId !== undefined && !updated.some((slide) => slideRoundId(slide) === roundId)) {
        transaction.delete(state.quizRef.collection('rounds').doc(roundId));
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: updated[Math.min((current.data.position as number) - 1, updated.length - 1)]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizSlide = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const direction = requestedDirection(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const index = state.slides.findIndex((slide) => slide.id === slideId);
      if (index < 0) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= state.slides.length) {
        throw new QuizEditorError('invalid-argument', 'Slide cannot move outside the quiz.');
      }
      const reordered = [...state.slides];
      const target = reordered[targetIndex];
      const current = reordered[index];
      if (target === undefined || current === undefined) throw new QuizEditorError('failed-precondition', 'Slide order is malformed.');
      reordered[index] = target;
      reordered[targetIndex] = current;
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const updateQuizRound = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const title = requestedRoundTitle(request.data);
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const members = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (members.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      const updated = orderedWithPositions(state.slides.map((slide) => {
        if (slideRoundId(slide) !== roundId) return slide;
        const data: Record<string, unknown> = { ...slide.data, roundTitle: title };
        if (isRoundKind(storedKind(slide))) data.title = title;
        return { ...slide, data };
      }));
      const result = writeQuizState(transaction, state, updated, actor);
      transaction.set(state.quizRef.collection('rounds').doc(roundId), { title }, { merge: true });
      return { ...result, selectedSlideId: members[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const reorderQuizQuestion = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const direction = requestedDirection(request.data);
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      const roundId = current === undefined ? undefined : slideRoundId(current);
      if (current === undefined || current.data.isQuestion !== true) {
        throw new QuizEditorError('not-found', 'Quiz question was not found.');
      }
      const questions = state.slides.filter((slide) => slideRoundId(slide) === roundId && slide.data.isQuestion === true);
      const questionIndex = questions.findIndex((slide) => slide.id === slideId);
      const target = questions[questionIndex + direction];
      if (target === undefined) throw new QuizEditorError('invalid-argument', 'Question cannot move outside its round.');
      const currentIndex = state.slides.findIndex((slide) => slide.id === current.id);
      const targetIndex = state.slides.findIndex((slide) => slide.id === target.id);
      const reordered = [...state.slides];
      reordered[currentIndex] = target;
      reordered[targetIndex] = current;
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizQuestionToRound = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const targetRoundId = requiredId(request.data, 'targetRoundId');
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      const sourceRoundId = current === undefined ? undefined : slideRoundId(current);
      if (current === undefined || current.data.isQuestion !== true) {
        throw new QuizEditorError('not-found', 'Quiz question was not found.');
      }
      if (sourceRoundId !== undefined && sourceRoundId === targetRoundId) throw new QuizEditorError('invalid-argument', 'Question is already in this round.');
      const targetMembers = state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      if (targetMembers.length === 0) throw new QuizEditorError('not-found', 'Target quiz round was not found.');
      const targetTitle = targetMembers.find((slide) => typeof slide.data.roundTitle === 'string')?.data.roundTitle;
      const moved: StoredEditorSlide = {
        ...current,
        data: {
          ...current.data,
          roundId: targetRoundId,
          ...(typeof targetTitle === 'string' ? { roundTitle: targetTitle } : {}),
        },
      };
      const without = state.slides.filter((slide) => slide.id !== slideId);
      const recapIndex = without.findIndex((slide) => slideRoundId(slide) === targetRoundId && storedKind(slide) === 'recap');
      const lastTargetIndex = without.reduce((found, slide, index) => slideRoundId(slide) === targetRoundId ? index : found, -1);
      const insertIndex = recapIndex >= 0 ? recapIndex : lastTargetIndex + 1;
      without.splice(insertIndex, 0, moved);
      deleteOldDerivedQuestion(transaction, state, current);
      const updated = orderedWithPositions(without);
      if (sourceRoundId !== undefined && !updated.some((slide) => slideRoundId(slide) === sourceRoundId)) {
        transaction.delete(state.quizRef.collection('rounds').doc(sourceRoundId));
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const duplicateQuizRound = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const source = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (source.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      if (state.slides.length + source.length > maximumSlideCount) {
        throw new QuizEditorError('failed-precondition', 'Duplicated round would make the quiz too large.');
      }
      const newRoundId = state.quizRef.collection('rounds').doc().id;
      const currentTitle = source.find((slide) => typeof slide.data.roundTitle === 'string')?.data.roundTitle
        ?? source.find((slide) => isRoundKind(storedKind(slide)) && typeof slide.data.title === 'string')?.data.title;
      const copiedTitle = typeof currentTitle === 'string' && currentTitle.trim() !== '' ? `${currentTitle} – kopie` : 'Kopie kola';
      const copies = source.map((slide) => ({
        id: state.quizRef.collection('slides').doc().id,
        data: {
          ...slide.data,
          roundId: newRoundId,
          roundTitle: copiedTitle,
          ...(isRoundKind(storedKind(slide)) ? { title: copiedTitle } : {}),
        },
      }));
      const sourceLastIndex = state.slides.reduce((found, slide, index) => slideRoundId(slide) === roundId ? index : found, -1);
      const combined = [...state.slides];
      combined.splice(sourceLastIndex + 1, 0, ...copies);
      const updated = orderedWithPositions(combined);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: copies[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizRound = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const direction = requestedDirection(request.data);
    const revision = expectedRevision(request.data);
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const roundIds = [...new Set(state.slides.map(slideRoundId).filter((value): value is string => value !== undefined))];
      const roundIndex = roundIds.indexOf(roundId);
      const targetRoundId = roundIds[roundIndex + direction];
      if (roundIndex < 0 || targetRoundId === undefined) throw new QuizEditorError('invalid-argument', 'Round cannot move further.');
      const selected = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      const target = state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      const replacement = direction === -1 ? [...selected, ...target] : [...target, ...selected];
      const involvedIds = new Set(replacement.map((slide) => slide.id));
      let replacementIndex = 0;
      const reordered = state.slides.map((slide) => involvedIds.has(slide.id) ? replacement[replacementIndex++]! : slide);
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: selected[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const removeQuizRound = onCall(callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const revision = expectedRevision(request.data);
    const mode = requestedRoundRemovalMode(request.data);
    const targetRoundId = mode === 'move' ? requiredId(request.data, 'targetRoundId') : undefined;
    return await db.runTransaction(async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const source = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (source.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      const questions = source.filter((slide) => slide.data.isQuestion === true);
      if (targetRoundId === roundId) throw new QuizEditorError('invalid-argument', 'Target round must be different.');
      const target = targetRoundId === undefined ? [] : state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      if (mode === 'move' && target.length === 0) throw new QuizEditorError('not-found', 'Target quiz round was not found.');
      const movedTitle = target.find((slide) => typeof slide.data.roundTitle === 'string')?.data.roundTitle;
      const sourceIds = new Set(source.map((slide) => slide.id));
      const kept = state.slides.filter((slide) => !sourceIds.has(slide.id));
      let movedQuestions: StoredEditorSlide[] = [];
      if (mode === 'move' && targetRoundId !== undefined) {
        movedQuestions = questions.map((slide) => ({
          ...slide,
          data: {
            ...slide.data,
            roundId: targetRoundId,
            ...(typeof movedTitle === 'string' ? { roundTitle: movedTitle } : {}),
          },
        }));
        const recapIndex = kept.findIndex((slide) => slideRoundId(slide) === targetRoundId && storedKind(slide) === 'recap');
        const lastTargetIndex = kept.reduce((found, slide, index) => slideRoundId(slide) === targetRoundId ? index : found, -1);
        kept.splice(recapIndex >= 0 ? recapIndex : lastTargetIndex + 1, 0, ...movedQuestions);
      }
      if (kept.length === 0) throw new QuizEditorError('failed-precondition', 'A quiz must keep at least one slide.');
      for (const slide of source) {
        deleteOldDerivedQuestion(transaction, state, slide);
        if (!movedQuestions.some((moved) => moved.id === slide.id)) {
          transaction.delete(state.quizRef.collection('slides').doc(slide.id));
        }
      }
      transaction.delete(state.quizRef.collection('rounds').doc(roundId));
      const updated = orderedWithPositions(kept);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: movedQuestions[0]?.id ?? updated[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});
