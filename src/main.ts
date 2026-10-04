import { Audio, type Sfx } from './core/audio';
import { Input, type QueuedPointer } from './core/input';
import { startLoop } from './core/loop';
import { isUnlocked, loadSave, recordStars, writeSave } from './core/save';
import { Viewport } from './core/viewport';
import { WakeLock } from './core/wakelock';
import { BIG_IMPACT_J, BOOM_SLOWMO, BOOM_TIME_SCALE, SCREEN } from './game/config';
import { MAT } from './game/content';
import { LEVELS, levelById } from './game/levels';
import { GameState, type GameEvent } from './game/state';
import { camera, frameLevel, shake, sx, sy, updateShake } from './render/camera';
import { PALETTE } from './render/palette';
import { Cast } from './render/cast';
import { Particles } from './render/particles';
import { loadSprites } from './render/sprites';
import { drawScene, drawTitleBackdrop } from './render/scene';
import {
  drawHud,
  drawPause,
  drawResult,
  drawSelect,
  drawTitle,
  hitTest,
  hudButtons,
  pauseButtons,
  resultButtons,
  selectButtons,
  titleButtons,
  type SelectTab,
} from './ui/screens';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#game canvas missing');

const viewport = new Viewport(canvas);
const input = new Input(viewport);
const state = new GameState();
const particles = new Particles();
const audio = new Audio();
const wakeLock = new WakeLock();
const cast = new Cast(audio, particles);

// Generated art, if any has been generated (scripts/generate-art.mjs). Fire and
// forget: nothing waits for it and nothing breaks without it. Each piece that
// arrives replaces the hand-drawn version of that one thing.
loadSprites(import.meta.env.BASE_URL);
// Voices and music (scripts/generate-sound.mjs), equally optional.
audio.loadRecorded(import.meta.env.BASE_URL);
const save = loadSave();
audio.muted = save.muted;

/** Where the aiming finger went down, in virtual px. */
const dragStart = { x: 0, y: 0 };
let dragging = false;
/** Seconds since the level started, for the new-toy card. */
let introTime = 0;
/** Seconds since the result panel appeared; buttons wait a moment so a stray tap can't skip it. */
let resultTime = 0;
let impactSoundsThisTick = 0;
/** Which tab the level picker is on. Opens wherever she last was. */
let selectTab: SelectTab = 'levels';
let fartClock = 0;
/** Real seconds of slow motion left, after a blast. */
let slowmo = 0;
const BOOM_WORDS = ['BOOM!', 'KABOOM!', 'BANG!', 'KA-BLAM!', 'BOOM!!'];
let boomWord = 0;
/** When the last BOOM word appeared, and how many blasts the current chain has had. */
let lastBoomWord = -10;
let chain = 0;
let realTime = 0;

// A fort stands behind the title screen, so the very first thing she sees is
// the thing she's about to knock down.
state.load(LEVELS[0]!);
state.phase = 'title';
cast.reset(state);
frameLevel(state.levelRight, state.levelTop);

function startLevel(id: number): void {
  state.load(levelById(id));
  selectTab = state.level.playground ? 'playground' : 'levels';
  particles.clear();
  cast.reset(state);
  slowmo = 0;
  frameLevel(state.levelRight, state.levelTop);
  dragging = false;
  introTime = 0;
  resultTime = 0;
}

function toggleMute(): void {
  audio.setMuted(!audio.muted);
  save.muted = audio.muted;
  writeSave(save);
}

// --- Input routing ----------------------------------------------------------

