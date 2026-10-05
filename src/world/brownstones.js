import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACADE_X, SIDEWALK_H, AREA_W, RIGHT_END_X, PARK_GATE_W } from '../core/constants.js';
import { rnd, smoothNoise } from '../core/noise.js';
import { brownstone, stone } from '../textures/index.js';
import { makeTransomTexture } from '../textures/door.js';
import { usePhoto } from '../textures/photo.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { weather } from './weathering.js';
import { addSubject, boxAt } from '../game/subjects.js';
import { addPointSource } from './lightRegistry.js';
import { RIGHT, RIGHT_CHUNKS } from './street.js';
import { addWalkZone } from './walkSurface.js';
import { addPowderCornice } from './powderSources.js';
import { WIN_W, WIN_H, entranceMats, doorMaterial, stileUV, snowPad, flushSnowPads, buildEntrance, beginStreet, endStreet, flushChunk, paintMat, PHOTO_WHITE, frameInst, litInst, darkInst, shadeInst  , fenceGeoms, snowGeoms } from './buildings.js';

/* =====================================================================
   6 quinquies. BROWNSTONES (rue de droite)
   Les maisons en rangée de Brooklyn : 6 à 7 m de large, un rez-de-jardin en grès refendu à
   moitié enterré, le « parlor floor » au sommet d'un grand PERRON de 9 marches, deux étages
   (parfois trois) en grès brun LISSE, des fenêtres hautes sous des frontons portés par des
   consoles, une corniche peinte à grandes consoles, et devant, derrière une grille en fonte sur
   un muret, la cour anglaise. La grille suit l'alignement des autres rues (±FACADE_X : le
   trottoir garde sa largeur), les maisons sont reculées de AREA_W.
   Construites par « terraces » : 2 à 5 maisons identiques bâties d'un seul jet (même largeur,
   hauteur, style, teinte), perrons appariés deux à deux de part et d'autre du mur mitoyen.
   Tout passe par les accumulateurs de buildings.js (fenêtres instanciées, fonte, neige) et par
   les mêmes matériaux de base (grès = même programme que la brique) : aucun shader en plus.
   ===================================================================== */
const BS_DEPTH = 13, BS_REC = 0.3;                       // profondeur des maisons, embrasure (mur épais)
const STOOP_N = 9, STOOP_RISE = 0.19, STOOP_TREAD = 0.285, STOOP_W = 1.8;
const STOOP_LAND = AREA_W - (STOOP_N - 1) * STOOP_TREAD; // palier devant la porte : 1,32 m
const PARLOR_Y = SIDEWALK_H + STOOP_N * STOOP_RISE;      // plancher du parlor floor : 1,89 m
const PARLOR_H = 4.1, UPPER_H = 3.35;
// teintes (linéaires) : chocolat, brun-rouge, brun sombre, grès plus jeune, grès peint taupe
const BS_TINTS = [[0.4, 0.22, 0.14], [0.46, 0.24, 0.15], [0.34, 0.2, 0.14], [0.5, 0.32, 0.22], [0.52, 0.47, 0.42]];
const BS_CORNICE = [0x3a2c24, 0x1f2124, 0x2c3a2e, 0x4a2a24, 0x8a847c, 0x9a8f80];
// styles des terraces, d'après les photos de l'utilisateur : porte cintrée sous fronton à grandes consoles
// et perron évasé à poteaux de fonte (Brooklyn Heights), frontons cintrés partout et perron à piliers de
// grès, porte droite classique, perron BAS à murs pleins (Renaissance Revival)
const BS_STYLES = [
  { hood: 'pediment', stoop: 'grand', door: 'arch' }, { hood: 'segment', stoop: 'pier', door: 'arch' },
  { hood: 'segment', stoop: 'iron', door: 'arch' }, { hood: 'flat', stoop: 'stone', door: 'flat' },
  { hood: 'pediment', stoop: 'iron', door: 'flat' }, { hood: 'flat', stoop: 'stone', door: 'flat', low: true },
];
export const BS_ROW_END = -RIGHT_END_X + (FACADE_X - PARK_GATE_W);   // les rangées s'arrêtent aux murets du parc
/** Maisons construites (repère de la rue de droite) : props.js meuble leurs cours. */
export const brownHouses = [];

// accumulateurs PAR TRONÇON (fusionnés avec ceux de buildings.js) : marches et murets de grille
// (dalles de grès, MAT.stone), corniches par couleur de peinture, globes des lanternes de perron
let bsStoopGeoms = [], bsCornice = new Map(), bsGlobes = [];
const bsGlobeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.55, 0.85) });
function bsFlush() {
  flushChunk();
  if (bsStoopGeoms.length) RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(bsStoopGeoms), MAT.stone)));
  for (const [color, list] of bsCornice) RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g)), paintMat(color, 0.6, 0.15))));
  if (bsGlobes.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsGlobes), bsGlobeMat));
  bsStoopGeoms = []; bsCornice = new Map(); bsGlobes = [];
  bsFlushDecor();
}

/** Pose une géométrie (déjà placée, repère de la rue) avec des UV tirés de sa POSITION, selon
 *  l'orientation de chaque face : le grès et ses joints se raccordent d'une pièce à l'autre. */
export function bsPlace(list, g, tile = 5.5) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (nx > 0.5) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else if (ny > 0.5) uv.setXY(i, p.getZ(i) / tile, p.getX(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
  list.push(g); return g;
}
export function bsBox(list, w, h, d, x, y, z, tile) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return bsPlace(list, g, tile); }
/** Barre de section s entre deux points. */
export function bsStrut(list, a, b, s) {
  const d = new THREE.Vector3().subVectors(b, a), g = new THREE.BoxGeometry(s, d.length(), s);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); list.push(g); return g;
}
/** Bande de neige bombée (largeur w, épaisseur h) le long d'un segment quelconque : rampes en pente. */
export function bsSnowStrip(a, b, w, h) {
  const len = a.distanceTo(b), g = new THREE.PlaneGeometry(w, len, 4, Math.max(4, Math.round(len / 0.12)));
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = 2 * p.getX(i) / w, t = p.getZ(i), ends = Math.min(1, Math.max(0, (len / 2 - Math.abs(t)) / 0.08));
    p.setY(i, Math.pow(Math.max(0, 1 - u * u), 0.4) * Math.sqrt(ends) * h * (0.8 + 0.4 * smoothNoise(a.x * 3 + t * 3, a.z * 3)));
  }
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, side);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(side, up, dir).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  g.computeVertexNormals(); snowGeoms.push(g);
}
/** Mur dont le sommet est en pente (murs de perron) : de la profondeur dA (sommet yA) à dB (yB),
 *  pied à y0, épaisseur e centrée en zc. X(d) : profondeur → x de la rue. */
function bsSlopedWall(list, X, dA, yA, dB, yB, y0, zc, e) {
  const g = new THREE.BoxGeometry(1, 1, e), p = g.attributes.position, flip = X(dB) < X(dA);
  for (let i = 0; i < p.count; i++) {
    const t = flip ? 0.5 - p.getX(i) : p.getX(i) + 0.5;            // x monde croissant : pas de miroir
    p.setXYZ(i, X(dA + (dB - dA) * t), p.getY(i) > 0 ? yA + (yB - yA) * t : y0, zc + p.getZ(i));
  }
  g.computeVertexNormals(); return bsPlace(list, g);
}
/** Façade « pleine moins les ouvertures » : la couche avant (épaisseur BS_REC, centrée en x) entre
 *  zA–zB et yA–yB, découpée en tranches horizontales autour des trous {z0, z1, y0, y1}. */
function bsFrontLayer(list, x, zA, zB, yA, yB, holes, tile) {
  const ys = [yA, yB];
  for (const h of holes) for (const v of [h.y0, h.y1]) if (v > yA && v < yB) ys.push(v);
  ys.sort((a, b) => a - b);
  for (let k = 0; k < ys.length - 1; k++) {
    const y0 = ys[k], y1 = ys[k + 1]; if (y1 - y0 < 1e-3) continue;
    const gaps = holes.filter(h => h.y0 <= y0 + 1e-4 && h.y1 >= y1 - 1e-4).sort((a, b) => a.z0 - b.z0);
    let z = zA;
    for (const h of gaps) { if (h.z0 > z + 1e-3) bsBox(list, BS_REC, y1 - y0, h.z0 - z, x, (y0 + y1) / 2, (z + h.z0) / 2, tile); z = Math.max(z, h.z1); }
    if (zB > z + 1e-3) bsBox(list, BS_REC, y1 - y0, zB - z, x, (y0 + y1) / 2, (z + zB) / 2, tile);
  }
}
/** Fenêtre (cadre + vitre instanciés, mis à l'échelle de l'ouverture) au fond de l'embrasure. */
const bsQ = [new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))];
function bsWindow(side, xBack, y0, y1, z, w, pLit, pShade, basement = false) {
  const m = new THREE.Matrix4(), h = y1 - y0, wy = (y0 + y1) / 2, ox = -side;
  m.compose(new THREE.Vector3(xBack + ox * 0.06, wy, z), new THREE.Quaternion(), new THREE.Vector3(1, h / WIN_H, w / WIN_W)); frameInst.push(m.clone());
  m.compose(new THREE.Vector3(xBack + ox * 0.02, wy, z), bsQ[side < 0 ? 0 : 1], new THREE.Vector3(w / WIN_W, h / WIN_H, 1));
  const r = Math.random();
  if (r < pLit) { const lm = m.clone(); lm.noSilhouette = basement; litInst[Math.floor(Math.random() * 3)].push(lm); }   // pas de passant au sous-sol
  else if (r < pLit + pShade) shadeInst[Math.floor(Math.random() * 3)].push(m.clone());
  else darkInst.push(m.clone());
}
// Console de corniche à volute (profil extrudé, partagé) : x = profondeur vers la rue, y = hauteur
const bsBracketGeo = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.quadraticCurveTo(0.15, -0.02, 0.14, 0.13);
  sh.quadraticCurveTo(0.12, 0.32, 0.32, 0.47); sh.quadraticCurveTo(0.52, 0.6, 0.6, 0.72);
  sh.lineTo(0.6, 0.8); sh.lineTo(0, 0.8); sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false, curveSegments: 5 }); g.translate(0, 0, -0.08);
  return g;
})();

