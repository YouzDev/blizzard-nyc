import { makeCanvas, toTexture } from './canvas.js';

/** Grille métallique (alpha) pour les plateformes d'escalier de secours. */
export function makeGratingTexture() {
  const c = makeCanvas(128, 128), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128); ctx.fillStyle = '#222';
  for (let x = 0; x < 128; x += 16) ctx.fillRect(x, 0, 5, 128);
  for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 128, 3);
  return toTexture(c);
}