function onPointer(p: QueuedPointer): void {
  const phase = state.phase;

  if (phase === 'title') {
    if (p.kind !== 'down') return;
    const hit = hitTest(titleButtons(audio.muted), p.x, p.y);
    if (hit?.id === 'mute') toggleMute();
    else if (hit?.id === 'play') {
      audio.play('select');
      state.phase = 'select';
    }
    return;
  }

  if (phase === 'select') {
    if (p.kind !== 'down') return;
    const hit = hitTest(selectButtons(save, selectTab), p.x, p.y);
    if (!hit) return;
    if (hit.id.startsWith('tab:')) {
      audio.play('select');
      selectTab = hit.id === 'tab:playground' ? 'playground' : 'levels';
      return;
    }
    if (hit.id === 'back') {
      audio.play('select');
      state.phase = 'title';
      return;
    }
    if (hit.locked) {
      audio.play('deny');
      return;
    }
    audio.play('select');
    startLevel(Number(hit.id.slice('level:'.length)));
    return;
  }

  if (phase === 'paused') {
    if (p.kind !== 'down') return;
    const hit = hitTest(pauseButtons(audio.muted), p.x, p.y);
    if (!hit) return;
    audio.play('select');
    if (hit.id === 'resume') state.phase = state.pausedFrom;
    else if (hit.id === 'retry') startLevel(state.level.id);
    else if (hit.id === 'levels') state.phase = 'select';
    else if (hit.id === 'mute') toggleMute();
    return;
  }

  if (phase === 'won' || phase === 'lost') {
    if (p.kind !== 'down' || resultTime < 0.6) return;
    const hit = hitTest(resultButtons(phase === 'won', hasNext()), p.x, p.y);
    if (!hit) return;
    audio.play('select');
    if (hit.id === 'levels') state.phase = 'select';
    else if (hit.id === 'retry') startLevel(state.level.id);
    else if (hit.id === 'next') startLevel(state.level.id + 1);
    return;
  }

  // Playing.
  if (p.kind === 'down') {
    const hit = hitTest(hudButtons(), p.x, p.y);
    if (hit?.id === 'pause') {
      audio.play('select');
      pause();
      return;
    }
    if (hit?.id === 'restart') {
      audio.play('select');
      startLevel(state.level.id);
      return;
    }
    if (phase === 'aim') {
      dragging = true;
      dragStart.x = p.x;
      dragStart.y = p.y;
    } else if (phase === 'flight') {
      state.tap();
    }
    return;
  }
  if (p.kind === 'up' && dragging) {
    dragging = false;
    // Aim from where the finger LIFTED, not from the last tick's pull. A quick
    // flick can go down, move and lift between two ticks, and would otherwise
    // release a slingshot that was never seen to be pulled.
    const dx = p.x - dragStart.x;
    const dy = p.y - dragStart.y;
    if (Math.hypot(dx, dy) > 4) state.setAim(dx, dy);
    state.release();
  }
}

function pause(): void {
  if (state.phase !== 'aim' && state.phase !== 'flight') return;
  state.pausedFrom = state.phase;
  state.phase = 'paused';
  dragging = false;
  state.cancelAim();
}

function hasNext(): boolean {
  const next = state.level.id + 1;
  return next <= LEVELS.length && isUnlocked(save, next);
}

// --- Events -> sound and particles ------------------------------------------

const BREAK_COLORS: Record<number, readonly string[]> = {
  [MAT.wood]: [PALETTE.woodA, PALETTE.woodB, PALETTE.woodGrain],
  [MAT.glass]: [PALETTE.glassA, PALETTE.glassB, '#ffffff'],
  [MAT.stone]: [PALETTE.stoneA, PALETTE.stoneB, PALETTE.stoneEdge],
};

function hitSound(mat: number): Sfx {
  if (mat === MAT.wood) return 'hit-wood';
  if (mat === MAT.glass) return 'hit-glass';
  if (mat === MAT.stone) return 'hit-stone';
  return 'hit-ground';
}

