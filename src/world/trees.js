import * as THREE from 'three';
import { ROAD_HALF, SIDEWALK_H, LAMP_Z0, LAMP_PITCH, FACADE_X } from '../core/constants.js';
import { rnd, smoothNoise } from '../core/noise.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { groundY } from './ground.js';
import { addContactShadowIn } from './contactShadows.js';
import { RIGHT, RIGHT_CHUNKS } from './street.js';
import { BS_ROW_END } from './brownstones.js';

/* =====================================================================
   7 quater. ARBRES (rue de droite et parc)
   Arbres d'alignement nus (platanes) dans leur fosse grillagée, grands arbres et sapins du
   parc. Tout est écrit directement dans des tableaux de sommets (des milliers de branches :
   créer autant de géométries Three coûterait des secondes au chargement), puis fusionné par
   tronçon de rue : écorce, neige, aiguilles. La neige tient sur le DESSUS de chaque branche
   assez grosse et pas trop raide (une crête blanche écrasée, posée sur la branche) : c'est ce
   qui fait lire un arbre d'hiver sous les lampadaires. Matériaux sans texture (programmes
   existants) ; les arbres portent ombre (branches dessinées sur la neige par les lampadaires).
   ===================================================================== */
const barkMat = new THREE.MeshStandardMaterial({ color: 0x3e362f, roughness: 0.92 });
const needleMat = new THREE.MeshStandardMaterial({ color: 0x14231a, roughness: 0.9 });

/** Lot de géométrie brute (positions, normales, indices) → BufferGeometry. */
class TreeBatch {
  constructor() { this.p = []; this.n = []; this.i = []; }
  get count() { return this.p.length / 3; }
  /** Tronc de cône à `sides` côtés de a (rayon ra) à b (rayon rb) ; squash/lift : crête de neige. */
  frustum(a, b, ra, rb, sides = 5, squash = 1, lift = 0) {
    const d = new THREE.Vector3().subVectors(b, a).normalize();
    const u = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3().crossVectors(d, u);
    const base = this.count;
    for (const [c, r] of [[a, ra], [b, rb]]) for (let k = 0; k < sides; k++) {
      const t = k / sides * Math.PI * 2, cx = Math.cos(t), cy = Math.sin(t);
      const nx = u.x * cx + v.x * cy, ny = u.y * cx + v.y * cy, nz = u.z * cx + v.z * cy;
      this.p.push(c.x + nx * r, c.y + ny * r * squash + lift * r, c.z + nz * r);
      this.n.push(nx, ny, nz);
    }
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides, a0 = base + k, a1 = base + k1, b0 = base + sides + k, b1 = base + sides + k1;
      this.i.push(a0, a1, b0, a1, b1, b0);
    }
  }
  /** Cône (sapin) : base de rayon r à y0, pointe à y1 ; bord ondulé. */
  cone(cx, cz, y0, y1, r, sides, seed, droop = 0, closed = false) {
    const base = this.count;
    this.p.push(cx, y1, cz); this.n.push(0, 1, 0);
    for (let k = 0; k <= sides; k++) {
      const t = k / sides * Math.PI * 2, rr = r * (0.82 + 0.3 * smoothNoise(k * 1.3 + seed, seed));
      const x = Math.cos(t), z = Math.sin(t), slope = r / (y1 - y0);
      const nl = Math.hypot(1, slope);
      this.p.push(cx + x * rr, y0 - droop * rr, cz + z * rr); this.n.push(x / nl, slope / nl, z / nl);
    }
    for (let k = 0; k < sides; k++) this.i.push(base, base + 2 + k, base + 1 + k);
    if (closed) {                                  // dessous fermé (vu d'en bas, un cône ouvert serait creux)
      const c = this.count; this.p.push(cx, y0 - droop * r * 0.5, cz); this.n.push(0, -1, 0);
      for (let k = 0; k < sides; k++) this.i.push(c, base + 1 + k, base + 2 + k);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setIndex(this.i); return g;
  }
}

/** Arbre feuillu nu : tronc puis branches qui se divisent, en coordonnées de la rue (x, sol y0, z).
 *  clear : hauteur de la première fourche ; spread : ampleur ; depth : niveaux de branches. */
function bareTree(bark, snow, x, y0, z, { height = 11, clear = 3, depth = 5, spread = 1, seed = Math.random() * 100 } = {}) {
  const rand = (() => { let s = Math.floor(seed * 9973) >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; })();
  const grow = (p, dir, len, r, lvl) => {
    // branche en 3 tronçons légèrement coudés, qui s'affine
    let a = p.clone(), ra = r;
    const n = lvl < 2 ? 3 : 2;
    for (let s = 0; s < n; s++) {
      dir = dir.clone().add(new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.4 + 0.05, rand() - 0.5).multiplyScalar(0.35)).normalize();
      const b = a.clone().addScaledVector(dir, len / n), rb = ra * (1 - 0.32 / n);
      bark.frustum(a, b, Math.max(ra, 0.016), Math.max(rb, 0.013), lvl < 2 ? 7 : lvl < 4 ? 5 : 3);   // brindilles pas plus fines que 13 mm : sinon elles disparaissent en scintillant
      if (dir.y < 0.94) snow.frustum(a, b, Math.max(ra, 0.034), Math.max(rb, 0.03), 4, 0.55, 0.9);   // crête de neige sur le dessus
      a = b; ra = rb;
    }
    if (lvl >= depth || ra < 0.012) return;
    const kids = lvl < 4 ? 3 : 2 + (rand() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      // branches qui s'écartent et montent (port du platane), un peu moins en bout
      const az = (k / kids + rand() * 0.3) * Math.PI * 2 + lvl, tilt = (0.45 + rand() * 0.35) * spread;
      const side = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const nd = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
      grow(a, nd, len * (0.62 + rand() * 0.18), ra * (0.58 + rand() * 0.1), lvl + 1);
    }
  };
  const base = new THREE.Vector3(x, y0 - 0.2, z), r0 = 0.1 + height * 0.012;
  bark.frustum(base, new THREE.Vector3(x, y0 + clear, z), r0 * 1.15, r0, 8);
  grow(new THREE.Vector3(x, y0 + clear, z), new THREE.Vector3(0, 1, 0), (height - clear) * 0.42, r0 * 0.9, 0);
}

