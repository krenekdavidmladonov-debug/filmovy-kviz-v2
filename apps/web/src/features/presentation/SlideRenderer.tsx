import { useMemo, useState } from 'react';

import { productConfig } from '../../config/product';
import { buildSlideRenderModel, defaultRules, formatPlAnswer, isSafeHttpUrl, projectorMediaPlan } from './model';
import type { MediaPlaybackCommand, MediaPlaybackState, SlideRenderInput, SlideRenderMode } from './types';
import { YouTubePlayer } from './YouTubePlayer';

function QuestionHeader({ number, count, legacyPl }: { readonly number?: number; readonly count?: number; readonly legacyPl: boolean }) {
  return (
    <div className="slide-question-label">
      <span>{number !== undefined && count !== undefined ? `OTÁZKA ${number} / ${count}` : 'OTÁZKA'}</span>
      {legacyPl && <span className="legacy-pl-badge">PŮVODNÍ · PRAVDA / LEŽ</span>}
    </div>
  );
}

function Options({ options }: { readonly options: readonly string[] }) {
  if (options.length === 0) return null;
  return (
    <ol className={`slide-options options-${Math.min(options.length, 6)}`}>
      {options.map((option, index) => (
        <li key={`${index}-${option}`}><span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong></li>
      ))}
    </ol>
  );
}

