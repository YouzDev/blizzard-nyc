import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIDEWALK_H } from '../core/constants.js';
import { makeSubwayTileTexture, makeSubwaySignTexture } from '../textures/subway.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { LEFT } from './street.js';
import { SUBWAY } from './ground.js';
import { snowPad, flushSnowPads, beginStreet, endStreet, paintMat } from './buildings.js';
import { bsStrut, bsSnowStrip } from './brownstones.js';
import { addPointSource } from './lightRegistry.js';
import { addWalkZone } from './walkSurface.js';
import { addSubject, boxAt } from '../game/subjects.js';
import { buildPlume } from '../fx/steam.js';

/* =====================================================================
   10 quater. BOUCHE DE MÉTRO (rue de gauche)
   L'identité de la rue de gauche (demande utilisateur) : au coin, devant la bodega allumée, un
   escalier de métro new-yorkais s'enfonce dans le trottoir — margelle de granit, garde-corps en
   fonte peinte en vert, deux GLOBES VERTS sur leurs poteaux (station ouverte), panneau noir de la
   station. On peut y descendre : 16 marches (les premières sous la neige, les suivantes mouillées)
   jusqu'à un palier carrelé de faïence blanche ; au fond, un couloir éclairé au néon, fermé par
   une grille en accordéon. De l'air tiède en remonte en vapeur.
   Repère de la rue de gauche (côté feux, x < 0) ; trémie SUBWAY creusée dans le sol par ground.js.
   (Noms de premier niveau préfixés « sb » : le collage mono-fichier met tous les modules ensemble.)
   ===================================================================== */
const { x0: SB_X0, x1: SB_X1, z0: SB_Z0, z1: SB_Z1 } = SUBWAY, SB_XC = (SB_X0 + SB_X1) / 2, SB_WW = SB_X1 - SB_X0;
const SB_N = 16, SB_RISE = 0.18, SB_RUN = 0.29, SB_YG = SIDEWALK_H + 0.02;
const sbNose = i => SB_Z1 - 0.15 - i * SB_RUN, sbLevel = k => SB_YG - k * SB_RISE;
const SB_YB = sbLevel(SB_N);                            // palier du bas (−2,68 m)
const SB_YC = SB_YG + 0.08;                             // dessus de la margelle
const SB_PZ0 = SB_Z0 + 0.05, SB_PZ1 = SB_Z0 + 1.0, SB_PH = 2.2;   // couloir du fond (ouverture dans le mur côté façade)

const sbTileMat = new THREE.MeshStandardMaterial({ map: makeSubwayTileTexture(), color: 0x8f8c84, roughness: 0.22, metalness: 0, envMapIntensity: 0.9 });
const sbRailMat = paintMat(0x1d4a31, 0.55, 0.35);       // fonte peinte en vert métro
const sbNosingMat = paintMat(0xb08f22, 0.5, 0.4);        // nez de marche jaunis
const sbGlobeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 1.55, 0.62) });
const sbTubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 2.2, 2.4) });

/** Boîte (repère de la rue) d'une étendue [xa, xb] × [ya, yb] × [za, zb] ; UV en tuiles de `tile` m. */
function sbBox(list, xa, xb, ya, yb, za, zb, tile = 1.2) {
  const w = xb - xa, h = yb - ya, d = zb - za, g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    uv.setXY(i, uv.getX(i) * (ax > 0.5 ? d : w) / tile, uv.getY(i) * (ay > 0.5 ? d : h) / tile);
  }
  g.translate((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2); list.push(g); return g;
}
/** Plan tourné vers l'intérieur d'une pièce (couloir) : normale n, centre c, taille w × h. */
function sbPlane(list, c, n, w, h, tile = 1.2) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)));
  g.translate(c.x, c.y, c.z); list.push(g);
}
const sbV = (x, y, z) => new THREE.Vector3(x, y, z);

beginStreet(LEFT, 1);
const sbConc = [], sbTiles = [], sbGranite = [], sbRail = [], sbNosing = [], sbIron = [], sbGlobes = [], sbTubes = [];

