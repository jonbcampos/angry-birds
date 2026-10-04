import {
  emptyBody,
  shapeMass,
  syncTransform,
  updateAabb,
  type Body,
  type BodyTag,
  type Shape,
} from './body';
import { collide, emptyManifold, type Manifold } from './collide';

/**
 * A small rigid-body engine, in the shape of Box2D v2 and tuned for a toy
 * slingshot game rather than for generality.
 *
 * One step is:
 *
 *   1. integrate velocities (gravity, damping)
 *   2. find touching pairs, and refresh their contact manifolds
 *   3. wake or skip whole *islands* of touching bodies
 *   4. solve contacts as velocity constraints (sequential impulses, warm started)
 *   5. apply restitution as its own pass
 *   6. integrate positions
 *   7. push apart anything still overlapping (non-linear Gauss-Seidel)
 *   8. put islands that have stopped moving to sleep
 *
 * The parts that matter for how it *feels*, and why each one is here:
 *
 * - **Warm starting.** Every contact remembers last step's impulse and starts
 *   from it. A stack of ten blocks needs the weight of nine to arrive at the
 *   bottom contact, and without warm starting that information propagates one
 *   block per iteration, so tall towers sag and shiver.
 *
 * - **Position correction is separate from velocity.** Overlap is fixed by
 *   moving bodies directly (step 7) rather than by adding a push velocity. A
 *   push velocity is energy, and energy injected at the bottom of a stack comes
 *   out at the top as a block that hops. This is the difference between towers
 *   that stand still and towers that "breathe".
 *
 * - **Restitution is its own pass, from the approach speed measured before the
 *   solve.** Done inside the main iterations, a contact that was detected a
 *   moment early (speculatively) arrives with no approach speed left and never
 *   bounces at all.
 *
 * - **Sleeping is by island.** A body only sleeps when everything touching it
 *   has also stopped. Sleep one block on its own and the block above it
 *   hovers when the one below is knocked out.
 */

export interface BodyDef {
  tag: BodyTag;
  shape: Shape;
  x: number;
  y: number;
  a?: number;
  vx?: number;
  vy?: number;
  w?: number;
  /** kg per square metre. Zero makes a static body. */
  density: number;
  friction: number;
  restitution: number;
  linearDamping?: number;
  angularDamping?: number;
  rollingResistance?: number;
  awake?: boolean;
  material?: number;
  hp?: number;
  user?: number;
}

export interface Impact {
  a: Body;
  b: Body;
  /** Approach speed along the normal, m/s. Always positive. */
  speed: number;
  /** Kinetic energy of the approach, in joules, using the pair's reduced mass. */
  energy: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

interface ContactPointState {
  id: number;
  // Offsets from each centre of mass, world space, fixed for the step.
  rAx: number;
  rAy: number;
  rBx: number;
  rBy: number;
  // Surface points in each body's local frame, for position correction.
  lAx: number;
  lAy: number;
  lBx: number;
  lBy: number;
  sep: number;
  normalMass: number;
  tangentMass: number;
  pn: number;
  pt: number;
  maxPn: number;
  /** Relative normal velocity before the solve. Negative means approaching. */
  relVel: number;
}

interface Arbiter {
  key: number;
  a: Body;
  b: Body;
  count: number;
  nx: number;
  ny: number;
  /** The normal in A's local frame, so position correction can rotate it. */
  lnx: number;
  lny: number;
  friction: number;
  restitution: number;
  touched: boolean;
  points: [ContactPointState, ContactPointState];
}

// --- Tuning -----------------------------------------------------------------
// Physical tolerances, not gameplay numbers, which is why they live here and
// not in game/config.ts. Changing them changes how the engine behaves, not how
// the game plays.

/** Overlap the solver tolerates without correcting. Stops resting contacts flickering. */
const LINEAR_SLOP = 0.005;
/** Fraction of the remaining overlap fixed per position iteration. */
const BAUMGARTE = 0.2;
const MAX_CORRECTION = 0.2;
/** Below this approach speed, nothing bounces. Stops resting bodies buzzing. */
const RESTITUTION_THRESHOLD = 1;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const AABB_MARGIN = 0.05;
const MAX_TRANSLATION = 2;
const MAX_ROTATION = Math.PI / 2;

const SLEEP_LINEAR = 0.06;
const SLEEP_ANGULAR = 0.08;
const TIME_TO_SLEEP = 0.5;

/**
 * Raised from 256 for the TNT Playground: a giant fort is 100-plus pieces before
 * anything breaks, and every snapped plank becomes two.
 */
export const MAX_BODIES = 512;
const MAX_ARBITERS = 4096;
const MAX_IMPACTS = 256;

function pairKey(a: Body, b: Body): number {
  return a.id < b.id ? a.id * MAX_BODIES + b.id : b.id * MAX_BODIES + a.id;
}

function emptyPoint(): ContactPointState {
  return {
    id: -1,
    rAx: 0,
    rAy: 0,
    rBx: 0,
    rBy: 0,
    lAx: 0,
    lAy: 0,
    lBx: 0,
    lBy: 0,
    sep: 0,
    normalMass: 0,
    tangentMass: 0,
    pn: 0,
    pt: 0,
    maxPn: 0,
    relVel: 0,
  };
}

export class World {
  gravity = 10;

