import type { ShowAudioCue, ShowPreferences } from '@filmovy-kviz/quiz-domain';

export type ShowAudioStatus = 'idle' | 'loading' | 'playing' | 'blocked' | 'error';
export interface ShowAudioState { status: ShowAudioStatus; message?: string; cue?: ShowAudioCue }
export interface ShowAudioDependencies {
  preferences: () => ShowPreferences;
  read: (reference: string, signal: AbortSignal) => Promise<Blob>;
  changed: (state: ShowAudioState) => void;
  context?: () => AudioContext;
  allowed?: () => boolean;
}
/** One local moderator output. No listener, snapshot, mount or retry starts audio. */
export class ShowAudioController {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private abort?: AbortController;
  private epoch = 0;
  private consumed = -1;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly dependencies: ShowAudioDependencies) {}
  private getContext(): AudioContext {
    if (!this.context) {
      this.context = this.dependencies.context?.() ?? new AudioContext();
      this.context.onstatechange = () => {
        if (!this.disposed && this.source && this.context?.state !== 'running') {
          this.stopImmediate();
          this.dependencies.changed({ status: 'blocked', message: 'Zvukový výstup byl přerušen. Použijte nové ruční přehrání.' });
        }
      };
    }
    return this.context;
  }
  private outputVolume(): number {
    const p = this.dependencies.preferences();
    return p.audioEnabled ? Math.max(0, Math.min(1, p.volume)) : 0;
  }
  private release() {
    clearTimeout(this.timer); this.timer = undefined;
    this.abort?.abort(); this.abort = undefined;
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* Already ended. */ }
      this.source.disconnect(); this.source = undefined;
    }
    this.gain?.disconnect(); this.gain = undefined;
  }
  stopImmediate = (): void => {
    this.epoch++; this.release();
    this.dependencies.changed({ status: 'idle' });
  };
  /** Call synchronously inside the initiating click, before waiting for a server command. */
  prepareGesture = (): number => {
    this.stopImmediate();
    if (this.disposed) return this.epoch;
    try {
      void this.getContext().resume().catch(() => undefined);
    } catch { /* playCue exposes a manual retry if the browser blocks audio. */ }
    return this.epoch;
  };
  updateVolume = (): void => {
    if (this.context && this.gain) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(this.outputVolume(), this.context.currentTime);
    }
  };
  /** STOP invalidates a token captured before a late callable/download/decode response. */
  playCue = async (cue: ShowAudioCue, token: number, allowed: () => boolean = () => true): Promise<void> => {
    if (this.disposed || token !== this.epoch || this.consumed === token || !allowed() || this.dependencies.allowed?.() === false) return;
    this.consumed = token;
    const p = this.dependencies.preferences(), reference = p.cues[cue];
    if (!p.audioEnabled || p.volume <= 0 || !reference) return;
    this.release();
    const active = () => !this.disposed && token === this.epoch && allowed() && this.dependencies.allowed?.() !== false
      && this.dependencies.preferences().audioEnabled && this.dependencies.preferences().cues[cue] === reference;
    const abort = new AbortController(); this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 30000);
    this.dependencies.changed({ status: 'loading', cue });
    try {
      const ctx = this.getContext();
      await ctx.resume();
      if (!active()) return;
      const blob = await this.dependencies.read(reference, abort.signal);
      if (!active() || abort.signal.aborted) return;
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (!active() || abort.signal.aborted) return;
      if (ctx.state !== 'running') throw new DOMException('Zvuk čeká na ruční povolení prohlížeče.', 'NotAllowedError');
      const gain = ctx.createGain(), source = ctx.createBufferSource();
      this.gain = gain; this.source = source; source.buffer = buffer; source.loop = false;
      const now = ctx.currentTime, latest = this.dependencies.preferences(), volume = this.outputVolume();
      gain.gain.setValueAtTime(latest.fadeInMs ? 0 : volume, now);
      if (latest.fadeInMs) gain.gain.linearRampToValueAtTime(volume, now + latest.fadeInMs / 1000);
      source.connect(gain); gain.connect(ctx.destination);
      source.onended = () => { if (token === this.epoch) this.stopImmediate(); };
      source.start();
      this.dependencies.changed({ status: 'playing', cue });
    } catch (error) {
      if (active()) {
        this.release();
        const blocked = error instanceof Error && error.name === 'NotAllowedError';
        this.dependencies.changed({ status: blocked ? 'blocked' : 'error', cue,
          message: blocked ? 'Prohlížeč zvuk nepovolil. Použijte ruční přehrání.' : 'Zvuk nelze načíst nebo dekódovat. Ověřte soubor a přístup, pak zkuste ruční přehrání.' });
      }
    } finally {
      clearTimeout(timeout);
      if (token === this.epoch && !active()) this.stopImmediate();
    }
  };
  stop = (): void => {
    if (!this.context || !this.source || !this.gain) { this.stopImmediate(); return; }
    // Invalidate pending work immediately; only the already playing output fades out.
    const token = ++this.epoch, milliseconds = this.dependencies.preferences().fadeOutMs;
    this.abort?.abort(); this.abort = undefined;
    if (!milliseconds) { this.stopImmediate(); return; }
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.setValueAtTime(this.gain.gain.value, this.context.currentTime);
    this.gain.gain.linearRampToValueAtTime(0, this.context.currentTime + milliseconds / 1000);
    this.timer = setTimeout(() => { if (token === this.epoch) this.stopImmediate(); }, milliseconds);
  };
  dispose = (): void => {
    this.disposed = true; this.stopImmediate();
    void this.context?.close().catch(() => undefined); this.context = undefined;
  };
}
