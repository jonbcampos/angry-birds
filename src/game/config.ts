/**
 * Every global tuning number in the game lives in this file.
 *
 * Units: the simulation is in METRES and seconds (see physics/body.ts for why);
 * the screen is in virtual pixels. `camera` in the renderer is the only thing
 * that converts between them.
 *
 * Exceptions, as in the sibling games: the content registries — `MATERIALS`,
 * `SHOTS` and `LEVELS` — are data tables rather than loose numbers.
 */

// --- Screen -----------------------------------------------------------------
// Same frame as the siblings, and the same export names, so core/viewport.ts
// stays a byte-identical copy.

export const DESIGN_W = 480;
export const VIRTUAL_H = 270;
export const MIN_VIRTUAL_W = DESIGN_W;
export const MAX_VIRTUAL_W = 640;
export const SCREEN = { w: DESIGN_W, h: VIRTUAL_H, rotated: false };
export const MAX_DPR = 2;

// --- Loop -------------------------------------------------------------------

export const FIXED_DT = 1 / 120;
export const MAX_FRAME_TIME = 0.25;
/**
 * Physics steps per game tick. 240Hz physics is what lets a 0.35m toy at full
 * speed hit a 0.25m plank instead of occasionally appearing on the far side of
 * it. It costs almost nothing: the busiest level steps in well under 0.1ms.
 */
export const PHYSICS_SUBSTEPS = 2;

// --- World ------------------------------------------------------------------

/** m/s². Earth-ish. Lower felt floaty; higher made every shot a lob. */
export const GRAVITY = 10;

/** The ground's top surface is y = 0. Up is negative y. */
export const GROUND_Y = 0;

/** A body further than this outside the level is gone for good. */
export const WORLD_KILL_MARGIN = 14;

// --- The slingshot ----------------------------------------------------------

/** Where the pouch rests, in world metres. Ellie stands just behind it. */
export const SLING_X = 0;
export const SLING_Y = -2.3;

/** How far the pouch can be pulled back, in metres. Purely visual. */
export const PULL_MAX_M = 1.6;

/**
 * How far the finger has to drag for full power, in virtual pixels.
 *
 * Measured on the SCREEN, not in the world, because the hand doesn't know how
 * far the camera is zoomed out. 70px is about 15mm on a 5" phone: a short,
 * comfortable pull for a small thumb, with plenty of resolution in between.
 */
export const DRAG_FULL_PX = 70;

/** A release shorter than this is a cancelled aim, not a feeble shot. */
export const DRAG_CANCEL = 0.18;

/** Launch speed at full pull, m/s. Gives about a 40m range at 45°. */
export const LAUNCH_SPEED = 20;

/**
 * How much of the flight path is drawn while aiming, in seconds.
 *
 * Angry Birds shows almost nothing and lets you learn from the dotted trail of
 * the last shot. That is a skill a five-year-old doesn't have yet: she needs to
 * see where it is going to go before it goes there. A generous preview turns
 * the game from "guess the angle" into "choose what to hit", which is the
 * part that's actually fun. Shortened rather than removed on the hard levels.
 */
export const PREVIEW_SECONDS = 1.6;
export const PREVIEW_DOTS = 26;

// --- A shot's lifetime ------------------------------------------------------

/** A toy that has been this slow for this long is finished. */
export const SHOT_REST_SPEED = 0.6;
export const SHOT_REST_TIME = 0.8;
/** Hard cap on a single shot, so a toy wedged and wobbling can't stall the level. */
export const SHOT_MAX_TIME = 9;

/**
 * Seconds after the last bandit leaves before the level is called won, so the
 * last tower gets to finish falling. Watching it fall is the reward.
 */
export const WIN_DELAY = 1.6;
/** After the last toy, how long to wait for something to fall on a bandit. */
export const LOSE_GRACE = 4;

// --- Damage -----------------------------------------------------------------

/**
 * Impacts are scored in joules of approach energy (see World.recordImpact).
 * Anything under this is settling, not hitting — without the floor, a tower
 * slowly grinds itself to dust under its own weight.
 */
export const DAMAGE_FLOOR_J = 10;

/** A bandit is bonked by this much energy. Low on purpose: they should go easily. */
export const BANDIT_HP = 32;
export const BANDIT_RADIUS = 0.42;

/** A toy that strikes this hard sends up dust and shakes the camera. */
export const BIG_IMPACT_J = 120;

// --- Scoring ----------------------------------------------------------------

export const SCORE_BANDIT = 5000;
export const SCORE_BLOCK = 500;
export const SCORE_SPARE_TOY = 10000;

// --- TNT --------------------------------------------------------------------

/**
 * TNT is the star of the show — Ellie's favourite thing in Angry Birds is the
 * TNT going off — so it is tuned to be BIG: a wide radius, a strong kick, and
 * enough damage to break stone near the middle. Several levels are built
 * around chains of it.
 */
export const TNT_RADIUS = 4.2;
/**
 * Speed kick at the centre of a blast, m/s, for something light. Falls off
 * linearly to zero at the radius, and heavy things get less of it (see
 * GameState.explode).
 *
 * Specified as a SPEED rather than an impulse because a fixed impulse sends a
 * light bandit off at 40 m/s — out of the level and gone — while barely nudging
 * a stone slab. Speed is what reads on screen, so speed is what's tuned.
 */
export const TNT_SPEED = 15;
/** Mass, kg, at which a body gets half the kick. Stone slabs lurch; they don't fly. */
export const TNT_HALF_MASS = 6;
/** Damage dealt at the centre, J, falling off to zero at the radius. */
export const TNT_DAMAGE = 340;
/** A crate's hit points. Low: any solid knock sets it off, as in Angry Birds. */
export const TNT_HP = 25;
/** Delay before a crate caught in a blast goes off, s. Makes a chain go BOOM-BOOM-BOOM, not one BOOM. */
export const TNT_CHAIN_DELAY = 0.16;
/** The firecracker toy's blast, as a fraction of a crate's. */
export const FIRECRACKER_SCALE = 0.85;

/** Seconds of slow motion after a blast, in real time, and how slow. */
export const BOOM_SLOWMO = 0.32;
export const BOOM_TIME_SCALE = 0.3;
