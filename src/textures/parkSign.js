import { makeCanvas, toTexture, addGrain, heightToNormal } from './canvas.js';

/** Panneau de l'entrée du parc : une dalle de pierre grise où le nom est GRAVÉ en capitales à
 *  empattements (lettres en creux, plus sombres, relief en normal map), bords épaufrés, lichen et
 *  coulures. Une seule face (la dalle mesure 2,1 × 0,62 m). */
export function makeParkSignTextures(lines = ['BALLOCH CASTLE', 'COUNTRY PARK']) {
  const W = 1024, H = 302;
  const c = makeCanvas(W, H), ctx = c.getContext('2d'), h = makeCanvas(W, H), hctx = h.getContext('2d'), r = makeCanvas(W, H), rctx = r.getContext('2d');
  ctx.fillStyle = '#8f8a82'; ctx.fillRect(0, 0, W, H);
  hctx.fillStyle = '#c8c8c8'; hctx.fillRect(0, 0, W, H);
  rctx.fillStyle = '#e0e0e0'; rctx.fillRect(0, 0, W, H);
  // patine : taches, lichen, coulures
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W, y = Math.random() * H, rad = 10 + Math.random() * 60, g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const k = Math.random();
    g.addColorStop(0, k < 0.3 ? 'rgba(90,100,70,0.25)' : k < 0.7 ? 'rgba(50,46,40,0.18)' : 'rgba(200,196,186,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * W, len = 40 + Math.random() * 160, g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(30,26,22,0.25)'); g.addColorStop(1, 'rgba(30,26,22,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 3 + Math.random() * 8, len);
  }
  // lettres gravées : creux (hauteur basse), fond sombre, bord éclairé d'un côté
  const font = size => `bold ${size}px Georgia, 'Times New Roman', serif`;
  lines.forEach((t, i) => {
    const size = 76, y = 122 + i * 112;
    for (const [g, fill, dx, dy] of [[hctx, '#5a5a5a', 0, 0], [ctx, 'rgba(255,250,240,0.25)', 2, 3], [ctx, '#2c2925', 0, 0], [rctx, '#ffffff', 0, 0]]) {
      g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      if (g.letterSpacing !== undefined) g.letterSpacing = '6px';
      g.fillStyle = fill; g.fillText(t, W / 2 + dx, y + dy);
    }
  });
  // bords épaufrés
  for (let i = 0; i < 40; i++) {
    const edge = Math.random() < 0.5, x = edge ? (Math.random() < 0.5 ? 0 : W) : Math.random() * W, y = edge ? Math.random() * H : (Math.random() < 0.5 ? 0 : H), rad = 4 + Math.random() * 14;
    ctx.fillStyle = 'rgba(120,114,104,0.8)'; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.283); ctx.fill();
    hctx.fillStyle = '#909090'; hctx.beginPath(); hctx.arc(x, y, rad, 0, 6.283); hctx.fill();
  }
  addGrain(ctx, W, H, 18); addGrain(hctx, W, H, 14);
  return { map: toTexture(c, true, false), normal: toTexture(heightToNormal(h, 3), false, false), rough: toTexture(r, false, false) };
}