  readonly bodies: Body[] = [];
  /** Alive body ids, kept roughly sorted by AABB left edge for the sweep. */
  private order: number[] = [];

  private readonly arbiterPool: Arbiter[] = [];
  private readonly freeArbiters: Arbiter[] = [];
  private readonly arbiters = new Map<number, Arbiter>();
  private readonly manifold: Manifold = emptyManifold();

  /** Union-find parent per body id, rebuilt every step. */
  private readonly parent = new Int32Array(MAX_BODIES);
  private readonly islandAwake = new Uint8Array(MAX_BODIES);
  private readonly islandMinSleep = new Float64Array(MAX_BODIES);

  readonly impacts: Impact[] = [];
  impactCount = 0;

  constructor() {
    for (let i = 0; i < MAX_BODIES; i++) this.bodies.push(emptyBody(i));
    for (let i = 0; i < MAX_ARBITERS; i++) {
      const arb: Arbiter = {
        key: 0,
        a: this.bodies[0]!,
        b: this.bodies[0]!,
        count: 0,
        nx: 0,
        ny: 0,
        lnx: 0,
        lny: 0,
        friction: 0,
        restitution: 0,
        touched: false,
        points: [emptyPoint(), emptyPoint()],
      };
      this.arbiterPool.push(arb);
      this.freeArbiters.push(arb);
    }
    for (let i = 0; i < MAX_IMPACTS; i++) {
      this.impacts.push({ a: this.bodies[0]!, b: this.bodies[0]!, speed: 0, energy: 0, x: 0, y: 0, nx: 0, ny: 0 });
    }
  }

  clear(): void {
    for (const b of this.bodies) b.alive = false;
    this.order.length = 0;
    for (const arb of this.arbiters.values()) this.freeArbiters.push(arb);
    this.arbiters.clear();
    this.impactCount = 0;
  }

  create(def: BodyDef): Body | null {
    let body: Body | null = null;
    for (const b of this.bodies) {
      if (!b.alive) {
        body = b;
        break;
      }
    }
    if (!body) return null;

    body.alive = true;
    body.tag = def.tag;
    body.shape = def.shape;
    body.x = body.px = def.x;
    body.y = body.py = def.y;
    body.a = body.pa = def.a ?? 0;
    body.vx = def.vx ?? 0;
    body.vy = def.vy ?? 0;
    body.w = def.w ?? 0;
    body.friction = def.friction;
    body.restitution = def.restitution;
    body.linearDamping = def.linearDamping ?? 0;
    body.angularDamping = def.angularDamping ?? 0;
    body.rollingResistance = def.rollingResistance ?? 0;
    body.gravityScale = 1;
    body.material = def.material ?? 0;
    body.hp = body.maxHp = def.hp ?? 0;
    body.user = def.user ?? 0;
    body.touching = false;
    body.sleepTime = 0;

    if (def.density <= 0) {
      body.isStatic = true;
      body.mass = 0;
      body.invMass = 0;
      body.invI = 0;
      body.awake = false;
    } else {
      const { area, inertia } = shapeMass(def.shape);
      body.isStatic = false;
      body.mass = area * def.density;
      body.invMass = 1 / body.mass;
      body.invI = 1 / (inertia * def.density);
      body.awake = def.awake ?? true;
    }
    syncTransform(body);
    updateAabb(body, AABB_MARGIN);
    this.order.push(body.id);
    return body;
  }

