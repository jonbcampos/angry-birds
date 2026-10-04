/**
 * The colour set the whole game draws with.
 *
 * The value rule for this game, which matters more than any hue choice:
 *
 *  1. **A bandit is the darkest thing in its fort.** Grey fur and a black mask
 *     against warm wood, pale glass and light stone. A child scanning a tower
 *     should find the raccoons first, before reading anything else.
 *  2. **The toys are the most saturated things on screen.** The thing she is
 *     controlling must never get lost against the scenery mid-flight.
 *  3. **Nothing in the background is shaped like a block.** Distant hills are
 *     rounded and hazed so they never read as part of a fort.
 */
export const PALETTE = {
  skyTop: '#6ec6f2',
  skyBottom: '#d8f1ff',
  sun: '#fff4b8',
  cloud: '#ffffff',
  hillFar: '#a8d8b4',
  hillNear: '#86c78f',

  grass: '#5bb84a',
  grassLight: '#7fd36a',
  dirt: '#9a6a3f',
  dirtDark: '#7d5230',
  ledge: '#a07850',
  ledgeTop: '#6cc055',

  woodA: '#e0a35c',
  woodB: '#c7853f',
  woodGrain: '#a96a2c',
  woodEdge: '#7f4c1c',

  glassA: '#bfe9ff',
  glassB: '#8fd3f5',
  glassShine: '#ffffff',
  glassEdge: '#4aa3cf',

  stoneA: '#c9c4bd',
  stoneB: '#a9a39b',
  stoneEdge: '#6f6a63',

  crack: '#3a2a1a',


  banditFur: '#8b8f98',
  banditBelly: '#c9ccd2',
  banditMask: '#26262e',
  banditEye: '#ffffff',
  banditNose: '#1a1a1f',
  banditTail: '#4b4e56',

  ellieSkin: '#f6c9a0',
  ellieHair: '#6b3b1f',
  ellieShirt: '#b05cff',
  ellieShirtDark: '#7f3dc4',
  ellieLegs: '#3d5adb',

  slingWood: '#8a5526',
  slingWoodDark: '#5f3814',
  band: '#5a2d14',

  trail: '#ffffff',
  aimDot: '#ffffff',

  hudText: '#ffffff',
  hudShadow: '#1d2a44',
  panel: '#2b3a67',
  panelEdge: '#1b2547',
  button: '#ffb703',
  buttonDark: '#c77d02',
  buttonText: '#3a2300',
  star: '#ffd23f',
  starEmpty: '#5d6a91',
  overlay: '#10162b',
} as const;

export function alpha(hex: string, a: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const lerp = (shift: number): number =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `rgb(${lerp(16)},${lerp(8)},${lerp(0)})`;
}
