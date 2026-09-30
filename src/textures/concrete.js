import { makeCanvas, toTexture, addGrain, heightToNormal } from './canvas.js';

/** Béton / pierre reconstituée des linteaux, appuis, bordures, soubassements de
 *  vitrine : gris chaud granuleux, traces de banche horizontales, coulures. */
export function makeConcreteTextures() {
  const S = 512, c = makeCanvas(S, S), ctx = c.getContext('2d'), h = makeCanvas(S, S), hctx = h.getContext('2d');
  ctx.fillStyle = '#6e6b64'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  // nuages de teinte : zones plus claires / plus sombres
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 40 + Math.random() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const k = Math.random() < 0.5 ? '0,0,0' : '255,250,240';
    g.addColorStop(0, `rgba(${k},${0.05 + Math.random() * 0.1})`); g.addColorStop(1, `rgba(${k},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // reprises de banche : fines lignes horizontales, légèrement en creux
  for (let y = 40; y < S; y += 128 + Math.random() * 60) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y, S, 2);
    hctx.fillStyle = '#5a5a5a'; hctx.fillRect(0, y, S, 3);
  }
  // coulures verticales
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * S, y0 = Math.random() * S * 0.6, len = 40 + Math.random() * 200;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, 'rgba(30,26,22,0.35)'); g.addColorStop(1, 'rgba(30,26,22,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y0, 3 + Math.random() * 6, len);
  }
  // piqûres et cailloux affleurants
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * S, y = Math.random() * S, s = 1 + Math.random() * 3, v = 90 + Math.random() * 60 | 0;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.6)`; ctx.fillRect(x, y, s, s);
    hctx.fillStyle = Math.random() < 0.5 ? 'rgba(60,60,60,0.7)' : 'rgba(170,170,170,0.7)'; hctx.fillRect(x, y, s, s);
  }
  addGrain(ctx, S, S, 16); addGrain(hctx, S, S, 24);
  return { map: toTexture(c), normal: toTexture(heightToNormal(h, 1.6), false) };
}