  /** Remove a body. Anything that was resting on it wakes up and falls. */
  remove(body: Body): void {
    if (!body.alive) return;
    for (const [key, arb] of this.arbiters) {
      if (arb.a === body || arb.b === body) {
        this.wake(arb.a === body ? arb.b : arb.a);
        this.arbiters.delete(key);
        this.freeArbiters.push(arb);
      }
    }
    body.alive = false;
    const i = this.order.indexOf(body.id);
    if (i >= 0) this.order.splice(i, 1);
  }

  wake(body: Body): void {
    if (body.isStatic || !body.alive) return;
    body.awake = true;
    body.sleepTime = 0;
  }

  applyImpulse(body: Body, px: number, py: number, ix: number, iy: number): void {
    if (body.isStatic) return;
    this.wake(body);
    body.vx += ix * body.invMass;
    body.vy += iy * body.invMass;
    body.w += body.invI * ((px - body.x) * iy - (py - body.y) * ix);
  }

  /** Every live body whose AABB touches a circle. */
  query(x: number, y: number, r: number, visit: (b: Body) => void): void {
    for (const id of this.order) {
      const b = this.bodies[id]!;
      if (b.aabbMaxX < x - r || b.aabbMinX > x + r) continue;
      if (b.aabbMaxY < y - r || b.aabbMinY > y + r) continue;
      visit(b);
    }
  }

  /** Remember this pose as the one to interpolate from. Call once per game tick. */
  savePoses(): void {
    for (const id of this.order) {
      const b = this.bodies[id]!;
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    }
  }

  /** True when nothing dynamic is moving. Used to decide that a shot is over. */
  allAsleep(): boolean {
    for (const id of this.order) {
      const b = this.bodies[id]!;
      if (!b.isStatic && b.awake) return false;
    }
    return true;
  }

