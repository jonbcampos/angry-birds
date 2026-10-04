import type { MaterialId, ShotKind } from './content';

/**
 * The levels, written as little programs against a builder.
 *
 * Every coordinate here is in metres, with `x` measured rightward from the
 * slingshot and heights measured UP from the ground (the builder converts to
 * the engine's y-down). Each builder call returns the height of the top of what
 * it just placed, so a fort is written bottom to top and every piece rests
 * exactly on the one beneath it:
 *
 *     const top = b.frame(20, 0, 2.4, 2);   // two posts and a lintel
 *     b.bandit(20, top);                    // sitting on the lintel
 *
 * Exact resting contact is what lets a level start asleep and perfectly still,
 * rather than settling — and visibly shifting — in the first second. It is
 * also checked: `verify()` wakes every level and requires it to stand on its
 * own for five seconds without a block taking damage.
 */

export type PieceKind = 'box' | 'tri' | 'bandit' | 'tnt' | 'platform';

export interface Piece {
  kind: PieceKind;
  material: MaterialId;
  /** Centre x, and the height of the piece's BOTTOM above the ground. */
  x: number;
  base: number;
  w: number;
  h: number;
  /** For a triangle: which way the slope faces. */
  flip?: boolean;
}

export interface Level {
  id: number;
  name: string;
  shots: ShotKind[];
  /** Toys needed for three stars. One more is two stars. */
  par: number;
  pieces: Piece[];
  /** Which toy is new on this level, for the intro card. */
  introduces?: ShotKind;
  /** A TNT Playground level: no lesson, just a giant fort and the whole toy box. */
  playground?: boolean;
}

/** Levels from here on are the TNT Playground: always open, on their own tab. */
export const PLAYGROUND_FROM = 16;

/** Plank thickness. Thin enough to look like a plank, thick enough not to tunnel. */
const T = 0.25;

class Builder {
  readonly pieces: Piece[] = [];

  private add(p: Piece): number {
    this.pieces.push(p);
    return p.base + p.h;
  }

  /** A standing post. */
  post(x: number, base: number, len = 2, mat: MaterialId = 'wood'): number {
    return this.add({ kind: 'box', material: mat, x, base, w: T, h: len });
  }

  /** A lying plank. */
  plank(x: number, base: number, len = 2, mat: MaterialId = 'wood'): number {
    return this.add({ kind: 'box', material: mat, x, base, w: len, h: T });
  }

  block(x: number, base: number, size = 1, mat: MaterialId = 'wood'): number {
    return this.add({ kind: 'box', material: mat, x, base, w: size, h: size });
  }

  slab(x: number, base: number, w: number, h: number, mat: MaterialId = 'wood'): number {
    return this.add({ kind: 'box', material: mat, x, base, w, h });
  }

  /** A right triangle. `flip` puts the tall side on the left. */
  tri(x: number, base: number, w: number, h: number, mat: MaterialId = 'wood', flip = false): number {
    return this.add({ kind: 'tri', material: mat, x, base, w, h, flip });
  }

  /** Two posts and a plank across them. Returns the top of the plank. */
  frame(x: number, base: number, width = 2, height = 2, mat: MaterialId = 'wood', lintel?: MaterialId): number {
    const half = width / 2 - T / 2;
    this.post(x - half, base, height, mat);
    this.post(x + half, base, height, mat);
    return this.plank(x, base + height, width + 0.1, lintel ?? mat);
  }

  bandit(x: number, base: number, size = 1): number {
    const d = 0.84 * size;
    return this.add({ kind: 'bandit', material: 'bandit', x, base, w: d, h: d });
  }

  /** A TNT crate. Goes off when knocked hard, and sets off any TNT nearby. */
  tnt(x: number, base: number, size = 0.8): number {
    return this.add({ kind: 'tnt', material: 'tnt', x, base, w: size, h: size });
  }

