import { FirebaseError } from 'firebase/app';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  endLiveSession,
  nextSlide,
  playMedia,
  previousSlide,
  reportMediaPlayback,
  replayMedia,
  selectRecapQuestion,
  startIntro,
  stopMedia,
} from '../../features/live/liveApi';
import { broadcastPublicState, openProjectorChannel, parseProjectorChannelMessage, type ProjectorChannel } from '../../features/live/projectorChannel';
import { openOrFocusProjector, projectorPopupBlockedMessage } from '../../features/live/projectorWindow';
import { subscribeLiveControl, subscribeLiveControlSlides, subscribePublicLiveState } from '../../features/live/liveRepository';
import type { LiveActionResponse, LiveControlSlide, LiveControlState } from '../../features/live/types';
import { SlideRenderer } from '../../features/presentation/SlideRenderer';
import { YouTubePlayer } from '../../features/presentation/YouTubePlayer';
import { indexSlidesByPosition } from '../../features/presentation/performance';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

function operationError(error: unknown): string {
  if (error instanceof FirebaseError && error.code === 'functions/aborted') {
    return 'Session mezitím změnil jiný panel nebo doběhl starý přehrávač. Stav byl obnoven.';
  }
  if (error instanceof FirebaseError && error.code === 'functions/failed-precondition') {
    return error.message || 'Akci v aktuálním stavu nelze provést.';
  }
  return 'Live operace se nezdařila. Zkontrolujte připojení k Functions Emulatoru.';
}

function isMediaSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['audio', 'music', 'video', 'youtube'].includes(slide.kind.toLowerCase());
}

function isAudioSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['audio', 'music'].includes(slide.kind.toLowerCase());
}

function isIntroSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['intro', 'round', 'roundheader', 'round-header', 'section'].includes(slide.kind.toLowerCase());
}

function mediaSource(slide?: LiveControlSlide): string | undefined {
  if (!slide) return undefined;
  if (slide.mediaSource) return slide.mediaSource;
  const kind = isAudioSlide(slide) ? 'audio' : 'video';
  return slide.media.find((item) => item.role === 'prompt' && item.kind === kind)?.source;
}

function recapQuestions(anchor: LiveControlSlide, slides: readonly LiveControlSlide[]): readonly LiveControlSlide[] {
  if (anchor.roundId) {
    return slides.filter((slide) => slide.isQuestion && slide.roundId === anchor.roundId && slide.position < anchor.position);
  }
  const boundary = [...slides].reverse().find((slide) => (
    slide.position < anchor.position && ['round', 'roundheader', 'round-header', 'section', 'recap'].includes(slide.kind.toLowerCase())
  ));
  return slides.filter((slide) => slide.isQuestion && slide.position < anchor.position && slide.position > (boundary?.position ?? 0));
}