  step(dt: number): void {
    this.impactCount = 0;
    const bodies = this.bodies;
    const order = this.order;

    // 1. Velocities.
    for (const id of order) {
      const b = bodies[id]!;
      if (b.isStatic || !b.awake) continue;
      b.vy += this.gravity * b.gravityScale * dt;
      b.vx *= 1 / (1 + dt * b.linearDamping);
      b.vy *= 1 / (1 + dt * b.linearDamping);
      b.w *= 1 / (1 + dt * b.angularDamping);
      if (b.touching && b.rollingResistance > 0) {
        const dw = b.rollingResistance * dt;
        b.w = Math.abs(b.w) <= dw ? 0 : b.w - Math.sign(b.w) * dw;
      }
      b.touching = false;
    }

    // 2. Pairs.
    this.findContacts();

    // 3. Islands.
    this.buildIslands();

    // 4. Prepare contacts, warm start, iterate.
    const invDt = 1 / dt;
    for (const arb of this.arbiters.values()) {
      if (!this.active(arb)) continue;
      this.prepare(arb);
    }
    for (let it = 0; it < VELOCITY_ITERATIONS; it++) {
      for (const arb of this.arbiters.values()) {
        if (this.active(arb)) this.solveVelocity(arb, invDt);
      }
    }

    // 5. Restitution, then record the impacts the game cares about.
    for (const arb of this.arbiters.values()) {
      if (!this.active(arb)) continue;
      this.applyRestitution(arb);
      this.recordImpact(arb);
    }

    // 6. Positions.
    for (const id of order) {
      const b = bodies[id]!;
      if (b.isStatic || !b.awake) continue;
      let tx = b.vx * dt;
      let ty = b.vy * dt;
      const t2 = tx * tx + ty * ty;
      if (t2 > MAX_TRANSLATION * MAX_TRANSLATION) {
        const s = MAX_TRANSLATION / Math.sqrt(t2);
        b.vx *= s;
        b.vy *= s;
        tx *= s;
        ty *= s;
      }
      let rot = b.w * dt;
      if (Math.abs(rot) > MAX_ROTATION) {
        b.w *= MAX_ROTATION / Math.abs(rot);
        rot = b.w * dt;
      }
      b.x += tx;
      b.y += ty;
      b.a += rot;
      syncTransform(b);
    }

    // 7. Overlap.
    for (let it = 0; it < POSITION_ITERATIONS; it++) {
      let worst = 0;
      for (const arb of this.arbiters.values()) {
        if (this.active(arb)) worst = Math.min(worst, this.solvePosition(arb));
      }
      if (worst >= -3 * LINEAR_SLOP) break;
    }

    // 8. Sleep.
    this.updateSleep(dt);

    for (const id of order) {
      const b = bodies[id]!;
      if (!b.isStatic && b.awake) updateAabb(b, AABB_MARGIN);
    }
  }

  // --- Broadphase and narrowphase -----------------------------------------

  private findContacts(): void {
    const bodies = this.bodies;
    const order = this.order;

    // Insertion sort by left edge. The order barely changes between steps, so
    // this is close to linear, and it makes the sweep below cheap.
    for (let i = 1; i < order.length; i++) {
      const id = order[i]!;
      const key = bodies[id]!.aabbMinX;
      let j = i - 1;
      while (j >= 0 && bodies[order[j]!]!.aabbMinX > key) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = id;
    }

    for (const arb of this.arbiters.values()) arb.touched = false;

    for (let i = 0; i < order.length; i++) {
      const a = bodies[order[i]!]!;
      for (let j = i + 1; j < order.length; j++) {
        const b = bodies[order[j]!]!;
        if (b.aabbMinX > a.aabbMaxX) break;
        if (b.aabbMinY > a.aabbMaxY || b.aabbMaxY < a.aabbMinY) continue;
        if (a.isStatic && b.isStatic) continue;

        const aMoving = !a.isStatic && a.awake;
        const bMoving = !b.isStatic && b.awake;
        const key = pairKey(a, b);
        const existing = this.arbiters.get(key);

        // Nothing here can move: keep whatever we knew, so the island
        // structure survives for when something does wake it.
        if (!aMoving && !bMoving) {
          if (existing) existing.touched = true;
          continue;
        }

        // Fixed order (lower id is A) so the normal never flips between steps.
        const first = a.id < b.id ? a : b;
        const second = a.id < b.id ? b : a;
        collide(first, second, this.manifold);
        if (this.manifold.count === 0) continue;

        // An awake body touching a sleeping one wakes it.
        if (!aMoving && !a.isStatic) this.wake(a);
        if (!bMoving && !b.isStatic) this.wake(b);

        this.updateArbiter(existing, key, first, second);
      }
    }

    for (const [key, arb] of this.arbiters) {
      if (!arb.touched) {
        this.arbiters.delete(key);
        this.freeArbiters.push(arb);
      }
    }
  }

