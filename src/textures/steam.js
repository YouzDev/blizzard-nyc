import { makeCanvas, toTexture } from './canvas.js';

/** Bouffée de vapeur : disque très doux, bord irrégulier, quelques trous. */
export function makePuffTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // grumeaux : on retire des bouts pour casser la rondeur
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.283, r = S * (0.22 + Math.random() * 0.3);
    const gg = ctx.createRadialGradient(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 0, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 8 + Math.random() * 16);
    gg.addColorStop(0, 'rgba(0,0,0,0.6)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, S, S);
  }
  return toTexture(c, true, false);
}
