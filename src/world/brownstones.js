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
function bsWindow(side, xBack, y0, y1, z, w, pLit, pShade) {
  const m = new THREE.Matrix4(), h = y1 - y0, wy = (y0 + y1) / 2, ox = -side;
  m.compose(new THREE.Vector3(xBack + ox * 0.06, wy, z), new THREE.Quaternion(), new THREE.Vector3(1, h / WIN_H, w / WIN_W)); frameInst.push(m.clone());
  m.compose(new THREE.Vector3(xBack + ox * 0.02, wy, z), bsQ[side < 0 ? 0 : 1], new THREE.Vector3(w / WIN_W, h / WIN_H, 1));
  const r = Math.random();
  if (r < pLit) litInst[Math.floor(Math.random() * 3)].push(m.clone());
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
  const tr = new THREE.Mesh(new THREE.CircleGeometry(R - 0.03, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ map: makeTransomTexture(num), color: hallGlassMat.color }));
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
  return { SW, SH, yWreath: yDoor + 1.55, xWreath: X(-BS_REC + 0.1) };
}

/* Décorations de fêtes (photo de l'utilisateur) : guirlandes de sapin le long des rampes et de la
   grille, piquées de petites ampoules chaudes (le bloom en fait des points lumineux), nœuds rouges,
   couronne sur la porte et aux fenêtres du parlor floor. Une maison sur trois environ. */
const bsGarlandMat = new THREE.MeshStandardMaterial({ color: 0x1b3220, roughness: 0.85 });
const bsBulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.6, 3.3, 1.7) });
let bsGarland = [], bsBulbs = [], bsBows = [];
function bsFlushDecor() {
  if (bsGarland.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsGarland), bsGarlandMat));
  if (bsBulbs.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsBulbs), bsBulbMat));
  if (bsBows.length) RIGHT.add(new THREE.Mesh(mergeGeometries(bsBows), paintMat(0x9a0d0d, 0.55, 0.05)));
  bsGarland = []; bsBulbs = []; bsBows = [];
}
/** Guirlande entre a et b (légèrement tombante), ampoules en spirale autour. */
function bsGarlandSeg(a, b, sag = 0.07) {
  const m = a.clone().add(b).multiplyScalar(0.5); m.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, m, b), len = a.distanceTo(b);
  bsGarland.push(new THREE.TubeGeometry(curve, Math.max(4, Math.round(len / 0.12)), 0.08, 5, false));
  const nb = Math.max(3, Math.round(len / 0.065));
  for (let k = 0; k <= nb; k++) {
    const p = curve.getPoint(k / nb), t = k * 2.4;
    const g = new THREE.SphereGeometry(0.032, 5, 4); g.translate(p.x + Math.cos(t) * 0.065, p.y + Math.sin(t) * 0.065, p.z + Math.sin(t * 0.7) * 0.065); bsBulbs.push(g);
  }
}
/** Nœud rouge (deux boucles et deux pans) en p, tourné vers la rue (face à ±x). */
function bsBow(p) {
  for (const e of [-1, 1]) {
    const l = new THREE.SphereGeometry(0.075, 8, 6); l.scale(0.5, 0.75, 1); l.translate(p.x, p.y + 0.02, p.z + e * 0.07); bsBows.push(l);
    const t = new THREE.BoxGeometry(0.03, 0.2, 0.045); t.rotateX(e * 0.3); t.translate(p.x, p.y - 0.1, p.z + e * 0.04); bsBows.push(t);
  }
}
/** Couronne (repère de la rue) en (x, y, z), face à la rue. */
function bsWreath(side, x, y, z, r = 0.3) {
  const g = new THREE.TorusGeometry(r, 0.085, 6, 18); g.rotateY(Math.PI / 2); g.translate(x, y, z); bsGarland.push(g);
  for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2, s = new THREE.SphereGeometry(0.03, 5, 4); s.translate(x - side * 0.06, y + Math.sin(a) * r, z + Math.cos(a) * r); bsBulbs.push(s); }
  bsBow(new THREE.Vector3(x - side * 0.08, y - r, z));
}

/** Habille une maison pour les fêtes : guirlandes sur les rampes du perron et en festons sur la grille,
 *  nœuds rouges, couronnes sur la porte et aux fenêtres du parlor floor, une lueur chaude au pied. */