/** Géométrie d'un perron : n contremarches, pied à la profondeur `front`, palier jusqu'à la façade. */
function stoopGeom(sty) {
  const n = sty.low ? 6 : STOOP_N, yP = SIDEWALK_H + n * STOOP_RISE;
  const land = sty.low ? 1.3 : STOOP_LAND, front = land + (n - 1) * STOOP_TREAD;
  return { n, yP, land, front, nose: d => SIDEWALK_H + STOOP_RISE * (1 + (front - d) / STOOP_TREAD) };
}

/** Perron (repère de la rue) : marches de grès, palier, garde-corps, neige. Variantes (style de la
 *  terrace, d'après les photos de l'utilisateur) :
 *   - 'iron'  : rampes en fonte, poteau rond à boule ;
 *   - 'grand' : marches du bas ÉVASÉES (arrondies), grands poteaux de fonte ouvragés sur un socle ;
 *   - 'pier'  : murets de grès bas surmontés d'une rampe en fonte, gros piliers carrés au pied ;
 *   - 'stone' : murs de perron pleins, chaperon, dé au pied (aussi pour les perrons BAS).
 *  pairDir (±1) : côté du perron jumeau (le long de la rue) — les marches ne s'évasent pas de ce côté,
 *  sinon les deux bases se chevaucheraient. Renvoie les lignes de main courante (décorations de fêtes). */
function bsStoop(side, fx, zd, sty, face, pairDir = 0) {
  const ox = -side, X = d => fx + ox * d, V = (d, y, z) => new THREE.Vector3(X(d), y, z);
  const G = stoopGeom(sty), { n, yP, land, front, nose } = G;
  const shoveled = Math.random() < 0.35;                         // certains ont déjà déblayé leur perron
  const flare = sty.stoop === 'grand' || sty.stoop === 'pier' ? [0.34, 0.22, 0.1] : [];
  for (let i = 0; i < n; i++) {
    const dF = front - i * STOOP_TREAD, dB = i === n - 1 ? 0 : dF - STOOP_TREAD, top = SIDEWALK_H + (i + 1) * STOOP_RISE;
    const ext = e => (pairDir === e ? 0 : flare[i] ?? 0), wx = STOOP_W + ext(-1) + ext(1), zm = zd + (ext(1) - ext(-1)) / 2;
    bsBox(bsStoopGeoms, dF - dB, top + 0.1, wx, X((dF + dB) / 2), (top - 0.1) / 2, zm, 2.15);
    bsBox(bsStoopGeoms, 0.05, 0.05, wx + 0.02, X(dF + 0.02), top - 0.03, zm, 2.15);              // nez de marche
    for (const e of [-1, 1]) if (ext(e)) {                                                         // bouts arrondis des marches évasées
      const c = new THREE.CylinderGeometry((dF - dB) / 2, (dF - dB) / 2, top + 0.1, 12); c.translate(X((dF + dB) / 2), (top - 0.1) / 2, zd + e * (STOOP_W / 2 + ext(e))); bsPlace(bsStoopGeoms, c, 2.15);
    }
    const dc = (dF + dB) / 2, dw = dF - dB - 0.03;
    if (shoveled) {                                               // passage déblayé au milieu, neige aux bords
      for (const e of [-1, 1]) snowPad(X(dc), top, zm + e * (wx / 2 - 0.23), dw, 0.4, 0.12);
      snowPad(X(dc), top, zd, dw, 0.9, 0.025);
    } else snowPad(X(dc), top, zm, dw, wx - 0.12, 0.13);
  }
  // perron bas : une allée dégagée relie la grille au pied des marches
  if (front < AREA_W - 0.2) snowPad(X((front + AREA_W) / 2), SIDEWALK_H + 0.06, zd, AREA_W - front, STOOP_W - 0.3, 0.05);
  const rails = [];
  for (const e of [-1, 1]) {
    const zs = zd + e * (STOOP_W / 2 - 0.06), dFoot = front - 0.12;
    if (sty.stoop === 'iron' || sty.stoop === 'grand' || sty.stoop === 'pier') {
      const wall = sty.stoop === 'pier' ? 0.42 : 0;              // muret de grès sous la rampe
      if (wall) {
        bsSlopedWall(face, X, dFoot - 0.25, nose(dFoot - 0.25) + wall, land, yP + wall, SIDEWALK_H - 0.1, zs, 0.26);
        bsBox(face, land - 0.05, yP + wall + 0.1, 0.26, X(land / 2 + 0.05), (yP + wall - 0.1) / 2, zs);
        const cA = V(dFoot - 0.25, nose(dFoot - 0.25) + wall + 0.04, zs), cB = V(land, yP + wall + 0.04, zs), cC = V(0.05, yP + wall + 0.04, zs);
        bsStrut(face, cA, cB, 0.32); bsStrut(face, cB, cC, 0.32);
      }
      // rampe en fonte : main courante parallèle aux marches, barreaux
      const a = V(dFoot - (wall ? 0.3 : 0), nose(dFoot - (wall ? 0.3 : 0)) + 0.92, zs), b = V(land, yP + 0.92, zs), c = V(0.12, yP + 0.92, zs);
      bsStrut(fenceGeoms, a, b, 0.05); bsStrut(fenceGeoms, b, c, 0.05);
      for (let d = dFoot - 0.13; d > 0.15; d -= 0.13) {
        const y0 = (d > land ? nose(d) : yP) + wall, y1 = (d > land ? nose(d) : yP) + 0.92;
        if (y1 - y0 < 0.1) continue;
        const g = new THREE.CylinderGeometry(0.012, 0.012, y1 - y0, 5); g.translate(X(d), (y0 + y1) / 2, zs); fenceGeoms.push(g);
      }
      const p2 = new THREE.BoxGeometry(0.07, 0.95, 0.07); p2.translate(X(land), yP + 0.47, zs); fenceGeoms.push(p2);
      bsSnowStrip(a.clone().setY(a.y + 0.025), b.clone().setY(b.y + 0.025), 0.07, 0.045);
      bsSnowStrip(b.clone().setY(b.y + 0.025), c.clone().setY(c.y + 0.025), 0.07, 0.045);
      rails.push([a, b], [b, c]);
      const zp = zs + e * (flare.length && pairDir !== e ? 0.28 : 0);              // pied du garde-corps (au-delà de la volée sur les marches évasées)
      if (sty.stoop === 'iron') {
        const post = new THREE.CylinderGeometry(0.07, 0.11, 1.25, 8); post.translate(X(dFoot), SIDEWALK_H + 0.62, zs); fenceGeoms.push(post);
        const urn = new THREE.SphereGeometry(0.1, 10, 8); urn.translate(X(dFoot), SIDEWALK_H + 1.33, zs); fenceGeoms.push(urn);
        snowPad(X(dFoot), SIDEWALK_H + 1.4, zs, 0.16, 0.16, 0.08);
      } else if (sty.stoop === 'grand') {
        // grand poteau de fonte ouvragé sur socle de grès, couronne en pointe
        bsBox(bsStoopGeoms, 0.48, 0.42, 0.48, X(dFoot + 0.02), SIDEWALK_H + 0.11, zp, 2.15);
        snowPad(X(dFoot + 0.02), SIDEWALK_H + 0.32, zp, 0.48, 0.48, 0.1);
        const post = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.13, 0.08], [0.09, 0.14], [0.09, 0.9], [0.12, 0.98], [0.12, 1.06], [0.07, 1.12], [0.1, 1.2], [0.06, 1.3], [0.02, 1.42], [0, 1.45]].map(p => new THREE.Vector2(p[0], p[1])), 8);
        post.translate(X(dFoot + 0.02), SIDEWALK_H + 0.32, zp); fenceGeoms.push(post);
        // la rampe descend en volute jusqu'au poteau
        bsStrut(fenceGeoms, V(dFoot, SIDEWALK_H + 1.24, zp), a, 0.045);
        snowPad(X(dFoot + 0.02), SIDEWALK_H + 1.4, zp, 0.2, 0.2, 0.06);
      } else {
        // gros pilier carré en grès au pied, chapeau mouluré
        bsBox(face, 0.56, 1.2, 0.56, X(dFoot + 0.04), SIDEWALK_H + 0.5, zp);
        bsBox(face, 0.66, 0.12, 0.66, X(dFoot + 0.04), SIDEWALK_H + 1.14, zp);
        bsBox(face, 0.42, 0.14, 0.42, X(dFoot + 0.04), SIDEWALK_H + 1.27, zp);
        snowPad(X(dFoot + 0.04), SIDEWALK_H + 1.34, zp, 0.44, 0.44, 0.14);
        snowPad(X(dFoot + 0.04), SIDEWALK_H + 1.2, zp, 0.64, 0.64, 0.06);
      }
    } else {
      // murs de perron en grès, chaperon mouluré, gros dé au pied
      const dW = dFoot - 0.23;
      bsSlopedWall(face, X, dW, nose(dW) + 0.75, land, yP + 0.75, SIDEWALK_H - 0.1, zs, 0.24);
      bsBox(face, land - 0.05, yP + 0.85, 0.24, X(land / 2 + 0.05), (yP + 0.65) / 2, zs);
      const capA = V(dW, nose(dW) + 0.8, zs), capB = V(land, yP + 0.8, zs), capC = V(0.05, yP + 0.8, zs);
      bsStrut(face, capA, capB, 0.3); bsStrut(face, capB, capC, 0.3);
      bsBox(face, 0.5, 1.2, 0.42, X(dFoot - 0.15), SIDEWALK_H + 0.5, zs + e * 0.05);              // dé au pied
      bsBox(face, 0.58, 0.1, 0.5, X(dFoot - 0.15), SIDEWALK_H + 1.15, zs + e * 0.05);
      bsSnowStrip(capA.clone().setY(capA.y + 0.15), capB.clone().setY(capB.y + 0.15), 0.28, 0.1);
      bsSnowStrip(capB.clone().setY(capB.y + 0.15), capC.clone().setY(capC.y + 0.15), 0.28, 0.1);
      snowPad(X(dFoot - 0.15), SIDEWALK_H + 1.2, zs + e * 0.05, 0.56, 0.48, 0.15);
      rails.push([capA.clone().setY(capA.y + 0.1), capB.clone().setY(capB.y + 0.1)], [capB.clone().setY(capB.y + 0.1), capC.clone().setY(capC.y + 0.1)]);
    }
  }
  // lanterne sur le poteau du pied (rampes en fonte simples, une fois sur trois)
  if (sty.stoop === 'iron' && Math.random() < 0.35) {
    const zs = zd + (Math.random() < 0.5 ? -1 : 1) * (STOOP_W / 2 - 0.06), y = SIDEWALK_H + 1.62;
    const gl = new THREE.SphereGeometry(0.15, 12, 10); gl.translate(X(front - 0.12), y, zs); bsGlobes.push(gl);
    addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(X(front - 0.3), y, zs)), color: new THREE.Color(0xffc27a), intensity: 4, distance: 6 });
  }
  // urnes en fonte de part et d'autre de la porte, sur le palier (grands perrons)
  if (sty.stoop === 'grand' || sty.stoop === 'pier') for (const e of [-1, 1]) {
    const u = new THREE.LatheGeometry([[0, 0], [0.12, 0], [0.12, 0.05], [0.06, 0.1], [0.06, 0.2], [0.2, 0.32], [0.24, 0.5], [0.26, 0.55], [0, 0.55]].map(p => new THREE.Vector2(p[0], p[1])), 10);
    u.translate(X(0.6), yP, zd + e * (STOOP_W / 2 - 0.3)); fenceGeoms.push(u);
    snowPad(X(0.6), yP + 0.55, zd + e * (STOOP_W / 2 - 0.3), 0.46, 0.46, 0.16);
  }
  RIGHT.doorZones.push({ side, z0: zd - STOOP_W / 2 - 0.5, z1: zd + STOOP_W / 2 + 0.5 });
  // On monte sur le perron (demande utilisateur) : surface praticable marche par marche, neige comprise
  // (un perron déblayé n'en garde qu'une pellicule au milieu)
  {
    const snow = shoveled ? 0.03 : 0.12, hw = STOOP_W / 2 - 0.05;
    const a = RIGHT.toWorld(V(0, 0, zd - hw)), b = RIGHT.toWorld(V(AREA_W + 0.02, 0, zd + hw));
    addWalkZone({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), stairs: true, y: (x, z) => {
      const d = (RIGHT.lx(x, z) - fx) * ox;
      if (d < 0 || d > AREA_W + 0.02) return null;
      if (d > front) return SIDEWALK_H + 0.1;                          // allée d'un perron bas
      return SIDEWALK_H + (Math.min(n - 1, Math.floor((front - d) / STOOP_TREAD)) + 1) * STOOP_RISE + snow;
    } });
  }
  addSubject({ label: 'Un perron de brownstone sous la neige', value: 0.7, box: RIGHT.box(boxAt(X(AREA_W / 2), zd, AREA_W / 2 + 0.1, STOOP_W / 2 + 0.25, SIDEWALK_H, yP + 3.4)) });
  return rails;
}

