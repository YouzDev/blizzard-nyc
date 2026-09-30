import { makeCanvas, toTexture } from './canvas.js';

/** Flocon : disque doux, légèrement irrégulier. */
export function makeFlakeTexture() {
  const c = makeCanvas(64, 64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, true, false);
}
