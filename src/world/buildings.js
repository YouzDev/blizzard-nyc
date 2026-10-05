import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACADE_X, SIDEWALK_H, STREET_Z_MAX, CROSS_Z, LEFT_END_X, FOG_DENSITY } from '../core/constants.js';
import { rnd, smoothNoise } from '../core/noise.js';
import { brick, stone, winInteriorTex, winDarkTex, shutterTex, lampPaint } from '../textures/index.js';
import { makeSignTexture, SHOP_NAMES } from '../textures/signs.js';
import { makeDoorLeafTextures, makeHallGlassTexture, makeTransomTexture } from '../textures/door.js';
import { makeShopInteriorTexture, makeOpenSignTexture, makeWindowDecalAtlas, makeValanceTexture, makeStripeTexture, DECALS } from '../textures/shop.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { weather } from './weathering.js';
import { makeInteriorMaterial } from './shopInterior.js';
import { usePhoto } from '../textures/photo.js';
import { snowPhoto } from './snowPhoto.js';
import { addSubject, boxAt } from '../game/subjects.js';
import { addPointSource } from './lightRegistry.js';
import { MAIN, LEFT, LEFT_END, LEFT_CHUNKS } from './street.js';
import { addPowderCornice } from './powderSources.js';

/* =====================================================================
   6. BÂTIMENTS : soubassement en pierre, briques, fenêtres, climatiseurs,
      escaliers de secours, perrons grillagés, châteaux d'eau
   ===================================================================== */
export const WIN_W = 1.3, WIN_H = 1.9, FLOOR_H = 3.2, RECESS = 0.24, BASE_H = 4.4;
// Cadre de fenêtre : montants, traverses, meneau, imposte (fusionnés) — instancié
const winFrameGeo = (() => {
  const g = [], t = 0.07, d = 0.09;
  const add = (w, h, dd, x, y, z) => { const b = new THREE.BoxGeometry(w, h, dd); b.translate(x, y, z); g.push(b); };
  add(d, WIN_H, t, 0, 0, -WIN_W / 2 + t / 2); add(d, WIN_H, t, 0, 0, WIN_W / 2 - t / 2);
  add(d, t, WIN_W, 0, WIN_H / 2 - t / 2, 0); add(d, t, WIN_W, 0, -WIN_H / 2 + t / 2, 0);
  add(d, WIN_H, 0.045, 0, 0, 0); add(d, 0.05, WIN_W, 0, WIN_H * 0.12, 0);
  return mergeGeometries(g);
})();
const winGlassGeo = new THREE.PlaneGeometry(WIN_W - 0.1, WIN_H - 0.1);
// Accumulateurs de la rue EN CONSTRUCTION (ST) : remis à zéro par beginStreet, fusionnés et
// ajoutés au groupe de la rue par endStreet. Tout le code des immeubles travaille dans le repère
// de ST ; ce qui doit sortir en coordonnées monde passe par ses méthodes (collider, box, toWorld).
// (exportés, liaisons vivantes : les brownstones de la rue de droite, world/brownstones.js, s'en servent aussi)
export let ST = null;
export let frameInst, litInst, darkInst, shadeInst, escGeoms, fenceGeoms, concGeoms, snowGeoms, basementGlass, plinthGeoms;

/** Boîte avec UV à l'échelle du monde (texture de 5,5 m), translatée. */
export function worldBox(list, w, h, d, x, y, z, scaleU = 5.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const su = Math.max(d, w) / scaleU, sv = h / scaleU;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  g.translate(x, y, z); list.push(g); return g;
}

/** Coussin de neige posé sur une surface horizontale (appui, linteau, bandeau, toit…).
 *  Empreinte sx × sz (le long de X et de Z), épaisseur max h, base à baseY.
 *  C'est une nappe dont la hauteur suit un profil bombé : épaisse au milieu, nulle sur
 *  les bords, bouts arrondis sur ~18 cm, bosselée par un bruit lisse. Même leçon que
 *  sur les voitures : un pavé de neige, même à coins ronds, reste un pavé.
 *  Tout est versé dans `snowGeoms` et fusionné en UN seul objet à la fin — il y avait
 *  plus de mille pavés séparés, soit autant d'appels de dessin.
 *  `rotZ` incline la nappe autour de son point d'appui (stores) ; `step` = pas des
 *  sommets le long de la longueur (0,18 m suffit pour le bruit ; grossier sur les toits) ;
 *  `rotY` = π/2 couche la longueur le long de X (rebords d'une façade tournée vers ±Z). */
export function snowPad(cx, baseY, cz, sx, sz, h, rotZ = 0, step = 0.18, rotY = 0) {
  const nx = Math.min(8, Math.max(4, Math.round(sx / 0.07)));
  const nz = Math.min(120, Math.max(4, Math.round(sz / step)));
  const g = new THREE.PlaneGeometry(sx, sz, nx, nz); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, taper = Math.min(0.18, sz * 0.3);
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i), u = (2 * lx) / sx;
    const across = Math.pow(Math.max(0, 1 - u * u), 0.4);                                    // bombé, nul sur les bords
    const ends = Math.pow(Math.min(1, Math.max(0, (sz / 2 - Math.abs(lz)) / taper)), 0.5);  // bouts arrondis
    const wx = cx + lx, wz = cz + lz;
    const n = 0.78 + 0.44 * smoothNoise(wx * 2.3 + baseY * 1.7, wz * 2.3)                   // épaisseur inégale
            + (smoothNoise(wx * 9 + baseY, wz * 9) - 0.5) * 0.12;                             // grain
    p.setY(i, across * ends * h * n);
  }
  if (rotZ) g.rotateZ(rotZ);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, baseY, cz);
  g.computeVertexNormals();
  snowGeoms.push(g);
}

/** Fusionne les coussins accumulés depuis `from` en un objet. Un objet PAR IMMEUBLE, pas un
 *  seul pour toute la rue : sinon la carte graphique dessine aussi toute la neige située
 *  derrière le joueur, car un objet unique étalé sur 130 m n'est jamais hors champ.
 *  Double face : les coussins des plateformes d'escalier de secours se voient par en
 *  dessous, à travers la grille. */
const snowPadMat = snowPhoto(MAT.snow.clone()); snowPadMat.side = THREE.DoubleSide;   // clone() ne recopie pas onBeforeCompile
export function flushSnowPads(from) {
  const list = snowGeoms.splice(from);
  if (!list.length) return;
  const m = new THREE.Mesh(mergeGeometries(list), snowPadMat); m.receiveShadow = true; ST.add(m);
}