/** Porte en PLEIN CINTRE (photos de l'utilisateur) : baie cintrée creusée dans un encadrement de
 *  grès (plaque percée, extrudée : l'intrados de l'arc se voit), double porte vernie ou noire vitrée
 *  au fond, imposte en demi-cercle allumée au numéro doré, pilastres, entablement et fronton
 *  (cintré ou droit) sur deux grandes consoles à volute, deux lanternes de part et d'autre. */
function bsArchedDoor(side, fx, zd, yDoor, face, sty) {
  const ox = -side, X = d => fx + ox * d, rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const DW = 1.3, DH = 2.35, R = DW / 2, SW = DW + 0.9, SH = DH + R + 0.55;
  const { hallGlassMat, brassMat } = entranceMats();
  // encadrement percé de la baie (épaisseur de l'embrasure + 12 cm de saillie)
  const sh = new THREE.Shape(); sh.moveTo(-SW / 2, 0); sh.lineTo(SW / 2, 0); sh.lineTo(SW / 2, SH); sh.lineTo(-SW / 2, SH); sh.lineTo(-SW / 2, 0);
  const hole = new THREE.Path(); hole.moveTo(-R, 0); hole.lineTo(-R, DH + 0.06); hole.absarc(0, DH + 0.06, R, Math.PI, 0, true); hole.lineTo(R, 0); hole.lineTo(-R, 0);
  sh.holes.push(hole);
  const sg = new THREE.ExtrudeGeometry(sh, { depth: BS_REC + 0.12, bevelEnabled: false, curveSegments: 16 });
  sg.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2); sg.translate(X(-BS_REC), yDoor, zd); bsPlace(face, sg);
  for (const e of [-1, 1]) bsBox(face, 0.1, SH, 0.26, X(0.17), yDoor + SH / 2, zd + e * (SW / 2 - 0.13));       // pilastres
  // entablement, corniche, fronton ; grandes consoles à volute
  bsBox(face, 0.2, 0.32, SW + 0.3, X(0.1), yDoor + SH + 0.16, zd);
  bsBox(face, 0.52, 0.16, SW + 0.8, X(0.26), yDoor + SH + 0.4, zd);
  for (const e of [-1, 1]) { const g = bsBracketGeo.clone(); g.scale(0.8, 1.15, 1.2); if (ox < 0) g.rotateY(Math.PI); g.translate(X(0.12), yDoor + SH - 0.6, zd + e * (SW / 2 + 0.12)); bsPlace(face, g); }
  const half = (SW + 0.8) / 2, yb = yDoor + SH + 0.48, pts = [];
  for (let k = 0; k <= 8; k++) { const t = -1 + k / 4; pts.push(new THREE.Vector3(X(0.24), sty.hood === 'pediment' ? yb + (1 - Math.abs(t)) * half * 0.36 : yb + Math.sqrt(Math.max(0, 1 - t * t * 0.9)) * 0.5, zd + t * half)); }
  for (let k = 0; k < 8; k++) { const seg = []; bsStrut(seg, pts[k], pts[k + 1], 0.16); bsPlace(face, seg[0]); bsSnowStrip(pts[k].clone().setY(pts[k].y + 0.08), pts[k + 1].clone().setY(pts[k + 1].y + 0.08), 0.42, 0.09); }
  snowPad(X(0.26), yDoor + SH + 0.48, zd, 0.52, SW + 0.76, 0.12);
  // double porte au fond de l'embrasure, vitrée en haut (hall éclairé), grille en fer forgé une fois sur deux
  const door = [], lit = [], brass = [], xd = X(-BS_REC + 0.03), grille = Math.random() < 0.5;
  for (const e of [-1, 1]) {
    const zc = zd + e * DW / 4, lw = DW / 2 - 0.02, leaf = new THREE.BoxGeometry(0.06, DH, lw);
    if (side * e > 0) { const uv = leaf.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    leaf.translate(xd, yDoor + DH / 2, zc); door.push(leaf);
    const gl = new THREE.PlaneGeometry(lw - 0.18, 1.25); gl.rotateY(rotY); gl.translate(X(-BS_REC + 0.065), yDoor + 1.5, zc); lit.push(gl);
    if (grille) {
      for (let k = 1; k < 5; k++) { const g = new THREE.BoxGeometry(0.014, 1.22, 0.014); g.translate(X(-BS_REC + 0.09), yDoor + 1.5, zc - (lw - 0.18) / 2 + k * (lw - 0.18) / 5); fenceGeoms.push(g); }
      const ring = new THREE.TorusGeometry(0.09, 0.01, 6, 18); ring.rotateY(Math.PI / 2); ring.translate(X(-BS_REC + 0.09), yDoor + 1.5, zc); fenceGeoms.push(ring);
    }
    const knob = new THREE.SphereGeometry(0.03, 10, 8); knob.translate(X(-BS_REC + 0.11), yDoor + 1.05, zd + e * 0.1); brass.push(knob);
  }
  const bar = new THREE.BoxGeometry(0.08, 0.08, DW); bar.translate(X(-BS_REC + 0.04), yDoor + DH + 0.03, zd); stileUV(bar); door.push(bar);
  const mid = new THREE.BoxGeometry(0.08, DH, 0.045); mid.translate(X(-BS_REC + 0.07), yDoor + DH / 2, zd); stileUV(mid); door.push(mid);
  RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(door), doorMaterial())));
  RIGHT.add(new THREE.Mesh(mergeGeometries(lit), hallGlassMat));
  RIGHT.add(new THREE.Mesh(mergeGeometries(brass), brassMat));
  // imposte en demi-cercle, numéro doré
  const num = 2 * Math.floor(rnd(20, 160)) + (side > 0 ? 1 : 0);
  // UV du demi-disque recalées sur toute la texture (sinon seule sa moitié haute s'affichait : chiffres
  // coupés), proportions du canvas (512 × 196) gardées : le numéro tient dans le bas, là où l'arc est large
  const trGeo = new THREE.CircleGeometry(R - 0.03, 24, 0, Math.PI), trP = trGeo.attributes.position, trUV = trGeo.attributes.uv;
  for (let i = 0; i < trP.count; i++) trUV.setXY(i, 0.5 + trP.getX(i) / (R - 0.03) * 0.385, 0.02 + trP.getY(i) / (R - 0.03) * 0.98);
  const tr = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({ map: makeTransomTexture(num), color: hallGlassMat.color }));
  tr.rotation.y = rotY; tr.position.set(X(-BS_REC + 0.02), yDoor + DH + 0.06, zd); RIGHT.add(tr);
  // deux lanternes murales (globes) de part et d'autre de l'encadrement
  for (const e of [-1, 1]) {
    const zl = zd + e * (SW / 2 + 0.32), yl = yDoor + 2.05;
    const arm = new THREE.BoxGeometry(0.22, 0.03, 0.03); arm.translate(X(0.11), yl + 0.18, zl); fenceGeoms.push(arm);
    const gl = new THREE.SphereGeometry(0.11, 12, 10); gl.translate(X(0.22), yl, zl); bsGlobes.push(gl);
    const cap = new THREE.ConeGeometry(0.1, 0.08, 8); cap.translate(X(0.22), yl + 0.14, zl); fenceGeoms.push(cap);
  }
  addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(X(0.9), yDoor + 2.0, zd)), color: new THREE.Color(0xffc27a), intensity: 6, distance: 7 });
  addSubject({ label: `Une porte cintrée de brownstone, n° ${num}`, value: 0.65, glows: true, box: RIGHT.box(boxAt(X(0.25), zd, 0.3, SW / 2 + 0.5, yDoor - 0.1, yDoor + SH + 0.8)) });
  return { SW, SH, yWreath: yDoor + 1.55, xWreath: X(-BS_REC + 0.1), arch: true, half: R + 0.2, spring: yDoor + DH + 0.06 };
}

