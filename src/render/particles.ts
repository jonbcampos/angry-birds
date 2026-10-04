import { GROUND_Y } from '../game/config';
import { PALETTE } from './palette';

/**
 * Purely visual debris: shards, dust, confetti, sparkles, and bonked raccoons
 * running away.
 *
 * None of this is in the physics world, on purpose. A shattered pane of glass
 * as forty real bodies would look the same and would knock the tower over a
 * second time; the halves of a SPLIT plank are real (see GameState.destroy),
 * the dust and slivers are not. The line is: if it is big enough that you'd
 * expect it to push something, it's a body.
 *
 * Particles do get gravity and a bounce off the ground, which is most of what
 * makes them read as debris rather than as a sprite effect.
 *
 * Everything is in world metres and lives in a fixed pool.
 */

export enum PKind {
  Shard,
  Puff,
  Confetti,
  Spark,
  Raccoon,
  Text,
  /** A fireball puff: white-hot, then orange, red, and finally smoke. */
  Fire,
  /** Dark smoke that rises and spreads. */
  Smoke,
  /** The shockwave: a ring racing outward. `size2` is its final radius. */
  Ring,
  /** A burn mark left on the ground under a blast. */
  Scorch,
  /** The painted explosion flipbook (generated art). `size` is the blast radius; `size2` mirrors. */
  Flip,
  /**
   * A toot cloud: pale yellow-green, wobbling as it rises, with stink lines.
   * Deliberately nowhere near the art pipeline's #00FF00 key, so the same
   * cloud works over generated raccoons later.
   */
  Toot,
}

export interface Particle {
  alive: boolean;
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** Size in metres: a shard's long side, a puff's radius. */
  size: number;
  /** Second dimension for shards. */
  size2: number;
  life: number;
  maxLife: number;
  color: string;
  gravity: number;
  drag: number;
  bounces: boolean;
  text: string;
  /** Raccoon: 0 tumbling, 1 running away. */
  stage: number;
  /** Seconds left of emitting a trail of toot clouds (a bonked raccoon's surprise). */
  emit: number;
  emitClock: number;
}

