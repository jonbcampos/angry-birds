/**
 * All sound in the game, synthesized at runtime. No audio files.
 *
 * Structure inherited from the siblings: the AudioContext is created on the
 * first gesture, and every play checks for and resumes a suspended context.
 *
 * What's new here is that **impacts are scaled by how hard they were**. A
 * physics game makes hundreds of contacts a second during a collapse, and if
 * they all play at the same volume the result is a wall of noise that says
 * nothing. Volume follows the impact energy, and main.ts caps how many impact
 * sounds can start per frame, so a big hit is loud and a settling block is a
 * tick — and you can hear the difference between the two from across the room.
 *
 * Materials have voices: wood knocks, glass tinkles, stone thuds. That is
 * information, not decoration: after a few shots, she can hear what the toy
 * hit without looking.
 */

export type Sfx =
  | 'select'
  | 'deny'
  | 'stretch'
  | 'launch'
  | 'hit-wood'
  | 'hit-glass'
  | 'hit-stone'
  | 'hit-ground'
  | 'break-wood'
  | 'break-glass'
  | 'break-stone'
  | 'bonk'
  | 'pop'
  | 'boom'
  | 'split'
  | 'boost'
  | 'slam'
  | 'win'
  | 'lose'
  | 'nyah'
  | 'raspberry'
  | 'giggle'
  | 'ellie-giggle';

