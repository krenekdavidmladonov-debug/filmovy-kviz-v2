import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import {
  createQuizSlide,
  deleteQuizSlide,
  duplicateQuizSlide,
  moveQuizSlide,
  updateQuizMetadata,
  updateQuizSlide,
} from '../../features/editor/editorApi';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import {
  editableSlideKinds,
  type EditableSlideKind,
  type EditorMedia,
  type EditorPresentation,
  type EditorQuiz,
  type EditorSlide,
} from '../../features/editor/types';
import { SlidePreview } from '../../features/presentation/SlidePreview';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const kindLabels: Record<EditableSlideKind, string> = {
  intro: 'Intro', agenda: 'Agenda', recap: 'Rekapitulace', end: 'Konec', title: 'Titulek', info: 'Informace',
  round: 'Hlavička kola', roundheader: 'Hlavička kola (legacy)', 'round-header': 'Hlavička kola (legacy)', section: 'Sekce',
  question: 'Otázka', text: 'Textová otázka', classic: 'Klasická otázka', free: 'Volná odpověď',
  image: 'Obrázková otázka', picture: 'Obrázková otázka (legacy)', photo: 'Foto otázka',
  audio: 'Audio otázka', music: 'Hudební otázka', video: 'Video otázka', youtube: 'YouTube otázka',
  pl: 'Legacy PL', legacy: 'Neznámý legacy typ',
};

const creatableKinds: readonly EditableSlideKind[] = [
  'intro', 'agenda', 'recap', 'end', 'title', 'info', 'round',
  'question', 'text', 'free', 'image', 'audio', 'video',
];

const newSlideDefaults: Omit<EditorSlide, 'id' | 'position' | 'kind' | 'storedKind' | 'isQuestion'> = {
  title: '', text: '', moderatorNote: '', options: [], correctAnswer: '', media: [],
  presentation: {
    videoStart: null, videoEnd: null, audioTrigger: null,
    backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null,
  },
  hasLegacyData: false,
};

