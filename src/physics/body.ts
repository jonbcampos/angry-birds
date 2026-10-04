/**
 * A rigid body: a convex shape with mass, a position, an angle, and velocity.
 *
 * Units are metres, kilograms and seconds, and y grows DOWNWARD to match the
 * canvas. The solver is tuned for objects between roughly 0.1m and 10m — the
 * same range Box2D is tuned for, and for the same reason: below it, contact
 * slop and penetration tolerances become a visible fraction of the object;
 * above it, gravity looks like the moon. That is why the game simulates in
 * metres and the renderer scales to pixels, instead of simulating in pixels.
 *
 * `x, y` is always the centre of MASS, not the centre of the bounding box.
 * Polygons are re-centred on their centroid when built, so a triangle rotates
 * about the point it physically balances on.
 */

export interface CircleShape {
  kind: 'circle';
  r: number;
}

export interface PolyShape {
  kind: 'poly';
  /** Local vertices, counter-clockwise in a y-down world, centred on the centroid. */
  vx: number[];
  vy: number[];
  /** Outward edge normals; normal i belongs to the edge from vertex i to i+1. */
  nx: number[];
  ny: number[];
  /** Bounding radius about the centroid. Cheap reject in the broadphase. */
  bound: number;
}

export type Shape = CircleShape | PolyShape;

/** What a body is in the game. The physics engine never reads this. */
export type BodyTag = 'ground' | 'block' | 'bandit' | 'shot' | 'tnt';

export interface Body {
  /** Stable for the body's lifetime; reused after it dies. */
  id: number;
  alive: boolean;
  tag: BodyTag;

  shape: Shape;
  isStatic: boolean;

  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  w: number;

  /** Last step's pose, for render interpolation. */
  px: number;
  py: number;
  pa: number;

  cos: number;
  sin: number;

  mass: number;
  invMass: number;
  invI: number;

  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  /**
   * Rolling resistance, as an angular deceleration in rad/s² applied while the
   * body is touching something. Without it a ball on flat ground rolls forever,
   * because ideal Coulomb friction does no work on a rolling contact.
   */
  rollingResistance: number;
  /** Scales gravity. A shot that boosts sets this to zero for a moment. */
  gravityScale: number;

  awake: boolean;
  sleepTime: number;
  /** Set when the body touched anything this step. Read by rolling resistance. */
  touching: boolean;

  aabbMinX: number;
  aabbMinY: number;
  aabbMaxX: number;
  aabbMaxY: number;

  /** Game data. The engine carries these and never interprets them. */
  material: number;
  hp: number;
  maxHp: number;
  /** The game's own index for this body (shot slot, block variant...). */
  user: number;
}

export function makeCircle(r: number): CircleShape {
  return { kind: 'circle', r };
}

export function makeBox(hw: number, hh: number): PolyShape {
  return makePoly([-hw, hw, hw, -hw], [-hh, -hh, hh, hh]);
}

/**
 * A convex polygon from vertices in any order that is consistent.
 *
 * Re-centred on its centroid so the body's position is its centre of mass.
 * Winding is normalised so normals always point outward: for y-down, that is
 * the order in which (edge.y, -edge.x) points away from the centroid.
 */
export function makePoly(xs: number[], ys: number[]): PolyShape {
  const n = xs.length;
  const { cx, cy } = polyCentroid(xs, ys);
  const vx = xs.map((x) => x - cx);
  const vy = ys.map((y) => y - cy);

  // Signed area decides winding. Flip to the order whose normals face out.
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += vx[i]! * vy[j]! - vx[j]! * vy[i]!;
  }
  if (area2 < 0) {
    vx.reverse();
    vy.reverse();
  }

  const nx: number[] = [];
  const ny: number[] = [];
  let bound = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = vx[j]! - vx[i]!;
    const ey = vy[j]! - vy[i]!;
    const len = Math.hypot(ex, ey);
    nx.push(ey / len);
    ny.push(-ex / len);
    bound = Math.max(bound, Math.hypot(vx[i]!, vy[i]!));
  }
  return { kind: 'poly', vx, vy, nx, ny, bound };
}

function polyCentroid(xs: number[], ys: number[]): { cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = xs[i]! * ys[j]! - xs[j]! * ys[i]!;
    a += cross;
    cx += (xs[i]! + xs[j]!) * cross;
    cy += (ys[i]! + ys[j]!) * cross;
  }
  a *= 0.5;
  return { cx: cx / (6 * a), cy: cy / (6 * a) };
}

/** Area and moment of inertia about the centroid, for unit density. */
export function shapeMass(shape: Shape): { area: number; inertia: number } {
  if (shape.kind === 'circle') {
    const area = Math.PI * shape.r * shape.r;
    return { area, inertia: (area * shape.r * shape.r) / 2 };
  }
  // Sum of triangles fanned from the centroid (which is the origin here).
  let area = 0;
  let inertia = 0;
  const n = shape.vx.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = shape.vx[i]!;
    const y1 = shape.vy[i]!;
    const x2 = shape.vx[j]!;
    const y2 = shape.vy[j]!;
    const cross = Math.abs(x1 * y2 - x2 * y1);
    area += cross / 2;
    inertia += (cross / 12) * (x1 * x1 + x1 * x2 + x2 * x2 + y1 * y1 + y1 * y2 + y2 * y2);
  }
  return { area, inertia };
}

export function emptyBody(id: number): Body {
  return {
    id,
    alive: false,
    tag: 'block',
    shape: makeCircle(1),
    isStatic: false,
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    w: 0,
    px: 0,
    py: 0,
    pa: 0,
    cos: 1,
    sin: 0,
    mass: 0,
    invMass: 0,
    invI: 0,
    friction: 0.5,
    restitution: 0,
    linearDamping: 0,
    angularDamping: 0,
    rollingResistance: 0,
    gravityScale: 1,
    awake: true,
    sleepTime: 0,
    touching: false,
    aabbMinX: 0,
    aabbMinY: 0,
    aabbMaxX: 0,
    aabbMaxY: 0,
    material: 0,
    hp: 0,
    maxHp: 0,
    user: 0,
  };
}

export function syncTransform(b: Body): void {
  b.cos = Math.cos(b.a);
  b.sin = Math.sin(b.a);
}

export function updateAabb(b: Body, margin: number): void {
  const s = b.shape;
  if (s.kind === 'circle') {
    b.aabbMinX = b.x - s.r - margin;
    b.aabbMaxX = b.x + s.r + margin;
    b.aabbMinY = b.y - s.r - margin;
    b.aabbMaxY = b.y + s.r + margin;
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < s.vx.length; i++) {
    const wx = b.x + b.cos * s.vx[i]! - b.sin * s.vy[i]!;
    const wy = b.y + b.sin * s.vx[i]! + b.cos * s.vy[i]!;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  b.aabbMinX = minX - margin;
  b.aabbMaxX = maxX + margin;
  b.aabbMinY = minY - margin;
  b.aabbMaxY = maxY + margin;
}