function buildBuilding(side, z0, depthZ, height, opts) {
  const width = 14, ox = -side, faceX = side * FACADE_X, cz = z0 + depthZ / 2;
  const snowStart = snowGeoms.length;               // la neige de cet immeuble sera fusionnée à part
  const outerX = side * (FACADE_X + width);
  const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const cols = Math.max(2, Math.floor(depthZ / 3.0)), rows = Math.floor((height - BASE_H - 1.4) / FLOOR_H);
  const pitch = depthZ / cols;
  const brickGeoms = [];

  // --- Mur de fond (face en retrait) sur toute la hauteur au-dessus du soubassement ;
  // raccourci du côté d'une 2e façade (immeuble d'angle) : ses fenêtres y sont en retrait aussi
  const innerFace = faceX - ox * RECESS, eF = opts.endFacade ?? 0;
  worldBox(brickGeoms, width - RECESS, height - BASE_H, depthZ - (eF ? RECESS : 0), (outerX + innerFace) / 2, BASE_H + (height - BASE_H) / 2, cz - eF * RECESS / 2);
  // --- Allèges (bandes horizontales en saillie) entre les rangées de fenêtres
  const yb = r => BASE_H + 0.9 + r * FLOOR_H, yt = r => yb(r) + WIN_H;
  const spanX = faceX - ox * RECESS / 2;
  let prevTop = BASE_H;
  for (let r = 0; r < rows; r++) { worldBox(brickGeoms, RECESS, yb(r) - prevTop, depthZ, spanX, (prevTop + yb(r)) / 2, cz); prevTop = yt(r); }
  worldBox(brickGeoms, RECESS, height - prevTop, depthZ, spanX, (prevTop + height) / 2, cz);
  // --- Trumeaux (piliers verticaux) entre les colonnes de fenêtres
  const wz = c => z0 + (c + 0.5) * pitch;
  for (let c = 0; c <= cols; c++) {
    const za = c === 0 ? z0 : wz(c - 1) + WIN_W / 2, zb = c === cols ? z0 + depthZ : wz(c) - WIN_W / 2;
    worldBox(brickGeoms, RECESS, height - BASE_H, zb - za, spanX, BASE_H + (height - BASE_H) / 2, (za + zb) / 2);
  }
  if (eF) buildEndFacade(side, eF, z0, depthZ, height, rows, yb, yt, brickGeoms);
  const brickMat = new THREE.MeshStandardMaterial({ map: brick.map, normalMap: brick.normal, normalScale: new THREE.Vector2(0.75, 0.75), roughnessMap: brick.rough, roughness: 1,
    color: new THREE.Color().setHSL(0.02 + Math.random() * 0.035, 0.45 + Math.random() * 0.2, 0.36 + Math.random() * 0.16) });
  // suie sous la corniche, coulures sous chaque appui, plaques (voir weathering.js)
  // brique photo : deux appareils différents pour que la rue ne soit pas uniforme. Les UV
  // de la brique sont à l'échelle d'une tuile de 5,5 m (worldBox) : répétition = 5,5 / taille réelle.
  // La teinte par immeuble, pensée pour le canvas, est adoucie : la photo a déjà sa couleur.
  const br = Math.random();
  const brickPhoto = br < 0.18 ? ['painted_worn_brick', 5.5 / 1.8, 0.85]      // brique peinte crème, écaillée
                   : br < 0.43 ? ['red_brick_03', 5.5 / 1.0, 0.55] : ['red_bricks_04', 5.5 / 2.5, 0.55];
  usePhoto(brickMat, brickPhoto[0], brickPhoto[1], brickPhoto[1], m => m.color.lerp(PHOTO_WHITE, brickPhoto[2]));
  weather(brickMat, { top: height, z0, pitch, cols, y0: BASE_H + 0.9, floorH: FLOOR_H, rows, winW: WIN_W, frame: ST.frame, warm: ST.warm,
    // coulures de rouille sous les paliers de l'escalier de secours
    ...(opts.fireEscape ? { escZ: cz + opts.escapeOffset, escW: 3.4, escY0: BASE_H + 1.0, escN: escapeFloors(height, BASE_H) } : {}) });
  ST.add(shadowed(new THREE.Mesh(mergeGeometries(brickGeoms), brickMat)));

  // --- Fenêtres : cadre, vitre en retrait, linteau et appui en pierre, neige, climatiseurs
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), qId = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const wy = yb(r) + WIN_H / 2, z = wz(c);
    m.compose(new THREE.Vector3(innerFace + ox * 0.06, wy, z), qId, one); frameInst.push(m.clone());   // le cadre est déjà orienté (plan YZ)
    m.compose(new THREE.Vector3(innerFace + ox * 0.02, wy, z), q, one);
    const lit = Math.random() < 0.26;
    if (lit) litInst[Math.floor(Math.random() * 3)].push(m.clone());
    else if (Math.random() < 0.55) shadeInst[Math.floor(Math.random() * 3)].push(m.clone());   // store, rideaux ou lamelles
    else darkInst.push(m.clone());
    worldBox(concGeoms, RECESS + 0.1, 0.24, WIN_W + 0.36, faceX + ox * 0.05 - ox * RECESS / 2, yt(r) + 0.12, z);       // linteau
    worldBox(concGeoms, RECESS + 0.2, 0.13, WIN_W + 0.28, faceX + ox * 0.1 - ox * RECESS / 2, yb(r) - 0.065, z);        // appui
    snowPad(faceX + ox * 0.1 - ox * RECESS / 2, yb(r), z, RECESS + 0.2, WIN_W + 0.24, 0.12);          // neige sur l'appui
    snowPad(faceX + ox * 0.05 - ox * RECESS / 2, yt(r) + 0.24, z, RECESS + 0.12, WIN_W + 0.3, 0.1);   // neige sur le linteau
    if (Math.random() < 0.1) {
      const ac = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.62), MAT.concrete)); ac.position.set(faceX + ox * 0.22, yb(r) + 0.22, z); ST.add(ac);
      snowPad(faceX + ox * 0.22, yb(r) + 0.43, z, 0.48, 0.6, 0.12);
    }
  }

  // --- Soubassement en pierre (rez-de-chaussée) avec bandeau
  const baseMat = MAT.stone.clone(); baseMat.map = stone.map.clone(); baseMat.normalMap = stone.normal.clone(); baseMat.roughnessMap = stone.rough.clone();
  for (const tx of [baseMat.map, baseMat.normalMap, baseMat.roughnessMap]) { tx.repeat.set(depthZ / 5, BASE_H / 5); tx.needsUpdate = true; }
  // teinte de la pierre, propre à chaque immeuble : calcaire, brownstone ou granit gris
  const STONE_TINTS = [[0.74, 0.7, 0.62], [0.56, 0.41, 0.33], [0.6, 0.62, 0.64], [0.68, 0.6, 0.5]];
  const tint = STONE_TINTS[Math.floor(Math.random() * STONE_TINTS.length)], tk = 0.9 + Math.random() * 0.15;
  baseMat.color.setRGB(tint[0] * tk, tint[1] * tk, tint[2] * tk);
  weather(baseMat, { strength: 0.8, frame: ST.frame, warm: ST.warm });
  // pierre photo (tuile de 3 m) : calcaire clair pour la teinte « calcaire », blocs refendus sinon
  usePhoto(baseMat, tint === STONE_TINTS[0] ? 'sandstone_blocks_08' : 'large_sandstone_blocks', depthZ / 3, BASE_H / 3, m => m.color.lerp(PHOTO_WHITE, 0.45));
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(width, BASE_H, depthZ), baseMat)); base.position.set(side * (FACADE_X + width / 2), BASE_H / 2, cz); ST.add(base);
  worldBox(concGeoms, 0.35, 0.3, depthZ + 0.1, faceX + ox * 0.12, BASE_H + 0.15, cz);
  worldBox(plinthGeoms, 0.07, 0.62, depthZ, faceX + ox * 0.035, 0.31, cz);                     // socle en granit au pied du mur
  if (!opts.storefront) buildGroundFloor(side, z0, depthZ, opts.stoop || opts.gradeDoor ? cz + opts.stoopOffset : null);
  snowPad(faceX + ox * 0.12, BASE_H + 0.3, cz, 0.4, depthZ + 0.12, 0.14);

  // --- Corniche à denticules, parapet, neige de toit, édicule, cheminées, descente d'eau
  worldBox(concGeoms, 0.75, 0.22, depthZ + 0.6, faceX + ox * 0.3, height - 0.11, cz);                       // larmier
  worldBox(concGeoms, 0.45, 0.3, depthZ + 0.5, faceX + ox * 0.15, height - 0.5, cz);                        // frise
  for (let z = z0 + 0.25; z < z0 + depthZ; z += 0.55) worldBox(concGeoms, 0.28, 0.2, 0.25, faceX + ox * 0.3, height - 0.35, z);   // denticules
  worldBox(concGeoms, 0.3, 0.9, depthZ, faceX + ox * 0.0 - ox * 0.15, height + 0.45, cz);                     // parapet
  snowPad(faceX - ox * 0.15, height + 0.9, cz, 0.42, depthZ + 0.1, 0.2);
  addPowderCornice(ST.toWorld(new THREE.Vector3(faceX + ox * 0.05, height + 1.0, z0 + 0.4)), ST.toWorld(new THREE.Vector3(faceX + ox * 0.05, height + 1.0, z0 + depthZ - 0.4)));   // le vent la soufflera (fx/powder.js)
  snowPad(side * (FACADE_X + width / 2) + ox * 0.15, height, cz, width - 0.6, depthZ - 0.4, 0.3, 0, 1.2);   // toit : invisible depuis la rue, maillage grossier
  const bulk = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.8), brickMat)); bulk.position.set(side * (FACADE_X + width / 2) + side * 2, height + 1.3, cz + rnd(-2, 2)); ST.add(bulk);
  snowPad(bulk.position.x, height + 2.6, bulk.position.z, 2.5, 2.9, 0.25);
  for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) {
    const ch = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), brickMat)); ch.position.set(side * (FACADE_X + 4 + Math.random() * 6), height + 0.8, z0 + 1 + Math.random() * (depthZ - 2)); ST.add(ch);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.8), MAT.concrete); cap.position.copy(ch.position).y = height + 1.65; ST.add(cap);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height, 8), MAT.iron); pipe.position.set(faceX + ox * 0.1 - ox * RECESS + ox * 0.08, height / 2, z0 + 0.25); ST.add(pipe);
  if (opts.waterTower) {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4, 0.18), MAT.iron); leg.position.set(lx, 2, lz); g.add(leg); }
    for (const [ax, az] of [[0, -1.2], [0, 1.2], [-1.2, 0], [1.2, 0]]) { const br = new THREE.Mesh(new THREE.BoxGeometry(ax ? 0.08 : 2.4, 0.08, az ? 0.08 : 2.4), MAT.iron); br.position.set(ax, 2.2, az); g.add(br); }
    const tank = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.55, 3.4, 20), MAT.wood)); tank.position.y = 5.7; g.add(tank);
    for (const yy of [4.4, 5.7, 7.0]) { const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.03, 6, 24), MAT.iron); hoop.rotation.x = Math.PI / 2; hoop.position.y = yy; g.add(hoop); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.3, 20), MAT.iron); roof.position.y = 8.05; g.add(roof);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.95, 0.5, 20), MAT.snow); cap.position.y = 8.55; g.add(cap);
    g.position.set(side * (FACADE_X + width / 2) + side * 3.5, height, cz + rnd(-2, 2)); ST.add(g);
    addSubject({ label: "Un château d'eau sur les toits", value: 0.75, object: g });
  }

  // --- Rez-de-chaussée : boutique (ouverte ou rideau baissé) ou perron résidentiel
  if (opts.storefront) {
    // Le rez-de-chaussée est commercial d'un pilastre d'angle à l'autre ; au-delà
    // de 9 m on met deux commerces mitoyens, comme sur n'importe quelle avenue.
    const bayW = depthZ - 1.3;
    const first = { open: opts.storefrontLight, awning: opts.awning, isDeli: opts.isDeli, name: opts.shopName, featured: !!opts.shopName };
    if (bayW > 9.2) {
      const w1 = bayW * rnd(0.42, 0.58), w2 = bayW - w1 - 0.6;
      buildStorefront(side, cz - bayW / 2 + w1 / 2, w1, first);
      buildStorefront(side, cz + bayW / 2 - w2 / 2, w2, { open: Math.random() < 0.28, awning: Math.random() < 0.5, isDeli: false });
    } else {
      buildStorefront(side, cz, bayW, first);
    }
  } else if (opts.stoop) {
    buildStoop(side, cz + opts.stoopOffset, depthZ);
  } else if (opts.gradeDoor) {
    // porte de plain-pied (fond de l'impasse : la chaussée arrive au pied de la façade)
    buildEntrance(side, cz + opts.stoopOffset, SIDEWALK_H);
    ST.doorZones.push({ side, z0: cz + opts.stoopOffset - 1.2, z1: cz + opts.stoopOffset + 1.2 });
  }
  if (opts.fireEscape) buildFireEscape(side, cz + opts.escapeOffset, height, BASE_H);
  flushSnowPads(snowStart);
  return { cx: side * (FACADE_X + width / 2), cz, height, depthZ };
}

/** 2e FAÇADE d'un immeuble d'angle, sur son bout (eF = −1 : bout z0, +1 : bout z0 + depthZ),
 *  tournée vers la rue d'à côté. Un mur pignon aveugle de 14 m au coin d'une rue se lisait comme
 *  un décor : on y reprend la trame de la façade principale — allèges et trumeaux en saillie,
 *  fenêtres en retrait (mêmes instances), linteaux, appuis, climatiseurs, neige —, la corniche et
 *  le parapet en retour, le bandeau et le socle, et au rez-de-chaussée des fenêtres d'habitation
 *  grillagées avec leurs soupiraux. Les pièces sont construites dans le repère d'une façade
 *  (x = profondeur vers la rue, z = le long de la façade) puis tournées d'un quart de tour. */
