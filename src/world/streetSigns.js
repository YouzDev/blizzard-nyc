import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF, CROSS_Z, SIDEWALK_H } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { makeStreetNameTexture, makeOneWayTexture, makeParkingSignTextures } from '../textures/streetSigns.js';
import { MAT } from './materials.js';
import { addSubject, boxAt } from '../game/subjects.js';

/* =====================================================================
   7 sexies. PANNEAUX DE RUE (demande utilisateur : « l'esprit New York »)
   - Aux deux potences du carrefour : les plaques VERTES des noms de rue, en croix — « Ludlow St »
     (la rue principale) et « Rivington St » (la transversale, rues de gauche et de droite : la
     station de métro porte son nom) —, et un « ONE WAY » noir à flèche blanche.
   - Sur un lampadaire sur deux : un panneau de stationnement (nettoyage alterné, arrêt interdit,
     stationnement payant), tourné le long de la rue.
   Neige collée dans les textures, une pellicule sur la tranche haute. Matériaux à texture (même
   programme que les autres) : aucun shader en plus.
   ===================================================================== */
export const MAIN_STREET_NAME = 'Ludlow St', CROSS_STREET_NAME = 'Rivington St';
// peinture rétroréfléchissante : une faible lueur propre (la texture elle-même), sinon la nuit une plaque
// loin des lampadaires n'était qu'un rectangle noir
const signMat = map => new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.2, emissiveMap: map, emissive: new THREE.Color(0.32, 0.32, 0.32) });
const ssCrossMat = signMat(makeStreetNameTexture(CROSS_STREET_NAME)), ssMainMat = signMat(makeStreetNameTexture(MAIN_STREET_NAME));
const ssOneWayMat = signMat(makeOneWayTexture()), ssEdge = new THREE.MeshStandardMaterial({ color: 0x0b5d34, roughness: 0.5, metalness: 0.2 });

/** Plaque (boîte mince) : faces avant/arrière texturées, tranches unies ; pellicule de neige dessus. */
function ssBlade(parent, w, h, x, y, z, rotY, mat, edge) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), [edge, edge, edge, edge, mat, mat]);
  m.position.set(x, y, z); m.rotation.y = rotY; parent.add(m);
  const sn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, 0.05), MAT.snow); sn.position.set(x, y + h / 2 + 0.015, z); sn.rotation.y = rotY; parent.add(sn);
  return m;
}
// les deux potences des feux (intersection.js : mât en x = ±(ROAD_HALF + 1,2), z = CROSS_Z + 7,5)
for (const side of [-1, 1]) {
  const g = new THREE.Group(), px = side * (ROAD_HALF + 1.2), pz = CROSS_Z + 7.5;
  ssBlade(g, 1.0, 0.24, px, 4.45, pz + 0.13, 0, ssCrossMat, ssEdge);                 // en travers : la transversale
  ssBlade(g, 1.0, 0.24, px - side * 0.13, 4.75, pz, Math.PI / 2, ssMainMat, ssEdge); // le long : la rue principale
  const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 10), MAT.metal); clamp.position.set(px, 4.6, pz); g.add(clamp);
  ssBlade(g, 0.78, 0.26, px, 3.45, pz + 0.13, 0, ssOneWayMat, new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 }));
  scene.add(g);
  addSubject({ label: `Le coin de ${MAIN_STREET_NAME} et ${CROSS_STREET_NAME}`, value: 0.6, box: boxAt(px, pz, 0.6, 0.6, 3.2, 4.95) });
}

// panneaux de stationnement : textures et matériaux partagés ; géométries accumulées par rue et fusionnées
// (flushParkingSigns) : un panneau isolé coûtait ~9 appels de dessin (faces, revers, pattes, neige)
const ssParkingMats = makeParkingSignTextures().map(signMat), ssBack = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, roughness: 0.5, metalness: 0.5 });
const ssParking = new Map();                                     // rue → { faces: [[…] par texture], back: [], snow: [] }
/** Panneau de stationnement sur le lampadaire (x, z) de la rue st, face le long de la rue. */
export function addParkingSign(st, x, z) {
  if (!ssParking.has(st)) ssParking.set(st, { faces: ssParkingMats.map(() => []), back: [], snow: [] });
  const L = ssParking.get(st), k = Math.floor(Math.random() * ssParkingMats.length), e = Math.random() < 0.5 ? 1 : -1, y = SIDEWALK_H + 2.45, zp = z + e * 0.11;
  const face = new THREE.PlaneGeometry(0.32, 0.46); if (e < 0) face.rotateY(Math.PI); face.translate(x, y, zp + e * 0.0065); L.faces[k].push(face);
  const back = new THREE.BoxGeometry(0.32, 0.46, 0.012); back.translate(x, y, zp); L.back.push(back);
  for (const dy of [-0.16, 0.16]) { const b = new THREE.BoxGeometry(0.2, 0.025, 0.03); b.translate(x, y + dy, z + e * 0.09); L.back.push(b); }
  const sn = new THREE.BoxGeometry(0.33, 0.03, 0.04); sn.translate(x, y + 0.245, zp); L.snow.push(sn);
}
export function flushParkingSigns() {
  for (const [st, L] of ssParking) {
    L.faces.forEach((list, k) => { if (list.length) st.add(new THREE.Mesh(mergeGeometries(list), ssParkingMats[k])); });
    st.add(new THREE.Mesh(mergeGeometries(L.back), ssBack));
    st.add(new THREE.Mesh(mergeGeometries(L.snow), MAT.snow));
  }
  ssParking.clear();
}