// --- Marches (béton, nez de marche), seuil de granit en haut, palier du bas
sbBox(sbGranite, SB_X0 - 0.1, SB_X1 + 0.1, -0.5, SB_YG, sbNose(0), SB_Z1 + 0.45);
snowPad(SB_XC, SB_YG, (sbNose(0) + SB_Z1 + 0.45) / 2, SB_WW + 0.1, SB_Z1 + 0.45 - sbNose(0), 0.07);
for (let i = 0; i < SB_N; i++) {
  const top = sbLevel(i + 1), za = i === SB_N - 1 ? SB_Z0 - 0.2 : sbNose(i) - SB_RUN, zb = sbNose(i);
  sbBox(sbConc, SB_X0, SB_X1, SB_YB - 0.25, top, za, zb, 2);
  sbBox(sbNosing, SB_X0 + 0.02, SB_X1 - 0.02, top - 0.025, top + 0.006, zb - 0.06, zb + 0.004);
  // la neige entre par le haut : épaisse sur les premières marches, rien plus bas (marches mouillées)
  if (i < 6) snowPad(SB_XC, top, zb - SB_RUN / 2, SB_WW - 0.05, SB_RUN - 0.04, 0.075 * (1 - i / 6.5), 0, 0.1);
  if (i < 9) for (const e of [-1, 1]) snowPad(e < 0 ? SB_X0 + 0.12 : SB_X1 - 0.12, top, zb - SB_RUN / 2, 0.22, SB_RUN - 0.02, 0.09 * (1 - i / 10));   // congère le long des murs
}

// --- Murs carrelés (faces intérieures en x0, x1, z0), ouverture du couloir dans le mur côté façade
const SB_WALL_TOP = SB_YG + 0.02, SB_WALL_BOT = SB_YB - 0.25;
sbBox(sbTiles, SB_X1, SB_X1 + 0.2, SB_WALL_BOT, SB_WALL_TOP, SB_Z0 - 0.2, SB_Z1);
sbBox(sbTiles, SB_X0 - 0.2, SB_X1 + 0.2, SB_WALL_BOT, SB_WALL_TOP, SB_Z0 - 0.2, SB_Z0);
sbBox(sbTiles, SB_X0 - 0.2, SB_X0, SB_WALL_BOT, SB_WALL_TOP, SB_Z0 - 0.2, SB_PZ0);
sbBox(sbTiles, SB_X0 - 0.2, SB_X0, SB_WALL_BOT, SB_WALL_TOP, SB_PZ1, SB_Z1);
sbBox(sbTiles, SB_X0 - 0.2, SB_X0, SB_YB + SB_PH, SB_WALL_TOP, SB_PZ0, SB_PZ1);
// bandeau de mosaïque vert foncé à hauteur d'homme
for (const [xa, xb, za, zb] of [[SB_X1 - 0.012, SB_X1, SB_Z0, SB_Z1], [SB_X0, SB_X1, SB_Z0, SB_Z0 + 0.012], [SB_X0, SB_X0 + 0.012, SB_Z0, SB_PZ0], [SB_X0, SB_X0 + 0.012, SB_PZ1, SB_Z1]])
  sbBox(sbRail, xa, xb, SB_YB + 1.95, SB_YB + 2.1, za, zb);
