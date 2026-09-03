import type { SemanticQuizModel, SemanticRound } from './semanticModel';
import { questionSummary, questionTypeLabels, semanticQuestionType } from './semanticModel';
import type { CreatableQuestionType, EditorSlide } from './types';
import { validateQuestion } from './validation';

const creationLabels: Record<CreatableQuestionType, string> = {
  choice: 'Výběr z možností', free: 'Volná odpověď', image: 'Obrázek', audio: 'Audio', video: 'Video',
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
}) {
  const selected = (key: string) => key === selectedKey ? 'selected' : '';
  const questionCount = model.rounds.reduce((total, round) => total + round.questions.length, 0);
  return (
    <aside className="editor-outline editor-panel-structure" aria-label="Struktura kvízu">
      <header className="outline-heading">
        <div><span>Struktura</span><strong>{model.rounds.length} kol · {questionCount} otázek</strong></div>
        <button type="button" className={`outline-root-button ${selected('quiz')}`} onClick={() => onSelect('quiz')}>Základní údaje</button>
      </header>

      <section className="outline-section">
        <h2>Úvod kvízu</h2>
        {model.introduction.map((section) => (
          <button key={section.key} type="button" className={`outline-system-item ${selected(`system:${section.key}`)}`} onClick={() => onSelect(`system:${section.key}`)}>
            <span>{section.label}</span>{section.generated && <small>Automaticky</small>}
          </button>
        ))}
      </section>

      <section className="outline-section outline-rounds">
        <h2>Kola</h2>
        {model.rounds.map((round) => (
          <details key={round.id} open className="outline-round">
            <summary><span>{round.position}. kolo</span><strong>{round.title}</strong><small>{round.questions.length} otázek</small></summary>
            <button type="button" className={`outline-system-item ${selected(`round:${round.id}`)}`} onClick={() => onSelect(`round:${round.id}`)}>Nastavení kola</button>
            <ol>
              {round.questions.map((question) => {
                const key = `slide:${question.slide.id}`;
                const displayedSlide = selectedKey === key && activeDraft?.id === question.slide.id ? activeDraft : question.slide;
                const issues = validateQuestion(displayedSlide);
                const issue = issues.find((item) => item.severity === 'error') ?? issues[0];
                return (
                  <li key={question.slide.id}>
                    <button type="button" className={`outline-question ${selected(key)}`} onClick={() => onSelect(key)}>
                      <span className="outline-question-number">{question.number}</span>
                      <span><strong>{questionTypeLabels[question.type]}</strong><small>{questionSummary(displayedSlide)}</small></span>
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
                      <span><strong>{questionTypeLabels[type]}</strong><small>{questionSummary(activeDraft)}</small></span>
                      {issue && <span className={`outline-issue ${issue.severity}`} title={issue.message} aria-label={issue.message}>!</span>}
                    </button>
                  </li>
                );
              })()}
            </ol>
            {round.recaps.map((recap) => (
              <button key={recap.id} type="button" className={`outline-system-item ${selected(`slide:${recap.id}`)}`} onClick={() => onSelect(`slide:${recap.id}`)}>Rekapitulace</button>
            ))}
            {round.otherSystemSlides.map((slide) => (
              <button key={slide.id} type="button" className={`outline-system-item legacy ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Starší nastavení kola</button>
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
        <button type="button" className="secondary-button add-round-button" disabled={disabled} onClick={onAddRound}>+ Přidat kolo</button>
      </section>

      {(model.closing.length > 0 || model.legacy.length > 0) && (
        <section className="outline-section">
          <h2>Závěr a starší obsah</h2>
          {model.closing.map((slide) => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Závěr kvízu</button>)}
          {model.legacy.map((slide) => <button key={slide.id} type="button" className={`outline-system-item legacy ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Starší obsah</button>)}
        </section>
      )}
    </aside>
  );
}
