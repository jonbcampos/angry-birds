/**
 * Progress: best stars per level, and the mute switch.
 *
 * Versioned, and defensive about what it reads back, for the same reason as
 * the siblings: localStorage is shared, hand-editable, and survives across
 * builds. Unreadable data is discarded and the game starts fresh; it never
 * throws on load.
 */

const KEY = 'slingshot.save';
const VERSION = 1;

export interface Save {
  v: number;
  /** Best stars per level id, 0 meaning not yet beaten. */
  stars: Record<number, number>;
  muted: boolean;
}

export function freshSave(): Save {
  return { v: VERSION, stars: {}, muted: false };
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const data = JSON.parse(raw) as Partial<Save>;
    if (data.v !== VERSION || typeof data.stars !== 'object' || data.stars === null) return freshSave();
    const stars: Record<number, number> = {};
    for (const [k, v] of Object.entries(data.stars)) {
      const n = Number(v);
      if (Number.isFinite(n)) stars[Number(k)] = Math.max(0, Math.min(3, Math.round(n)));
    }
    return { v: VERSION, stars, muted: data.muted === true };
  } catch {
    return freshSave();
  }
}

export function writeSave(save: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Private mode or full storage: progress is lost, the game is not.
  }
}

/** Keep the better result. Never lowers a level's stars. */
export function recordStars(save: Save, levelId: number, stars: number): void {
  save.stars[levelId] = Math.max(save.stars[levelId] ?? 0, stars);
  writeSave(save);
}

/**
 * The first three levels are always open, and beating a level opens the next.
 * Three rather than one so a stuck child always has somewhere else to go.
 */
export function isUnlocked(save: Save, levelId: number): boolean {
  // The TNT Playground is never locked: it's for when she just wants to blow
  // something huge up, not a reward to earn. (Same number as PLAYGROUND_FROM.)
  if (levelId <= 3 || levelId >= 16) return true;
  return (save.stars[levelId - 1] ?? 0) > 0;
}
