/**
 * Sound effects, synthesised sample by sample.
 *
 * The first set was oscillators and filtered noise: one tone and one hiss per
 * sound, which reads as "a game from 1985". Asked for better sounds, and with
 * no model available that makes sound effects (Lyria makes music: asked for an
 * explosion, it wrote a polka with one in the middle), these are built the way
 * real-world sounds actually work:
 *
 *  - **Things that are struck ring at several frequencies at once** (modal
 *    synthesis). Wood's partials are close and die fast; glass's are high and
 *    ring; stone's are low and choked. That is the whole difference between a
 *    knock, a clink and a thud.
 *  - **Explosions are layers**: a sharp crack, a deep pitch-dropping thump, a
 *    rumble that darkens as it fades, and debris crackling down afterwards.
 *  - **Plucked things are a delay line** (Karplus-Strong): the slingshot's
 *    rubber band twangs like a string.
 *
 * Each function returns raw samples for a given sample rate and is pure apart
 * from `Math.random`, so a dev script can render them to a WAV outside the
 * browser. The Audio class caches a few random variants of each.
 */

export type SfxKind =
  | 'boom'
  | 'pop'
  | 'hit-wood'
  | 'hit-glass'
  | 'hit-stone'
  | 'hit-ground'
  | 'break-wood'
  | 'break-glass'
  | 'break-stone'
  | 'bonk'
  | 'launch'
  | 'stretch';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export function synth(kind: SfxKind, sr: number): Float32Array {
  switch (kind) {
    case 'boom':
      return explosion(sr, 1);
    case 'pop':
      return explosion(sr, 0.6);
    case 'hit-wood':
      return modal(sr, 0.28, rnd(170, 250), [1, 2.31, 3.92, 5.53], [32, 45, 60, 80], 0.5, 1800);
    case 'hit-glass':
      return modal(sr, 0.55, rnd(1700, 2400), [1, 2.32, 4.25, 6.63], [9, 12, 16, 22], 0.15, 6000);
    case 'hit-stone':
      return modal(sr, 0.3, rnd(85, 120), [1, 1.59, 2.71, 3.86], [30, 38, 50, 70], 0.9, 900);
    case 'hit-ground':
      return thud(sr);
    case 'break-wood':
      return breakWood(sr);
    case 'break-glass':
      return shatter(sr);
    case 'break-stone':
      return crumble(sr);
    case 'bonk':
      return boing(sr);
    case 'launch':
      return twang(sr);
    case 'stretch':
      return creak(sr);
  }
}

// --- Building blocks -------------------------------------------------------------

function buffer(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.floor(sr * seconds));
}

/** Scale so the loudest sample is `peak`. Every effect lands at the same level. */
function normalise(out: Float32Array, peak = 0.9): Float32Array {
  let max = 1e-6;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]!));
  const k = peak / max;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  return out;
}

/** A one-pole low-pass, run in place. `cutoff` may be a function of time. */
function lowpass(x: Float32Array, sr: number, cutoff: number | ((t: number) => number)): Float32Array {
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff(i / sr);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    y += (x[i]! - y) * a;
    x[i] = y;
  }
  return x;
}

/**
 * A struck object: a click to excite it, then several damped sine partials.
 * `noise` is how much broadband "hit" is mixed in, low-passed at `bright`.
 */
function modal(
  sr: number,
  seconds: number,
  f: number,
  ratios: number[],
  decays: number[],
  noise: number,
  bright: number,
): Float32Array {
  const out = buffer(sr, seconds);
  const amps = ratios.map((_, i) => rnd(0.6, 1) / (i + 1));
  const phases = ratios.map(() => rnd(0, Math.PI * 2));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += amps[k]! * Math.exp(-decays[k]! * t) * Math.sin(2 * Math.PI * f * ratios[k]! * t + phases[k]!);
    }
    out[i] = s;
  }
  const hit = buffer(sr, seconds);
  for (let i = 0; i < hit.length; i++) hit[i] = (Math.random() * 2 - 1) * Math.exp((-i / sr) * 90);
  lowpass(hit, sr, bright);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + hit[i]! * noise * 3;
  return normalise(out);
}

// --- Explosions ------------------------------------------------------------------------

function explosion(sr: number, size: number): Float32Array {
  const seconds = 0.9 + size * 1.4;
  const out = buffer(sr, seconds);
  const thumpFrom = rnd(100, 125) / Math.sqrt(size);
  // Brown noise for the rumble: integrated white noise, leaky so it doesn't wander off.
  let brown = 0;
  const rumble = buffer(sr, seconds);
  for (let i = 0; i < rumble.length; i++) {
    brown = brown * 0.997 + (Math.random() * 2 - 1) * 0.06;
    rumble[i] = brown;
  }
  // The rumble darkens as it fades: the bright part of a blast dies first.
  lowpass(rumble, sr, (t) => 150 + 2400 * Math.exp(-t * 3));

  let crackle = 0;
  let thumpPhase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Crack: the first few milliseconds, bright and sharp.
    const crack = (Math.random() * 2 - 1) * Math.exp(-t * 140);
    // Thump: a sine diving from ~110Hz to ~30Hz, overdriven for punch.
    const f = 30 + (thumpFrom - 30) * Math.exp(-t * 7);
    thumpPhase += (2 * Math.PI * f) / sr;
    const thump = Math.tanh(Math.sin(thumpPhase) * 2.5) * Math.exp(-t * 3.2);
    // Rumble: swells in over 20ms, then rolls away.
    const body = rumble[i]! * Math.min(1, t * 50) * Math.exp(-t * (2.2 / size)) * 6;
    // Debris: sparse clicks pattering down after the bang.
    if (t > 0.12 && Math.random() < 0.0025 * Math.exp(-(t - 0.12) * 1.8) * size) crackle = rnd(0.2, 0.6);
    crackle *= 0.985;
    const debris = crackle * (Math.random() * 2 - 1);
    out[i] = Math.tanh((crack * 0.9 + thump * 1.1 + body + debris) * 1.4);
  }
  return normalise(out);
}