function bsDecorate(side, X, zd, yP, rails, fences, wreath, winBays) {
  for (const [a, b] of rails) bsGarlandSeg(a.clone().setY(a.y - 0.04), b.clone().setY(b.y - 0.04), 0.05);
  rails.forEach(([a], i) => { if (i % 2 === 0) bsBow(a.clone().setY(a.y - 0.08)); });          // nœud au pied de chaque rampe
  const xf = side * (FACADE_X + 0.15), yf = SIDEWALK_H + 1.38;
  for (const [za, zb] of fences) {
    if (zb - za < 0.6) continue;
    const n = Math.max(1, Math.round((zb - za) / 1.2));
    for (let k = 0; k < n; k++) {
      const z0 = za + (zb - za) * k / n, z1 = za + (zb - za) * (k + 1) / n;
      bsGarlandSeg(new THREE.Vector3(xf, yf, z0 + 0.05), new THREE.Vector3(xf, yf, z1 - 0.05), 0.16);
      bsBow(new THREE.Vector3(xf - side * 0.05, yf + 0.02, z0 + 0.05));
    }
  }
  bsWreath(side, wreath.x, wreath.y, zd, 0.3);
  for (const zb of winBays) bsWreath(side, X(-BS_REC + 0.12), yP + 1.75, zb, 0.36);
  addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(X(AREA_W * 0.6), yP + 0.6, zd)), color: new THREE.Color(0xffc890), intensity: 3.5, distance: 6 });
  addSubject({ label: 'Un perron décoré pour les fêtes', value: 0.9, glows: true, box: RIGHT.box(boxAt(X(AREA_W / 2), zd, AREA_W / 2 + 0.2, 2.2, SIDEWALK_H, yP + 2.6)),
    moment: () => ({ pts: 3, why: 'guirlandes allumées sous la neige' }) });
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
    bays.forEach((zb, b) => {
      // rez-de-jardin : fenêtres à moitié dans la neige de la cour, derrière une grille
      if (b !== doorBay) {
        const w = 1.05, y1 = Math.min(1.5, yP - 0.4), y0 = Math.min(0.42, y1 - 0.5);
        holesB.push({ z0: zb - w / 2, z1: zb + w / 2, y0, y1 }); bsWindow(side, xB, y0, y1, zb, w, 0.25, 0.45);
        for (let bz = -w / 2 + 0.06; bz < w / 2; bz += 0.11) { const g = new THREE.CylinderGeometry(0.011, 0.011, y1 - y0, 5); g.translate(X(0.04), (y0 + y1) / 2, zb + bz); fenceGeoms.push(g); }
        for (const hy of [y0 + 0.05, y1 - 0.05]) { const g = new THREE.BoxGeometry(0.02, 0.035, w + 0.04); g.translate(X(0.04), hy, zb); fenceGeoms.push(g); }
        // parlor floor : hautes fenêtres sous un fronton
        const wp = 1.15, p0 = yP + 0.35, p1 = yP + 3.0;
        holesF.push({ z0: zb - wp / 2, z1: zb + wp / 2, y0: p0, y1: p1 }); bsWindow(side, xB, p0, p1, zb, wp, 0.38, 0.4);
        bsSill(face, X, p0, zb, wp); bsParlorHood(face, X, p1, zb, wp, sty.hood);
      }
      // étages : trois fenêtres alignées sur les travées, la dernière plus basse
      for (let j = 0; j < sty.floors; j++) {
        const w = 1.1, y0 = y2 + j * UPPER_H + 0.75, y1 = y0 + (j === sty.floors - 1 ? 1.7 : 2.0);
        holesF.push({ z0: zb - w / 2, z1: zb + w / 2, y0, y1 }); bsWindow(side, xB, y0, y1, zb, w, 0.3, 0.45);
        bsSill(face, X, y0, zb, w);
        if (sty.hood === 'segment') { bsParlorHood(face, X, y1, zb, w, 'segment'); continue; }   // frontons cintrés à tous les étages
        bsBox(face, 0.06, 0.12, w + 0.2, X(0.03), y1 + 0.06, zb);                                 // frise
        bsBox(face, 0.2, 0.16, w + 0.44, X(0.1), y1 + 0.2, zb);                                   // larmier
        for (const e of [-1, 1]) bsBox(face, 0.13, 0.26, 0.1, X(0.065), y1 + 0.02, zb + e * (w / 2 + 0.15));
        snowPad(X(0.1), y1 + 0.28, zb, 0.2, w + 0.4, 0.1);
      }
    });
    // porte du parlor floor : entrée complète (encadrement en grès, lanterne loin du voisin)
    let wreath = { y: yP + 1.55, x: X(0.12) };
    if (sty.door === 'arch') {
      const d = bsArchedDoor(side, fx, zd, yP, face, sty);
      holesF.push({ z0: zd - d.SW / 2, z1: zd + d.SW / 2, y0: yP, y1: yP + d.SH });
      wreath = { y: d.yWreath, x: d.xWreath };
    } else buildEntrance(side, zd, yP, { faceX: fx, trim: face, lanternSide: doorEnd ? -1 : 1 });
    const rails = bsStoop(side, fx, zd, sty, face, doorEnd ? 1 : -1);
    // grille de la cour : interrompue au pied du perron ; séparations entre cours (sauf entre perrons appariés)
    const s0 = zd - STOOP_W / 2 - 0.02, s1 = zd + STOOP_W / 2 + 0.02;
    bsFence(side, za, s0); bsFence(side, s1, za + W);
    if (Math.random() < 0.33) bsDecorate(side, X, zd, yP, rails, [[za, s0], [s1, za + W]], wreath, bays.filter((_, b) => b !== doorBay));
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
    const sty = { ...BS_STYLES[Math.floor(Math.random() * BS_STYLES.length)], floors: Math.random() < 0.62 ? 2 : 3,
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
