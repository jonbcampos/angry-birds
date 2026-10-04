import { makeBox, makeCircle, makePoly, type Body } from '../physics/body';
import { MAX_BODIES, World } from '../physics/world';
import {
  BANDIT_HP,
  BANDIT_RADIUS,
  BIG_IMPACT_J,
  DAMAGE_FLOOR_J,
  DRAG_CANCEL,
  DRAG_FULL_PX,
  GRAVITY,
  LAUNCH_SPEED,
  LOSE_GRACE,
  PHYSICS_SUBSTEPS,
  SCORE_BANDIT,
  SCORE_BLOCK,
  SCORE_SPARE_TOY,
  SHOT_MAX_TIME,
  SHOT_REST_SPEED,
  SHOT_REST_TIME,
  FIRECRACKER_SCALE,
  SLING_X,
  SLING_Y,
  TNT_CHAIN_DELAY,
  TNT_DAMAGE,
  TNT_HALF_MASS,
  TNT_HP,
  TNT_RADIUS,
  TNT_SPEED,
  WIN_DELAY,
  WORLD_KILL_MARGIN,
} from './config';
import {
  BOOST_FLOAT,
  BOOST_SPEED,
  MAT,
  MATERIALS,
  POPPER_FUSE,
  SHOTS,
  SLAM_SPEED,
  SPLIT_SPREAD,
  type Ability,
  type ShotKind,
} from './content';
import { levelBounds, type Level, LEVELS } from './levels';

/**
 * The simulation of one level. Knows nothing about how any of it looks.
 *
 * Everything the renderer and the sound need to know about what *happened* —
 * a block breaking, a bandit bonked, a toy launched — goes out through the
 * event queue, drained by main.ts once per tick. That is the seam that keeps
 * `src/game/` free of any import from `src/render/`, as in the sibling games.
 */

export type Phase = 'title' | 'select' | 'aim' | 'flight' | 'won' | 'lost' | 'paused';

export type EventKind =
  | 'impact'
  | 'break'
  | 'bonk'
  | 'launch'
  | 'ability'
  | 'boom'
  | 'stretch'
  | 'shotover'
  | 'won'
  | 'lost';

/**
 * One flat event shape rather than a union of objects, so the queue can be a
 * fixed pool. Which fields mean anything depends on `kind`; see `emit` calls.
 */
export interface GameEvent {
  kind: EventKind;
  x: number;
  y: number;
  a: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /**
   * Energy for an impact; power for a launch; stars for a win; bandits bonked
   * by the shot for 'shotover'.
   */
  value: number;
  /** Material index of the thing the event is about. */
  mat: number;
  /** 'box' | 'tri' | 'circle' for a break; the ability for 'ability'. */
  tag: string;
}

const MAX_EVENTS = 256;
const TRAIL_MAX = 240;
const TRAIL_EVERY = 0.035;

export class GameState {
  readonly world = new World();
  phase: Phase = 'title';
  /** What to return to when un-pausing. */
  pausedFrom: Phase = 'aim';

  level: Level = LEVELS[0]!;
  levelRight = 20;
  levelTop = 6;

  /** Toys not yet fired, front first. The front one is in the pouch while aiming. */
  readonly queue: ShotKind[] = [];
  /** The kind of the toy currently in flight. */
  current: ShotKind = 'ball';
  /** Every live body that came from the current launch (a split makes three). */
  readonly flying: Body[] = [];
  abilityUsed = false;
  /** The lead toy has hit something; the trail stops there, as in Angry Birds. */
  leadHit = false;
  flightTime = 0;
  restTime = 0;
  boostTimer = 0;
  fuse = -1;

  /** The aim drag, in screen pixels from where the finger went down. */
  aimDx = 0;
  aimDy = 0;
  aiming = false;

  banditsLeft = 0;
  /** Bandits bonked since the last launch. Lets the raccoons laugh at a miss. */
  bonksThisShot = 0;
  score = 0;
  toysFired = 0;
  stars = 0;
  winTimer = -1;
  loseTimer = -1;

  /** Which toy each body is, by body id. Only meaningful for tag 'shot'. */
  readonly shotKind: ShotKind[] = new Array<ShotKind>(MAX_BODIES).fill('ball');

