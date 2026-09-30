import * as THREE from 'three';
import { makeCanvas } from './canvas.js';

/** Carte de SALISSURE des façades, échantillonnée en coordonnées monde (tuile de
 *  17 m, volontairement sans rapport avec la tuile de brique de 5,5 m : les deux
 *  répétitions ne retombent jamais ensemble, la grille disparaît). Tuile raccord.
 *  Trois canaux indépendants (données, pas de la couleur) :
 *   R — grandes taches lentes (suie, lavage par la pluie, lots de briques différents)
 *   G — coulures verticales (bruit très étiré en hauteur)
 *   B — bruit moyen, pour rendre irrégulières les coulures sous les appuis */
export function makeGrimeTexture() {
  const S = 512, cv = makeCanvas(S, S), ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  // bruit de valeur PÉRIODIQUE (période px × py cellules) → tuile raccord
  const seed = Math.random() * 1000;
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (u, v, px, py) => {
    const x = u * px, y = v * py, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const h = (a, b) => hash(((a % px) + px) % px, ((b % py) + py) % py);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), e = h(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
  };
  const fbm = (u, v, p, oct) => { let s = 0, amp = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += amp * vnoise(u, v, p << o, p << o); n += amp; amp *= 0.5; } return s / n; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const R = Math.min(1, Math.max(0, (fbm(u, v, 3, 4) - 0.28) * 2.2));
    const col = Math.pow(vnoise(u, 0, 90, 1), 2.5);                 // quelles colonnes coulent
    const G = Math.min(1, col * (0.35 + 0.9 * vnoise(u, v, 90, 3)) * 1.6);
    const B = fbm(u, v, 12, 3);
    d[i] = R * 255; d[i + 1] = G * 255; d[i + 2] = B * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
