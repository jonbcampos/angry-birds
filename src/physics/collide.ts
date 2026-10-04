import type { Body, PolyShape } from './body';

/**
 * Narrowphase: does A touch B, and where?
 *
 * The output is a *manifold* — up to two contact points sharing one normal —
 * and the two-point part is what makes stacking work at all. A plank lying on
 * another plank touches along a whole edge. Report one point and the solver
 * sees a plank balanced on a pin, and it rocks forever. Report both ends of the
 * overlap and it sits flat. This is the clip-against-reference-face method from
 * Box2D, and it is the single most important routine in the engine.
 *
 * Each point carries a feature `id` naming which edge and vertex produced it.
 * The world matches ids between steps so last step's impulse can be reused as
 * this step's first guess (warm starting). Without stable ids, a tall stack
 * re-solves from zero every 1/240s and slowly shivers itself apart.
 */

export interface ContactPoint {
  /** World position, midway between the two surfaces. */
  x: number;
  y: number;
  /** Negative when overlapping. */
  sep: number;
  id: number;
}

export interface Manifold {
  count: number;
  /** Unit normal pointing from A to B. */
  nx: number;
  ny: number;
  points: [ContactPoint, ContactPoint];
}

export function emptyManifold(): Manifold {
  return {
    count: 0,
    nx: 0,
    ny: 0,
    points: [
      { x: 0, y: 0, sep: 0, id: 0 },
      { x: 0, y: 0, sep: 0, id: 0 },
    ],
  };
}

/** Contacts are reported slightly before touching, so a resting body never loses its contact. */
const SPECULATIVE = 0.02;

export function collide(a: Body, b: Body, out: Manifold): void {
  out.count = 0;
  const sa = a.shape;
  const sb = b.shape;
  if (sa.kind === 'circle' && sb.kind === 'circle') return circleCircle(a, b, sa.r, sb.r, out);
  if (sa.kind === 'poly' && sb.kind === 'circle') return polyCircle(a, sa, b, sb.r, out, false);
  if (sa.kind === 'circle' && sb.kind === 'poly') return polyCircle(b, sb, a, sa.r, out, true);
  if (sa.kind === 'poly' && sb.kind === 'poly') return polyPoly(a, sa, b, sb, out);
}

function circleCircle(a: Body, b: Body, ra: number, rb: number, out: Manifold): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const sep = dist - ra - rb;
  if (sep > SPECULATIVE) return;
  const nx = dist > 1e-9 ? dx / dist : 0;
  const ny = dist > 1e-9 ? dy / dist : -1;
  out.count = 1;
  out.nx = nx;
  out.ny = ny;
  const p = out.points[0];
  // Midpoint of the two surface points.
  p.x = a.x + nx * (ra + sep * 0.5);
  p.y = a.y + ny * (ra + sep * 0.5);
  p.sep = sep;
  p.id = 0;
}

