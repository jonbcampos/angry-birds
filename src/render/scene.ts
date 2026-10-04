import type { Body } from '../physics/body';
import { GRAVITY, PREVIEW_DOTS, PREVIEW_SECONDS, SCREEN, SLING_X, SLING_Y } from '../game/config';
import { MAT, SHOTS, type ShotKind } from '../game/content';
import type { GameState } from '../game/state';
import { camera, sx, sy } from './camera';
import { PALETTE, alpha } from './palette';
import type { Cast, ElliePose, Mood } from './cast';
import { PKind, type Particles } from './particles';

/**
 * Draws one frame of a level. Reads the game state; never changes it.
 *
 * Bodies are drawn in METRES: each one translates and rotates the context to
 * its own pose and scales by `camera.scale`, so a painter says "a plank 2m long"
 * rather than computing pixels. `px` is one screen pixel in those units, for
 * line widths that must stay crisp at every zoom.
 */

let px = 1;
const vel = { x: 0, y: 0 };

export function drawScene(ctx: CanvasRenderingContext2D, state: GameState, alphaT: number, particles: Particles, cast: Cast): void {
  px = 1 / camera.scale;
  drawBackdrop(ctx, state.time);
  drawGround(ctx);

  const w = state.world;
  for (const b of w.bodies) {
    // Ledges and hills; the one enormous slab under everything is drawn as the ground strip.
    if (b.alive && b.isStatic && b.shape.kind === 'poly' && Math.abs(b.shape.vx[0]!) < 100) drawLedge(ctx, b);
  }

  drawScorch(ctx, particles);
  drawTrail(ctx, state.lastTrail, state.lastTrailCount, 0.35);
  drawTrail(ctx, state.trail, state.trailCount, 0.75);

  drawWaitingToys(ctx, state);
  drawSlingBack(ctx);
  drawEllie(ctx, state, cast);

  for (const b of w.bodies) {
    if (!b.alive || b.isStatic) continue;
    if (b.tag === 'block') drawBlock(ctx, b, alphaT);
    else if (b.tag === 'tnt') drawTnt(ctx, b, alphaT, state.time);
  }
  for (const b of w.bodies) {
    if (!b.alive || b.isStatic) continue;
    if (b.tag === 'bandit') drawBandit(ctx, b, alphaT, cast);
    else if (b.tag === 'shot') drawFlyingToy(ctx, state, b, alphaT);
  }

  drawPouch(ctx, state);
  drawParticles(ctx, particles);
  drawBubble(ctx, state, cast);
  if (state.phase === 'aim' && state.aiming) drawPreview(ctx, state);
  drawOffscreen(ctx, state);

  if (camera.flash > 0) {
    ctx.fillStyle = `rgba(255,250,230,${(camera.flash * 0.6).toFixed(3)})`;
    ctx.fillRect(-20, -20, SCREEN.w + 40, SCREEN.h + 40);
  }
}

/** Burn marks go under everything, so they are drawn in their own early pass. */
function drawScorch(ctx: CanvasRenderingContext2D, particles: Particles): void {
  for (const p of particles.pool) {
    if (!p.alive || p.kind !== PKind.Scorch) continue;
    const f = Math.min(1, p.life / 2);
    ctx.fillStyle = alpha('#2a1d14', 0.55 * f);
    ctx.beginPath();
    ctx.ellipse(sx(p.x), sy(p.y) + 1, p.size * camera.scale, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Backdrop ---------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, SCREEN.h);
  g.addColorStop(0, PALETTE.skyTop);
  g.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, SCREEN.w + 40, SCREEN.h + 40);

  // Sun.
  ctx.fillStyle = alpha(PALETTE.sun, 0.35);
  ctx.beginPath();
  ctx.arc(SCREEN.w - 70, 46, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.sun;
  ctx.beginPath();
  ctx.arc(SCREEN.w - 70, 46, 20, 0, Math.PI * 2);
  ctx.fill();

  // Clouds, drifting very slowly.
  ctx.fillStyle = alpha(PALETTE.cloud, 0.9);
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 157 + t * (3 + i)) % (SCREEN.w + 120)) - 60;
    const cy = 30 + ((i * 37) % 60);
    cloud(ctx, cx, cy, 1 + (i % 2) * 0.4);
  }

  // Rolling hills, rounded and hazed so they never read as part of a fort.
  const base = camera.groundY;
  hills(ctx, base, 46, 0.011, 0, PALETTE.hillFar);
  hills(ctx, base, 26, 0.019, 2, PALETTE.hillNear);
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 9 * s, 0, Math.PI * 2);
  ctx.arc(x + 11 * s, y - 5 * s, 11 * s, 0, Math.PI * 2);
  ctx.arc(x + 24 * s, y, 9 * s, 0, Math.PI * 2);
  ctx.rect(x, y, 24 * s, 8 * s);
  ctx.fill();
}

function hills(ctx: CanvasRenderingContext2D, base: number, height: number, freq: number, phase: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10, base);
  for (let x = -10; x <= SCREEN.w + 10; x += 8) {
    const h = height * (0.6 + 0.4 * Math.sin(x * freq + phase) * Math.sin(x * freq * 0.37 + phase * 2));
    ctx.lineTo(x, base - h);
  }
  ctx.lineTo(SCREEN.w + 10, base);
  ctx.fill();
}

function drawGround(ctx: CanvasRenderingContext2D): void {
  const y = camera.groundY + camera.shakeY;
  ctx.fillStyle = PALETTE.dirt;
  ctx.fillRect(-20, y, SCREEN.w + 40, SCREEN.h - y + 20);
  ctx.fillStyle = PALETTE.dirtDark;
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % (SCREEN.w + 20);
    ctx.fillRect(x + camera.shakeX, y + 8 + ((i * 13) % 20), 3, 2);
  }
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(-20, y - 1, SCREEN.w + 40, 6);
  ctx.fillStyle = PALETTE.grassLight;
  ctx.fillRect(-20, y - 1, SCREEN.w + 40, 2);
}