function draftSlide(kind: EditableSlideKind, position: number): EditorSlide {
  return {
    ...newSlideDefaults,
    id: 'new-slide', position, kind, storedKind: kind,
    isQuestion: ['question', 'text', 'classic', 'free', 'image', 'picture', 'photo', 'audio', 'music', 'video', 'youtube', 'pl', 'legacy'].includes(kind),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Operaci editoru se nepodařilo dokončit. Zkontrolujte Functions Emulator.';
}

function numberValue(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function SlideFields({
  slide,
  disabled,
  onChange,
}: {
  readonly slide: EditorSlide;
  readonly disabled: boolean;
  readonly onChange: (slide: EditorSlide) => void;
}) {
  const set = <K extends keyof EditorSlide>(field: K, value: EditorSlide[K]) => onChange({ ...slide, [field]: value });
  const setPresentation = (field: keyof EditorPresentation, value: number | string | null) => (
    set('presentation', { ...slide.presentation, [field]: value })
  );
  const setMedia = (index: number, patch: Partial<EditorMedia>) => set('media', slide.media.map((media, itemIndex) => (
    itemIndex === index ? { ...media, ...patch } : media
  )));
  const roundLocked = ['round', 'roundheader', 'round-header', 'section'].includes(slide.storedKind);
  const unknownLocked = slide.kind === 'legacy' && slide.storedKind !== 'legacy';

  return (
    <div className="editor-form-stack">
      <label className="form-field">Typ slidu
        <select value={slide.kind} disabled={disabled || roundLocked || unknownLocked} onChange={(event) => set('kind', event.target.value as EditableSlideKind)}>
          {editableSlideKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
        </select>
      </label>
      {(unknownLocked || slide.hasLegacyData) && (
        <p className="legacy-notice">Legacy data jsou soukromá a při uložení zůstanou beze změny. Původní typ: <strong>{slide.storedKind}</strong>.</p>
      )}
      <label className="form-field">Titulek
        <input value={slide.title} disabled={disabled} onChange={(event) => set('title', event.target.value)} />
      </label>
      <label className="form-field">Text / zadání
        <textarea rows={5} value={slide.text} disabled={disabled} onChange={(event) => set('text', event.target.value)} />
      </label>
      <label className="form-field">Poznámka moderátora (soukromá)
        <textarea rows={3} value={slide.moderatorNote} disabled={disabled} onChange={(event) => set('moderatorNote', event.target.value)} />
      </label>

      <fieldset className="editor-fieldset" disabled={disabled}>
        <legend>Možnosti odpovědí</legend>
        {slide.options.map((option, index) => (
          <div className="inline-editor-row" key={index}>
            <span>{index + 1}.</span>
            <input aria-label={`Možnost ${index + 1}`} value={option} onChange={(event) => set('options', slide.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
            <button type="button" className="icon-button" onClick={() => set('options', slide.options.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>
        ))}
        <button type="button" className="secondary-button compact-button" onClick={() => set('options', [...slide.options, ''])}>+ Přidat možnost</button>
      </fieldset>

      <label className="form-field private-field">Správná odpověď (soukromá)
        <textarea rows={2} value={slide.correctAnswer} disabled={disabled} onChange={(event) => set('correctAnswer', event.target.value)} />
      </label>

      <fieldset className="editor-fieldset" disabled={disabled}>
        <legend>Média — pouze URL / reference</legend>
        {slide.media.map((media, index) => (
          <div className="media-editor-row" key={`${media.sourceIndex ?? 'new'}-${index}`}>
            <select aria-label={`Role média ${index + 1}`} value={media.role} onChange={(event) => setMedia(index, { role: event.target.value as EditorMedia['role'] })}>
              <option value="prompt">zadání</option><option value="background">pozadí</option><option value="answer">odpověď</option><option value="unknown">legacy</option>
            </select>
            <select aria-label={`Typ média ${index + 1}`} value={media.kind} onChange={(event) => setMedia(index, { kind: event.target.value as EditorMedia['kind'] })}>
              <option value="image">obrázek</option><option value="audio">audio</option><option value="video">video</option><option value="unknown">jiné</option>
            </select>
            <input aria-label={`Zdroj média ${index + 1}`} value={media.source} placeholder="https://…" onChange={(event) => setMedia(index, { source: event.target.value })} />
            <button type="button" className="icon-button" aria-label={`Odstranit médium ${index + 1}`} onClick={() => setMedia(index, { source: '' })}>×</button>
          </div>
        ))}
        <button type="button" className="secondary-button compact-button" onClick={() => set('media', [...slide.media, { role: 'prompt', kind: 'image', source: '' }])}>+ Přidat médium</button>
        <p className="field-help">Upload do Storage není součástí Editoru V1.</p>
      </fieldset>

      <fieldset className="editor-fieldset timing-grid" disabled={disabled}>
        <legend>Prezentace</legend>
        {(['videoStart', 'videoEnd', 'audioTrigger', 'backgroundOverlay', 'answerOverlay'] as const).map((field) => (
          <label key={field}>{field}
            <input type="number" min="0" value={slide.presentation[field] ?? ''} onChange={(event) => setPresentation(field, numberValue(event.target.value))} />
          </label>
        ))}
        <label>Číslo otázky ze zdroje
          <input value={slide.presentation.sourceQuestionNumber ?? ''} onChange={(event) => setPresentation('sourceQuestionNumber', event.target.value || null)} />
        </label>
      </fieldset>
    </div>
  );
}

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const { role } = useAuth();
  const readOnly = role !== 'admin';
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorSlide | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dirtySlide, setDirtySlide] = useState(false);
  const [dirtyQuiz, setDirtyQuiz] = useState(false);
  const [quizDraftRevision, setQuizDraftRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const dirty = dirtySlide || dirtyQuiz;
  const blocker = useBlocker(dirty);

  const load = useCallback(async (preferredId?: string) => {
    if (!quizId) {
      setError('Chybí ID kvízu.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await getEditorQuiz(quizId);
      if (loaded === null) {
        setError('Kvíz nebyl nalezen.');
        return;
      }
      setQuiz(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description);
      const next = loaded.slides.find((slide) => slide.id === preferredId) ?? loaded.slides[0] ?? null;
      setSelectedId(next?.id ?? null);
      setDraft(next);
      setDirtySlide(false);
      setDirtyQuiz(false);
      setQuizDraftRevision(null);
      return loaded;
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const selectedStored = useMemo(() => quiz?.slides.find((slide) => slide.id === selectedId), [quiz, selectedId]);

  function selectSlide(slide: EditorSlide) {
    if (dirtySlide && !window.confirm('Zahodit neuložené změny aktuálního slidu?')) return;
    setSelectedId(slide.id);
    setDraft(slide);
    setDirtySlide(false);
    setError(null);
  }

  async function mutate(action: () => Promise<{ readonly selectedSlideId?: string }>) {
    if (readOnly || !quiz) return;
    if (dirty && !window.confirm('Tato operace znovu načte editor. Zahodit neuložené změny?')) return;
    setSaving(true);
    setError(null);
    try {
      const result = await action();
      await load(result.selectedSlideId);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  async function saveSlide() {
    if (!quiz || !draft || readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const pendingQuizDraft = dirtyQuiz ? { title, description } : null;
      const result = await updateQuizSlide(quiz.id, quiz.revision, draft);
      await load(result.selectedSlideId);
      if (pendingQuizDraft !== null) {
        setTitle(pendingQuizDraft.title);
        setDescription(pendingQuizDraft.description);
        setDirtyQuiz(true);
        setQuizDraftRevision(result.revision);
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveQuiz() {
    if (!quiz || readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateQuizMetadata(quiz.id, quizDraftRevision ?? quiz.revision, title, description);
      setQuiz({
        ...quiz,
        title,
        description,
        revision: result.revision,
        slideCount: result.slideCount,
        questionCount: result.questionCount,
        roundCount: result.roundCount,
      });
      setDirtyQuiz(false);
      setQuizDraftRevision(null);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !quiz) return <QuizLoading label="Načítám editor kvízu…" />;
  if (!quiz || !draft) return <QuizErrorState message={error ?? 'Kvíz nemá žádný editovatelný slide.'} onRetry={() => void load()} />;

  return (
    <article className="quiz-editor">
      {blocker.state === 'blocked' && (
        <div className="navigation-warning" role="alertdialog" aria-label="Neuložené změny">
          <strong>Máte neuložené změny.</strong>
          <span>Opravdu chcete editor opustit?</span>
          <button className="secondary-button" onClick={() => blocker.reset()}>Zůstat</button>
          <button className="danger-button" onClick={() => blocker.proceed()}>Odejít bez uložení</button>
        </div>
      )}
      <header className="editor-toolbar">
        <div>
          <Link className="back-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}>← Detail kvízu</Link>
          <h1>Editor kvízu</h1>
        </div>
        <div className="editor-status">
          {readOnly && <span className="read-only-badge">Pouze pro čtení — moderátor</span>}
          <span className={dirty ? 'save-state dirty' : 'save-state'}>{saving ? 'Ukládám…' : dirty ? 'Neuložené změny' : `Uloženo · revize ${quiz.revision}`}</span>
          <button className="primary-button" disabled={readOnly || saving || !dirtySlide} onClick={() => void saveSlide()}>Uložit slide</button>
        </div>
      </header>

      {error && <p className="form-error editor-error" role="alert">{error}</p>}
      <section className="quiz-metadata-editor">
        <label className="form-field">Název kvízu<input disabled={readOnly} value={title} onChange={(event) => { setTitle(event.target.value); if (!dirtyQuiz) setQuizDraftRevision(quiz.revision); setDirtyQuiz(true); }} /></label>
        <label className="form-field">Popis<input disabled={readOnly} value={description} onChange={(event) => { setDescription(event.target.value); if (!dirtyQuiz) setQuizDraftRevision(quiz.revision); setDirtyQuiz(true); }} /></label>
        <button className="secondary-button" disabled={readOnly || saving || !dirtyQuiz} onClick={() => void saveQuiz()}>Uložit údaje</button>
      </section>

      <section className="editor-grid">
        <aside className="slide-navigator">
          <header><strong>{quiz.slideCount} slidů</strong><span>{quiz.roundCount} kol · {quiz.questionCount} otázek</span></header>
          <div className="slide-actions">
            <select aria-label="Typ nového slidu" id="new-slide-kind" defaultValue="question" disabled={readOnly || saving}>
              {creatableKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
            </select>
            <button className="secondary-button compact-button" disabled={readOnly || saving} onClick={() => {
              const element = document.querySelector<HTMLSelectElement>('#new-slide-kind');
              const kind = (element?.value ?? 'question') as EditableSlideKind;
              const position = (selectedStored?.position ?? quiz.slideCount) + 1;
              void mutate(() => createQuizSlide(quiz.id, quiz.revision, position, draftSlide(kind, position)));
            }}>+ Přidat</button>
          </div>
          <ol className="editor-slide-list">
            {quiz.slides.map((slide) => (
              <li key={slide.id}>
                <button className={slide.id === selectedId ? 'selected' : ''} onClick={() => selectSlide(slide)}>
                  <span>{slide.position}</span>
                  <div><strong>{slide.title || kindLabels[slide.kind]}</strong><small>{slide.storedKind}{slide.roundId ? ' · kolo' : ''}</small></div>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className="slide-editor-panel">
          <header className="panel-heading">
            <div><span>Slide {draft.position}</span><h2>{draft.title || kindLabels[draft.kind]}</h2></div>
            <div className="slide-structure-actions">
              <button className="icon-button" title="Posunout nahoru" disabled={readOnly || saving || draft.position === 1} onClick={() => void mutate(() => moveQuizSlide(quiz.id, quiz.revision, draft.id, -1))}>↑</button>
              <button className="icon-button" title="Posunout dolů" disabled={readOnly || saving || draft.position === quiz.slideCount} onClick={() => void mutate(() => moveQuizSlide(quiz.id, quiz.revision, draft.id, 1))}>↓</button>
              <button className="secondary-button compact-button" disabled={readOnly || saving} onClick={() => void mutate(() => duplicateQuizSlide(quiz.id, quiz.revision, draft.id))}>Duplikovat</button>
              <button className="danger-button compact-button" disabled={readOnly || saving || quiz.slideCount <= 1} onClick={() => {
                if (window.confirm('Opravdu smazat tento slide?')) void mutate(() => deleteQuizSlide(quiz.id, quiz.revision, draft.id));
              }}>Smazat</button>
            </div>
          </header>
          <SlideFields slide={draft} disabled={readOnly || saving} onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
        </main>

        <aside className="editor-preview-panel">
          <header className="panel-heading"><div><span>Projektor</span><h2>Živý náhled</h2></div></header>
          <SlidePreview slide={draft} quizTitle={title || quiz.title} position={draft.position} showAnswer={showAnswer} />
          <label className="answer-preview-toggle"><input type="checkbox" checked={showAnswer} onChange={(event) => setShowAnswer(event.target.checked)} /> Zobrazit správnou odpověď pouze v admin náhledu</label>
          <p className="field-help">Náhled pracuje jen s lokálním stavem editoru a nezapisuje do veřejné projector session.</p>
        </aside>
      </section>
    </article>
  );
}