function polyCircle(
  pb: Body,
  poly: PolyShape,
  cb: Body,
  r: number,
  out: Manifold,
  flip: boolean,
): void {
  // Circle centre in the polygon's local frame.
  const dx = cb.x - pb.x;
  const dy = cb.y - pb.y;
  const cx = pb.cos * dx + pb.sin * dy;
  const cy = -pb.sin * dx + pb.cos * dy;

  // Face of greatest separation.
  let sepMax = -Infinity;
  let face = 0;
  const n = poly.vx.length;
  for (let i = 0; i < n; i++) {
    const s = poly.nx[i]! * (cx - poly.vx[i]!) + poly.ny[i]! * (cy - poly.vy[i]!);
    if (s > r + SPECULATIVE) return;
    if (s > sepMax) {
      sepMax = s;
      face = i;
    }
  }

  const i1 = face;
  const i2 = (face + 1) % n;
  const v1x = poly.vx[i1]!;
  const v1y = poly.vy[i1]!;
  const v2x = poly.vx[i2]!;
  const v2y = poly.vy[i2]!;

  let lnx: number;
  let lny: number;
  let lpx: number;
  let lpy: number;
  let sep: number;

  // Which Voronoi region of the face is the centre in: either vertex, or the face?
  const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
  const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
  if (sepMax < 1e-9) {
    // Centre is inside the polygon: push out through the nearest face.
    lnx = poly.nx[face]!;
    lny = poly.ny[face]!;
    sep = sepMax - r;
    lpx = cx - lnx * (r + sep * 0.5);
    lpy = cy - lny * (r + sep * 0.5);
  } else if (u1 <= 0) {
    const d = Math.hypot(cx - v1x, cy - v1y);
    sep = d - r;
    if (sep > SPECULATIVE) return;
    lnx = (cx - v1x) / d;
    lny = (cy - v1y) / d;
    lpx = v1x + lnx * sep * 0.5;
    lpy = v1y + lny * sep * 0.5;
  } else if (u2 <= 0) {
    const d = Math.hypot(cx - v2x, cy - v2y);
    sep = d - r;
    if (sep > SPECULATIVE) return;
    lnx = (cx - v2x) / d;
    lny = (cy - v2y) / d;
    lpx = v2x + lnx * sep * 0.5;
    lpy = v2y + lny * sep * 0.5;
  } else {
    lnx = poly.nx[face]!;
    lny = poly.ny[face]!;
    sep = sepMax - r;
    lpx = cx - lnx * (r + sep * 0.5);
    lpy = cy - lny * (r + sep * 0.5);
  }

  // Back to world space. The local normal points from polygon to circle.
  let nx = pb.cos * lnx - pb.sin * lny;
  let ny = pb.sin * lnx + pb.cos * lny;
  if (flip) {
    nx = -nx;
    ny = -ny;
  }
  out.count = 1;
  out.nx = nx;
  out.ny = ny;
  const p = out.points[0];
  p.x = pb.x + pb.cos * lpx - pb.sin * lpy;
  p.y = pb.y + pb.sin * lpx + pb.cos * lpy;
  p.sep = sep;
  p.id = face;
}

// --- Polygon vs polygon -----------------------------------------------------

/** Scratch, so the hot path allocates nothing. */
const clipX = [0, 0];
const clipY = [0, 0];
const clipId = [0, 0];
const outX = [0, 0];
const outY = [0, 0];
const outId = [0, 0];
let maxSepEdge = 0;

/**
 * Largest separation of B along any of A's face normals, and which face.
 * Positive means a separating axis exists and the shapes cannot be touching.
 */
function findMaxSeparation(a: Body, pa: PolyShape, b: Body, pb: PolyShape): number {
  let best = -Infinity;
  let bestEdge = 0;
  const na = pa.vx.length;
  const nb = pb.vx.length;
  for (let i = 0; i < na; i++) {
    // A's face normal and vertex, in world space.
    const nx = a.cos * pa.nx[i]! - a.sin * pa.ny[i]!;
    const ny = a.sin * pa.nx[i]! + a.cos * pa.ny[i]!;
    const vx = a.x + a.cos * pa.vx[i]! - a.sin * pa.vy[i]!;
    const vy = a.y + a.sin * pa.vx[i]! + a.cos * pa.vy[i]!;
    let si = Infinity;
    for (let j = 0; j < nb; j++) {
      const wx = b.x + b.cos * pb.vx[j]! - b.sin * pb.vy[j]!;
      const wy = b.y + b.sin * pb.vx[j]! + b.cos * pb.vy[j]!;
      const s = nx * (wx - vx) + ny * (wy - vy);
      if (s < si) si = s;
    }
    if (si > best) {
      best = si;
      bestEdge = i;
    }
  }
  maxSepEdge = bestEdge;
  return best;
}

/** Keep the part of segment (clipX/Y) on the inner side of a plane. Returns points kept. */
function clipSegment(nx: number, ny: number, offset: number, sideId: number): number {
  let count = 0;
  const d0 = nx * clipX[0]! + ny * clipY[0]! - offset;
  const d1 = nx * clipX[1]! + ny * clipY[1]! - offset;
  if (d0 <= 0) {
    outX[count] = clipX[0]!;
    outY[count] = clipY[0]!;
    outId[count] = clipId[0]!;
    count++;
  }
  if (d1 <= 0) {
    outX[count] = clipX[1]!;
    outY[count] = clipY[1]!;
    outId[count] = clipId[1]!;
    count++;
  }
  if (d0 * d1 < 0 && count < 2) {
    const t = d0 / (d0 - d1);
    outX[count] = clipX[0]! + t * (clipX[1]! - clipX[0]!);
    outY[count] = clipY[0]! + t * (clipY[1]! - clipY[0]!);
    outId[count] = 64 + sideId;
    count++;
  }
  for (let i = 0; i < count; i++) {
    clipX[i] = outX[i]!;
    clipY[i] = outY[i]!;
    clipId[i] = outId[i]!;
  }
  return count;
}