/* Décorations de fêtes (photos de l'utilisateur) : chaque maison décorée tire SON assortiment, pour
   qu'aucune ne ressemble à sa voisine — couleur des ampoules (blanc chaud, blanc froid, multicolore,
   rouge et or), rampes (guirlande de sapin avec ou sans boules, ou ampoules seules enroulées),
   grille (festons, boules, ampoules ou rien), porte (couronne lumineuse, couronne à gros nœud et
   baies rouges, guirlande qui encadre la porte, ou deux petits sapins illuminés en pots), fenêtres
   (bougies électriques, guirlandes drapées, contour d'ampoules, couronnes à nœud, ou rien), parfois
   un sapin illuminé dans la cour et un rideau de stalactites lumineuses sous le bandeau.
   Ampoules = petites sphères très lumineuses (le bloom les fait briller) ; tout est fusionné par
   matériau et par tronçon, matériaux sans texture : aucun shader en plus. */
const bsGarlandMat = new THREE.MeshStandardMaterial({ color: 0x1b3220, roughness: 0.85 });
const BS_BULB = { warm: [4.6, 3.3, 1.7], cool: [3.0, 3.5, 4.8], red: [4.6, 0.45, 0.35], green: [0.6, 3.9, 1.0], blue: [0.8, 1.4, 5.0], amber: [4.8, 2.5, 0.5], gold: [4.4, 3.4, 0.9] };
const BS_PALETTES = { blancChaud: ['warm'], blancFroid: ['cool'], multicolore: ['red', 'green', 'blue', 'amber'], rougeOr: ['red', 'gold'] };
const BS_BALLS = [0x8e0f12, 0xb8892e, 0xaeb3ba, 0x1d5a2a, 0x2a3f8a];
const bsBulbMats = new Map(Object.entries(BS_BULB).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: new THREE.Color(...c) })]));
let bsGarland = [], bsBulbs = new Map(), bsBalls = new Map(), bsBows = [], bsCandles = [];
function bsFlushDecor() {
  if (bsGarland.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsGarland), bsGarlandMat));
  for (const [k, l] of bsBulbs) RIGHT.add(new THREE.Mesh(mergeGeometries(l), bsBulbMats.get(k)));
  for (const [c, l] of bsBalls) RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(l), paintMat(c, 0.22, 0.65)), false, true));
  if (bsBows.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsBows), paintMat(0x9a0d0d, 0.55, 0.05)));
  if (bsCandles.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsCandles), paintMat(0xe6e1d6, 0.6, 0)));
  for (const [c, l] of bsPlanters) RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(l), paintMat(c, 0.6, 0.2)), true, true));
  bsGarland = []; bsBulbs = new Map(); bsBalls = new Map(); bsBows = []; bsCandles = []; bsPlanters = new Map();
}
const bsPick = list => list[Math.floor(Math.random() * list.length)];
function bsBulb(p, col, r = 0.032) {
  if (!bsBulbs.has(col)) bsBulbs.set(col, []);
  const g = new THREE.SphereGeometry(r, 5, 4); g.translate(p.x, p.y, p.z); bsBulbs.get(col).push(g);
}
function bsBall(p, color, r = 0.055) {
  if (!bsBalls.has(color)) bsBalls.set(color, []);
  const g = new THREE.SphereGeometry(r, 8, 6); g.translate(p.x, p.y, p.z); bsBalls.get(color).push(g);
}
/** Ampoules le long d'une courbe, couleurs de la palette en alternance, enroulées à `wrap` m de l'axe. */
function bsBulbsAlong(curve, len, pal, step = 0.065, wrap = 0.065) {
  const nb = Math.max(3, Math.round(len / step));
  for (let k = 0; k <= nb; k++) {
    const p = curve.getPoint(k / nb), t = k * 2.4;
    bsBulb(new THREE.Vector3(p.x + Math.cos(t) * wrap, p.y + Math.sin(t) * wrap, p.z + Math.sin(t * 0.7) * wrap), pal[k % pal.length]);
  }
}
/** Guirlande de sapin entre a et b (tombante de `sag`) ; ampoules et boules selon le kit. */
function bsGarlandSeg(a, b, sag, kit, o = {}) {
  const m = a.clone().add(b).multiplyScalar(0.5); m.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, m, b), len = a.distanceTo(b);
  if (!o.bare) bsGarland.push(new THREE.TubeGeometry(curve, Math.max(4, Math.round(len / 0.12)), o.r ?? 0.08, 5, false));
  if (!o.noLights) bsBulbsAlong(curve, len, kit.pal, o.bare ? 0.05 : 0.065, o.bare ? 0.03 : 0.065);
  if (o.balls) { const nb = Math.max(1, Math.round(len / 0.32)); for (let k = 1; k < nb; k++) { const p = curve.getPoint(k / nb); bsBall(new THREE.Vector3(p.x, p.y - 0.12, p.z), kit.balls[k % kit.balls.length]); } }
}
/** Nœud rouge (deux boucles, deux pans) en p ; s : taille. */
function bsBow(p, s = 1) {
  for (const e of [-1, 1]) {
    const l = new THREE.SphereGeometry(0.075 * s, 8, 6); l.scale(0.5, 0.75, 1); l.translate(p.x, p.y + 0.02 * s, p.z + e * 0.07 * s); bsBows.push(l);
    const t = new THREE.BoxGeometry(0.03 * s, 0.2 * s, 0.045 * s); t.rotateX(e * 0.3); t.translate(p.x, p.y - 0.1 * s, p.z + e * 0.04 * s); bsBows.push(t);
  }
}
/** Couronne face à la rue : lumineuse (palette) ou classique (gros nœud, baies rouges). */
function bsWreath(side, x, y, z, r, kit, lit) {
  const g = new THREE.TorusGeometry(r, 0.085, 6, 18); g.rotateY(Math.PI / 2); g.translate(x, y, z); bsGarland.push(g);
  if (lit) for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; bsBulb(new THREE.Vector3(x - side * 0.06, y + Math.sin(a) * r, z + Math.cos(a) * r), kit.pal[k % kit.pal.length], 0.03); }
  else for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2 + 0.3; bsBall(new THREE.Vector3(x - side * 0.07, y + Math.sin(a) * r, z + Math.cos(a) * r), 0x8e0f12, 0.035); }   // baies
  bsBow(new THREE.Vector3(x - side * 0.08, y - r, z), lit ? 1 : 1.6);
}
/** Petit sapin illuminé (pot ou pleine terre) : étages de cônes, ampoules en spirale, étoile. */
function bsLitTree(x, y0, z, h, kit, pot) {
  if (pot) { const p = new THREE.CylinderGeometry(0.2, 0.15, 0.3, 10); p.translate(x, y0 + 0.15, z); bsCandles.push(p); y0 += 0.3; }
  for (let t = 0; t < 3; t++) { const f = t / 3, ch = h * 0.5, c = new THREE.ConeGeometry(h * 0.36 * (1 - f * 0.55), ch, 10); c.translate(x, y0 + 0.1 + f * h * 0.6 + ch / 2, z); bsGarland.push(c); }
  const n = Math.round(h * 26);
  for (let k = 0; k < n; k++) { const f = k / n, a = k * 2.2, r = h * 0.34 * (1 - f) + 0.03; bsBulb(new THREE.Vector3(x + Math.cos(a) * r, y0 + 0.15 + f * h * 0.95, z + Math.sin(a) * r), kit.pal[k % kit.pal.length], 0.03); }
  bsBulb(new THREE.Vector3(x, y0 + h + 0.18, z), 'gold', 0.07);
  snowPad(x, y0 + h * 0.62, z, h * 0.3, h * 0.3, 0.06);
}

