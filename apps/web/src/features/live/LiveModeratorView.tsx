import { Link } from 'react-router-dom';
import { visibleSlidePosition } from '@filmovy-kviz/quiz-domain';

import { SlideRenderer } from '../presentation/SlideRenderer';
import { ShowModeRenderer } from '../show-mode/ShowModeRenderer';
import '../events/event-navigation.css';
import { MediaPlayer } from '../presentation/MediaPlayer';
import { HumanError, type HumanErrorValue } from '../../ui/HumanError';
import { TechnicalDetails } from '../../ui/TechnicalDetails';
import {
  currentQuestionLabel,
  currentRoundLabel,
  humanSlideLabel,
  isAudioSlide,
  isIntroSlide,
  isMediaSlide,
  liveMediaSource,
  liveStatusLabel,
  type RecapQuestionChoice,
} from './livePresentation';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from './types';

export type LivePendingAction = 'previous' | 'next' | 'intro' | 'recap' | 'reveal' | 'hide' | 'play' | 'stop' | 'replay' | 'end' | 'show';

interface LiveModeratorViewProps {
  readonly session: LiveControlState;
  readonly publicState?: PublicLiveState | null;
  readonly slides: readonly LiveControlSlide[];
  readonly currentSlide?: LiveControlSlide;
  readonly presentedSlide?: LiveControlSlide;
  readonly recapChoices: readonly RecapQuestionChoice[];
  readonly pendingAction: LivePendingAction | null;
  readonly error: HumanErrorValue | null;
  readonly projectorOpened: boolean;
  readonly audioSuppressed?: boolean;
  readonly onOpenProjector: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onReveal?: () => void;
  readonly onHide?: () => void;
  readonly onStartIntro: () => void;
  readonly onSelectRecap: (position: number) => void;
  readonly onPlay: () => void;
  readonly onStop: () => void;
  readonly onReplay: () => void;
  readonly onEnd: () => void;
  readonly onMediaFinished: (generation: number) => void;
  readonly onMediaError: (generation: number, message: string) => void;
  readonly onMediaPlayback: (generation: number, state: 'ready' | 'playing') => void;
}

function pendingLabel(action: LivePendingAction | null, key: LivePendingAction, idle: string): string {
  if (action !== key) return idle;
  if (key === 'play' || key === 'replay' || key === 'intro') return 'Spouštím…';
  if (key === 'stop') return 'Zastavuji…';
  if (key === 'end') return 'Ukončuji…';
  if (key === 'reveal') return 'Odhaluji…';
  if (key === 'hide') return 'Skrývám…';
  return 'Přecházím…';
}

