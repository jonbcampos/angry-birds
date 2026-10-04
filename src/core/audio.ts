import { synth, type SfxKind } from './sfx';

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

/** Music sits well under everything else: the game's sounds are the information. */
const MUSIC_LEVEL = 0.22;
const MUSIC_FADE = 1.2;
const LOOP_XFADE = 1.5;

/** Which effects come from the sample-level synth in sfx.ts, and how much reverb each gets. */
const SYNTH_SFX: Partial<Record<Sfx, { kind: SfxKind; reverb: number; gain: number }>> = {
  'hit-wood': { kind: 'hit-wood', reverb: 0.12, gain: 0.55 },
  'hit-glass': { kind: 'hit-glass', reverb: 0.25, gain: 0.35 },
  'hit-stone': { kind: 'hit-stone', reverb: 0.12, gain: 0.6 },
  'hit-ground': { kind: 'hit-ground', reverb: 0.08, gain: 0.55 },
  'break-wood': { kind: 'break-wood', reverb: 0.2, gain: 0.7 },
  'break-glass': { kind: 'break-glass', reverb: 0.3, gain: 0.55 },
  'break-stone': { kind: 'break-stone', reverb: 0.2, gain: 0.7 },
  bonk: { kind: 'bonk', reverb: 0.15, gain: 0.5 },
  // 'launch' is deliberately NOT here: the synthesised rubber-band twang was
  // judged worse than the original whoosh, which stays (see play()).
  stretch: { kind: 'stretch', reverb: 0.05, gain: 0.35 },
  boom: { kind: 'boom', reverb: 0.45, gain: 1 },
  pop: { kind: 'pop', reverb: 0.35, gain: 0.7 },
};
const VARIANTS = 3;

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
      // Everything goes through a compressor, so a chain of blasts stays punchy
      // instead of clipping, and quiet things (a glass clink) still come through.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      // A shared outdoor reverb: short, soft and a little dark, so every sound
      // sits in the same open space.
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.makeReverb(this.ctx);
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.9;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(comp);
      this.noiseBuffer = this.createNoise(this.ctx);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = MUSIC_LEVEL;
      this.musicBus.connect(this.master);
      this.decodeAll();
      // Build each effect's first variant now, a few milliseconds apart, so the
      // first explosion doesn't hitch while it's being synthesised.
      const kinds = Object.values(SYNTH_SFX).map((v) => v!.kind);
      kinds.forEach((kind, i) =>
        setTimeout(() => {
          const ctx = this.ctx;
          if (!ctx || (this.sfx.get(kind)?.length ?? 0) > 0) return;
          const data = synth(kind, ctx.sampleRate);
          const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
          buffer.getChannelData(0).set(data);
          this.sfx.set(kind, [buffer]);
        }, 40 * (i + 1)),
      );
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // --- Recorded sound: voices and music (scripts/generate-sound.mjs) -----------
  //
  // Optional, like the art: no index, or a file that fails, and the game plays
  // with its synthesised sounds alone. Files are fetched at startup but only
  // DECODED once the AudioContext exists, which is after the first tap.

  private readonly raw = new Map<string, ArrayBuffer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Cartoon speed-up per voice line, from the index: shorter and higher. */
  private readonly rates = new Map<string, number>();
  private musicBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private readonly sfx = new Map<SfxKind, AudioBuffer[]>();
  private voiceUntil = 0;
  private music: { id: string; gain: GainNode; sources: AudioBufferSourceNode[]; nextAt: number } | null = null;
  private wantMusic = '';
  private readonly loops = new Map<string, { start: number; end: number }>();

  /** Fetch the recorded sounds. Never throws; anything missing just stays silent. */
  loadRecorded(baseUrl: string): void {
    void (async () => {
      let index: { ext?: string; voices?: string[]; music?: string[]; rates?: Record<string, number> };
      try {
        const r = await fetch(`${baseUrl}sounds/index.json`, { cache: 'no-cache' });
        if (!r.ok) return;
        index = await r.json();
      } catch {
        return;
      }
      const ext = index.ext ?? 'm4a';
      for (const [id, rate] of Object.entries(index.rates ?? {})) this.rates.set(id, rate);
      // Voices first: they're small and used from the first second.
      for (const id of [...(index.voices ?? []), ...(index.music ?? [])]) {
        try {
          const r = await fetch(`${baseUrl}sounds/${id}.${ext}`);
          if (r.ok) this.raw.set(id, await r.arrayBuffer());
        } catch {
          // One missing file loses one sound.
        }
        if (this.ctx) this.decodeAll();
      }
    })();
  }

  private decodeAll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [id, bytes] of this.raw) {
      this.raw.delete(id);
      void ctx.decodeAudioData(bytes).then(
        (buffer) => this.buffers.set(id, buffer),
        () => {},
      );
    }
  }

  /** True if this recorded sound is ready to play. */
  has(id: string): boolean {
    return this.buffers.has(id);
  }

  /**
   * Say a voice line, one of `ids` at random. Returns false if none is loaded,
   * so the caller can fall back to a synthesised sound.
   *
   * One voice at a time: a line that would start while another is still
   * talking is dropped, unless `interrupt`. Raccoons talking over each other
   * (and over Ellie) is noise; one clear line is a joke.
   */
  say(ids: readonly string[], opts: { rate?: number; delay?: number; gain?: number; interrupt?: boolean } = {}): boolean {
    if (this.muted || !this.ctx || !this.master) return false;
    const ready = ids.filter((id) => this.buffers.has(id));
    if (ready.length === 0) return false;
    const ctx = this.ctx;
    const at = ctx.currentTime + (opts.delay ?? 0);
    if (at < this.voiceUntil && !opts.interrupt) return true;
    const id = ready[Math.floor(Math.random() * ready.length)]!;
    const buffer = this.buffers.get(id)!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const rate = (this.rates.get(id) ?? 1) * (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    source.connect(gain);
    gain.connect(this.master);
    source.start(at);
    this.voiceUntil = at + buffer.duration / rate;
    this.duck(0.55, buffer.duration / rate, at);
    return true;
  }

  /** Ask for a music track. Crossfades if it's different; `''` fades music out. */
  setMusic(id: string): void {
    this.wantMusic = id;
  }

  /**
   * Keep the music going. Call every tick: it starts, crossfades and loops
   * tracks by scheduling the next segment a little ahead of time.
   */
  updateMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const want = this.wantMusic && this.buffers.has(this.wantMusic) ? this.wantMusic : '';
    const now = ctx.currentTime;

    if (this.music && this.music.id !== want) {
      // Fade the old track out, whatever replaces it.
      const old = this.music;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0.0001, now + MUSIC_FADE);
      for (const src of old.sources) src.stop(now + MUSIC_FADE + 0.05);
      this.music = null;
    }
    if (!want) return;
    if (!this.music) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE);
      gain.connect(bus);
      this.music = { id: want, gain, sources: [], nextAt: now };
    }
    // Schedule the next segment once we're within two seconds of needing it.
    const m = this.music;
    if (m.nextAt - now > 2) return;
    const buffer = this.buffers.get(m.id)!;
    const loop = this.loopOf(m.id, buffer);
    const length = loop.end - loop.start;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const seg = ctx.createGain();
    // Each segment fades in and out over the crossfade, so the overlap blends.
    const t0 = Math.max(now, m.nextAt);
    seg.gain.setValueAtTime(0.0001, t0);
    seg.gain.linearRampToValueAtTime(1, t0 + LOOP_XFADE);
    seg.gain.setValueAtTime(1, t0 + length - LOOP_XFADE);
    seg.gain.linearRampToValueAtTime(0.0001, t0 + length);
    source.connect(seg);
    seg.connect(m.gain);
    source.start(t0, loop.start, length);
    m.sources = [...m.sources.slice(-2), source];
    m.nextAt = t0 + length - LOOP_XFADE;
  }

  /**
   * The steady part of a track: from where it reaches full volume to where
   * it starts to fade. Lyria clips are about thirty seconds and often fade
   * out at the end; looping the whole thing would dip to silence every lap.
   */
  private loopOf(id: string, buffer: AudioBuffer): { start: number; end: number } {
    const cached = this.loops.get(id);
    if (cached) return cached;
    const data = buffer.getChannelData(0);
    const win = Math.floor(buffer.sampleRate * 0.1);
    const rms: number[] = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += data[j]! * data[j]!;
      rms.push(Math.sqrt(sum / win));
    }
    const sorted = [...rms].sort((a, b) => a - b);
    const level = (sorted[sorted.length >> 1] ?? 0) * 0.6;
    let first = rms.findIndex((v) => v >= level);
    let last = rms.length - 1 - [...rms].reverse().findIndex((v) => v >= level);
    if (first < 0 || last <= first) {
      first = 0;
      last = rms.length - 1;
    }
    let start = Math.min(first * 0.1, 4);
    let end = (last + 1) * 0.1;
    if (end - start < 8) {
      start = 0;
      end = buffer.duration;
    }
    const loop = { start, end };
    this.loops.set(id, loop);
    return loop;
  }

  /** Dip the music, for a voice line or a blast, then bring it back. */
  duck(to: number, seconds: number, at?: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const t = at ?? ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(MUSIC_LEVEL * to, t, 0.05);
    bus.gain.setTargetAtTime(MUSIC_LEVEL, t + seconds, 0.4);
  }

  /** A sample-synthesised effect: one of a few cached random variants, slightly re-pitched each time. */
  private playSynth(kind: SfxKind, gain: number, reverb: number, rate = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    let variants = this.sfx.get(kind);
    if (!variants) {
      variants = [];
      this.sfx.set(kind, variants);
    }
    if (variants.length < VARIANTS) {
      const data = synth(kind, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      variants.push(buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = variants[Math.floor(Math.random() * variants.length)]!;
    source.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(g);
    g.connect(master);
    if (this.reverbSend && reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send);
      send.connect(this.reverbSend);
    }
    source.start();
  }

  /** A short stereo outdoor reverb: decaying noise, darkening as it fades. */
  private makeReverb(ctx: AudioContext): AudioBuffer {
    const seconds = 1.3;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const a = 0.5 * (1 - t) + 0.03;
        lp += ((Math.random() * 2 - 1) - lp) * a;
        d[i] = lp * Math.pow(1 - t, 3) * 0.5;
      }
    }
    return buffer;
  }

  /**
   * A recorded sound effect (not a voice line): no one-at-a-time rule, so a
   * raccoon's mouth-fart can sit under his "Oopsie!".
   */
  playRecorded(ids: readonly string[], opts: { rate?: number; gain?: number; delay?: number } = {}): boolean {
    if (this.muted || !this.ctx || !this.master) return false;
    const ready = ids.filter((id) => this.buffers.has(id));
    if (ready.length === 0) return false;
    const id = ready[Math.floor(Math.random() * ready.length)]!;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(id)!;
    source.playbackRate.value = (this.rates.get(id) ?? 1) * (opts.rate ?? 1) * (0.95 + Math.random() * 0.1);
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    source.connect(g);
    g.connect(this.master);
    source.start(this.ctx.currentTime + (opts.delay ?? 0));
    return true;
  }

  /**
   * A toot. `pitch` scales it: 1 for an ordinary raccoon, lower for a big one.
   *
   * Built sample by sample, because a real "brrrap" isn't a tone. It's a train
   * of little lip-flap pulses at an irregular rate, each one ringing briefly at
   * a low resonance, with the whole thing sputtering: the same model speech
   * synthesis uses for vocal cords. The first version was a filtered sawtooth
   * with a wobble, and it was reported (correctly) as needing a better sound:
   * a sawtooth is perfectly regular, and regular is what makes it a hum.
   *
   * Every toot is freshly randomised: pulse rate, its drift, the sputters and
   * the length. The three kinds:
   *  - **pfft**: short and airy, mostly breath, a high resonance.
   *  - **rumble**: long and low, slowing down, with sputtering gaps and a
   *    little "pt" at the end.
   *  - **squeak**: tight and high, rising: the squeaky-balloon one.
   */
  toot(kind: TootKind, pitch = 1, level = 1): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const buffer = this.fartBuffer(ctx, kind, pitch);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // A gentle low-pass takes the digital edge off the pulses.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'squeak' ? 2600 : kind === 'pfft' ? 2200 : 1300;
    const gain = ctx.createGain();
    gain.gain.value = 0.85 * level;
    source.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  private fartBuffer(ctx: AudioContext, kind: TootKind, pitch: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
    const dur = kind === 'rumble' ? rnd(0.6, 1.0) : kind === 'squeak' ? rnd(0.3, 0.5) : rnd(0.16, 0.26);
    const n = Math.floor(sr * dur);
    const buffer = ctx.createBuffer(1, n, sr);
    const out = buffer.getChannelData(0);

    // Pulse rate (Hz) at the start and end, and the resonance each pulse rings at.
    const f0Start = (kind === 'rumble' ? rnd(75, 95) : kind === 'squeak' ? rnd(170, 210) : rnd(110, 140)) * pitch;
    const f0End = kind === 'rumble' ? f0Start * rnd(0.55, 0.7) : kind === 'squeak' ? f0Start * rnd(1.4, 1.7) : f0Start * 0.9;
    const formant = (kind === 'rumble' ? rnd(170, 230) : kind === 'squeak' ? rnd(600, 750) : rnd(380, 480)) * pitch;
    const ring = kind === 'squeak' ? 140 : kind === 'pfft' ? 220 : 90; // damping, 1/s
    const breath = kind === 'pfft' ? 0.55 : kind === 'rumble' ? 0.12 : 0.06;

    let phase = 0;
    let sincePulse = 1;
    let pulseAmp = 1;
    let jitter = 0;
    let sputter = 1;
    let sputterClock = 0;
    let lowNoise = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // Pulse rate drifts from start to end, with a random walk on top.
      jitter += (Math.random() - 0.5) * 0.02;
      jitter *= 0.995;
      const f0 = (f0Start + (f0End - f0Start) * t) * (1 + jitter);
      phase += f0 / sr;
      if (phase >= 1) {
        phase -= 1;
        sincePulse = 0;
        // Uneven pulses are most of what makes it sound wet rather than electric.
        pulseAmp = rnd(0.55, 1);
      }
      sincePulse += 1 / sr;

      // Sputter: every few tens of ms, the flow may catch and drop out briefly.
      sputterClock -= 1 / sr;
      if (sputterClock <= 0) {
        sputterClock = rnd(0.025, 0.06);
        const chance = kind === 'rumble' ? 0.28 : 0.12;
        sputter = Math.random() < chance && t > 0.15 ? rnd(0.05, 0.35) : 1;
      }

      // Each pulse: a quick damped ring at the resonance.
      const voiced = pulseAmp * Math.exp(-ring * sincePulse) * Math.sin(2 * Math.PI * formant * sincePulse);
      // Breath: low-passed noise, so it hisses low rather than fizzes.
      lowNoise += (Math.random() * 2 - 1 - lowNoise) * 0.25;
      const sample = voiced * (1 - breath) + lowNoise * breath;

      // Envelope: a fast start, a body, and a tail; the rumble ends in a
      // separate little "pt" after a gap.
      let env = Math.min(1, t * 25) * Math.pow(1 - t, kind === 'squeak' ? 0.6 : 0.9);
      if (kind === 'rumble' && t > 0.86) env = t > 0.9 && t < 0.95 ? 0.7 : 0.05;
      out[i] = sample * env * sputter;
    }

    // Normalise so every toot lands at the same loudness.
    let peak = 0.001;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
    for (let i = 0; i < n; i++) out[i] = (out[i]! / peak) * 0.9;
    return buffer;
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
    const synthesised = SYNTH_SFX[sfx];
    if (synthesised) {
      this.playSynth(synthesised.kind, Math.max(0.05, Math.min(1, level)) * synthesised.gain, synthesised.reverb);
      return;
    }
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