/** The three kinds of toot. Picked at random by the caller so it never sounds like a loop. */
export type TootKind = 'pfft' | 'rumble' | 'squeak';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.01);
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * A raccoon tooting. `pitch` scales every frequency: 1 for an ordinary
   * bandit, lower for a bigger one, so the boss rumbles.
   *
   * The recipe is a buzzy low sawtooth through a low-pass filter, with its
   * volume flapped at 18-35Hz by a second oscillator. The flap is what makes it
   * read as a toot rather than a hum. The pitch wanders on a random curve so no
   * two are alike, and the three kinds differ in length, pitch and direction.
   */
  toot(kind: TootKind, pitch = 1, level = 1): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    if (kind === 'pfft') {
      // Just air: short filtered noise, flapped.
      this.flapped(t, 0.22, 0.32 * level, 0, 0, 900 * pitch, 26, true);
      return;
    }
    const dur = kind === 'rumble' ? 0.55 + Math.random() * 0.35 : 0.35 + Math.random() * 0.2;
    const base = (kind === 'rumble' ? 70 + Math.random() * 25 : 190 + Math.random() * 40) * pitch;
    const end = kind === 'squeak' ? base * 1.5 : base * 0.8;
    this.flapped(t, dur, 0.38 * level, base, end, (kind === 'rumble' ? 520 : 1300) * pitch, kind === 'rumble' ? 19 : 32, false);
  }

  /**
   * A burp: a sawtooth sliding down through two wobbling "mouth" filters,
   * which is roughly what a voice is. Sometimes a little hic at the end.
   */
  burp(pitch = 1, level = 1): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const dur = 0.45 + Math.random() * 0.25;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(125 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(72 * pitch, t + dur);
    // Vibrato: a slow wobble on the pitch.
    const vib = ctx.createOscillator();
    vib.frequency.value = 11;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 9 * pitch;
    vib.connect(vibDepth);
    vibDepth.connect(osc.frequency);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.45 * level, t + 0.04);
    env.gain.setValueAtTime(0.45 * level, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [hz, q] of [
      [480, 4],
      [1100, 6],
    ] as const) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(hz * pitch, t);
      f.frequency.linearRampToValueAtTime(hz * pitch * 0.75, t + dur);
      osc.connect(f);
      f.connect(env);
    }
    env.connect(this.master);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
    if (Math.random() < 0.4) this.tone('square', 900 * pitch, 1300 * pitch, t + dur + 0.08, 0.06, 0.07);
  }

  /** `level` 0..1 scales the volume; impacts pass their energy through it. */
  play(sfx: Sfx, level = 1): void {
    if (this.muted || !this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    const v = Math.max(0.05, Math.min(1, level));
    // A little pitch wobble so a dozen identical knocks don't sound like a machine.
    const p = 0.92 + Math.random() * 0.16;

    switch (sfx) {
      case 'select':
        this.tone('square', 520, 760, t, 0.06, 0.1);
        break;
      case 'deny':
        this.tone('square', 200, 130, t, 0.11, 0.14);
        break;
      case 'stretch':
        // The band creaking back.
        this.tone('sawtooth', 110, 190, t, 0.28, 0.05);
        break;
      case 'launch':
        this.noise(t, 0.25, 0.14 * v, 700, 2600);
        this.tone('sine', 260, 520, t, 0.14, 0.18 * v);
        break;
      case 'hit-wood':
        this.tone('sine', 300 * p, 160 * p, t, 0.09, 0.22 * v);
        this.noise(t, 0.05, 0.12 * v, 900 * p, 500);
        break;
      case 'hit-glass':
        this.tone('triangle', 2200 * p, 2000 * p, t, 0.08, 0.1 * v);
        this.tone('triangle', 3100 * p, 2900 * p, t + 0.02, 0.07, 0.07 * v);
        break;
      case 'hit-stone':
        this.tone('sine', 140 * p, 80 * p, t, 0.12, 0.3 * v);
        this.noise(t, 0.07, 0.12 * v, 400 * p, 200);
        break;
      case 'hit-ground':
        this.tone('sine', 110 * p, 60, t, 0.1, 0.22 * v);
        this.noise(t, 0.06, 0.08 * v, 300);
        break;
      case 'break-wood':
        // A crack: bright noise snapping down, with a woody knock under it.
        this.noise(t, 0.16, 0.22 * v, 2400 * p, 500);
        this.tone('square', 190 * p, 90, t, 0.1, 0.1 * v);
        break;
      case 'break-glass': {
        // A cascade of tinkles, each a little later and a little higher.
        this.noise(t, 0.2, 0.12 * v, 5200, 3000);
        for (let i = 0; i < 5; i++) {
          const f = (1800 + Math.random() * 2400) * p;
          this.tone('triangle', f, f * 0.95, t + i * 0.035, 0.12, 0.07 * v);
        }
        break;
      }
      case 'break-stone':
        this.noise(t, 0.35, 0.28 * v, 600 * p, 120);
        this.tone('sine', 100 * p, 50, t, 0.25, 0.25 * v);
        break;
      case 'bonk':
        // A raccoon's surprised "eep!" and a cartoon boing. Nobody's hurt.
        this.tone('square', 900, 1500, t, 0.08, 0.1);
        this.tone('square', 1500, 1100, t + 0.08, 0.08, 0.08);
        this.tone('sine', 300, 700, t + 0.05, 0.22, 0.16);
        break;
      case 'pop':
        this.noise(t, 0.3, 0.35, 1600, 300);
        this.tone('sine', 160, 50, t, 0.3, 0.3);
        for (let i = 0; i < 6; i++) {
          const f = 1200 + Math.random() * 2000;
          this.tone('triangle', f, f, t + 0.08 + i * 0.04, 0.06, 0.05);
        }
        break;
      case 'boom': {
        // The biggest sound in the game, built in three layers:
        //  - a thump: a sine diving from 150Hz into the subsonic
        //  - a rumble: low-passed noise that rolls on for a second
        //  - a crackle: little bright snaps scattered through the tail
        // Each blast in a chain is pitched slightly differently, so a chain
        // sounds like several things going off rather than one sound looping.
        const k = 0.85 + Math.random() * 0.3;
        this.tone('sine', 150 * k, 28, t, 0.9, 0.7);
        this.tone('triangle', 90 * k, 35, t, 0.5, 0.35);
        this.noise(t, 1.1, 0.75, 900 * k, 90, 'lowpass');
        this.noise(t, 0.12, 0.5, 2500, 800);
        for (let i = 0; i < 9; i++) {
          this.noise(t + 0.08 + Math.random() * 0.6, 0.03, 0.12 + Math.random() * 0.1, 3000 + Math.random() * 3000);
        }
        break;
      }
      case 'split':
        // Three quacks, quickly.
        for (let i = 0; i < 3; i++) this.tone('sawtooth', 520 - i * 40, 380 - i * 40, t + i * 0.05, 0.06, 0.08);
        break;
      case 'boost':
        this.noise(t, 0.45, 0.2, 500, 3000);
        this.tone('sawtooth', 200, 900, t, 0.35, 0.08);
        break;
      case 'slam':
        this.tone('square', 900, 200, t, 0.25, 0.1);
        this.noise(t, 0.2, 0.1, 1200, 400);
        break;
      case 'win':
        this.tone('triangle', 660, 660, t, 0.11, 0.2);
        this.tone('triangle', 880, 880, t + 0.12, 0.11, 0.2);
        this.tone('triangle', 1320, 1320, t + 0.24, 0.4, 0.22);
        break;
      case 'nyah': {
        // The playground tune: sol-mi-la-sol-mi.
        const notes = [784, 659, 880, 784, 659];
        notes.forEach((hz, i) => this.tone('square', hz, hz, t + i * 0.13, 0.11, 0.07));
        break;
      }
      case 'raspberry':
        // Lips flapping: low noise and a low buzz, flapped fast.
        this.flapped(t, 0.5, 0.3, 95, 85, 700, 38, false);
        this.flapped(t, 0.5, 0.2, 0, 0, 600, 38, true);
        break;
      case 'giggle':
        for (let i = 0; i < 4; i++) {
          const hz = 820 + i * 60 + Math.random() * 80;
          this.tone('triangle', hz, hz * 1.35, t + i * 0.085, 0.06, 0.1);
        }
        break;
      case 'ellie-giggle':
        // Higher and quicker than a raccoon's.
        for (let i = 0; i < 5; i++) {
          const hz = 1300 + (i % 2) * 180 + Math.random() * 60;
          this.tone('sine', hz, hz * 1.25, t + i * 0.07, 0.05, 0.09);
        }
        break;
      case 'lose':
        // Gentle, not sad: "try again", not "you failed".
        this.tone('triangle', 520, 440, t, 0.2, 0.16);
        this.tone('triangle', 440, 350, t + 0.2, 0.32, 0.14);
        break;
    }
  }

  /**
   * A flapped sound: a sawtooth (or noise) through a low-pass filter, with its
   * volume pumped by a second oscillator at `flapHz`. The building block for
   * toots and raspberries.
   */
  private flapped(
    start: number,
    duration: number,
    peak: number,
    fromHz: number,
    toHz: number,
    cutoff: number,
    flapHz: number,
    noise: boolean,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    let source: AudioScheduledSourceNode;
    if (noise) {
      if (!this.noiseBuffer) return;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      source = n;
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      // A random wander between the two pitches, not a straight line.
      const curve = new Float32Array(8);
      for (let i = 0; i < curve.length; i++) {
        const k = i / (curve.length - 1);
        curve[i] = (fromHz + (toHz - fromHz) * k) * (0.9 + Math.random() * 0.2);
      }
      osc.frequency.setValueCurveAtTime(curve, start, duration);
      source = osc;
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 2;

    // The flap: an LFO swinging the gain between about 0.15 and 1.
    const flap = ctx.createGain();
    flap.gain.value = 0.58;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(flapHz, start);
    lfo.frequency.linearRampToValueAtTime(flapHz * 0.8, start + duration);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.42;
    lfo.connect(lfoDepth);
    lfoDepth.connect(flap.gain);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.02);
    env.gain.setValueAtTime(Math.max(0.0002, peak), start + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(flap);
    flap.connect(env);
    env.connect(master);
    source.start(start);
    lfo.start(start);
    source.stop(start + duration + 0.05);
    lfo.stop(start + duration + 0.05);
  }

  private tone(type: OscillatorType, fromHz: number, toHz: number, start: number, duration: number, peak: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, start);
    if (toHz !== fromHz) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noise(
    start: number,
    duration: number,
    peak: number,
    filterFrom: number,
    filterTo?: number,
    filterType: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrom, start);
    if (filterTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterTo), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, peak), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private createNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