  /** Immovable ground: a hill or a ledge. Its top is at `height`. */
  platform(x0: number, x1: number, height: number): number {
    return this.add({ kind: 'platform', material: 'ground', x: (x0 + x1) / 2, base: 0, w: x1 - x0, h: height });
  }
}

function level(
  id: number,
  name: string,
  shots: ShotKind[],
  par: number,
  build: (b: Builder) => void,
  introduces?: ShotKind,
): Level {
  const b = new Builder();
  build(b);
  const l: Level = { id, name, shots, par, pieces: b.pieces };
  if (introduces) l.introduces = introduces;
  if (id >= PLAYGROUND_FROM) l.playground = true;
  return l;
}

export const LEVELS: readonly Level[] = [
  // TNT from the very first level. Ellie's favourite part of Angry Birds is the
  // TNT going off, so nearly every fort has some, and the best shot on a level
  // is usually the one that finds it.
  level(1, 'Hello, Bandit!', ['ball', 'ball', 'ball'], 1, (b) => {
    const top = b.frame(15, 0, 2.2, 2);
    b.tnt(15, 0);
    b.bandit(15, top);
  }),

  level(2, 'Two Hideouts', ['ball', 'ball', 'ball'], 2, (b) => {
    b.bandit(14, 0);
    let top = b.frame(14, 0, 2.4, 2);
    b.bandit(14, top);
    b.tnt(16.5, 0);
    top = b.frame(19, 0, 2.4, 2.6);
    b.bandit(19, top);
  }),

  level(3, 'The Glass House', ['ducks', 'ducks', 'ball'], 1, (b) => {
    const top = b.frame(16, 0, 3, 2, 'glass');
    b.bandit(15.4, 0);
    b.bandit(16.6, 0);
    b.post(15, top, 1.2, 'glass');
    b.post(17, top, 1.2, 'glass');
    const roof = b.plank(16, top + 1.2, 2.4, 'glass');
    b.bandit(16, roof);
    b.tnt(18.2, 0);
  }, 'ducks'),

  level(4, 'Tall Tower', ['ball', 'ducks', 'ball'], 1, (b) => {
    let top = b.frame(17, 0, 2, 2);
    b.tnt(17, top);
    top = b.frame(17, top, 2, 2, 'glass');
    top = b.frame(17, top, 2, 2);
    b.bandit(17, top);
    b.bandit(17, 0);
  }),

  level(5, 'Wooden Wall', ['rocket', 'rocket', 'ball'], 1, (b) => {
    // A wall to punch through, with the bandits sheltering behind it.
    for (let i = 0; i < 5; i++) b.block(13, i, 1);
    b.tnt(14, 0);
    b.bandit(15, 0);
    const top = b.frame(16.6, 0, 2, 2.2);
    b.bandit(16.6, top);
  }, 'rocket'),

  level(6, 'Hilltop Fort', ['ball', 'rocket', 'ducks', 'ball'], 2, (b) => {
    const hill = b.platform(14, 22, 2);
    let top = b.frame(16, hill, 2.2, 2);
    b.bandit(16, top);
    b.tnt(17.75, hill);
    top = b.frame(19.5, hill, 2.6, 2, 'wood', 'glass');
    b.bandit(19.5, hill);
    top = b.frame(19.5, top, 2.0, 1.6, 'glass');
    b.bandit(19.5, top);
  }),

  level(7, 'Stone Walls', ['bear', 'bear', 'ball'], 1, (b) => {
    let top = b.frame(16, 0, 2.6, 2.2, 'stone');
    b.bandit(15.6, 0);
    b.tnt(16.55, 0);
    top = b.frame(16, top, 2.2, 1.8, 'stone', 'wood');
    b.bandit(16, top);
    b.block(13.8, 0, 1, 'stone');
    b.block(18.2, 0, 1, 'stone');
  }, 'bear'),

  level(8, 'TNT Party', ['ball', 'ball', 'ducks'], 1, (b) => {
    // The first real chain reaction. One good hit on the crates should take
    // the whole fort down, and the level is built so it can.
    let top = b.frame(15, 0, 2.4, 2, 'stone');
    b.tnt(15, 0);
    top = b.frame(15, top, 2.4, 2, 'wood');
    b.bandit(15, top);
    b.tnt(17.2, 0);
    b.tnt(17.2, 0.8);
    top = b.frame(19.4, 0, 2.4, 2, 'stone');
    b.bandit(19.4, 0);
    top = b.frame(19.4, top, 2.4, 2, 'glass');
    b.bandit(19.4, top);
  }),

  level(9, 'Firecrackers', ['popper', 'popper', 'ball'], 1, (b) => {
    const floor1 = b.frame(16, 0, 3, 2, 'stone', 'wood');
    b.bandit(15.4, 0);
    b.bandit(16.6, 0);
    const top = b.frame(16, floor1, 2.4, 2, 'wood');
    b.bandit(15.6, floor1);
    b.tnt(16.5, floor1);
    b.bandit(16, top);
    b.tri(13.6, 0, 1.6, 1.6, 'stone', true);
    b.tri(18.4, 0, 1.6, 1.6, 'stone');
  }, 'popper'),

  level(10, 'Twin Towers', ['ducks', 'rocket', 'bear', 'ball'], 2, (b) => {
    for (const x of [15, 21]) {
      let top = b.frame(x, 0, 2, 2, x === 15 ? 'glass' : 'wood');
      top = b.frame(x, top, 2, 2, 'wood');
      top = b.frame(x, top, 2, 1.6, x === 15 ? 'wood' : 'stone');
      b.bandit(x, top);
    }
    const slab = b.plank(18, 0, 3, 'stone');
    b.bandit(17.6, slab);
    b.tnt(19, slab);
  }),

  level(11, 'The Castle', ['bear', 'popper', 'ducks', 'rocket', 'ball'], 3, (b) => {
    const hill = b.platform(13, 25, 1);
    b.block(14, hill, 1, 'stone');
    b.block(14, hill + 1, 1, 'stone');
    b.block(24, hill, 1, 'stone');
    b.block(24, hill + 1, 1, 'stone');
    let top = b.frame(17, hill, 3, 2.2, 'stone', 'wood');
    b.bandit(16.7, hill);
    b.tnt(17.7, hill);
    top = b.frame(17, top, 2.4, 1.6, 'glass');
    b.bandit(17, top);
    b.tnt(23, hill);
    top = b.frame(21, hill, 3, 2.2, 'stone', 'wood');
    b.bandit(21, hill);
    top = b.frame(21, top, 2.4, 1.6, 'wood');
    top = b.frame(21, top, 1.6, 1.2, 'glass');
    b.bandit(21, top);
  }),

  level(12, 'Big Bandit HQ', ['bear', 'popper', 'ducks', 'rocket', 'popper', 'ball'], 4, (b) => {
    let top = b.frame(14.5, 0, 2.4, 2, 'wood');
    b.bandit(14, top);
    b.tnt(15.1, top);
    b.tnt(14.5, 0);

    const floor1 = b.frame(19, 0, 4, 2.4, 'stone', 'stone');
    b.bandit(18, 0, 1.4);
    b.tnt(20, 0);
    top = b.frame(19, floor1, 3.2, 2, 'wood', 'glass');
    b.bandit(19, floor1);
    top = b.frame(19, top, 2.4, 1.6, 'glass');
    b.bandit(19, top);

    top = b.frame(24, 0, 2.4, 3, 'stone', 'wood');
    b.bandit(24, 0);
    top = b.frame(24, top, 2, 2, 'wood');
    b.bandit(24, top);
  }),

  level(13, 'Boom Town', ['ball', 'ball', 'rocket'], 1, (b) => {
    // Three huts, each with a crate inside, and a tower of crates between
    // them. Any one of them going off should reach the others.
    for (const x of [14.5, 21.5]) {
      const top = b.frame(x, 0, 2.4, 2);
      b.tnt(x - 0.45, 0);
      b.bandit(x + 0.45, 0);
      b.bandit(x, top);
    }
    b.tnt(18, 0);
    b.tnt(18, 0.8);
    const stack = b.tnt(18, 1.6);
    b.bandit(18, stack);
  }),

  level(14, 'The Big Bang', ['bear', 'popper', 'rocket', 'ball'], 2, (b) => {
    // A long stone hall with a basement full of TNT. Find the crates.
    const hill = b.platform(14, 27, 1);
    const hall = b.frame(20, hill, 6, 2.4, 'stone', 'stone');
    b.tnt(17.8, hill);
    b.bandit(18.9, hill);
    b.tnt(20, hill);
    b.bandit(21.1, hill);
    b.tnt(22.2, hill);
    let top = b.frame(18.5, hall, 2.4, 2, 'wood', 'glass');
    b.bandit(18.5, hall);
    b.bandit(18.5, top);
    top = b.frame(21.5, hall, 2.4, 2, 'glass');
    b.tnt(21.5, hall);
    b.bandit(21.5, top);
    b.block(15.5, hill, 1, 'stone');
    b.block(24.5, hill, 1, 'stone');
    b.tnt(24.5, hill + 1);
  }),

  level(15, 'Toot Toot!', ['whoopee', 'whoopee', 'ball', 'whoopee'], 2, (b) => {
    // A stone wall to bounce over, and wooden forts behind it to ricochet
    // around inside. The cushion is the bounciest toy, so it keeps going.
    b.block(14, 0, 1, 'stone');
    b.block(14, 1, 1, 'stone');
    b.block(14, 2, 1, 'stone');
    let top = b.frame(17, 0, 2.4, 2);
    b.bandit(17, 0);
    b.bandit(17, top);
    b.tnt(18.75, 0);
    top = b.frame(20.5, 0, 2.4, 2.4);
    b.bandit(20.5, 0);
    top = b.frame(20.5, top, 2, 1.6);
    b.bandit(20.5, top);
  }, 'whoopee'),

  // --- TNT Playground ----------------------------------------------------------
  // No lesson in these. A giant fort, a lot of TNT, and the whole toy box: the
  // fun of just knocking something enormous down. Generous pars on purpose.

  level(16, 'Giant Tower', ['bear', 'popper', 'ball', 'rocket', 'whoopee', 'ducks'], 3, (b) => {
    // Five storeys, alternating materials, a crate and a raccoon on every floor.
    const mats = ['stone', 'wood', 'glass', 'wood', 'stone'] as const;
    let floor = 0;
    for (let i = 0; i < mats.length; i++) {
      b.tnt(18 - 0.6, floor);
      if (i % 2 === 0) b.bandit(18 + 0.6, floor);
      floor = b.frame(18, floor, 3, 2, mats[i], i === 4 ? 'wood' : mats[i]);
    }
    b.bandit(18, floor);
    // A couple of crates and a raccoon at its feet, for the splash damage.
    b.tnt(15.2, 0);
    b.tnt(20.8, 0);
    b.bandit(21.8, 0);
  }),

  level(17, 'TNT Warehouse', ['bear', 'popper', 'rocket', 'whoopee', 'ball', 'ducks'], 3, (b) => {
    // A long two-storey hall: posts every 2.5m, planks meeting over them, and
    // a crate and a raccoon in every bay on both floors.
    const xs = [14, 16.5, 19, 21.5, 24];
    const bays = xs.slice(0, -1).map((x) => x + 1.25);
    for (const x of xs) b.post(x, 0, 2.2, 'stone');
    for (const x of bays) b.plank(x, 2.2, 2.5, 'stone');
    for (const x of bays) {
      b.tnt(x - 0.45, 0);
      b.bandit(x + 0.45, 0);
    }
    const upper = 2.2 + 0.25;
    for (const x of xs) b.post(x, upper, 1.8, 'wood');
    for (const x of bays) b.plank(x, upper + 1.8, 2.5, 'glass');
    bays.forEach((x, i) => {
      b.tnt(x - 0.45, upper);
      if (i % 2 === 1) b.bandit(x + 0.45, upper);
    });
    b.bandit(bays[0]!, upper + 2.05);
    b.bandit(bays[3]!, upper + 2.05);
  }),

  level(18, 'The Big Castle', ['bear', 'bear', 'popper', 'rocket', 'whoopee', 'ducks', 'ball'], 4, (b) => {
    const hill = b.platform(13, 29, 1);
    // Two corner towers of stone blocks, each with a lookout on top.
    for (const x of [14, 28]) {
      let top = hill;
      for (let i = 0; i < 4; i++) top = b.block(x, top, 1, 'stone');
      b.bandit(x, top);
    }
    // Flanking towers: three storeys each, TNT at the bottom.
    for (const x of [17, 25]) {
      b.tnt(x, hill);
      const floor1 = b.frame(x, hill, 2.2, 2, 'stone', 'wood');
      let top = b.frame(x, floor1, 2.2, 2, 'wood');
      b.bandit(x, floor1);
      top = b.frame(x, top, 1.8, 1.6, 'glass');
      b.bandit(x, top);
    }
    // The keep: a TNT basement under a big raccoon, two floors above.
    let keep = b.frame(21, hill, 4.4, 2.6, 'stone', 'stone');
    b.tnt(19.6, hill);
    b.tnt(22.4, hill);
    b.bandit(21, hill, 1.4);
    const second = keep;
    keep = b.frame(21, keep, 3.4, 2.2, 'wood', 'wood');
    b.tnt(21.8, second);
    b.bandit(20.6, second);
    keep = b.frame(21, keep, 2.4, 1.8, 'glass');
    b.bandit(21, keep);
  }),

  level(19, 'Domino City', ['ball', 'rocket', 'bear', 'popper', 'whoopee', 'ball'], 2, (b) => {
    // Six tall towers of blocks in a row, close enough that each one falls
    // into the next. Knock the first one over and watch.
    const xs = [14, 16.3, 18.6, 20.9, 23.2, 25.5];
    xs.forEach((x, i) => {
      const mat = i % 3 === 2 ? 'stone' : i % 3 === 1 ? 'glass' : 'wood';
      let top = 0;
      for (let k = 0; k < 6; k++) top = b.block(x, top, 1, mat);
      b.bandit(x, top);
    });
    b.tnt(15.15, 0);
    b.tnt(19.75, 0);
    b.tnt(24.35, 0);
  }),

  level(20, 'Mount Kaboom', ['bear', 'popper', 'rocket', 'ball', 'whoopee', 'popper', 'ducks'], 3, (b) => {
    // A pyramid of blocks, every other one a TNT crate. One good hit and the
    // whole mountain goes up in a chain.
    const cx = 20;
    for (let row = 0; row < 7; row++) {
      const n = 7 - row;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * 1.0;
        if ((i + row) % 2 === 0) b.tnt(x, row, 1);
        else b.block(x, row, 1, row < 2 ? 'stone' : 'wood');
      }
    }
    b.bandit(cx, 7);
    b.bandit(cx - 4.0, 0);
    b.bandit(cx + 4.0, 0);
    // Two lookout posts beside the mountain.
    for (const x of [14.5, 25.5]) {
      const top = b.frame(x, 0, 1.8, 2.4, 'wood');
      b.bandit(x, top);
    }
  }),
];

export function levelById(id: number): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0]!;
}

/** The level's extent, for the camera: left of the slingshot to past the last piece. */
export function levelBounds(l: Level): { right: number; top: number } {
  let right = 10;
  let top = 6;
  for (const p of l.pieces) {
    right = Math.max(right, p.x + p.w / 2);
    top = Math.max(top, p.base + p.h);
  }
  return { right, top };
}
