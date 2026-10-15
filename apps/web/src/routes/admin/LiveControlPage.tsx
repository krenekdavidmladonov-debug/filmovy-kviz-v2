import { FinalRevealPanel } from '../../features/final-reveal/FinalRevealPanel';
import { InterimResultsPanel } from '../../features/leaderboard/InterimResultsPanel';
import { FirebaseError } from 'firebase/app';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';

import { SnapshotMediaContext } from '../../features/media/SnapshotMediaContext';
import {
  endLiveSession,
  revealAnswer,
  hideAnswer,
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
import { isAudioSlide, recapQuestionChoices } from '../../features/live/livePresentation';
import { broadcastPublicState, openProjectorChannel, parseProjectorChannelMessage, type ProjectorChannel } from '../../features/live/projectorChannel';
import { openOrFocusProjector, projectorPopupBlockedMessage } from '../../features/live/projectorWindow';
import { subscribeLiveControl, subscribeLiveControlSlides, subscribePublicLiveState } from '../../features/live/liveRepository';
import type { LiveActionResponse, LiveControlSlide, LiveControlState, PublicLiveState } from '../../features/live/types';
import { indexSlidesByPosition } from '../../features/presentation/performance';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import type { HumanErrorValue } from '../../ui/HumanError';
import { ShowCommandContext, type RevisionedResult, type ShowAudioCue } from '../../features/live/ShowCommandContext';
import { ShowAudioPanel } from '../../features/show-audio/ShowAudioPanel';
import type { ShowAudioController } from '../../features/show-audio/controller';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlState } from '../../features/live/liveMappers';
import '../../features/live/show-control.css';
import { useAuth } from '../../auth/AuthProvider';
import type { ShowPreferences } from '@filmovy-kviz/quiz-domain';

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
  const { can } = useAuth();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<LiveControlState | null>(null);
  const [publicState, setPublicState] = useState<PublicLiveState | null>(null);
  const [slides, setSlides] = useState<readonly LiveControlSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<LivePendingAction | null>(null);
  const [error, setError] = useState<HumanErrorValue | null>(null);
  const [projectorOpened, setProjectorOpened] = useState(false);
  const [showEnabled, setShowEnabled] = useState(false);
  const [showPreferences, setShowPreferences] = useState<ShowPreferences>();
  const [queueCount, setQueueCount] = useState(0);
  const [audioSuppressed, setAudioSuppressed] = useState(false);
  const suppressedAudioGeneration = useRef<{ sessionId: string; generation: number } | null>(null);
  const questionAudioPending = useRef(false);
  const audioController = useRef<ShowAudioController | null>(null);
  const audioRevision = useRef<number | null>(null);
  const remoteMediaActive = useRef(false);
  const automaticAudioPreparedAt = useRef(0);
  const canPlayShowAudio = useCallback(() => {
    const current = sessionRef.current;
    const suppressed = suppressedAudioGeneration.current;
    return Boolean(current && current.status !== 'ended' && navigator.onLine && !questionAudioPending.current
      && ((suppressed?.sessionId === current.sessionId && suppressed.generation === current.mediaGeneration)
        || !['preparing', 'playing', 'ready'].includes(current.mediaPlaybackState)));
  }, []);
  const connectAudio = useCallback((controller: ShowAudioController | null) => { audioController.current = controller; }, []);
  const sessionRef = useRef<LiveControlState | null>(null);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);
  const operationIdRef = useRef(0);
  const confirmedRevisionRef = useRef(-1);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const accessGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++accessGenerationRef.current;
    let initialStyle = true;
    const invalidate = () => {
      audioController.current?.stopImmediate(); audioRevision.current = null;
      suppressedAudioGeneration.current = null; questionAudioPending.current = false;
      accessGenerationRef.current++; operationIdRef.current++; sessionRef.current = null;
      confirmedRevisionRef.current = -1; mutationQueueRef.current = Promise.resolve();
      setPublicState(null);
    };
    confirmedRevisionRef.current = -1;
    mutationQueueRef.current = Promise.resolve();
    sessionRef.current = null; setSession(null); setSlides([]); setPendingAction(null); setError(null); setLoading(true);
    if (!sessionId) { setLoading(false); return; }
    const unsubscribe = subscribeLiveControl(sessionId, (value) => {
      if (generation !== accessGenerationRef.current) return;
      sessionRef.current = value;
      const suppressed = suppressedAudioGeneration.current;
      if (!value || suppressed?.sessionId !== value.sessionId || suppressed.generation !== value.mediaGeneration) {
        suppressedAudioGeneration.current = null; setAudioSuppressed(false);
        if (value && ['preparing', 'playing', 'ready'].includes(value.mediaPlaybackState)) stopShowAudio();
      }
      if (value && (initialStyle || value.interimResults || value.finalReveal?.visible)) {
        setShowEnabled(value.interimResults?.presentationStyle === 'show' || value.finalReveal?.presentationStyle === 'show');
        initialStyle = false;
      }
      if (value) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, value.revision);
      else { invalidate(); setSlides([]); setPendingAction(null); }
      setSession(value);
      setLoading(false);
    }, () => {
      if (generation !== accessGenerationRef.current) return;
      invalidate(); setSession(null); setSlides([]); setPendingAction(null);
      setError(loadingError('session')); setLoading(false);
    });
    return () => { invalidate(); unsubscribe(); };
  }, [sessionId]);

  useEffect(() => {
    setSlides([]);
    if (!session?.quizId) return;
    return subscribeLiveControlSlides(session.quizId, setSlides, () => { setSlides([]); setError(loadingError('slides')); }, session.snapshotId);
  }, [session?.quizId, session?.snapshotId]);

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
      setPublicState(value);
      if (value) broadcastPublicState(channel, value);
    }, () => setPublicState(null));
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

  useEffect(() => {
    if (audioRevision.current !== null && session?.revision !== audioRevision.current) stopShowAudio();
    if (session?.status === 'ended') stopShowAudio();
  }, [session?.revision, session?.status]);

  function stopShowAudio() { audioController.current?.stopImmediate(); audioRevision.current = null; }
  function prepareShowAudio() {
    automaticAudioPreparedAt.current = performance.now();
    const current = sessionRef.current;
    // A server stop does not acknowledge a remote projector's physical video output.
    remoteMediaActive.current = Boolean(current && ['playing', 'preparing', 'ready'].includes(current.mediaPlaybackState)
      && (!isAudioSlide(presentedSlide) || current.presentationMode === 'recap'));
    suppressedAudioGeneration.current = current && !remoteMediaActive.current
      ? { sessionId: current.sessionId, generation: current.mediaGeneration } : null;
    setAudioSuppressed(true);
    return audioController.current?.prepareGesture() ?? -1;
  }
  async function playShowAudio(cue: ShowAudioCue, result: RevisionedResult, ticket: number) {
    const controller = audioController.current, generation = accessGenerationRef.current;
    const deadline = automaticAudioPreparedAt.current + 3000;
    if (!controller || result.replayed || ticket < 0 || remoteMediaActive.current || !sessionId) return;
    try {
      const db = getFirebaseFirestore();
      const snapshot = await runTransaction(db, transaction => transaction.get(doc(db, 'sessions', sessionId)));
      const fresh = snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null;
      const valid = () => generation === accessGenerationRef.current && controller === audioController.current
        && performance.now() <= deadline && navigator.onLine && sessionRef.current?.sessionId === sessionId
        && sessionRef.current.revision <= result.revision;
      if (!valid() || fresh?.revision !== result.revision || fresh.status !== 'active'
        || (cue !== 'intro' && (!result.showCue || fresh.showCue?.id !== result.showCue.id))
        || (cue === 'interim' ? !fresh.interimResults : cue !== 'intro' && !fresh.finalReveal?.visible)
        || (result.versionId && result.versionId !== (cue === 'interim' ? fresh.interimResults?.versionId : fresh.finalReveal?.versionId))) return;
      audioRevision.current = result.revision;
      await controller.playCue(cue, ticket, valid);
    } catch { /* Visual publication succeeded. Manual audio remains available after reconnect. */ }
  }

  function enqueueMutation<T extends { revision: number } | undefined>(
    action: (current: LiveControlState) => Promise<T>,
  ): Promise<T> {
    const generation = accessGenerationRef.current;
    setQueueCount(count => count + 1);
    const execute = mutationQueueRef.current.catch(() => undefined).then(async () => {
      if (generation !== accessGenerationRef.current) throw new Error('Přístup se změnil.');
      const current = sessionRef.current;
      if (!current) throw new Error('Session není dostupná.');
      const result = await action(current);
      if (result && generation === accessGenerationRef.current) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, result.revision);
      return result;
    });
    mutationQueueRef.current = execute.then(() => undefined, () => undefined);
    return execute.finally(() => setQueueCount(count => Math.max(0, count - 1)));
  }

  async function run(
    action: (id: string, revision: number) => Promise<LiveActionResponse>,
    actionName: LivePendingAction,
  ) {
    const current = sessionRef.current;
    if (!sessionId || !current) return;
    const introTicket = actionName === 'intro' && showEnabled ? prepareShowAudio() : undefined;
    if (introTicket === undefined) stopShowAudio();
    if (actionName === 'play' || actionName === 'replay') {
      questionAudioPending.current = true; suppressedAudioGeneration.current = null; setAudioSuppressed(false);
    }
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setPendingAction(actionName);
    setError(null);
    try {
      const result = await enqueueMutation((latest) => action(
        sessionId,
        Math.max(latest.revision, confirmedRevisionRef.current),
      ));
      if (introTicket !== undefined) void playShowAudio('intro', result, introTicket);
    } catch (actionError) {
      if (operationIdRef.current === operationId) setError(operationError(actionError));
    } finally {
      if (operationIdRef.current === operationId) { questionAudioPending.current = false; setPendingAction(null); }
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
    <ShowCommandContext.Provider value={{
      busy: queueCount > 0 || pendingAction !== null, enabled: showEnabled, preferences: showPreferences,
      execute: action => enqueueMutation(current => action(current, Math.max(current.revision, confirmedRevisionRef.current))),
      prepareAudio: prepareShowAudio, playAudio: playShowAudio, stopAudio: stopShowAudio,
    }}>
    <SnapshotMediaContext.Provider value={session.snapshotId}>
    <LiveModeratorView
      session={session}
      publicState={publicState}
      slides={slides}
      currentSlide={currentSlide}
      presentedSlide={presentedSlide}
      recapChoices={recap}
      pendingAction={pendingAction ?? (queueCount > 0 ? 'show' : null)}
      audioSuppressed={audioSuppressed}
      error={error}
      projectorOpened={projectorOpened}
      onOpenProjector={openProjector}
      onPrevious={() => void run(previousSlide, 'previous')}
      onNext={() => void run(nextSlide, 'next')}
      onReveal={() => void run(revealAnswer, 'reveal')}
      onHide={() => void run(hideAnswer, 'hide')}
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
    {session.eventId && session.snapshotId && <section className="live-secondary-work show-control-desk" aria-label="Režie show">
      <header className="show-control-heading"><div><h2>Režie večera</h2><p>{publicState?.finalReveal ? 'Publikum vidí finální vyhlášení.' : publicState?.interimResults ? 'Publikum vidí průběžné výsledky.' : publicState ? 'Publikum vidí aktuální slide.' : 'Aktuální veřejný stav není potvrzený.'}</p></div>
        <label><input type="checkbox" checked={showEnabled} disabled={queueCount > 0 || Boolean(session.interimResults || session.finalReveal?.visible)} onChange={event => { stopShowAudio(); setShowEnabled(event.target.checked); }} /> SHOW MODE</label>
      </header>
      <p className="show-control-help">{showEnabled ? 'Šest týmů na stránce · ruční odhalování · pohyb lze kdykoli přeskočit.' : 'Klasické výsledky. SHOW MODE zapněte před potvrzením nové výsledkové verze.'} {publicState?.showCue?.motion === 'animate' ? 'Pro tento krok byl vydán animační pokyn; doběhnutí vzdáleného projektoru není potvrzené.' : 'Obraz je bez nového animačního pokynu.'}</p>
      {showEnabled && <ShowAudioPanel key={session.eventId} eventId={session.eventId} quizId={session.quizId} canUpload={can('quiz.media.upload')} canAttach={can('quiz.read')} canPlay={canPlayShowAudio} onController={connectAudio} onPreferencesChange={setShowPreferences} />}
      <div className="show-result-controls"><InterimResultsPanel key={session.sessionId} session={session} /><FinalRevealPanel key={session.sessionId} session={session} ending={pendingAction === 'end'} /></div>
    </section>}
    </SnapshotMediaContext.Provider>
    </ShowCommandContext.Provider>
  );
}
