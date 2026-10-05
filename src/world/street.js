import * as THREE from 'three';
import { CROSS_Z, FACADE_X, LEFT_END_X, AREA_W } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { addCollider } from './collisions.js';

/* =====================================================================
   5 bis. RUES : un repère par rue
   Tout le code du décor raisonne dans le repère d'UNE rue : x en travers (façades à
   ±FACADE_X, côté −1 / +1), z le long de la rue, le joueur regardant vers −z. La rue
   principale est ce repère lui-même ; une autre rue est ce même repère TOURNÉ d'un quart
   de tour (les boîtes de collision restent alors alignées sur les axes du monde) et
   déplacé. Ses objets sont rangés dans un groupe qui porte cette transformation : le
   même code construit les deux rues. Ce qui vit en coordonnées MONDE passe par les
   méthodes ci-dessous : collisions, emprises des sujets photo, sources de lumière,
   ombres de contact, et le vieillissement des façades (uniforme `frame`, weathering.js).
   ===================================================================== */
export class Street {
  constructor(name, { angle = 0, x0 = 0, z0 = 0 } = {}) {
    this.name = name;
    this.angle = angle;
    this.c = Math.round(Math.cos(angle)); this.s = Math.round(Math.sin(angle));   // quarts de tour seulement
    this.x0 = x0; this.z0 = z0;
    this.group = new THREE.Group(); this.group.name = `rue-${name}`;
    this.group.rotation.y = angle; this.group.position.set(x0, 0, z0);
    this.group.updateMatrix(); this.group.updateMatrixWorld(true);
    this.frame = new THREE.Vector4(this.c, this.s, x0, z0);   // monde → rue, pour les shaders
    this.doorZones = [];                                        // perrons et portes à garder libres (props.js)
    // objets de la rue posés en coordonnées MONDE (ombres de contact) : groupe sans transformation,
    // à part pour être masqué avec la rue (voir updateStreetVisibility)
    this.worldGroup = new THREE.Group(); this.worldGroup.name = `rue-${name}-monde`;
    scene.add(this.group); scene.add(this.worldGroup);
  }
  /** Repère de la rue → monde. */
  wx(lx, lz) { return this.c * lx + this.s * lz + this.x0; }
  wz(lx, lz) { return -this.s * lx + this.c * lz + this.z0; }
  /** Monde → repère de la rue. */
  lx(x, z) { return this.c * (x - this.x0) - this.s * (z - this.z0); }
  lz(x, z) { return this.s * (x - this.x0) + this.c * (z - this.z0); }
  toWorld(v) { return new THREE.Vector3(this.wx(v.x, v.z), v.y, this.wz(v.x, v.z)); }
  add(o) { this.group.add(o); return o; }
  /** Boîte de collision donnée dans le repère de la rue (centre, demi-largeurs). */
  collider(cx, cz, hw, hd) {
    const x = this.wx(cx, cz), z = this.wz(cx, cz);
    if (this.s !== 0) addCollider(x, z, hd, hw); else addCollider(x, z, hw, hd);
  }
  /** Box3 du repère de la rue → Box3 monde. */
  box(b) {
    const a = this.toWorld(b.min), c = this.toWorld(b.max);
    return new THREE.Box3(a.clone().min(c), a.max(c));
  }
}

// La rue principale (repère du monde) et la rue de gauche, au-delà des feux : un quart de
// tour, son axe sur celui de la transversale (z = CROSS_Z). Son côté −1 est celui des feux
// (façades à z = CROSS_Z + FACADE_X), son côté +1 celui d'en face ; elle file vers −x.
export const MAIN = new Street('principale');
export const LEFT = new Street('gauche', { angle: Math.PI / 2, z0: CROSS_Z });
// Fond de la rue de gauche : une rangée de façades qui la ferme (impasse), construite comme un
// côté −1 d'une rue parallèle à la rue principale, décalée pour que ses façades tombent à x = LEFT_END_X.
export const LEFT_END = new Street('fond-gauche', { x0: LEFT_END_X + FACADE_X });
// Rue de droite (brownstones) : le quart de tour inverse, même axe. Elle file vers +x (z de la rue
// = −x monde) ; son côté −1 est celui d'en face (z = CROSS_Z − FACADE_X), son côté +1 celui des feux.
export const RIGHT = new Street('droite', { angle: -Math.PI / 2, z0: CROSS_Z });
// Tronçons de la rue de gauche (repère de la rue, z = x monde) : ses fusions d'objets (pierre,
// fonte, fenêtres…) sont faites par tronçon, pour pouvoir masquer ceux qu'on ne peut pas voir.
export const LEFT_CHUNKS = [-80, -50, -20];
// Tronçons de la rue de droite (z de la rue = −x monde)
export const RIGHT_CHUNKS = [-56, -34];