function buildEndFacade(side, eF, z0, depthZ, height, rows, yb, yt, brickGeoms) {
  const width = 14, ox = -side, faceX = side * FACADE_X, outerX = side * (FACADE_X + width);
  const zF = eF < 0 ? z0 : z0 + depthZ, Z = d => zF + eF * d;      // d > 0 : devant la façade, d < 0 : dans le mur
  const xA = faceX - ox * RECESS, W = width - RECESS, xAt = u => xA + side * u;   // u : distance depuis l'angle
  const turn = -eF * Math.PI / 2;
  const qFrame = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, turn, 0));
  const qGlass = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, eF > 0 ? 0 : Math.PI, 0)), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  /** boîte (profondeur, hauteur, longueur) posée à la profondeur d, à la position u le long de la façade */
  const put = (list, geo, d, y, u) => { geo.rotateY(turn); geo.translate(xAt(u), y, Z(d)); list.push(geo); return geo; };
  const box = (list, dd, h, along, d, y, u, scaleU = 5.5) => {
    const g = new THREE.BoxGeometry(dd, h, along), uv = g.attributes.uv, su = Math.max(dd, along) / scaleU, sv = h / scaleU;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return put(list, g, d, y, u);
  };
  const pad = (d, y, u, sx, sz, h) => snowPad(xAt(u), y, Z(d), sx, sz, h, 0, 0.18, Math.PI / 2);
  const win = (u, wy, d, pLit, pShade) => {
    m.compose(new THREE.Vector3(xAt(u), wy, Z(d + 0.04)), qFrame, one); frameInst.push(m.clone());
    m.compose(new THREE.Vector3(xAt(u), wy, Z(d)), qGlass, one);
    const r = Math.random();
    if (r < pLit) litInst[Math.floor(Math.random() * 3)].push(m.clone());
    else if (r < pLit + pShade) shadeInst[Math.floor(Math.random() * 3)].push(m.clone());
    else darkInst.push(m.clone());
  };

  // --- étages : même trame que la façade principale
  const cols = Math.max(2, Math.floor((W - 1.0) / 3.0)), pitch = W / cols, wu = c => (c + 0.5) * pitch;
  let prevTop = BASE_H;
  for (let r = 0; r < rows; r++) { box(brickGeoms, RECESS, yb(r) - prevTop, W, -RECESS / 2, (prevTop + yb(r)) / 2, W / 2); prevTop = yt(r); }
  box(brickGeoms, RECESS, height - prevTop, W, -RECESS / 2, (prevTop + height) / 2, W / 2);
  for (let c = 0; c <= cols; c++) {
    const ua = c === 0 ? 0 : wu(c - 1) + WIN_W / 2, ub = c === cols ? W : wu(c) - WIN_W / 2;
    box(brickGeoms, RECESS, height - BASE_H, ub - ua, -RECESS / 2, BASE_H + (height - BASE_H) / 2, (ua + ub) / 2);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = wu(c);
    win(u, yb(r) + WIN_H / 2, -RECESS + 0.02, 0.26, 0.55 * 0.74);
    box(concGeoms, RECESS + 0.1, 0.24, WIN_W + 0.36, 0.05 - RECESS / 2, yt(r) + 0.12, u);       // linteau
    box(concGeoms, RECESS + 0.2, 0.13, WIN_W + 0.28, 0.1 - RECESS / 2, yb(r) - 0.065, u);       // appui
    pad(0.1 - RECESS / 2, yb(r), u, RECESS + 0.2, WIN_W + 0.24, 0.12);
    pad(0.05 - RECESS / 2, yt(r) + 0.24, u, RECESS + 0.12, WIN_W + 0.3, 0.1);
    if (Math.random() < 0.1) {
      const ac = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.62), MAT.concrete)); ac.rotation.y = turn; ac.position.set(xAt(u), yb(r) + 0.22, Z(0.22)); ST.add(ac);
      pad(0.22, yb(r) + 0.43, u, 0.48, 0.6, 0.12);
    }
  }
  // --- corniche, parapet et bandeau en retour d'angle : chaque pièce va de l'arête AVANT de sa
  // jumelle de la façade principale (u < 0 : au-delà de l'angle) jusqu'au fond de l'immeuble
  const span = (u0, u1) => [u1 - u0, (u0 + u1) / 2];
  const [lL, lC] = span(-(RECESS + 0.675), W + 0.3);
  box(concGeoms, 0.75, 0.22, lL, 0.3, height - 0.11, lC);                     // larmier
  const [fL, fC] = span(-(RECESS + 0.375), W + 0.25);
  box(concGeoms, 0.45, 0.3, fL, 0.15, height - 0.5, fC);                      // frise
  for (let u = 0.25; u < W; u += 0.55) box(concGeoms, 0.28, 0.2, 0.25, 0.3, height - 0.35, u);   // denticules
  const [pL, pC] = span(-RECESS, W);
  box(concGeoms, 0.3, 0.9, pL, -0.15, height + 0.45, pC);                     // parapet
  pad(-0.15, height + 0.9, pC, 0.42, pL, 0.2);
  const [bL, bC] = span(-(RECESS + 0.295), W + 0.05);
  box(concGeoms, 0.35, 0.3, bL, 0.12, BASE_H + 0.15, bC);                     // bandeau au-dessus du soubassement
  pad(0.12, BASE_H + 0.3, bC, 0.4, bL + 0.02, 0.14);
  const [sL, sC] = span(-(RECESS + 0.07), W);
  box(plinthGeoms, 0.07, 0.62, sL, 0.035, 0.31, sC);                          // socle en granit
  // --- rez-de-chaussée d'habitation : fenêtres grillagées, encadrement de pierre, soupiraux
  const sill = SIDEWALK_H + 1.15, wy = sill + WIN_H / 2;
  const n = Math.max(1, Math.floor((width - 1.6) / 2.6)), gp = (width - 1.6) / n;
  const grille = (u, ya, yb2, wdt) => {
    for (let bz = -wdt / 2; bz <= wdt / 2 + 1e-3; bz += 0.11) put(fenceGeoms, new THREE.CylinderGeometry(0.011, 0.011, yb2 - ya, 5), 0.2, (ya + yb2) / 2, u + bz);
    for (const hy of [ya + 0.04, (ya + yb2) / 2, yb2 - 0.04]) put(fenceGeoms, new THREE.BoxGeometry(0.02, 0.035, wdt + 0.04), 0.2, hy, u);
    for (const e of [-1, 1]) put(fenceGeoms, new THREE.BoxGeometry(0.14, 0.03, 0.03), 0.13, yb2 - 0.05, u + e * wdt / 2);
  };
  for (let k = 0; k < n; k++) {
    const u = 0.8 + (k + 0.5) * gp - RECESS;
    win(u, wy, 0.025, 0.3, 0.45);
    for (const e of [-1, 1]) box(concGeoms, 0.14, WIN_H + 0.12, 0.16, 0.07, wy, u + e * (WIN_W / 2 + 0.08));   // piédroits
    box(concGeoms, 0.2, 0.3, WIN_W + 0.56, 0.1, sill + WIN_H + 0.15, u);                                        // linteau
    box(concGeoms, 0.22, 0.12, WIN_W + 0.42, 0.11, sill - 0.06, u);                                             // appui
    pad(0.11, sill, u, 0.22, WIN_W + 0.38, 0.1);
    pad(0.1, sill + WIN_H + 0.3, u, 0.2, WIN_W + 0.5, 0.08);
    grille(u, sill + 0.02, sill + WIN_H - 0.02, WIN_W + 0.1);
    const bw = WIN_W * 0.8, bh = 0.5, by = SIDEWALK_H + 0.42;
    const glass = new THREE.PlaneGeometry(bw, bh); glass.rotateY(eF > 0 ? 0 : Math.PI); glass.translate(xAt(u), by, Z(0.015)); basementGlass.push(glass);
    box(concGeoms, 0.12, 0.1, bw + 0.3, 0.06, by + bh / 2 + 0.05, u);
    box(concGeoms, 0.12, 0.08, bw + 0.3, 0.06, by - bh / 2 - 0.04, u);
    grille(u, by - bh / 2, by + bh / 2, bw);
  }
}

/* ---------------------------------------------------------------------
   Devantures. Une vraie devanture new-yorkaise, c'est de la PROFONDEUR :
   les vitrines sont des caissons en saillie (42 cm) posés sur un soubassement,
   la porte est en retrait entre eux, l'imposte au-dessus, puis le bandeau
   d'enseigne éclairé par des cols de cygne. Rideau à lames dans son caisson
   quand c'est fermé, store à lambrequin, neige sur tout ce qui dépasse.
   Toutes les pièces d'huisserie d'un commerce sont fusionnées en un seul mesh.
   --------------------------------------------------------------------- */
export const PHOTO_WHITE = new THREE.Color(1, 1, 1);
const DOOR_COLORS = [0x2b1a12, 0x14301c, 0x3a1410, 0x101418, 0x1e2a44];
const SHOP_FRAME_COLORS = [0x0f1216, 0x14301c, 0x3a1410, 0x14203a, 0x2a2622];
const AWNING_COLORS = [0x7a2418, 0x1e4a2c, 0x262a34, 0x24407a, 0x8a5a18];
const shopMatCache = new Map();
export function paintMat(color, roughness = 0.5, metalness = 0.25) {
  const k = `${color}/${roughness}/${metalness}`;
  if (!shopMatCache.has(k)) shopMatCache.set(k, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return shopMatCache.get(k);
}
const shopInteriorCache = new Map();
/** Bois peint photo sur un matériau de peinture (une seule fois par matériau, ils sont
 *  partagés via paintMat) : les couleurs sombres (noir) prennent les lames noires, les
 *  autres les lames claires écaillées, MULTIPLIÉES par la couleur du matériau —
 *  vert, bordeaux, bleu marine… restent, avec le grain des lames et les écaillures.
 *  ru / rv : répétition (tuile de 1,6 m, lames verticales). */
export function paintedWood(mat, ru, rv) {
  if (mat.userData.woodPhoto) return;
  mat.userData.woodPhoto = true;
  const dark = mat.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.07 && mat.color.getHSL({ h: 0, s: 0, l: 0 }).s < 0.3;
  usePhoto(mat, dark ? 'black_painted_planks' : 'distressed_painted_planks', ru, rv, m => {
    m.metalness = 0.05;
    if (!dark) m.color.multiplyScalar(4);          // couleurs choisies très sombres (en linéaire) : ×4 pour que la peinture se lise sur la photo claire
  });
}
function shopKind(name) {
  if (/LAUNDROMAT|CLEANERS/.test(name)) return 'laundry';
  if (/PHARMACY|NAILS|CHECK|DISCOUNT|LOCKSMITH|SHOE|TAILOR/.test(name)) return 'bright';
  return 'grocery';
}
let openSignTex = null;
// Autocollants et néons de vitrine : une planche partagée, deux matériaux (papier
// éclairé par l'arrière-boutique / néon lumineux pour le bloom)
let decalAtlas = null, decalPaperMat = null, decalNeonMat = null;
function ensureDecalMats() {
  if (decalAtlas) return;
  decalAtlas = makeWindowDecalAtlas();
  decalPaperMat = new THREE.MeshBasicMaterial({ map: decalAtlas, alphaTest: 0.5, color: new THREE.Color(0.62, 0.6, 0.56) });
  decalNeonMat = new THREE.MeshBasicMaterial({ map: decalAtlas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.4, 2.4, 2.4) });
}
function decalGeo(dec, x, y, z, rotY) {
  const [px, py, pw, ph] = dec.px, g = new THREE.PlaneGeometry(dec.size[0], dec.size[1]), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (px + uv.getX(i) * pw) / 1024, 1 - (py + (1 - uv.getY(i)) * ph) / 512);
  g.rotateY(rotY); g.translate(x, y, z); return g;
}