  private updateArbiter(existing: Arbiter | undefined, key: number, a: Body, b: Body): void {
    let arb = existing;
    if (!arb) {
      arb = this.freeArbiters.pop();
      // Pool exhausted: drop the contact rather than allocate. Never seen in
      // play — 2048 is about ten times the busiest level — and the cost of
      // hitting it is a body passing through another for one step.
      if (!arb) return;
      arb.key = key;
      arb.a = a;
      arb.b = b;
      arb.count = 0;
      this.arbiters.set(key, arb);
    }
    arb.touched = true;
    const m = this.manifold;

    // Carry impulses across by feature id.
    const old0 = arb.points[0];
    const old1 = arb.points[1];
    const oldCount = arb.count;
    const id0 = old0.id;
    const id1 = old1.id;
    const pn0 = old0.pn;
    const pt0 = old0.pt;
    const pn1 = old1.pn;
    const pt1 = old1.pt;

    arb.count = m.count;
    arb.nx = m.nx;
    arb.ny = m.ny;
    arb.lnx = a.cos * m.nx + a.sin * m.ny;
    arb.lny = -a.sin * m.nx + a.cos * m.ny;
    arb.friction = Math.sqrt(a.friction * b.friction);
    arb.restitution = Math.max(a.restitution, b.restitution);

    for (let i = 0; i < m.count; i++) {
      const src = m.points[i]!;
      const p = arb.points[i]!;
      p.id = src.id;
      p.sep = src.sep;
      p.pn = 0;
      p.pt = 0;
      if (oldCount > 0 && src.id === id0) {
        p.pn = pn0;
        p.pt = pt0;
      } else if (oldCount > 1 && src.id === id1) {
        p.pn = pn1;
        p.pt = pt1;
      }
      p.rAx = src.x - a.x;
      p.rAy = src.y - a.y;
      p.rBx = src.x - b.x;
      p.rBy = src.y - b.y;

      // Surface points: A's is half the separation back along the normal, B's
      // half forward. Stored locally so they follow each body during position
      // correction.
      const sAx = src.x - m.nx * src.sep * 0.5 - a.x;
      const sAy = src.y - m.ny * src.sep * 0.5 - a.y;
      const sBx = src.x + m.nx * src.sep * 0.5 - b.x;
      const sBy = src.y + m.ny * src.sep * 0.5 - b.y;
      p.lAx = a.cos * sAx + a.sin * sAy;
      p.lAy = -a.sin * sAx + a.cos * sAy;
      p.lBx = b.cos * sBx + b.sin * sBy;
      p.lBy = -b.sin * sBx + b.cos * sBy;
    }
  }

  // --- Islands --------------------------------------------------------------

  private find(i: number): number {
    const parent = this.parent;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }

  private buildIslands(): void {
    const parent = this.parent;
    for (const id of this.order) parent[id] = id;
    for (const arb of this.arbiters.values()) {
      if (arb.count === 0 || arb.a.isStatic || arb.b.isStatic) continue;
      const ra = this.find(arb.a.id);
      const rb = this.find(arb.b.id);
      if (ra !== rb) parent[ra] = rb;
    }
    for (const id of this.order) this.islandAwake[id] = 0;
    for (const id of this.order) {
      const b = this.bodies[id]!;
      if (!b.isStatic && b.awake) this.islandAwake[this.find(id)] = 1;
    }
    for (const id of this.order) {
      const b = this.bodies[id]!;
      if (!b.isStatic && !b.awake && this.islandAwake[this.find(id)]) this.wake(b);
    }
  }

  private updateSleep(dt: number): void {
    const bodies = this.bodies;
    for (const id of this.order) this.islandMinSleep[id] = Infinity;
    for (const id of this.order) {
      const b = bodies[id]!;
      if (b.isStatic || !b.awake) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > SLEEP_LINEAR * SLEEP_LINEAR || b.w * b.w > SLEEP_ANGULAR * SLEEP_ANGULAR) {
        b.sleepTime = 0;
      } else {
        b.sleepTime += dt;
      }
      const root = this.find(id);
      this.islandMinSleep[root] = Math.min(this.islandMinSleep[root]!, b.sleepTime);
    }
    for (const id of this.order) {
      const b = bodies[id]!;
      if (b.isStatic || !b.awake) continue;
      if (this.islandMinSleep[this.find(id)]! >= TIME_TO_SLEEP) {
        b.awake = false;
        b.vx = 0;
        b.vy = 0;
        b.w = 0;
      }
    }
  }

