import { useEffect, useRef, useState } from 'react';
import { SlidePreview } from '../presentation/SlidePreview';
import { buildSemanticQuizModel, questionSummary, questionTypeLabels, semanticQuestionType } from './semanticModel';
import type { EditorQuiz, EditorSlide } from './types';

function Thumbnail({ slide, title }: { slide: EditorSlide; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: '100px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="storyboard-thumbnail" aria-hidden="true" inert>
    {visible && <SlidePreview quizTitle={title} slide={{ ...slide, mediaSource: '', media: [], correctAnswer: '', answerImage: '', answerExplanation: '' }} />}
  </div>;
}

export function EditorStoryboard({ quiz, selectedId, changedIds, disabled, onSelect, onMove }: {
  quiz: EditorQuiz; selectedId?: string; changedIds: ReadonlySet<string>; disabled: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, targetRoundId: string | undefined, beforeId?: string) => Promise<boolean>;
}) {
  const model = buildSemanticQuizModel(quiz);
  const slides = [...quiz.slides].sort((a, b) => a.position - b.position);
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [moving, setMoving] = useState(false);
  const busy = disabled || moving;
  async function move(id: string, roundId: string | undefined, beforeId?: string) {
    if (busy || id === beforeId) return;
    setMoving(true); setDragged(null); setAnnouncement('Přesouvám otázku…');
    try {
      const success = await onMove(id, roundId, beforeId);
      setAnnouncement(success ? 'Otázka přesunuta. Pořadí bylo aktualizováno.' : 'Přesun se nezdařil. Zkontrolujte zprávu editoru.');
      if (success) requestAnimationFrame(() => document.getElementById(`storyboard-${id}`)?.focus());
    } finally { setMoving(false); }
  }
  return <section className="editor-storyboard" aria-label="Storyboard kvízu">
    <header><h2>Scénář kvízu</h2><p>{slides.length} slidů v pořadí promítání. Kliknutím otevřete úpravy.</p>
      <p>{disabled ? 'Před přesouváním uložte nebo zahoďte změny. V režimu pouze pro čtení nelze přesouvat.' : 'Otázku přetáhněte před jinou otázku nebo na konec kola. Použít můžete také tlačítka a výběr kola.'}</p>
      <p role="status" aria-live="polite">{announcement}</p></header>
    {slides.length === 0 && <p>Zatím žádné slidy. Ve struktuře přidejte první kolo.</p>}
    <ol className="storyboard-grid">{slides.map((slide, index) => {
      const round = model.rounds.find(item => item.slides.some(member => member.id === slide.id));
      const questions = round?.questions ?? [];
      const questionIndex = questions.findIndex(item => item.slide.id === slide.id);
      const label = slide.isQuestion ? questionTypeLabels[semanticQuestionType(slide)] : slide.kind === 'recap' ? 'Rekapitulace' : slide.title || 'Systémový slide';
      return <li key={slide.id} className={`storyboard-card ${selectedId === slide.id ? 'selected' : ''}`} data-slide-id={slide.id}
        onDragOver={event => { if (!busy && dragged && slide.isQuestion && dragged !== slide.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { event.preventDefault(); if (dragged && slide.isQuestion) void move(dragged, slide.roundId, slide.id); }}>
        <button id={`storyboard-${slide.id}`} type="button" className="storyboard-select" aria-label={`Upravit slide ${index + 1}: ${label}`} onClick={() => onSelect(slide.id)}>
          <Thumbnail slide={slide} title={quiz.title} /><span className="storyboard-caption"><strong>{index + 1}. {label}</strong><span>{questionSummary(slide) || slide.title || 'Bez textu'}</span>
          {round && <small>{round.position}. kolo · {round.title}{slide.isQuestion ? ` · otázka ${questionIndex + 1}` : ''}</small>}
          {slide.authoringStatus === 'draft' && <small>Koncept</small>}{changedIds.has(slide.id) && <small>Neuložené změny</small>}</span>
        </button>
        {slide.isQuestion && <div className="storyboard-actions">
          <span className="storyboard-drag-handle" role="button" tabIndex={busy ? -1 : 0} draggable={!busy} aria-disabled={busy} onKeyDown={event => { if (event.key === 'ArrowUp' && questionIndex > 0) { event.preventDefault(); void move(slide.id, slide.roundId, questions[questionIndex - 1]?.slide.id); } else if (event.key === 'ArrowDown' && questionIndex < questions.length - 1) { event.preventDefault(); void move(slide.id, slide.roundId, questions[questionIndex + 2]?.slide.id); } }} aria-label={`Přetáhnout otázku ${questionIndex + 1}`} onDragStart={event => { if (busy) { event.preventDefault(); return; } setDragged(slide.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', slide.id); }} onDragEnd={() => setDragged(null)}>↕ Přetáhnout</span>
          <button type="button" disabled={busy || questionIndex <= 0} aria-label={`Otázka ${questionIndex + 1} nahoru`} onClick={() => void move(slide.id, slide.roundId, questions[questionIndex - 1]?.slide.id)}>↑</button>
          <button type="button" disabled={busy || questionIndex < 0 || questionIndex >= questions.length - 1} aria-label={`Otázka ${questionIndex + 1} dolů`} onClick={() => void move(slide.id, slide.roundId, questions[questionIndex + 2]?.slide.id)}>↓</button>
          <label>Přesunout do kola<select aria-label={`Přesunout otázku ${questionIndex + 1} do kola`} value="" disabled={busy} onChange={event => { if (event.target.value) void move(slide.id, event.target.value); }}><option value="">Vyberte kolo…</option>{model.rounds.filter(item => item.id !== 'roundless' && item.id !== round?.id).map(item => <option key={item.id} value={item.id}>{item.position}. {item.title}</option>)}</select></label>
        </div>}
      </li>;
    })}</ol>
    <div className="storyboard-round-targets">{model.rounds.filter(round => round.id !== 'roundless').map(round => <div key={round.id} className="storyboard-round-target" onDragOver={event => { if (!busy && dragged) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragged) void move(dragged, round.id); }}>Na konec {round.position}. kola · {round.title}</div>)}</div>
  </section>;
}