const MAX = 1400;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Particles {
  readonly pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false,
        kind: PKind.Shard,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rot: 0,
        vr: 0,
        size: 0,
        size2: 0,
        life: 0,
        maxLife: 1,
        color: '#fff',
        gravity: 0,
        drag: 0,
        bounces: false,
        text: '',
        stage: 0,
        emit: 0,
        emitClock: 0,
      });
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  /** Oldest-first reuse when full, so a huge collapse overwrites old dust instead of dropping new shards. */
  private next(): Particle {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[(this.cursor + i) % MAX]!;
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % MAX;
        return p;
      }
    }
    const p = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  spawn(
    kind: PKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    color: string,
    gravity = 10,
    drag = 0,
  ): Particle {
    const p = this.next();
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.rot = rand(0, Math.PI * 2);
    p.vr = rand(-12, 12);
    p.size = size;
    p.size2 = size * rand(0.25, 0.6);
    p.life = life;
    p.maxLife = life;
    p.color = color;
    p.gravity = gravity;
    p.drag = drag;
    p.bounces = kind === PKind.Shard || kind === PKind.Confetti;
    p.text = '';
    p.stage = 0;
    p.emit = 0;
    p.emitClock = 0;
    return p;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      if (p.kind === PKind.Raccoon) {
        this.updateRaccoon(p, dt);
        continue;
      }
      p.vy += p.gravity * dt;
      const d = 1 / (1 + p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === PKind.Puff) p.size += dt * 0.6;
      else if (p.kind === PKind.Toot) p.size += dt * 0.45;
      else if (p.kind === PKind.Fire) p.size += dt * 1.4;
      else if (p.kind === PKind.Smoke) p.size += dt * 0.9;
      if (p.bounces && p.y > GROUND_Y) {
        p.y = GROUND_Y;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vr *= 0.5;
      }
    }
  }

  /**
   * A bonked bandit: pops up, tumbles, lands on its feet, and runs off to the
   * right, out of the level. Nobody is hurt; they just give up on the fort.
   */
  private updateRaccoon(p: Particle, dt: number): void {
    if (p.emit > 0) {
      p.emit -= dt;
      p.emitClock -= dt;
      if (p.emitClock <= 0) {
        p.emitClock = 0.07;
        this.tootPuff(p.x - p.size * 0.6, p.y + p.size * 0.4, p.size * 0.5, -p.vx * 0.15);
      }
    }
    if (p.stage === 0) {
      p.vy += 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.vy > 0 && p.y > GROUND_Y - p.size) {
        p.y = GROUND_Y - p.size;
        p.stage = 1;
        p.rot = 0;
        p.vx = 7;
        p.vy = 0;
      }
    } else {
      p.x += p.vx * dt;
      // Little hops as it scampers.
      p.rot += dt * 18;
      p.y = GROUND_Y - p.size - Math.abs(Math.sin(p.rot)) * 0.25;
    }
  }

  // --- Recipes --------------------------------------------------------------

  shards(x: number, y: number, hw: number, hh: number, angle: number, vx: number, vy: number, colors: readonly string[], heavy: boolean): void {
    const area = hw * hh * 4;
    const n = Math.min(40, Math.round(8 + area * 30));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let i = 0; i < n; i++) {
      const lx = rand(-hw, hw);
      const ly = rand(-hh, hh);
      const px = x + c * lx - s * ly;
      const py = y + s * lx + c * ly;
      const spread = heavy ? 2.5 : 4.5;
      this.spawn(
        PKind.Shard,
        px,
        py,
        vx * 0.4 + rand(-spread, spread) + lx * 2,
        vy * 0.4 + rand(-spread * 1.3, spread * 0.3) + ly * 2,
        rand(0.08, heavy ? 0.28 : 0.22),
        rand(0.8, 1.6),
        colors[i % colors.length]!,
        12,
        0.4,
      );
    }
    this.dust(x, y, Math.min(1, area), heavy ? '#d9d2c4' : '#f4e6cf');
  }

  dust(x: number, y: number, amount: number, color = '#efe6d6'): void {
    const n = Math.round(3 + amount * 8);
    for (let i = 0; i < n; i++) {
      this.spawn(PKind.Puff, x + rand(-0.3, 0.3), y + rand(-0.2, 0.2), rand(-1.5, 1.5), rand(-1.6, -0.2), rand(0.12, 0.3), rand(0.4, 0.8), color, -0.5, 2.5);
    }
  }

  sparks(x: number, y: number, n: number, color: string = PALETTE.star): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(2, 6);
      this.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.1, 0.2), rand(0.3, 0.6), color, 2, 3);
    }
  }

  confetti(x: number, y: number, radius: number): void {
    const colors = ['#ff5fa2', '#ffd23f', '#4cc9f0', '#7bd389', '#b05cff', '#ff8c42'];
    for (let i = 0; i < 90; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(3, 13) * (radius / 3);
      this.spawn(PKind.Confetti, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 3, rand(0.12, 0.22), rand(1.4, 2.6), colors[i % colors.length]!, 4, 2.2);
    }
    for (let i = 0; i < 10; i++) {
      this.spawn(PKind.Puff, x + rand(-0.5, 0.5), y + rand(-0.5, 0.5), rand(-2, 2), rand(-2, 0.5), rand(0.3, 0.6), rand(0.4, 0.7), '#ffffff', -1, 3);
    }
  }

  /** A bonked raccoon. With `tooting`, he leaves a trail of clouds as he goes. */
  raccoon(x: number, y: number, vx: number, vy: number, r: number, tooting = false): void {
    const p = this.spawn(PKind.Raccoon, x, y, Math.max(1, vx * 0.3 + 2), Math.min(-6, vy * 0.3 - 7), r, 6, PALETTE.banditFur, 0, 0);
    p.vr = rand(8, 14) * (Math.random() < 0.5 ? -1 : 1);
    p.bounces = false;
    if (tooting) p.emit = 0.7;
    this.sparks(x, y, 10);
  }

  /**
   * A TNT blast, built in layers so it reads at a glance and still rewards a
   * second look: a shockwave ring, a white-hot fireball that cools through
   * orange and red into smoke, a column of dark smoke, a spray of embers that
   * bounce on the grass, the crate's own splinters, and a scorch mark.
   */
  explosion(x: number, y: number, radius: number, confetti: boolean): void {
    // First, so it draws underneath the procedural fire. Invisible if there's no art.
    const flip = this.spawn(PKind.Flip, x, y, 0, 0, radius, 0.6, '#ffffff', 0, 0);
    flip.bounces = false;
    flip.rot = rand(-0.4, 0.4);
    flip.size2 = Math.random() < 0.5 ? -1 : 1;
    const ring = this.spawn(PKind.Ring, x, y, 0, 0, 0.2, 0.38, '#ffffff', 0, 0);
    ring.size2 = radius * 1.15;
    ring.bounces = false;
    const ring2 = this.spawn(PKind.Ring, x, y, 0, 0, 0.2, 0.55, '#ffd27a', 0, 0);
    ring2.size2 = radius * 0.8;
    ring2.bounces = false;

    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1, 7) * (radius / 4);
      this.spawn(PKind.Fire, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, Math.cos(a) * sp, Math.sin(a) * sp - 1.5, rand(0.35, 0.8) * (radius / 4), rand(0.45, 0.95), '#ffffff', -3, 3.5);
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.5, 3);
      const p = this.spawn(PKind.Smoke, x + rand(-0.6, 0.6), y + rand(-0.6, 0.6), Math.cos(a) * sp, Math.sin(a) * sp - 1.2, rand(0.4, 0.8), rand(1.4, 2.4), '#6e6e78', -1.2, 1.5);
      p.bounces = false;
    }
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(5, 16);
      const p = this.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 3, rand(0.1, 0.2), rand(0.5, 1.1), i % 3 === 0 ? '#fff3b0' : '#ffa630', 14, 1.2);
      p.bounces = true;
    }
    // The crate itself, in splinters.
    const wood = ['#b5432c', '#8c2f1e', '#e0a35c', '#5a1d12'];
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(4, 12);
      this.spawn(PKind.Shard, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 4, rand(0.12, 0.3), rand(1, 1.8), wood[i % wood.length]!, 12, 0.3);
    }
    if (confetti) this.confetti(x, y, radius * 0.8);
    // Scorch, if the blast was near the ground.
    if (y > GROUND_Y - 2) {
      const s = this.spawn(PKind.Scorch, x, GROUND_Y, 0, 0, radius * 0.45, 7, '#2a1d14', 0, 0);
      s.bounces = false;
    }
  }

  /** Floating text. `px` is the font size in screen pixels; 0 means the default. */
  /** One toot cloud. `vx` lets a moving raccoon leave them behind him. */
  tootPuff(x: number, y: number, size: number, vx = 0): void {
    const p = this.spawn(PKind.Toot, x, y, vx + rand(-0.3, 0.3), rand(-0.9, -0.4), size * rand(0.8, 1.2), rand(1.1, 1.6), '#d4e157', 0, 1.5);
    p.bounces = false;
    p.vr = rand(2.5, 4.5);
  }

  /** A seated raccoon's toot: a few clouds puffing out low beside him. `side` is -1 or 1. */
  toot(x: number, y: number, r: number, side: number): void {
    for (let i = 0; i < 4; i++) {
      this.tootPuff(x + side * r * (0.7 + i * 0.25), y + r * 0.6 - i * 0.08, r * (0.45 + i * 0.12), side * rand(0.4, 1));
    }
  }

  popup(x: number, y: number, text: string, color: string = PALETTE.hudText, px = 0, life = 1.1): void {
    const p = this.spawn(PKind.Text, x, y, 0, -1.2, px, life, color, 0, 1);
    p.text = text;
    p.bounces = false;
  }
}