  // --- Solver ---------------------------------------------------------------

  private active(arb: Arbiter): boolean {
    return arb.count > 0 && ((!arb.a.isStatic && arb.a.awake) || (!arb.b.isStatic && arb.b.awake));
  }

  private prepare(arb: Arbiter): void {
    const a = arb.a;
    const b = arb.b;
    const nx = arb.nx;
    const ny = arb.ny;
    const tx = ny;
    const ty = -nx;
    a.touching = true;
    b.touching = true;
    for (let i = 0; i < arb.count; i++) {
      const p = arb.points[i]!;
      const rnA = p.rAx * ny - p.rAy * nx;
      const rnB = p.rBx * ny - p.rBy * nx;
      const kn = a.invMass + b.invMass + a.invI * rnA * rnA + b.invI * rnB * rnB;
      p.normalMass = kn > 0 ? 1 / kn : 0;
      const rtA = p.rAx * ty - p.rAy * tx;
      const rtB = p.rBx * ty - p.rBy * tx;
      const kt = a.invMass + b.invMass + a.invI * rtA * rtA + b.invI * rtB * rtB;
      p.tangentMass = kt > 0 ? 1 / kt : 0;

      const dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy;
      const dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      p.relVel = dvx * nx + dvy * ny;
      p.maxPn = 0;

      // Warm start.
      const px = p.pn * nx + p.pt * tx;
      const py = p.pn * ny + p.pt * ty;
      a.vx -= a.invMass * px;
      a.vy -= a.invMass * py;
      a.w -= a.invI * (p.rAx * py - p.rAy * px);
      b.vx += b.invMass * px;
      b.vy += b.invMass * py;
      b.w += b.invI * (p.rBx * py - p.rBy * px);
    }
  }

  private solveVelocity(arb: Arbiter, invDt: number): void {
    const a = arb.a;
    const b = arb.b;
    const nx = arb.nx;
    const ny = arb.ny;
    const tx = ny;
    const ty = -nx;

    for (let i = 0; i < arb.count; i++) {
      const p = arb.points[i]!;

      // Friction first, bounded by the normal impulse we already have.
      let dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy;
      let dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      const vt = dvx * tx + dvy * ty;
      const maxF = arb.friction * p.pn;
      const newPt = clamp(p.pt - p.tangentMass * vt, -maxF, maxF);
      let lambda = newPt - p.pt;
      p.pt = newPt;
      let px = lambda * tx;
      let py = lambda * ty;
      a.vx -= a.invMass * px;
      a.vy -= a.invMass * py;
      a.w -= a.invI * (p.rAx * py - p.rAy * px);
      b.vx += b.invMass * px;
      b.vy += b.invMass * py;
      b.w += b.invI * (p.rBx * py - p.rBy * px);

      // Normal. A speculative contact (still apart) allows exactly enough
      // approach to close the gap this step and no more.
      dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy;
      dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      const vn = dvx * nx + dvy * ny;
      const target = p.sep > 0 ? -p.sep * invDt : 0;
      const newPn = Math.max(p.pn - p.normalMass * (vn - target), 0);
      lambda = newPn - p.pn;
      p.pn = newPn;
      if (newPn > p.maxPn) p.maxPn = newPn;
      px = lambda * nx;
      py = lambda * ny;
      a.vx -= a.invMass * px;
      a.vy -= a.invMass * py;
      a.w -= a.invI * (p.rAx * py - p.rAy * px);
      b.vx += b.invMass * px;
      b.vy += b.invMass * py;
      b.w += b.invI * (p.rBx * py - p.rBy * px);
    }
  }