// couloir du fond, sous le trottoir : sol, plafond, murs, néon ; grille en accordéon fermée
const SB_CX0 = SB_X0 - 3.2, SB_PZC = (SB_PZ0 + SB_PZ1) / 2;
sbPlane(sbConc, sbV((SB_X0 + SB_CX0) / 2, SB_YB + 0.001, SB_PZC), sbV(0, 1, 0), SB_PZ1 - SB_PZ0, SB_X0 - SB_CX0);
sbPlane(sbTiles, sbV((SB_X0 + SB_CX0) / 2, SB_YB + SB_PH, SB_PZC), sbV(0, -1, 0), SB_PZ1 - SB_PZ0, SB_X0 - SB_CX0);
sbPlane(sbTiles, sbV(SB_CX0, SB_YB + SB_PH / 2, SB_PZC), sbV(1, 0, 0), SB_PZ1 - SB_PZ0, SB_PH);
sbPlane(sbTiles, sbV((SB_X0 + SB_CX0) / 2, SB_YB + SB_PH / 2, SB_PZ0), sbV(0, 0, 1), SB_X0 - SB_CX0, SB_PH);
sbPlane(sbTiles, sbV((SB_X0 + SB_CX0) / 2, SB_YB + SB_PH / 2, SB_PZ1), sbV(0, 0, -1), SB_X0 - SB_CX0, SB_PH);
sbBox(sbTubes, SB_CX0 + 0.4, SB_X0 - 0.3, SB_YB + SB_PH - 0.06, SB_YB + SB_PH - 0.02, SB_PZC - 0.05, SB_PZC + 0.05);
{
  const gx = SB_X0 - 0.45, n = 7;
  for (let k = 0; k <= n; k++) {                          // losanges de la grille en accordéon
    const za = SB_PZ0 + (SB_PZ1 - SB_PZ0) * k / n, zb = SB_PZ0 + (SB_PZ1 - SB_PZ0) * Math.min(n, k + 1) / n, zm = SB_PZ0 + (SB_PZ1 - SB_PZ0) * Math.max(0, k - 1) / n;
    if (k < n) bsStrut(sbIron, sbV(gx, SB_YB + 0.05, za), sbV(gx, SB_YB + SB_PH - 0.05, zb), 0.022);
    if (k > 0) bsStrut(sbIron, sbV(gx, SB_YB + 0.05, za), sbV(gx, SB_YB + SB_PH - 0.05, zm), 0.022);
    const s = new THREE.BoxGeometry(0.03, SB_PH - 0.1, 0.03); s.translate(gx, SB_YB + SB_PH / 2, za); sbIron.push(s);
  }
  for (const y of [SB_YB + 0.05, SB_YB + SB_PH - 0.05]) { const r = new THREE.BoxGeometry(0.04, 0.05, SB_PZ1 - SB_PZ0); r.translate(gx, y, SB_PZC); sbIron.push(r); }
  const lock = new THREE.BoxGeometry(0.06, 0.1, 0.07); lock.translate(gx + 0.04, SB_YB + 1.0, SB_PZC); sbIron.push(lock);
}
// néons : applique à mi-volée (mur côté rue, sous la margelle), tube au-dessus du palier du bas
sbBox(sbTubes, SB_X1 - 0.06, SB_X1 - 0.02, SB_YG - 0.42, SB_YG - 0.37, sbNose(8) - 0.5, sbNose(8) + 0.5);
sbBox(sbRail, SB_X1 - 0.14, SB_X1, SB_YG - 0.37, SB_YG - 0.31, sbNose(8) - 0.55, sbNose(8) + 0.55);
sbBox(sbTubes, SB_X0 + 0.3, SB_X1 - 0.3, SB_YB + 2.35, SB_YB + 2.4, SB_Z0 + 0.02, SB_Z0 + 0.08);

