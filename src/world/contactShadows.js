import * as THREE from 'three';
import { ROAD_HALF, FACADE_X, STREET_Z_MAX, CROSS_Z, LEFT_END_X, RIGHT_END_X } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { contactBlobTex, contactEdgeTex } from '../textures/index.js';
import { groundY } from './ground.js';
import { MAIN, LEFT, RIGHT } from './street.js';
import { BS_ROW_END } from './brownstones.js';

/* =====================================================================
   6 ter. OMBRES DE CONTACT
   Ce qui manquait le plus face à la photo de référence : l'assombrissement au
   pied des objets. Sans lui tout a l'air posé sur la neige plutôt que dedans.

   La scène étant STATIQUE (rien ne bouge à part les flocons, la vapeur et le
   joueur), il n'y a aucune raison de payer un SSAO recalculé 60 fois par
   seconde : on pose des décalques sombres une fois pour toutes. Coût : quelques
   dizaines de quads transparents, aucune passe de post-traitement en plus.

   Chaque décalque est SUBDIVISÉ et ses vertex sont plaqués sur `groundY` : sur
   une neige ondulée, un quad plat s'enterrerait dans les creux et flotterait
   sur les bosses. Les décalques vivent en coordonnées MONDE (groundY aussi).
   ===================================================================== */
const CONTACT_LIFT = 0.015;                 // au-dessus du sol, pour éviter le z-fighting
const contactMats = new Map();
function contactMat(tex, opacity) {
  const k = `${tex.uuid}/${opacity}`;
  if (!contactMats.has(k)) contactMats.set(k, new THREE.MeshBasicMaterial({
    map: tex, color: 0x000000, transparent: true, opacity, depthWrite: false, fog: true,
  }));
  return contactMats.get(k);
}

/** Tache d'ombre au sol, centrée sur (x, z) MONDE, de demi-dimensions (rx, rz) ; `parent` : où la
 *  ranger (par défaut la scène ; le groupe « monde » d'une rue, pour être masquée avec elle). */
export function addContactShadow(x, z, rx, rz, opacity = 0.5, rotY = 0, seg = 5, parent = scene) {
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2, seg, seg);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundY(x + p.getX(i), z + p.getZ(i)) + CONTACT_LIFT);
  const m = new THREE.Mesh(g, contactMat(contactBlobTex, opacity));
  m.position.set(x, 0, z); m.renderOrder = -1;      // avant les autres transparents (neige, vapeur)
  parent.add(m);
  return m;
}
/** Idem, centre et orientation donnés dans le repère de la rue st. */
export function addContactShadowIn(st, lx, lz, rx, rz, opacity = 0.5, rotY = 0, seg = 5) {
  return addContactShadow(st.wx(lx, lz), st.wz(lx, lz), rx, rz, opacity, rotY + st.angle, seg, st.worldGroup);
}

/** Bande d'ombre le long de la rue st : centre en travers cx, de z0 à z1 (repère de la rue) ;
 *  `flip` retourne la texture (u = 0, le côté opaque, doit tomber contre le mur ou le bourrelet). */
function band(st, cx, w, z0, z1, segZ, flip, opacity) {
  const len = z1 - z0, zc = (z0 + z1) / 2;
  const g = new THREE.PlaneGeometry(w, len, 2, segZ);
  g.rotateX(-Math.PI / 2);
  if (flip) g.rotateY(Math.PI);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const lx = cx + p.getX(i), lz = zc + p.getZ(i), x = st.wx(lx, lz), z = st.wz(lx, lz);
    p.setXYZ(i, x, groundY(x, z) + CONTACT_LIFT, z);
  }
  const m = new THREE.Mesh(g, contactMat(contactEdgeTex, opacity));
  m.renderOrder = -1; st.worldGroup.add(m);
}

/* --- Jonction mur / trottoir, sur toute la longueur des façades ---------
   C'est la ligne la plus payante de toutes : sur la photo, le bas des murs est
   nettement plus sombre que le milieu du trottoir. Idem le long de la bordure côté
   chaussée : le bourrelet de déneigement projette une ombre continue sur la neige de la rue. */
{
  const w = 1.35, cw = 0.9;
  const NEAR = CROSS_Z + FACADE_X, FAR = CROSS_Z - FACADE_X, CURB_N = CROSS_Z + ROAD_HALF;
  for (const [st, s, z0, z1, r0, r1] of [
    [MAIN, -1, NEAR, STREET_Z_MAX + 12, CURB_N + 4, STREET_Z_MAX + 10],
    [MAIN, 1, NEAR, STREET_Z_MAX + 12, CURB_N + 2, STREET_Z_MAX + 10],
    [LEFT, -1, LEFT_END_X, -FACADE_X, LEFT_END_X + 2, -FACADE_X - 1],
    [LEFT, 1, LEFT_END_X, FACADE_X, LEFT_END_X + 2, ROAD_HALF - 3],
    [RIGHT, -1, BS_ROW_END, -FACADE_X, -RIGHT_END_X + 2, -ROAD_HALF - 3],
    [RIGHT, 1, BS_ROW_END, -FACADE_X, -RIGHT_END_X + 2, -FACADE_X - 1],
  ]) {
    band(st, s * (FACADE_X - w / 2), w, z0, z1, Math.round((z1 - z0) / 0.42), s > 0, 0.55);
    band(st, s * (ROAD_HALF - 0.35 - cw / 2), cw, r0, r1, Math.round((r1 - r0) / 0.62), s < 0, 0.34);
  }
}