  /** Dotted trail of the current shot, and of the one before it. */
  readonly trail = new Float32Array(TRAIL_MAX * 2);
  trailCount = 0;
  readonly lastTrail = new Float32Array(TRAIL_MAX * 2);
  lastTrailCount = 0;
  private trailClock = 0;

  /** Time since the level started, for idle animation. */
  time = 0;

  private readonly events: GameEvent[] = [];
  private eventCount = 0;
  private readonly doomed: Body[] = [];
  /** Crates about to go off, so a chain goes BOOM-BOOM-BOOM rather than one big BOOM. */
  private readonly blastHits: Body[] = [];
  /** Read by the renderer, which shows each one as a crate glowing in its last moment. */
  readonly pendingBooms: { x: number; y: number; t: number }[] = [];

  constructor() {
    for (let i = 0; i < MAX_EVENTS; i++) {
      this.events.push({ kind: 'impact', x: 0, y: 0, a: 0, w: 0, h: 0, vx: 0, vy: 0, value: 0, mat: 0, tag: '' });
    }
    this.world.gravity = GRAVITY;
  }

  // --- Setup ----------------------------------------------------------------

  load(level: Level): void {
    const w = this.world;
    w.clear();
    this.level = level;
    const bounds = levelBounds(level);
    this.levelRight = bounds.right;
    this.levelTop = bounds.top;

    // The ground: one long static slab whose top surface is y = 0.
    w.create({
      tag: 'ground',
      shape: makeBox(150, 5),
      x: 60,
      y: 5,
      density: 0,
      friction: MATERIALS[MAT.ground]!.friction,
      restitution: 0,
      material: MAT.ground,
    });

    this.banditsLeft = 0;
    for (const p of level.pieces) {
      const mat = MATERIALS.findIndex((m) => m.id === p.material);
      const def = MATERIALS[mat]!;
      if (p.kind === 'platform') {
        w.create({
          tag: 'ground',
          shape: makeBox(p.w / 2, p.h / 2),
          x: p.x,
          y: -(p.base + p.h / 2),
          density: 0,
          friction: def.friction,
          restitution: 0,
          material: MAT.ground,
        });
      } else if (p.kind === 'bandit') {
        const r = p.w / 2;
        const scale = r / BANDIT_RADIUS;
        w.create({
          tag: 'bandit',
          shape: makeCircle(r),
          x: p.x,
          y: -(p.base + r),
          density: def.density,
          friction: def.friction,
          restitution: def.restitution,
          rollingResistance: 6,
          angularDamping: 1,
          awake: false,
          material: mat,
          hp: BANDIT_HP * scale * scale,
        });
        this.banditsLeft++;
      } else if (p.kind === 'tri') {
        const xs = p.flip ? [-p.w / 2, p.w / 2, -p.w / 2] : [-p.w / 2, p.w / 2, p.w / 2];
        const ys = [0, 0, -p.h];
        const cx = (xs[0]! + xs[1]! + xs[2]!) / 3;
        const cy = (ys[0]! + ys[1]! + ys[2]!) / 3;
        w.create({
          tag: 'block',
          shape: makePoly(xs, ys),
          x: p.x + cx,
          y: -p.base + cy,
          density: def.density,
          friction: def.friction,
          restitution: def.restitution,
          awake: false,
          material: mat,
          hp: (p.w * p.h * 0.5) * def.toughness,
        });
      } else {
        w.create({
          tag: p.kind === 'tnt' ? 'tnt' : 'block',
          shape: makeBox(p.w / 2, p.h / 2),
          x: p.x,
          y: -(p.base + p.h / 2),
          density: def.density,
          friction: def.friction,
          restitution: def.restitution,
          awake: false,
          material: mat,
          hp: p.kind === 'tnt' ? TNT_HP : p.w * p.h * def.toughness,
        });
      }
    }

    this.queue.length = 0;
    for (const s of level.shots) this.queue.push(s);
    this.flying.length = 0;
    this.score = 0;
    this.toysFired = 0;
    this.stars = 0;
    this.winTimer = -1;
    this.loseTimer = -1;
    this.trailCount = 0;
    this.lastTrailCount = 0;
    this.pendingBooms.length = 0;
    this.aiming = false;
    this.time = 0;
    this.eventCount = 0;
    this.phase = 'aim';
  }

  // --- Input from main.ts ---------------------------------------------------

