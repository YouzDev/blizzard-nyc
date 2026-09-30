import { makeCanvas, toTexture, addGrain, heightToNormal } from './canvas.js';

/** Pierre de soubassement, appareil REFENDU (rustication) : c'est le rez-de-chaussée
 *  de presque tous les immeubles de la rue, donc le mur que le joueur voit de plus
 *  près. L'ancienne version alignait des blocs identiques, au joint plat : on lisait
 *  un carrelage. Ici :
 *   - assises de 30 à 40 cm (les premières, de 42 à 62 cm, donnaient un mur de
 *     parpaings géants) et blocs de longueur variable (0,5 à 1,1 m) ;
 *   - REFEND HORIZONTAL : joints d'assise larges et creusés en V profond, joints
 *     verticaux fins et peu marqués — l'appareil des soubassements new-yorkais, qui
 *     dessine de longues lignes horizontales plutôt qu'une grille ;
 *   - teinte propre à chaque bloc (pierres de carrières différentes), taille de la
 *     pierre en fines stries, piqûres, veines, épaufrures aux angles ;
 *   - patine : coulures sombres qui partent des joints, crasse qui monte du trottoir,
 *     voile de sel tout en bas.
 *  Couleur presque neutre : la teinte (calcaire, brownstone, granit gris) est donnée
 *  par immeuble via `material.color`. La tuile couvre 5 m × 5 m. */
