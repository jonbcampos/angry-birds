import type { Audio, TootKind } from '../core/audio';
import { BANDIT_RADIUS } from '../game/config';
import type { GameEvent, GameState } from '../game/state';
import type { Body } from '../physics/body';
import { MAX_BODIES } from '../physics/world';
import type { Particles } from './particles';

/**
 * The cast's personality: when the raccoons tease, toot and burp, and how
 * Ellie answers. See "The teasing" in ART-PLAN.md.
 *
 * This is presentation, not gameplay, which is why it lives in `src/render/`.
 * Nothing here changes a body, a score or a timer, and the simulation has no
 * idea any of it is happening. It listens to the same event queue the
 * particles and sounds do, plus a few reads of the game state.
 *
 * Four rules keep it fun rather than mean:
 *
 *  1. **One teaser at a time**, except right after a miss, where a whole fort
 *     laughing is the joke.
 *  2. **Never mid-flight.** A tease scheduled during a shot waits for the shot
 *     to finish, so it can't distract from the thing she's watching.
 *  3. **Ellie answers.** Every tease gets a reaction from her half a beat
 *     later, so the exchange ends with her, not with them.
 *  4. **A tease is never a punishment.** No score, no timer, no consequence.
 */

export type Mood = 'smug' | 'raspberry' | 'nyah' | 'toot' | 'burp' | 'laugh' | 'scared' | 'dizzy';
export type ElliePose = 'ready' | 'tease' | 'aim' | 'go' | 'cheer' | 'ew' | 'amazed' | 'sad';

interface Act {
  at: number;
  /** 'tease' waits out a flight; the others don't. */
  kind: 'tease' | 'ellie' | 'laugh-all' | 'finale';
  who: number;
  mood: Mood;
  pose: ElliePose;
  dur: number;
}

export interface Bubble {
  text: string;
  /** Body id it belongs to, or -1 once that body has gone. */
  who: number;
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
}

/** Seconds between one raccoon's tease and the next one's. */
const TEASE_COOLDOWN = 2.5;
/** She's been sitting on the aim this long: the nearest raccoon gets bored and teases. */
const AIM_TEASE_AFTER = 3.5;
const AIM_TEASE_EVERY = 6.5;
/** A bonked raccoon toots in surprise this often. Random so it stays funny. */
const BONK_TOOT_CHANCE = 1 / 3;
const NEIGHBOUR_RADIUS = 3.5;

const BUBBLE: Partial<Record<Mood, readonly string[]>> = {
  raspberry: ['pbbbt!', 'nyeh!'],
  nyah: ['nyah nyah!', 'can\'t get me!'],
  toot: ['toot!', 'oops!', 'hee hee!'],
  burp: ['BURP!', 'BUUURP!'],
  laugh: ['missed me!', 'hee hee!', 'ha ha!'],
};