function buildStorefront(side, zc, w, o) {
  const faceX = side * FACADE_X, ox = -side, rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const fx = d => faceX + ox * d;                       // profondeur d devant la façade
  const D = 0.42;                                       // saillie des caissons de vitrine
  const y0 = SIDEWALK_H, yBulk = y0 + 0.62, yGlass = 2.62, yTrans = 3.18, ySign0 = 3.28, ySign1 = 4.08;
  const name = o.isDeli ? 'DELI GROCERY' : o.name ?? SHOP_NAMES[Math.floor(Math.random() * SHOP_NAMES.length)];
  // o.featured : commerce imposé (bodega, laverie de la rue de gauche) — ouvert, enseigne allumée, vitrine un peu plus vive
  const open = !!o.open, signLit = o.isDeli || (open && (o.featured || Math.random() < 0.6));   // rideau baissé = enseigne éteinte
  const frameMat = paintMat(SHOP_FRAME_COLORS[Math.floor(Math.random() * SHOP_FRAME_COLORS.length)]);
  paintedWood(frameMat, 1, 1);                          // huisseries en bois peint (photo)
  const frame = [], glass = [], iron = [], decalGeoms = { paper: [], neon: [] };
  const box = (list, bw, bh, bd, x, y, z) => { const g = new THREE.BoxGeometry(bw, bh, bd); g.translate(x, y, z); list.push(g); return g; };
  const pane = (list, pw, ph, d, y, z) => { const g = new THREE.PlaneGeometry(pw, ph); g.rotateY(rotY); g.translate(fx(d), y, z); list.push(g); };
  const za = zc - w / 2, zb = zc + w / 2;

  // --- Pilastres en fonte aux deux extrémités : fût, base, chapiteau
  for (const e of [-1, 1]) {
    const z = zc + e * (w / 2 + 0.24);
    box(frame, D + 0.08, ySign1 + 0.15 - y0, 0.46, fx((D + 0.08) / 2), (y0 + ySign1 + 0.15) / 2, z);
    box(frame, D + 0.16, 0.28, 0.56, fx((D + 0.16) / 2), y0 + 0.14, z);
    box(frame, D + 0.16, 0.18, 0.56, fx((D + 0.16) / 2), ySign0 - 0.09, z);
    snowPad(fx((D + 0.12) / 2), ySign0, z, D + 0.12, 0.5, 0.1);
  }

  // --- Porte en retrait : à une extrémité (ou au centre pour le deli)
  const doorW = 1.15, doorEnd = o.isDeli ? 0 : (Math.random() < 0.5 ? -1 : 1);
  const dz0 = doorEnd === 0 ? zc - doorW / 2 : (doorEnd < 0 ? za : zb - doorW), dzm = dz0 + doorW / 2;
  ST.doorZones.push({ side, z0: dz0 - 0.3, z1: dz0 + doorW + 0.3 });  // porte de la boutique
  const segs = [];                                      // segments de vitrine [z1, z2]
  if (dz0 - za > 0.4) segs.push([za, dz0]);
  if (zb - (dz0 + doorW) > 0.4) segs.push([dz0 + doorW, zb]);
  // jambages et plafond du retrait
  for (const z of [dz0 - 0.03, dz0 + doorW + 0.03]) box(frame, D, ySign0 - y0, 0.06, fx(D / 2), (y0 + ySign0) / 2, z);
  box(frame, D, ySign0 - yTrans + 0.02, doorW, fx(D / 2), (yTrans + ySign0) / 2, dzm);
  // seuil, porte vitrée avec barre de poussée, imposte au-dessus de la porte
  worldBox(concGeoms, D, 0.1, doorW, fx(D / 2), y0 + 0.05, dzm);
  snowPad(fx(D * 0.4), y0 + 0.1, dzm, D * 0.7, doorW * 0.9, 0.07);
  box(frame, 0.06, 2.4, doorW, fx(0.06), y0 + 0.1 + 1.2, dzm);
  box(frame, 0.1, 2.4, 0.1, fx(0.1), y0 + 1.3, dz0 + 0.06); box(frame, 0.1, 2.4, 0.1, fx(0.1), y0 + 1.3, dz0 + doorW - 0.06);
  box(frame, 0.1, 0.1, doorW, fx(0.1), y0 + 2.45, dzm);
  box(frame, 0.05, 0.05, doorW - 0.3, fx(0.14), y0 + 1.1, dzm);
  pane(glass, doorW - 0.3, 1.7, 0.1, y0 + 1.55, dzm);
  if (open && Math.random() < 0.7) {
    ensureDecalMats();
    // la clé est tirée UNE fois : un Math.random() dans le prédicat de find() était
    // retiré à chaque élément et pouvait ne rien trouver (plantage au chargement)
    const key = Math.random() < 0.5 ? 'cards' : 'atm', dec = DECALS.find(d => d.key === key);
    decalGeoms.paper.push(decalGeo(dec, fx(0.085), y0 + 1.5, dzm + (Math.random() - 0.5) * 0.3, rotY));
  }
  pane(glass, doorW - 0.1, yTrans - (y0 + 2.5) - 0.1, 0.05, (y0 + 2.5 + yTrans) / 2, dzm);

  // --- Caissons de vitrine
  for (const [z1, z2] of segs) {
    const L = z2 - z1, zm = (z1 + z2) / 2;
    worldBox(concGeoms, D, yBulk - y0, L, fx(D / 2), (y0 + yBulk) / 2, zm);              // soubassement en pierre grise, se détache de l'huisserie sombre
    box(frame, D + 0.06, 0.06, L + 0.04, fx((D + 0.06) / 2), yBulk + 0.03, zm);          // appui saillant
    snowPad(fx((D + 0.04) / 2 + 0.02), yBulk + 0.06, zm, D + 0.04, L, 0.09);             // neige sur l'appui
    box(frame, 0.08, 0.1, L, fx(D - 0.04), yGlass + 0.05, zm);                            // traverse haute
    box(frame, 0.08, 0.1, L, fx(D - 0.04), yTrans + 0.05, zm);                            // traverse d'imposte
    const n = Math.max(1, Math.round(L / 1.25));                                          // meneaux
    for (let k = 0; k <= n; k++) box(frame, 0.08, yTrans - yBulk, k === 0 || k === n ? 0.1 : 0.07, fx(D - 0.04), (yBulk + yTrans) / 2, z1 + (k / n) * L);
    const nt = Math.max(2, Math.round(L / 0.6));                                          // petits-bois de l'imposte
    for (let k = 1; k < nt; k++) box(frame, 0.06, yTrans - yGlass, 0.04, fx(D - 0.04), (yGlass + yTrans) / 2, z1 + (k / nt) * L);
    pane(glass, L - 0.1, yGlass - yBulk - 0.1, D - 0.02, (yBulk + yGlass) / 2, zm);
    pane(glass, L - 0.1, yTrans - yGlass - 0.12, D - 0.02, (yGlass + yTrans) / 2, zm);

    if (open) {
      // intérieur : texture de boutique derrière la vitre, imposte allumée
      const kind = shopKind(name);
      if (!shopInteriorCache.has(kind)) shopInteriorCache.set(kind, makeShopInteriorTexture(kind));
      // pièce en fausse 3D derrière la vitre (voir shopInterior.js) : sol, plafond à néons, murs, gondole
      const imat = makeInteriorMaterial(null, kind, L - 0.12, yGlass - yBulk, yBulk - y0);
      imat.uniforms.uWall.value = shopInteriorCache.get(kind);          // après le merge : pas de copie de texture
      if (!o.isDeli) imat.uniforms.uBright.value = o.featured ? 0.72 : 0.55;                 // le deli reste la vitrine la plus lumineuse
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.12, yGlass - yBulk), imat);
      inner.position.set(fx(0.05), (yBulk + yGlass) / 2, zm); inner.rotation.y = rotY; ST.add(inner);
      // autocollants en bas de vitrine (1 à 3), plus rarement un néon en hauteur
      ensureDecalMats();
      const papers = DECALS.filter(d => !d.neon), neons = DECALS.filter(d => d.neon);
      let zc2 = z1 + 0.3;
      for (let k = 0, n = 1 + Math.floor(Math.random() * 3); k < n; k++) {
        const dec = papers[Math.floor(Math.random() * papers.length)];
        if (zc2 + dec.size[0] > z2 - 0.3) break;
        const y = Math.min(yGlass - 0.1 - dec.size[1] / 2, yBulk + 0.12 + dec.size[1] / 2 + Math.random() * 0.25);
        decalGeoms.paper.push(decalGeo(dec, fx(D - 0.035), y, zc2 + dec.size[0] / 2, rotY));
        zc2 += dec.size[0] + 0.1 + Math.random() * 0.5;
      }
      if (Math.random() < 0.55 && L > 1.6) {
        const dec = neons[Math.floor(Math.random() * neons.length)];
        const z = z1 + 0.35 + dec.size[0] / 2 + Math.random() * Math.max(0, L - 0.7 - dec.size[0]);
        decalGeoms.neon.push(decalGeo(dec, fx(D - 0.045), yGlass - 0.3 - dec.size[1] / 2, z, rotY));
      }
      const trans = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.12, yTrans - yGlass - 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.72, 0.5).multiplyScalar(o.isDeli ? 1 : o.featured ? 0.8 : 0.6) }));
      trans.position.set(fx(0.04), (yGlass + yTrans) / 2, zm); trans.rotation.y = rotY; ST.add(trans);
    } else {
      // rideau à lames dans ses coulisses, cadenas au pied
      const H = yTrans - 0.3 - (y0 + 0.02), yc = (y0 + 0.02 + yTrans - 0.3) / 2;
      const m = MAT.shutter.clone(); m.map = shutterTex.clone(); m.map.repeat.set(L / 2.4, H / 2.7); m.map.needsUpdate = true;
      usePhoto(m, 'painted_metal_shutter', L / 2, H / 2, mm => { mm.metalness = 0.35; });        // photo : tuile de 2 m
      const sh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.06, H, L - 0.12), m)); sh.position.set(fx(D - 0.08), yc, zm); ST.add(sh);
      for (const z of [z1 + 0.04, z2 - 0.04]) box(frame, 0.1, H, 0.08, fx(D - 0.06), yc, z);
      box(iron, 0.05, 0.08, L * 0.5, fx(D - 0.02), y0 + 0.42, zm);
      box(iron, 0.06, 0.14, 0.1, fx(D - 0.0), y0 + 0.36, zm);
    }
  }
  if (!open) {
    // caisson d'enroulement sur toute la largeur + rideau du retrait de porte
    box(frame, 0.34, 0.32, w + 0.1, fx(D - 0.12), yTrans - 0.14, zc);
    snowPad(fx(D - 0.1), yTrans + 0.02, zc, 0.3, w + 0.06, 0.12);
    const H = 2.4, m = MAT.shutter.clone(); m.map = shutterTex.clone(); m.map.repeat.set(doorW / 2.4, H / 2.7); m.map.needsUpdate = true;
    usePhoto(m, 'painted_metal_shutter', doorW / 2, H / 2, mm => { mm.metalness = 0.35; });
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, doorW - 0.1), m); sh.position.set(fx(0.16), y0 + 0.12 + H / 2, dzm); ST.add(sh);
  } else {
    // néon OPEN dans la vitrine la plus proche de la porte, lumière intérieure
    const seg = segs[doorEnd < 0 ? 0 : segs.length - 1];
    if (seg) {
      openSignTex = openSignTex || makeOpenSignTexture();
      const os = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: openSignTex, color: new THREE.Color().setScalar(o.isDeli ? 1.8 : 1.1) }));
      os.position.set(fx(D - 0.07), 2.05, doorEnd < 0 ? seg[1] - 0.5 : seg[0] + 0.5); os.rotation.y = rotY; ST.add(os);
    }
    addPointSource({ pos: ST.toWorld(new THREE.Vector3(fx(1.1), 2.5, zc)), color: new THREE.Color(0xffc98a), intensity: 7, distance: 9 });
    // climatiseur planté dans l'imposte, une fois sur deux
    if (Math.random() < 0.5) {
      const ac = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), MAT.concrete)); ac.position.set(fx(0.3), yGlass + 0.28, dzm + (doorEnd < 0 ? 1.6 : -1.6)); ST.add(ac);
      snowPad(fx(0.3), yGlass + 0.48, dzm + (doorEnd < 0 ? 1.6 : -1.6), 0.46, 0.56, 0.11);
    }
  }

  // --- Bandeau d'enseigne : caisson textué en façade, flancs peints, neige dessus
  const signMats = new Array(6).fill(frameMat);
  // enseigne éteinte : matériau ÉCLAIRÉ par la rue (elle n'apparaît que sous un lampadaire), plus
  // un panneau lumineux à 70 % qui brillait dans le noir ; allumée : nettement sous le deli
  signMats[side < 0 ? 0 : 1] = signLit
    ? new THREE.MeshBasicMaterial({ map: makeSignTexture(name, true), color: new THREE.Color().setScalar(o.isDeli ? 1.25 : 0.5) })
    : new THREE.MeshStandardMaterial({ map: makeSignTexture(name, false), roughness: 0.6, metalness: 0 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(D + 0.12, ySign1 - ySign0, w + 0.1), signMats);
  sign.position.set(fx((D + 0.12) / 2), (ySign0 + ySign1) / 2, zc); ST.add(sign);
  snowPad(fx((D + 0.16) / 2), ySign1, zc, D + 0.16, w + 0.14, 0.16);
  if (signLit) {
    // cols de cygne : bras, réflecteur, ampoule visible ; une lumière pour l'ensemble
    const n = Math.max(2, Math.round(w / 2.6));
    for (let k = 0; k < n; k++) {
      const z = za + (k + 0.5) * (w / n), reach = D + 0.5;
      box(iron, reach - D + 0.1, 0.03, 0.03, fx((D + reach) / 2), ySign1 + 0.32, z);
      box(iron, 0.03, 0.3, 0.03, fx(reach), ySign1 + 0.17, z);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.14, 12), MAT.metal); cone.position.set(fx(reach), ySign1 + 0.06, z); ST.add(cone);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.0, 1.2) })); bulb.position.set(fx(reach), ySign1 - 0.02, z); ST.add(bulb);
    }
    addPointSource({ pos: ST.toWorld(new THREE.Vector3(fx(D + 0.6), ySign1 - 0.2, zc)), color: new THREE.Color(0xffe2b0), intensity: 4, distance: 7 });
  }

  // --- Store à lambrequin sous l'enseigne, incliné vers la rue, neige dessus
  if (o.awning) {
    const awColor = AWNING_COLORS[Math.floor(Math.random() * AWNING_COLORS.length)];
    const aw = paintMat(awColor, 0.92, 0);
    // toile : unie, ou rayée une fois sur trois (bandes perpendiculaires à la façade)
    let awTop = aw;
    if (Math.random() < 0.35) { const t = makeStripeTexture(awColor); t.repeat.set(1, (w + 0.2) / 0.6); awTop = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }); }
    // lambrequin imprimé : nom du commerce + téléphone, côté rue seulement
    const valMats = new Array(6).fill(aw);
    valMats[side < 0 ? 0 : 1] = new THREE.MeshStandardMaterial({ map: makeValanceTexture(name, awColor), roughness: 0.9 });
    const reach = 1.45, drop = 0.42, ang = Math.atan2(drop, reach), rz = side * ang;
    const mkSlope = (bw, bh, bd, dy) => { const g = new THREE.BoxGeometry(bw, bh, bd); g.rotateZ(rz); g.translate(fx(D + 0.05 + reach / 2), ySign0 - 0.04 - drop / 2 + dy, zc); return g; };
    const canvas = shadowed(new THREE.Mesh(mkSlope(reach, 0.05, w + 0.2, 0), awTop)); ST.add(canvas);
    const valance = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, w + 0.2), valMats); valance.position.set(fx(D + 0.05 + reach), ySign0 - 0.04 - drop - 0.13, zc); ST.add(valance);
    // passepoil clair au bas du lambrequin : c'est lui qu'on lit de nuit, la toile elle-même reste sombre
    const piping = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, w + 0.22), paintMat(0xd8d0c0, 0.8, 0)); piping.position.set(fx(D + 0.05 + reach), ySign0 - 0.04 - drop - 0.28, zc); ST.add(piping);
    for (let k = 0; k <= 2; k++) iron.push((() => { const g = new THREE.BoxGeometry(reach, 0.03, 0.03); g.rotateZ(rz); g.translate(fx(D + 0.05 + reach / 2), ySign0 - 0.08 - drop / 2, za + k * (w / 2)); return g; })());
    snowPad(fx(D + 0.05 + reach / 2), ySign0 - 0.04 - drop / 2 + 0.025, zc, reach - 0.1, w + 0.2, 0.18, rz);   // inclinée comme la toile
  }

  // --- Congère au pied de la devanture, poussée contre le soubassement
  {
    const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(0.38, 0.2 + Math.random() * 0.14, w / 2 * 0.92); g.translate(fx(D + 0.12), y0, zc); snowGeoms.push(g);
  }

  ST.add(shadowed(new THREE.Mesh(mergeGeometries(frame), frameMat)));
  ST.add(new THREE.Mesh(mergeGeometries(glass), MAT.storeGlass));
  if (iron.length) ST.add(new THREE.Mesh(mergeGeometries(iron), MAT.iron));
  if (decalGeoms.paper.length) ST.add(new THREE.Mesh(mergeGeometries(decalGeoms.paper), decalPaperMat));
  if (decalGeoms.neon.length) ST.add(new THREE.Mesh(mergeGeometries(decalGeoms.neon), decalNeonMat));
  ST.collider(fx((D + 0.1) / 2), zc, (D + 0.1) / 2, w / 2 + 0.5);
  const sbx = [faceX, fx(D + 0.6)];
  addSubject({
    label: o.isDeli ? 'La devanture du deli' : open ? `La vitrine « ${name} »` : 'Un rideau de fer baissé',
    value: o.isDeli ? 0.85 : open ? 0.6 : 0.35, glows: open,
    box: ST.box(new THREE.Box3(new THREE.Vector3(Math.min(...sbx), y0, za - 0.3), new THREE.Vector3(Math.max(...sbx), ySign1 + 0.4, zb + 0.3))),
  });
}

