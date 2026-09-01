export interface PreviewMedia {
  readonly role: string;
  readonly kind: string;
  readonly source: string;
}

export interface PreviewSlide {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly media: readonly PreviewMedia[];
  readonly correctAnswer?: string;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function PreviewMediaItem({ media }: { readonly media: PreviewMedia }) {
  const url = safeHttpUrl(media.source);
  if (media.kind === 'image' && url) {
    return <img className="projector-image" src={url} alt={media.role === 'answer' ? 'Obrázek odpovědi' : 'Médium ke slidu'} />;
  }
  return (
    <div className={`projector-media media-${media.kind}`}>
      <strong>{media.kind === 'audio' ? 'Audio' : media.kind === 'video' ? 'Video' : 'Médium'}</strong>
      {url ? <a href={url} target="_blank" rel="noreferrer">Otevřít bezpečný zdroj</a> : <span>{media.source}</span>}
    </div>
  );
}

export function SlidePreview({
  slide,
  quizTitle,
  position,
  showAnswer = false,
}: {
  readonly slide: PreviewSlide;
  readonly quizTitle: string;
  readonly position?: number;
  readonly showAnswer?: boolean;
}) {
  const isLegacy = slide.kind === 'pl' || slide.kind === 'legacy';
  const promptMedia = slide.media.filter((media) => media.role !== 'answer');
  const answerMedia = slide.media.filter((media) => media.role === 'answer');
  return (
    <article className="projector-stage preview-stage">
      <header className="projector-meta">
        <span>{position === undefined ? 'Náhled' : `Slide ${position}`}</span>
        <span>{isLegacy ? 'Legacy slide' : slide.kind}</span>
      </header>
      <p className="eyebrow">{quizTitle}</p>
      <h1>{slide.title || (isLegacy ? 'Legacy slide' : 'Filmový kvíz')}</h1>
      {slide.text && <p className="projector-prompt">{slide.text}</p>}
      {slide.options.length > 0 && (
        <ol className="projector-options">
          {slide.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}
        </ol>
      )}
      {promptMedia.length > 0 && (
        <div className="projector-media-grid">
          {promptMedia.map((media, index) => <PreviewMediaItem key={`${media.role}-${media.source}-${index}`} media={media} />)}
        </div>
      )}
      {showAnswer && (slide.correctAnswer || answerMedia.length > 0) && (
        <section className="projector-answer">
          <span>Správná odpověď — pouze admin náhled</span>
          {slide.correctAnswer && <strong>{slide.correctAnswer}</strong>}
          {answerMedia.map((media, index) => <PreviewMediaItem key={`${media.source}-${index}`} media={media} />)}
        </section>
      )}
    </article>
  );
}