/** Habille une maison pour les fêtes, avec un assortiment tiré au hasard. h : { zd, yP, rails,
 *  fences, door, wins, za, zb, free }. */
function bsDecorate(side, X, h) {
  const palName = bsPick(Object.keys(BS_PALETTES));
  const kit = { pal: BS_PALETTES[palName], balls: [bsPick(BS_BALLS), bsPick(BS_BALLS), 0xb8892e],
    rail: bsPick(['sapin', 'sapin-boules', 'ampoules']), fence: bsPick(['festons', 'festons-boules', 'ampoules', 'rien']),
    door: bsPick(['couronne', 'couronne-noeud', 'encadrement', 'sapins']), wins: bsPick(['bougies', 'drapé', 'contour', 'couronnes', 'rien']) };
  // rampes du perron
  for (const [a, b] of h.rails) {
    const A = a.clone().setY(a.y - 0.04), B = b.clone().setY(b.y - 0.04);
    if (kit.rail === 'ampoules') bsGarlandSeg(A, B, 0, kit, { bare: true });
    else bsGarlandSeg(A, B, 0.05, kit, { balls: kit.rail === 'sapin-boules' });
  }
  if (kit.rail !== 'ampoules') h.rails.forEach(([a], i) => { if (i % 2 === 0) bsBow(a.clone().setY(a.y - 0.08)); });
  // grille de la cour
  const xf = side * (FACADE_X + 0.15), yf = SIDEWALK_H + 1.38;
  if (kit.fence !== 'rien') for (const [za, zb] of h.fences) {
    if (zb - za < 0.6) continue;
    const n = Math.max(1, Math.round((zb - za) / 1.2));
    for (let k = 0; k < n; k++) {
      const z0 = za + (zb - za) * k / n, z1 = za + (zb - za) * (k + 1) / n, A = new THREE.Vector3(xf, yf, z0 + 0.05), B = new THREE.Vector3(xf, yf, z1 - 0.05);
      if (kit.fence === 'ampoules') bsGarlandSeg(A, B, 0.02, kit, { bare: true });
      else { bsGarlandSeg(A, B, 0.16, kit, { balls: kit.fence === 'festons-boules' }); bsBow(new THREE.Vector3(xf - side * 0.05, yf + 0.02, z0 + 0.05)); }
    }
  }
  // porte
  const D = h.door;
  if (kit.door === 'couronne' || kit.door === 'couronne-noeud') bsWreath(side, D.xWreath, D.yWreath, h.zd, 0.3, kit, kit.door === 'couronne');
  else if (kit.door === 'encadrement') {
    // guirlande qui suit le pourtour de la porte (l'arc pour une porte cintrée), un nœud en haut
    const x = X(0.22), half = D.half, pts = [new THREE.Vector3(x, h.yP + 0.3, h.zd - half)];
    if (D.arch) for (let k = 0; k <= 8; k++) { const a = Math.PI - k * Math.PI / 8; pts.push(new THREE.Vector3(x, D.spring + Math.sin(a) * half, h.zd + Math.cos(a) * half)); }
    else pts.push(new THREE.Vector3(x, D.top, h.zd - half), new THREE.Vector3(x, D.top, h.zd + half));
    pts.push(new THREE.Vector3(x, h.yP + 0.3, h.zd + half));
    for (let k = 0; k < pts.length - 1; k++) bsGarlandSeg(pts[k], pts[k + 1], 0.02, kit, { balls: k % 2 === 0 });
    bsBow(new THREE.Vector3(x - side * 0.04, (D.arch ? D.spring + half : D.top) + 0.05, h.zd), 1.5);
  } else for (const e of [-1, 1]) bsLitTree(X(0.45), h.yP, h.zd + e * 0.78, 0.95, kit, true);
  // fenêtres : parlor floor, et pour les bougies tous les étages
  for (const w of h.wins) {
    const x = X(-BS_REC + 0.12);
    if (kit.wins === 'bougies') {
      const c = new THREE.CylinderGeometry(0.028, 0.03, 0.26, 8); c.translate(x, w.y0 + 0.13, w.z); bsCandles.push(c);
      bsBulb(new THREE.Vector3(x, w.y0 + 0.31, w.z), 'amber', 0.03);
    }
    if (!w.parlor) continue;
    if (kit.wins === 'couronnes') bsWreath(side, x, w.y0 + 1.45, w.z, 0.34, kit, false);
    else if (kit.wins === 'drapé') {
      const a = new THREE.Vector3(X(0.18), w.y1 + 0.05, w.z - w.w / 2 - 0.1), b = new THREE.Vector3(X(0.18), w.y1 + 0.05, w.z + w.w / 2 + 0.1);
      bsGarlandSeg(a, b, 0.32, kit, { balls: true }); bsBow(a, 0.8); bsBow(b, 0.8);
    } else if (kit.wins === 'contour') {
      const x2 = X(0.05), c = [[w.z - w.w / 2 - 0.05, w.y0], [w.z - w.w / 2 - 0.05, w.y1 + 0.05], [w.z + w.w / 2 + 0.05, w.y1 + 0.05], [w.z + w.w / 2 + 0.05, w.y0]];
      for (let k = 0; k < 3; k++) bsGarlandSeg(new THREE.Vector3(x2, c[k][1], c[k][0]), new THREE.Vector3(x2, c[k + 1][1], c[k + 1][0]), 0, kit, { bare: true });
    }
  }
  // parfois un sapin illuminé dans la cour, parfois des stalactites lumineuses sous le bandeau
  if (Math.random() < 0.3 && h.free[1] - h.free[0] > 1.2) bsLitTree(X(h.bow ? 2.6 : 1.3), SIDEWALK_H + 0.25, (h.free[0] + h.free[1]) / 2, 1.7, kit, false);
  if (Math.random() < 0.3) for (let z = h.za + 0.2; z < h.zb - 0.2; z += 0.14) {
    if (Math.abs(z - h.zd) < 1.15) continue;                                     // le perron
    const k = 2 + Math.floor(Math.random() * 4);
    for (let j = 0; j < k; j++) bsBulb(new THREE.Vector3(X(0.18), h.yP - 0.36 - j * 0.09, z), 'cool', 0.022);
  }
  addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(X(AREA_W * 0.6), h.yP + 0.6, h.zd)), color: new THREE.Color(0xffc890), intensity: 3.5, distance: 6 });
  addSubject({ label: 'Une maison décorée pour les fêtes', value: 0.9, glows: true, box: RIGHT.box(boxAt(X(AREA_W / 2), h.zd, AREA_W / 2 + 0.2, 2.2, SIDEWALK_H, h.yP + 2.6)),
    moment: () => ({ pts: 3, why: 'décorations allumées sous la neige' }) });
}