/** Rez-de-chaussée d'un immeuble d'HABITATION. Sans ça, le soubassement était un mur
 *  de pierre aveugle de 4,4 m : aucun immeuble new-yorkais n'est fait comme ça. On y
 *  met l'étage « parloir » (fenêtres à hauteur de perron, encadrées de pierre, avec
 *  leurs grilles de sécurité en fer) et, au ras du trottoir, les soupiraux grillagés
 *  du sous-sol. Les vitres réutilisent les instances des étages (cadres, intérieurs
 *  allumés, stores, vitres sombres). `doorZ` : axe du perron à éviter (ou null). */
function buildGroundFloor(side, z0, depthZ, doorZ) {
  const faceX = side * FACADE_X, ox = -side, X = d => faceX + ox * d;
  const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), qId = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  const sill = SIDEWALK_H + 1.15, wy = sill + WIN_H / 2;
  const n = Math.max(1, Math.floor((depthZ - 1.6) / 2.6)), pitch = (depthZ - 1.6) / n;
  const grille = (zc, yb, yt, wdt) => {                                 // grille : cadre, barreaux, trois traverses plates
    for (let bz = -wdt / 2; bz <= wdt / 2 + 1e-3; bz += 0.11) { const g = new THREE.CylinderGeometry(0.011, 0.011, yt - yb, 5); g.translate(X(0.2), (yb + yt) / 2, zc + bz); fenceGeoms.push(g); }
    for (const hy of [yb + 0.04, (yb + yt) / 2, yt - 0.04]) { const g = new THREE.BoxGeometry(0.02, 0.035, wdt + 0.04); g.translate(X(0.2), hy, zc); fenceGeoms.push(g); }
    for (const e of [-1, 1]) { const g = new THREE.BoxGeometry(0.14, 0.03, 0.03); g.translate(X(0.13), yt - 0.05, zc + e * wdt / 2); fenceGeoms.push(g); }   // pattes de scellement
  };
  for (let k = 0; k < n; k++) {
    const z = z0 + 0.8 + (k + 0.5) * pitch;
    if (doorZ !== null && Math.abs(z - doorZ) < 2.1) continue;          // le perron et la porte
    // fenêtre : cadre + vitre (mêmes instances que les étages), encadrement de pierre en saillie
    m.compose(new THREE.Vector3(X(0.06), wy, z), qId, one); frameInst.push(m.clone());
    m.compose(new THREE.Vector3(X(0.025), wy, z), q, one);
    const r = Math.random();
    if (r < 0.3) litInst[Math.floor(Math.random() * 3)].push(m.clone());
    else if (r < 0.75) shadeInst[Math.floor(Math.random() * 3)].push(m.clone());
    else darkInst.push(m.clone());
    for (const e of [-1, 1]) worldBox(concGeoms, 0.14, WIN_H + 0.12, 0.16, X(0.07), wy, z + e * (WIN_W / 2 + 0.08));   // piédroits
    worldBox(concGeoms, 0.2, 0.3, WIN_W + 0.56, X(0.1), sill + WIN_H + 0.15, z);                                        // linteau
    worldBox(concGeoms, 0.22, 0.12, WIN_W + 0.42, X(0.11), sill - 0.06, z);                                             // appui
    snowPad(X(0.11), sill, z, 0.22, WIN_W + 0.38, 0.1);
    snowPad(X(0.1), sill + WIN_H + 0.3, z, 0.2, WIN_W + 0.5, 0.08);
    grille(z, sill + 0.02, sill + WIN_H - 0.02, WIN_W + 0.1);
    // soupirail du sous-sol, au ras du trottoir, derrière sa grille
    const bw = WIN_W * 0.8, bh = 0.5, by = SIDEWALK_H + 0.42;
    const glass = new THREE.PlaneGeometry(bw, bh); glass.rotateY(rotY); glass.translate(X(0.015), by, z); basementGlass.push(glass);
    worldBox(concGeoms, 0.12, 0.1, bw + 0.3, X(0.06), by + bh / 2 + 0.05, z);
    worldBox(concGeoms, 0.12, 0.08, bw + 0.3, X(0.06), by - bh / 2 - 0.04, z);
    grille(z, by - bh / 2, by + bh / 2, bw);
  }
}