/** Sapin enneigé : tronc, étages d'aiguilles en cônes tombants, neige épaisse sur chaque étage. */
function conifer(needles, bark, snow, x, y0, z, h = rnd(9, 15)) {
  const seed = Math.random() * 50, tiers = Math.round(h / 1.6), R = h * 0.26;
  bark.frustum(new THREE.Vector3(x, y0 - 0.2, z), new THREE.Vector3(x, y0 + h * 0.5, z), 0.18, 0.1, 6);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers, yb = y0 + 1.2 + f * (h - 1.6), r = R * (1 - f * 0.88), top = yb + Math.max(1.2, r * 1.1);
    needles.cone(x, z, yb, top, r, 12, seed + t, 0.25, true);
    snow.cone(x, z, yb + (top - yb) * 0.18, top + 0.05, r * 0.86, 12, seed + t + 7, 0.1);
  }
}

// --- Construction : un lot par tronçon de la rue de droite, plus le parc -----------------------
const chunkOf = lz => { let k = 0; while (k < RIGHT_CHUNKS.length && lz >= RIGHT_CHUNKS[k]) k++; return k; };
const lots = new Map();
const lot = k => { if (!lots.has(k)) lots.set(k, { bark: new TreeBatch(), snow: new TreeBatch(), needles: new TreeBatch() }); return lots.get(k); };

// Arbres d'alignement : au bord du trottoir, entre deux lampadaires (grille LAMP_Z0 / LAMP_PITCH de
// la rue, décalée d'un demi-pas côté +1), dans une fosse entourée d'un petit garde-corps en fonte
for (const s of [-1, 1]) {
  const first = LAMP_Z0 + (s > 0 ? LAMP_PITCH / 2 : 0) + LAMP_PITCH / 2;
  for (let z = first + LAMP_PITCH * Math.ceil((BS_ROW_END + 3 - first) / LAMP_PITCH); z < -FACADE_X - 6; z += LAMP_PITCH) {
    const x = s * (ROAD_HALF + 1.05), L = lot(chunkOf(z));
    bareTree(L.bark, L.snow, x, SIDEWALK_H + 0.12, z, { height: rnd(10, 13), clear: rnd(2.8, 3.4), depth: 6, spread: rnd(0.9, 1.15) });
    // garde-corps de la fosse (fonte, 4 côtés bas) et sa neige
    for (const [dx, dz, w, d] of [[-0.6, 0, 0.04, 1.24], [0.6, 0, 0.04, 1.24], [0, -0.6, 1.24, 0.04], [0, 0.6, 1.24, 0.04]]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), MAT.iron); g.position.set(x + dx, SIDEWALK_H + 0.45, z + dz); RIGHT.add(g);
      const sn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.04, d + 0.03), MAT.snow); sn.position.set(x + dx, SIDEWALK_H + 0.49, z + dz); RIGHT.add(sn);
    }
    RIGHT.collider(x, z, 0.62, 0.62);
    addContactShadowIn(RIGHT, x, z, 0.9, 0.9, 0.45);
  }
}

/** Arbres du parc (repère de la rue de droite, au-delà de la grille) : appelé par park.js. */
export function plantParkTrees(spots) {
  const L = lot('parc');
  for (const t of spots) {
    const y0 = groundY(RIGHT.wx(t.x, t.z), RIGHT.wz(t.x, t.z));
    if (t.kind === 'sapin') conifer(L.needles, L.bark, L.snow, t.x, y0, t.z, t.h);
    else bareTree(L.bark, L.snow, t.x, y0, t.z, { height: t.h, clear: rnd(2.5, 4), depth: 6, spread: rnd(1, 1.3) });
  }
}

/** Fusionne les lots (appelé après les arbres du parc). */
export function flushTrees() {
  for (const L of lots.values()) {
    if (L.bark.count) RIGHT.add(shadowed(new THREE.Mesh(L.bark.geometry(), barkMat)));
    if (L.needles.count) RIGHT.add(shadowed(new THREE.Mesh(L.needles.geometry(), needleMat)));
    if (L.snow.count) { const m = new THREE.Mesh(L.snow.geometry(), MAT.snow); m.receiveShadow = true; m.castShadow = true; RIGHT.add(m); }
  }
  lots.clear();
}