// --- Margelle de granit sur trois côtés, garde-corps en fonte verte, neige
sbBox(sbGranite, SB_X0 - 0.42, SB_X0, -0.4, SB_YC, SB_Z0 - 0.42, SB_Z1);
sbBox(sbGranite, SB_X1, SB_X1 + 0.42, -0.4, SB_YC, SB_Z0 - 0.42, SB_Z1);
sbBox(sbGranite, SB_X0, SB_X1, -0.4, SB_YC, SB_Z0 - 0.42, SB_Z0);
snowPad(SB_X0 - 0.21, SB_YC, (SB_Z0 - 0.42 + SB_Z1) / 2, 0.4, SB_Z1 - SB_Z0 + 0.42, 0.1);
snowPad(SB_X1 + 0.21, SB_YC, (SB_Z0 - 0.42 + SB_Z1) / 2, 0.4, SB_Z1 - SB_Z0 + 0.42, 0.1);
snowPad(SB_XC, SB_YC, SB_Z0 - 0.21, 0.4, SB_WW + 0.84, 0.1, 0, 0.18, Math.PI / 2);
const SB_RAIL_H = 1.05, SB_RX0 = SB_X0 - 0.21, SB_RX1 = SB_X1 + 0.21, SB_RZ0 = SB_Z0 - 0.21;
/** Un côté du garde-corps de a à b (au niveau de la margelle) : lisses, barreaux, poteaux à boule, neige. */
function sbRailRun(a, b) {
  const top0 = sbV(a.x, SB_YC + SB_RAIL_H, a.z), top1 = sbV(b.x, SB_YC + SB_RAIL_H, b.z);
  bsStrut(sbRail, top0, top1, 0.05); bsStrut(sbRail, sbV(a.x, SB_YC + 0.12, a.z), sbV(b.x, SB_YC + 0.12, b.z), 0.035);
  bsSnowStrip(sbV(a.x, SB_YC + SB_RAIL_H + 0.025, a.z), sbV(b.x, SB_YC + SB_RAIL_H + 0.025, b.z), 0.06, 0.04);
  const L = a.distanceTo(b);
  for (let t = 0.12; t < L - 0.05; t += 0.12) { const p = a.clone().lerp(b, t / L), g = new THREE.CylinderGeometry(0.012, 0.012, SB_RAIL_H - 0.12, 5); g.translate(p.x, SB_YC + 0.12 + (SB_RAIL_H - 0.12) / 2, p.z); sbRail.push(g); }
  for (let t = 0; t <= L + 0.01; t += L / Math.max(1, Math.round(L / 1.1))) {
    const p = a.clone().lerp(b, Math.min(1, t / L)), g = new THREE.BoxGeometry(0.07, SB_RAIL_H + 0.05, 0.07); g.translate(p.x, SB_YC + (SB_RAIL_H + 0.05) / 2, p.z); sbRail.push(g);
    const f = new THREE.SphereGeometry(0.05, 8, 6); f.translate(p.x, SB_YC + SB_RAIL_H + 0.09, p.z); sbRail.push(f);
  }
}
sbRailRun(sbV(SB_RX0, 0, SB_Z1), sbV(SB_RX0, 0, SB_RZ0)); sbRailRun(sbV(SB_RX0, 0, SB_RZ0), sbV(SB_RX1, 0, SB_RZ0)); sbRailRun(sbV(SB_RX1, 0, SB_RZ0), sbV(SB_RX1, 0, SB_Z1));
// --- Les deux poteaux à globe vert à l'entrée, le panneau de la station entre eux
for (const px of [SB_RX0, SB_RX1]) {
  const base = new THREE.CylinderGeometry(0.14, 0.17, 0.35, 12); base.translate(px, SB_YC + 0.17, SB_Z1); sbRail.push(base);
  const post = new THREE.CylinderGeometry(0.06, 0.08, 2.3, 12); post.translate(px, SB_YC + 0.35 + 1.15, SB_Z1); sbRail.push(post);
  const ring = new THREE.TorusGeometry(0.1, 0.025, 6, 16); ring.rotateX(Math.PI / 2); ring.translate(px, SB_YC + 2.64, SB_Z1); sbRail.push(ring);
  const gl = new THREE.SphereGeometry(0.2, 18, 14); gl.translate(px, SB_YC + 2.85, SB_Z1); sbGlobes.push(gl);
  const cap = new THREE.ConeGeometry(0.1, 0.14, 10); cap.translate(px, SB_YC + 3.1, SB_Z1); sbRail.push(cap);
  snowPad(px, SB_YC + 3.02, SB_Z1, 0.22, 0.22, 0.07);
  addPointSource({ pos: LEFT.toWorld(sbV(px, SB_YC + 2.85, SB_Z1 + 0.3)), color: new THREE.Color(0x7dffa8), intensity: 2.6, distance: 6.5 });
}
{
  const mat = new THREE.MeshBasicMaterial({ map: makeSubwaySignTexture('Rivington St', [['F', '#ff6319'], ['M', '#ff6319']]), color: new THREE.Color().setScalar(0.6) });
  for (const e of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.38), mat);
    p.rotation.y = e > 0 ? 0 : Math.PI; p.position.set(SB_XC, SB_YC + 2.22, SB_Z1 + e * 0.022); LEFT.add(p);
  }
  sbBox(sbRail, SB_RX0, SB_RX1, SB_YC + 2.02, SB_YC + 2.04, SB_Z1 - 0.03, SB_Z1 + 0.03);
  sbBox(sbRail, SB_RX0, SB_RX1, SB_YC + 2.41, SB_YC + 2.44, SB_Z1 - 0.03, SB_Z1 + 0.03);
  snowPad(SB_XC, SB_YC + 2.44, SB_Z1, 0.06, SB_WW + 0.4, 0.04, 0, 0.18, Math.PI / 2);
}