// Portes d'immeuble : textures de vantail (bois verni ou peint, voir textures/door.js),
// créées une fois ; matériaux partagés par teinte ; laiton et verre de hall partagés.
const doorTex = {}, doorMats = new Map();
let hallGlassMat = null, brassMat = null;
const WOOD_TINTS = [0xffffff, 0xe0c8b0, 0xa88a74];            // chêne clair, teinte miel, noyer
export function doorMaterial() {
  const wood = Math.random() < 0.5;
  const kind = wood ? 'wood' : 'paint', color = wood ? WOOD_TINTS[Math.floor(Math.random() * WOOD_TINTS.length)] : DOOR_COLORS[Math.floor(Math.random() * DOOR_COLORS.length)];
  const key = kind + color;
  if (!doorMats.has(key)) {
    doorTex[kind] = doorTex[kind] || makeDoorLeafTextures(kind);
    const t = doorTex[kind], m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, metalness: 0, color });
    if (!wood) m.color.multiplyScalar(4);                     // couleurs très sombres en linéaire : la sous-couche grise les multiplie
    doorMats.set(key, m);
  }
  return doorMats.get(key);
}
/** UV d'une pièce d'huisserie ramenées sur un bout de montant (sinon toute la porte y serait écrasée). */
export function stileUV(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02 + uv.getX(i) * 0.1, 0.35 + uv.getY(i) * 0.3); return g; }

/** Verre de hall éclairé et laiton, partagés par toutes les portes (créés au premier besoin). */
export function entranceMats() {
  if (!hallGlassMat) {
    hallGlassMat = new THREE.MeshBasicMaterial({ map: makeHallGlassTexture(), color: new THREE.Color(0.78, 0.62, 0.46) });   // hall éclairé derrière le verre dépoli
    brassMat = new THREE.MeshStandardMaterial({ color: 0xb58d45, metalness: 1, roughness: 0.32 });
  }
  return { hallGlassMat, brassMat };
}

/** Entrée de perron : encadrement de pierre (piédroits, corniche sur consoles), imposte
 *  éclairée au numéro doré, double porte à panneaux moulurés (texture de vantail entière,
 *  relief en normal map), vitres de hall dépolies derrière une grille en fer forgé,
 *  quincaillerie en laiton, chambranle et battement central, lanterne murale.
 *  `o.faceX` : plan de la façade (brownstones : reculé derrière la cour) ; `o.trim` : liste où
 *  verser l'encadrement de pierre (par défaut la pierre reconstituée claire ; brownstones : leur grès) ;
 *  `o.lanternSide` : côté de la lanterne murale le long de la façade (±1, +1 par défaut). */
export function buildEntrance(side, z, yDoor, o = {}) {
  const faceX = o.faceX ?? side * FACADE_X, ox = -side, X = d => faceX + ox * d, rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const trim = o.trim ?? concGeoms;
  const DW = 1.3, DH = 2.35, frame = [], door = [], lit = [];
  const box = (list, sx, sy, sz, x, y, zz) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, zz); list.push(g); };
  // encadrement : l'embrasure paraît profonde parce que la pierre avance tout autour
  for (const e of [-1, 1]) {
    worldBox(trim, 0.26, DH + 0.7, 0.3, X(0.13), yDoor + (DH + 0.7) / 2, z + e * (DW / 2 + 0.15));     // piédroits
    worldBox(trim, 0.34, 0.26, 0.2, X(0.2), yDoor + DH + 0.72, z + e * (DW / 2 + 0.2));                 // consoles
  }
  worldBox(trim, 0.28, 0.14, DW + 0.6, X(0.14), yDoor + DH + 0.62, z);                                    // linteau
  worldBox(trim, 0.42, 0.14, DW + 1.0, X(0.21), yDoor + DH + 0.92, z);                                    // corniche
  snowPad(X(0.21), yDoor + DH + 0.99, z, 0.42, DW + 0.96, 0.14);
  entranceMats();
  const brass = [];
  // imposte : une seule vitre, le numéro de l'immeuble à la feuille d'or (pairs à gauche, impairs à droite)
  const num = 2 * Math.floor(rnd(40, 240)) + (side > 0 ? 1 : 0);
  const tr = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.06, 0.5), new THREE.MeshBasicMaterial({ map: makeTransomTexture(num), color: hallGlassMat.color }));
  tr.rotation.y = rotY; tr.position.set(X(0.035), yDoor + DH + 0.3, z); ST.add(tr);
  addSubject({ label: `Une porte de brownstone, n° ${num}`, value: 0.6, glows: true, box: ST.box(boxAt(X(0.3), z, 0.3, DW / 2 + 0.45, yDoor - 0.9, yDoor + DH + 1.1)) });
  box(door, 0.07, 0.07, DW, X(0.05), yDoor + DH + 0.035, z); stileUV(door[door.length - 1]);                   // traverse d'imposte
  // chambranle : montants et linteau en bois autour de la baie
  for (const e of [-1, 1]) { box(door, 0.1, DH + 0.6, 0.07, X(0.05), yDoor + (DH + 0.6) / 2, z + e * (DW / 2 + 0.01)); stileUV(door[door.length - 1]); }
  box(door, 0.1, 0.08, DW + 0.1, X(0.05), yDoor + DH + 0.6, z); stileUV(door[door.length - 1]);
  // double porte : chaque vantail porte la texture ENTIÈRE sur ses faces avant/arrière (montants,
  // panneau surélevé, moulure de vitre, patine près de la poignée : retournée pour tomber côté battement)
  for (const e of [-1, 1]) {
    const zc = z + e * DW / 4, lw = DW / 2 - 0.02;
    const leaf = new THREE.BoxGeometry(0.06, DH, lw);
    if (side * e > 0) { const uv = leaf.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    leaf.translate(X(0.03), yDoor + DH / 2, zc); door.push(leaf);
    const gl = new THREE.PlaneGeometry(lw - 0.2, 1.1); gl.rotateY(rotY); gl.translate(X(0.062), yDoor + 1.45, zc); lit.push(gl);
    // grille en fer forgé devant la vitre : barreaux, deux traverses, anneau central
    for (let k = 1; k < 5; k++) { const g = new THREE.BoxGeometry(0.014, 1.08, 0.014); g.translate(X(0.085), yDoor + 1.45, zc - (lw - 0.2) / 2 + k * (lw - 0.2) / 5); fenceGeoms.push(g); }
    for (const hy of [1.02, 1.88]) { const g = new THREE.BoxGeometry(0.016, 0.02, lw - 0.2); g.translate(X(0.085), yDoor + hy, zc); fenceGeoms.push(g); }
    const ring = new THREE.TorusGeometry(0.075, 0.009, 6, 18); ring.rotateY(Math.PI / 2); ring.translate(X(0.088), yDoor + 1.45, zc); fenceGeoms.push(ring);
    // laiton : bouton sur rosace, et une fois sur deux une plaque de propreté en bas
    const knob = new THREE.SphereGeometry(0.03, 10, 8); knob.translate(X(0.11), yDoor + 1.05, z + e * 0.1); brass.push(knob);
    const rose = new THREE.BoxGeometry(0.012, 0.2, 0.055); rose.translate(X(0.066), yDoor + 1.02, z + e * 0.1); brass.push(rose);
    if (num % 4 < 2) { const kick = new THREE.BoxGeometry(0.006, 0.22, lw - 0.06); kick.translate(X(0.063), yDoor + 0.13, zc); brass.push(kick); }
  }
  const slot = new THREE.BoxGeometry(0.012, 0.05, 0.28); slot.translate(X(0.066), yDoor + 0.78, z - DW / 4); brass.push(slot);   // fente à courrier
  box(door, 0.08, DH, 0.045, X(0.07), yDoor + DH / 2, z); stileUV(door[door.length - 1]);                     // battement central
  ST.add(shadowed(new THREE.Mesh(mergeGeometries(door), doorMaterial())));
  ST.add(new THREE.Mesh(mergeGeometries(lit), hallGlassMat));
  ST.add(new THREE.Mesh(mergeGeometries(brass), brassMat));
  // lanterne murale sur potence, à côté de la porte
  const lz = z + (o.lanternSide ?? 1) * (DW / 2 + 0.55), ly = yDoor + DH + 0.25;   // côté de la lanterne : loin du voisin (perrons appariés)
  const arm = new THREE.BoxGeometry(0.28, 0.03, 0.03); arm.translate(X(0.14), ly + 0.25, lz); fenceGeoms.push(arm);
  const cage = new THREE.CylinderGeometry(0.09, 0.07, 0.3, 6, 1, true); cage.translate(X(0.28), ly + 0.05, lz); fenceGeoms.push(cage);
  const cap = new THREE.ConeGeometry(0.12, 0.1, 6); cap.translate(X(0.28), ly + 0.25, lz); fenceGeoms.push(cap);
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.26, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.8) }));
  bulb.position.set(X(0.28), ly + 0.05, lz); ST.add(bulb);
  // la lumière part d'entre la lanterne et la porte, un peu devant : posée à la lanterne, elle
  // arrivait en rasant sur les vantaux au fond de l'embrasure et la porte restait noire
  addPointSource({ pos: ST.toWorld(new THREE.Vector3(X(0.85), yDoor + DH - 0.1, z + (o.lanternSide ?? 1) * 0.45)), color: new THREE.Color(0xffc27a), intensity: 5, distance: 6 });
}

/** Perron de brownstone + clôture en fer forgé (comme la zone grillagée de l'image). */
function buildStoop(side, z, depthZ) {
  const faceX = side * FACADE_X, ox = -side;
  const stepGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const w = 0.27, h = 0.18 * (i + 1), x = faceX + ox * (0.135 + (steps - 1 - i) * w);
    const s = shadowed(new THREE.Mesh(stepGeo(w, h, 2.2), MAT.stone)); s.position.set(x, SIDEWALK_H + h / 2, z); ST.add(s);
    snowPad(x, SIDEWALK_H + h, z, w, 2.2, 0.1);
  }
  buildEntrance(side, z, SIDEWALK_H + 0.18 * steps);
  ST.collider(faceX + ox * 0.7, z, 0.72, 1.15);
  ST.doorZones.push({ side, z0: z - 1.7, z1: z + 1.7 });            // marches + ouverture de la clôture

  // clôture : lisse haute/basse + barreaux, le long de la façade, avec ouverture au perron
  const fx = faceX + ox * 1.6, half = Math.min(depthZ / 2 - 0.5, 6.5);
  const mk = (geo, x, y, zz) => { geo.translate(x, y, zz); fenceGeoms.push(geo); };
  for (const [za, zb] of [[z - half, z - 1.7], [z + 1.7, z + half]]) {
    const L = zb - za; if (L < 0.4) continue;
    const zm = (za + zb) / 2;
    mk(new THREE.BoxGeometry(0.05, 0.05, L), fx, SIDEWALK_H + 1.05, zm);
    mk(new THREE.BoxGeometry(0.05, 0.05, L), fx, SIDEWALK_H + 0.25, zm);
    snowPad(fx, SIDEWALK_H + 1.075, zm, 0.08, L, 0.06, 0, 0.3);                  // neige sur la lisse haute
    for (let p = za; p <= zb; p += 0.16) mk(new THREE.CylinderGeometry(0.015, 0.015, 1.15, 5), fx, SIDEWALK_H + 0.6, p);
    for (let p = za; p <= zb + 0.01; p += Math.max(L / 3, 1.5)) mk(new THREE.BoxGeometry(0.08, 1.3, 0.08), fx, SIDEWALK_H + 0.65, Math.min(p, zb));
    ST.collider(fx, zm, 0.1, L / 2);
  }
  // retours de clôture vers la façade
  for (const e of [-1, 1]) {
    mk(new THREE.BoxGeometry(1.6, 0.05, 0.05), faceX + ox * 0.8, SIDEWALK_H + 1.05, z + e * half);
    snowPad(faceX + ox * 0.8, SIDEWALK_H + 1.075, z + e * half, 1.6, 0.08, 0.06, 0, 0.3);
    for (let p = 0; p <= 1.6; p += 0.16) mk(new THREE.CylinderGeometry(0.015, 0.015, 1.15, 5), faceX + ox * p, SIDEWALK_H + 0.6, z + e * half);
    ST.collider(faceX + ox * 0.8, z + e * half, 0.8, 0.1);
  }
}

