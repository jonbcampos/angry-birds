/**
 * The two content registries: what forts are made of, and what Ellie fires.
 *
 * Adding a material or a toy is one entry here plus one painter in the
 * renderer. Nothing else should need to change.
 */

export type MaterialId = 'ground' | 'wood' | 'glass' | 'stone' | 'bandit' | 'toy' | 'tnt';

export interface MaterialDef {
  id: MaterialId;
  /** kg/m². Relative weights matter more than absolutes: stone is 2.5x wood. */
  density: number;
  friction: number;
  restitution: number;
  /**
   * Joules of impact a square metre of this can take before it breaks. A
   * block's hit points are its area times this, so a long plank is sturdier
   * than a short one, as it should be.
   */
  toughness: number;
  /**
   * Whether a broken block of this splits into two smaller physical halves
   * instead of shattering into dust. Wood and stone split, glass shatters.
   * The halves are real bodies and can knock more things over, which is most
   * of why a collapse looks like a collapse instead of a fade-out.
   */
  splits: boolean;
}

/** Indexed by `Body.material`. Order is load-bearing: never reorder, only append. */
export const MATERIALS: readonly MaterialDef[] = [
  { id: 'ground', density: 0, friction: 0.9, restitution: 0, toughness: Infinity, splits: false },
  { id: 'wood', density: 5, friction: 0.65, restitution: 0.1, toughness: 170, splits: true },
  { id: 'glass', density: 3.5, friction: 0.35, restitution: 0.05, toughness: 45, splits: false },
  { id: 'stone', density: 12, friction: 0.85, restitution: 0.02, toughness: 520, splits: true },
  { id: 'bandit', density: 3, friction: 0.7, restitution: 0.25, toughness: 0, splits: false },
  { id: 'toy', density: 9, friction: 0.6, restitution: 0.3, toughness: Infinity, splits: false },
  // TNT goes off easily on purpose: a solid knock should do it. (Its hit points
  // are fixed rather than by area; see TNT_HP in config.ts.)
  { id: 'tnt', density: 3, friction: 0.6, restitution: 0.05, toughness: 0, splits: false },
];

export function materialIndex(id: MaterialId): number {
  return MATERIALS.findIndex((m) => m.id === id);
}

export const MAT = {
  ground: materialIndex('ground'),
  wood: materialIndex('wood'),
  glass: materialIndex('glass'),
  stone: materialIndex('stone'),
  bandit: materialIndex('bandit'),
  toy: materialIndex('toy'),
  tnt: materialIndex('tnt'),
} as const;

// --- Toys -------------------------------------------------------------------

export type ShotKind = 'ball' | 'ducks' | 'rocket' | 'bear' | 'popper';

/** What tapping mid-flight does. */
export type Ability = 'none' | 'split' | 'boost' | 'slam' | 'pop';

export interface ShotDef {
  kind: ShotKind;
  name: string;
  /** One line for the level-start card. A five-year-old will have it read to her. */
  hint: string;
  radius: number;
  density: number;
  restitution: number;
  ability: Ability;
  /**
   * Damage multiplier by material. This is the rock-paper-scissors: the ducks
   * are for glass, the rocket for wood, the bear for stone. It is the only
   * thing that makes choosing WHICH tower to hit with WHICH toy a decision.
   */
  vs: { wood: number; glass: number; stone: number };
}

export const SHOTS: Record<ShotKind, ShotDef> = {
  ball: {
    kind: 'ball',
    name: 'Bouncy Ball',
    hint: 'Boing! Bounces off everything.',
    radius: 0.32,
    density: 9,
    restitution: 0.55,
    ability: 'none',
    vs: { wood: 1, glass: 1, stone: 0.5 },
  },
  ducks: {
    kind: 'ducks',
    name: 'Rubber Ducks',
    hint: 'Tap in the air to make three! Great at glass.',
    radius: 0.27,
    density: 8,
    restitution: 0.3,
    ability: 'split',
    vs: { wood: 0.7, glass: 2.5, stone: 0.4 },
  },
  rocket: {
    kind: 'rocket',
    name: 'Toy Rocket',
    hint: 'Tap in the air to ZOOM! Great at wood.',
    radius: 0.3,
    density: 8,
    restitution: 0.2,
    ability: 'boost',
    vs: { wood: 2.2, glass: 1, stone: 0.5 },
  },
  bear: {
    kind: 'bear',
    name: 'Big Teddy',
    hint: 'Heavy! Tap in the air to stomp down. Great at stone.',
    radius: 0.5,
    density: 13,
    restitution: 0.1,
    ability: 'slam',
    vs: { wood: 1.2, glass: 1, stone: 2 },
  },
  popper: {
    kind: 'popper',
    name: 'Firecracker',
    hint: 'Tap in the air to go BOOM!',
    radius: 0.34,
    density: 8,
    restitution: 0.2,
    ability: 'pop',
    vs: { wood: 1, glass: 1, stone: 0.6 },
  },
};

/** The rocket's speed after a boost, m/s, along whatever way it was heading. */
export const BOOST_SPEED = 30;
/** Seconds the rocket ignores gravity after boosting, so the zoom reads as a straight line. */
export const BOOST_FLOAT = 0.35;
/** The teddy's downward speed after a stomp, m/s. */
export const SLAM_SPEED = 24;
/** Fan angle between split ducks, radians. */
export const SPLIT_SPREAD = 0.22;
/** A firecracker that hits something goes off by itself after this long, if not tapped. */
export const POPPER_FUSE = 1.0;
