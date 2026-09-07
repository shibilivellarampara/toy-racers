/**
 * Tiny procedural sound effects (no audio assets) via Web Audio oscillators.
 * Browsers require a user gesture before audio can play, so call unlock()
 * from a click handler before anything else tries to make noise.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  private tone(
    freq: number,
    duration: number,
    opts: { type?: OscillatorType; volume?: number; glideTo?: number; delay?: number } = {},
  ) {
    const ctx = this.ensure();
    if (!ctx) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, start + duration);
    gain.gain.setValueAtTime(opts.volume ?? 0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  countdownTick() {
    this.tone(440, 0.12, { type: "square", volume: 0.15 });
  }

  countdownGo() {
    this.tone(880, 0.28, { type: "square", volume: 0.2, glideTo: 1320 });
  }

  boost() {
    this.tone(220, 0.35, { type: "sawtooth", volume: 0.16, glideTo: 720 });
  }

  bump() {
    this.tone(140, 0.12, { type: "square", volume: 0.18, glideTo: 55 });
  }

  lap() {
    this.tone(660, 0.15, { type: "triangle", volume: 0.14 });
  }

  finish() {
    this.tone(523, 0.15, { type: "triangle", volume: 0.2 });
    this.tone(659, 0.15, { type: "triangle", volume: 0.2, delay: 0.15 });
    this.tone(784, 0.35, { type: "triangle", volume: 0.22, delay: 0.3 });
  }

  /** Starts a continuous engine drone; call updateEngine() every frame to track speed. */
  startEngine() {
    const ctx = this.ensure();
    if (!ctx || this.engineOsc) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 70;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.engineOsc = osc;
    this.engineGain = gain;
  }

  /** speedRatio: 0 (stopped) to ~1.6 (boosted top speed). */
  updateEngine(speedRatio: number) {
    const ctx = this.ctx;
    if (!ctx || !this.engineOsc || !this.engineGain) return;
    const clamped = Math.max(0, Math.min(1.6, speedRatio));
    const freq = 70 + clamped * 260;
    const volume = clamped > 0.02 ? 0.04 + Math.min(clamped, 1) * 0.06 : 0.0001;
    this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.12);
  }

  stopEngine() {
    if (this.engineOsc) {
      try {
        this.engineOsc.stop();
      } catch {
        /* already stopped */
      }
      this.engineOsc.disconnect();
      this.engineGain?.disconnect();
    }
    this.engineOsc = null;
    this.engineGain = null;
  }
}

export const sound = new SoundEngine();