/** Grille de la cour anglaise : muret de grès, barreaux à pointe de lance, lisses, poteaux à boule. */
function bsFence(side, za, zb, h = 1.0) {
  const L = zb - za; if (L < 0.05) return;
  const x = side * (FACADE_X + 0.15), zc = (za + zb) / 2;
  bsBox(bsStoopGeoms, 0.3, 0.44, L, x, SIDEWALK_H + 0.12, zc, 2.15);
  snowPad(x, SIDEWALK_H + 0.34, zc, 0.32, L, 0.11);
  if (L < 0.35) return;
  const y0 = SIDEWALK_H + 0.34;
  for (let z = za + 0.08; z < zb - 0.04; z += 0.125) {
    const g = new THREE.CylinderGeometry(0.012, 0.012, h, 5); g.translate(x, y0 + h / 2, z); fenceGeoms.push(g);
    const tip = new THREE.ConeGeometry(0.024, 0.09, 4); tip.translate(x, y0 + h + 0.045, z); fenceGeoms.push(tip);
  }
  for (const yy of [y0 + 0.1, y0 + h - 0.12]) { const g = new THREE.BoxGeometry(0.03, 0.04, L); g.translate(x, yy, zc); fenceGeoms.push(g); }
  for (const z of [za + 0.04, zb - 0.04]) {
    const g = new THREE.BoxGeometry(0.06, h + 0.1, 0.06); g.translate(x, y0 + (h + 0.1) / 2, z); fenceGeoms.push(g);
    const b = new THREE.SphereGeometry(0.045, 8, 6); b.translate(x, y0 + h + 0.15, z); fenceGeoms.push(b);
  }
  snowPad(x, y0 + h - 0.1, zc, 0.06, L, 0.04, 0, 0.3);
}
/** Grille de séparation entre deux cours (perpendiculaire à la rue), du muret jusqu'à la façade. */
function bsPartition(side, z) {
  const ox = -side, fx = side * (FACADE_X + AREA_W), X = d => fx + ox * d, y0 = SIDEWALK_H + 0.2;
  for (let d = 0.2; d < AREA_W - 0.25; d += 0.14) { const g = new THREE.CylinderGeometry(0.011, 0.011, 0.85, 5); g.translate(X(d), y0 + 0.42, z); fenceGeoms.push(g); }
  const r = new THREE.BoxGeometry(AREA_W - 0.3, 0.035, 0.03); r.translate(X(AREA_W / 2), y0 + 0.82, z); fenceGeoms.push(r);
  snowPad(X(AREA_W / 2), y0 + 0.84, z, AREA_W - 0.35, 0.05, 0.035, 0, 0.3, 0);
}