export function LiveControlPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<LiveControlState | null>(null);
  const [slides, setSlides] = useState<readonly LiveControlSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LiveControlState | null>(null);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);
  const operationIdRef = useRef(0);
  const confirmedRevisionRef = useRef(-1);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    confirmedRevisionRef.current = -1;
    mutationQueueRef.current = Promise.resolve();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    return subscribeLiveControl(sessionId, (value) => {
      sessionRef.current = value;
      if (value) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, value.revision);
      setSession(value);
      setLoading(false);
    }, () => { setError('Privátní live session se nepodařilo načíst.'); setLoading(false); });
  }, [sessionId]);

  useEffect(() => {
    if (!session?.quizId) return;
    return subscribeLiveControlSlides(session.quizId, setSlides, () => setError('Privátní slidy se nepodařilo načíst.'));
  }, [session?.quizId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = openProjectorChannel(sessionId);
    channelRef.current = channel;
    if (channel) {
      channel.setMessageHandler((data) => {
        const message = parseProjectorChannelMessage(data);
        if (message?.type !== 'playback-state') return;
        const current = sessionRef.current;
        if (!current || message.sessionId !== current.sessionId
          || message.mediaGeneration !== current.mediaGeneration) return;
        if (message.playbackState === 'error') {
          setError('Projektor médium nepřehrál. Otázka zůstala zobrazená; použijte REPLAY pro nový pokus.');
        }
        void enqueueMutation((latest) => latest.mediaGeneration === message.mediaGeneration
          ? reportMediaPlayback(latest.sessionId, message.mediaGeneration, message.playbackState)
          : Promise.resolve(undefined)).catch((playbackError) => {
          if (message.playbackState === 'error') setError(operationError(playbackError));
        });
      });
    }
    const unsubscribe = subscribePublicLiveState(sessionId, (value) => {
      if (value) broadcastPublicState(channel, value);
    }, () => undefined);
    return () => { unsubscribe(); channel?.close(); channelRef.current = undefined; };
  }, [sessionId]);

  const slideIndex = useMemo(() => indexSlidesByPosition(slides), [slides]);
  const currentSlide = session ? slideIndex.get(session.currentSlidePosition) : undefined;
  const presentedSlide = useMemo(() => (
    session?.presentationMode === 'recap' && session.recapQuestionPosition
      ? slideIndex.get(session.recapQuestionPosition)
      : currentSlide
  ), [currentSlide, session?.presentationMode, session?.recapQuestionPosition, slideIndex]);
  const recap = useMemo(() => currentSlide?.kind.toLowerCase() === 'recap'
    ? recapQuestions(currentSlide, slides) : [], [currentSlide, slides]);
  const projectorUrl = useMemo(() => sessionId ? `${window.location.origin}/projector/${encodeURIComponent(sessionId)}` : '', [sessionId]);

  function enqueueMutation(
    action: (current: LiveControlState) => Promise<LiveActionResponse | undefined>,
  ): Promise<void> {
    const execute = mutationQueueRef.current.catch(() => undefined).then(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const result = await action(current);
      if (result) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, result.revision);
    });
    mutationQueueRef.current = execute.catch(() => undefined);
    return execute;
  }

  async function run(action: (id: string, revision: number) => Promise<LiveActionResponse>) {
    const current = sessionRef.current;
    if (!sessionId || !current) return;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setPending(true);
    setError(null);
    try {
      await enqueueMutation((latest) => action(
        sessionId,
        Math.max(latest.revision, confirmedRevisionRef.current),
      ));
    }
    catch (actionError) {
      if (operationIdRef.current === operationId) setError(operationError(actionError));
    } finally {
      if (operationIdRef.current === operationId) setPending(false);
    }
  }

  async function reportPlayback(
    generation: number,
    playbackState: 'ready' | 'playing' | 'error' | 'finished',
    message?: string,
  ) {
    const current = sessionRef.current;
    if (!current || current.mediaGeneration !== generation) return;
    if (playbackState === 'error') {
      setError(message ?? 'Médium se nepodařilo přehrát. Použijte REPLAY pro nový pokus.');
    }
    try {
      await enqueueMutation((latest) => latest.mediaGeneration === generation
        ? reportMediaPlayback(latest.sessionId, generation, playbackState)
        : Promise.resolve(undefined));
    } catch (playbackError) {
      if (playbackState === 'error') setError(operationError(playbackError));
    }
  }

  function openProjector() {
    if (openOrFocusProjector(projectorUrl) === null) {
      setError(projectorPopupBlockedMessage);
    }
  }

  if (loading) return <QuizLoading label="Načítám live session…" />;
  if (!sessionId || !session) {
    return <section className="quiz-state-card"><div><h1>Live session nenalezena</h1><p>Vraťte se do knihovny a spusťte kvíz znovu.</p></div><Link to="/admin/quizzes">Knihovna</Link></section>;
  }

  const ended = session.status === 'ended';
  const source = mediaSource(presentedSlide);
  return (
    <article className="live-control">
      <header className="live-heading">
        <div><p className="eyebrow">Moderátorský live control</p><h1>{session.quizTitle}</h1><p className="lead">Stav: {session.status} · revize {session.revision}</p></div>
        <button className="secondary-button" onClick={openProjector}>Otevřít / aktivovat projektor ↗</button>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="live-grid">
        <div className="live-preview">
          <div className="live-slide-meta"><span>{session.currentSlidePosition || '—'} / {session.slideCount}</span><span>{currentSlide?.kind ?? 'Čekání'}</span></div>
          {session.status === 'waiting' ? <div><h2>Projektor čeká</h2><p>Stiskněte Další pro zobrazení prvního slidu.</p></div>
            : ended ? <div><h2>Kvíz byl ukončen</h2><p>Veřejný projektor zobrazuje koncový stav.</p></div>
              : presentedSlide ? (
                <>
                  <SlideRenderer
                    compact quizTitle={session.quizTitle}
                    mode={session.presentationMode === 'recap' ? 'recap' : 'editorPreview'}
                    mediaCommand="idle"
                    slide={{ ...presentedSlide, ...(session.presentationMode === 'recap' && presentedSlide.correctAnswer ? { revealedAnswer: presentedSlide.correctAnswer } : {}) }}
                  />
                  {presentedSlide.isQuestion && (
                    <div className="moderator-answer"><span>PRIVÁTNÍ ODPOVĚĎ PRO MODERÁTORA</span><strong>{presentedSlide.correctAnswer ?? 'Odpověď není textově dostupná'}</strong></div>
                  )}
                  {presentedSlide.moderatorNote && <div className="moderator-note"><span>POZNÁMKA MODERÁTORA</span><p>{presentedSlide.moderatorNote}</p></div>}
                </>
              ) : <QuizLoading label="Načítám slide…" />}
        </div>

        <aside className="live-actions">
          <button className="projector-url projector-link-button" onClick={openProjector}>{projectorUrl}</button>
          <div className="live-button-row">
            <button className="secondary-button" disabled={pending || ended || session.currentSlidePosition <= 1} onClick={() => void run(previousSlide)}>← Předchozí</button>
            <button className="primary-button" disabled={pending || ended || session.currentSlidePosition >= session.slideCount} onClick={() => void run(nextSlide)}>Další →</button>
          </div>

          {isIntroSlide(currentSlide) && (
            <button className="primary-button" disabled={pending || ended} onClick={() => void run(startIntro)}>Spustit intro</button>
          )}

          {session.presentationMode === 'recap' && (
            <section className="recap-controls">
              <strong>Rekapitulace · libovolné pořadí</strong>
              <div className="recap-question-buttons">
                {recap.map((question) => (
                  <button
                    key={question.id}
                    className={question.id === session.recapQuestionId ? 'selected' : ''}
                    disabled={pending || !question.correctAnswer}
                    onClick={() => void run((id, revision) => selectRecapQuestion(id, revision, question.position))}
                  >{question.questionNumber ?? question.position}</button>
                ))}
              </div>
              {recap.length === 0 && <p className="field-help">Pro tento recap nebyly nalezeny otázky stejného kola.</p>}
            </section>
          )}

          {isMediaSlide(presentedSlide) && presentedSlide && source && (
            <section className="media-controls">
              <strong>{isAudioSlide(presentedSlide) && session.presentationMode === 'slide' ? 'Audio na notebooku' : 'Dálkové ovládání média'}</strong>
              <div className="media-button-row">
                <button className="primary-button" disabled={pending || ended} onClick={() => void run(playMedia)}>PLAY</button>
                <button className="secondary-button" disabled={pending || ended} onClick={() => void run(stopMedia)}>STOP</button>
                <button className="secondary-button" disabled={pending || ended} onClick={() => void run(replayMedia)}>REPLAY</button>
              </div>
              <p className="youtube-limitation">YouTube: ochrana před spoilery je pouze best effort; název, thumbnail, branding nebo reklama se mohou zobrazit.</p>
              {isAudioSlide(presentedSlide) && session.presentationMode === 'slide' && (
                <YouTubePlayer
                  source={source}
                  command={session.mediaCommand}
                  generation={session.mediaGeneration}
                  startSeconds={presentedSlide.clipStartSeconds ?? presentedSlide.presentation.videoStart ?? 0}
                  endSeconds={presentedSlide.clipEndSeconds ?? presentedSlide.presentation.videoEnd ?? undefined}
                  className="youtube-player-shell moderator-audio-player"
                  onFinished={(generation) => void reportPlayback(generation, 'finished')}
                  onError={(generation, message) => void reportPlayback(generation, 'error', message)}
                  onPlaybackState={(generation, playbackState) => void reportPlayback(generation, playbackState)}
                />
              )}
            </section>
          )}
          {isMediaSlide(presentedSlide) && !source && <p className="media-warning">Médium nemá zdroj. Otázka zůstává bezpečně textová.</p>}
          <button className="danger-button" disabled={pending || ended} onClick={() => void run(endLiveSession)}>Ukončit kvíz</button>
        </aside>
      </section>
    </article>
  );
}
