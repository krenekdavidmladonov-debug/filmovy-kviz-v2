import { resolveSlideDesign, resolveLegacySlideAppearance, type SlideDesign, type ResultTemplates, type PrintTemplate } from '@filmovy-kviz/quiz-domain';
import { SlideDesignFields, legacySlideDesign } from '../../features/editor/SlideDesignFields';
import { ResultTemplatePreview } from '../../features/editor/ResultTemplatePreview';
import { PrintTemplateFields } from '../../features/print/PrintTemplateFields';
import { QuizPractice } from '../../features/editor/QuizPractice';
import { MediaAuthoringContext } from '../../features/media/MediaUploadField';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { RemoveRoundDialog, UnsavedChangesDialog } from '../../features/editor/EditorDialogs';
import {
  EditorPreview,
  QuestionForm,
  QuizSettingsForm,
  ReadinessSummary,
  RoundSettingsForm,
  SystemContentForm,
  SystemSectionForm,
} from '../../features/editor/EditorForms';
import { EditorOutline } from '../../features/editor/EditorOutline';
import { moveOutlineQuestion } from '../../features/editor/outlineMoves';
import {
  createQuizSlide,
  createQuizRound,
  deleteQuizSlide,
  duplicateQuizRound,
  duplicateQuizSlide,
  moveQuizQuestionToRound,
  moveQuizRound,
  moveQuizSlide,
  removeQuizRound,
  reorderQuizQuestion,
  staleEditorMessage,
  updateQuizMetadata,
  updateQuizRound,
  updateQuizSlide,
} from '../../features/editor/editorApi';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import {
  buildSemanticQuizModel,
  insertionPositionForRound,
  storageKindForQuestion,
  type SemanticQuizModel,
  type SemanticRound,
} from '../../features/editor/semanticModel';
import { editorSaveLabels, editorSaveStatus } from '../../features/editor/sessionState';
import { overlayEntries, saveEditorEntries, type EditorEntries, type PendingEditorEntry } from '../../features/editor/workingCopy';
import type { CreatableQuestionType, EditableSlideKind, EditorQuiz, EditorSlide } from '../../features/editor/types';
import { hasSaveBlockingIssues } from '../../features/editor/validation';
import { defaultRules, generatedAgendaOptions } from '../../features/presentation/model';
import { QuizPreflightPanel } from '../../features/preflight/QuizPreflightPanel';
import type { PreflightFixTarget } from '../../features/preflight/types';
import { quizWithDraft, runQuizPreflight } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError } from '../../ui/HumanError';
import { TechnicalDetails } from '../../ui/TechnicalDetails';

type EditorPanel = 'structure' | 'content' | 'preview';

interface PendingCreate {
  readonly position: number;
  readonly semanticKey: string;
}

interface PendingFixFocus {
  readonly selectionKey: string;
  readonly field: string;
  readonly questionId?: string;
}

