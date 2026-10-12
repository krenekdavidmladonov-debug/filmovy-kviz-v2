import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { semanticQuestionType } from '@filmovy-kviz/quiz-domain';
import type { EditorQuiz, EditorSlide } from './types';
import { SlideRenderer } from '../presentation/SlideRenderer';
import { MediaPlayer } from '../presentation/MediaPlayer';
import type { MediaPlaybackCommand } from '../presentation/types';

export function practiceSlides(quiz: EditorQuiz): readonly EditorSlide[] {
  // Rehearse the same persisted stream consumed by snapshots and live sessions.
  // Missing system sections and manually authored agendas must stay unchanged.
  return [...quiz.slides].sort((a, b) => a.position - b.position);
}

/** Private in-memory rehearsal. No session, channel, persistence or public URL. */
export function QuizPractice({ quiz, onClose }: { quiz: EditorQuiz; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  const trapBoundaryTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex],audio[controls],video[controls],iframe')].filter(element =>
      element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert]') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible')
      .sort((left, right) => (left.tabIndex > 0 ? left.tabIndex : Infinity) - (right.tabIndex > 0 ? right.tabIndex : Infinity));
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
    // Leave navigation within players and iframes to the browser; only wrap boundaries.
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    else if (active === dialog || !dialog.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const slides = useMemo(() => practiceSlides(quiz), [quiz]);
  const [index, setIndex] = useState(0), [answer, setAnswer] = useState(false), [recapId, setRecapId] = useState('');
  const [command, setCommand] = useState<MediaPlaybackCommand>('idle'), [generation, setGeneration] = useState(1);
  const original = slides[index]!;
  const recapQuestions = quiz.slides.filter(item => item.isQuestion && item.roundId === original.roundId);
  const slide = original.kind === 'recap' ? recapQuestions.find(item => item.id === recapId) ?? original : original;
  const type = semanticQuestionType(slide);
  const showAnswer = original.kind === 'recap' ? slide.isQuestion : answer;
  const change = (next: number) => { setIndex(next); setAnswer(false); setRecapId(''); setCommand('idle'); setGeneration(n => n + 1); };
  const run = (next: MediaPlaybackCommand) => { setCommand(next); setGeneration(n => n + 1); };
  return <dialog ref={dialogRef} className="private-practice" aria-modal="true" aria-label="Soukromá zkouška kvízu" onKeyDown={trapBoundaryTab} style={{ margin: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', boxSizing: 'border-box', border: 0, color: 'inherit' }} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="practice-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'var(--color-background)' }}>
    <header><strong>Soukromá zkouška · {index + 1} / {slides.length}</strong><span>Bez živé publikace</span><button type="button" onClick={event => { const content = event.currentTarget.closest('.practice-content'); if (content && document.fullscreenElement === null) void content.requestFullscreen().catch(() => {}); }}>Zvětšit</button><button ref={closeRef} type="button" onClick={onClose}>Zavřít zkoušku</button></header>
    <div className="practice-stage" data-slide-id={original.id}><SlideRenderer key={slide.id} quizTitle={quiz.title} mode={showAnswer ? 'recap' : undefined} slide={{ ...slide, ...(showAnswer ? { revealedAnswer: slide.correctAnswer } : {}) }} mediaCommand={command} mediaGeneration={generation} onMediaFinished={() => setCommand('finished')} /></div>
    {type === 'audio' && !showAnswer && original.kind !== 'recap' && slide.mediaSource && <div className="practice-audio"><MediaPlayer key={slide.id} source={slide.mediaSource} command={command} generation={generation} startSeconds={slide.clipStartSeconds ?? 0} {...(slide.clipEndSeconds === null ? {} : { endSeconds: slide.clipEndSeconds })} onFinished={() => setCommand('finished')} /></div>}
    <footer><button type="button" disabled={index === 0} onClick={() => change(index - 1)}>Předchozí</button><button type="button" disabled={index === slides.length - 1} onClick={() => change(index + 1)}>Další</button>
      {original.isQuestion && <button type="button" onClick={() => { setAnswer(value => !value); run('stop'); }}>{answer ? 'Skrýt odpověď' : 'Odhalit odpověď ve zkoušce'}</button>}
      {original.kind === 'recap' && <label>Otázka rekapitulace<select value={recapId} onChange={event => { setRecapId(event.target.value); run('stop'); }}><option value="">Vyberte otázku</option>{recapQuestions.map(item => <option key={item.id} value={item.id}>{item.questionNumber}. {item.text || item.title}</option>)}</select></label>}
      {['audio','video'].includes(type) && <><button type="button" onClick={() => run('play')}>Přehrát</button><button type="button" onClick={() => run('stop')}>Zastavit</button><button type="button" onClick={() => run('replay')}>Pustit znovu</button></>}
    </footer>
    </div>
  </dialog>;
}