export function makeStoneTextures() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d'), h = makeCanvas(S, S), hctx = h.getContext('2d'), r = makeCanvas(S, S), rctx = r.getContext('2d');
  ctx.fillStyle = '#34302c'; ctx.fillRect(0, 0, S, S);             // fond des joints
  hctx.fillStyle = '#202020'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#ffffff'; rctx.fillRect(0, 0, S, S);
  const px = S / 5;                                                   // pixels par mètre (≈ 205)
  const CH = 12, CV = 3;                                              // chanfreins : horizontal (≈ 6 cm) / vertical (≈ 1,5 cm)
  // assises : hauteurs 0,30–0,40 m, la dernière recalée pour boucler la tuile
  const rows = []; let y = 0;
  while (y < S - 0.3 * px) { const hh = Math.round((0.3 + Math.random() * 0.1) * px); rows.push([y, hh]); y += hh; }
  rows[rows.length - 1][1] += S - y;
  for (const [y0, hh] of rows) {
    // blocs : longueurs variables, dernier bloc recalé pour que la ligne boucle
    let x = -Math.random() * px;
    const blocks = [];
    while (x < S) { const w = Math.round((0.5 + Math.random() * 0.6) * px); blocks.push([x, w]); x += w; }
    // chaque bloc est dessiné aussi décalé de ±S (raccord horizontal) : ses tirages
    // aléatoires viennent d'un générateur réamorcé à l'identique pour chaque copie
    for (const [x0, w] of blocks) { const seed = Math.random() * 4294967296 >>> 0; for (const dx of [0, -S, S]) {
      const bx = x0 + dx; if (bx > S || bx + w < 0) continue;
      let st = seed; const rand = () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296;
      const t = rand(), base = 132 + t * 76;
      const tint = [base + 6 + (rand() - 0.5) * 16, base + (rand() - 0.5) * 12, base - 8 + (rand() - 0.5) * 12];
      // hauteur : rampe du chanfrein (rectangles emboîtés de plus en plus hauts), puis face
      for (let k = 0; k < CH; k++) {                                  // rampe : rapide sur les côtés, lente en haut et en bas
        const v = 40 + (k / CH) * 150 | 0, kx = Math.min(k, CV);
        hctx.fillStyle = `rgb(${v},${v},${v})`; hctx.fillRect(bx + kx, y0 + k, w - 2 * kx, hh - 2 * k);
      }
      const fv = 190 + t * 35 | 0;
      hctx.fillStyle = `rgb(${fv},${fv},${fv})`; hctx.fillRect(bx + CV, y0 + CH, w - 2 * CV, hh - 2 * CH);
      // couleur : chanfrein un peu plus sombre (moins lavé par la pluie), face teintée
      ctx.fillStyle = `rgb(${tint.map(v => v * 0.8 | 0).join(',')})`; ctx.fillRect(bx + 1, y0 + 2, w - 2, hh - 4);
      ctx.fillStyle = `rgb(${tint.map(v => v | 0).join(',')})`; ctx.fillRect(bx + CV, y0 + CH - 2, w - 2 * CV, hh - 2 * CH + 4);
      rctx.fillStyle = '#d8d8d8'; rctx.fillRect(bx + 2, y0 + 2, w - 4, hh - 4);
      // taille de la pierre : fines stries parallèles (sens aléatoire par bloc)
      const vert = rand() < 0.5;
      for (let k = 0; k < (vert ? w : hh) - 2 * CH; k += 3) {
        const a = rand() * 0.08;
        ctx.fillStyle = `rgba(0,0,0,${a})`; hctx.fillStyle = `rgba(0,0,0,${a * 1.5})`;
        if (vert) { ctx.fillRect(bx + CH + k, y0 + CH, 1, hh - 2 * CH); hctx.fillRect(bx + CH + k, y0 + CH, 1, hh - 2 * CH); }
        else { ctx.fillRect(bx + CH, y0 + CH + k, w - 2 * CH, 1); hctx.fillRect(bx + CH, y0 + CH + k, w - 2 * CH, 1); }
      }
      // piqûres, taches, veines
      for (let k = 0; k < 12; k++) {                                  // peu de piqûres : trop, et on lit une dalle de faux plafond
        const qx = bx + CH + rand() * (w - 2 * CH), qy = y0 + CH + rand() * (hh - 2 * CH), s = 1 + rand() * 2;
        const dark = rand() < 0.85;
        ctx.fillStyle = dark ? `rgba(20,16,12,${rand() * 0.3})` : `rgba(255,248,235,${rand() * 0.08})`; ctx.fillRect(qx, qy, s, s);
        if (dark) { hctx.fillStyle = 'rgba(0,0,0,0.2)'; hctx.fillRect(qx, qy, s, s); }
      }
      const blot = ctx.createRadialGradient(bx + w * rand(), y0 + hh * rand(), 0, bx + w / 2, y0 + hh / 2, w * 0.6);
      blot.addColorStop(0, `rgba(${rand() < 0.5 ? '30,24,18' : '240,232,215'},${rand() * 0.18})`); blot.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = blot; ctx.fillRect(bx, y0, w, hh);
      if (rand() < 0.3) {
        ctx.strokeStyle = 'rgba(25,20,15,0.4)'; ctx.lineWidth = 1; ctx.beginPath();
        let vx = bx + CH + rand() * (w - 2 * CH), vy = y0 + CH; ctx.moveTo(vx, vy);
        while (vy < y0 + hh - CH) { vx += (rand() - 0.5) * 10; vy += 4 + rand() * 8; ctx.lineTo(vx, vy); }
        ctx.stroke();
      }
      // épaufrure : un angle cassé retombe au niveau du joint
      if (rand() < 0.18) {
        const cw = 8 + rand() * 18, cy = rand() < 0.5 ? y0 : y0 + hh - cw * 0.7, cx = rand() < 0.5 ? bx : bx + w - cw;
        ctx.fillStyle = 'rgba(70,62,54,0.9)'; ctx.beginPath(); ctx.ellipse(cx + cw / 2, cy + cw * 0.35, cw / 2, cw * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        hctx.fillStyle = 'rgb(90,90,90)'; hctx.beginPath(); hctx.ellipse(cx + cw / 2, cy + cw * 0.35, cw / 2, cw * 0.35, 0, 0, Math.PI * 2); hctx.fill();
      }
      // coulure sombre qui part du joint supérieur
      if (rand() < 0.35) {
        const sx = bx + rand() * w, len = hh * (0.3 + rand() * 0.9);
        const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, 'rgba(15,10,6,0.4)'); g.addColorStop(1, 'rgba(15,10,6,0)');
        ctx.fillStyle = g; ctx.fillRect(sx, y0, 3 + rand() * 10, len);
      }
    } }
  }
  // patine d'ensemble : crasse qui monte du trottoir, voile de sel tout en bas
  const gd = ctx.createLinearGradient(0, S * 0.5, 0, S); gd.addColorStop(0, 'rgba(12,9,6,0)'); gd.addColorStop(1, 'rgba(12,9,6,0.5)');
  ctx.fillStyle = gd; ctx.fillRect(0, S * 0.5, S, S * 0.5);
  const gs = ctx.createLinearGradient(0, S * 0.88, 0, S); gs.addColorStop(0, 'rgba(232,228,218,0)'); gs.addColorStop(1, 'rgba(232,228,218,0.4)');
  ctx.fillStyle = gs; ctx.fillRect(0, S * 0.88, S, S * 0.12);
  for (let i = 0; i < 500; i++) {                                     // cristaux de sel épars
    const sx = Math.random() * S, sy = S - Math.pow(Math.random(), 2) * S * 0.14, s = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(235,232,225,${0.1 + Math.random() * 0.3})`; ctx.fillRect(sx, sy, s, s);
  }
  addGrain(ctx, S, S, 16); addGrain(hctx, S, S, 10);
  return { map: toTexture(c), normal: toTexture(heightToNormal(h, 3.2), false), rough: toTexture(r, false) };
}