function onEvent(e: GameEvent): void {
  switch (e.kind) {
    case 'impact': {
      // A collapse produces dozens of these per tick; three sounds are plenty.
      if (impactSoundsThisTick < 3) {
        impactSoundsThisTick++;
        audio.play(hitSound(e.mat), e.value / 250);
      }
      if (e.value > BIG_IMPACT_J) {
        particles.dust(e.x, e.y, Math.min(1.5, e.value / 400));
        shake(Math.min(0.45, e.value / 1600));
      }
      break;
    }
    case 'break': {
      const colors = BREAK_COLORS[e.mat] ?? BREAK_COLORS[MAT.wood]!;
      if (e.tag === 'split') {
        // The halves are real bodies; this is just the splinters at the break.
        particles.shards(e.x, e.y, Math.min(e.w, 0.2), Math.min(e.h, 0.2), e.a, e.vx, e.vy, colors, e.mat === MAT.stone);
      } else {
        particles.shards(e.x, e.y, e.w, e.h, e.a, e.vx, e.vy, colors, e.mat === MAT.stone);
      }
      audio.play(e.mat === MAT.glass ? 'break-glass' : e.mat === MAT.stone ? 'break-stone' : 'break-wood', 0.8);
      shake(e.mat === MAT.stone ? 0.18 : 0.08);
      break;
    }
    case 'bonk':
      // The fleeing raccoon itself is spawned by the cast, which decides
      // whether he toots on the way out.
      particles.popup(e.x, e.y - 0.8, `+${e.value}`, PALETTE.star);
      audio.play('bonk');
      shake(0.15);
      break;
    case 'launch':
      particles.dust(e.x, e.y, 0.4, '#ffffff');
      audio.play('launch', 0.5 + e.value * 0.5);
      break;
    case 'stretch':
      audio.play('stretch');
      break;
    case 'toot':
      // A whoopee cushion bounced. Harder bounces get the squeakier toot.
      audio.toot(e.value > 7 ? 'squeak' : 'pfft', 1.15, Math.min(1, e.value / 9));
      particles.tootPuff(e.x, e.y, 0.22 + Math.min(0.2, e.value * 0.02));
      break;
    case 'ability':
      if (e.tag === 'split') {
        audio.play('split');
        particles.sparks(e.x, e.y, 12, '#ffd60a');
      } else if (e.tag === 'boost') {
        audio.play('boost');
        particles.dust(e.x, e.y, 0.8, '#ffd8a8');
      } else if (e.tag === 'fart') {
        // The longest, silliest toot in the game: a rumble, then a squeak.
        audio.toot('rumble', 0.9, 1);
        audio.playRecorded(['r.fart3', 'r.fart1'], { rate: 0.9, gain: 0.8, delay: 0.1 });
        particles.toot(e.x, e.y, 0.5, -1);
      } else if (e.tag === 'slam') {
        audio.play('slam');
        particles.sparks(e.x, e.y, 8, '#ffffff');
      }
      break;
    case 'boom':
      particles.explosion(e.x, e.y, e.value, e.tag === 'toy');
      // One word at a time. A chain of five going off within a second would
      // otherwise stack five words into an unreadable smear; instead the
      // chain gets counted, and a big one earns a bigger word.
      chain = realTime - lastBoomWord < 1.2 ? chain + 1 : 1;
      if (chain === 3) {
        particles.popup(e.x, e.y - e.value * 0.6, 'MEGA BOOM!', '#ff8c42', 26, 1.4);
        lastBoomWord = realTime;
      } else if (realTime - lastBoomWord > 0.45 || chain === 1) {
        particles.popup(e.x, e.y - e.value * 0.45, BOOM_WORDS[boomWord++ % BOOM_WORDS.length]!, '#ffd23f', 20, 0.9);
        lastBoomWord = realTime;
      }
      audio.play('boom');
      if (e.tag === 'toy') audio.play('pop');
      shake(1);
      camera.flash = 1;
      audio.duck(0.3, 0.9);
      // A beat of slow motion, so the blast and the flying blocks can actually
      // be SEEN. Each blast in a chain renews it, so a chain plays out slowly.
      slowmo = BOOM_SLOWMO;
      break;
    case 'won':
      recordStars(save, state.level.id, e.value);
      audio.play('win');
      resultTime = 0;
      break;
    case 'lost':
      audio.play('lose');
      resultTime = 0;
      break;
  }
}

// --- Loop -------------------------------------------------------------------