/** Une terrace : n maisons de largeur W à partir de z0 (côté side de la rue de droite). */
function buildTerrace(side, z0, n, W, sty) {
  const ox = -side, fx = side * (FACADE_X + AREA_W), X = d => fx + ox * d;
  const L = n * W, zc = z0 + L / 2, yP = stoopGeom(sty).yP, y2 = yP + PARLOR_H, yTop = y2 + sty.floors * UPPER_H;
  const snowStart = snowGeoms.length, face = [], base = [], holesF = [], holesB = [];
  const corn = bsCornice.get(sty.cornice) ?? []; bsCornice.set(sty.cornice, corn);
  const xB = X(-BS_REC);                                          // fond des embrasures
  // corps de la maison, derrière les embrasures ; il monte jusqu'au toit, derrière la corniche
  const bodyX = side * (FACADE_X + AREA_W + BS_REC + (BS_DEPTH - BS_REC) / 2);
  bsBox(face, BS_DEPTH - BS_REC, yTop + 1 - yP, L, bodyX, (yP + yTop + 1) / 2, zc);
  bsBox(base, BS_DEPTH - BS_REC, yP + 0.6, L, bodyX, (yP - 0.6) / 2, zc, 5);
  // bandeau au niveau du parlor floor (sous le palier)
  bsBox(face, 0.16, 0.3, L, X(0.08), yP - 0.17, zc); snowPad(X(0.08), yP - 0.02, zc, 0.16, L, 0.08);

  for (let i = 0; i < n; i++) {
    const za = z0 + i * W, doorEnd = i % 2 === 0, bays = [W / 6, W / 2, 5 * W / 6].map(u => za + u), doorBay = doorEnd ? 2 : 0, zd = bays[doorBay];
    const wins = [];                                              // fenêtres de la maison (décorations)
    // jardinières enneigées sur les appuis (une maison sur trois environ, pas sur les bow-windows)
    const planter = !sty.bow && Math.random() < 0.38 ? bsPick(BS_PLANTERS) : null;
    bays.forEach((zb, b) => {
      if (sty.bow && b !== doorBay) return;                       // ces deux travées sont dans le bow-window
      // rez-de-jardin : fenêtres à moitié dans la neige de la cour, derrière une grille
      if (b !== doorBay) {
        const w = 1.05, y1 = Math.min(1.5, yP - 0.4), y0 = Math.min(0.42, y1 - 0.5);
        holesB.push({ z0: zb - w / 2, z1: zb + w / 2, y0, y1 }); bsWindow(side, xB, y0, y1, zb, w, 0.25, 0.45, true);
        for (let bz = -w / 2 + 0.06; bz < w / 2; bz += 0.11) { const g = new THREE.CylinderGeometry(0.011, 0.011, y1 - y0, 5); g.translate(X(0.04), (y0 + y1) / 2, zb + bz); fenceGeoms.push(g); }
        for (const hy of [y0 + 0.05, y1 - 0.05]) { const g = new THREE.BoxGeometry(0.02, 0.035, w + 0.04); g.translate(X(0.04), hy, zb); fenceGeoms.push(g); }
        // parlor floor : hautes fenêtres sous un fronton
        const wp = 1.15, p0 = yP + 0.35, p1 = yP + 3.0;
        holesF.push({ z0: zb - wp / 2, z1: zb + wp / 2, y0: p0, y1: p1 }); bsWindow(side, xB, p0, p1, zb, wp, 0.38, 0.4);
        wins.push({ z: zb, y0: p0, y1: p1, w: wp, parlor: true });
        bsSill(face, X, p0, zb, wp); bsParlorHood(face, X, p1, zb, wp, sty.hood);
        if (planter) bsPlanter(X, p0, zb, wp, planter);
      }
      // étages : trois fenêtres alignées sur les travées, la dernière plus basse
      for (let j = 0; j < sty.floors; j++) {
        const w = 1.1, y0 = y2 + j * UPPER_H + 0.75, y1 = y0 + (j === sty.floors - 1 ? 1.7 : 2.0);
        holesF.push({ z0: zb - w / 2, z1: zb + w / 2, y0, y1 }); bsWindow(side, xB, y0, y1, zb, w, 0.3, 0.45);
        wins.push({ z: zb, y0, y1, w, parlor: false });
        bsSill(face, X, y0, zb, w);
        if (planter && j === 0 && b !== doorBay) bsPlanter(X, y0, zb, w, planter);
        if (sty.hood === 'segment') { bsParlorHood(face, X, y1, zb, w, 'segment'); continue; }   // frontons cintrés à tous les étages
        bsBox(face, 0.06, 0.12, w + 0.2, X(0.03), y1 + 0.06, zb);                                 // frise
        bsBox(face, 0.2, 0.16, w + 0.44, X(0.1), y1 + 0.2, zb);                                   // larmier
        for (const e of [-1, 1]) bsBox(face, 0.13, 0.26, 0.1, X(0.065), y1 + 0.02, zb + e * (w / 2 + 0.15));
        snowPad(X(0.1), y1 + 0.28, zb, 0.2, w + 0.4, 0.1);
      }
    });
    if (sty.bow) {                                                 // bow-window sur les deux travées sans porte
      const gap = sty.door === 'arch' ? 1.45 : 1.28;
      if (doorEnd) bsBowWindow(side, X, za + 0.3, zd - gap, yP, y2, yTop, sty, face, base);
      else bsBowWindow(side, X, zd + gap, za + W - 0.3, yP, y2, yTop, sty, face, base);
    }
    // porte du parlor floor : entrée complète (encadrement en grès, lanterne loin du voisin)
    let door = { yWreath: yP + 1.55, xWreath: X(0.12), arch: false, half: 0.95, top: yP + 3.05 };
    if (sty.door === 'arch') {
      const d = bsArchedDoor(side, fx, zd, yP, face, sty);
      holesF.push({ z0: zd - d.SW / 2, z1: zd + d.SW / 2, y0: yP, y1: yP + d.SH });
      door = d;
    } else buildEntrance(side, zd, yP, { faceX: fx, trim: face, lanternSide: doorEnd ? -1 : 1 });
    const rails = bsStoop(side, fx, zd, sty, face, doorEnd ? 1 : -1);
    // cour anglaise fermée de part et d'autre du couloir du perron (on ne descend pas dans la cour)
    const cw = STOOP_W / 2 - 0.12;
    for (const [b0, b1] of [[za, zd - cw], [zd + cw, za + W]]) if (b1 - b0 > 0.01) RIGHT.collider(side * (FACADE_X + AREA_W / 2), (b0 + b1) / 2, AREA_W / 2, (b1 - b0) / 2);
    // grille de la cour : interrompue au pied du perron ; séparations entre cours (sauf entre perrons appariés)
    const s0 = zd - STOOP_W / 2 - 0.02, s1 = zd + STOOP_W / 2 + 0.02;
    bsFence(side, za, s0); bsFence(side, s1, za + W);
    const free = doorEnd ? [za + 0.4, s0 - 0.3] : [s1 + 0.3, za + W - 0.4];
    if (Math.random() < 0.38) bsDecorate(side, X, { zd, yP, rails, fences: [[za, s0], [s1, za + W]], door, wins, za, zb: za + W, free, bow: sty.bow });
    if (!doorEnd || i === 0) bsPartition(side, za + 0.02);
    if (i === n - 1) bsPartition(side, za + W - 0.02);
    // cheminée sur le mur mitoyen
    if (i % 2 === 0) { bsBox(base, 0.7, 1.6, 0.9, X(-4), yTop + 1.8, za, 5); snowPad(X(-4), yTop + 2.6, za, 0.72, 0.92, 0.15); }
    // mur mitoyen : un pilastre de grès à peine saillant marque chaque maison de la terrace
    if (i > 0) bsBox(face, 0.08, yTop - yP + 0.2, 0.3, X(0.04), (yP + yTop) / 2 - 0.1, za);
    brownHouses.push({ side, za, zb: za + W, zd, free: doorEnd ? [za + 0.4, s0 - 0.3] : [s1 + 0.3, za + W - 0.4] });
  }
  // façades : couche avant découpée autour des ouvertures
  bsFrontLayer(face, X(-BS_REC / 2), z0, z0 + L, yP, yTop, holesF);
  bsFrontLayer(base, X(-BS_REC / 2), z0, z0 + L, -0.6, yP - 0.32, holesB, 5);
  // corniche peinte : frise, moulure, larmier, consoles à volute, modillons ; neige dessus
  bsBox(corn, 0.12, 0.8, L, X(0.06), yTop + 0.4, zc);
  bsBox(corn, 0.36, 0.14, L + 0.1, X(0.18), yTop + 0.86, zc);
  bsBox(corn, 0.78, 0.2, L + 0.3, X(0.39), yTop + 1.03, zc);
  for (let i = 0; i < n; i++) for (const u of [0.2, W / 3, 2 * W / 3, W - 0.2]) {
    const g = bsBracketGeo.clone(); if (ox < 0) g.rotateY(Math.PI);
    g.translate(X(0.12), yTop + 0.13, z0 + i * W + u); corn.push(g);
  }
  for (let z = z0 + 0.35; z < z0 + L - 0.2; z += 0.38) bsBox(corn, 0.42, 0.07, 0.09, X(0.33), yTop + 0.9, z);
  snowPad(X(0.39), yTop + 1.13, zc, 0.78, L + 0.26, 0.28);
  addPowderCornice(RIGHT.toWorld(new THREE.Vector3(X(0.7), yTop + 1.3, z0 + 0.3)), RIGHT.toWorld(new THREE.Vector3(X(0.7), yTop + 1.3, z0 + L - 0.3)));
  snowPad(bodyX + ox * 0.3, yTop + 1, zc, BS_DEPTH - 0.8, L - 0.3, 0.32, 0, 1.2);               // toit : invisible de la rue, maillage grossier

  // matériaux de la terrace : grès lisse (même programme que la brique) et grès refendu (soubassements)
  const tint = sty.tint, faceMat = new THREE.MeshStandardMaterial({ map: brownstone.map, normalMap: brownstone.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: brownstone.rough, roughness: 1, color: new THREE.Color(...tint) });
  weather(faceMat, { top: yTop, z0, pitch: W / 3, cols: 3 * n, y0: y2 + 0.75, floorH: UPPER_H, rows: sty.floors, winW: 1.1, frame: RIGHT.frame, warm: 1, faceX: FACADE_X + AREA_W });
  const baseMat = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: stone.rough, roughness: 1, color: new THREE.Color(tint[0] * 2.2, tint[1] * 2.2, tint[2] * 2.2) });
  weather(baseMat, { strength: 0.8, frame: RIGHT.frame, warm: 1, faceX: FACADE_X + AREA_W });
  usePhoto(baseMat, 'large_sandstone_blocks', 5 / 3, 5 / 3, m => m.color.lerp(PHOTO_WHITE, 0.3));
  RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(face.map(g => g.index ? g.toNonIndexed() : g)), faceMat)));
  RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(base), baseMat)));
  flushSnowPads(snowStart);
}
/* BOW-WINDOW arrondi (photo Renaissance de l'utilisateur) : une avancée en arc de cercle, du
   rez-de-jardin jusque sous la corniche, sur les deux travées sans porte. L'arc est tendu de zA à zB,
   saillie BS_BOW (1,4 m : bien lisible de nuit, demande utilisateur). Trois pans droits portent les
   fenêtres (mêmes instances que les autres, tournées avec leur pan) ; entre eux et aux deux retours,
   les trumeaux sont faits de petits pans étroits qui suivent la courbe : l'avancée se lit ronde.
   Appuis et larmiers enneigés, colonnettes aux montants des fenêtres, bandeaux, chapeau. Chaque pan
   est construit comme une petite façade plate (x = ox · profondeur, z le long du pan) puis tourné et
   posé sur la corde de son arc. */