function AgendaItems({ items }: { readonly items: readonly string[] }) {
  return (
    <ol className="agenda-items">
      {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
    </ol>
  );
}

function QuestionImage({ source, overlay }: { readonly source: string; readonly overlay: number }) {
  return (
    <div className="question-image-frame">
      <img src={source} alt="Obrázek k otázce" />
      <span className="question-image-overlay" style={{ opacity: overlay / 100 }} aria-hidden="true" />
    </div>
  );
}

function QuestionCopy({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className="slide-copy">
      {title && <h1>{title}</h1>}
      {text && <p>{text}</p>}
    </div>
  );
}

export function SlideRenderer({
  slide,
  quizTitle,
  mode,
  mediaCommand = 'idle',
  mediaPlaybackState = 'idle',
  mediaGeneration = 0,
  introGeneration = 0,
  compact = false,
  onMediaFinished,
  onMediaPlaybackState,
}: {
  readonly slide: SlideRenderInput;
  readonly quizTitle: string;
  readonly mode?: SlideRenderMode;
  readonly mediaCommand?: MediaPlaybackCommand;
  readonly mediaPlaybackState?: MediaPlaybackState;
  readonly mediaGeneration?: number;
  readonly introGeneration?: number;
  readonly compact?: boolean;
  readonly onMediaFinished?: (generation: number) => void;
  readonly onMediaPlaybackState?: (
    generation: number,
    state: Extract<MediaPlaybackState, 'ready' | 'playing' | 'error'>,
    message?: string,
  ) => void;
}) {
  const model = useMemo(() => buildSlideRenderModel(slide, mode), [mode, slide]);
  const [locallyFinishedGeneration, setLocallyFinishedGeneration] = useState<number>();
  const [locallyFailed, setLocallyFailed] = useState<{ readonly generation: number; readonly source?: string }>();
  const mediaFinished = mediaCommand === 'finished' || locallyFinishedGeneration === mediaGeneration;
  const mediaFailed = mediaCommand === 'error'
    || (locallyFailed?.generation === mediaGeneration && locallyFailed.source === model.mediaSource);
  const mediaPlan = projectorMediaPlan(model, mediaCommand, mediaPlaybackState, mediaFinished, mediaFailed);
  const backgroundStyle = model.backgroundImage && isSafeHttpUrl(model.backgroundImage)
    ? { backgroundImage: `url("${model.backgroundImage.replaceAll('"', '%22')}")` }
    : undefined;
  const showAnswer = model.renderMode === 'recap' && model.revealedAnswer !== undefined;
  const displayedAnswer = model.isLegacyPl && model.revealedAnswer !== undefined
    ? formatPlAnswer(model.revealedAnswer)
    : model.revealedAnswer;
  const visibleMode = model.renderMode === 'editorPreview' ? 'editorPreview' : model.renderMode;
  const finish = (generation: number) => {
    if (generation !== mediaGeneration) return;
    setLocallyFinishedGeneration(generation);
    onMediaFinished?.(generation);
  };
  const fail = (generation: number, message: string) => {
    if (generation !== mediaGeneration) return;
    setLocallyFailed({ generation, ...(model.mediaSource === undefined ? {} : { source: model.mediaSource }) });
    onMediaPlaybackState?.(generation, 'error', message);
  };
  const playback = (generation: number, state: Extract<MediaPlaybackState, 'ready' | 'playing'>) => {
    if (generation !== mediaGeneration) return;
    onMediaPlaybackState?.(generation, state);
  };

  let content;
  if (model.renderMode === 'recap' && model.contentKind === 'recap') {
    content = <div className="slide-centered"><p className="slide-kicker">REKAPITULACE KOLA</p><h1>{model.title || 'Vyberte otázku'}</h1><p>{model.text || 'Moderátor postupně zobrazí vybrané odpovědi.'}</p></div>;
  } else if (model.renderMode === 'recap') {
    const recapMedia = model.contentKind === 'audio' || model.contentKind === 'video';
    content = (
      <div className={`slide-layout recap-layout recap-${model.contentKind}`}>
        <QuestionHeader number={model.questionNumber} count={model.questionCount} legacyPl={model.isLegacyPl} />
        <QuestionCopy title={model.title} text={model.text} />
        {model.contentKind === 'image' && model.questionImage && isSafeHttpUrl(model.questionImage) && (
          <QuestionImage source={model.questionImage} overlay={model.backgroundOverlay} />
        )}
        {recapMedia && model.mediaSource && mediaPlan.mountPlayer && (
          <YouTubePlayer
            source={model.mediaSource}
            command={mediaCommand}
            generation={mediaGeneration}
            startSeconds={mediaPlan.startSeconds}
            className="youtube-player-shell recap-player"
            onFinished={finish}
            onError={fail}
            onPlaybackState={playback}
          />
        )}
        {showAnswer && (
          <section className="slide-answer">
            <span>SPRÁVNÁ ODPOVĚĎ</span>
            <strong>{displayedAnswer}</strong>
            {model.answerImage && isSafeHttpUrl(model.answerImage) && <img src={model.answerImage} alt="Obrázek odpovědi" />}
          </section>
        )}
      </div>
    );
  } else if (model.contentKind === 'agenda') {
    content = <div className="slide-centered slide-list"><p className="slide-kicker">PROGRAM VEČERA</p><h1>{model.title || 'Dnešní kola'}</h1><AgendaItems items={model.options} /></div>;
  } else if (model.contentKind === 'rules') {
    content = <div className="slide-centered slide-list"><p className="slide-kicker">PRAVIDLA</p><h1>{model.title || 'Hrajeme fér'}</h1><Options options={model.options.length > 0 ? model.options : defaultRules} /></div>;
  } else if (model.contentKind === 'intro' || model.contentKind === 'roundIntro') {
    content = <div key={introGeneration} className={`slide-centered round-intro-content ${introGeneration > 0 ? 'intro-running' : ''}`}><p className="slide-kicker">{model.contentKind === 'intro' ? productConfig.name : 'NOVÉ KOLO'}</p><h1>{model.title || quizTitle}</h1>{model.text && <p>{model.text}</p>}</div>;
  } else if (model.contentKind === 'end') {
    content = <div className="slide-centered"><p className="slide-kicker">DĚKUJEME</p><h1>{model.title || 'To je pro dnešek vše'}</h1>{model.text && <p>{model.text}</p>}</div>;
  } else if (model.contentKind === 'audio') {
    content = (
      <div className="slide-layout audio-layout">
        <QuestionHeader number={model.questionNumber} count={model.questionCount} legacyPl={false} />
        <QuestionCopy title={model.title} text={model.text} />
          <div className={`vinyl-visual ${mediaPlan.vinylPlaying ? 'is-playing' : ''}`} aria-label={mediaPlan.vinylPlaying ? 'Audio se přehrává' : 'Audio je připravené'}>
          <div className="vinyl-disc"><div className="vinyl-label">{productConfig.shortName}</div></div><div className="vinyl-arm" />
          <span>{mediaPlan.vinylPlaying ? 'PŘEHRÁVÁ SE AUDIO' : mediaFinished ? 'AUDIO DOHRÁLO' : 'AUDIO OTÁZKA'}</span>
        </div>
      </div>
    );
  } else if (model.contentKind === 'video' && mediaPlan.mountPlayer && model.mediaSource) {
    content = (
      <div className="video-presentation">
        <YouTubePlayer
          source={model.mediaSource}
          command={mediaCommand}
          generation={mediaGeneration}
          startSeconds={mediaPlan.startSeconds}
          endSeconds={mediaPlan.endSeconds}
          className="youtube-player-shell projector-video-player"
          onFinished={finish}
          onError={fail}
          onPlaybackState={playback}
        />
      </div>
    );
  } else {
    content = (
      <div className={`slide-layout question-layout question-${model.contentKind}`}>
        {model.isQuestionLike && <QuestionHeader number={model.questionNumber} count={model.questionCount} legacyPl={model.isLegacyPl} />}
        <QuestionCopy title={model.title || (model.contentKind === 'legacy' ? 'Legacy slide' : '')} text={model.text} />
        {model.contentKind === 'image' && model.questionImage && isSafeHttpUrl(model.questionImage) && (
          <QuestionImage source={model.questionImage} overlay={model.backgroundOverlay} />
        )}
        <Options options={model.contentKind === 'free' ? [] : model.options} />
      </div>
    );
  }

  return (
    <article className={`slide-renderer mode-${visibleMode} kind-${model.contentKind}${compact ? ' is-compact' : ''}`}>
      <div className="slide-background" style={backgroundStyle} aria-hidden="true" />
      <div className="slide-background-overlay" style={{ opacity: model.backgroundOverlay / 100 }} aria-hidden="true" />
      <div className="slide-safe-area">
        <header className="slide-brand"><span>{quizTitle}</span><span>{productConfig.name}</span></header>
        {content}
      </div>
    </article>
  );
}
