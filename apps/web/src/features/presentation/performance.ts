export interface SlidePositioned { readonly position: number }

export interface IndexedSlides<T extends SlidePositioned> {
  readonly size: number;
  readonly get: (position: number) => T | undefined;
  readonly inspectedPerLookup: 1;
}

export function indexSlidesByPosition<T extends SlidePositioned>(slides: readonly T[]): IndexedSlides<T> {
  const index = new Map<number, T>();
  for (const slide of slides) {
    if (!Number.isInteger(slide.position) || slide.position < 1 || index.has(slide.position)) {
      throw new Error('Slide positions must be positive and unique.');
    }
    index.set(slide.position, slide);
  }
  return { size: index.size, get: (position) => index.get(position), inspectedPerLookup: 1 };
}

export interface MediaLifecycleDiagnostics {
  activePlayers: number;
  peakPlayers: number;
  createdPlayers: number;
  destroyedPlayers: number;
}

export function recordPlayerLifecycle(diagnostics: MediaLifecycleDiagnostics, delta: 1 | -1): void {
  diagnostics.activePlayers += delta;
  diagnostics.peakPlayers = Math.max(diagnostics.peakPlayers, diagnostics.activePlayers);
  if (delta === 1) diagnostics.createdPlayers += 1;
  else diagnostics.destroyedPlayers += 1;
  if (diagnostics.activePlayers < 0) throw new Error('Player lifecycle is unbalanced.');
  if (diagnostics.activePlayers > 1) throw new Error('Projector heavy-player budget exceeded.');
}