  private applyRestitution(arb: Arbiter): void {
    if (arb.restitution === 0) return;
    const a = arb.a;
    const b = arb.b;
    const nx = arb.nx;
    const ny = arb.ny;
    for (let i = 0; i < arb.count; i++) {
      const p = arb.points[i]!;
      if (p.relVel > -RESTITUTION_THRESHOLD || p.maxPn === 0) continue;
      const dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy;
      const dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      const vn = dvx * nx + dvy * ny;
      const newPn = Math.max(p.pn - p.normalMass * (vn + arb.restitution * p.relVel), 0);
      const lambda = newPn - p.pn;
      p.pn = newPn;
      const px = lambda * nx;
      const py = lambda * ny;
      a.vx -= a.invMass * px;
      a.vy -= a.invMass * py;
      a.w -= a.invI * (p.rAx * py - p.rAy * px);
      b.vx += b.invMass * px;
      b.vy += b.invMass * py;
      b.w += b.invI * (p.rBx * py - p.rBy * px);
    }
  }

  private recordImpact(arb: Arbiter): void {
    // The fastest point that actually pushed. A speculative contact that never
    // closed is not a hit, however fast it was approaching.
    let speed = 0;
    let best = -1;
    for (let i = 0; i < arb.count; i++) {
      const p = arb.points[i]!;
      if (p.maxPn > 0 && -p.relVel > speed) {
        speed = -p.relVel;
        best = i;
      }
    }
    if (best < 0 || speed < RESTITUTION_THRESHOLD) return;
    if (this.impactCount >= MAX_IMPACTS) return;
    const a = arb.a;
    const b = arb.b;
    const reduced =
      a.isStatic ? b.mass : b.isStatic ? a.mass : (a.mass * b.mass) / (a.mass + b.mass);
    const im = this.impacts[this.impactCount++]!;
    const p = arb.points[best]!;
    im.a = a;
    im.b = b;
    im.speed = speed;
    im.energy = 0.5 * reduced * speed * speed;
    im.x = a.x + p.rAx;
    im.y = a.y + p.rAy;
    im.nx = arb.nx;
    im.ny = arb.ny;
  }

  /** Returns the worst separation seen, so the caller can stop early. */
  private solvePosition(arb: Arbiter): number {
    const a = arb.a;
    const b = arb.b;
    const mA = a.awake ? a.invMass : 0;
    const iA = a.awake ? a.invI : 0;
    const mB = b.awake ? b.invMass : 0;
    const iB = b.awake ? b.invI : 0;
    let worst = 0;

    for (let i = 0; i < arb.count; i++) {
      const p = arb.points[i]!;
      const nx = a.cos * arb.lnx - a.sin * arb.lny;
      const ny = a.sin * arb.lnx + a.cos * arb.lny;
      const sAx = a.x + a.cos * p.lAx - a.sin * p.lAy;
      const sAy = a.y + a.sin * p.lAx + a.cos * p.lAy;
      const sBx = b.x + b.cos * p.lBx - b.sin * p.lBy;
      const sBy = b.y + b.sin * p.lBx + b.cos * p.lBy;
      const sep = (sBx - sAx) * nx + (sBy - sAy) * ny;
      if (sep < worst) worst = sep;

      const C = clamp(BAUMGARTE * (sep + LINEAR_SLOP), -MAX_CORRECTION, 0);
      if (C === 0) continue;
      const cx = (sAx + sBx) * 0.5;
      const cy = (sAy + sBy) * 0.5;
      const rAx = cx - a.x;
      const rAy = cy - a.y;
      const rBx = cx - b.x;
      const rBy = cy - b.y;
      const rnA = rAx * ny - rAy * nx;
      const rnB = rBx * ny - rBy * nx;
      const k = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      if (k <= 0) continue;
      const impulse = -C / k;
      const px = impulse * nx;
      const py = impulse * ny;
      a.x -= mA * px;
      a.y -= mA * py;
      a.a -= iA * (rAx * py - rAy * px);
      b.x += mB * px;
      b.y += mB * py;
      b.a += iB * (rBx * py - rBy * px);
      if (mA > 0 || iA > 0) syncTransform(a);
      if (mB > 0 || iB > 0) syncTransform(b);
    }
    return worst;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
