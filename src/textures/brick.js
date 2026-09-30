import { makeCanvas, toTexture, addGrain, heightToNormal } from './canvas.js';

/** Briques à l'échelle réelle. La tuile couvre 5,5 m (cf. `worldBox`) : à 2048 px
 *  une brique de 19,4 cm fait 72 px, un rang de 6,7 cm fait 25 px — l'ancienne
 *  texture avait des briques de 52 cm. Appareil à rangs de boutisses, palette de
 *  brique new-yorkaise (orangé → marron → clinker noirâtre), mortier irrégulier,
 *  éclats d'angle, efflorescences, coulures de suie et patine par zones.
 *  Retourne couleur + normal map + rugosité. */
export function makeBrickTextures() {
  const S = 2048, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const h = makeCanvas(S, S), hctx = h.getContext('2d');
  const r = makeCanvas(S, S), rctx = r.getContext('2d');
  const bw = 72, bh = 21, gap = 4;
  // mortier : ton sable-gris avec variation, en creux et très rugueux
  ctx.fillStyle = '#8a8076'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${52 + Math.random() * 36 | 0},${44 + Math.random() * 30 | 0},0.5)`; ctx.fillRect(Math.random() * S, Math.random() * S, 6, 6); }
  hctx.fillStyle = '#4a4a4a'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#f2f2f2'; rctx.fillRect(0, 0, S, S);

  // palette : trois familles de brique, mélangées par rang et par brique
  const TONES = [[176, 82, 58], [142, 62, 50], [118, 52, 46], [196, 104, 72], [90, 44, 40]];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  for (let y = -bh, row = 0; y < S + bh; y += bh + gap, row++) {
    const header = row % 6 === 5;                          // rang de boutisses tous les 6 rangs
    const bwr = header ? (bw - gap) / 2 : bw;
    const off = (row % 2) * ((bwr + gap) / 2) + (header ? 0 : 0);
    const rowT = Math.random();
    for (let x = -bw + off; x < S + bw; x += bwr + gap) {
      const t = Math.random(), clinker = Math.random() < 0.07, pale = Math.random() < 0.06;
      let col = mix(TONES[Math.floor(rowT * 3)], TONES[Math.floor(t * TONES.length)], 0.5);
      if (clinker) col = [58, 36, 32]; else if (pale) col = mix(col, [214, 160, 128], 0.6);
      col = col.map(v => v + (Math.random() - 0.5) * 14);
      const bx = Math.round(x), by = Math.round(y), bwi = Math.round(bwr) - (Math.random() < 0.3 ? 1 : 0);
      ctx.fillStyle = `rgb(${col.map(v => v | 0).join(',')})`; ctx.fillRect(bx, by, bwi, bh);
      // faces : arête haute plus claire, arête basse en ombre (relief en couleur)
      ctx.fillStyle = 'rgba(255,235,220,0.14)'; ctx.fillRect(bx, by, bwi, 2);
      ctx.fillStyle = 'rgba(20,10,8,0.35)'; ctx.fillRect(bx, by + bh - 2, bwi, 2);
      // texture de la brique : taches, grain plus grossier
      for (let k = 0; k < 4; k++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '20,10,8' : '255,230,210'},${Math.random() * 0.12})`; ctx.fillRect(bx + Math.random() * bwi, by + Math.random() * bh, 4 + Math.random() * 14, 2 + Math.random() * 5); }
      // éclat d'angle : on rend un coin au mortier
      if (Math.random() < 0.05) { ctx.fillStyle = '#7e746a'; hctx.fillStyle = '#4a4a4a'; const cw = 4 + Math.random() * 8, ch = 3 + Math.random() * 6, cx = Math.random() < 0.5 ? bx : bx + bwi - cw, cy = Math.random() < 0.5 ? by : by + bh - ch; ctx.fillRect(cx, cy, cw, ch); hctx.fillRect(cx, cy, cw, ch); }
      // hauteur : brique en relief, très légèrement bombée, bords adoucis
      const v = 165 + t * 40 + (clinker ? 25 : 0) | 0;
      const gr = hctx.createLinearGradient(bx, by, bx, by + bh);
      gr.addColorStop(0, `rgb(${v - 30},${v - 30},${v - 30})`); gr.addColorStop(0.4, `rgb(${v},${v},${v})`); gr.addColorStop(1, `rgb(${v - 22},${v - 22},${v - 22})`);
      hctx.fillStyle = gr; hctx.fillRect(bx, by, bwi, bh);
      // rugosité : brique moins rugueuse que le mortier, clinker vitrifié presque lisse, pâle très poreuse
      const rv = clinker ? 120 : pale ? 235 : 185 + t * 35 | 0;
      rctx.fillStyle = `rgb(${rv},${rv},${rv})`; rctx.fillRect(bx, by, bwi, bh);
    }
  }
  // patine par zones : suie, pluie, mousse — grands nuages sombres et quelques clairs
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S, y = Math.random() * S, rad = 120 + Math.random() * 380, dark = Math.random() < 0.72;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, dark ? `rgba(18,12,10,${0.18 + Math.random() * 0.2})` : 'rgba(255,240,225,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // coulures verticales de suie et traînées blanches d'efflorescence
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S, y0 = Math.random() * S, len = 80 + Math.random() * 500, white = Math.random() < 0.3;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, white ? 'rgba(240,235,225,0.32)' : 'rgba(15,10,8,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y0, 2 + Math.random() * 7, len);
    if (white) { rctx.fillStyle = 'rgba(255,255,255,0.5)'; rctx.fillRect(x, y0, 6, len); }
  }
  addGrain(ctx, S, S, 22); addGrain(hctx, S, S, 18);
  return { map: toTexture(c), normal: toTexture(heightToNormal(h, 2.4), false), rough: toTexture(r, false) };
}
