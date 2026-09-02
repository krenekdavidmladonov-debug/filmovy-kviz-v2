import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';

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
import {
  createQuizSlide,
  deleteQuizSlide,
  duplicateQuizRound,
  duplicateQuizSlide,
  moveQuizQuestionToRound,
  moveQuizRound,
  removeQuizRound,
  reorderQuizQuestion,
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
import { editorSaveLabels, editorSaveStatus, needsNavigationDecision } from '../../features/editor/sessionState';
import type { CreatableQuestionType, EditableSlideKind, EditorQuiz, EditorSlide } from '../../features/editor/types';
import { hasBlockingIssues } from '../../features/editor/validation';
import { defaultRules, generatedAgendaOptions } from '../../features/presentation/model';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError } from '../../ui/HumanError';
import { TechnicalDetails } from '../../ui/TechnicalDetails';

type EditorPanel = 'structure' | 'content' | 'preview';

interface PendingCreate {
  readonly position: number;
  readonly semanticKey: string;
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
    options: type === 'choice' ? ['', '', '', ''] : [],
    clipStartSeconds: type === 'audio' || type === 'video' ? 0 : null,
  });
}

function systemDraft(key: string, model: SemanticQuizModel, position: number): EditorSlide {
  if (key === 'rules') return localDraft('rules', position, { options: [...defaultRules] });
  if (key === 'agenda') return localDraft('agenda', position, { options: generatedAgendaOptions(model.rounds) });
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
  if (error instanceof Error && /aborted|revision|newer|stale/iu.test(error.message)) {
    return 'Kvíz mezitím upravil někdo jiný. Načtěte aktuální verzi a změnu proveďte znovu.';
  }
  return 'Změnu se nepodařilo uložit. Rozepsané hodnoty zůstaly v editoru.';
}

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const { role } = useAuth();
  const readOnly = role !== 'admin';
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [selectedKey, setSelectedKey] = useState('quiz');
  const [draft, setDraft] = useState<EditorSlide | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [roundTitle, setRoundTitle] = useState('');
  const [dirtySlide, setDirtySlide] = useState(false);
  const [dirtyQuiz, setDirtyQuiz] = useState(false);
  const [dirtyRound, setDirtyRound] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [removeRound, setRemoveRound] = useState<SemanticRound | null>(null);
  const [pickerRoundId, setPickerRoundId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<EditorPanel>('content');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showReadiness, setShowReadiness] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = dirtySlide || dirtyQuiz || dirtyRound;
  const blocker = useBlocker(dirty);
  const semantic = useMemo(() => quiz === null ? null : buildSemanticQuizModel(quiz), [quiz]);

  const reload = useCallback(async (preferredKey = 'quiz', preferredSlideId?: string): Promise<EditorQuiz | null> => {
    if (!quizId) {
      setError('Kvíz nelze otevřít, protože chybí jeho identifikátor.');
      setLoading(false);
      return null;
    }
    try {
      const loaded = await getEditorQuiz(quizId);
      if (loaded === null) {
        setError('Kvíz nebyl nalezen.');
        return null;
      }
      const model = buildSemanticQuizModel(loaded);
      setQuiz(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description);
      setSelectedKey(preferredSlideId === undefined ? preferredKey : selectionForSlide(preferredSlideId, model, preferredKey));
      setDirtySlide(false);
      setDirtyQuiz(false);
      setDirtyRound(false);
      setPendingCreate(null);
      setTouched(new Set());
      setShowReadiness(false);
      setSaveFailed(false);
      setError(null);
      return loaded;
    } catch (loadError) {
      setError(safeErrorMessage(loadError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (quiz === null || semantic === null || selectedKey === 'draft') return;
    setShowAnswer(false);
    setTouched(new Set());
    setShowReadiness(false);
    setPendingCreate(null);
    if (selectedKey === 'quiz') {
      setDraft(null);
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('system:')) {
      const key = selectedKey.slice('system:'.length) as 'opening' | 'agenda' | 'rules';
      const section = semantic.introduction.find((item) => item.key === key);
      if (section?.slide !== undefined) setDraft(section.slide);
      else {
        const position = semantic.rounds[0]?.firstPosition ?? Math.max(1, quiz.slideCount);
        setDraft(systemDraft(key, semantic, position));
        if (key !== 'agenda') setPendingCreate({ position, semanticKey: selectedKey });
      }
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('round:')) {
      const round = roundForSelection(selectedKey, semantic);
      setDraft(round?.settingsSlide ?? null);
      setRoundTitle(round?.title ?? '');
      return;
    }
    const slideId = selectedKey.startsWith('slide:') ? selectedKey.slice('slide:'.length) : '';
    setDraft(semantic.slideById.get(slideId) ?? null);
    setRoundTitle('');
  }, [quiz, selectedKey, semantic]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveAll = useCallback(async (afterKey = selectedKey): Promise<EditorQuiz | null> => {
    if (quiz === null || readOnly || semantic === null) return null;
    if (draft?.isQuestion && hasBlockingIssues(draft)) {
      setShowReadiness(true);
      setTouched(new Set(['prompt', 'options', 'correctAnswer', 'questionImage', 'mediaSource', 'clipStartSeconds', 'clipEndSeconds']));
      setError('Před uložením opravte označené údaje.');
      requestAnimationFrame(() => errorRef.current?.focus());
      return null;
    }
    if (dirtyQuiz && title.trim() === '') {
      setError('Název kvízu nesmí být prázdný.');
      requestAnimationFrame(() => errorRef.current?.focus());
      return null;
    }
    const currentRound = roundForSelection(selectedKey, semantic);
    if (dirtyRound && roundTitle.trim() === '') {
      setError('Název kola nesmí být prázdný.');
      requestAnimationFrame(() => errorRef.current?.focus());
      return null;
    }
    setSaving(true);
    setError(null);
    setSaveFailed(false);
    try {
      let revision = quiz.revision;
      let createdSlideId: string | undefined;
      if (dirtySlide && draft !== null) {
        const result = pendingCreate === null
          ? await updateQuizSlide(quiz.id, revision, draft)
          : await createQuizSlide(quiz.id, revision, pendingCreate.position, draft);
        revision = result.revision;
        createdSlideId = result.selectedSlideId;
      }
      if (dirtyRound && currentRound !== undefined) {
        const result = await updateQuizRound(quiz.id, revision, currentRound.id, roundTitle.trim());
        revision = result.revision;
      }
      if (dirtyQuiz) {
        await updateQuizMetadata(quiz.id, revision, title.trim(), description);
      }
      const key = pendingCreate?.semanticKey ?? afterKey;
      return await reload(key, pendingCreate?.semanticKey.startsWith('system:') ? undefined : createdSlideId);
    } catch (saveError) {
      setSaveFailed(true);
      setError(safeErrorMessage(saveError));
      requestAnimationFrame(() => errorRef.current?.focus());
      return null;
    } finally {
      setSaving(false);
    }
  }, [description, dirtyQuiz, dirtyRound, dirtySlide, draft, pendingCreate, quiz, readOnly, reload, roundTitle, selectedKey, semantic, title]);

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
    setDirtySlide(false);
    setDirtyQuiz(false);
    setDirtyRound(false);
    setPendingCreate(null);
    setError(null);
  }

  function select(key: string) {
    if (key === selectedKey) return;
    setPickerRoundId(null);
    if (needsNavigationDecision(dirty, selectedKey, key)) {
      setPendingSelection(key);
      return;
    }
    setSelectedKey(key);
    if (window.matchMedia('(max-width: 767px)').matches) setActivePanel('content');
  }

  async function mutate(action: (current: EditorQuiz) => Promise<{ readonly selectedSlideId?: string }>, preferredKey?: string): Promise<boolean> {
    if (quiz === null || readOnly || dirty) return false;
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
      setSaving(false);
    }
  }

  if (loading && quiz === null) return <QuizLoading label="Načítám editor kvízu…" />;
  if (quiz === null || semantic === null) return <QuizErrorState message={error ?? 'Kvíz se nepodařilo otevřít.'} onRetry={() => void reload()} />;

  const selectedRound = roundForSelection(selectedKey, semantic)
    ?? (selectedKey === 'draft' ? semantic.rounds.find((round) => round.id === draft?.roundId) : undefined);
  const selectedQuestion = draft === null ? undefined : semantic.questionBySlideId.get(draft.id);
  const isLocalQuestion = selectedKey === 'draft' && draft?.isQuestion === true;
  const questionNumber = selectedQuestion?.number ?? draft?.questionNumber ?? 1;
  const selectedSection = selectedKey.startsWith('system:')
    ? semantic.introduction.find((item) => item.key === selectedKey.slice('system:'.length))
    : undefined;
  const previewBase = draft ?? selectedRound?.settingsSlide ?? semantic.introduction.find((item) => item.slide)?.slide ?? quiz.slides[0]!;
  const previewSlide = selectedSection?.key === 'agenda'
    ? { ...previewBase, kind: 'agenda' as const, storedKind: 'agenda', options: generatedAgendaOptions(semantic.rounds) }
    : previewBase;
  const saveLabel = editorSaveLabels[editorSaveStatus(dirty, saving, saveFailed)];
  const structuralDisabled = readOnly || saving || dirty;

  return (
    <article className="round-first-editor">
      {(pendingSelection !== null || blocker.state === 'blocked') && (
        <UnsavedChangesDialog
          busy={saving}
          onSave={() => void saveAll(pendingSelection ?? selectedKey).then((loaded) => {
            if (loaded === null) return;
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null) setSelectedKey(pendingSelection);
            setPendingSelection(null);
          })}
          onDiscard={() => {
            discardDraft();
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null) setSelectedKey(pendingSelection);
            setPendingSelection(null);
          }}
          onCancel={() => { if (blocker.state === 'blocked') blocker.reset(); setPendingSelection(null); }}
        />
      )}
      {removeRound !== null && (
        <RemoveRoundDialog
          round={removeRound}
          rounds={semantic.rounds}
          busy={saving}
          onMove={(targetRoundId) => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'move', targetRoundId), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onDelete={() => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'delete'), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onCancel={() => setRemoveRound(null)}
        />
      )}

      <header className="round-editor-header">
        <div className="round-editor-title">
          <Link className="back-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}>← Detail kvízu</Link>
          <strong>{title || quiz.title}</strong>
        </div>
        <div className="round-editor-save">
          {readOnly && <span className="read-only-badge">Pouze pro čtení — moderátor</span>}
          <span className={`save-state ${dirty ? 'dirty' : ''} ${saveFailed ? 'failed' : ''}`} role="status" aria-live="polite">{saveLabel}</span>
          <button type="button" className="secondary-button" disabled={draft?.isQuestion !== true} onClick={() => setShowReadiness(true)}>Zkontrolovat připravenost</button>
          <button type="button" className="primary-button" disabled={readOnly || saving || !dirty} onClick={() => void saveAll()}>Uložit</button>
          <TechnicalDetails><code>Revize: {quiz.revision}<br />Výběr: {selectedKey}</code></TechnicalDetails>
        </div>
      </header>

      {error && <div ref={errorRef} tabIndex={-1} className="round-editor-error"><HumanError error={{ title: 'Změnu nelze dokončit', message: error, technicalCode: saveFailed ? 'EDITOR_SAVE_FAILED' : 'EDITOR_ACTION_FAILED' }} onRetry={saveFailed ? () => void saveAll() : undefined} /></div>}

      <nav className="editor-panel-tabs" aria-label="Část editoru">
        <button type="button" className={activePanel === 'structure' ? 'active' : ''} onClick={() => setActivePanel('structure')}>Struktura</button>
        <button type="button" className={activePanel === 'content' ? 'active' : ''} onClick={() => setActivePanel('content')}>Obsah</button>
        <button type="button" className={activePanel === 'preview' ? 'active' : ''} onClick={() => setActivePanel('preview')}>Náhled</button>
      </nav>

      <section className="round-editor-workspace" data-active-panel={activePanel}>
        <EditorOutline
          model={semantic}
          selectedKey={selectedKey}
          activeDraft={draft}
          disabled={structuralDisabled}
          pickerRoundId={pickerRoundId}
          onSelect={select}
          onOpenPicker={setPickerRoundId}
          onClosePicker={() => setPickerRoundId(null)}
          onCreateQuestion={(round, type) => {
            const next = newQuestionDraft(type, round);
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
          onAddRound={() => {
            const position = semantic.closing[0]?.position ?? quiz.slideCount + 1;
            const slide = localDraft('round', position, { title: `Nové ${semantic.rounds.length + 1}. kolo` });
            void mutate((current) => createQuizSlide(current.id, current.revision, position, slide));
          }}
        />

        <main className="round-editor-content editor-panel-content">
          {selectedKey === 'quiz' && (
            <QuizSettingsForm quiz={quiz} title={title} description={description} disabled={readOnly || saving}
              onTitle={(value) => { setTitle(value); setDirtyQuiz(true); }}
              onDescription={(value) => { setDescription(value); setDirtyQuiz(true); }} />
          )}
          {selectedSection !== undefined && draft !== null && (
            <SystemSectionForm section={selectedSection} slide={draft} model={semantic} disabled={readOnly || saving}
              onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {selectedKey.startsWith('round:') && selectedRound !== undefined && (
            <>
              <RoundSettingsForm round={selectedRound} title={roundTitle} slide={draft ?? undefined} disabled={readOnly || saving}
                onTitle={(value) => { setRoundTitle(value); setDirtyRound(true); }}
                onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
              {selectedRound.id !== 'roundless' ? <div className="semantic-actions round-actions">
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === 1} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, -1), `round:${selectedRound.id}`)}>Přesunout nahoru</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === semantic.rounds.length} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, 1), `round:${selectedRound.id}`)}>Přesunout dolů</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizRound(current.id, current.revision, selectedRound.id))}>Duplikovat včetně otázek</button>
                <button type="button" className="danger-button" disabled={structuralDisabled} onClick={() => setRemoveRound(selectedRound)}>Odstranit kolo…</button>
              </div> : <p className="field-help">Toto je bezpečný přehled starších otázek bez přiřazeného kola. Otázky můžete jednotlivě přesunout.</p>}
            </>
          )}
          {draft?.isQuestion && (
            <>
              <QuestionForm slide={draft} number={questionNumber} disabled={readOnly || saving} showAllIssues={showReadiness} touched={touched}
                onTouch={(field) => setTouched((current) => new Set(current).add(field))}
                onChange={(value) => { setDraft(value); setDirtySlide(true); setSaveFailed(false); }} />
              {!isLocalQuestion && selectedRound !== undefined && (
                <div className="semantic-actions question-actions">
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === 1} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, -1))}>Posunout nahoru</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === selectedRound.questions.length} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, 1))}>Posunout dolů</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizSlide(current.id, current.revision, draft.id))}>Duplikovat</button>
                  {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').length > 0 && (
                    <label className="move-to-round">Přesunout do kola
                      <select disabled={structuralDisabled} defaultValue="" onChange={(event) => {
                        if (event.target.value !== '') void mutate((current) => moveQuizQuestionToRound(current.id, current.revision, draft.id, event.target.value));
                      }}>
                        <option value="" disabled>Vyberte…</option>
                        {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').map((round) => <option key={round.id} value={round.id}>{round.position}. kolo – {round.title}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" className="danger-button" disabled={structuralDisabled || quiz.slideCount <= 1} onClick={() => {
                    if (window.confirm('Opravdu odstranit tuto otázku?')) void mutate((current) => deleteQuizSlide(current.id, current.revision, draft.id));
                  }}>Odstranit otázku</button>
                </div>
              )}
              {isLocalQuestion && <button type="button" className="text-button" onClick={() => { discardDraft(); setSelectedKey(`round:${selectedRound?.id ?? ''}`); }}>Zrušit novou otázku</button>}
            </>
          )}
          {draft !== null && !draft.isQuestion && !selectedKey.startsWith('system:') && !selectedKey.startsWith('round:') && (
            <SystemContentForm slide={draft} disabled={readOnly || saving} onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {showReadiness && draft?.isQuestion && <ReadinessSummary slide={draft} />}
          {dirty && <p className="structure-save-hint">Strukturální operace budou dostupné po uložení nebo zahození rozepsaných změn.</p>}
        </main>

        <EditorPreview slide={previewSlide} quizTitle={title || quiz.title} showAnswer={showAnswer} onShowAnswer={setShowAnswer} />
      </section>
    </article>
  );
}
