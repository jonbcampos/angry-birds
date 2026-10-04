import { SCREEN } from '../game/config';
import { SHOTS } from '../game/content';
import type { GameState } from '../game/state';
import { LEVELS } from '../game/levels';
import { isUnlocked, type Save } from '../core/save';
import { PALETTE, alpha } from '../render/palette';
import { paintEllie, paintRaccoon, paintToy, roundRect } from '../render/scene';
import { sprite } from '../render/sprites';
import { drawText } from './text';

/**
 * Menus, overlays and the in-level HUD.
 *
 * Every screen is a pure function from state to a list of buttons, used both
 * to draw and to hit-test, so what is drawn and what is tappable can never
 * disagree. Buttons are big: the smallest one is 30px tall, about 7mm on a 5"
 * phone, which is the floor for a child's fingertip.
 */

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  style: 'primary' | 'secondary' | 'icon' | 'tile';
  locked?: boolean;
  stars?: number;
}

export function hitTest(buttons: readonly Button[], x: number, y: number): Button | null {
  // A few px of slop around every button: a near miss is still a press.
  const slop = 4;
  for (const b of buttons) {
    if (x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop) return b;
  }
  return null;
}

// --- Layouts ----------------------------------------------------------------

export function titleButtons(muted: boolean): Button[] {
  const cx = SCREEN.w / 2;
  return [
    { id: 'play', x: cx - 60, y: 150, w: 120, h: 40, label: 'PLAY', style: 'primary' },
    muteButton(muted),
  ];
}

function muteButton(muted: boolean): Button {
  return { id: 'mute', x: SCREEN.w - 40, y: 8, w: 32, h: 32, label: muted ? 'mute' : 'sound', style: 'icon' };
}

const COLS = 5;
const TILE_W = 64;
const TILE_H = 50;
const GAP = 10;

export function selectButtons(save: Save): Button[] {
  const out: Button[] = [{ id: 'back', x: 8, y: 8, w: 60, h: 30, label: 'BACK', style: 'secondary' }];
  const gridW = COLS * TILE_W + (COLS - 1) * GAP;
  const x0 = (SCREEN.w - gridW) / 2;
  const y0 = 56;
  LEVELS.forEach((l, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    out.push({
      id: `level:${l.id}`,
      x: x0 + col * (TILE_W + GAP),
      y: y0 + row * (TILE_H + GAP),
      w: TILE_W,
      h: TILE_H,
      label: String(l.id),
      style: 'tile',
      locked: !isUnlocked(save, l.id),
      stars: save.stars[l.id] ?? 0,
    });
  });
  return out;
}

export function hudButtons(): Button[] {
  return [
    { id: 'pause', x: 8, y: 8, w: 30, h: 30, label: 'pause', style: 'icon' },
    { id: 'restart', x: 44, y: 8, w: 30, h: 30, label: 'restart', style: 'icon' },
  ];
}

function panelRect(): { x: number; y: number; w: number; h: number } {
  const w = 260;
  const h = 170;
  return { x: (SCREEN.w - w) / 2, y: (SCREEN.h - h) / 2, w, h };
}

export function resultButtons(won: boolean, hasNext: boolean): Button[] {
  const p = panelRect();
  const y = p.y + p.h - 46;
  const out: Button[] = [{ id: 'levels', x: p.x + 14, y, w: 66, h: 34, label: 'LEVELS', style: 'secondary' }];
  if (won && hasNext) {
    out.push({ id: 'retry', x: p.x + 90, y, w: 66, h: 34, label: 'AGAIN', style: 'secondary' });
    out.push({ id: 'next', x: p.x + 166, y, w: 80, h: 34, label: 'NEXT', style: 'primary' });
  } else {
    out.push({ id: 'retry', x: p.x + 106, y, w: 140, h: 34, label: won ? 'AGAIN' : 'TRY AGAIN', style: 'primary' });
  }
  return out;
}