const TOOTS: readonly TootKind[] = ['pfft', 'rumble', 'squeak'];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export class Cast {
  private clock = 0;
  private readonly mood: Mood[] = new Array<Mood>(MAX_BODIES).fill('smug');
  private readonly moodUntil = new Float64Array(MAX_BODIES);
  private readonly flinchUntil = new Float64Array(MAX_BODIES);
  private ellie: ElliePose = 'ready';
  private ellieUntil = 0;
  private readonly acts: Act[] = [];
  private nextTeaseAt = 0;
  /** Who teased last. The cooldown stops OTHERS butting in, not his own follow-up. */
  private lastTeaser = -1;
  private aimIdle = 0;
  private nextAimTease = AIM_TEASE_AFTER;
  private dancing = false;
  bubble: Bubble | null = null;

  constructor(
    private readonly audio: Audio,
    private readonly particles: Particles,
  ) {}

  get time(): number {
    return this.clock;
  }

  /** A level just started. One of them greets her with a burp and a raspberry. */
  reset(state: GameState): void {
    this.clock = 0;
    this.moodUntil.fill(0);
    this.flinchUntil.fill(0);
    this.ellieUntil = 0;
    this.acts.length = 0;
    this.nextTeaseAt = 0;
    this.lastTeaser = -1;
    this.aimIdle = 0;
    this.nextAimTease = AIM_TEASE_AFTER;
    this.dancing = false;
    this.bubble = null;
    const first = this.randomBandit(state);
    if (first) {
      this.schedule('tease', 1.2, first.id, 'burp', 1.1);
      this.schedule('tease', 2.9, first.id, 'raspberry', 1.1);
    }
  }

  // --- Events ---------------------------------------------------------------

  onEvent(e: GameEvent, state: GameState): void {
    switch (e.kind) {
      case 'bonk': {
        // The bonked raccoon himself is a particle now. One time in three he
        // toots in surprise on the way out.
        const tooting = Math.random() < BONK_TOOT_CHANCE;
        this.particles.raccoon(e.x, e.y, e.vx, e.vy, e.w, tooting);
        if (tooting) {
          this.audio.toot('squeak', BANDIT_RADIUS / Math.max(0.2, e.w));
          this.say(-1, e.x, e.y, e.w, 'toot!');
        }
        this.setEllie('cheer', 0.8);
        if (tooting) this.schedule('ellie', 0.85, -1, 'smug', 1.1, 'ew');

        // His neighbours are scared... and then the bravest burps at her anyway.
        let brave: Body | null = null;
        for (const b of state.world.bodies) {
          if (!b.alive || b.tag !== 'bandit') continue;
          if (Math.hypot(b.x - e.x, b.y - e.y) > NEIGHBOUR_RADIUS) continue;
          this.flinchUntil[b.id] = this.clock + 1;
          if (!brave || Math.random() < 0.5) brave = b;
        }
        if (brave) this.schedule('tease', 1.6, brave.id, 'burp', 1.1);
        break;
      }
      case 'impact':
        if (e.value > 40) this.flinchNear(state, e.x, e.y, 2.5, 0.6);
        break;
      case 'boom':
        this.flinchNear(state, e.x, e.y, e.value * 1.4, 0.8);
        this.setEllie('amazed', 1);
        break;
      case 'launch':
        this.setEllie('go', 0.5);
        this.aimIdle = 0;
        break;
      case 'shotover':
        // A shot that bonked nobody: the whole fort laughs at once.
        if (e.value === 0) this.schedule('laugh-all', 0.25, -1, 'laugh', 1.6);
        break;
      case 'won':
        this.setEllie('cheer', 99);
        this.bubble = null;
        break;
      case 'lost': {
        this.dancing = true;
        this.setEllie('sad', 99);
        const last = this.randomBandit(state);
        if (last) this.schedule('finale', 2.4, last.id, 'toot', 1.2);
        break;
      }
    }
  }

  // --- Tick -----------------------------------------------------------------

  update(dt: number, state: GameState): void {
    this.clock += dt;

    // Bored of waiting: the nearest raccoon teases while she lines up a shot.
    if (state.phase === 'aim' && state.winTimer < 0) {
      this.aimIdle += dt;
      if (this.aimIdle >= this.nextAimTease) {
        this.nextAimTease = this.aimIdle + AIM_TEASE_EVERY + Math.random() * 2;
        const near = this.nearestBandit(state);
        if (near) this.tease(state, near.id, Math.random() < 0.6 ? 'toot' : 'nyah', 1.1);
      }
    } else if (state.phase !== 'flight') {
      this.aimIdle = 0;
      this.nextAimTease = AIM_TEASE_AFTER;
    }

    for (let i = this.acts.length - 1; i >= 0; i--) {
      const act = this.acts[i]!;
      if (act.at > this.clock) continue;
      // Rule 2: never mid-flight. Try again in a moment.
      if ((act.kind === 'tease' || act.kind === 'laugh-all') && state.phase === 'flight') {
        act.at = this.clock + 0.3;
        continue;
      }
      this.acts.splice(i, 1);
      this.run(act, state);
    }

    if (this.bubble && this.clock - this.bubble.born > this.bubble.life) this.bubble = null;
  }

  private run(act: Act, state: GameState): void {
    switch (act.kind) {
      case 'tease':
        this.tease(state, act.who, act.mood, act.dur);
        break;
      case 'ellie':
        this.setEllie(act.pose, act.dur);
        this.audio.play('ellie-giggle');
        break;
      case 'laugh-all': {
        if (state.phase !== 'aim' && state.phase !== 'lost') return;
        let speaker: Body | null = null;
        for (const b of state.world.bodies) {
          if (!b.alive || b.tag !== 'bandit') continue;
          this.mood[b.id] = 'laugh';
          this.moodUntil[b.id] = this.clock + act.dur * (0.85 + Math.random() * 0.3);
          if (!speaker || Math.random() < 0.4) speaker = b;
        }
        if (!speaker) return;
        this.audio.play('giggle');
        this.say(speaker.id, speaker.x, speaker.y, this.radius(speaker), pick(BUBBLE.laugh!));
        // Ellie answers: tongue out, back at all of them.
        this.schedule('ellie', 0.9, -1, 'smug', 0.9, 'tease');
        this.nextTeaseAt = this.clock + TEASE_COOLDOWN;
        break;
      }
      case 'finale': {
        const b = state.world.bodies[act.who];
        if (!b || !b.alive || b.tag !== 'bandit') return;
        // The victory dance ends in one long, proud toot.
        this.audio.toot('rumble', BANDIT_RADIUS / this.radius(b));
        this.particles.toot(b.x, b.y, this.radius(b) * 1.3, 1);
        this.say(b.id, b.x, b.y, this.radius(b), 'hee hee!');
        break;
      }
    }
  }

  /** One raccoon teases. Skipped if a different one just did (rule 1). */
  private tease(state: GameState, who: number, mood: Mood, dur: number): void {
    if (this.clock < this.nextTeaseAt && who !== this.lastTeaser) return;
    let b: Body | undefined = state.world.bodies[who];
    if (!b || !b.alive || b.tag !== 'bandit') b = this.randomBandit(state) ?? undefined;
    if (!b) return;
    const r = this.radius(b);
    const pitch = BANDIT_RADIUS / r;

    this.mood[b.id] = mood;
    this.moodUntil[b.id] = this.clock + dur;
    this.nextTeaseAt = this.clock + TEASE_COOLDOWN;
    this.lastTeaser = b.id;
    this.say(b.id, b.x, b.y, r, pick(BUBBLE[mood] ?? ['hee hee!']));

    switch (mood) {
      case 'toot':
        this.audio.toot(pick(TOOTS), pitch);
        this.particles.toot(b.x, b.y, r, 1);
        break;
      case 'burp':
        this.audio.burp(pitch);
        break;
      case 'nyah':
        this.audio.play('nyah');
        break;
      case 'raspberry':
        this.audio.play('raspberry');
        break;
      default:
        break;
    }

    // Rule 3: she answers. Toots and burps make her giggle and hold her nose;
    // everything else gets her tongue right back.
    const gross = mood === 'toot' || mood === 'burp';
    this.schedule('ellie', gross ? 0.45 : 0.6, -1, 'smug', gross ? 1.1 : 0.9, gross ? 'ew' : 'tease');
  }

  // --- Queries for the renderer ---------------------------------------------

  banditMood(b: Body): Mood {
    if (this.dancing) {
      const dance: Mood[] = ['raspberry', 'nyah', 'toot', 'burp'];
      return dance[Math.floor(this.clock * 2.5 + b.id) % 4]!;
    }
    if (b.awake && Math.hypot(b.vx, b.vy) > 1.2) return 'scared';
    if (this.flinchUntil[b.id]! > this.clock) return 'scared';
    if (this.moodUntil[b.id]! > this.clock) return this.mood[b.id]!;
    if (b.maxHp > 0 && b.hp < b.maxHp * 0.6) return 'dizzy';
    return 'smug';
  }

  /** Extra height in metres for a hop: dancing, or bouncing with laughter. */
  banditHop(b: Body, mood: Mood): number {
    if (this.dancing) return Math.abs(Math.sin(this.clock * 7 + b.id)) * 0.18;
    if (mood === 'laugh') return Math.abs(Math.sin(this.clock * 16 + b.id)) * 0.06;
    return 0;
  }

  elliePose(state: GameState): ElliePose {
    if (this.ellieUntil > this.clock) return this.ellie;
    if (state.phase === 'lost') return 'sad';
    if (state.phase === 'won') return 'cheer';
    if (state.phase === 'aim' && state.aiming) return 'aim';
    return 'ready';
  }

  // --- Helpers --------------------------------------------------------------

  private setEllie(pose: ElliePose, dur: number): void {
    this.ellie = pose;
    this.ellieUntil = this.clock + dur;
  }

  private schedule(kind: Act['kind'], delay: number, who: number, mood: Mood, dur: number, pose: ElliePose = 'ready'): void {
    this.acts.push({ at: this.clock + delay, kind, who, mood, pose, dur });
  }

  private say(who: number, x: number, y: number, r: number, text: string): void {
    this.bubble = { text, who, x, y, r, born: this.clock, life: 1.4 };
  }

  private flinchNear(state: GameState, x: number, y: number, radius: number, dur: number): void {
    for (const b of state.world.bodies) {
      if (!b.alive || b.tag !== 'bandit') continue;
      if (Math.hypot(b.x - x, b.y - y) <= radius) this.flinchUntil[b.id] = Math.max(this.flinchUntil[b.id]!, this.clock + dur);
    }
  }

  private radius(b: Body): number {
    return b.shape.kind === 'circle' ? b.shape.r : BANDIT_RADIUS;
  }

  private randomBandit(state: GameState): Body | null {
    let found: Body | null = null;
    let n = 0;
    for (const b of state.world.bodies) {
      if (!b.alive || b.tag !== 'bandit') continue;
      n++;
      if (Math.random() < 1 / n) found = b;
    }
    return found;
  }

  private nearestBandit(state: GameState): Body | null {
    let best: Body | null = null;
    for (const b of state.world.bodies) {
      if (!b.alive || b.tag !== 'bandit') continue;
      if (!best || b.x < best.x) best = b;
    }
    return best;
  }
}
