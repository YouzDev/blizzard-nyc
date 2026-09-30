import * as THREE from 'three';
import { makeCanvas, toTexture, heightToNormal, addGrain } from './canvas.js';

/** Fonte peinte des lampadaires : vert-noir new-yorkais, coups de pinceau verticaux,
 *  éclats de peinture (fer nu, rouille) qui coulent vers le bas, crasse et croûte
 *  de sel sur le bas du fût (la neige salée des trottoirs remonte par éclaboussures).
 *  La texture couvre le fût une fois sur sa hauteur : v = 0 au pied, v = 1 en haut.
 *  Retourne { map, roughnessMap, normalMap }. */
export function makeLamppostTextures() {
  const W = 256, H = 1024;
  const col = makeCanvas(W, H), c = col.getContext('2d');
  const hgt = makeCanvas(W, H), h = hgt.getContext('2d');
  const rgh = makeCanvas(W, H), r = rgh.getContext('2d');
  // fonds : peinture satinée
  c.fillStyle = '#1c2621'; c.fillRect(0, 0, W, H);
  h.fillStyle = '#b0b0b0'; h.fillRect(0, 0, W, H);
  r.fillStyle = '#7a7a7a'; r.fillRect(0, 0, W, H);       // rugosité ~0,48
  // coups de pinceau verticaux (couches repeintes au fil des ans)
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W, y = Math.random() * H, len = 40 + Math.random() * 260, w = 1 + Math.random() * 3;
    const l = Math.random() < 0.5 ? 'rgba(40,54,46,0.18)' : 'rgba(10,14,12,0.2)';
    c.fillStyle = l; c.fillRect(x, y, w, len); c.fillRect(x - W, y, w, len);
    const v = Math.random() < 0.5 ? 190 : 150;
    h.fillStyle = `rgba(${v},${v},${v},0.12)`; h.fillRect(x, y, w, len);
  }
  // éclats : fer nu → rouille qui coule vers le bas (vers v = 0, donc vers le bas du canvas)
  const chip = (x, y, s) => {
    c.fillStyle = 'rgba(92,52,30,0.85)'; h.fillStyle = '#707070'; r.fillStyle = '#d0d0d0';
    for (const ctx of [c, h, r]) {
      ctx.beginPath();
      for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, rr = s * (0.5 + Math.random() * 0.7); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
      ctx.fill();
    }
    c.fillStyle = 'rgba(58,62,64,0.9)'; c.beginPath(); c.arc(x, y, s * 0.35, 0, Math.PI * 2); c.fill();   // fer nu au cœur
    const g = c.createLinearGradient(0, y, 0, y + s * (4 + Math.random() * 10));
    g.addColorStop(0, 'rgba(110,56,26,0.5)'); g.addColorStop(1, 'rgba(110,56,26,0)');
    c.fillStyle = g; c.fillRect(x - s * 0.3, y, s * 0.6, s * 14);
  };
  for (let i = 0; i < 70; i++) {
    const y = Math.pow(Math.random(), 0.6) * H;          // plus d'éclats vers le bas (chocs, pelles, chiens)
    chip(Math.random() * W, y, 1.5 + Math.random() * 4.5);
  }
  // crasse puis croûte de sel sur le premier mètre (bas du canvas)
  const grime = c.createLinearGradient(0, H, 0, H * 0.72);
  grime.addColorStop(0, 'rgba(20,18,15,0.7)'); grime.addColorStop(1, 'rgba(20,18,15,0)');
  c.fillStyle = grime; c.fillRect(0, H * 0.72, W, H * 0.28);
  for (let i = 0; i < 900; i++) {
    const y = H - Math.pow(Math.random(), 2.2) * H * 0.22, x = Math.random() * W, s = 0.6 + Math.random() * 2.4;
    c.fillStyle = `rgba(200,202,198,${0.08 + Math.random() * 0.3})`; c.fillRect(x, y, s, s * (1 + Math.random() * 2));
    r.fillStyle = '#e0e0e0'; r.fillRect(x, y, s, s);
    h.fillStyle = '#c8c8c8'; h.fillRect(x, y, s, s);
  }
  const rg = r.createLinearGradient(0, H, 0, H * 0.75);          // bas plus mat (crasse)
  rg.addColorStop(0, 'rgba(230,230,230,0.6)'); rg.addColorStop(1, 'rgba(230,230,230,0)');
  r.fillStyle = rg; r.fillRect(0, H * 0.75, W, H * 0.25);
  addGrain(c, W, H, 10); addGrain(h, W, H, 14);

  const map = toTexture(col), roughnessMap = toTexture(rgh, false), normalMap = toTexture(heightToNormal(hgt, 3), false);
  for (const t of [map, roughnessMap, normalMap]) { t.wrapT = THREE.ClampToEdgeWrapping; }
  return { map, roughnessMap, normalMap };
}

/** Halo de lampe dans la neige : décroissance exponentielle, sans plateau. L'ancien
 *  halo réutilisait la texture de flocon (disque plein à 30 %), et à 10 m de large
 *  on voyait le bord du disque. */
export function makeGlowTexture() {
  const S = 256, cv = makeCanvas(S, S), ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rr = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
    const a = rr >= 1 ? 0 : (0.75 * Math.exp(-rr * 7) + 0.25 * Math.exp(-rr * 2.6)) * (1 - rr * rr);
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(cv, true, false);
}
