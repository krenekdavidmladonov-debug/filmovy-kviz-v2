import { useRef, useState, type DragEvent } from 'react';
import type { SemanticQuizModel, SemanticRound } from './semanticModel';
import { questionSummary, questionTypeLabels, semanticQuestionType } from './semanticModel';
import type { CreatableQuestionType, EditorSlide } from './types';
import { validateQuestion } from './validation';

const creationLabels: Record<CreatableQuestionType, string> = {
  choice: 'ABCD', free: 'Volná odpověď', image: 'Obrázek', audio: 'Audio', video: 'Video',
};

export function EditorOutline({
  model,
  selectedKey,
  activeDraft,
  disabled,
  pickerRoundId,
  onSelect,
  onOpenPicker,
  onClosePicker,
  onCreateQuestion,
  onAddRound,
  onAddClosing,
  onAddInfo,
  onMove,
}: {
  readonly model: SemanticQuizModel;
  readonly selectedKey: string;
  readonly activeDraft: EditorSlide | null;
  readonly disabled: boolean;
  readonly pickerRoundId: string | null;
  readonly onSelect: (key: string) => void;
  readonly onOpenPicker: (roundId: string) => void;
  readonly onClosePicker: () => void;
  readonly onCreateQuestion: (round: SemanticRound, type: CreatableQuestionType) => void;
  readonly onAddRound: () => void;
  readonly onAddClosing?: () => void;
  readonly onAddInfo?: () => void;
  readonly onMove: (id: string, roundId: string | undefined, beforeId?: string) => Promise<boolean>;
}) {
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const locked = disabled || moving;
  function clearDrag() { dragged.current = null; setDragging(null); setDropTarget(null); }
  async function move(id: string, roundId: string | undefined, beforeId?: string) {
    clearDrag();
    if (locked || id === beforeId) return;
    setMoving(true); setAnnouncement('Přesouvám otázku…');
    try {
      const success = await onMove(id, roundId, beforeId);
      setAnnouncement(success ? 'Otázka přesunuta.' : 'Přesun se nezdařil.');
      if (success) requestAnimationFrame(() => document.getElementById(`outline-${id}`)?.focus());
    } finally { setMoving(false); }
  }
  function allowDrop(event: DragEvent, key: string) {
    if (locked || dragged.current === null) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(key);
  }
  const selected = (key: string) => key === selectedKey ? 'selected' : '';
  const questionCount = model.rounds.reduce((total, round) => total + round.questions.length, 0);
  return (
    <aside className={`editor-outline editor-panel-structure ${dragging ? 'is-dragging' : ''}`} aria-label="Struktura kvízu"
      onDragOver={event => {
        if (!dragged.current) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientY < bounds.top + 40) event.currentTarget.scrollTop -= 18;
        if (event.clientY > bounds.bottom - 40) event.currentTarget.scrollTop += 18;
      }}>
      <header className="outline-heading">
        <div><span>Struktura</span><strong>{model.rounds.length} kol · {questionCount} otázek</strong></div>
        <button type="button" className={`outline-root-button ${selected('quiz')}`} onClick={() => onSelect('quiz')}>Základní údaje</button>
      </header>
      <span className="outline-move-status" role="status" aria-live="polite">{announcement}</span>
      <details className="outline-section"><summary>Celé pořadí promítání</summary><ol className="presentation-outline">{[...model.slideById.values()].sort((a, b) => a.position - b.position).map(slide => {
        const round = model.rounds.find(item => item.settingsSlide?.id === slide.id);
        const key = round ? `round:${round.id}` : `slide:${slide.id}`;
        const section = model.introduction.find(item => item.slide?.id === slide.id);
        const selection = section ? `system:${section.key}` : key;
        return <li key={slide.id}><button type="button" className={`outline-system-item ${selected(selection)}`} onClick={() => onSelect(selection)}><span>{slide.position}. {slide.isQuestion ? questionSummary(slide) : slide.title || (round ? 'Úvod kola' : slide.kind === 'recap' ? 'Rekapitulace' : section?.label ?? 'Informační slide')}</span>{slide.hidden && <small>Skryté</small>}</button></li>;
      })}</ol></details>

      <section className="outline-section">
        <h2>Úvod kvízu</h2>
        {model.introduction.map((section) => (
          <button key={section.key} type="button" className={`outline-system-item ${selected(`system:${section.key}`)}`} onClick={() => onSelect(`system:${section.key}`)}>
            <span>{section.label}</span>{section.generated && (section.key !== 'agenda' || section.slide?.automaticAgenda === true) && <small>Automaticky</small>}
          </button>
        ))}
      </section>

      <section className="outline-section outline-rounds">
        <h2>Kola</h2><button type="button" className="secondary-button add-round-button" disabled={disabled} onClick={onAddRound}>+ Přidat kolo</button>
        {model.rounds.map((round) => (
          <details key={round.id} open className="outline-round" data-round-id={round.id}>
            <summary onDragOver={event => {
              if (round.id !== 'roundless') { allowDrop(event, `end:${round.id}`); event.currentTarget.parentElement?.setAttribute('open', ''); }
            }} onDrop={event => { event.preventDefault(); if (dragged.current && round.id !== 'roundless') void move(dragged.current, round.id); }}><span>{round.position}. kolo</span><strong>{round.title}</strong><small>{round.questions.length} otázek</small></summary>
            <button type="button" className={`outline-system-item ${selected(`round:${round.id}`)}`} onClick={() => onSelect(`round:${round.id}`)}>Úvod a vzhled kola</button>
            <ol>
              {round.questions.map((question, index) => {
                const key = `slide:${question.slide.id}`;
                const displayedSlide = selectedKey === key && activeDraft?.id === question.slide.id ? activeDraft : question.slide;
                const issues = validateQuestion(displayedSlide);
                const issue = issues.find((item) => item.severity === 'error') ?? issues[0];
                return (
                  <li key={question.slide.id} data-question-id={question.slide.id}
                    className={`${dragging === question.slide.id ? 'drag-source' : ''} ${dropTarget === `before:${question.slide.id}` ? 'drop-before' : ''} ${dropTarget === `after:${question.slide.id}` ? 'drop-after' : ''}`}
                    draggable={!locked} onDragStart={event => {
                      if (locked) { event.preventDefault(); return; }
                      dragged.current = question.slide.id; setDragging(question.slide.id);
                      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', question.slide.id);
                    }} onDragEnd={clearDrag}
                    onDragOver={event => {
                      if (dragged.current === question.slide.id) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      allowDrop(event, `${event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'}:${question.slide.id}`);
                    }} onDrop={event => {
                      event.preventDefault();
                      if (!dragged.current || dragged.current === question.slide.id) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const before = event.clientY < rect.top + rect.height / 2 ? question.slide.id : round.questions[index + 1]?.slide.id;
                      void move(dragged.current, question.slide.roundId, before);
                    }}>
                    <button id={`outline-${question.slide.id}`} type="button" className={`outline-question ${selected(key)}`} title="Přetažením změňte pořadí · Alt + ↑ / ↓" onClick={() => { if (!dragged.current) onSelect(key); }}
                      onKeyDown={event => {
                        if (locked || !event.altKey) return;
                        if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); void move(question.slide.id, question.slide.roundId, round.questions[index - 1]?.slide.id); }
                        if (event.key === 'ArrowDown' && index < round.questions.length - 1) { event.preventDefault(); void move(question.slide.id, question.slide.roundId, round.questions[index + 2]?.slide.id); }
                      }}>
                      <span className="outline-question-number">{question.number}</span>
                      <span><strong>{questionSummary(displayedSlide) || 'Nová otázka'}</strong><small>{displayedSlide.authoringStatus === 'draft' ? 'Koncept · ' : ''}{questionTypeLabels[question.type]}</small></span>
                      {issue && <span className={`outline-issue ${issue.severity}`} title={issue.message} aria-label={issue.message}>!</span>}
                    </button>
                  </li>
                );
              })}
              {selectedKey === 'draft' && activeDraft?.isQuestion === true && activeDraft.roundId === round.id && (() => {
                const issues = validateQuestion(activeDraft);
                const issue = issues.find((item) => item.severity === 'error') ?? issues[0];
                const type = semanticQuestionType(activeDraft);
                return (
                  <li>
                    <button type="button" className="outline-question selected" onClick={() => onSelect('draft')}>
                      <span className="outline-question-number">{activeDraft.questionNumber ?? round.questions.length + 1}</span>
                      <span><strong>{questionSummary(activeDraft) || 'Nová otázka'}</strong><small>{questionTypeLabels[type]}</small></span>
                      {issue && <span className={`outline-issue ${issue.severity}`} title={issue.message} aria-label={issue.message}>!</span>}
                    </button>
                  </li>
                );
              })()}
            </ol>
            {round.id !== 'roundless' && <div className={`outline-drop-end ${dropTarget === `end:${round.id}` ? 'drop-active' : ''}`} onDragOver={event => allowDrop(event, `end:${round.id}`)} onDrop={event => { event.preventDefault(); if (dragged.current) void move(dragged.current, round.id); }}>{dragging ? 'Sem na konec kola' : ''}</div>}
            {round.recaps.map((recap) => (
              <button key={recap.id} type="button" className={`outline-system-item ${selected(`slide:${recap.id}`)}`} onClick={() => onSelect(`slide:${recap.id}`)}>Rekapitulace</button>
            ))}
            {round.otherSystemSlides.map((slide) => (
              <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>{slide.title || 'Informační slide'}</button>
            ))}
            {round.id === 'roundless'
              ? <p className="field-help">Otázky bez kola lze přesunout do existujícího kola.</p>
              : <button type="button" className="add-question-button" disabled={disabled} onClick={() => onOpenPicker(round.id)}>+ Přidat otázku</button>}
            {round.id !== 'roundless' && pickerRoundId === round.id && (
              <div className="question-type-picker" role="dialog" aria-label={`Typ otázky pro ${round.position}. kolo`}>
                <strong>Vyberte typ otázky</strong>
                {(Object.keys(creationLabels) as CreatableQuestionType[]).map((type) => (
                  <button key={type} type="button" onClick={() => onCreateQuestion(round, type)}>{creationLabels[type]}</button>
                ))}
                <button type="button" className="type-picker-cancel" onClick={onClosePicker}>Zrušit</button>
              </div>
            )}
          </details>
        ))}
      </section>

      {onAddInfo && <button type="button" className="secondary-button" disabled={disabled} onClick={onAddInfo}>+ Informační slide / přestávka</button>}
      <section className="outline-section">
        <h2>Výsledkové obrazovky</h2>
        <button type="button" className={`outline-system-item ${selected('results:interim')}`} onClick={() => onSelect('results:interim')}>Průběžné pořadí · šablona</button>
        <button type="button" className={`outline-system-item ${selected('results:final')}`} onClick={() => onSelect('results:final')}>Finální vyhlášení · šablona</button>
        <p className="field-help">Moderátor je zobrazí po publikaci výsledků.</p>
      </section>
      {model.closing.length === 0 && onAddClosing && <button type="button" className="secondary-button" disabled={disabled} onClick={onAddClosing}>+ Závěrečná obrazovka</button>}
      {(model.closing.length > 0 || model.legacy.length > 0) && (
        <section className="outline-section">
          <h2>Závěr a starší obsah</h2>
          {model.closing.map((slide) => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Závěr kvízu</button>)}
          {model.legacy.map((slide) => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>{slide.title || 'Informační slide'}</button>)}
        </section>
      )}
    </aside>
  );
}
