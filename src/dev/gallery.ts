import type { ElliePose, Mood } from '../render/cast';
import { paintEllie, paintRaccoon } from '../render/scene';

/**
 * `__game.gallery()`: every raccoon mood and every Ellie pose, drawn large on
 * an overlay. In play a raccoon is about fifteen pixels across, which is too
 * small to judge whether a tongue reads as a tongue. Tap the overlay to close.
 */
const MOODS: Mood[] = ['smug', 'raspberry', 'nyah', 'toot', 'burp', 'laugh', 'scared', 'dizzy'];
const POSES: ElliePose[] = ['ready', 'tease', 'aim', 'go', 'cheer', 'ew', 'amazed', 'sad'];

export function gallery(time = 1.234): void {
  document.getElementById('gallery')?.remove();
  const c = document.createElement('canvas');
  c.id = 'gallery';
  c.width = 1600;
  c.height = 900;
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '10', background: '#cfeaff' });
  c.addEventListener('pointerdown', () => c.remove());
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  MOODS.forEach((m, i) => {
    const x = 100 + i * 200;
    ctx.save();
    ctx.translate(x, 210);
    ctx.scale(110, 110);
    paintRaccoon(ctx, 0.8, time, m, m === 'dizzy' ? 0.5 : 0);
    ctx.restore();
    ctx.fillStyle = '#223';
    ctx.fillText(m, x, 360);
  });
  POSES.forEach((p, i) => {
    const x = 100 + i * 200;
    ctx.save();
    ctx.translate(x, 820);
    ctx.scale(170, 170);
    paintEllie(ctx, p, time, 1.0, -1.9);
    ctx.restore();
    ctx.fillStyle = '#223';
    ctx.fillText(p, x, 870);
  });
}