function update(dt: number): void {
  realTime += dt;
  if (input.consumeAnyPress()) {
    audio.unlock();
    wakeLock.arm();
  }
  input.drainKeys((k) => {
    if (k === 'pause') {
      if (state.phase === 'paused') state.phase = state.pausedFrom;
      else pause();
    } else if (k === 'restart' && state.phase !== 'title' && state.phase !== 'select') {
      startLevel(state.level.id);
    } else if (k === 'trick') {
      state.tap();
    } else if (k === 'confirm' && state.phase === 'won' && hasNext()) {
      startLevel(state.level.id + 1);
    }
  });
  input.drainPointer(onPointer);

  if (dragging && state.phase === 'aim') {
    const dx = input.pointer.x - dragStart.x;
    const dy = input.pointer.y - dragStart.y;
    // A few px of dead zone, so a tap doesn't creak the band.
    if (state.aiming || Math.hypot(dx, dy) > 4) state.setAim(dx, dy);
  }

  // Music follows where she is: the title theme on the menus, a sunny tune for
  // the daytime levels, a warmer one for the sunset levels.
  const menu = state.phase === 'title' || state.phase === 'select';
  audio.setMusic(menu ? 'music.title' : state.level.id >= 11 ? 'music.dusk' : 'music.day');
  audio.updateMusic();

  if (state.phase === 'paused' || state.phase === 'title' || state.phase === 'select') return;

  impactSoundsThisTick = 0;
  // Slow motion eases back to full speed rather than snapping.
  let scale = 1;
  if (slowmo > 0) {
    slowmo -= dt;
    const k = Math.max(0, slowmo) / BOOM_SLOWMO;
    scale = 1 - (1 - BOOM_TIME_SCALE) * Math.min(1, k * 1.5);
  }
  state.update(dt * scale);

  // The fart-jet's trail: a cloud out of the nozzle every few frames.
  const lead = state.flying[0];
  if (state.phase === 'flight' && state.current === 'whoopee' && state.boostTimer > 0 && lead?.alive) {
    fartClock -= dt;
    if (fartClock <= 0) {
      fartClock = 0.04;
      const sp = Math.hypot(lead.vx, lead.vy) || 1;
      particles.tootPuff(lead.x - (lead.vx / sp) * 0.5, lead.y - (lead.vy / sp) * 0.5, 0.3, -lead.vx * 0.05);
    }
  }
  state.drainEvents((e) => {
    onEvent(e);
    cast.onEvent(e, state);
  });
  cast.update(dt * scale, state);
  particles.update(dt * scale);
  updateShake(dt, realTime);
  introTime += dt;
  if (state.phase === 'won' || state.phase === 'lost') resultTime += dt;
}

function render(alphaT: number): void {
  const ctx = viewport.ctx;
  ctx.fillStyle = PALETTE.overlay;
  ctx.fillRect(-SCREEN.w, -SCREEN.h, SCREEN.w * 3, SCREEN.h * 3);

  const t = state.phase === 'paused' || state.phase === 'title' || state.phase === 'select' ? 1 : alphaT;
  // The menus sit over the painted title picture if there is one, or over a
  // live view of level 1's fort if there isn't.
  const menu = state.phase === 'title' || state.phase === 'select';
  if (!menu || !drawTitleBackdrop(ctx)) drawScene(ctx, state, t, particles, cast);

  switch (state.phase) {
    case 'title':
      drawTitle(ctx, audio.muted, realTime);
      break;
    case 'select':
      drawSelect(ctx, save, selectTab);
      break;
    case 'paused':
      drawPause(ctx, audio.muted);
      break;
    case 'won':
    case 'lost':
      drawResult(ctx, state, hasNext(), resultTime);
      break;
    default:
      drawHud(ctx, state, introTime);
  }
}

startLoop({ update, render });

// Registered after Viewport's own listener, so SCREEN is already resized when this runs.
window.addEventListener('resize', () => frameLevel(state.levelRight, state.levelTop));
window.addEventListener('orientationchange', () => frameLevel(state.levelRight, state.levelTop));

// Offline play and instant launch from the home screen. Production only: in
// dev a caching worker would serve stale modules over Vite's hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((error) => console.warn('[sw] registration failed', error));
  });
}

if (import.meta.env.DEV) {
  void Promise.all([import('./dev/verify'), import('./dev/gallery'), import('./dev/art')]).then(([{ verify, scan }, { gallery }, { checkArt }]) => {
    (window as unknown as Record<string, unknown>).__game = {
      state,
      cast,
      gallery,
      checkArt,
      /**
       * Render this exact moment and pin it over the game as a still image,
       * so a screenshot shows it even while the live loop keeps running. Tap to
       * dismiss. For inspecting a 0.1s explosion frame by frame.
       */
      snap: () => {
        render(1);
        document.getElementById('snap')?.remove();
        const img = document.createElement('img');
        img.id = 'snap';
        img.src = canvas.toDataURL();
        Object.assign(img.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '10' });
        img.addEventListener('pointerdown', () => img.remove());
        document.body.appendChild(img);
      },
      verify,
      scan,
      level: (id: number) => startLevel(id),
      /** Run the whole game loop (sim, events, particles) for `seconds`, regardless of rAF. */
      advance: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 120) update(1 / 120);
      },
      unlockAll: () => {
        for (const l of LEVELS) save.stars[l.id] = Math.max(1, save.stars[l.id] ?? 0);
        writeSave(save);
      },
      sx,
      sy,
    };
  });
}
