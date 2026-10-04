import { SCREEN, SLING_X, VIEW_LEFT_M, VIEW_RIGHT_M } from '../game/config';

/**
 * World metres -> virtual pixels.
 *
 * The camera frames the WHOLE level, slingshot to the far fort, and holds
 * still. Angry Birds pans and zooms to follow the bird; for a five-year-old
 * that means the tower she was aiming at is off screen when the bird gets
 * there, and the collapse — the payoff — happens somewhere she can't see.
 * Seeing everything at once is worth the smaller blocks.
 *
 * The only motion is shake, which is pure feedback and decays in well under a
 * second.
 */
export const camera = {
  /** px per metre. */
  scale: 16,
  /** Screen x of world x = 0. */
  originX: 80,
  /** Screen y of the ground (world y = 0). */
  groundY: 236,
  /** Shake offset this frame, px. */
  shakeX: 0,
  shakeY: 0,
  trauma: 0,
  /** White flash over the whole frame, 0..1. Set by a blast, decays fast. */
  flash: 0,
};

/** Room left of the slingshot for Ellie and the waiting toys. */
const LEFT_MARGIN_M = VIEW_LEFT_M;
const RIGHT_MARGIN_M = VIEW_RIGHT_M;
/** Ground strip at the bottom of the screen, px. */
const GROUND_PX = 30;
/** Empty sky above the tallest thing, in metres. */
const HEADROOM_M = 2.5;
const MIN_HEIGHT_M = 9;

export function frameLevel(levelRight: number, levelTop: number): void {
  const widthM = levelRight + RIGHT_MARGIN_M - (SLING_X - LEFT_MARGIN_M);
  const heightM = Math.max(MIN_HEIGHT_M, levelTop + HEADROOM_M);
  const groundY = SCREEN.h - GROUND_PX;
  const scale = Math.min(SCREEN.w / widthM, (groundY - 4) / heightM);
  camera.scale = scale;
  camera.groundY = groundY;
  // Any spare width goes to the right of the fort, not between the slingshot
  // and it: spare room on a wide phone must not read as a longer shot.
  camera.originX = (LEFT_MARGIN_M - SLING_X) * scale;
}

export function sx(x: number): number {
  return camera.originX + x * camera.scale + camera.shakeX;
}

export function sy(y: number): number {
  return camera.groundY + y * camera.scale + camera.shakeY;
}

export function toWorldX(px: number): number {
  return (px - camera.originX) / camera.scale;
}

/** Add screen shake. Trauma is squared on use, so small hits barely register and big ones really do. */
export function shake(amount: number): void {
  camera.trauma = Math.min(1, camera.trauma + amount);
}

export function updateShake(dt: number, t: number): void {
  camera.trauma = Math.max(0, camera.trauma - dt * 1.8);
  camera.flash = Math.max(0, camera.flash - dt * 7);
  const s = camera.trauma * camera.trauma * 10;
  camera.shakeX = s * Math.sin(t * 61.3);
  camera.shakeY = s * Math.sin(t * 47.9 + 1.7);
}
