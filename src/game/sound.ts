/**
 * Tiny procedural sound effects (no audio assets) via Web Audio oscillators.
 * Browsers require a user gesture before audio can play, so call unlock()
 * from a click handler before anything else tries to make noise.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private muted = false;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private trainOsc: OscillatorNode | null = null;
  private trainOsc2: OscillatorNode | null = null;
  private trainGain: GainNode | null = null;

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    }
  }

  get isMuted() {
    return this.muted;
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.enabled = false;
        return null;
      }
      // Mobile browsers suspend the context when the tab/app is
      // backgrounded. Resuming from a bare visibilitychange handler isn't
      // a user gesture, so it isn't guaranteed to work everywhere, but it
      // costs nothing to try — the real fix is unlock() being called again
      // from the next actual tap (see input.ts touch controls).
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.ctx?.resume().catch(() => {});
      });
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
    if (this.muted) return;
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

  /** Railway crossing warning bell — a few alternating dings. */
  crossingBell() {
    for (let i = 0; i < 4; i++) {
      this.tone(950, 0.14, { type: "square", volume: 0.13, delay: i * 0.28 });
    }
  }

  /** Classic two-tone train horn. */
  trainHorn() {
    this.tone(196, 0.5, { type: "sawtooth", volume: 0.18 });
    this.tone(262, 0.5, { type: "sawtooth", volume: 0.14 });
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
    const volume = this.muted || clamped <= 0.02 ? 0.0001 : 0.04 + Math.min(clamped, 1) * 0.06;
    this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.12);
  }

  /** Starts a continuous rumble for as long as the train is on screen —
   * two slightly detuned low oscillators for a rolling-wheels texture,
   * rather than one pure tone. Call updateTrainRumble() every frame while
   * it's active to fade the volume with how close the train is. */
  startTrainRumble() {
    const ctx = this.ensure();
    if (!ctx || this.trainOsc) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 50;
    osc.connect(gain);
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 54;
    osc2.connect(gain);
    osc.start();
    osc2.start();
    this.trainOsc = osc;
    this.trainOsc2 = osc2;
    this.trainGain = gain;
  }

  /** intensity: 0..1, how present the train should sound right now. */
  updateTrainRumble(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.trainGain) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    const volume = this.muted ? 0.0001 : 0.07 * clamped;
    this.trainGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.15);
  }

  stopTrainRumble() {
    if (this.trainOsc) {
      try {
        this.trainOsc.stop();
        this.trainOsc2?.stop();
      } catch {
        /* already stopped */
      }
      this.trainOsc.disconnect();
      this.trainOsc2?.disconnect();
      this.trainGain?.disconnect();
    }
    this.trainOsc = null;
    this.trainOsc2 = null;
    this.trainGain = null;
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