/** Escalier de secours new-yorkais. Ce qui le rend reconnaissable, et que l'ancienne
 *  version n'avait pas : des paliers en BARREAUX (on voit à travers, la neige tient
 *  sur chaque barreau et tombe dans les fentes — l'ancien coussin de neige d'un seul
 *  tenant se lisait comme une dalle blanche vue d'en dessous), de vraies volées de
 *  marches à claire-voie avec limons et main courante (et non des échelles), des
 *  consoles en diagonale qui portent chaque palier contre le mur, un garde-corps à
 *  trois lisses, et l'échelle basse coulissante avec son contrepoids.
 *  Tout est fusionné en un seul mesh (peinture noire écaillée et rouillée) ; les
 *  coulures de rouille qu'il laisse sur la brique sont dans weathering.js. */
function escapeFloors(height, baseH) { return Math.floor((height - baseH - 1) / 3.2); }
function buildFireEscape(side, z, height, baseH) {
  const faceX = side * FACADE_X, ox = -side, depth = 1.15, w = 3.4;
  const floors = escapeFloors(height, baseH);
  const X = d => faceX + ox * d;                          // d : distance à la façade, vers la rue
  const put = (geo, x, y, zz) => { geo.translate(x, y, zz); escGeoms.push(geo); return geo; };
  const bar = (sx, sy, sz, x, y, zz) => put(new THREE.BoxGeometry(sx, sy, sz), x, y, zz);
  const rod = (len, x, y, zz) => put(new THREE.CylinderGeometry(0.013, 0.013, len, 5), x, y, zz);
  /** barre entre deux points (plan vertical), section s × s */
  const strut = (x1, y1, z1, x2, y2, z2, s = 0.05) => {
    const d = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1), len = d.length();
    const g = new THREE.BoxGeometry(s, len, s);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
    return put(g, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  };

  for (let f = 0; f < floors; f++) {
    const y = baseH + 1.0 + 3.2 * f;
    // --- palier : cadre en cornière + barreaux parallèles à la façade
    bar(depth, 0.1, 0.06, X(depth / 2), y - 0.03, z - w / 2); bar(depth, 0.1, 0.06, X(depth / 2), y - 0.03, z + w / 2);
    bar(0.06, 0.1, w, X(depth), y - 0.03, z); bar(0.06, 0.06, w, X(0.04), y - 0.02, z);
    const nb = 14;
    for (let k = 0; k < nb; k++) {
      const d = 0.08 + k * (depth - 0.14) / (nb - 1);
      bar(0.035, 0.03, w - 0.04, X(d), y, z);
      // la neige tient sur chaque barreau, un peu plus épaisse près du mur (abrité du vent)
      snowPad(X(d), y + 0.015, z, 0.055, w * 0.96, 0.03 + 0.03 * (1 - k / nb), 0, 0.3);
    }
    snowPad(X(0.16), y + 0.02, z, 0.3, w * 0.9, 0.14, 0, 0.3);            // congère contre le mur
    // --- consoles : une diagonale sous chaque extrémité, ancrée dans la brique
    for (const e of [-1, 1]) strut(X(0.02), y - 0.95, z + e * (w / 2 - 0.05), X(depth - 0.06), y - 0.06, z + e * (w / 2 - 0.05));
    // --- garde-corps : lisses basse, médiane et haute, barreaux, poteaux d'angle
    for (const hy of [0.12, 0.55, 1.0]) {
      bar(0.045, hy === 1.0 ? 0.05 : 0.025, w, X(depth), y + hy, z);
      for (const e of [-1, 1]) bar(depth, hy === 1.0 ? 0.05 : 0.025, 0.045, X(depth / 2), y + hy, z + e * w / 2);
    }
    for (let k = 1; k < 12; k++) rod(0.9, X(depth), y + 0.55, z - w / 2 + k * (w / 12));
    for (const e of [-1, 1]) {
      bar(0.06, 1.05, 0.06, X(depth), y + 0.5, z + e * w / 2);
      for (let k = 1; k <= 3; k++) rod(0.9, X(k * depth / 4), y + 0.55, z + e * w / 2);
      snowPad(X(depth / 2), y + 1.025, z + e * w / 2, depth, 0.06, 0.04, 0, 0.3);
    }
    snowPad(X(depth), y + 1.025, z, 0.06, w, 0.045, 0, 0.3);              // neige sur la lisse haute
    // --- volée de marches vers le palier supérieur : limons, marches à claire-voie, main courante
    if (f < floors - 1) {
      const dir = f % 2 ? 1 : -1, xs = depth - 0.42, za = z + dir * 0.12, zb = z + dir * 1.62;
      for (const off of [-0.26, 0.26]) strut(X(xs + off), y, za, X(xs + off), y + 3.2, zb, 0.045);
      strut(X(xs + 0.3), y + 0.9, za, X(xs + 0.3), y + 4.1, zb, 0.035);   // main courante côté rue
      const nSteps = 11;
      for (let s = 0; s < nSteps; s++) {
        const t = (s + 0.5) / nSteps, ty = y + t * 3.2, tz = za + (zb - za) * t;
        for (const dz of [-0.05, 0, 0.05]) bar(0.5, 0.02, 0.03, X(xs), ty, tz + dz * dir);   // marche en trois plats
        snowPad(X(xs), ty + 0.01, tz, 0.46, 0.14, 0.05, 0, 0.3);
      }
    }
  }
  // --- échelle basse coulissante, relevée sous le premier palier, et son contrepoids
  const lx = 0.95, lz = z + 1.3;
  for (const off of [-0.22, 0.22]) bar(0.05, 2.6, 0.05, X(lx), baseH - 0.6, lz + off);
  for (let s = 0; s < 7; s++) bar(0.04, 0.035, 0.44, X(lx), baseH - 1.7 + s * 0.38, lz);
  bar(0.03, 1.2, 0.03, X(lx), baseH + 0.4, lz + 0.35);                    // câble / tige du contrepoids
  bar(0.12, 0.35, 0.12, X(lx), baseH - 0.3, lz + 0.35);                   // contrepoids
  addSubject({ label: 'Un escalier de secours enneigé', value: 0.6,
    box: ST.box(new THREE.Box3(new THREE.Vector3(Math.min(faceX, X(depth + 0.1)), baseH - 1.8, z - w / 2 - 0.2), new THREE.Vector3(Math.max(faceX, X(depth + 0.1)), baseH + 1 + floors * 3.2 + 1.2, z + w / 2 + 0.2))) });
}

// Génération des rangées, rue par rue
export let deliZ = null;
/** Emprises à garder LIBRES au pied des façades (rangées dans st.doorZones) : perrons (marches +
 *  ouverture de la clôture) et portes de boutique. Lues par props.js, qui est construit après :
 *  des poubelles et des congères tirées au hasard le long des murs tombaient sinon au milieu des marches. */
/** Distance (le long de la rue st) de z à la plus proche emprise de ce côté ; 0 si z est dedans. */
export function doorGap(st, side, z) {
  let best = Infinity;
  for (const d of st.doorZones) if (d.side === side) best = Math.min(best, Math.max(0, d.z0 - z, z - d.z1));
  return best;
}

/** `chunks` : limites de tronçons (z de la rue) ; les fusions sont faites tronçon par tronçon et
 *  rangée par rangée (voir LEFT_CHUNKS, street.js) — sans limites, une seule fusion pour la rue. */
export function beginStreet(st, warm = 1, chunks = []) {
  ST = st; ST.warm = warm; ST.chunks = chunks;
  resetAccumulators();
}
function resetAccumulators() {
  frameInst = []; litInst = [[], [], []]; darkInst = []; shadeInst = [[], [], []];
  escGeoms = []; fenceGeoms = []; concGeoms = []; snowGeoms = []; basementGlass = []; plinthGeoms = [];
}

/** Une rangée d'immeubles du côté `side` de la rue en construction, de zFrom à zTo EXACTEMENT
 *  (le dernier immeuble prend ce qui reste) : aux coins, les rangées se touchent sans trou ni
 *  chevauchement. `pShop` : part de commerces ; `opt(z, depthZ)` : réglages imposés. */
function buildRow(side, zFrom, zTo, pShop, opt = () => ({})) {
  let z = zFrom, nb = 0;
  if (ST.chunks.length) flushChunk();                 // rue en tronçons : chaque rangée a ses fusions
  while (nb < ST.chunks.length && ST.chunks[nb] <= zFrom) nb++;
  while (zTo - z > 6) {
    if (nb < ST.chunks.length && z >= ST.chunks[nb]) {  // limite de tronçon franchie : on fusionne ce qui précède
      flushChunk();
      while (nb < ST.chunks.length && ST.chunks[nb] <= z) nb++;
    }
    const rem = zTo - z;
    const depthZ = rem <= 17.5 ? rem : rem < 22.5 ? rem / 2 - 0.25 : rnd(11, Math.min(17, rem - 11.5));
    const height = rnd(14, 30), o = opt(z, depthZ);
    // Le deli (rue principale) est le premier immeuble de gauche dont l'emprise dépasse z = −14 :
    // il existe toujours exactement un tel immeuble (l'ancien test « début dans
    // (−24, −8) » pouvait ne rien attraper, et le néon se retrouvait sur un perron).
    const isDeli = ST === MAIN && side === -1 && deliZ === null && z + depthZ > -14;
    const storefront = isDeli || (o.storefront ?? Math.random() < pShop);
    const b = buildBuilding(side, z, depthZ, height, {
      // peu de commerces ouverts : sur le modèle, la plupart ont baissé le rideau et le deli est
      // la seule vraie vitrine allumée de l'enfilade
      isDeli, storefront, storefrontLight: isDeli || (storefront && Math.random() < 0.28),
      awning: isDeli || Math.random() < 0.5,
      stoop: !storefront && Math.random() < 0.75,
      stoopOffset: rnd(-1, 1) * (depthZ / 2 - 3),
      fireEscape: Math.random() < 0.75,
      escapeOffset: rnd(-1, 1) * (depthZ / 2 - 2.5),
      waterTower: Math.random() < 0.3,
      ...o,
    });
    if (isDeli) deliZ = b.cz;
    z += depthZ + 0.5;
  }
}

/** Fusionne et pose tout ce qui a été accumulé (fenêtres instanciées, pierre, fonte, neige) puis
 *  repart de zéro : appelé à chaque limite de tronçon et en fin de rue. */