LEFT.add(shadowed(new THREE.Mesh(mergeGeometries(sbConc), MAT.concrete)));
LEFT.add(shadowed(new THREE.Mesh(mergeGeometries(sbTiles), sbTileMat), false, true));
LEFT.add(shadowed(new THREE.Mesh(mergeGeometries(sbGranite), MAT.granite)));
LEFT.add(shadowed(new THREE.Mesh(mergeGeometries(sbRail.map(g => g.index ? g.toNonIndexed() : g)), sbRailMat)));
LEFT.add(new THREE.Mesh(mergeGeometries(sbNosing), sbNosingMat));
LEFT.add(shadowed(new THREE.Mesh(mergeGeometries(sbIron), MAT.iron)));
LEFT.add(new THREE.Mesh(mergeGeometries(sbGlobes), sbGlobeMat));
LEFT.add(new THREE.Mesh(mergeGeometries(sbTubes), sbTubeMat));
flushSnowPads(0);                                       // (endStreet ne fusionne rien s'il n'y a ni fenêtres ni pierre)
endStreet();

// --- Lumières : néons froids du bas, applique à mi-volée, couloir ; vapeur tiède qui remonte de l'escalier
addPointSource({ pos: LEFT.toWorld(sbV(SB_XC, SB_YB + 2.0, SB_Z0 + 0.6)), color: new THREE.Color(0xdfe9ff), intensity: 4, distance: 8 });
addPointSource({ pos: LEFT.toWorld(sbV(SB_X1 - 0.3, SB_YG - 0.5, sbNose(8))), color: new THREE.Color(0xe2ecff), intensity: 3, distance: 6 });
addPointSource({ pos: LEFT.toWorld(sbV(SB_X0 - 1.7, SB_YB + 1.9, SB_PZC)), color: new THREE.Color(0xe6efff), intensity: 1.6, distance: 4.5 });
{ const p = LEFT.toWorld(sbV(SB_XC, SB_YB + 0.3, SB_Z0 + 0.7)); buildPlume(p.x, p.y, p.z, new THREE.Color(0.6, 0.64, 0.68), { n: 70, spread: 0.5, height: 5.5, size: 1.2, opacity: 0.3 }); }

// --- Collisions (margelles = murs de la trémie) et surface praticable (marches)
LEFT.collider(SB_X0 - 0.21, (SB_Z0 - 0.42 + SB_Z1) / 2, 0.21, (SB_Z1 - SB_Z0 + 0.42) / 2);
LEFT.collider(SB_X1 + 0.21, (SB_Z0 - 0.42 + SB_Z1) / 2, 0.21, (SB_Z1 - SB_Z0 + 0.42) / 2);
LEFT.collider(SB_XC, SB_Z0 - 0.21, SB_WW / 2 + 0.42, 0.21);
{
  const a = LEFT.toWorld(sbV(SB_X0, 0, SB_Z0)), b = LEFT.toWorld(sbV(SB_X1, 0, SB_Z1 + 0.45));
  addWalkZone({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), stairs: true, y: (x, z) => {
    const lz = LEFT.lz(x, z);
    if (lz >= sbNose(0)) return SB_YG + 0.06;
    const k = Math.min(SB_N, Math.floor((sbNose(0) - lz) / SB_RUN) + 1);
    return sbLevel(k) + (k <= 6 ? 0.07 * (1 - (k - 1) / 6.5) : 0);
  } });
}
LEFT.doorZones.push({ side: -1, z0: SB_Z0 - 0.5, z1: SB_Z1 + 1.0 });       // rien de posé au pied (props.js)
addSubject({ label: 'Une bouche de métro sous la neige', value: 0.9, glows: true, box: LEFT.box(boxAt(SB_XC, (SB_Z0 + SB_Z1) / 2, SB_WW / 2 + 0.45, (SB_Z1 - SB_Z0) / 2 + 0.3, 0, SB_YC + 3.1)),
  moment: () => ({ pts: 2, why: 'globes verts allumés' }) });
