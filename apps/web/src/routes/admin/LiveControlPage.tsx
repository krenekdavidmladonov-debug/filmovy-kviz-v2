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
import { LiveModeratorView, type LivePendingAction } from '../../features/live/LiveModeratorView';
import { recapQuestionChoices } from '../../features/live/livePresentation';
import { broadcastPublicState, openProjectorChannel, parseProjectorChannelMessage, type ProjectorChannel } from '../../features/live/projectorChannel';
import { openOrFocusProjector, projectorPopupBlockedMessage } from '../../features/live/projectorWindow';
import { subscribeLiveControl, subscribeLiveControlSlides, subscribePublicLiveState } from '../../features/live/liveRepository';
import type { LiveActionResponse, LiveControlSlide, LiveControlState } from '../../features/live/types';
import { indexSlidesByPosition } from '../../features/presentation/performance';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import type { HumanErrorValue } from '../../ui/HumanError';

function technicalErrorCode(error: FirebaseError): string {
  return error.code.toUpperCase().replaceAll('/', '_').replaceAll('-', '_');
}

function operationError(error: unknown): HumanErrorValue {
  if (error instanceof FirebaseError && error.code === 'functions/aborted') {
    return {
      title: 'Stav se mezitím změnil',
      message: 'Načetli jsme aktuální stav. Zkontrolujte projektor a akci případně zopakujte.',
      technicalCode: technicalErrorCode(error),
    };
  }
  if (error instanceof FirebaseError && error.code === 'functions/failed-precondition') {
    return {
      title: 'Tuto akci teď nelze provést',
      message: 'Projektor zůstal na posledním potvrzeném obsahu.',
      technicalCode: technicalErrorCode(error),
    };
  }
  return {
    title: 'Akci se nepodařilo dokončit',
    message: 'Projektor zůstal na posledním potvrzeném obsahu. Zkontrolujte připojení a zkuste to znovu.',
    technicalCode: error instanceof FirebaseError ? technicalErrorCode(error) : 'LIVE_ACTION_FAILED',
  };
}

function loadingError(area: 'session' | 'slides'): HumanErrorValue {
  return area === 'session'
    ? { title: 'Moderování nelze načíst', message: 'Vraťte se na detail kvízu a zkuste ho spustit znovu.', technicalCode: 'LIVE_SESSION_LOAD_FAILED' }
    : { title: 'Obsah kvízu nelze načíst', message: 'Projektor zůstal na posledním potvrzeném obsahu.', technicalCode: 'LIVE_SLIDES_LOAD_FAILED' };
}

export function LiveControlPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<LiveControlState | null>(null);
  const [slides, setSlides] = useState<readonly LiveControlSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<LivePendingAction | null>(null);
  const [error, setError] = useState<HumanErrorValue | null>(null);
  const [projectorOpened, setProjectorOpened] = useState(false);
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
    }, () => { setError(loadingError('session')); setLoading(false); });
  }, [sessionId]);

  useEffect(() => {
    if (!session?.quizId) return;
    return subscribeLiveControlSlides(session.quizId, setSlides, () => setError(loadingError('slides')));
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
          setError({
            title: 'Médium se na projektoru nepřehrálo',
            message: 'Otázka zůstala zobrazená. Můžete přehrávání pustit znovu.',
            technicalCode: 'PROJECTOR_MEDIA_PLAYBACK_FAILED',
          });
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
    ? recapQuestionChoices(currentSlide, slides) : [], [currentSlide, slides]);
  const projectorUrl = useMemo(() => sessionId
    ? `${window.location.origin}/projector/${encodeURIComponent(sessionId)}`
    : '', [sessionId]);

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

  async function run(
    action: (id: string, revision: number) => Promise<LiveActionResponse>,
    actionName: LivePendingAction,
  ) {
    const current = sessionRef.current;
    if (!sessionId || !current) return;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setPendingAction(actionName);
    setError(null);
    try {
      await enqueueMutation((latest) => action(
        sessionId,
        Math.max(latest.revision, confirmedRevisionRef.current),
      ));
    } catch (actionError) {
      if (operationIdRef.current === operationId) setError(operationError(actionError));
    } finally {
      if (operationIdRef.current === operationId) setPendingAction(null);
    }
  }

  async function reportPlayback(
    generation: number,
    playbackState: 'ready' | 'playing' | 'error' | 'finished',
  ) {
    const current = sessionRef.current;
    if (!current || current.mediaGeneration !== generation) return;
    if (playbackState === 'error') {
      setError({
        title: 'Video nelze přehrát z YouTube',
        message: 'Otázka zůstala zobrazená. Zkuste přehrávání pustit znovu.',
        technicalCode: 'YOUTUBE_PLAYBACK_FAILED',
      });
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
      setProjectorOpened(false);
      setError({ title: 'Projektor se nepodařilo otevřít', message: projectorPopupBlockedMessage, technicalCode: 'PROJECTOR_POPUP_BLOCKED' });
      return;
    }
    setProjectorOpened(true);
  }

  if (loading) return <QuizLoading label="Načítám moderování…" />;
  if (!sessionId || !session) {
    return (
      <section className="focused-live-state">
        <h1>Moderování nebylo nalezeno</h1>
        <p>Vraťte se na detail kvízu a spusťte ho znovu.</p>
        <Link className="secondary-link" to="/admin/quizzes">Otevřít kvízy</Link>
      </section>
    );
  }

  return (
    <LiveModeratorView
      session={session}
      slides={slides}
      currentSlide={currentSlide}
      presentedSlide={presentedSlide}
      recapChoices={recap}
      pendingAction={pendingAction}
      error={error}
      projectorOpened={projectorOpened}
      onOpenProjector={openProjector}
      onPrevious={() => void run(previousSlide, 'previous')}
      onNext={() => void run(nextSlide, 'next')}
      onStartIntro={() => void run(startIntro, 'intro')}
      onSelectRecap={(position) => void run((id, revision) => selectRecapQuestion(id, revision, position), 'recap')}
      onPlay={() => void run(playMedia, 'play')}
      onStop={() => void run(stopMedia, 'stop')}
      onReplay={() => void run(replayMedia, 'replay')}
      onEnd={() => void run(endLiveSession, 'end')}
      onMediaFinished={(generation) => void reportPlayback(generation, 'finished')}
      onMediaError={(generation) => void reportPlayback(generation, 'error')}
      onMediaPlayback={(generation, playbackState) => void reportPlayback(generation, playbackState)}
    />
  );
}