export function flushChunk() {
  if (!frameInst.length && !concGeoms.length && !escGeoms.length && !fenceGeoms.length) { resetAccumulators(); return; }
  // Instanciation des fenêtres : cadres, vitres éteintes, trois types d'intérieurs allumés (nu / rideaux / stores)
  const frames = new THREE.InstancedMesh(winFrameGeo, MAT.paint, frameInst.length);
  frameInst.forEach((m, i) => frames.setMatrixAt(i, m)); frames.castShadow = true; ST.add(frames);
  const dark = new THREE.InstancedMesh(winGlassGeo, MAT.glass, darkInst.length);
  darkInst.forEach((m, i) => dark.setMatrixAt(i, m)); ST.add(dark);
  // fenêtres éteintes derrière lesquelles on devine un store ou des rideaux : matériau
  // éclairé (la lumière de la rue les accroche), un peu brillant comme la vitre devant
  shadeInst.forEach((list, v) => {
    if (!list.length) return;
    const sh = new THREE.InstancedMesh(winGlassGeo, shadeMats[v], list.length);
    list.forEach((m, i) => sh.setMatrixAt(i, m)); ST.add(sh);
  });
  const c = new THREE.Color(), sil = [];
  litInst.forEach((list, v) => {
    if (!list.length) return;
    const lit = new THREE.InstancedMesh(winGlassGeo, litMats[v], list.length);
    list.forEach((m, i) => { lit.setMatrixAt(i, m); const k = 0.45 + Math.random() * 0.9; c.setHSL(0.06 + Math.random() * 0.06, 0.4 + Math.random() * 0.3, 0.6).multiplyScalar(k); lit.setColorAt(i, c); if (!m.noSilhouette && Math.random() < 0.16) sil.push(m); });
    ST.add(lit);
  });
  // quelqu'un passe derrière une fenêtre allumée sur six (voir silhouetteMat) ; jamais dans un rez-de-jardin
  // à moitié enterré (matrice marquée noSilhouette, brownstones.js) : la personne serait coupée par le sol
  if (sil.length) {
    const g = winGlassGeo.clone(), seeds = new Float32Array(sil.length).map(() => Math.random());
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const mesh = new THREE.InstancedMesh(g, silhouetteMat, sil.length), off = new THREE.Matrix4().makeTranslation(0, 0, 0.006);
    sil.forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(off)));    // juste devant l'intérieur allumé, derrière le cadre
    ST.add(mesh);
  }
  // pierre reconstituée photo (tuile de 2,7 m ; UV worldBox en tuiles de 5,5 m) pour linteaux, appuis, corniches…
  if (concGeoms.length) { const cm = weather(MAT.concrete.clone(), { strength: 0.75, frame: ST.frame, warm: ST.warm }); usePhoto(cm, 'concrete_wall_008', 5.5 / 2.7, 5.5 / 2.7); ST.add(shadowed(new THREE.Mesh(mergeGeometries(concGeoms), cm))); }
  flushSnowPads(0);   // filet : tout est normalement déjà fusionné immeuble par immeuble
  // Escaliers de secours et clôtures fusionnés (un seul mesh chacun → ombres et perf)
  if (escGeoms.length) ST.add(shadowed(new THREE.Mesh(mergeGeometries(escGeoms.map(g => g.index ? g.toNonIndexed() : g)), escapeMat)));
  if (fenceGeoms.length) ST.add(shadowed(new THREE.Mesh(mergeGeometries(fenceGeoms), MAT.iron)));
  if (basementGlass.length) ST.add(new THREE.Mesh(mergeGeometries(basementGlass), MAT.glass));
  // socle : même pierre, gardée gris granit par la couleur du matériau
  if (plinthGeoms.length) { const pm = weather(MAT.granite.clone(), { strength: 0.8, frame: ST.frame, warm: ST.warm }); usePhoto(pm, 'concrete_wall_008', 5.5 / 2.7, 5.5 / 2.7); ST.add(shadowed(new THREE.Mesh(mergeGeometries(plinthGeoms), pm))); }
  resetAccumulators();
}
export function endStreet() { flushChunk(); ST = null; }

/* Silhouettes derrière les fenêtres allumées (demande utilisateur) : une ombre floue — derrière le
   rideau ou au fond de la pièce — entre par un côté, s'arrête un moment (léger balancement), repart
   par l'autre, puis la fenêtre reste vide jusqu'au cycle suivant (25 à 75 s, propre à chaque
   fenêtre). Tout est dans le shader (temps, graine par instance) ; tailles en MÈTRES, tirées de
   l'échelle de l'instance : la personne garde ses proportions dans une haute fenêtre de parlor floor. */
export const silhouetteUniforms = { uTime: { value: 0 }, uFogDensity: { value: FOG_DENSITY } };
const silhouetteMat = new THREE.ShaderMaterial({
  uniforms: silhouetteUniforms, transparent: true, depthWrite: false,
  vertexShader: `
    attribute float aSeed;
    uniform float uFogDensity;
    varying vec2 vP; varying vec2 vSize; varying float vSeed, vFog;
    void main(){
      vSize = vec2(${(WIN_W - 0.1).toFixed(2)} * length(instanceMatrix[0].xyz), ${(WIN_H - 0.1).toFixed(2)} * length(instanceMatrix[1].xyz));
      vP = vec2((uv.x - 0.5) * vSize.x, uv.y * vSize.y);                 // mètres : centre de l'appui = (0, 0)
      vSeed = aSeed;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vFog = exp(-uFogDensity * uFogDensity * mv.z * mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vP; varying vec2 vSize; varying float vSeed, vFog;
    float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    void main(){
      float P = mix(25.0, 75.0, fract(vSeed * 7.13)), T = fract(uTime / P + vSeed) * P;
      float dir = vSeed > 0.5 ? 1.0 : -1.0, W = vSize.x;
      float walkIn = 2.6 + fract(vSeed * 11.0), stay = mix(2.0, 15.0, fract(vSeed * 3.7)), walkOut = 2.4 + fract(vSeed * 13.0);
      float xs = -dir * (W * 0.5 + 0.4), xm = (fract(vSeed * 5.3) - 0.5) * W * 0.55, xe = dir * (W * 0.5 + 0.4);
      float x, walking = 0.0;
      if (T < walkIn) { x = mix(xs, xm, smoothstep(0.0, walkIn, T)); walking = 1.0; }
      else if (T < walkIn + stay) x = xm + 0.05 * sin(T * 0.7 + vSeed * 20.0);
      else if (T < walkIn + stay + walkOut) { x = mix(xm, xe, smoothstep(0.0, walkOut, T - walkIn - stay)); walking = 1.0; }
      else discard;
      // plancher de la pièce sous l'appui (~0,8 m ; moins sous une haute fenêtre), un peu au fond : plus petit
      float s = mix(1.0, 1.15, fract(vSeed * 17.0));                    // tout près de la vitre : un peu plus grand
      vec2 p = vec2(vP.x - x, vP.y + clamp(0.7 - (vSize.y - 1.8) * 0.55, 0.25, 0.8) * s) / s;
      p.y -= walking * 0.02 * abs(sin(T * 5.5));                       // le pas
      float head = length(p - vec2(0.0, 1.6)) - 0.105;
      float body = sdBox(p - vec2(0.0, 1.05), vec2(0.21, 0.4), 0.11);
      float neck = sdBox(p - vec2(0.0, 1.47), vec2(0.05, 0.06), 0.02);
      float d = min(min(head, body), neck);
      float a = (1.0 - smoothstep(-0.03, 0.06, d)) * 0.88 * vFog;     // floue : derrière le voilage
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.035, 0.025, 0.02, a);
    }`,
});

// Matériaux partagés par toutes les rues : vitres à store / rideaux, intérieurs allumés, fonte des escaliers
const shadeMats = winDarkTex.map(map => new THREE.MeshStandardMaterial({ map, roughness: 0.3, metalness: 0, envMapIntensity: 1.4 }));
const litMats = winInteriorTex.map(map => new THREE.MeshBasicMaterial({ map, color: 0xffffff }));
// fonte peinte en noir, écaillée et rouillée (même texture que les lampadaires, assombrie)
const escapeMat = new THREE.MeshStandardMaterial({
  map: lampPaint.map, roughnessMap: lampPaint.roughnessMap, normalMap: lampPaint.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
  color: 0x6a6a6a, roughness: 1, metalness: 0.25, envMapIntensity: 1.1 });
// photo de rouille : on n'en garde que le RELIEF et la RUGOSITÉ (fonte piquée), la couleur reste la peinture noire écaillée
usePhoto(escapeMat, 'rust_coarse_01', 1, 1, m => { m.map = lampPaint.map; m.normalScale.set(0.7, 0.7); });

/* Rue principale. Côté gauche (celui que le joueur longe, celui du deli) : enfilade de
   devantures comme sur la référence. Côté droit : plus résidentiel, ce qui laisse la place aux
   perrons et aux voitures garées. Les deux rangées s'arrêtent aux coins des rues de gauche et de
   droite (façade de la transversale, z = CROSS_Z + FACADE_X) : chaque immeuble d'angle a une 2e
   façade tournée vers la rue d'à côté, et pas de boutique (son rez-de-chaussée d'habitation fait
   le tour du coin). */
beginStreet(MAIN);
const cornerOpt = z => (z < CROSS_Z + FACADE_X + 1 ? { endFacade: -1, storefront: false, stoop: false } : {});
buildRow(-1, CROSS_Z + FACADE_X, STREET_Z_MAX + 12, 0.62, cornerOpt);
buildRow(1, CROSS_Z + FACADE_X, STREET_Z_MAX + 12, 0.24, cornerOpt);
if (deliZ === null) deliZ = -14;
endStreet();

/* Rue de gauche : côté −1 (celui des feux) de son entrée jusqu'à l'immeuble d'angle de la rue
   principale ; côté +1 (en face) jusqu'au droit des façades de droite de la rue principale :
   il ferme le carrefour en T. Un peu plus commerçante que le côté droit de la rue principale. */
beginStreet(LEFT, 1, LEFT_CHUNKS);
// Son identité (demande utilisateur) : une BODEGA allumée à l'angle côté feux — devant elle, la bouche
// de métro (world/subway.js) — et une LAVERIE ouverte en face, visibles depuis le carrefour.
const LEFT_CORNER = -(FACADE_X + 14.5);
let laundromat = false;
buildRow(-1, LEFT_END_X, LEFT_CORNER, 0.4, (z, d) => (z + d > LEFT_CORNER - 0.6
  ? { storefront: true, storefrontLight: true, awning: true, shopName: 'BODEGA', fireEscape: true } : {}));
buildRow(1, LEFT_END_X, FACADE_X, 0.35, (z, d) => {
  if (laundromat || z + d < -36 || z > -24) return {};
  laundromat = true; return { storefront: true, storefrontLight: true, awning: Math.random() < 0.5, shopName: 'LAUNDROMAT' };
});
endStreet();

// Fond de la rue de gauche : l'église (world/church.js).
