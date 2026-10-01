import * as THREE from 'three';
import { CROSS_Z, FACADE_X, LEFT_END_X } from '../core/constants.js';
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
// Tronçons de la rue de gauche (repère de la rue, z = x monde) : ses fusions d'objets (pierre,
// fonte, fenêtres…) sont faites par tronçon, pour pouvoir masquer ceux qu'on ne peut pas voir.
export const LEFT_CHUNKS = [-80, -50, -20];

/* --- Ce qui ne peut pas se voir n'est pas dessiné ----------------------------------------
   Depuis la rue principale, la rue de gauche est cachée par la rangée de gauche et par la
   rangée d'en face : on ne la voit que par l'OUVERTURE du carrefour (x = −FACADE_X, entre les
   deux lignes de façades de la transversale). Au mieux — depuis le trottoir de droite —, la
   droite qui passe par le coin de l'immeuble d'angle atteint la façade d'en face en
   xFar = FACADE_X − 2·FACADE_X·(z − façade d'en face) / (z − façade côté feux) :
   −16,5 m depuis le départ, −21 m depuis z = −40, −45 m depuis z = −70, tout au coin. Ce qui
   est entièrement au-delà (objets dont le bord le plus proche du carrefour est < xFar) est
   masqué. Sans ça, toute la rue de gauche (850 objets, 700 000 triangles) était dessinée en
   permanence, invisible derrière les murs et la brume : +34 % de temps GPU au départ.
   Appelé à chaque image APRÈS la préparation (preload.js compile et prépare tout, masqué
   ou non) ; ne coûte qu'une comparaison par objet quand la caméra bouge. */
const ZONED = [LEFT, LEFT_END];
let zoneItems = null, zoneLast = new THREE.Vector2(1e9, 1e9);
const zoneSphere = new THREE.Sphere();
export const streetZones = { xFar: -Infinity, hidden: 0 };
export function updateStreetVisibility(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  if (Math.abs(cx - zoneLast.x) + Math.abs(cz - zoneLast.y) < 0.4) return;
  zoneLast.set(cx, cz);
  if (!zoneItems) {                                      // bords en x monde, calculés une fois (matrices figées)
    // d'après les sphères englobantes (celles du test de champ de Three, déjà calculées à la
    // 1re image) : une boîte exacte parcourait les sommets de 600 objets — 1 s figée au départ
    zoneItems = [];
    for (const st of ZONED) for (const grp of [st.group, st.worldGroup]) for (const o of grp.children) {
      let xMax = -Infinity;
      o.traverse(m => {
        if (!m.isMesh) return;
        const s = m.isInstancedMesh ? (m.boundingSphere ?? (m.computeBoundingSphere(), m.boundingSphere)) : (m.geometry.boundingSphere ?? (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere));
        zoneSphere.copy(s).applyMatrix4(m.matrixWorld);
        xMax = Math.max(xMax, zoneSphere.center.x + zoneSphere.radius);
      });
      if (xMax > -Infinity) zoneItems.push({ o, xMax });
    }
  }
  const nearZ = CROSS_Z + FACADE_X, farZ = CROSS_Z - FACADE_X;
  const xFar = cz > nearZ + 0.3 && cx > -FACADE_X ? FACADE_X - 2 * FACADE_X * (cz - farZ) / (cz - nearZ) : -Infinity;
  streetZones.xFar = xFar; streetZones.hidden = 0;
  for (const it of zoneItems) { it.o.visible = it.xMax >= xFar - 1; if (!it.o.visible) streetZones.hidden++; }
}