// --- Impacts and breaks -------------------------------------------------------------------

function thud(sr: number): Float32Array {
  const out = buffer(sr, 0.25);
  let phase = 0;
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * (45 + 40 * Math.exp(-t * 25))) / sr;
    n += ((Math.random() * 2 - 1) - n) * 0.08;
    out[i] = Math.sin(phase) * Math.exp(-t * 18) + n * Math.exp(-t * 30) * 2;
  }
  return normalise(out);
}

/** A sharp snap, then splinters. */
function breakWood(sr: number): Float32Array {
  const out = modal(sr, 0.45, rnd(140, 190), [1, 2.4, 4.1], [20, 30, 45], 0.3, 1500);
  // The snap: a very short bright burst, then a few splinter clicks.
  for (let i = 0; i < Math.floor(sr * 0.02); i++) out[i] = out[i]! + (Math.random() * 2 - 1) * (1 - i / (sr * 0.02)) * 1.4;
  for (let k = 0; k < 7; k++) {
    const at = Math.floor(sr * rnd(0.03, 0.3));
    const len = Math.floor(sr * rnd(0.004, 0.012));
    const amp = rnd(0.3, 0.8);
    for (let i = 0; i < len && at + i < out.length; i++) {
      out[at + i] = out[at + i]! + (Math.random() * 2 - 1) * amp * (1 - i / len);
    }
  }
  return normalise(out);
}

/** Many little glass pings, scattered over half a second, over a bright hiss. */
function shatter(sr: number): Float32Array {
  const out = buffer(sr, 0.9);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = (Math.random() * 2 - 1) * Math.exp(-t * 9) * 0.35;
  }
  for (let k = 0; k < 18; k++) {
    const at = rnd(0, 0.45) * (k < 4 ? 0.1 : 1);
    const f = rnd(2000, 6500);
    const decay = rnd(14, 30);
    const amp = rnd(0.3, 0.9) * Math.exp(-at * 2);
    const start = Math.floor(at * sr);
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / sr;
      out[i] = out[i]! + amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * f * t);
    }
  }
  return normalise(out);
}

/** Gritty, low, and spread out: lots of small thuds over a rumble. */
function crumble(sr: number): Float32Array {
  const out = buffer(sr, 0.8);
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    n += ((Math.random() * 2 - 1) - n) * 0.12;
    out[i] = n * Math.exp(-t * 4) * 3;
  }
  for (let k = 0; k < 14; k++) {
    const at = Math.floor(sr * rnd(0, 0.55));
    const f = rnd(70, 220);
    for (let i = at; i < out.length; i++) {
      const t = (i - at) / sr;
      out[i] = out[i]! + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 35) * rnd(0.4, 0.7);
    }
  }
  return normalise(out);
}

// --- Cartoon sounds ----------------------------------------------------------------

/** A cartoon spring: a woodblock bonk, then a wobbling, rising boing. */
function boing(sr: number): Float32Array {
  const out = modal(sr, 0.6, rnd(620, 700), [1, 2.7], [35, 60], 0.2, 3000);
  let phase = 0;
  const base = rnd(260, 300);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = base * (1 + t * 1.6) * (1 + 0.18 * Math.sin(2 * Math.PI * 14 * t) * Math.exp(-t * 3));
    phase += (2 * Math.PI * f) / sr;
    out[i] = out[i]! * 0.6 + Math.sin(phase) * Math.min(1, t * 80) * Math.exp(-t * 4.5) * 0.8;
  }
  return normalise(out);
}

/** The rubber band: a plucked string (Karplus-Strong) dropping in pitch, plus a whoosh. */
function twang(sr: number): Float32Array {
  const out = buffer(sr, 0.7);
  let period = Math.floor(sr / rnd(95, 115));
  const line = new Float32Array(Math.floor(sr / 40));
  for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    // The band slackens as it fires, so the note falls.
    if (i % 400 === 0 && period < line.length - 1) period++;
    const cur = line[idx % period]!;
    const next = 0.996 * 0.5 * (cur + prev);
    prev = cur;
    line[idx % period] = next;
    idx++;
    out[i] = cur;
  }
  // Whoosh: noise swept up through a band, as the toy leaves.
  let lp = 0;
  let hp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const fc = 400 + 2600 * Math.min(1, t * 3);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    lp += ((Math.random() * 2 - 1) - lp) * a;
    hp += (lp - hp) * 0.05;
    out[i] = out[i]! * 0.9 + (lp - hp) * Math.sin(Math.PI * Math.min(1, t / 0.45)) * 1.2;
  }
  return normalise(out, 0.8);
}

/** Pulling back: rubber creaking, a quickening run of tiny squeaks. */
function creak(sr: number): Float32Array {
  const out = buffer(sr, 0.35);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (25 + 70 * t * 3) / sr;
    const tick = phase % 1 < 0.08 ? 1 : 0;
    out[i] = tick * Math.sin(2 * Math.PI * 900 * t) * Math.min(1, t * 20) * (1 - t / 0.35);
  }
  lowpass(out, sr, 2500);
  return normalise(out, 0.5);
}
