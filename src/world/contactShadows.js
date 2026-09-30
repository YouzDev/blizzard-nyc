import * as THREE from 'three';
import { ROAD_HALF, FACADE_X, STREET_Z_MIN, STREET_Z_MAX } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { contactBlobTex, contactEdgeTex } from '../textures/index.js';
import { groundY, STREET_LEN, STREET_ZC } from './ground.js';

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
   sur les bosses.
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

/** Tache d'ombre au sol, centrée sur (x, z), de demi-dimensions (rx, rz). */
export function addContactShadow(x, z, rx, rz, opacity = 0.5, rotY = 0, seg = 5) {
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2, seg, seg);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundY(x + p.getX(i), z + p.getZ(i)) + CONTACT_LIFT);
  const m = new THREE.Mesh(g, contactMat(contactBlobTex, opacity));
  m.position.set(x, 0, z); m.renderOrder = -1;      // avant les autres transparents (neige, vapeur)
  scene.add(m);
  return m;
}

/* --- Jonction mur / trottoir, sur toute la longueur des deux façades ---------
   C'est la ligne la plus payante de toutes : sur la photo, le bas des murs est
   nettement plus sombre que le milieu du trottoir. */
{
  const w = 1.35, segZ = 360;
  for (const s of [-1, 1]) {
    const cx = s * (FACADE_X - w / 2);
    const g = new THREE.PlaneGeometry(w, STREET_LEN, 2, segZ);
    g.rotateX(-Math.PI / 2);
    if (s > 0) g.rotateY(Math.PI);                 // u = 0 (opaque) doit tomber contre le mur
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, groundY(cx + p.getX(i), STREET_ZC + p.getZ(i)) + CONTACT_LIFT);
    const m = new THREE.Mesh(g, contactMat(contactEdgeTex, 0.55));
    m.position.set(cx, 0, STREET_ZC); m.renderOrder = -1;
    scene.add(m);
  }
  // Idem le long de la bordure côté chaussée : le bourrelet de déneigement projette
  // une ombre continue sur la neige de la rue.
  for (const s of [-1, 1]) {
    const cw = 0.9, cx = s * (ROAD_HALF - 0.35 - cw / 2);
    const g = new THREE.PlaneGeometry(cw, STREET_LEN, 1, 240);
    g.rotateX(-Math.PI / 2);
    if (s < 0) g.rotateY(Math.PI);                 // opaque du côté du bourrelet
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, groundY(cx + p.getX(i), STREET_ZC + p.getZ(i)) + CONTACT_LIFT);
    const m = new THREE.Mesh(g, contactMat(contactEdgeTex, 0.34));
    m.position.set(cx, 0, STREET_ZC); m.renderOrder = -1;
    scene.add(m);
  }
}
