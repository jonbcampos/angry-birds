import { FIXED_DT, LAUNCH_SPEED } from '../game/config';
import { LEVELS, type Level } from '../game/levels';
import { GameState } from '../game/state';

/**
 * Dev-only checks, run against a real, separate GameState.
 *
 *     __game.verify()   // every fort stands up on its own
 *     __game.scan()     // how much one plain shot can do, per level
 *
 * `verify` is the contract that matters. Levels start asleep, so a fort that
 * can't actually hold itself up looks perfectly fine — until the first toy
 * wakes it and the whole thing slumps over by itself, taking the credit away
 * from the shot. This wakes every body and requires the fort to stand still
 * for five seconds with no block damaged.
 */

export interface StabilityResult {
  level: number;
  ok: boolean;
  maxDrift: number;
  maxTilt: number;
  lost: number;
  damaged: number;
}

const SETTLE_SECONDS = 5;
const MAX_DRIFT = 0.12;
const MAX_TILT = 0.06;

export function checkStability(level: Level): StabilityResult {
  const g = new GameState();
  g.load(level);
  const w = g.world;
  const start = new Map<number, { x: number; y: number; a: number; tag: string }>();
  for (const b of w.bodies) {
    if (!b.alive || b.isStatic) continue;
    start.set(b.id, { x: b.x, y: b.y, a: b.a, tag: b.tag });
    w.wake(b);
  }
  const before = start.size;
  for (let t = 0; t < SETTLE_SECONDS; t += FIXED_DT) g.update(FIXED_DT);

  let maxDrift = 0;
  let maxTilt = 0;
  let alive = 0;
  let damaged = 0;
  for (const b of w.bodies) {
    if (!b.alive || b.isStatic) continue;
    const s = start.get(b.id);
    if (!s) continue;
    alive++;
    maxDrift = Math.max(maxDrift, Math.hypot(b.x - s.x, b.y - s.y));
    maxTilt = Math.max(maxTilt, Math.abs(b.a - s.a));
    if (b.hp < b.maxHp - 1e-6) damaged++;
  }
  const lost = before - alive;
  return {
    level: level.id,
    ok: lost === 0 && damaged === 0 && maxDrift < MAX_DRIFT && maxTilt < MAX_TILT,
    maxDrift: round(maxDrift),
    maxTilt: round(maxTilt),
    lost,
    damaged,
  };
}

export function verify(): StabilityResult[] {
  const results = LEVELS.map(checkStability);
  console.table(results);
  const bad = results.filter((r) => !r.ok);
  if (bad.length === 0) console.log('%cAll forts stand on their own.', 'color: #2a2');
  else console.error(`[verify] ${bad.length} fort(s) fall over by themselves:`, bad.map((r) => r.level));
  return results;
}

export interface ScanResult {
  level: number;
  bandits: number;
  bestBonked: number;
  bestAngleDeg: number;
  bestPower: number;
  /** Share of the grid's shots that bonked at least one bandit. */
  anyHit: number;
}

/**
 * Fire the level's first toy, with no trick, at a grid of angles and powers,
 * and report the best single shot. Not a contract — just a quick way to see
 * whether a level is a one-shot pushover or a wall.
 */
export function scan(ids?: number[]): ScanResult[] {
  const out: ScanResult[] = [];
  for (const level of LEVELS) {
    if (ids && !ids.includes(level.id)) continue;
    let best: ScanResult = { level: level.id, bandits: 0, bestBonked: -1, bestAngleDeg: 0, bestPower: 0, anyHit: 0 };
    let hits = 0;
    let tries = 0;
    for (let deg = 5; deg <= 70; deg += 5) {
      for (let power = 0.6; power <= 1.001; power += 0.1) {
        const g = new GameState();
        g.load(level);
        const total = g.banditsLeft;
        const a = (deg * Math.PI) / 180;
        // setAim takes the DRAG, which points away from the launch direction.
        const drag = power * 70;
        g.setAim(-Math.cos(a) * drag, Math.sin(a) * drag);
        g.release();
        for (let t = 0; t < 8 && g.phase === 'flight'; t += FIXED_DT) g.update(FIXED_DT);
        for (let t = 0; t < 2; t += FIXED_DT) g.update(FIXED_DT);
        const bonked = total - g.banditsLeft;
        tries++;
        if (bonked > 0) hits++;
        if (bonked > best.bestBonked) {
          best = { level: level.id, bandits: total, bestBonked: bonked, bestAngleDeg: deg, bestPower: round(power), anyHit: 0 };
        }
      }
    }
    best.anyHit = round(hits / tries);
    out.push(best);
  }
  console.table(out);
  console.log(`(launch speed at full power: ${LAUNCH_SPEED} m/s)`);
  return out;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