function polyPoly(a: Body, pa: PolyShape, b: Body, pb: PolyShape, out: Manifold): void {
  const sepA = findMaxSeparation(a, pa, b, pb);
  if (sepA > SPECULATIVE) return;
  const edgeA = maxSepEdge;
  const sepB = findMaxSeparation(b, pb, a, pa);
  if (sepB > SPECULATIVE) return;
  const edgeB = maxSepEdge;

  // Prefer A as the reference unless B is clearly better. The tolerance stops
  // the choice flickering between two near-equal faces, which would change the
  // feature ids every step and defeat warm starting.
  let refB: Body;
  let ref: PolyShape;
  let incB: Body;
  let inc: PolyShape;
  let edge: number;
  let flip: boolean;
  if (sepB > sepA + 0.0005) {
    refB = b;
    ref = pb;
    incB = a;
    inc = pa;
    edge = edgeB;
    flip = true;
  } else {
    refB = a;
    ref = pa;
    incB = b;
    inc = pb;
    edge = edgeA;
    flip = false;
  }

  // Reference face normal in world space.
  const rnx = refB.cos * ref.nx[edge]! - refB.sin * ref.ny[edge]!;
  const rny = refB.sin * ref.nx[edge]! + refB.cos * ref.ny[edge]!;

  // Incident edge: the face on the other body most anti-parallel to it.
  let minDot = Infinity;
  let incEdge = 0;
  const ni = inc.vx.length;
  for (let i = 0; i < ni; i++) {
    const nx = incB.cos * inc.nx[i]! - incB.sin * inc.ny[i]!;
    const ny = incB.sin * inc.nx[i]! + incB.cos * inc.ny[i]!;
    const d = nx * rnx + ny * rny;
    if (d < minDot) {
      minDot = d;
      incEdge = i;
    }
  }
  const i1 = incEdge;
  const i2 = (incEdge + 1) % ni;
  clipX[0] = incB.x + incB.cos * inc.vx[i1]! - incB.sin * inc.vy[i1]!;
  clipY[0] = incB.y + incB.sin * inc.vx[i1]! + incB.cos * inc.vy[i1]!;
  clipId[0] = i1;
  clipX[1] = incB.x + incB.cos * inc.vx[i2]! - incB.sin * inc.vy[i2]!;
  clipY[1] = incB.y + incB.sin * inc.vx[i2]! + incB.cos * inc.vy[i2]!;
  clipId[1] = i2;

  // Reference face endpoints, and the tangent running along it.
  const nr = ref.vx.length;
  const r2 = (edge + 1) % nr;
  const v1x = refB.x + refB.cos * ref.vx[edge]! - refB.sin * ref.vy[edge]!;
  const v1y = refB.y + refB.sin * ref.vx[edge]! + refB.cos * ref.vy[edge]!;
  const v2x = refB.x + refB.cos * ref.vx[r2]! - refB.sin * ref.vy[r2]!;
  const v2y = refB.y + refB.sin * ref.vx[r2]! + refB.cos * ref.vy[r2]!;
  let tx = v2x - v1x;
  let ty = v2y - v1y;
  const tl = Math.hypot(tx, ty);
  tx /= tl;
  ty /= tl;

  // Trim the incident edge to the reference face's width, both sides.
  if (clipSegment(-tx, -ty, -(tx * v1x + ty * v1y), 0) < 2) return;
  if (clipSegment(tx, ty, tx * v2x + ty * v2y, 1) < 2) return;

  const front = rnx * v1x + rny * v1y;
  const nx = flip ? -rnx : rnx;
  const ny = flip ? -rny : rny;
  out.nx = nx;
  out.ny = ny;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const sep = rnx * clipX[i]! + rny * clipY[i]! - front;
    if (sep > SPECULATIVE) continue;
    const p = out.points[count];
    // Halfway between the incident point and its projection on the reference face.
    p.x = clipX[i]! - rnx * sep * 0.5;
    p.y = clipY[i]! - rny * sep * 0.5;
    p.sep = sep;
    p.id = (flip ? 1024 : 0) + edge * 128 + clipId[i]!;
    count++;
  }
  out.count = count;
}