/* --- Ce qui ne peut pas se voir n'est pas dessiné ----------------------------------------
   Les rues secondaires sont sur l'axe de la transversale ; la rue principale y débouche entre
   deux immeubles d'angle. Selon l'endroit où se trouve la caméra :
   - DANS LA RUE PRINCIPALE, on ne voit une rue secondaire que par l'OUVERTURE du carrefour.
     Au mieux — depuis le trottoir opposé —, la droite qui passe par le coin de l'immeuble d'angle
     atteint l'alignement d'en face (zF : la ligne de façades la plus reculée de cette rue) en
       xFar = FACADE_X − 2·FACADE_X·(z − zF) / (z − façade côté feux)   (rue de gauche, symétrique à droite) :
     −16,5 m depuis le départ, −45 m depuis z = −70, tout au coin. Ce qui est entièrement au-delà
     (bord le plus proche du carrefour) est masqué.
   - DANS UNE RUE SECONDAIRE, c'est la rue principale qu'on ne voit que par le carrefour : un point
     (x, z) de la rue principale n'est visible que si la droite qui y mène passe devant l'immeuble
     d'angle, soit au mieux (point sur l'alignement d'en face) z ≤ zc + (|xc| + FACADE_X)·(façade
     côté feux − zc) / (|xc| − FACADE_X). Depuis le milieu de la rue de droite, toute la rue
     principale au-delà des premiers mètres est masquée.
   - PARTOUT, ce que la brume efface (au-delà de 100 m : 99,5 % de brouillard) est masqué : les
     deux rues secondaires sont dans le même axe et se voient l'une l'autre de loin.
   Bords d'après les sphères englobantes (celles du test de champ de Three, déjà calculées à la
   1re image) : une boîte exacte parcourait les sommets de 600 objets — 1 s figée au départ.
   Appelé à chaque image APRÈS la préparation (preload.js compile et prépare tout, masqué ou
   non) ; ne coûte qu'une comparaison par objet quand la caméra a bougé de 40 cm. */
const ZONED = [MAIN, LEFT, LEFT_END, RIGHT];
const FOG_CULL = 100;
let zoneItems = null, zoneLast = new THREE.Vector2(1e9, 1e9);
const zoneSphere = new THREE.Sphere();
export const streetZones = { where: '', xFarL: -Infinity, xFarR: Infinity, zMain: Infinity, hidden: 0, onChange: null };
export function updateStreetVisibility(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  if (Math.abs(cx - zoneLast.x) + Math.abs(cz - zoneLast.y) < 0.4) return;
  zoneLast.set(cx, cz);
  if (!zoneItems) {                                      // bords monde, calculés une fois (matrices figées)
    zoneItems = [];
    for (const st of ZONED) for (const grp of [st.group, st.worldGroup]) for (const o of grp.children) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      o.traverse(m => {
        if (!m.isMesh && !m.isPoints) return;
        const s = m.isInstancedMesh ? (m.boundingSphere ?? (m.computeBoundingSphere(), m.boundingSphere)) : (m.geometry.boundingSphere ?? (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere));
        zoneSphere.copy(s).applyMatrix4(m.matrixWorld);
        const c = zoneSphere.center, r = zoneSphere.radius;
        x0 = Math.min(x0, c.x - r); x1 = Math.max(x1, c.x + r); z0 = Math.min(z0, c.z - r); z1 = Math.max(z1, c.z + r);
      });
      if (x1 > -Infinity) zoneItems.push({ o, main: st === MAIN, side: st === MAIN ? 0 : st === RIGHT ? 1 : -1, x0, x1, z0, z1 });
    }
  }
  const F = FACADE_X, nearZ = CROSS_Z + F, farL = CROSS_Z - F, farR = CROSS_Z - F - AREA_W;
  let where = 'carrefour', xFarL = -Infinity, xFarR = Infinity, zMain = Infinity;
  if (cz > nearZ + 0.3 && Math.abs(cx) < F) {
    where = 'principale';
    xFarL = F - 2 * F * (cz - farL) / (cz - nearZ);
    xFarR = -F + 2 * F * (cz - farR) / (cz - nearZ);
  } else if (Math.abs(cx) > F + 0.3 && cz < nearZ + (cx > 0 ? AREA_W : 0)) {   // (rue de droite : perrons compris)
    where = cx < 0 ? 'gauche' : 'droite';
    zMain = cz + (Math.abs(cx) + F) * (nearZ - cz) / (Math.abs(cx) - F);
  }
  const was = streetZones.where;
  Object.assign(streetZones, { where, xFarL, xFarR, zMain });
  let hidden = 0;
  for (const it of zoneItems) {
    // distance horizontale de la caméra à la boîte (0 dedans)
    const dx = Math.max(it.x0 - cx, 0, cx - it.x1), dz = Math.max(it.z0 - cz, 0, cz - it.z1);
    let vis = dx * dx + dz * dz < FOG_CULL * FOG_CULL;
    if (vis) {
      if (it.side < 0) vis = it.x1 >= xFarL - 1;
      else if (it.side > 0) vis = it.x0 <= xFarR + 1;
      else vis = it.z0 <= zMain + 1;
    }
    it.o.visible = vis; if (!vis) hidden++;
  }
  streetZones.hidden = hidden;
  if (was && was !== where && streetZones.onChange) streetZones.onChange(where);   // ombres de la lune à refaire (lightPool)
}
