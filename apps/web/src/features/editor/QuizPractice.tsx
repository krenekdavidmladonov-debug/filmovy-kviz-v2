import { useMemo, useState } from 'react';
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
  return <div className="private-practice" role="dialog" aria-modal="true" aria-label="Soukromá zkouška kvízu">
    <header><strong>Soukromá zkouška · {index + 1} / {slides.length}</strong><span>Bez živé publikace</span><button type="button" onClick={event => { const dialog = event.currentTarget.closest('.private-practice'); if (dialog && document.fullscreenElement === null) void dialog.requestFullscreen().catch(() => {}); }}>Zvětšit</button><button type="button" onClick={onClose}>Zavřít zkoušku</button></header>
    <div className="practice-stage" data-slide-id={original.id}><SlideRenderer key={slide.id} quizTitle={quiz.title} mode={showAnswer ? 'recap' : undefined} slide={{ ...slide, ...(showAnswer ? { revealedAnswer: slide.correctAnswer } : {}) }} mediaCommand={command} mediaGeneration={generation} onMediaFinished={() => setCommand('finished')} /></div>
    {type === 'audio' && !showAnswer && original.kind !== 'recap' && slide.mediaSource && <div className="practice-audio"><MediaPlayer key={slide.id} source={slide.mediaSource} command={command} generation={generation} startSeconds={slide.clipStartSeconds ?? 0} {...(slide.clipEndSeconds === null ? {} : { endSeconds: slide.clipEndSeconds })} onFinished={() => setCommand('finished')} /></div>}
    <footer><button type="button" disabled={index === 0} onClick={() => change(index - 1)}>Předchozí</button><button type="button" disabled={index === slides.length - 1} onClick={() => change(index + 1)}>Další</button>
      {original.isQuestion && <button type="button" onClick={() => { setAnswer(value => !value); run('stop'); }}>{answer ? 'Skrýt odpověď' : 'Odhalit odpověď ve zkoušce'}</button>}
      {original.kind === 'recap' && <label>Otázka rekapitulace<select value={recapId} onChange={event => { setRecapId(event.target.value); run('stop'); }}><option value="">Vyberte otázku</option>{recapQuestions.map(item => <option key={item.id} value={item.id}>{item.questionNumber}. {item.text || item.title}</option>)}</select></label>}
      {['audio','video'].includes(type) && <><button type="button" onClick={() => run('play')}>Přehrát</button><button type="button" onClick={() => run('stop')}>Zastavit</button><button type="button" onClick={() => run('replay')}>Pustit znovu</button></>}
    </footer>
  </div>;
}