  /** The finger is dragging the pouch; (dx, dy) is screen px from where it went down. */
  setAim(dx: number, dy: number): void {
    if (this.phase !== 'aim' || this.queue.length === 0) return;
    if (!this.aiming) this.emit('stretch', SLING_X, SLING_Y);
    this.aiming = true;
    this.aimDx = dx;
    this.aimDy = dy;
  }

  /**
   * 0..1, how hard the current pull is.
   *
   * A pull toward the forts (finger dragged right) is zero power, not a shot
   * fired backwards. Nobody means to shoot behind Ellie, and a toy wasted that
   * way is a toy she can't get back. Zero power means the release cancels.
   */
  aimPower(): number {
    if (this.aimDx >= 0) return 0;
    return Math.min(1, Math.hypot(this.aimDx, this.aimDy) / DRAG_FULL_PX);
  }

  /** Launch velocity for the current pull. Into `out` to avoid allocating. */
  aimVelocity(out: { x: number; y: number }): void {
    const len = Math.hypot(this.aimDx, this.aimDy);
    if (len < 1e-6) {
      out.x = 0;
      out.y = 0;
      return;
    }
    const speed = this.aimPower() * LAUNCH_SPEED;
    out.x = (-this.aimDx / len) * speed;
    out.y = (-this.aimDy / len) * speed;
  }

  cancelAim(): void {
    this.aiming = false;
    this.aimDx = 0;
    this.aimDy = 0;
  }

  /** The finger let go. Fires, unless the pull was too small to mean it. */
  release(): void {
    if (this.phase !== 'aim' || !this.aiming) return;
    if (this.aimPower() < DRAG_CANCEL) {
      this.cancelAim();
      return;
    }
    const v = { x: 0, y: 0 };
    this.aimVelocity(v);
    this.launch(v.x, v.y);
  }

  /** A tap while something is flying: use the toy's trick. */
  tap(): void {
    if (this.phase !== 'flight' || this.abilityUsed) return;
    const lead = this.flying[0];
    if (!lead || !lead.alive) return;
    const ability = SHOTS[this.current].ability;
    if (ability === 'none') return;
    this.useAbility(ability, lead);
  }

  // --- The tick -------------------------------------------------------------