export function LiveModeratorView({
  session,
  publicState,
  slides,
  currentSlide,
  presentedSlide,
  recapChoices,
  pendingAction,
  error,
  projectorOpened,
  audioSuppressed = false,
  onOpenProjector,
  onPrevious,
  onNext,
  onReveal,
  onHide,
  onStartIntro,
  onSelectRecap,
  onPlay,
  onStop,
  onReplay,
  onEnd,
  onMediaFinished,
  onMediaError,
  onMediaPlayback,
}: LiveModeratorViewProps) {
  const pending = pendingAction !== null || session.interimResults !== undefined || session.finalReveal?.visible === true;
  const ended = session.status === 'ended';
  const source = session.interimResults || session.finalReveal?.visible ? undefined : liveMediaSource(presentedSlide);
  const roundLabel = currentRoundLabel(currentSlide);
  const questionLabel = currentQuestionLabel(session, currentSlide, presentedSlide, slides);
  const recapTitle = currentSlide?.roundTitle?.trim() || 'Aktuální kolo';
  const nextPosition = visibleSlidePosition(slides, session.currentSlidePosition, 1);
  const previousPosition = visibleSlidePosition(slides, session.currentSlidePosition, -1);
  const nextSlide = slides.find(slide => slide.position === nextPosition);
  const nextRecap = recapChoices.find(choice => choice.slide.position > (session.recapQuestionPosition ?? 0));
  const mediaLabels = { idle: 'Připraveno ke spuštění', preparing: 'Načítá se', ready: 'Připraveno', playing: 'Přehrává se', finished: 'Dohrálo', error: 'Přehrávání se nezdařilo' };

  return (
    <article
      className="live-control focused-live-shell"
      data-current-position={session.currentSlidePosition}
      data-presentation-mode={session.presentationMode}
    >
      <header className="focused-live-header">
        <Link className="live-back-link" to={session.eventId ? `/admin/events/${encodeURIComponent(session.eventId)}` : `/admin/quizzes/${encodeURIComponent(session.quizId)}`}>← Zpět na detail</Link>
        <div className="live-title-context">
          <span>{roundLabel}</span>
          <h1>{session.quizTitle}</h1>
        </div>
        <div className="live-progress" aria-label="Aktuální stav kvízu">
          <span>{liveStatusLabel(session.status)}</span>
          <strong>{questionLabel}</strong>
        </div>
        <div className="projector-pill" aria-label="Stav projektoru">
          <span>Projektor</span>
          <strong>{projectorOpened ? 'Okno bylo otevřeno' : 'Stav nelze ověřit'}</strong>
        </div>
      </header>

      {error && <HumanError error={error} />}
      {pendingAction && <p className="operation-status" role="status" aria-live="polite">{pendingLabel(pendingAction, pendingAction, '')}</p>}

      <section className="live-workspace">
        <section className="moderator-info-panel" aria-labelledby="moderator-info-title">
          <p className="panel-label" id="moderator-info-title">Soukromé · pouze pro moderátora</p>
          {presentedSlide?.isQuestion ? (
            <div className="moderator-answer" data-private-answer="true">
              <span>Správná odpověď</span>
              <strong>{presentedSlide.correctAnswer || 'Odpověď není textově dostupná'}</strong>
            </div>
          ) : (
            <p className="moderator-empty">Správná odpověď se zobrazí u otázky.</p>
          )}
          {presentedSlide?.moderatorNote && (
            <div className="moderator-note"><span>Poznámka moderátora</span><p>{presentedSlide.moderatorNote}</p></div>
          )}
          <div className="live-next-step"><span className="panel-label">Následuje</span><strong>{nextSlide ? humanSlideLabel(nextSlide) : 'Konec prezentace'}</strong><p>{nextSlide?.title || nextSlide?.text || 'Po posledním slidu můžete přejít k vyhlášení.'}</p></div>
          {session.eventId && <p><Link className="secondary-link" to={`/admin/events/${session.eventId}/scoring`} target="_blank" rel="noreferrer">Týmy a bodování ↗</Link></p>}
        </section>

        <aside className="live-actions" aria-label="Ovládání kvízu">
          <section className="projector-status-card">
            <div><span>Projektor</span><strong>{projectorOpened ? 'Okno bylo otevřeno' : 'Stav nelze ověřit'}</strong></div>
            <p>Připojení ani celou obrazovku současná verze neumí spolehlivě potvrdit.</p>
            <button className="secondary-button" type="button" onClick={onOpenProjector}>
              {projectorOpened ? 'Aktivovat okno' : 'Otevřít projektor'}
            </button>
          </section>

          <div className="live-button-row primary-live-controls">
            <button className="secondary-button" type="button" disabled={pending || ended || previousPosition === undefined} onClick={onPrevious}>
              {pendingLabel(pendingAction, 'previous', '← Předchozí')}
            </button>
            <button className="primary-button" type="button" disabled={pending || ended || nextPosition === undefined} onClick={onNext}>
              {pendingLabel(pendingAction, 'next', 'Další →')}
            </button>
          </div>

          {session.presentationMode === 'slide' && presentedSlide?.isQuestion && onReveal && onHide && (
            <button className="primary-button live-wide-action" type="button" disabled={pending || ended || !presentedSlide.correctAnswer} onClick={session.answerRevealed ? onHide : onReveal}>
              {session.answerRevealed ? pendingLabel(pendingAction, 'hide', 'Skrýt odpověď') : pendingLabel(pendingAction, 'reveal', 'Odhalit odpověď')}
            </button>
          )}

          {isIntroSlide(currentSlide) && (
            <button className="primary-button live-wide-action" type="button" disabled={pending || ended} onClick={onStartIntro}>
              {pendingLabel(pendingAction, 'intro', 'Spustit intro')}
            </button>
          )}

          {!session.interimResults && session.presentationMode === 'recap' && (
            <section className="recap-controls" aria-labelledby="recap-controls-title">
              <div><span className="panel-label">Rekapitulace</span><strong id="recap-controls-title">{recapTitle}</strong></div>
              <button className="primary-button live-wide-action" type="button" disabled={pending || ended || !nextRecap?.slide.correctAnswer} onClick={() => { if (nextRecap) onSelectRecap(nextRecap.slide.position); }}>Odhalit další odpověď</button>
              <div className="recap-question-buttons" aria-label="Otázky aktuálního kola">
                {recapChoices.map(({ localNumber, slide }) => (
                  <button
                    key={slide.id}
                    type="button"
                    className={slide.id === session.recapQuestionId ? 'selected' : ''}
                    aria-label={`Zobrazit odpověď na otázku ${localNumber}`}
                    aria-pressed={slide.id === session.recapQuestionId}
                    disabled={pending || !slide.correctAnswer}
                    onClick={() => onSelectRecap(slide.position)}
                  >{localNumber}</button>
                ))}
              </div>
              {recapChoices.length === 0 && <p className="field-help">Pro toto kolo nejsou dostupné otázky k rekapitulaci.</p>}
            </section>
          )}

          {isMediaSlide(presentedSlide) && presentedSlide && source && (
            <section className="media-controls" aria-labelledby="media-controls-title">
              <div>
                <span className="panel-label">Médium</span>
                <strong id="media-controls-title">{isAudioSlide(presentedSlide) && session.presentationMode === 'slide' ? 'Audio na tomto zařízení' : 'Ovládání přehrávání'}</strong>
                <p role="status">{mediaLabels[session.mediaPlaybackState]}</p>
              </div>
              <div className="media-button-row">
                <button className="primary-button" type="button" disabled={pending || ended} onClick={onPlay}>{pendingLabel(pendingAction, 'play', 'Play')}</button>
                <button className="secondary-button" type="button" disabled={pending || ended} onClick={onStop}>{pendingLabel(pendingAction, 'stop', 'Stop')}</button>
                <button className="secondary-button" type="button" disabled={pending || ended} onClick={onReplay}>{pendingLabel(pendingAction, 'replay', 'Pustit znovu')}</button>
              </div>
              <p className="youtube-limitation">Při přehrávání z YouTube se mohou zobrazit jeho vlastní prvky.</p>
              {isAudioSlide(presentedSlide) && session.presentationMode === 'slide' && !audioSuppressed && (
                <MediaPlayer
                  source={source}
                  command={session.mediaCommand}
                  generation={session.mediaGeneration}
                  startSeconds={presentedSlide.clipStartSeconds ?? presentedSlide.presentation.videoStart ?? 0}
                  endSeconds={presentedSlide.clipEndSeconds ?? presentedSlide.presentation.videoEnd ?? undefined}
                  className="youtube-player-shell moderator-audio-player"
                  onFinished={onMediaFinished}
                  onError={onMediaError}
                  onPlaybackState={onMediaPlayback}
                />
              )}
            </section>
          )}
          {isMediaSlide(presentedSlide) && !source && (
            <p className="media-warning" role="status">Médium nemá zdroj. Otázka zůstává zobrazená bez přehrávání.</p>
          )}

          <section className="live-danger-area" aria-labelledby="live-danger-title">
            <div><span className="panel-label">Ukončení</span><strong id="live-danger-title">Další možnosti</strong></div>
            <button className="danger-button" type="button" disabled={pendingAction !== null || ended} onClick={onEnd}>
              {pendingLabel(pendingAction, 'end', 'Ukončit kvíz')}
            </button>
          </section>

          <TechnicalDetails>
            <dl className="technical-data-list">
              <div><dt>Verze stavu</dt><dd>{session.revision}</dd></div>
              <div><dt>Interní pozice</dt><dd>{session.currentSlidePosition} / {session.slideCount}</dd></div>
              <div><dt>Typ obsahu</dt><dd>{humanSlideLabel(currentSlide)}</dd></div>
              <div><dt>Identifikátor relace</dt><dd>{session.sessionId}</dd></div>
            </dl>
          </TechnicalDetails>
        </aside>

        <details className="live-preview-panel" open>
          <summary>Co vidí projektor</summary>
          <div className="live-preview-stage">
            {session.status === 'waiting' ? (
              <div className="live-preview-message"><h2>Projektor čeká</h2><p>Tlačítkem Další zobrazíte první obsah.</p></div>
            ) : ended ? (
              <div className="live-preview-message"><h2>Kvíz byl ukončen</h2><p>Projektor zobrazuje závěrečný stav.</p></div>
            ) : publicState ? (
              <ShowModeRenderer state={publicState}>
              <SlideRenderer
                compact
                mediaSessionId={session.sessionId}
                quizTitle={publicState.quizTitle}
                mode={publicState.renderMode}
                mediaCommand="idle"
                slide={{
                  ...publicState,
                  kind: publicState.slideKind ?? 'info',
                  title: publicState.title ?? '',
                  text: publicState.text ?? '',
                }}
              />
              </ShowModeRenderer>
            ) : (
              <div className="live-preview-message" aria-live="polite"><p>Načítám obsah…</p></div>
            )}
          </div>
        </details>
      </section>
    </article>
  );
}
