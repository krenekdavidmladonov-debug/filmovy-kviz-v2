export type FanfareStatus = 'idle' | 'playing' | 'blocked';
/** Local to one mounted moderator panel. No snapshot/channel effect can start sound. */
export class Fanfare {
  private context?: AudioContext;
  private nodes: OscillatorNode[] = [];
  private gain?: GainNode;
  private generation = 0;
  private volume = .12;
  private muted = false;
  private completed = new Set<string>();
  constructor(private readonly changed: (status: FanfareStatus) => void) {}
  prepare(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch { /* The explicit manual play remains available after a denied gesture. */ }
  }
  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(.3, volume)); this.muted = muted;
    if (this.context && this.gain) this.gain.gain.setValueAtTime(muted ? 0 : this.volume, this.context.currentTime);
  }
  stop(): void {
    this.generation++;
    for (const node of this.nodes) { node.onended = null; try { node.stop(); } catch { /* Already ended. */ } node.disconnect(); }
    this.nodes = []; this.gain?.disconnect(); this.gain = undefined; this.changed('idle');
  }
  async play(key: string, allowed: () => boolean): Promise<void> {
    if (this.completed.has(key) || !allowed()) return;
    this.completed.add(key); // A failed automatic attempt also requires a new, explicit gesture.
    this.stop();
    const generation = this.generation;
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      if (generation !== this.generation || !allowed()) return;
      if (this.context.state !== 'running') throw new Error('Audio not running');
      const ctx = this.context, gain = ctx.createGain(); this.gain = gain;
      gain.gain.value = this.muted ? 0 : this.volume; gain.connect(ctx.destination);
      // Original short major triad motif, synthesized locally; no external media.
      const notes = [392, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
      notes.forEach((frequency, i) => {
        const tone = ctx.createOscillator(), envelope = ctx.createGain(), start = ctx.currentTime + .03 + i * .23;
        tone.type = 'triangle'; tone.frequency.value = frequency;
        envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(.65, start + .025);
        envelope.gain.exponentialRampToValueAtTime(.001, start + (i === notes.length - 1 ? .8 : .21));
        tone.connect(envelope); envelope.connect(gain); this.nodes.push(tone);
        tone.onended = () => { tone.disconnect(); envelope.disconnect(); if (i === notes.length - 1 && generation === this.generation) this.stop(); };
        tone.start(start); tone.stop(start + (i === notes.length - 1 ? .85 : .23));
      });
      this.changed('playing'); // Only after running context and accepted scheduling.
    } catch { if (generation === this.generation) { this.stop(); this.changed('blocked'); } }
  }
  dispose(): void { this.stop(); void this.context?.close().catch(() => undefined); this.context = undefined; }
}
