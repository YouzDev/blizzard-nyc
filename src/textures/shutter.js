import { makeCanvas, toTexture, addGrain } from './canvas.js';

/** Rideau métallique à lames horizontales : peinture grise fatiguée, coulures de
 *  rouille, crasse au pied, tags et affiche. Se répète en largeur (une tuile ≈ 2,5 m)
 *  pour rester net sur une baie de 8 m. */
export function makeShutterTexture() {
  const W = 512, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const base = ['#5a5e64', '#4c5058', '#6a6560'][Math.floor(Math.random() * 3)];
  // lames : chacune bombée (clair au sommet, ombre à la charnière)
  for (let y = 0; y < H; y += 12) {
    const g = ctx.createLinearGradient(0, y, 0, y + 12);
    g.addColorStop(0, shadeHex(base, 0.7)); g.addColorStop(0.35, shadeHex(base, 1.35)); g.addColorStop(0.65, base); g.addColorStop(0.92, shadeHex(base, 0.55)); g.addColorStop(1, '#24262a');
    ctx.fillStyle = g; ctx.fillRect(0, y, W, 12);
  }
  // coulures de rouille depuis des points d'accroche, s'élargissant vers le bas
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * W, y0 = Math.random() * H * 0.5, len = 60 + Math.random() * 260;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, 'rgba(120,60,25,0.55)'); g.addColorStop(1, 'rgba(120,60,25,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 2, y0); ctx.lineTo(x + 2, y0); ctx.lineTo(x + 7, y0 + len); ctx.lineTo(x - 7, y0 + len); ctx.fill();
  }
  // taches de rouille éparses
  for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(110,60,30,${Math.random() * 0.3})`; ctx.beginPath(); ctx.ellipse(Math.random() * W, Math.random() * H, 5 + Math.random() * 14, 8 + Math.random() * 30, 0, 0, 7); ctx.fill(); }
  // crasse projetée par la rue au pied du rideau
  const gr = ctx.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, 'rgba(20,18,16,0)'); gr.addColorStop(1, 'rgba(20,18,16,0.55)');
  ctx.fillStyle = gr; ctx.fillRect(0, H * 0.7, W, H * 0.3);
  // tags : un trait épais fond + un trait fin clair par-dessus, courbes libres
  const tags = 1 + Math.floor(Math.random() * 2);
  for (let t = 0; t < tags; t++) {
    const hue = Math.random() * 360, x0 = Math.random() * W * 0.7, y0 = H * (0.35 + Math.random() * 0.4);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [col, lw] of [[`hsla(${hue},70%,45%,0.75)`, 13], [`hsla(${(hue + 40) % 360},80%,80%,0.8)`, 4]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let k = 0; k < 4; k++) ctx.bezierCurveTo(x0 + Math.random() * 160, y0 - 60 + Math.random() * 120, x0 + Math.random() * 160, y0 - 60 + Math.random() * 120, x0 + 40 + k * 35, y0 + (Math.random() - 0.5) * 50);
      ctx.stroke();
    }
  }
  // affiche collée, à moitié arrachée
  if (Math.random() < 0.7) {
    const x = Math.random() * (W - 90), y = H * (0.25 + Math.random() * 0.3);
    ctx.fillStyle = ['#e8dcc4', '#d94b3a', '#2a4c9a'][Math.floor(Math.random() * 3)]; ctx.fillRect(x, y, 80, 110);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (let k = 0; k < 6; k++) ctx.fillRect(x + 10, y + 14 + k * 15, 40 + Math.random() * 25, 4);
    ctx.fillStyle = base; ctx.beginPath(); ctx.moveTo(x + 80, y + 110); ctx.lineTo(x + 80, y + 60); ctx.lineTo(x + 45, y + 110); ctx.fill();   // coin arraché
  }
  addGrain(ctx, W, H, 22);
  return toTexture(c, true, true);
}

function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.min(255, ((n >> 16) & 255) * k | 0)},${Math.min(255, ((n >> 8) & 255) * k | 0)},${Math.min(255, (n & 255) * k | 0)})`;
}