function drawLedge(ctx: CanvasRenderingContext2D, b: Body): void {
  if (b.shape.kind !== 'poly') return;
  const hw = Math.abs(b.shape.vx[0]!);
  const hh = Math.abs(b.shape.vy[0]!);
  const x0 = sx(b.x - hw);
  const y0 = sy(b.y - hh);
  const w = hw * 2 * camera.scale;
  const h = hh * 2 * camera.scale;
  ctx.fillStyle = PALETTE.ledge;
  ctx.fillRect(x0, y0, w, h + 2);
  ctx.fillStyle = PALETTE.dirtDark;
  for (let i = 0; i < w / 14; i++) ctx.fillRect(x0 + 5 + i * 14, y0 + 8 + ((i * 7) % Math.max(1, h - 10)), 3, 2);
  ctx.fillStyle = PALETTE.ledgeTop;
  ctx.fillRect(x0 - 1, y0 - 1, w + 2, 5);
}

// --- Trails and aiming ------------------------------------------------------

function drawTrail(ctx: CanvasRenderingContext2D, pts: Float32Array, count: number, a: number): void {
  ctx.fillStyle = alpha(PALETTE.trail, a);
  for (let i = 0; i < count; i++) {
    const r = i % 3 === 0 ? 1.6 : 1;
    ctx.beginPath();
    ctx.arc(sx(pts[i * 2]!), sy(pts[i * 2 + 1]!), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The flight path, drawn from the same equation the physics will follow. It
 * ignores collisions, so it is exactly right until the toy hits something —
 * which is the moment she stops needing it.
 */
function drawPreview(ctx: CanvasRenderingContext2D, state: GameState): void {
  state.aimVelocity(vel);
  const pull = pouchOffset(state);
  const x0 = SLING_X + pull.x;
  const y0 = SLING_Y + pull.y;
  for (let i = 1; i <= PREVIEW_DOTS; i++) {
    const t = (i / PREVIEW_DOTS) * PREVIEW_SECONDS;
    const x = x0 + vel.x * t;
    const y = y0 + vel.y * t + 0.5 * GRAVITY * t * t;
    if (y > 0) break;
    const fade = 1 - i / (PREVIEW_DOTS + 4);
    ctx.fillStyle = alpha(PALETTE.aimDot, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 2.4 * fade + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

const pull = { x: 0, y: 0 };
/** Where the pouch is pulled to, in metres from its rest point. */
function pouchOffset(state: GameState): { x: number; y: number } {
  if (state.phase !== 'aim' || !state.aiming) {
    pull.x = 0;
    pull.y = 0;
    return pull;
  }
  const len = Math.hypot(state.aimDx, state.aimDy) || 1;
  const p = state.aimPower() * 1.6;
  pull.x = (state.aimDx / len) * p;
  pull.y = (state.aimDy / len) * p;
  return pull;
}

function drawOffscreen(ctx: CanvasRenderingContext2D, state: GameState): void {
  const lead = state.flying[0];
  if (!lead || !lead.alive) return;
  const y = sy(lead.y);
  if (y > -4) return;
  const x = sx(lead.x);
  ctx.fillStyle = alpha('#ffffff', 0.85);
  ctx.beginPath();
  ctx.moveTo(x, 3);
  ctx.lineTo(x - 6, 12);
  ctx.lineTo(x + 6, 12);
  ctx.fill();
}

// --- Ellie and the slingshot ------------------------------------------------

/** World-space fork tips, where the bands are tied. */
const FORK_L = { x: SLING_X - 0.32, y: SLING_Y - 0.2 };
const FORK_R = { x: SLING_X + 0.3, y: SLING_Y - 0.25 };

function drawSlingBack(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = 'round';
  // Trunk and the back (left) arm.
  ctx.strokeStyle = PALETTE.slingWoodDark;
  ctx.lineWidth = 0.22 * camera.scale;
  line(ctx, SLING_X - 0.05, 0, SLING_X, SLING_Y + 0.9);
  line(ctx, SLING_X, SLING_Y + 0.9, FORK_L.x, FORK_L.y);
  ctx.strokeStyle = PALETTE.slingWood;
  ctx.lineWidth = 0.16 * camera.scale;
  line(ctx, SLING_X - 0.05, 0, SLING_X, SLING_Y + 0.9);
}

function drawPouch(ctx: CanvasRenderingContext2D, state: GameState): void {
  const off = pouchOffset(state);
  const pxw = SLING_X + off.x;
  const pyw = SLING_Y + off.y;
  const loaded = state.phase === 'aim' && state.queue.length > 0 && state.winTimer < 0;

  // Back band, toy, then the front band and arm over the top — so the toy
  // sits IN the slingshot rather than pasted on it.
  ctx.lineCap = 'round';
  ctx.strokeStyle = PALETTE.band;
  ctx.lineWidth = Math.max(1.5, 0.09 * camera.scale);
  line(ctx, FORK_L.x, FORK_L.y, pxw - 0.2, pyw);

  if (loaded) {
    const kind = state.queue[0]!;
    const r = SHOTS[kind].radius;
    ctx.save();
    ctx.translate(sx(pxw), sy(pyw));
    ctx.scale(camera.scale, camera.scale);
    paintToy(ctx, kind, r, 0, Math.atan2(-off.y, -off.x || -1e-6), state.time, false);
    ctx.restore();
  }

  ctx.strokeStyle = PALETTE.band;
  line(ctx, FORK_R.x, FORK_R.y, pxw + 0.15, pyw);
  ctx.fillStyle = PALETTE.band;
  ctx.fillRect(sx(pxw - 0.25), sy(pyw) - 1.5, 0.45 * camera.scale, 3);

  ctx.strokeStyle = PALETTE.slingWoodDark;
  ctx.lineWidth = 0.22 * camera.scale;
  line(ctx, SLING_X, SLING_Y + 0.9, FORK_R.x, FORK_R.y);
  ctx.strokeStyle = PALETTE.slingWood;
  ctx.lineWidth = 0.13 * camera.scale;
  line(ctx, SLING_X, SLING_Y + 0.9, FORK_R.x, FORK_R.y);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(sx(x0), sy(y0));
  ctx.lineTo(sx(x1), sy(y1));
  ctx.stroke();
}

/**
 * Ellie, standing behind her slingshot. Drawn in metres about her feet.
 * While aiming, her arm follows the pouch; after a launch she cheers.
 */
function drawEllie(ctx: CanvasRenderingContext2D, state: GameState, cast: Cast): void {
  const fx = SLING_X - 1.25;
  const off = pouchOffset(state);
  ctx.save();
  ctx.translate(sx(fx), sy(0));
  ctx.scale(camera.scale, camera.scale);
  paintEllie(ctx, cast.elliePose(state), cast.time, SLING_X + off.x - fx - 0.2, SLING_Y + off.y);
  ctx.restore();
}

/**
 * Ellie in one pose, in metres, with her feet at the origin. `handX/handY` is
 * where her reaching hand goes while aiming. Exported for the dev gallery.
 */
export function paintEllie(ctx: CanvasRenderingContext2D, pose: ElliePose, t: number, handX: number, handY: number): void {
  // Breathing, a jump for a cheer, a shake for a giggle.
  let lift = Math.sin(t * 2.2) * 0.02;
  if (pose === 'cheer') lift = -Math.abs(Math.sin(t * 8)) * 0.18;
  let shakeX = pose === 'ew' ? Math.sin(t * 30) * 0.02 : 0;
  if (pose === 'tease') shakeX = Math.sin(t * 9) * 0.015;

  ctx.save();
  ctx.translate(shakeX, lift);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Legs.
  ctx.strokeStyle = PALETTE.ellieLegs;
  ctx.lineWidth = 0.17;
  ctx.beginPath();
  ctx.moveTo(-0.12, -lift);
  ctx.lineTo(-0.08, -0.6);
  ctx.moveTo(0.14, -lift);
  ctx.lineTo(0.08, -0.6);
  ctx.stroke();

  // Shirt. Shoulders come up for a shrug.
  const shrug = pose === 'sad' ? -0.06 : 0;
  ctx.fillStyle = PALETTE.ellieShirt;
  roundRect(ctx, -0.25, -1.25 + shrug, 0.5, 0.7 - shrug, 0.14);
  ctx.fill();

  // Arms: shoulder -> elbow -> hand, per pose. Coordinates in metres from her feet.
  const hy = -1.5 + shrug;
  const wave = Math.sin(t * 14) * 0.12;
  type Arm = [number, number, number, number];
  const arms: Record<string, [Arm, Arm]> = {
    // [elbowX, elbowY, handX, handY] for the front arm (towards the forts), then the back arm.
    ready: [[0.36, -0.98, 0.22, -0.8], [-0.36, -0.98, -0.22, -0.8]],
    aim: [
      [0.45, -1.15, Math.min(handX, 1.3), Math.max(handY, -2.1)],
      [-0.3, -0.95, -0.35, -0.75],
    ],
    go: [[0.45, -1.2, 0.78, -1.3], [-0.32, -0.95, -0.4, -0.8]],
    cheer: [[0.3, -1.55, 0.36, -1.95], [-0.3, -1.55, -0.36, -1.95]],
    tease: [[0.3, -1.3, 0.2, hy + 0.05], [-0.36, -0.98, -0.22, -0.8]],
    ew: [[0.32, -1.25, 0.26, hy + 0.02], [0.5, -1.15, 0.55 + wave, -1.45]],
    amazed: [[0.3, -1.25, 0.2, hy + 0.08], [-0.3, -1.25, -0.2, hy + 0.08]],
    sad: [[0.38, -1.0, 0.52, -1.1], [-0.38, -1.0, -0.52, -1.1]],
  };
  const [front, back] = arms[pose] ?? arms.ready!;
  ctx.strokeStyle = PALETTE.ellieSkin;
  ctx.lineWidth = 0.11;
  for (const [arm, sxh] of [
    [back, -0.18],
    [front, 0.18],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sxh, -1.12 + shrug);
    ctx.lineTo(arm[0], arm[1]);
    ctx.lineTo(arm[2], arm[3]);
    ctx.stroke();
  }

  // Head, hair, ponytail.
  ctx.fillStyle = PALETTE.ellieHair;
  ctx.beginPath();
  ctx.ellipse(-0.34, hy - 0.06, 0.14, 0.22, 0.5 + Math.sin(t * 3) * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.ellieSkin;
  ctx.beginPath();
  ctx.arc(0, hy, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.ellieHair;
  ctx.beginPath();
  ctx.arc(0, hy - 0.04, 0.27, Math.PI * 1.05, Math.PI * 2.05);
  ctx.fill();

  // Eyes, looking toward the forts.
  ctx.fillStyle = '#2a1a10';
  ctx.strokeStyle = '#2a1a10';
  ctx.lineWidth = 0.03;
  const squeezed = pose === 'cheer' || pose === 'ew';
  for (const ex of [0.1, 0.2]) {
    ctx.beginPath();
    if (squeezed) {
      ctx.moveTo(ex - 0.04, hy + 0.03);
      ctx.lineTo(ex, hy - 0.01);
      ctx.lineTo(ex + 0.04, hy + 0.03);
      ctx.stroke();
    } else {
      ctx.arc(ex, hy + 0.02, pose === 'amazed' ? 0.05 : 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mouth.
  ctx.strokeStyle = '#a0404a';
  ctx.fillStyle = '#7a2030';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  switch (pose) {
    case 'cheer':
    case 'go':
    case 'ew':
      ctx.arc(0.15, hy + 0.1, 0.07, 0, Math.PI);
      ctx.fill();
      break;
    case 'amazed':
      ctx.ellipse(0.15, hy + 0.13, 0.045, 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sad':
      ctx.arc(0.15, hy + 0.17, 0.05, Math.PI + 0.3, -0.3);
      ctx.stroke();
      break;
    case 'tease':
      // Tongue out right back at them.
      ctx.moveTo(0.09, hy + 0.12);
      ctx.lineTo(0.21, hy + 0.12);
      ctx.stroke();
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.ellipse(0.16, hy + 0.19 + Math.sin(t * 20) * 0.012, 0.055, 0.085, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.arc(0.15, hy + 0.12, 0.05, 0.2, Math.PI - 0.2);
      ctx.stroke();
  }

  // A bow.
  ctx.fillStyle = '#ff5fa2';
  ctx.beginPath();
  ctx.arc(-0.2, hy - 0.22, 0.07, 0, Math.PI * 2);
  ctx.arc(-0.08, hy - 0.26, 0.07, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * The one speech bubble allowed on screen. It follows its raccoon if he's
 * still there, pops in, and fades out.
 */
function drawBubble(ctx: CanvasRenderingContext2D, state: GameState, cast: Cast): void {
  const bub = cast.bubble;
  if (!bub) return;
  let x = bub.x;
  let y = bub.y;
  const body = bub.who >= 0 ? state.world.bodies[bub.who] : undefined;
  if (body && body.alive && body.tag === 'bandit') {
    x = body.x;
    y = body.y;
  }
  const age = cast.time - bub.born;
  const pop = age < 0.12 ? 0.5 + (age / 0.12) * 0.6 : age < 0.2 ? 1.1 - ((age - 0.12) / 0.08) * 0.1 : 1;
  const fade = Math.min(1, (bub.life - age) / 0.25);
  const bx = sx(x);
  const by = sy(y - bub.r) - 14;

  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.font = 'bold 9px "SF Mono", "Roboto Mono", ui-monospace, monospace';
  const w = ctx.measureText(bub.text).width + 10;
  const h = 14;
  const cx = Math.max(w / 2 + 2, Math.min(SCREEN.w - w / 2 - 2, bx));
  ctx.translate(cx, by);
  ctx.scale(pop, pop);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = PALETTE.hudShadow;
  ctx.lineWidth = 1.2;
  roundRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.stroke();
  // Tail, pointing down at the speaker.
  ctx.beginPath();
  ctx.moveTo(bx - cx - 3, h / 2 - 0.5);
  ctx.lineTo(bx - cx, h / 2 + 5);
  ctx.lineTo(bx - cx + 3, h / 2 - 0.5);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3a2a4a';
  ctx.fillText(bub.text, 0, 0.5);
  ctx.restore();
}

/** The toys still to come, lined up on the grass behind Ellie. */
function drawWaitingToys(ctx: CanvasRenderingContext2D, state: GameState): void {
  // While aiming, the front of the queue is in the pouch, not on the grass.
  const start = state.phase === 'aim' ? 1 : 0;
  // Lay the line out front to back, then draw it back to front, so each toy
  // tucks slightly behind the one ahead of it and a long queue still fits.
  let x = SLING_X - 1.75;
  const xs = queueX;
  for (let i = start; i < state.queue.length; i++) {
    const r = SHOTS[state.queue[i]!].radius;
    x -= r * 0.85;
    xs[i] = x;
    x -= r * 0.85 + 0.05;
  }
  for (let i = state.queue.length - 1; i >= start; i--) {
    const kind = state.queue[i]!;
    const r = SHOTS[kind].radius;
    ctx.save();
    ctx.translate(sx(xs[i]!), sy(-r));
    ctx.scale(camera.scale, camera.scale);
    // A little hop, in turn, so the line looks eager rather than parked.
    const hop = Math.max(0, Math.sin(state.time * 3 - i * 0.8)) * 0.12;
    ctx.translate(0, -hop);
    paintToy(ctx, kind, r, 0, 0, state.time, false);
    ctx.restore();
  }
}
const queueX: number[] = new Array<number>(16).fill(0);

// --- Blocks -----------------------------------------------------------------

function pose(ctx: CanvasRenderingContext2D, b: Body, t: number): void {
  const x = b.px + (b.x - b.px) * t;
  const y = b.py + (b.y - b.py) * t;
  const a = b.pa + (b.a - b.pa) * t;
  ctx.translate(sx(x), sy(y));
  ctx.scale(camera.scale, camera.scale);
  ctx.rotate(a);
}

function polyPath(ctx: CanvasRenderingContext2D, b: Body, inset = 0): void {
  if (b.shape.kind !== 'poly') return;
  const s = b.shape;
  ctx.beginPath();
  for (let i = 0; i < s.vx.length; i++) {
    const vx = s.vx[i]!;
    const vy = s.vy[i]!;
    const d = Math.hypot(vx, vy) || 1;
    const k = inset > 0 ? Math.max(0, 1 - inset / d) : 1;
    if (i === 0) ctx.moveTo(vx * k, vy * k);
    else ctx.lineTo(vx * k, vy * k);
  }
  ctx.closePath();
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Body, t: number): void {
  if (b.shape.kind !== 'poly') return;
  ctx.save();
  pose(ctx, b, t);
  const s = b.shape;
  const isBox = s.vx.length === 4;
  const hw = isBox ? Math.abs(s.vx[1]!) : 0;
  const hh = isBox ? Math.abs(s.vy[2]!) : 0;
  const m = b.material;

  if (m === MAT.wood) {
    ctx.fillStyle = PALETTE.woodA;
    polyPath(ctx, b);
    ctx.fill();
    ctx.fillStyle = PALETTE.woodB;
    polyPath(ctx, b, 0.07);
    ctx.fill();
    // Grain along the long axis.
    if (isBox) {
      ctx.strokeStyle = PALETTE.woodGrain;
      ctx.lineWidth = px;
      ctx.beginPath();
      if (hw >= hh) {
        for (let k = -1; k <= 1; k += 2) {
          ctx.moveTo(-hw + 0.12, hh * 0.35 * k);
          ctx.lineTo(hw - 0.12, hh * 0.35 * k + 0.02);
        }
      } else {
        for (let k = -1; k <= 1; k += 2) {
          ctx.moveTo(hw * 0.35 * k, -hh + 0.12);
          ctx.lineTo(hw * 0.35 * k + 0.02, hh - 0.12);
        }
      }
      ctx.stroke();
    }
    ctx.strokeStyle = PALETTE.woodEdge;
  } else if (m === MAT.glass) {
    ctx.fillStyle = alpha(PALETTE.glassA, 0.85);
    polyPath(ctx, b);
    ctx.fill();
    ctx.fillStyle = alpha(PALETTE.glassB, 0.6);
    polyPath(ctx, b, 0.08);
    ctx.fill();
    if (isBox) {
      ctx.strokeStyle = alpha(PALETTE.glassShine, 0.9);
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      const k = Math.min(hw, hh);
      ctx.moveTo(-hw + 0.08, -hh + k * 1.2);
      ctx.lineTo(-hw + k * 1.2, -hh + 0.08);
      ctx.stroke();
    }
    ctx.strokeStyle = PALETTE.glassEdge;
  } else {
    ctx.fillStyle = PALETTE.stoneA;
    polyPath(ctx, b);
    ctx.fill();
    ctx.fillStyle = PALETTE.stoneB;
    if (isBox) {
      // Mottling, fixed per block so it doesn't crawl.
      for (let i = 0; i < 3; i++) {
        const fx = ((b.id * 37 + i * 53) % 100) / 100;
        const fy = ((b.id * 71 + i * 29) % 100) / 100;
        ctx.beginPath();
        ctx.arc(-hw + fx * hw * 2, -hh + fy * hh * 2, Math.min(hw, hh) * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = PALETTE.stoneEdge;
  }
  ctx.lineWidth = 1.2 * px;
  polyPath(ctx, b);
  ctx.stroke();

  drawCracks(ctx, b, hw || 0.3, hh || 0.3);
  ctx.restore();
}

/**
 * Damage shows as cracks, more of them as it accumulates. This is the only
 * feedback that a hit did *something* to a block that didn't break, and it is
 * what teaches "hit that one again".
 */
function drawCracks(ctx: CanvasRenderingContext2D, b: Body, hw: number, hh: number): void {
  if (b.maxHp <= 0 || !isFinite(b.maxHp)) return;
  const f = 1 - b.hp / b.maxHp;
  if (f < 0.15) return;
  const n = Math.min(4, Math.floor(f * 5));
  ctx.strokeStyle = b.material === MAT.glass ? alpha('#ffffff', 0.95) : alpha(PALETTE.crack, 0.75);
  ctx.lineWidth = 1.2 * px;
  ctx.beginPath();
  let seed = b.id * 9301 + 49297;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < n; i++) {
    let x = (rnd() * 2 - 1) * hw * 0.7;
    let y = (rnd() * 2 - 1) * hh * 0.7;
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (rnd() * 2 - 1) * Math.min(0.3, hw * 0.6);
      y += (rnd() * 2 - 1) * Math.min(0.3, hh * 0.6);
      ctx.lineTo(Math.max(-hw, Math.min(hw, x)), Math.max(-hh, Math.min(hh, y)));
    }
  }
  ctx.stroke();
}

/**
 * A TNT crate: dark red, a wooden frame, big yellow letters, and a fuse that
 * fizzes once it has been knocked. The most recognisable object in the game,
 * deliberately — she should spot every crate in a fort before she aims.
 */
function drawTnt(ctx: CanvasRenderingContext2D, b: Body, t: number, time: number): void {
  if (b.shape.kind !== 'poly') return;
  ctx.save();
  pose(ctx, b, t);
  const h = Math.abs(b.shape.vx[0]!);
  const hurt = b.maxHp > 0 ? 1 - b.hp / b.maxHp : 0;
  // A knocked crate trembles: it's about to go.
  if (hurt > 0) ctx.translate(Math.sin(time * 70) * 0.02, 0);

  ctx.fillStyle = '#b5432c';
  ctx.fillRect(-h, -h, h * 2, h * 2);
  ctx.fillStyle = '#8c2f1e';
  ctx.fillRect(-h, -h, h * 2, h * 0.18);
  ctx.fillRect(-h, h * 0.82, h * 2, h * 0.18);
  ctx.fillRect(-h, -h, h * 0.18, h * 2);
  ctx.fillRect(h * 0.82, -h, h * 0.18, h * 2);

  // Letters, drawn in pixel space so the font size is a real pixel size.
  ctx.save();
  ctx.scale(1 / camera.scale, 1 / camera.scale);
  const fs = Math.max(6, h * 0.9 * camera.scale);
  ctx.font = `bold ${fs.toFixed(1)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a1d12';
  ctx.fillText('TNT', 1, 1);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('TNT', 0, 0);
  ctx.restore();

  ctx.strokeStyle = '#5a1d12';
  ctx.lineWidth = 1.2 * px;
  ctx.strokeRect(-h, -h, h * 2, h * 2);

  // Fuse on top, sparking once it's been hit.
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 1.5 * px;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.quadraticCurveTo(h * 0.3, -h * 1.35, h * 0.1, -h * 1.5);
  ctx.stroke();
  if (hurt > 0) {
    ctx.fillStyle = Math.sin(time * 50) > 0 ? '#fff3b0' : '#ff8c42';
    ctx.beginPath();
    ctx.arc(h * 0.1, -h * 1.5, h * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- Bandits ----------------------------------------------------------------

function drawBandit(ctx: CanvasRenderingContext2D, b: Body, t: number, cast: Cast): void {
  if (b.shape.kind !== 'circle') return;
  const r = b.shape.r;
  const x = b.px + (b.x - b.px) * t;
  const y = b.py + (b.y - b.py) * t;
  const a = b.pa + (b.a - b.pa) * t;
  const hurt = b.maxHp > 0 ? 1 - b.hp / b.maxHp : 0;
  const mood = cast.banditMood(b);
  const hop = cast.banditHop(b, mood);

  ctx.save();
  ctx.translate(sx(x), sy(y - hop));
  ctx.scale(camera.scale, camera.scale);
  ctx.rotate(a);
  paintRaccoon(ctx, r, cast.time + b.id, mood, hurt);
  ctx.restore();
}

/**
 * A raccoon, drawn as a ball with a face. Shared with the fleeing-raccoon
 * particle and the HUD counter so all three are recognisably the same animal.
 */
export function paintRaccoon(ctx: CanvasRenderingContext2D, r: number, time: number, mood: Mood, hurt: number): void {
  ctx.save();
  // Whole-body poses. A toot lifts one hip, so he leans over on the other;
  // laughing shakes him; a burp puffs him up.
  if (mood === 'toot') {
    ctx.translate(-r * 0.6, r);
    ctx.rotate(-0.24);
    ctx.translate(r * 0.6, -r);
  } else if (mood === 'laugh') {
    ctx.rotate(Math.sin(time * 22) * 0.07);
  } else if (mood === 'burp') {
    ctx.scale(1.06, 1.04);
  }

  // Striped tail, peeking out behind. Swishes harder when he's showing off.
  const teasing = mood === 'raspberry' || mood === 'nyah' || mood === 'toot' || mood === 'burp' || mood === 'laugh';
  const swish = Math.sin(time * (teasing ? 9 : 3)) * (teasing ? 0.35 : 0.15);
  ctx.strokeStyle = PALETTE.banditTail;
  ctx.lineWidth = r * 0.45;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(r * 0.9, r * 0.2, r * 0.6, -0.4 + swish, 1.2);
  ctx.stroke();

  // Ears.
  ctx.fillStyle = PALETTE.banditFur;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.75, -r * 0.45);
    ctx.lineTo(side * r * 0.55, -r * 1.15);
    ctx.lineTo(side * r * 0.15, -r * 0.8);
    ctx.fill();
  }
  // Head/body.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.banditBelly;
  ctx.beginPath();
  const belly = mood === 'burp' ? 1.18 : 1;
  ctx.ellipse(0, r * 0.35, r * 0.6 * belly, r * 0.5 * belly, 0, 0, Math.PI * 2);
  ctx.fill();

  // The bandit mask.
  ctx.fillStyle = PALETTE.banditMask;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.12, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  paintRaccoonEyes(ctx, r, time, mood);
  paintRaccoonMouth(ctx, r, time, mood, hurt);
  paintRaccoonPaws(ctx, r, time, mood);

  // A bandage once he's been knocked about.
  if (hurt > 0.4) {
    ctx.fillStyle = '#fff4dc';
    ctx.save();
    ctx.rotate(0.5);
    ctx.fillRect(-r * 0.15, -r * 0.95, r * 0.3, r * 0.5);
    ctx.restore();
  }
  ctx.restore();
}

function paintRaccoonEyes(ctx: CanvasRenderingContext2D, r: number, time: number, mood: Mood): void {
  const ey = -r * 0.12;
  ctx.strokeStyle = PALETTE.banditEye;
  ctx.fillStyle = PALETTE.banditEye;
  ctx.lineWidth = r * 0.08;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const ex = side * r * 0.38 - r * 0.05;
    switch (mood) {
      case 'raspberry':
      case 'burp':
      case 'laugh':
        // Squeezed shut with glee: ^ ^
        ctx.beginPath();
        ctx.moveTo(ex - r * 0.15, ey + r * 0.05);
        ctx.lineTo(ex, ey - r * 0.08);
        ctx.lineTo(ex + r * 0.15, ey + r * 0.05);
        ctx.stroke();
        break;
      case 'toot':
        // Half-closed and very pleased with himself.
        ctx.beginPath();
        ctx.arc(ex, ey - r * 0.06, r * 0.14, 0.2, Math.PI - 0.2);
        ctx.stroke();
        break;
      case 'dizzy': {
        // Spirals.
        ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) {
          const a = k * 0.75 + time * 6 * side;
          const rr = (k / 16) * r * 0.17;
          const px = ex + Math.cos(a) * rr;
          const py = ey + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.lineWidth = r * 0.08;
        break;
      }
      default: {
        const scared = mood === 'scared';
        const eyeR = scared ? r * 0.22 : r * 0.17;
        const blink = mood === 'smug' && Math.sin(time * 1.3) > 0.97;
        if (blink) {
          ctx.fillRect(ex - eyeR, ey - r * 0.03, eyeR * 2, r * 0.06);
          break;
        }
        ctx.fillStyle = PALETTE.banditEye;
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        // Nyah-nyah rolls his eyes up; otherwise he looks left, at Ellie.
        const pyOff = mood === 'nyah' ? -eyeR * 0.45 : 0;
        const pxOff = mood === 'nyah' ? 0 : -eyeR * 0.3;
        ctx.arc(ex + pxOff, ey + pyOff, eyeR * (scared ? 0.35 : 0.5), 0, Math.PI * 2);
        ctx.fill();
        if (mood === 'smug') {
          // Narrowed: the mask comes down over the top of each eye. Sly.
          ctx.fillStyle = PALETTE.banditMask;
          ctx.fillRect(ex - eyeR * 1.1, ey - eyeR * 1.1, eyeR * 2.2, eyeR * 0.6);
        }
        ctx.fillStyle = PALETTE.banditEye;
      }
    }
  }
}

function paintRaccoonMouth(ctx: CanvasRenderingContext2D, r: number, time: number, mood: Mood, hurt: number): void {
  // Nose.
  ctx.fillStyle = PALETTE.banditNose;
  ctx.beginPath();
  ctx.arc(-r * 0.05, r * 0.18, r * 0.11, 0, Math.PI * 2);
  ctx.fill();

  const mx = -r * 0.05;
  ctx.strokeStyle = PALETTE.banditNose;
  ctx.lineWidth = r * 0.06;
  ctx.lineCap = 'round';
  const tongue = (x: number, y: number, len: number, wag: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wag);
    ctx.fillStyle = '#ff7aa8';
    ctx.beginPath();
    ctx.ellipse(0, len * 0.5, r * 0.17, len * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d94f84';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.1);
    ctx.lineTo(0, len * 0.65);
    ctx.stroke();
    ctx.restore();
  };

  switch (mood) {
    case 'raspberry':
      // Puffed cheeks and a big tongue, wagging.
      ctx.fillStyle = 'rgba(255,170,190,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.45, r * 0.3, r * 0.15, 0, Math.PI * 2);
      ctx.arc(r * 0.35, r * 0.3, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(mx - r * 0.18, r * 0.36);
      ctx.lineTo(mx + r * 0.18, r * 0.36);
      ctx.stroke();
      tongue(mx, r * 0.36, r * 0.5, Math.sin(time * 30) * 0.25);
      break;
    case 'nyah':
      ctx.beginPath();
      ctx.arc(mx, r * 0.3, r * 0.2, 0.15, Math.PI - 0.15);
      ctx.stroke();
      tongue(mx + r * 0.03, r * 0.46, r * 0.4, Math.sin(time * 18) * 0.3);
      break;
    case 'toot':
      // An enormous, very satisfied grin.
      ctx.beginPath();
      ctx.arc(mx, r * 0.22, r * 0.3, 0.25, Math.PI - 0.25);
      ctx.stroke();
      break;
    case 'burp':
    case 'laugh': {
      // Wide open.
      const h = mood === 'burp' ? 0.28 + Math.sin(time * 14) * 0.04 : 0.2;
      ctx.fillStyle = '#3a1020';
      ctx.beginPath();
      if (mood === 'burp') ctx.ellipse(mx, r * 0.45, r * 0.22, r * h, 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(mx - r * 0.26, r * 0.32);
        ctx.lineTo(mx + r * 0.26, r * 0.32);
        ctx.arc(mx, r * 0.32, r * 0.26, 0, Math.PI);
      }
      ctx.fill();
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.ellipse(mx, r * (mood === 'burp' ? 0.6 : 0.5), r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'scared':
      ctx.beginPath();
      ctx.arc(mx, r * 0.45, r * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'dizzy':
      ctx.beginPath();
      ctx.moveTo(mx - r * 0.2, r * 0.42);
      ctx.quadraticCurveTo(mx - r * 0.1, r * 0.34, mx, r * 0.42);
      ctx.quadraticCurveTo(mx + r * 0.1, r * 0.5, mx + r * 0.2, r * 0.42);
      ctx.stroke();
      tongue(mx + r * 0.12, r * 0.44, r * 0.2, 0.4);
      break;
    default:
      ctx.beginPath();
      if (hurt > 0.4) ctx.arc(mx, r * 0.45, r * 0.1, 0, Math.PI * 2);
      // A sly, lopsided grin.
      else ctx.arc(mx + r * 0.04, r * 0.28, r * 0.18, 0.25, Math.PI - 0.6);
      ctx.stroke();
  }
}

function paintRaccoonPaws(ctx: CanvasRenderingContext2D, r: number, time: number, mood: Mood): void {
  const paw = (x: number, y: number): void => {
    ctx.fillStyle = PALETTE.banditFur;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.banditTail;
    ctx.lineWidth = r * 0.04;
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  switch (mood) {
    case 'nyah': {
      // Thumbs in ears, fingers waggling.
      for (const side of [-1, 1]) {
        const x = side * r * 0.98;
        const y = -r * 0.35;
        paw(x, y);
        // Fingers in the dark tail colour, so they don't vanish into the fur.
        ctx.strokeStyle = PALETTE.banditTail;
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        for (let f = 0; f < 3; f++) {
          const a = -Math.PI / 2 + side * (0.4 + f * 0.35) + Math.sin(time * 24 + f) * 0.25;
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * r * 0.32, y + Math.sin(a) * r * 0.32);
        }
        ctx.stroke();
      }
      break;
    }
    case 'laugh':
      // Pointing at Ellie with one paw, holding his belly with the other.
      ctx.strokeStyle = PALETTE.banditFur;
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.2);
      ctx.lineTo(-r * 1.15, r * 0.05);
      ctx.stroke();
      paw(-r * 1.15, r * 0.05);
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(-r * 1.2, r * 0.03);
      ctx.lineTo(-r * 1.45, -r * 0.02);
      ctx.stroke();
      paw(r * 0.35, r * 0.55);
      break;
    case 'toot':
      // "Oops!"
      paw(r * 0.85, -r * 0.6 + Math.sin(time * 10) * r * 0.05);
      break;
    case 'burp':
      paw(r * 0.35 + Math.sin(time * 12) * r * 0.05, r * 0.55);
      break;
    case 'scared':
      paw(-r * 0.75, -r * 0.7);
      paw(r * 0.75, -r * 0.7);
      break;
    case 'smug':
      // Paws folded over his belly.
      paw(-r * 0.18, r * 0.45);
      paw(r * 0.18, r * 0.45);
      break;
    default:
      break;
  }
}

// --- Toys -------------------------------------------------------------------

function drawFlyingToy(ctx: CanvasRenderingContext2D, state: GameState, b: Body, t: number): void {
  if (b.shape.kind !== 'circle') return;
  const kind = state.shotKind[b.id]!;
  const x = b.px + (b.x - b.px) * t;
  const y = b.py + (b.y - b.py) * t;
  const a = b.pa + (b.a - b.pa) * t;
  const heading = Math.atan2(b.vy, b.vx);
  const boosting = kind === 'rocket' && b.gravityScale === 0;
  ctx.save();
  ctx.translate(sx(x), sy(y));
  ctx.scale(camera.scale, camera.scale);
  paintToy(ctx, kind, b.shape.r, a, heading, state.time, boosting);
  ctx.restore();
}

/**
 * Paint a toy centred on the origin, in metres.
 *
 * `spin` is the body's physical angle; `heading` its direction of travel. Most
 * toys tumble with their spin. The rocket points where it's going, because a
 * rocket flying backwards reads as broken, not as physics.
 */
export function paintToy(
  ctx: CanvasRenderingContext2D,
  kind: ShotKind,
  r: number,
  spin: number,
  heading: number,
  time: number,
  boosting: boolean,
): void {
  switch (kind) {
    case 'ball': {
      ctx.rotate(spin);
      ctx.fillStyle = '#ff4f8b';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.35, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(-spin);
      shine(ctx, r);
      break;
    }
    case 'ducks': {
      ctx.rotate(spin * 0.4);
      ctx.fillStyle = '#ffd60a';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.15, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 0.35, -r * 0.45, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8c1a';
      ctx.beginPath();
      ctx.ellipse(r * 0.95, -r * 0.35, r * 0.32, r * 0.15, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.6, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2b800';
      ctx.beginPath();
      ctx.ellipse(-r * 0.25, r * 0.15, r * 0.45, r * 0.25, -0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rocket': {
      ctx.rotate(heading);
      if (boosting) {
        const f = 0.8 + Math.sin(time * 60) * 0.25;
        ctx.fillStyle = '#ffb703';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.4);
        ctx.lineTo(-r * (2.4 * f), 0);
        ctx.lineTo(-r * 0.9, r * 0.4);
        ctx.fill();
        ctx.fillStyle = '#fff3b0';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.2);
        ctx.lineTo(-r * (1.6 * f), 0);
        ctx.lineTo(-r * 0.9, r * 0.2);
        ctx.fill();
      }
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.95);
      ctx.lineTo(-r * 0.3, -r * 0.4);
      ctx.lineTo(-r * 0.3, r * 0.4);
      ctx.lineTo(-r * 0.9, r * 0.95);
      ctx.fill();
      ctx.fillStyle = '#f1faee';
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      ctx.quadraticCurveTo(r * 0.6, -r * 0.55, -r, -r * 0.5);
      ctx.lineTo(-r, r * 0.5);
      ctx.quadraticCurveTo(r * 0.6, r * 0.55, r * 1.2, 0);
      ctx.fill();
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      ctx.quadraticCurveTo(r * 0.95, -r * 0.35, r * 0.55, -r * 0.45);
      ctx.lineTo(r * 0.55, r * 0.45);
      ctx.quadraticCurveTo(r * 0.95, r * 0.35, r * 1.2, 0);
      ctx.fill();
      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bear': {
      ctx.rotate(spin * 0.5);
      ctx.fillStyle = '#9c6b3f';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * r * 0.65, -r * 0.7, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d9a873';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.3, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * r * 0.65, -r * 0.7, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#2a1a10';
      ctx.beginPath();
      ctx.arc(-r * 0.32, -r * 0.15, r * 0.1, 0, Math.PI * 2);
      ctx.arc(r * 0.32, -r * 0.15, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, r * 0.18, r * 0.14, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.arc(0, r * 0.62, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'popper': {
      ctx.rotate(spin);
      ctx.fillStyle = '#b05cff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ff5fa2';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(-spin);
      // A fizzing fuse spark on top.
      ctx.fillStyle = Math.sin(time * 40) > 0 ? '#fff3b0' : '#ff8c42';
      ctx.beginPath();
      ctx.arc(0, -r * 1.1, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      shine(ctx, r);
      break;
    }
  }
}

function shine(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.25, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

// --- Particles --------------------------------------------------------------

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particles): void {
  for (const p of particles.pool) {
    if (!p.alive) continue;
    const f = p.life / p.maxLife;
    const x = sx(p.x);
    const y = sy(p.y);
    const s = p.size * camera.scale;
    switch (p.kind) {
      case PKind.Shard:
        ctx.save();
        ctx.globalAlpha = Math.min(1, f * 2.5);
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, (-p.size2 * camera.scale) / 2, s, Math.max(1, p.size2 * camera.scale));
        ctx.restore();
        break;
      case PKind.Puff:
        ctx.fillStyle = alpha(p.color.length === 7 ? p.color : '#ffffff', 0.55 * f);
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case PKind.Confetti:
        ctx.save();
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.sin(p.rot * 2.3));
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 3, s, (s * 2) / 3);
        ctx.restore();
        break;
      case PKind.Spark: {
        ctx.fillStyle = alpha(p.color, f);
        const k = s * (0.5 + f);
        ctx.beginPath();
        ctx.moveTo(x, y - k);
        ctx.lineTo(x + k * 0.3, y);
        ctx.lineTo(x, y + k);
        ctx.lineTo(x - k * 0.3, y);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - k, y);
        ctx.lineTo(x, y + k * 0.3);
        ctx.lineTo(x + k, y);
        ctx.lineTo(x, y - k * 0.3);
        ctx.fill();
        break;
      }
      case PKind.Raccoon:
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(camera.scale, camera.scale);
        if (p.stage === 0) ctx.rotate(p.rot);
        // Running away, facing right — the only time a bandit turns its back.
        else ctx.scale(-1, 1);
        paintRaccoon(ctx, p.size, p.rot, 'scared', 0);
        ctx.restore();
        break;
      case PKind.Fire: {
        // Cools as it ages: white-hot, yellow, orange, red, then sooty.
        const color = f > 0.8 ? '#fffbe6' : f > 0.6 ? '#ffd23f' : f > 0.4 ? '#ff8c1a' : f > 0.22 ? '#d6401f' : '#5a4a48';
        const hot = f > 0.4;
        ctx.save();
        if (hot) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = alpha(color, hot ? 0.75 : 0.6 * (f / 0.4));
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case PKind.Smoke:
        ctx.fillStyle = alpha(p.color, 0.32 * Math.min(1, f * 1.5) * Math.min(1, (1 - f) * 6));
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case PKind.Ring: {
        // Eases out: fast at first, slowing as it spreads.
        const k = 1 - f;
        const r = p.size2 * (1 - (1 - k) * (1 - k)) * camera.scale;
        ctx.strokeStyle = alpha(p.color, 0.9 * f);
        ctx.lineWidth = 2 + 6 * f;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case PKind.Scorch:
        break;
      case PKind.Toot: {
        // Three lobes, wobbling as they rise, with a pair of stink lines.
        const a = 0.75 * Math.min(1, f * 2);
        const wob = Math.sin(p.rot) * 0.12 * camera.scale;
        ctx.save();
        ctx.translate(x + wob, y);
        ctx.fillStyle = alpha('#d4e157', a);
        ctx.strokeStyle = alpha('#9aa82a', a);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(-s * 0.45, s * 0.1, s * 0.6, 0, Math.PI * 2);
        ctx.arc(s * 0.45, s * 0.12, s * 0.55, 0, Math.PI * 2);
        ctx.arc(0, -s * 0.25, s * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (f > 0.35) {
          ctx.strokeStyle = alpha('#8a9a20', a * 0.9);
          ctx.lineWidth = 1.2;
          for (const k of [-1, 1]) {
            ctx.beginPath();
            const lx = k * s * 0.4;
            ctx.moveTo(lx, -s * 1.0);
            ctx.quadraticCurveTo(lx + s * 0.25, -s * 1.3, lx, -s * 1.6);
            ctx.quadraticCurveTo(lx - s * 0.25, -s * 1.9, lx, -s * 2.2);
            ctx.stroke();
          }
        }
        ctx.restore();
        break;
      }
      case PKind.Text:
        ctx.save();
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.font = `bold ${p.size > 0 ? Math.round(p.size) : 11}px "SF Mono", "Roboto Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = PALETTE.hudShadow;
        ctx.fillText(p.text, x + 1, y + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, y);
        ctx.restore();
        break;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { roundRect };
