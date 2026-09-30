import { makeCanvas, toTexture } from './canvas.js';

/** Enseigne néon "DELI / PIZZA" : caisson sombre, tubes rouges. Couleur > 1 pour le bloom. */
export function makeNeonTexture() {
  const c = makeCanvas(256, 512), ctx = c.getContext('2d');
  ctx.fillStyle = '#120c0a'; ctx.fillRect(0, 0, 256, 512);
  ctx.strokeStyle = '#2a1f1b'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, 244, 500);
  ctx.strokeStyle = '#7a1a10'; ctx.lineWidth = 3; ctx.strokeRect(26, 26, 204, 460);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [w, y, size] of [['DELI', 150, 100], ['PIZZA', 360, 72]]) {
    ctx.font = `bold ${size}px Impact, "Arial Narrow", sans-serif`;
    ctx.shadowColor = '#ff2a1c'; ctx.shadowBlur = 42; ctx.fillStyle = '#ff4a38'; ctx.fillText(w, 128, y);
    ctx.shadowBlur = 16; ctx.fillStyle = '#ffa090'; ctx.fillText(w, 128, y);
    ctx.shadowBlur = 0;  ctx.fillStyle = '#fff4f0'; ctx.fillText(w, 128, y);
  }
  ctx.shadowColor = '#ff2a1c'; ctx.shadowBlur = 24; ctx.strokeStyle = '#ff5040'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(44, 256); ctx.lineTo(212, 256); ctx.stroke();
  return toTexture(c, true, false);
}
