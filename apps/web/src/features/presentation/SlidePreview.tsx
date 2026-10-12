import { SlideRenderer } from './SlideRenderer';
import type { SlideMediaReference, SlidePresentationInput } from './types';

export type PreviewMedia = SlideMediaReference;

export interface PreviewSlide {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly media: readonly PreviewMedia[];
  readonly correctAnswer?: string;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly mediaSource?: string;
  readonly clipStartSeconds?: number | null;
  readonly clipEndSeconds?: number | null;
  readonly backgroundOverlay?: number | null;
  readonly presentation?: SlidePresentationInput;
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
  return (
    <div className="preview-stage" data-slide-position={position}>
      <SlideRenderer
        compact
        quizTitle={quizTitle}
        mode={showAnswer ? 'recap' : 'editorPreview'}
        slide={{
          ...slide,
          ...(showAnswer && slide.correctAnswer ? { revealedAnswer: slide.correctAnswer } : {}),
        }}
      />
    </div>
  );
}
