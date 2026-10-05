import { makeCanvas, toTexture, addGrain } from './canvas.js';

/* Textures de la bouche de métro (world/subway.js) : faïence blanche « subway tile » des murs de
   l'escalier, panneau de station. */

/** Carreaux de faïence 15 × 7,5 cm posés en quinconce, joints gris, crasse qui monte du sol et
 *  coulures ; tuile de 1,2 m (512 px). */
export function makeSubwayTileTexture() {
  const S = 512, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const tw = S / 8, th = S / 16;
  ctx.fillStyle = '#6d6a62'; ctx.fillRect(0, 0, S, S);                       // joints
  for (let r = 0; r < 16; r++) for (let k = -1; k < 9; k++) {
    const x = k * tw + (r % 2) * tw / 2, y = r * th, v = 222 + Math.floor(Math.random() * 18);
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
    ctx.fillRect(x + 2, y + 2, tw - 4, th - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 4, y + 3, tw - 10, 2);   // reflet du bord émaillé
  }
  // crasse : plus sombre vers le bas, coulures
  const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(60,50,35,0.05)'); g.addColorStop(1, 'rgba(60,50,35,0.3)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(70,55,35,${0.04 + Math.random() * 0.08})`; ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 30 + Math.random() * 120); }
  addGrain(ctx, S, S, 10);
  return toTexture(c);
}

/** Panneau noir de la station : nom en blanc, pastilles des lignes. */
export function makeSubwaySignTexture(name, lines) {
  const W = 1024, H = 220, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0c0d'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 22, W, 6);                       // filet blanc en haut, comme sur les vrais
  ctx.font = 'bold 92px Helvetica, Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4f4f4';
  ctx.fillText(name, 40, 128);
  let x = W - 40 - lines.length * 112;
  for (const [letter, color] of lines) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 50, 128, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 64px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(letter, x + 50, 132); ctx.textAlign = 'left';
    x += 112;
  }
  return toTexture(c, true, false);
}