const BS_BOW = 1.4, bsBowM = new THREE.Matrix4(), bsBowQ = new THREE.Quaternion(), bsBowP = new THREE.Vector3(), bsBowY = new THREE.Vector3(0, 1, 0);
function bsBowWindow(side, X, zA, zB, yP, y2, yTop, sty, face, base) {
  const ox = -side, hw = (zB - zA) / 2, zm = (zA + zB) / 2, sag = Math.min(BS_BOW, hw * 0.85);
  const R = (hw * hw + sag * sag) / (2 * sag), dc = sag - R, a0 = Math.asin(hw / R);
  // découpage en angle : retour (2 pans), fenêtre, trumeau (2 pans), fenêtre, trumeau (2 pans), fenêtre, retour (2 pans)
  let aw = 2 * Math.asin(Math.min(1.2, 0.95 * R) / (2 * R));             // angle d'un pan de fenêtre (corde ~1,2 m)
  if (2 * a0 - 3 * aw < 0.36) aw = (2 * a0 - 0.36) / 3;                   // assez de place pour les trumeaux
  const ap = (2 * a0 - 3 * aw) / 8, facets = [];
  for (const [n, a, win] of [[2, ap, false], [1, aw, true], [2, ap, false], [1, aw, true], [2, ap, false], [1, aw, true], [2, ap, false]])
    for (let k = 0; k < n; k++) facets.push({ a, win });
  const ySplit = yP - 0.32;                                       // grès refendu en dessous, grès lisse au-dessus
  const levels = [{ y0: Math.min(0.45, yP - 0.95), y1: Math.min(1.5, yP - 0.45), w: 0.85, lit: 0.25, shade: 0.45, basement: true },
    { y0: yP + 0.35, y1: yP + 3.0, w: 1.05, lit: 0.4, shade: 0.4 }];
  for (let j = 0; j < sty.floors; j++) { const y0 = y2 + j * UPPER_H + 0.75; levels.push({ y0, y1: y0 + (j === sty.floors - 1 ? 1.7 : 2.0), w: 1.0, lit: 0.3, shade: 0.45 }); }
  const place = (g, list, tile) => { g.applyMatrix4(bsBowM); bsPlace(list, g, tile); };
  const at = (ld, y) => bsBowP.set(ox * ld, y, 0).applyMatrix4(bsBowM);
  const pt = a => ({ d: dc + R * Math.cos(a), z: zm + R * Math.sin(a) });
  const m = new THREE.Matrix4(), qg = new THREE.Quaternion(), posts = [];
  let a = -a0;
  for (const F of facets) {
    const A = pt(a), B = pt(a + F.a), psi = side * (a + F.a / 2), fw = Math.hypot(B.d - A.d, B.z - A.z);
    bsBowM.makeRotationY(psi).setPosition(X((A.d + B.d) / 2), 0, (A.z + B.z) / 2); bsBowQ.setFromAxisAngle(bsBowY, psi);
    const up = [], low = [];
    if (F.win) {
      posts.push(A, B);
      for (const L of levels) {
        const w = Math.min(L.w, fw - 0.22), h = L.y1 - L.y0, wy = (L.y0 + L.y1) / 2, below = L.y1 < ySplit;
        (below ? low : up).push({ z0: -w / 2, z1: w / 2, y0: L.y0, y1: L.y1 });
        m.compose(at(-BS_REC + 0.06, wy), bsBowQ, new THREE.Vector3(1, h / WIN_H, w / WIN_W)); frameInst.push(m.clone());
        qg.copy(bsBowQ).multiply(bsQ[side < 0 ? 0 : 1]);
        m.compose(at(-BS_REC + 0.02, wy), qg, new THREE.Vector3(w / WIN_W, h / WIN_H, 1));
        const r = Math.random();
        if (r < L.lit) { const lm = m.clone(); lm.noSilhouette = !!L.basement; litInst[Math.floor(Math.random() * 3)].push(lm); }
        else if (r < L.lit + L.shade) shadeInst[Math.floor(Math.random() * 3)].push(m.clone()); else darkInst.push(m.clone());
        // appui, larmier, neige
        place(new THREE.BoxGeometry(BS_REC + 0.14, 0.12, w + 0.2).translate(ox * (0.14 - BS_REC) / 2, L.y0 - 0.06, 0), below ? base : face, below ? 5 : 5.5);
        let p = at(-0.08, L.y0); snowPad(p.x, p.y, p.z, 0.42, w + 0.16, 0.1, 0, 0.18, psi);
        place(new THREE.BoxGeometry(0.2, 0.16, w + 0.24).translate(ox * 0.1, L.y1 + 0.15, 0), below ? base : face, below ? 5 : 5.5);
        p = at(0.1, L.y1 + 0.23); snowPad(p.x, p.y, p.z, 0.2, w + 0.2, 0.09, 0, 0.18, psi);
      }
    }
    const tf = [], tb = [];
    bsFrontLayer(tf, ox * (-BS_REC / 2), -fw / 2 - 0.01, fw / 2 + 0.01, ySplit, yTop, up);
    bsFrontLayer(tb, ox * (-BS_REC / 2), -fw / 2 - 0.01, fw / 2 + 0.01, -0.6, ySplit, low, 5);
    for (const g of tf) place(g, face); for (const g of tb) place(g, base, 5);
    // bandeau du parlor floor, cordon d'étage, chapeau sous la corniche (neige)
    for (const [d, hh, y, sn] of [[0.16, 0.3, yP - 0.17, 0.08], [0.1, 0.16, y2 - 0.05, 0], [0.5, 0.28, yTop - 0.14, 0.14]]) {
      place(new THREE.BoxGeometry(d, hh, fw + 0.06).translate(ox * d / 2, y, 0), face);
      if (sn) { const p = at(d / 2, y + hh / 2); snowPad(p.x, p.y, p.z, d, fw + 0.04, sn, 0, 0.18, psi); }
    }
    a += F.a;
  }
  for (const A of posts) {                                        // colonnettes aux montants des fenêtres
    const g = new THREE.CylinderGeometry(0.09, 0.09, yTop + 0.6, 10); g.translate(X(A.d - 0.03), (yTop - 0.6) / 2, A.z); bsPlace(face, g);
  }
}
/* Jardinières sur les appuis : caisse peinte (ou de cuivre vert-de-gris), un dôme de neige, quelques
   branches de sapin et des tiges sèches qui en sortent. */
const BS_PLANTERS = [0x1f3324, 0x141414, 0x5a2a1a, 0x3a5a52];
let bsPlanters = new Map();
function bsPlanter(X, y0, zb, w, color) {
  if (!bsPlanters.has(color)) bsPlanters.set(color, []);
  const L = w - 0.05, g = new THREE.BoxGeometry(0.26, 0.24, L); g.translate(X(0.02), y0 + 0.12, zb); bsPlanters.get(color).push(g);
  const lip = new THREE.BoxGeometry(0.3, 0.035, L + 0.04); lip.translate(X(0.02), y0 + 0.235, zb); bsPlanters.get(color).push(lip);
  for (let k = 0; k < Math.round(L / 0.16); k++) {
    const z = zb - L / 2 + 0.08 + k * 0.16 + (Math.random() - 0.5) * 0.05, h = 0.14 + Math.random() * 0.22;
    const c = new THREE.ConeGeometry(0.05 + Math.random() * 0.04, h, 5); c.rotateX((Math.random() - 0.5) * 0.6); c.rotateZ((Math.random() - 0.5) * 0.6);
    c.translate(X(0.02 + (Math.random() - 0.5) * 0.1), y0 + 0.26 + h / 2, z); bsGarland.push(c);
  }
  snowPad(X(0.02), y0 + 0.25, zb, 0.3, L + 0.02, 0.09);
}
function bsSill(list, X, y0, zb, w) {
  bsBox(list, BS_REC + 0.14, 0.12, w + 0.3, X((0.14 - BS_REC) / 2), y0 - 0.06, zb);
  snowPad(X(-0.08), y0, zb, 0.42, w + 0.26, 0.1);
}
/** Couronnement des fenêtres du parlor floor : fronton triangulaire, arc segmentaire ou corniche plate, sur consoles. */
function bsParlorHood(list, X, y1, zb, w, kind) {
  const W2 = w + 0.6, yb = y1 + 0.3;
  bsBox(list, 0.08, 0.22, w + 0.24, X(0.04), y1 + 0.11, zb);                                   // frise
  bsBox(list, 0.28, 0.16, W2, X(0.14), yb, zb);                                                 // larmier
  for (const e of [-1, 1]) bsBox(list, 0.2, 0.44, 0.13, X(0.1), y1 + 0.02, zb + e * (w / 2 + 0.2));   // consoles
  if (kind === 'flat') { bsBox(list, 0.34, 0.1, W2 + 0.1, X(0.17), yb + 0.13, zb); snowPad(X(0.17), yb + 0.18, zb, 0.34, W2 + 0.06, 0.14); return; }
  const n = kind === 'pediment' ? 2 : 7, half = W2 / 2;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = -1 + 2 * k / n, z = zb + t * half;
    const y = kind === 'pediment' ? yb + 0.08 + (1 - Math.abs(t)) * half * 0.42 : yb + 0.08 + Math.sqrt(Math.max(0, 1 - t * t * 0.85)) * 0.42;
    pts.push(new THREE.Vector3(X(0.13), y, z));
  }
  for (let k = 0; k < n; k++) {
    const seg = []; bsStrut(seg, pts[k], pts[k + 1], 0.13); bsPlace(list, seg[0]);
    bsSnowStrip(pts[k].clone().setY(pts[k].y + 0.07), pts[k + 1].clone().setY(pts[k + 1].y + 0.07), 0.24, 0.07);
  }
}

/** Rangée de brownstones du côté `side`, de zFrom à zTo EXACTEMENT (repère de la rue de droite). */
function buildBrownRow(side, zFrom, zTo) {
  let z = zFrom, nb = 0;
  bsFlush();
  while (nb < RIGHT_CHUNKS.length && RIGHT_CHUNKS[nb] <= zFrom) nb++;
  while (zTo - z > 3) {
    if (nb < RIGHT_CHUNKS.length && z >= RIGHT_CHUNKS[nb]) { bsFlush(); while (nb < RIGHT_CHUNKS.length && RIGHT_CHUNKS[nb] <= z) nb++; }
    const R = zTo - z;
    let n = 2 + Math.floor(Math.random() * 4), W = rnd(6.0, 6.9);
    if (R - n * W < 12.2) { n = Math.max(1, Math.round(R / 6.5)); W = R / n; }   // dernière terrace : elle prend le reste
    const base = BS_STYLES[Math.floor(Math.random() * BS_STYLES.length)];
    const sty = { ...base, floors: Math.random() < 0.62 ? 2 : 3, bow: base.low || (base.hood !== 'pediment' && Math.random() < 0.3),
      tint: BS_TINTS[Math.floor(Math.random() * BS_TINTS.length)].map(v => v * rnd(0.9, 1.1)), cornice: BS_CORNICE[Math.floor(Math.random() * BS_CORNICE.length)] };
    buildTerrace(side, z, n, W, sty);
    z += n * W;
  }
}

// Côté −1 (en face, z monde < CROSS_Z) : du parc jusqu'au droit de la rue principale ; côté +1
// (feux) : du parc jusqu'à l'immeuble d'angle de la rue principale (14 m de profondeur).
beginStreet(RIGHT, 1, RIGHT_CHUNKS);
buildBrownRow(-1, BS_ROW_END, -FACADE_X);
buildBrownRow(1, BS_ROW_END, -(FACADE_X + 14));
bsFlush();
endStreet();