const questionKinds = new Set<EditableSlideKind>([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo', 'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);

const emptyFields = {
  title: '', text: '', moderatorNote: '', options: [] as readonly string[], correctAnswer: '', media: [] as const,
  presentation: {
    videoStart: null, videoEnd: null, audioTrigger: null,
    backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null,
  },
  backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '',
  backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null,
  hasLegacyData: false,
};

function localDraft(kind: EditableSlideKind, position: number, values: Partial<EditorSlide> = {}): EditorSlide {
  return {
    ...emptyFields,
    id: `local-${kind}`,
    position,
    storedKind: kind,
    kind,
    isQuestion: questionKinds.has(kind),
    ...values,
  };
}

function newQuestionDraft(type: CreatableQuestionType, round: SemanticRound): EditorSlide {
  const kind = storageKindForQuestion(type);
  const position = insertionPositionForRound(round);
  const questionNumber = round.questions.filter((question) => question.slide.position < position).length + 1;
  return localDraft(kind, position, {
    id: `local-question-${type}`,
    roundId: round.id,
    roundTitle: round.title,
    questionNumber,
    questionCount: round.questions.length + 1,
    authoringStatus: 'ready', answerMode: type === 'choice' ? 'choice' : 'open',
    options: type === 'choice' ? ['', '', '', ''] : [],
    clipStartSeconds: type === 'audio' || type === 'video' ? 0 : null,
  });
}

function systemDraft(key: string, model: SemanticQuizModel, position: number): EditorSlide {
  if (key === 'rules') return localDraft('rules', position, { options: [...defaultRules] });
  if (key === 'agenda') return localDraft('agenda', position, { automaticAgenda: true, options: generatedAgendaOptions(model.rounds) });
  return localDraft('intro', position);
}

function roundForSelection(key: string, model: SemanticQuizModel): SemanticRound | undefined {
  if (key.startsWith('round:')) return model.rounds.find((round) => round.id === key.slice('round:'.length));
  const slideId = key.startsWith('slide:') ? key.slice('slide:'.length) : undefined;
  return slideId === undefined ? undefined : model.rounds.find((round) => round.slides.some((slide) => slide.id === slideId));
}

function selectionForSlide(slideId: string | undefined, model: SemanticQuizModel, fallback = 'quiz'): string {
  if (slideId === undefined) return fallback;
  const round = model.rounds.find((item) => item.settingsSlide?.id === slideId);
  return round === undefined ? `slide:${slideId}` : `round:${round.id}`;
}

function safeErrorMessage(error: unknown): string {
  if ((error as { code?: string })?.code === 'functions/permission-denied') return 'K tomuto kvízu nebo požadované úpravě nemáte oprávnění. Kontaktujte správce přístupu.';
  if (error instanceof Error && (error.message === staleEditorMessage || /aborted|revision|newer|stale/iu.test(error.message))) {
    return 'Kvíz mezitím upravil někdo jiný. Načtěte aktuální verzi a změnu proveďte znovu.';
  }
  return 'Změnu se nepodařilo uložit. Rozepsané hodnoty zůstaly v editoru.';
}

const initialAppearance = { backgroundImage: '', backgroundOverlay: 0, imageLayout: 'split' as const };

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const readOnly = !can('quiz.edit');
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [practicing, setPracticing] = useState(false);
  const practiceButtonRef = useRef<HTMLButtonElement>(null), restorePracticeFocus = useRef(false);
  useEffect(() => {
    if (!practicing && restorePracticeFocus.current && practiceButtonRef.current) {
      restorePracticeFocus.current = false;
      practiceButtonRef.current.focus({ preventScroll: true });
    }
  }, [practicing]);
  const [selectedKey, setSelectedKey] = useState('quiz');
  const [draft, setDraft] = useState<EditorSlide | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [appearance, setAppearance] = useState<import('@filmovy-kviz/quiz-domain').EditorAppearance>(initialAppearance);
  const [roundTitle, setRoundTitle] = useState('');
  const [defaultDesign, setDefaultDesign] = useState<SlideDesign>({});
  const [resultTemplates, setResultTemplates] = useState<ResultTemplates>({});
  const [printTemplate, setPrintTemplate] = useState<PrintTemplate>({});
  const [dirtySlide, setDirtySlide] = useState(false);
  const [dirtyQuiz, setDirtyQuiz] = useState(false);
  const [dirtyRound, setDirtyRound] = useState(false);
  const [parked, setParkedState] = useState<EditorEntries>({});
  const parkedRef = useRef<EditorEntries>({});
  const setParked = useCallback((entries: EditorEntries) => { parkedRef.current = entries; setParkedState(entries); }, []);
  const savePending = useRef(false);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [removeRound, setRemoveRound] = useState<SemanticRound | null>(null);
  const [pickerRoundId, setPickerRoundId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<EditorPanel>('content');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showReadiness, setShowReadiness] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightNonce, setPreflightNonce] = useState(0);
  const [pendingFixFocus, setPendingFixFocus] = useState<PendingFixFocus | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadPending = useRef(false);
  const onUploadPending = useCallback((pending: boolean) => { uploadPending.current = pending; setUploading(pending); }, []);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  useEffect(() => { setLastSavedAt(null); }, [quizId, readOnly]);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const handledDeepLink = useRef<string | undefined>(undefined);
  const loadGeneration = useRef(0);
  const dirty = dirtySlide || dirtyQuiz || dirtyRound || Object.keys(parked).length > 0;
  const blocker = useBlocker(dirty || uploading || saving);
  const semantic = useMemo(() => quiz === null ? null : buildSemanticQuizModel(quiz), [quiz]);
  const selectedRoundForDraft = semantic === null ? undefined : roundForSelection(selectedKey, semantic)
    ?? (selectedKey === 'draft' ? semantic.rounds.find((round) => round.id === draft?.roundId) : undefined);
  const preflightQuiz = useMemo(() => {
    if (quiz === null) return null;
    return quizWithDraft(overlayEntries(quiz, parked), {
      title,
      description,
      draft,
      ...(pendingCreate === null ? {} : { pendingPosition: pendingCreate.position }),
      ...(dirtyRound && selectedRoundForDraft !== undefined
        ? { roundId: selectedRoundForDraft.id, roundTitle }
        : {}),
    });
  }, [description, dirtyRound, draft, parked, pendingCreate, quiz, roundTitle, selectedRoundForDraft, title]);
  const outlineModel = useMemo(() => quiz === null ? null : buildSemanticQuizModel(overlayEntries(quiz,
    Object.fromEntries(Object.entries(parked).filter(([, entry]) => entry.pendingCreate === null)))), [quiz, parked]);
  const preflightResult = useMemo(() => preflightQuiz === null ? null : runQuizPreflight(preflightQuiz, {
    source: dirty ? 'LOCAL_DRAFT' : 'SAVED_QUIZ',
    hasUnsavedChanges: dirty,
  }), [dirty, preflightNonce, preflightQuiz]);

  const reload = useCallback(async (preferredKey = 'quiz', preferredSlideId?: string): Promise<EditorQuiz | null> => {
    const attempt = ++loadGeneration.current;
    if (!quizId) {
      setError('Kvíz nelze otevřít, protože chybí jeho identifikátor.');
      setLoading(false);
      return null;
    }
    try {
      const loaded = await getEditorQuiz(quizId);
      if (attempt !== loadGeneration.current) return null;
      if (loaded === null) {
        setError('Kvíz nebyl nalezen.');
        return null;
      }
      const model = buildSemanticQuizModel(loaded);
      setQuiz(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description);
      setAppearance(loaded.defaultAppearance ?? initialAppearance);
      setDefaultDesign(loaded.defaultDesign ?? {});
      setResultTemplates(loaded.resultTemplates ?? {});
      setPrintTemplate(loaded.printTemplate ?? {});
      setSelectedKey(preferredSlideId === undefined ? preferredKey : selectionForSlide(preferredSlideId, model, preferredKey));
      setDirtySlide(false);
      setDirtyQuiz(false);
      setDirtyRound(false);
      setParked({});
      setPendingCreate(null);
      setTouched(new Set());
      setShowReadiness(false);
      setPreflightOpen(false);
      setSaveFailed(false);
      setError(null);
      return loaded;
    } catch (loadError) {
      if (attempt === loadGeneration.current) setError(safeErrorMessage(loadError));
      return null;
    } finally {
      if (attempt === loadGeneration.current) setLoading(false);
    }
  }, [quizId, setParked]);

  useEffect(() => {
    void reload();
    // StrictMode and route changes can leave an earlier request in flight.
    return () => { loadGeneration.current++; };
  }, [reload]);

  useEffect(() => {
    if (semantic === null || quiz?.id !== quizId) return;
    const deepLinkKey = `${quizId ?? ''}?${searchParams.toString()}`;
    if (handledDeepLink.current === deepLinkKey) return;
    const questionId = searchParams.get('questionId');
    const roundId = searchParams.get('roundId');
    const section = searchParams.get('section');
    const field = searchParams.get('field');
    let selectionKey: string | undefined;
    if (questionId !== null && semantic.questionBySlideId.has(questionId)) selectionKey = `slide:${questionId}`;
    else if (roundId !== null && semantic.rounds.some((round) => round.id === roundId)) selectionKey = `round:${roundId}`;
    else if (section === 'agenda') selectionKey = 'system:agenda';
    else if (field === 'quizTitle') selectionKey = 'quiz';
    handledDeepLink.current = deepLinkKey;
    if (selectionKey === undefined) return;
    setSelectedKey(selectionKey);
    setActivePanel('content');
    if (field !== null) setPendingFixFocus({ selectionKey, field, ...(questionId === null ? {} : { questionId }) });
  }, [quiz?.id, quizId, searchParams, semantic]);

  useEffect(() => {
    if (quiz === null || semantic === null) return;
    const stored = parkedRef.current[selectedKey];
    if (stored !== undefined) {
      setDraft(stored.draft); setRoundTitle(stored.roundTitle);
      setDirtySlide(stored.dirtySlide); setDirtyRound(stored.dirtyRound); setPendingCreate(stored.pendingCreate);
      setShowAnswer(false); setTouched(new Set()); setShowReadiness(false);
      return;
    }
    if (selectedKey === 'draft') return;
    setDirtySlide(false); setDirtyRound(false);
    setShowAnswer(false);
    setTouched(new Set());
    setShowReadiness(false);
    setPendingCreate(null);
    if (selectedKey === 'quiz' || selectedKey.startsWith('results:')) {
      setDraft(null);
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('system:')) {
      const key = selectedKey.slice('system:'.length) as 'opening' | 'agenda' | 'rules';
      const section = semantic.introduction.find((item) => item.key === key);
      if (section?.slide !== undefined) setDraft(section.slide);
      else {
        const previous = semantic.introduction.slice(0, ['opening','agenda','rules'].indexOf(key)).flatMap(item => item.slide ? [item.slide.position] : []);
        const position = previous.length ? Math.max(...previous) + 1 : 1;
        setDraft(systemDraft(key, semantic, position));
        setPendingCreate({ position, semanticKey: selectedKey });
      }
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('round:')) {
      const round = roundForSelection(selectedKey, semantic);
      if (round !== undefined && round.id !== 'roundless' && round.settingsSlide === undefined) {
        setDraft(localDraft('round', round.firstPosition, { roundId: round.id, roundTitle: round.title, title: round.title }));
        setPendingCreate({ position: round.firstPosition, semanticKey: selectedKey });
      } else setDraft(round?.settingsSlide ?? null);
      setRoundTitle(round?.title ?? '');
      return;
    }
    const slideId = selectedKey.startsWith('slide:') ? selectedKey.slice('slide:'.length) : '';
    setDraft(semantic.slideById.get(slideId) ?? null);
    setRoundTitle('');
  }, [quiz, selectedKey, semantic]);

  useEffect(() => {
    if (pendingFixFocus === null || pendingFixFocus.selectionKey !== selectedKey) return;
    if (pendingFixFocus.questionId !== undefined && draft?.id !== pendingFixFocus.questionId) return;
    setShowReadiness(true);
    const field = pendingFixFocus.field;
    setPendingFixFocus(null);
    requestAnimationFrame(() => {
      const fieldElement = document.querySelector<HTMLElement>(`[data-preflight-field="${field}"]`);
      const focusable = fieldElement?.matches('input, textarea, select, button')
        ? fieldElement
        : fieldElement?.querySelector<HTMLElement>('input, textarea, select, button');
      focusable?.focus();
      fieldElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [draft, pendingFixFocus, selectedKey]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty && !uploadPending.current && !savePending.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveAll = useCallback(async (afterKey = selectedKey, saveAs?: 'draft' | 'ready'): Promise<EditorQuiz | null> => {
    if (quiz === null || readOnly || semantic === null || uploadPending.current || savePending.current) return null;
    const entries: Record<string, PendingEditorEntry> = { ...parkedRef.current };
    delete entries[selectedKey];
    if (dirtySlide || dirtyRound || saveAs !== undefined) entries[selectedKey] = {
      draft: draft !== null && saveAs !== undefined ? { ...draft, authoringStatus: saveAs } : draft,
      dirtySlide: dirtySlide || saveAs !== undefined, dirtyRound, roundTitle,
      roundId: selectedRoundForDraft?.id, pendingCreate,
    };
    for (const [key, entry] of Object.entries(entries)) {
      const persisted = quiz.slides.find(slide => slide.id === entry.draft?.id);
      if (entry.dirtySlide && entry.draft?.isQuestion && entry.draft.authoringStatus !== 'draft'
        && hasSaveBlockingIssues(entry.draft, persisted, !can('quiz.answers.read'))) {
        setParked(entries); setSelectedKey(key); setShowReadiness(true);
        setPendingFixFocus({ selectionKey: key, field: 'prompt', questionId: entry.draft.id });
        setError('Před uložením opravte označené údaje. Ostatní rozepsané změny zůstávají zachované.');
        requestAnimationFrame(() => errorRef.current?.focus()); return null;
      }
      if (entry.dirtyRound && entry.roundTitle.trim() === '') {
        setParked(entries); setSelectedKey(key); setError('Název kola nesmí být prázdný.'); return null;
      }
    }
    if (dirtyQuiz && title.trim() === '') { setError('Název kvízu nesmí být prázdný.'); return null; }
    savePending.current = true; setSaving(true); setError(null); setSaveFailed(false);
    try {
      const result = await saveEditorEntries(quiz, entries, dirtyQuiz ? { title, description, appearance, defaultDesign, resultTemplates, printTemplate } : null, {
        updateSlide: updateQuizSlide, createSlide: createQuizSlide,
        updateRound: updateQuizRound, updateMetadata: updateQuizMetadata,
      });
      setParked(result.remaining);
      setQuiz(result.quiz);
      setDirtyQuiz(result.metadataPending);
      const active = result.remaining[selectedKey];
      setDirtySlide(active?.dirtySlide ?? false); setDirtyRound(active?.dirtyRound ?? false);
      setPendingCreate(active?.pendingCreate ?? null);
      if (selectedKey === 'draft' && result.created[selectedKey]) setSelectedKey(`slide:${result.created[selectedKey]}`);
      if (result.error !== null) {
        setSaveFailed(true);
        const remainingScopes = Object.values(result.remaining).map(entry => entry.dirtyRound ? `kolo ${entry.roundTitle || 'bez názvu'}` : entry.draft?.text || entry.draft?.title || 'slide bez názvu').map(label => label.length > 65 ? label.slice(0, 62) + '…' : label);
        if (result.metadataPending) remainingScopes.push('společný vzhled, údaje kvízu a šablony');
        setError((result.acknowledged > 0 ? 'Část změn je uložená. ' : '') + `Zbývá uložit: ${remainingScopes.join('; ')}. ` + safeErrorMessage(result.error));
        requestAnimationFrame(() => errorRef.current?.focus()); return null;
      }
      if (result.acknowledged > 0) setLastSavedAt(new Date());
      const createdId = result.created[selectedKey];
      const key = pendingCreate?.semanticKey ?? afterKey;
      const refreshed = await reload(key, pendingCreate?.semanticKey.startsWith('system:') ? undefined : createdId);
      if (refreshed === null) setError('Změny jsou uložené, ale nový náhled se nepodařilo načíst. Obnovte stránku.');
      return refreshed ?? result.quiz;
    } finally { savePending.current = false; setSaving(false); }
  }, [appearance, defaultDesign, resultTemplates, printTemplate, can, description, dirtyQuiz, dirtyRound, dirtySlide, draft, pendingCreate, quiz, readOnly, reload, roundTitle, selectedKey, selectedRoundForDraft, semantic, setParked, title]);

  useEffect(() => {
    const keyboardSave = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving && !readOnly) void saveAll();
      }
    };
    window.addEventListener('keydown', keyboardSave);
    return () => window.removeEventListener('keydown', keyboardSave);
  }, [dirty, readOnly, saveAll, saving]);

  function discardDraft() {
    if (quiz === null) return;
    setTitle(quiz.title);
    setDescription(quiz.description);
    setAppearance(quiz.defaultAppearance ?? initialAppearance);
    setDefaultDesign(quiz.defaultDesign ?? {});
    setResultTemplates(quiz.resultTemplates ?? {});
    setPrintTemplate(quiz.printTemplate ?? {});
    setDirtySlide(false);
    setDirtyQuiz(false);
    setDirtyRound(false);
    setParked({});
    setQuiz({ ...quiz });
    if (selectedKey === 'draft') {
      setDraft(null);
      setSelectedKey(draft?.roundId ? `round:${draft.roundId}` : 'quiz');
    }
    setPendingCreate(null);
    setSaveFailed(false);
    setError(null);
  }

  async function discardAndReload() {
    if (uploadPending.current || savePending.current) return;
    if (!window.confirm('Zahodit všechny zbývající rozepsané změny a načíst aktuální verzi kvízu?')) return;
    savePending.current = true;
    setSaving(true);
    try {
      if (await reload() === null) setSaveFailed(true);
    } catch (loadError) {
      setSaveFailed(true);
      setError(safeErrorMessage(loadError));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  function select(key: string) {
    if (key === selectedKey || uploadPending.current || savePending.current) return;
    setPickerRoundId(null);
    if (pendingCreate !== null && dirtySlide) { setPendingSelection(key); return; }
    const entries = { ...parkedRef.current };
    delete entries[selectedKey];
    if (dirtySlide || dirtyRound) entries[selectedKey] = { draft, dirtySlide, dirtyRound, roundTitle,
      roundId: selectedRoundForDraft?.id, pendingCreate };
    setParked(entries);
    setSelectedKey(key);
    if (window.matchMedia('(max-width: 767px)').matches) setActivePanel('content');
  }

  function openPreflightFix(target: PreflightFixTarget) {
    let selectionKey = 'quiz';
    if (target.kind === 'question' && target.questionId !== undefined) {
      selectionKey = pendingCreate !== null && draft?.id === target.questionId ? 'draft' : `slide:${target.questionId}`;
    } else if (target.kind === 'round' && target.roundId !== undefined) {
      selectionKey = `round:${target.roundId}`;
    } else if (target.kind === 'system' && target.systemKey !== undefined) {
      selectionKey = `system:${target.systemKey}`;
    }
    setPreflightOpen(false);
    setActivePanel('content');
    if (target.field !== undefined) {
      setPendingFixFocus({
        selectionKey,
        field: target.field,
        ...(target.questionId === undefined ? {} : { questionId: target.questionId }),
      });
    }
    select(selectionKey);
  }

  async function mutate(action: (current: EditorQuiz) => Promise<{ readonly selectedSlideId?: string }>, preferredKey?: string): Promise<boolean> {
    if (quiz === null || readOnly || dirty || uploadPending.current || savePending.current) return false;
    savePending.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await action(quiz);
      return await reload(preferredKey ?? selectedKey, result.selectedSlideId) !== null;
    } catch (mutationError) {
      setError(safeErrorMessage(mutationError));
      requestAnimationFrame(() => errorRef.current?.focus());
      return false;
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  async function moveInOutline(id: string, roundId: string | undefined, beforeId?: string): Promise<boolean> {
    if (quiz === null || readOnly || dirty || uploadPending.current || savePending.current) return false;
    savePending.current = true; setSaving(true); setError(null);
    try {
      await moveOutlineQuestion(quiz, id, roundId, beforeId);
      return await reload(`slide:${id}`) !== null;
    } catch (moveError) {
      // Several revision-protected steps may have succeeded; read the actual order.
      await reload(`slide:${id}`);
      setError('Přesun nebyl dokončen. Některé kroky už mohou být uložené. ' + safeErrorMessage(moveError));
      return false;
    } finally { savePending.current = false; setSaving(false); }
  }

  if (loading && quiz === null) return <QuizLoading label="Načítám editor kvízu…" />;
  if (quiz === null || semantic === null) return <QuizErrorState message={error ?? 'Kvíz se nepodařilo otevřít.'} onRetry={() => void reload()} />;

  if (practicing) return <QuizPractice quiz={quiz} onClose={() => { restorePracticeFocus.current = true; setPracticing(false); }} />;

  const selectedRound = roundForSelection(selectedKey, semantic)
    ?? (selectedKey === 'draft' ? semantic.rounds.find((round) => round.id === draft?.roundId) : undefined);
  const selectedQuestion = draft === null ? undefined : semantic.questionBySlideId.get(draft.id);
  const isLocalQuestion = selectedKey === 'draft' && draft?.isQuestion === true;
  const questionNumber = selectedQuestion?.number ?? draft?.questionNumber ?? 1;
  const selectedSection = selectedKey.startsWith('system:')
    ? semantic.introduction.find((item) => item.key === selectedKey.slice('system:'.length))
    : undefined;
  const selectedTemplate = selectedKey.startsWith('results:') ? selectedKey.slice('results:'.length) as 'interim' | 'final' : undefined;
  const template = selectedTemplate ? resultTemplates[selectedTemplate] : undefined;
  const inheritedRound = selectedRound === undefined ? undefined : (parked[`round:${selectedRound.id}`]?.draft ?? selectedRound.settingsSlide)?.design;
  const inheritedDesign = resolveSlideDesign(defaultDesign, selectedKey.startsWith('round:') ? undefined : inheritedRound);
  const previewBase = selectedTemplate ? localDraft('end', 0, { title: template?.title ?? (selectedTemplate === 'final' ? 'Finální výsledky' : 'Průběžné pořadí'), text: template?.subtitle ?? 'Pořadí a body se doplní z publikovaných výsledků.', ...(template?.design ? { design: template.design } : {}) }) : draft ?? selectedRound?.settingsSlide ?? semantic.introduction.find((item) => item.slide)?.slide ?? quiz.slides[0];
  const previewSlide = previewBase === undefined ? undefined : {
    ...previewBase, ...resolveLegacySlideAppearance(appearance, previewBase), design: resolveSlideDesign(defaultDesign, selectedKey.startsWith('round:') || selectedTemplate ? undefined : inheritedRound, previewBase.design),
    ...(selectedKey.startsWith('round:') && dirtyRound ? { title: roundTitle } : {}),
    ...(selectedSection?.key === 'agenda' && previewBase.automaticAgenda === true ? { options: generatedAgendaOptions(semantic.rounds) } : {}),
  };
  const saveLabel = uploading ? 'Nejdřív dokončete nahrávání média.' : editorSaveLabels[editorSaveStatus(dirty, saving, saveFailed)];
  const structuralDisabled = readOnly || saving || dirty || uploading;
  const navigationAsDraft = draft?.isQuestion === true && (draft.authoringStatus === 'draft' || hasSaveBlockingIssues(draft, quiz.slides.find(slide => slide.id === draft.id), !can('quiz.answers.read')));

  return (
    <MediaAuthoringContext.Provider value={{ quizId: quiz.id, onPending: onUploadPending, canUpload: can('quiz.media.upload'), canAttach: can('quiz.media.attach') }}><article className="round-first-editor">
      {(pendingSelection !== null || blocker.state === 'blocked') && (
        <UnsavedChangesDialog
          saveLabel={navigationAsDraft ? "Uložit koncept a pokračovat" : "Uložit a pokračovat"}
          busy={saving || uploading}
          onSave={() => void saveAll(pendingSelection ?? selectedKey, navigationAsDraft ? 'draft' : undefined).then((loaded) => {
            if (loaded === null) return;
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null) setSelectedKey(pendingSelection);
            setPendingSelection(null);
          })}
          onDiscard={() => {
            discardDraft();
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null && pendingSelection !== 'draft') setSelectedKey(pendingSelection);
            setPendingSelection(null);
          }}
          onCancel={() => {
            if (blocker.state === 'blocked') blocker.reset();
            setPendingSelection(null);
            setPendingFixFocus(null);
          }}
        />
      )}
      {removeRound !== null && (
        <RemoveRoundDialog
          round={removeRound}
          rounds={semantic.rounds}
          busy={saving || uploading}
          onMove={(targetRoundId) => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'move', targetRoundId), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onDelete={() => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'delete'), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onCancel={() => setRemoveRound(null)}
        />
      )}

      <header className="round-editor-header">
        <div className="round-editor-title">
          <Link className="back-link" to="/admin/quizzes">← Knihovna kvízů</Link>
          <span className="editor-context-label">Editor kvízu</span>
          <strong>{title || quiz.title}</strong>
        </div>
        <div className="round-editor-save">
          {readOnly && <span className="read-only-badge">Pouze pro čtení</span>}
          <span className={`save-state ${dirty ? 'dirty' : ''} ${saveFailed ? 'failed' : ''}`} role="status" aria-live="polite">{saveLabel}</span>
          {!dirty && !saving && !saveFailed && lastSavedAt && <time className="working-copy-count" dateTime={lastSavedAt.toISOString()}>Vše uloženo v {lastSavedAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</time>}
          {dirty && <span className="working-copy-count">Rozpracované položky: {new Set([...Object.keys(parked), ...(dirtySlide || dirtyRound ? [selectedKey] : []), ...(dirtyQuiz ? ['quiz'] : [])]).size}</span>}
          <button type="button" className="secondary-button preflight-header-button" onClick={() => setPreflightOpen((value) => !value)}>Zkontrolovat kvíz</button><button type="button" ref={practiceButtonRef} className="secondary-button practice-button" disabled={dirty || saving || uploading || (preflightResult?.blockerCount ?? 1) > 0} onClick={() => setPracticing(true)}>Soukromá zkouška</button>
          <button type="button" className="primary-button" disabled={readOnly || saving || uploading || !dirty} onClick={() => void saveAll()}>Uložit vše</button>
          {dirty && <button type="button" className="text-button" disabled={saving || uploading} onClick={() => setPendingSelection(selectedKey)}>Zahodit změny…</button>}
          {draft?.isQuestion && <button type="button" className="secondary-button draft-save-button" disabled={readOnly || saving || uploading} onClick={() => void saveAll(selectedKey, 'draft')}>Uložit koncept</button>}
          <TechnicalDetails><code>Revize: {quiz.revision}<br />Výběr: {selectedKey}</code></TechnicalDetails>
        </div>
      </header>

      {error && <div ref={errorRef} tabIndex={-1} className="round-editor-error"><HumanError error={{ title: 'Změnu nelze dokončit', message: error, technicalCode: saveFailed ? 'EDITOR_SAVE_FAILED' : 'EDITOR_ACTION_FAILED' }} onRetry={saveFailed ? () => void saveAll() : undefined} /></div>}
      {saveFailed && <button type="button" className="secondary-button" disabled={saving || uploading} onClick={() => void discardAndReload()}>Zahodit rozepsané změny a načíst aktuální verzi</button>}

      {preflightOpen && preflightResult !== null && (
        <div className="editor-preflight-shell">
          <QuizPreflightPanel
            quizId={quiz.id}
            result={preflightResult}
            onRecheck={() => setPreflightNonce((value) => value + 1)}
            onFix={openPreflightFix}
          />
        </div>
      )}

      <nav className="editor-panel-tabs" aria-label="Část editoru">
        <button type="button" className={activePanel === 'structure' ? 'active' : ''} onClick={() => setActivePanel('structure')}>Struktura</button>
        <button type="button" className={activePanel === 'content' ? 'active' : ''} onClick={() => setActivePanel('content')}>Obsah</button>
        <button type="button" className={activePanel === 'preview' ? 'active' : ''} onClick={() => setActivePanel('preview')}>Náhled</button>
      </nav>

      <section className="round-editor-workspace" data-active-panel={activePanel}>
        <EditorOutline
          model={outlineModel ?? semantic}
          selectedKey={selectedKey}
          activeDraft={draft}
          disabled={structuralDisabled}
          onMove={moveInOutline}
          pickerRoundId={pickerRoundId}
          onSelect={select}
          onOpenPicker={setPickerRoundId}
          onClosePicker={() => setPickerRoundId(null)}
          onCreateQuestion={(round, type) => {
            const next = { ...newQuestionDraft(type, round), ...(quiz.defaultAppearance ?? initialAppearance) };
            setDraft(next);
            setPendingCreate({ position: next.position, semanticKey: 'draft' });
            setSelectedKey('draft');
            setDirtySlide(true);
            setPickerRoundId(null);
            setTouched(new Set());
            setShowAnswer(false);
            setShowReadiness(false);
            setActivePanel('content');
          }}
          onAddInfo={() => void mutate(current => createQuizSlide(current.id, current.revision, current.slideCount + 1, localDraft('info', current.slideCount + 1, { title: 'Organizační sdělení', text: 'Napište oznámení, poděkování nebo pokyny k přestávce.' }), 'quiz'))}
          onAddClosing={() => void mutate(current => createQuizSlide(current.id, current.revision, current.slideCount + 1, localDraft('end', current.slideCount + 1, { title: 'Děkujeme za hru' }), 'quiz'))}
          onAddRound={() => {
            void mutate(current => createQuizRound(current.id, current.revision, `Nové ${semantic.rounds.length + 1}. kolo`));
          }}
        />

        <main className="round-editor-content editor-panel-content">
          {selectedKey === 'quiz' && (
            <QuizSettingsForm appearance={appearance} onAppearance={value => {setAppearance(value);setDirtyQuiz(true);}} quiz={quiz} title={title} description={description} disabled={readOnly || saving}
              onTitle={(value) => { setTitle(value); setDirtyQuiz(true); }}
              onDescription={(value) => { setDescription(value); setDirtyQuiz(true); }} />
          )}
          {selectedKey === 'quiz' && <SlideDesignFields scope="quiz" value={defaultDesign} disabled={readOnly || saving || uploading} onChange={value => { setDefaultDesign(value); setDirtyQuiz(true); }} />}
          {selectedKey === 'quiz' && <details className="editor-extra"><summary>Tiskové materiály</summary><PrintTemplateFields quizId={quiz.id} value={printTemplate} disabled={readOnly || saving || uploading} onChange={value => { setPrintTemplate(value); setDirtyQuiz(true); }} /></details>}
          {selectedTemplate && <section className="editor-form-stack">
            <header className="content-form-heading"><span>Šablona výsledků</span><h2>{selectedTemplate === 'final' ? 'Finální vyhlášení' : 'Průběžné pořadí'}</h2></header>
            <p className="field-help">Názvy týmů, body a pořadí doplní aplikace z publikovaných výsledků. Zde připravujete jejich vzhled.</p>
            <label className="form-field">Nadpis<input disabled={readOnly || saving} maxLength={500} value={template?.title ?? ''} placeholder={selectedTemplate === 'final' ? 'Finální výsledky' : 'Průběžné pořadí'} onChange={event => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, title: event.target.value } }); setDirtyQuiz(true); }} /></label>
            <label className="form-field">Doprovodný text<textarea disabled={readOnly || saving} maxLength={2000} value={template?.subtitle ?? ''} onChange={event => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, subtitle: event.target.value } }); setDirtyQuiz(true); }} /></label>
            <SlideDesignFields scope="results" value={template?.design ?? {}} inherited={defaultDesign} disabled={readOnly || saving || uploading} onChange={value => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, design: value } }); setDirtyQuiz(true); }} />
          </section>}
          {selectedSection !== undefined && draft !== null && draft.id === (selectedSection.slide?.id ?? `local-${selectedSection.key === 'opening' ? 'intro' : selectedSection.key}`) && (
            <SystemSectionForm section={selectedSection} slide={draft} model={semantic} disabled={readOnly || saving}
              onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {selectedKey.startsWith('round:') && selectedRound !== undefined && (draft?.id === selectedRound.settingsSlide?.id || draft?.roundId === selectedRound.id) && (
            <>
              <RoundSettingsForm round={selectedRound} title={roundTitle} slide={draft ?? undefined} disabled={readOnly || saving}
                onTitle={(value) => { setRoundTitle(value); setDirtyRound(true); if (draft?.id === 'local-round') { setDraft({ ...draft, title: value }); setDirtySlide(true); } }}
                onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
              {selectedRound.id !== 'roundless' ? <div className="semantic-actions round-actions">
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === 1} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, -1), `round:${selectedRound.id}`)}>Přesunout nahoru</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === semantic.rounds.length} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, 1), `round:${selectedRound.id}`)}>Přesunout dolů</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizRound(current.id, current.revision, selectedRound.id))}>Duplikovat včetně otázek</button>
                <button type="button" className="danger-button" disabled={structuralDisabled || !can('quiz.delete')} onClick={() => setRemoveRound(selectedRound)}>Odstranit kolo…</button>
              </div> : <p className="field-help">Toto je bezpečný přehled starších otázek bez přiřazeného kola. Otázky můžete jednotlivě přesunout.</p>}
            </>
          )}
          {draft?.isQuestion && (selectedKey === 'draft' || selectedKey === `slide:${draft.id}`) && (
            <>
              <QuestionForm answersReadable={can('quiz.answers.read')} answersEditable={can('quiz.answers.edit')} notesReadable={can('quiz.notes.read')} notesEditable={can('quiz.notes.edit')} key={draft.id} defaultAppearance={quiz.defaultAppearance ?? initialAppearance} onUploadPending={onUploadPending} quizId={quiz.id} slide={draft} number={questionNumber} disabled={readOnly || saving || uploading} showAllIssues={showReadiness} touched={touched}
                onTouch={(field) => setTouched((current) => new Set(current).add(field))}
                onChange={(value) => { setDraft(value); setDirtySlide(true); setSaveFailed(false); }} />
              <div className="question-save-actions">
                {draft.authoringStatus === 'draft' && <><p role="status">Soukromý koncept — do hry se nedostane.</p><button type="button" className="primary-button" disabled={readOnly || saving || uploading} onClick={() => void saveAll(selectedKey, 'ready')}>Dokončit otázku</button></>}
                <button type="button" className="secondary-button" disabled={readOnly || saving || uploading} onClick={() => { const roundId = selectedRound?.id; void saveAll().then(loaded => { if (loaded && roundId) { setSelectedKey('round:' + roundId); setPickerRoundId(roundId); setActivePanel('structure'); } }); }}>Uložit a přidat další</button>
              </div>
              {!isLocalQuestion && selectedRound !== undefined && (
                <div className="semantic-actions question-actions">
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === 1} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, -1))}>Posunout nahoru</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === selectedRound.questions.length} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, 1))}>Posunout dolů</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizSlide(current.id, current.revision, draft.id))}>Duplikovat</button>
                  {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').length > 0 && (
                    <label className="move-to-round">Přesunout do kola
                      <select aria-label="Přesunout do kola" disabled={structuralDisabled} defaultValue="" onChange={(event) => {
                        if (event.target.value !== '') void mutate((current) => moveQuizQuestionToRound(current.id, current.revision, draft.id, event.target.value));
                      }}>
                        <option value="" disabled>Vyberte…</option>
                        {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').map((round) => <option key={round.id} value={round.id}>{round.position}. kolo – {round.title}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" className="danger-button" disabled={structuralDisabled || !can('quiz.delete') || quiz.slideCount <= 1} onClick={() => {
                    if (window.confirm('Opravdu odstranit tuto otázku?')) void mutate((current) => deleteQuizSlide(current.id, current.revision, draft.id));
                  }}>Odstranit otázku</button>
                </div>
              )}
              {isLocalQuestion && <button type="button" disabled={uploading} className="text-button" onClick={() => { discardDraft(); setSelectedKey(`round:${selectedRound?.id ?? ''}`); }}>Zrušit novou otázku</button>}
            </>
          )}
          {draft !== null && !draft.isQuestion && !selectedKey.startsWith('system:') && !selectedKey.startsWith('round:') && (
            <SystemContentForm slide={draft} disabled={readOnly || saving} onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {draft !== null && <details className="editor-extra" open={!draft.isQuestion}><summary>Vzhled {selectedKey.startsWith('round:') ? 'celého kola' : 'slidu'}</summary><SlideDesignFields scope={selectedKey.startsWith('round:') ? 'round' : 'slide'} value={draft.design ?? {}} legacy={legacySlideDesign({ ...draft, ...resolveLegacySlideAppearance(appearance, draft) })} legacyResetAvailable={Boolean(draft.backgroundImage) || (draft.backgroundOverlay ?? draft.presentation.backgroundOverlay ?? 0) > 0 || draft.imageLayout !== undefined} inherited={inheritedDesign} disabled={readOnly || saving || uploading} onChange={value => { setDraft({ ...draft, design: value }); setDirtySlide(true); }} onReset={() => { setDraft({ ...draft, design: {}, resetAppearance: true, backgroundImage: '', backgroundOverlay: null, imageLayout: undefined, presentation: { ...draft.presentation, backgroundOverlay: null } }); setDirtySlide(true); }} /></details>}
          {draft?.isQuestion && can('quiz.answers.read') && <details className="editor-extra"><summary>Vzhled odhalené odpovědi</summary><SlideDesignFields scope="answer" value={draft.answerDesign ?? {}} inherited={resolveSlideDesign(legacySlideDesign(draft), inheritedDesign, draft.design)} disabled={readOnly || saving || uploading || !can('quiz.answers.edit')} onChange={value => { setDraft({ ...draft, answerDesign: value }); setDirtySlide(true); }} /></details>}
          {draft !== null && !draft.isQuestion && ['info', 'end', 'title'].includes(draft.kind) && !pendingCreate && <div className="semantic-actions">
            <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate(current => duplicateQuizSlide(current.id, current.revision, draft.id))}>Duplikovat slide</button>
            <button type="button" className="secondary-button" disabled={structuralDisabled || draft.position <= 1} onClick={() => void mutate(current => moveQuizSlide(current.id, current.revision, draft.id, -1))}>Posunout před předchozí slide</button>
            <button type="button" className="secondary-button" disabled={structuralDisabled || draft.position >= quiz.slideCount} onClick={() => void mutate(current => moveQuizSlide(current.id, current.revision, draft.id, 1))}>Posunout za následující slide</button>
            <button type="button" className="danger-button" disabled={structuralDisabled || !can('quiz.delete') || quiz.slideCount <= 1} onClick={() => { if (window.confirm('Odstranit tento informační slide?')) void mutate(current => deleteQuizSlide(current.id, current.revision, draft.id)); }}>Odstranit slide</button>
          </div>}
          {draft !== null && !draft.isQuestion && !draft.roundId && ['intro', 'agenda', 'rules', 'end', 'title', 'info'].includes(draft.kind) && <label className="binary-answer"><input type="checkbox" checked={draft.hidden === true} disabled={readOnly || saving} onChange={event => { setDraft({ ...draft, hidden: event.target.checked }); setDirtySlide(true); }} /> Skrýt při moderování <span className="field-help">Obsah zůstane uložený, průběh jej přeskočí.</span></label>}
          {showReadiness && draft?.isQuestion && <ReadinessSummary slide={draft} />}
          {dirty && <p className="structure-save-hint">Strukturální operace budou dostupné po uložení nebo zahození rozepsaných změn.</p>}
        </main>

        {selectedTemplate ? <ResultTemplatePreview key={selectedTemplate} kind={selectedTemplate} template={{ ...template, design: resolveSlideDesign(defaultDesign, undefined, template?.design) }} onEdit={() => setActivePanel('content')} /> : previewSlide === undefined ? (
          <aside className="round-editor-preview editor-panel-preview editor-empty-preview">
            <header className="preview-heading"><span>Náhled</span><strong>Zatím není co promítnout</strong></header>
            <p>Nejdřív přidejte kolo a otázku. Prázdný rozpracovaný kvíz zůstává bezpečně uložený.</p>
          </aside>
        ) : (
          <EditorPreview onEdit={() => { setActivePanel('content'); requestAnimationFrame(() => document.querySelector<HTMLElement>('.round-editor-content input, .round-editor-content textarea, .round-editor-content summary')?.focus()); }} slide={previewSlide} quizTitle={title || quiz.title} showAnswer={showAnswer && can('quiz.answers.read')} onShowAnswer={value => { if (can('quiz.answers.read')) setShowAnswer(value); }} />
        )}
      </section>
    </article></MediaAuthoringContext.Provider>
  );
}