export function pauseButtons(muted: boolean): Button[] {
  const p = panelRect();
  const cx = p.x + p.w / 2;
  return [
    { id: 'resume', x: cx - 70, y: p.y + 44, w: 140, h: 34, label: 'KEEP PLAYING', style: 'primary' },
    { id: 'retry', x: cx - 70, y: p.y + 84, w: 66, h: 30, label: 'RESTART', style: 'secondary' },
    { id: 'levels', x: cx + 4, y: p.y + 84, w: 66, h: 30, label: 'LEVELS', style: 'secondary' },
    { id: 'mute', x: cx - 70, y: p.y + 122, w: 140, h: 30, label: muted ? 'SOUND: OFF' : 'SOUND: ON', style: 'secondary' },
  ];
}

// --- Drawing ----------------------------------------------------------------

export function drawButtons(ctx: CanvasRenderingContext2D, buttons: readonly Button[]): void {
  for (const b of buttons) drawButton(ctx, b);
}

function drawButton(ctx: CanvasRenderingContext2D, b: Button): void {
  if (b.style === 'icon') {
    ctx.fillStyle = alpha(PALETTE.panel, 0.75);
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (b.label === 'pause') {
      ctx.fillRect(cx - 5, cy - 6, 3.5, 12);
      ctx.fillRect(cx + 1.5, cy - 6, 3.5, 12);
    } else if (b.label === 'restart') {
      ctx.beginPath();
      ctx.arc(cx, cy, 6.5, -Math.PI * 0.35, Math.PI * 1.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy - 10);
      ctx.lineTo(cx + 6.5, cy - 4);
      ctx.lineTo(cx + 0.5, cy - 4.5);
      ctx.fill();
    } else {
      // Speaker, with or without waves.
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 3);
      ctx.lineTo(cx - 4, cy - 3);
      ctx.lineTo(cx + 1, cy - 8);
      ctx.lineTo(cx + 1, cy + 8);
      ctx.lineTo(cx - 4, cy + 3);
      ctx.lineTo(cx - 8, cy + 3);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (b.label === 'sound') {
        ctx.arc(cx + 2, cy, 5, -0.8, 0.8);
        ctx.moveTo(cx + 5.5, cy - 7);
        ctx.arc(cx + 2, cy, 8.5, -0.8, 0.8);
      } else {
        ctx.moveTo(cx + 4, cy - 4);
        ctx.lineTo(cx + 10, cy + 4);
        ctx.moveTo(cx + 10, cy - 4);
        ctx.lineTo(cx + 4, cy + 4);
      }
      ctx.stroke();
    }
    return;
  }

  if (b.style === 'tile') {
    ctx.fillStyle = b.locked ? alpha(PALETTE.panelEdge, 0.85) : PALETTE.panel;
    roundRect(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.fill();
    ctx.strokeStyle = b.locked ? PALETTE.panelEdge : '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (b.locked) {
      // A padlock.
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      ctx.strokeStyle = PALETTE.starEmpty;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 6, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = PALETTE.starEmpty;
      ctx.fillRect(cx - 9, cy - 4, 18, 13);
      return;
    }
    drawText(ctx, b.label, b.x + b.w / 2, b.y + 19, { size: 18, align: 'center', color: '#ffffff' });
    for (let i = 0; i < 3; i++) {
      star(ctx, b.x + b.w / 2 + (i - 1) * 16, b.y + b.h - 13, 6, i < (b.stars ?? 0));
    }
    return;
  }

  const primary = b.style === 'primary';
  ctx.fillStyle = primary ? PALETTE.buttonDark : PALETTE.panelEdge;
  roundRect(ctx, b.x, b.y + 3, b.w, b.h, 10);
  ctx.fill();
  ctx.fillStyle = primary ? PALETTE.button : '#4a5f9e';
  roundRect(ctx, b.x, b.y, b.w, b.h, 10);
  ctx.fill();
  drawText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, {
    size: primary ? 14 : 11,
    align: 'center',
    color: primary ? PALETTE.buttonText : '#ffffff',
  });
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean): void {
  ctx.fillStyle = filled ? PALETTE.star : PALETTE.starEmpty;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  if (filled) {
    ctx.strokeStyle = '#c98a00';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function dim(ctx: CanvasRenderingContext2D, a = 0.55): void {
  ctx.fillStyle = alpha(PALETTE.overlay, a);
  ctx.fillRect(-20, -20, SCREEN.w + 40, SCREEN.h + 40);
}

function panel(ctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  const p = panelRect();
  ctx.fillStyle = PALETTE.panelEdge;
  roundRect(ctx, p.x, p.y + 4, p.w, p.h, 14);
  ctx.fill();
  ctx.fillStyle = PALETTE.panel;
  roundRect(ctx, p.x, p.y, p.w, p.h, 14);
  ctx.fill();
  return p;
}

export function drawTitle(ctx: CanvasRenderingContext2D, muted: boolean, time: number): void {
  const painted = sprite('title') !== null;
  dim(ctx, painted ? 0.12 : 0.35);
  if (painted) {
    // Ellie stands by the painted slingshot, cheering now and then.
    ctx.save();
    ctx.translate(SCREEN.w * 0.2, SCREEN.h * 0.95);
    ctx.scale(44, 44);
    paintEllie(ctx, Math.sin(time * 0.9) > 0.6 ? 'cheer' : 'ready', time, 1, -1.9);
    ctx.restore();
  }
  const cx = SCREEN.w / 2;
  const bob = Math.sin(time * 2) * 3;
  drawText(ctx, "ELLIE'S SLINGSHOT", cx + 2, 62 + bob + 2, { size: 30, align: 'center', color: PALETTE.hudShadow });
  drawText(ctx, "ELLIE'S SLINGSHOT", cx, 62 + bob, { size: 30, align: 'center', color: '#ffffff' });
  drawText(ctx, 'vs. the Raccoon Bandits', cx, 96, { size: 13, align: 'center', color: PALETTE.star, glow: true });

  // A pair of bandits peeking up from behind the subtitle.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + side * 150, 104 + Math.sin(time * 3 + side) * 2);
    ctx.scale(18, 18);
    // Teasing her from the title screen, taking turns.
    const mood = Math.floor(time / 1.6 + (side > 0 ? 1 : 0)) % 2 === 0 ? (side > 0 ? 'nyah' : 'raspberry') : 'smug';
    paintRaccoon(ctx, 0.8, time + side, mood, 0);
    ctx.restore();
  }
  drawButtons(ctx, titleButtons(muted));
  drawText(ctx, 'Pull back, let go, and bonk the bandits!', cx, 214, { size: 10, align: 'center', color: '#ffffff' });
}

export function drawSelect(ctx: CanvasRenderingContext2D, save: Save): void {
  dim(ctx, sprite('title') ? 0.45 : 0.6);
  drawText(ctx, 'PICK A FORT', SCREEN.w / 2, 24, { size: 18, align: 'center', color: '#ffffff' });
  drawButtons(ctx, selectButtons(save));
}

export function drawResult(ctx: CanvasRenderingContext2D, state: GameState, hasNext: boolean, appear: number): void {
  dim(ctx, 0.45 * Math.min(1, appear * 3));
  const won = state.phase === 'won';
  ctx.save();
  // A little pop-in: overshoots slightly and settles.
  const s = appear < 0.25 ? 0.6 + (appear / 0.25) * 0.5 : 1.1 - Math.min(0.1, (appear - 0.25) * 0.6);
  ctx.translate(SCREEN.w / 2, SCREEN.h / 2);
  ctx.scale(s, s);
  ctx.translate(-SCREEN.w / 2, -SCREEN.h / 2);
  const p = panel(ctx);
  const cx = p.x + p.w / 2;
  if (won) {
    drawText(ctx, 'BANDITS BONKED!', cx, p.y + 22, { size: 18, align: 'center', color: '#ffffff' });
    for (let i = 0; i < 3; i++) {
      // Stars fill one after another.
      const filled = i < state.stars && appear > 0.35 + i * 0.3;
      star(ctx, cx + (i - 1) * 46, p.y + 66 + (i === 1 ? -6 : 0), i === 1 ? 20 : 16, filled);
    }
    drawText(ctx, `${state.score}`, cx, p.y + 102, { size: 13, align: 'center', color: PALETTE.star });
  } else {
    drawText(ctx, 'THOSE SNEAKY BANDITS!', cx, p.y + 26, { size: 15, align: 'center', color: '#ffffff' });
    drawText(ctx, `${state.banditsLeft} still hiding. Try again!`, cx, p.y + 56, { size: 11, align: 'center', color: '#dfe6ff' });
    ctx.save();
    ctx.translate(cx, p.y + 92);
    ctx.scale(20, 20);
    paintRaccoon(ctx, 0.75, state.time, 'laugh', 0);
    ctx.restore();
  }
  drawButtons(ctx, resultButtons(won, hasNext));
  ctx.restore();
}

export function drawPause(ctx: CanvasRenderingContext2D, muted: boolean): void {
  dim(ctx);
  const p = panel(ctx);
  drawText(ctx, 'PAUSED', p.x + p.w / 2, p.y + 22, { size: 18, align: 'center', color: '#ffffff' });
  drawButtons(ctx, pauseButtons(muted));
}

/** The in-level HUD: buttons, bandits left, score, and the new-toy card. */
export function drawHud(ctx: CanvasRenderingContext2D, state: GameState, introTime: number): void {
  drawButtons(ctx, hudButtons());

  // Bandits left, as faces. Counting faces is easier than reading a number.
  let x = SCREEN.w - 18;
  for (let i = 0; i < state.banditsLeft; i++) {
    ctx.save();
    ctx.translate(x, 22);
    ctx.scale(11, 11);
    paintRaccoon(ctx, 0.8, state.time + i, 'smug', 0);
    ctx.restore();
    x -= 22;
  }
  drawText(ctx, `${state.score}`, SCREEN.w - 10, 46, { size: 10, align: 'right', color: '#ffffff', glow: true });

  drawText(ctx, `${state.level.id}. ${state.level.name}`, 84, 23, { size: 10, color: '#ffffff', glow: true });

  // The new-toy card: what it is and what tapping does.
  const kind = state.level.introduces;
  if (kind && introTime < 6 && state.phase === 'aim') {
    const a = Math.min(1, introTime * 3, (6 - introTime) * 2);
    const def = SHOTS[kind];
    const w = 250;
    const x0 = (SCREEN.w - w) / 2;
    const y0 = 52;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = alpha(PALETTE.panel, 0.92);
    roundRect(ctx, x0, y0, w, 44, 10);
    ctx.fill();
    ctx.save();
    ctx.translate(x0 + 24, y0 + 22);
    ctx.scale(28, 28);
    paintToy(ctx, kind, def.radius, 0, 0, state.time, false);
    ctx.restore();
    drawText(ctx, `NEW TOY: ${def.name.toUpperCase()}`, x0 + 48, y0 + 14, { size: 10, color: PALETTE.star });
    drawText(ctx, def.hint, x0 + 48, y0 + 30, { size: 8, color: '#ffffff', bold: false });
    ctx.restore();
  }

  // While aiming, name the toy in the pouch.
  if (state.phase === 'aim' && state.queue.length > 0 && !state.aiming && state.winTimer < 0) {
    const def = SHOTS[state.queue[0]!];
    if (def.ability !== 'none' && !(kind && introTime < 6)) {
      drawText(ctx, def.hint, SCREEN.w / 2, SCREEN.h - 12, { size: 9, align: 'center', color: '#ffffff', glow: true });
    }
  }
  if (state.phase === 'flight' && !state.abilityUsed && state.flightTime < 1.5) {
    drawText(ctx, 'TAP!', SCREEN.w / 2, 70, { size: 16, align: 'center', color: PALETTE.star, glow: true });
  }
}