  update(dt: number): void {
    if (this.phase !== 'aim' && this.phase !== 'flight' && this.phase !== 'won' && this.phase !== 'lost') return;
    this.time += dt;
    const w = this.world;
    w.savePoses();

    const sub = dt / PHYSICS_SUBSTEPS;
    for (let s = 0; s < PHYSICS_SUBSTEPS; s++) {
      w.step(sub);
      this.processImpacts();
    }
    this.processBooms(dt);
    this.cullOutOfBounds();

    if (this.phase === 'flight') this.updateFlight(dt);

    // Winning can happen at any moment — a block that was still falling from
    // the last shot can bonk the last bandit while the next toy is loaded.
    if (this.banditsLeft === 0 && this.winTimer < 0 && (this.phase === 'aim' || this.phase === 'flight')) {
      this.winTimer = 0;
    }
    if (this.winTimer >= 0 && this.phase !== 'won') {
      this.winTimer += dt;
      if (this.winTimer >= WIN_DELAY) this.win();
    }
    if (this.loseTimer >= 0 && this.phase === 'flight' && this.winTimer < 0) {
      this.loseTimer += dt;
      if (this.loseTimer >= LOSE_GRACE || (this.loseTimer > 1 && w.allAsleep())) this.lose();
    }
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;

    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) for (const b of this.flying) b.gravityScale = 1;
    }
    if (this.fuse >= 0) {
      this.fuse -= dt;
      const lead = this.flying[0];
      if (this.fuse < 0 && lead && lead.alive && !this.abilityUsed) this.useAbility('pop', lead);
    }

    // Trail of the lead toy.
    const lead = this.flying[0];
    this.trailClock += dt;
    if (lead && lead.alive && !this.leadHit && this.trailClock >= TRAIL_EVERY && this.trailCount < TRAIL_MAX) {
      this.trailClock = 0;
      this.trail[this.trailCount * 2] = lead.x;
      this.trail[this.trailCount * 2 + 1] = lead.y;
      this.trailCount++;
    }

    if (this.loseTimer >= 0) return;

    // Is this shot over?
    let moving = false;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i]!;
      if (!b.alive) {
        this.flying.splice(i, 1);
        continue;
      }
      if (b.awake && Math.hypot(b.vx, b.vy) > SHOT_REST_SPEED) moving = true;
    }
    this.restTime = moving ? 0 : this.restTime + dt;
    // An empty list (the toy popped, or flew off the level) counts as resting,
    // so the next toy still waits a moment instead of arriving mid-confetti.
    const over = this.restTime >= SHOT_REST_TIME || this.flightTime >= SHOT_MAX_TIME;
    if (!over || this.fuse >= 0) return;

    if (this.banditsLeft === 0) return; // the win timer is already running
    this.emit('shotover', 0, 0, this.bonksThisShot);
    if (this.queue.length > 0) {
      this.phase = 'aim';
      this.flying.length = 0;
    } else {
      this.loseTimer = 0;
    }
  }

  // --- Firing ---------------------------------------------------------------

  private launch(vx: number, vy: number): void {
    const kind = this.queue.shift()!;
    this.current = kind;
    this.flying.length = 0;
    const body = this.spawnToy(kind, SLING_X, SLING_Y, vx, vy);
    if (body) this.flying.push(body);
    this.abilityUsed = SHOTS[kind].ability === 'none';
    this.leadHit = false;
    this.bonksThisShot = 0;
    this.flightTime = 0;
    this.restTime = 0;
    this.boostTimer = 0;
    this.fuse = -1;
    this.toysFired++;
    this.aiming = false;

    // The previous shot's trail stays on screen, faintly, as a reference.
    this.lastTrail.set(this.trail);
    this.lastTrailCount = this.trailCount;
    this.trailCount = 0;
    this.trailClock = TRAIL_EVERY;

    this.phase = 'flight';
    this.emit('launch', SLING_X, SLING_Y, this.aimPower(), MAT.toy, kind);
  }

  private spawnToy(kind: ShotKind, x: number, y: number, vx: number, vy: number): Body | null {
    const def = SHOTS[kind];
    const body = this.world.create({
      tag: 'shot',
      shape: makeCircle(def.radius),
      x,
      y,
      vx,
      vy,
      // A little spin in the direction of travel, so it tumbles rather than slides.
      w: vx * 0.8,
      density: def.density,
      friction: MATERIALS[MAT.toy]!.friction,
      restitution: def.restitution,
      linearDamping: 0.02,
      angularDamping: 0.15,
      rollingResistance: 5,
      material: MAT.toy,
    });
    if (body) this.shotKind[body.id] = kind;
    return body;
  }

  private useAbility(ability: Ability, lead: Body): void {
    this.abilityUsed = true;
    this.emit('ability', lead.x, lead.y, 0, MAT.toy, ability);
    switch (ability) {
      case 'split': {
        const speed = Math.hypot(lead.vx, lead.vy);
        const angle = Math.atan2(lead.vy, lead.vx);
        // Offset sideways so the three don't start inside one another.
        const px = -Math.sin(angle);
        const py = Math.cos(angle);
        const gap = SHOTS.ducks.radius * 2.3;
        for (const side of [-1, 1]) {
          const a = angle + side * SPLIT_SPREAD;
          const b = this.spawnToy(
            'ducks',
            lead.x + px * gap * side,
            lead.y + py * gap * side,
            Math.cos(a) * speed,
            Math.sin(a) * speed,
          );
          if (b) this.flying.push(b);
        }
        break;
      }
      case 'boost': {
        const speed = Math.hypot(lead.vx, lead.vy) || 1;
        lead.vx = (lead.vx / speed) * BOOST_SPEED;
        lead.vy = (lead.vy / speed) * BOOST_SPEED;
        lead.gravityScale = 0;
        this.boostTimer = BOOST_FLOAT;
        break;
      }
      case 'slam':
        lead.vx *= 0.15;
        lead.vy = SLAM_SPEED;
        lead.w = 0;
        break;
      case 'pop':
        this.world.remove(lead);
        this.explode(lead.x, lead.y, FIRECRACKER_SCALE, 'toy');
        break;
      case 'none':
        break;
    }
  }

  // --- Damage ---------------------------------------------------------------

  private processImpacts(): void {
    const w = this.world;
    let reported = 0;
    for (let i = 0; i < w.impactCount; i++) {
      const im = w.impacts[i]!;
      this.damage(im.a, im.b, im.energy);
      this.damage(im.b, im.a, im.energy);

      const lead = this.flying[0];
      if (this.phase === 'flight' && lead && (im.a === lead || im.b === lead)) {
        this.leadHit = true;
        // A popper that hits anything starts its fuse.
        if (!this.abilityUsed && this.current === 'popper' && this.fuse < 0 && im.energy > DAMAGE_FLOOR_J) {
          this.fuse = POPPER_FUSE;
        }
      }

      // Only the louder hits make it out as events: the renderer turns them
      // into dust and sound, and a collapse produces hundreds of tiny ones.
      if (im.energy > 12 && reported < 6) {
        reported++;
        const hit = im.a.isStatic ? im.b : im.a;
        const other = hit === im.a ? im.b : im.a;
        // Report the more interesting material: a toy hitting glass is a glass sound.
        const mat = other.tag === 'shot' || other.isStatic ? hit.material : other.material;
        this.emit('impact', im.x, im.y, im.energy, mat, im.energy > BIG_IMPACT_J ? 'big' : '');
      }
    }
    this.flushDoomed();
  }

  private damage(target: Body, other: Body, energy: number, direct = 0): void {
    if (!target.alive || target.isStatic || target.tag === 'shot') return;
    let dmg = direct > 0 ? direct : energy - DAMAGE_FLOOR_J;
    if (dmg <= 0) return;
    if (other.tag === 'shot') {
      const vs = SHOTS[this.shotKind[other.id]!].vs;
      if (target.material === MAT.wood) dmg *= vs.wood;
      else if (target.material === MAT.glass) dmg *= vs.glass;
      else if (target.material === MAT.stone) dmg *= vs.stone;
    }
    target.hp -= dmg;
    if (target.hp <= 0 && !this.doomed.includes(target)) this.doomed.push(target);
  }

  private flushDoomed(): void {
    for (const b of this.doomed) {
      if (b.alive) this.destroy(b);
    }
    this.doomed.length = 0;
  }

  private destroy(b: Body): void {
    const w = this.world;
    if (b.tag === 'bandit') {
      w.remove(b);
      this.banditsLeft--;
      this.bonksThisShot++;
      this.score += SCORE_BANDIT;
      this.emit('bonk', b.x, b.y, SCORE_BANDIT, b.material, '', b.vx, b.vy, b.shape.kind === 'circle' ? b.shape.r : 0.4);
      return;
    }
    if (b.tag === 'tnt') {
      w.remove(b);
      this.score += SCORE_BLOCK;
      // The crate that was HIT goes off straight away; crates caught in a
      // blast are queued by explode() with a short delay instead.
      this.explode(b.x, b.y, 1, 'tnt');
      return;
    }

    // A block.
    this.score += SCORE_BLOCK;
    const def = MATERIALS[b.material]!;
    const s = b.shape;
    w.remove(b);
    if (s.kind !== 'poly') return;
    const isBox = s.vx.length === 4;
    const hw = isBox ? Math.abs(s.vx[1]!) : 0;
    const hh = isBox ? Math.abs(s.vy[2]!) : 0;
    const long = Math.max(hw, hh);

    if (isBox && def.splits && long >= 0.45) {
      // Split across the long axis into two real halves. They keep the parent's
      // motion — including the spin, as a velocity at each half's offset — so
      // a plank snapped mid-tumble keeps tumbling as two pieces.
      const alongX = hw >= hh;
      const nhw = alongX ? hw / 2 : hw;
      const nhh = alongX ? hh : hh / 2;
      const ox = alongX ? hw / 2 : 0;
      const oy = alongX ? 0 : hh / 2;
      for (const side of [-1, 1]) {
        const lx = ox * side;
        const ly = oy * side;
        const rx = b.cos * lx - b.sin * ly;
        const ry = b.sin * lx + b.cos * ly;
        w.create({
          tag: 'block',
          shape: makeBox(nhw, nhh),
          x: b.x + rx,
          y: b.y + ry,
          a: b.a,
          // A small kick apart along the break, so the halves visibly separate.
          vx: b.vx - b.w * ry + rx * 0.8,
          vy: b.vy + b.w * rx + ry * 0.8,
          w: b.w + side * 0.6,
          density: def.density,
          friction: def.friction,
          restitution: def.restitution,
          material: b.material,
          hp: nhw * nhh * 4 * def.toughness * 0.6,
        });
      }
      this.emit('break', b.x, b.y, 0, b.material, 'split', b.vx, b.vy, hw, hh, b.a);
      return;
    }
    // Shatter. The renderer turns this into a burst of shards.
    this.emit('break', b.x, b.y, 0, b.material, isBox ? 'box' : 'tri', b.vx, b.vy, isBox ? hw : 0.5, isBox ? hh : 0.5, b.a);
  }

  private processBooms(dt: number): void {
    for (let i = this.pendingBooms.length - 1; i >= 0; i--) {
      const p = this.pendingBooms[i]!;
      p.t -= dt;
      if (p.t <= 0) {
        this.pendingBooms.splice(i, 1);
        this.explode(p.x, p.y, 1, 'tnt');
      }
    }
  }

  /**
   * BOOM. A radial kick plus damage, both falling off to zero at the edge.
   *
   * Any TNT crate inside the blast doesn't take damage the normal way: it is
   * removed and queued to go off a moment later, so chains always chain and
   * always read as a sequence of separate bangs.
   */
  private explode(x: number, y: number, scale: number, source: 'tnt' | 'toy'): void {
    const radius = TNT_RADIUS * scale;
    this.emit('boom', x, y, radius, MAT.tnt, source);
    const w = this.world;
    // Collect first: the loop below removes crates, and removing while the
    // world is iterating its own list would skip bodies.
    const hits = this.blastHits;
    hits.length = 0;
    w.query(x, y, radius, (b) => hits.push(b));
    for (const b of hits) {
      if (b.isStatic || !b.alive) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      const f = 1 - d / radius;
      if (b.tag === 'tnt') {
        w.remove(b);
        this.score += SCORE_BLOCK;
        this.pendingBooms.push({ x: b.x, y: b.y, t: TNT_CHAIN_DELAY });
        continue;
      }
      const nx = d > 1e-6 ? dx / d : 0;
      // A slight upward bias: things thrown up and out look like an explosion,
      // things thrown sideways along the ground look like a shove.
      const ny = d > 1e-6 ? dy / d - 0.35 : -1;
      const dv = (TNT_SPEED * scale * f) / (1 + b.mass / TNT_HALF_MASS);
      const impulse = b.mass * dv;
      // Applied a touch off-centre, so things spin as they go.
      w.applyImpulse(b, b.x - nx * 0.1, b.y - ny * 0.1, nx * impulse, ny * impulse);
      if (b.tag !== 'shot') this.damage(b, b, 0, TNT_DAMAGE * scale * f);
    }
    this.flushDoomed();
  }

  private cullOutOfBounds(): void {
    const w = this.world;
    const right = this.levelRight + WORLD_KILL_MARGIN;
    for (const b of w.bodies) {
      if (!b.alive || b.isStatic) continue;
      if (b.x < -WORLD_KILL_MARGIN - 10 || b.x > right || b.y > 8 || b.y < -80) {
        if (b.tag === 'bandit') {
          this.destroy(b);
        } else {
          w.remove(b);
        }
      }
    }
  }

  // --- Ending ---------------------------------------------------------------

  private win(): void {
    const spare = this.queue.length;
    const used = this.level.shots.length - spare;
    this.score += spare * SCORE_SPARE_TOY;
    this.stars = used <= this.level.par ? 3 : used <= this.level.par + 1 ? 2 : 1;
    this.phase = 'won';
    this.emit('won', 0, 0, this.stars);
  }

  private lose(): void {
    this.phase = 'lost';
    this.emit('lost', 0, 0);
  }

  // --- Events ---------------------------------------------------------------

  private emit(
    kind: EventKind,
    x: number,
    y: number,
    value = 0,
    mat = 0,
    tag = '',
    vx = 0,
    vy = 0,
    w = 0,
    h = 0,
    a = 0,
  ): void {
    if (this.eventCount >= MAX_EVENTS) return;
    const e = this.events[this.eventCount++]!;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.value = value;
    e.mat = mat;
    e.tag = tag;
    e.vx = vx;
    e.vy = vy;
    e.w = w;
    e.h = h;
    e.a = a;
  }

  drainEvents(consume: (e: GameEvent) => void): void {
    for (let i = 0; i < this.eventCount; i++) consume(this.events[i]!);
    this.eventCount = 0;
  }
}
