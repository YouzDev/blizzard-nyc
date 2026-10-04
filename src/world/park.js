import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIGHT_END_X, PARK_GATE_W, FACADE_X, SIDEWALK_H } from '../core/constants.js';
import { rnd } from '../core/noise.js';
import { stone, winInteriorTex } from '../textures/index.js';
import { makeParkSignTextures } from '../textures/parkSign.js';
import { usePhoto } from '../textures/photo.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { weather } from './weathering.js';
import { groundY } from './ground.js';
import { addSubject, boxAt } from '../game/subjects.js';
import { addPointSource } from './lightRegistry.js';
import { RIGHT } from './street.js';
import { beginStreet, endStreet, snowPad, flushSnowPads, fenceGeoms, snowGeoms, paintMat, PHOTO_WHITE } from './buildings.js';
import { bsBox, bsPlace, bsSnowStrip } from './brownstones.js';
import { buildLamppost, buildDrift } from './props.js';
import { plantParkTrees, flushTrees } from './trees.js';
import { buildPlume } from '../fx/steam.js';

/* =====================================================================
   10 ter. L'ENTRÉE DU PARC (bout de la rue de droite)
   D'après l'entrée du Balloch Castle Country Park (photo de l'utilisateur), en pleine nuit de
   tempête : quatre piliers de pierre à chapeau pyramidal et boule, un grand portail double en fer
   forgé (barreaux à pointe de lance, frise d'arcs brisés) fermé par une chaîne, deux portillons,
   deux murets de moellons en quart de cercle qui rejoignent les grilles des brownstones, le
   panneau du parc gravé dans la pierre sur le muret de gauche, et derrière : la loge du gardien
   (toit d'ardoise sous la neige, fenêtres allumées, cheminée qui fume), une allée bordée de
   lampadaires, de grands arbres nus et des sapins chargés de neige. La grille est FERMÉE : on ne
   rentre pas dans le parc. Repère de la rue de droite (z de la rue = −x monde), masqué avec elle.
   ===================================================================== */
const zG = -RIGHT_END_X;                                  // ligne du portail
const PIER_X = [-PARK_GATE_W + 0.4, -2.6, 2.6, PARK_GATE_W - 0.4];   // axes des quatre piliers (0,8 m de côté)

// moellons de grès gris-brun (même programme que les soubassements)
const parkStone = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: stone.rough, roughness: 1, color: new THREE.Color(0.66, 0.58, 0.5) });
weather(parkStone, { strength: 0.9, frame: RIGHT.frame, warm: 0.6 });
usePhoto(parkStone, 'large_sandstone_blocks', 5 / 3, 5 / 3, m => m.color.lerp(PHOTO_WHITE, 0.3));

beginStreet(RIGHT, 0.6);
const masonry = [], snowStart = snowGeoms.length;

/** Pilier : socle, fût, corniche, chapeau pyramidal, boule ; neige sur la corniche et le chapeau. */
function parkPier(x, z, s = 0.8, h = 2.7, lantern = false) {
  bsBox(masonry, s + 0.16, 0.45, s + 0.16, x, 0.1, z, 5);
  bsBox(masonry, s, h - 0.3, s, x, 0.3 + (h - 0.3) / 2 - 0.15, z, 5);
  bsBox(masonry, s + 0.2, 0.16, s + 0.2, x, h, z, 5);
  const cap = new THREE.ConeGeometry((s + 0.08) * 0.72, 0.55, 4); cap.rotateY(Math.PI / 4); cap.translate(x, h + 0.35, z); bsPlace(masonry, cap, 5);
  if (lantern) {
    // lanterne sur le pilier : globe, chapeau de fonte ; elle éclaire le portail et le panneau
    const glob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 1.6, 0.85) })); glob.position.set(x, h + 0.92, z); RIGHT.add(glob);
    const hat = new THREE.ConeGeometry(0.24, 0.16, 8); hat.translate(x, h + 1.18, z); fenceGeoms.push(hat);
    const stem = new THREE.CylinderGeometry(0.04, 0.06, 0.2, 8); stem.translate(x, h + 0.68, z); fenceGeoms.push(stem);
    snowPad(x, h + 1.22, z, 0.22, 0.22, 0.07);
    addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(x, h + 0.8, z + 1.2)), color: new THREE.Color(0xffc27a), intensity: 9, distance: 11 });
  } else { const ball = new THREE.SphereGeometry(s * 0.14, 10, 8); ball.translate(x, h + 0.7, z); bsPlace(masonry, ball, 5); }
  snowPad(x, h + 0.08, z, s + 0.18, s + 0.18, 0.1);
  const sc = new THREE.ConeGeometry((s + 0.08) * 0.6, 0.42, 4); sc.rotateY(Math.PI / 4); sc.translate(x, h + 0.5, z); snowGeoms.push(sc);
  RIGHT.collider(x, z, (s + 0.16) / 2, (s + 0.16) / 2);
}
/** Vantail en fer forgé de x0 à x1 (plan du portail), hauteur h : barreaux à pointe de lance,
 *  lisses, frise d'arcs brisés sous la lisse haute ; neige sur les lisses. */
function parkGateLeaf(x0, x1, h) {
  const L = x1 - x0, xc = (x0 + x1) / 2, put = g => fenceGeoms.push(g);
  const bar = (w, hh, d, x, y) => { const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, zG); put(g); };
  for (const x of [x0 + 0.03, x1 - 0.03]) bar(0.06, h, 0.06, x, h / 2);                              // montants
  for (const y of [0.18, h - 0.45, h - 0.08]) bar(L, 0.045, 0.04, xc, y);                             // lisses
  for (let x = x0 + 0.12; x < x1 - 0.06; x += 0.12) {
    const g = new THREE.CylinderGeometry(0.011, 0.011, h + 0.05, 5); g.translate(x, (h + 0.05) / 2, zG); put(g);
    const t = new THREE.ConeGeometry(0.026, 0.12, 4); t.translate(x, h + 0.1, zG); put(t);
  }
  for (let x = x0 + 0.24; x < x1 - 0.1; x += 0.24) {                                                   // frise d'arcs
    const a = new THREE.TorusGeometry(0.12, 0.011, 4, 8, Math.PI); a.scale(1, 1.6, 1); a.translate(x, h - 0.42, zG); put(a);
  }
  snowPad(xc, h - 0.06, zG, 0.05, L - 0.04, 0.05, 0, 0.18, Math.PI / 2);
  snowPad(xc, h - 0.43, zG, 0.05, L - 0.04, 0.04, 0, 0.18, Math.PI / 2);
}

// --- piliers, portail fermé (chaîne et cadenas), portillons
const PIER_H_OUT = 2.5, WALL_TOP = PIER_H_OUT + 0.08 - 0.2;   // murets : 20 cm sous le haut (corniche) des piliers qu'ils rejoignent
PIER_X.forEach((x, i) => parkPier(x, zG, i === 0 || i === 3 ? 0.72 : 0.84, i === 0 || i === 3 ? PIER_H_OUT : 2.8, i === 1 || i === 2));
parkGateLeaf(-2.18, 0, 2.15); parkGateLeaf(0, 2.18, 2.15);
for (const s of [-1, 1]) parkGateLeaf(s < 0 ? PIER_X[0] + 0.36 : 3.02, s < 0 ? -3.02 : PIER_X[3] - 0.36, 1.75);
for (let k = 0; k < 5; k++) { const l = new THREE.TorusGeometry(0.035, 0.008, 4, 8); l.rotateY(k % 2 ? Math.PI / 2 : 0); l.translate(0, 1.0 - k * 0.055, zG + 0.03); fenceGeoms.push(l); }
{ const lock = new THREE.BoxGeometry(0.07, 0.09, 0.04); lock.translate(0, 0.7, zG + 0.04); fenceGeoms.push(lock); }
RIGHT.collider(0, zG, PARK_GATE_W, 0.15);                                // portail et portillons fermés

// --- murets en quart de cercle : du pilier extérieur jusqu'à la grille de la dernière cour
const R = FACADE_X - PARK_GATE_W;
for (const s of [-1, 1]) {
  const cx = s * PARK_GATE_W, cz = zG + R, N = 10;
  const pt = k => { const a = (k / N) * Math.PI / 2; return new THREE.Vector3(cx + s * R * Math.sin(a), 0, cz - R * Math.cos(a)); };
  for (let k = 0; k < N; k++) {
    const a = pt(k), b = pt(k + 1), mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b) + 0.06, ang = Math.atan2(b.x - a.x, b.z - a.z);
    for (const [w, hh, y] of [[0.5, WALL_TOP - 0.06, (WALL_TOP - 0.18) / 2], [0.64, 0.12, WALL_TOP - 0.06]]) {
      const g = new THREE.BoxGeometry(w, hh, len); g.rotateY(ang); g.translate(mid.x, y, mid.z); bsPlace(masonry, g, 5);
    }
    bsSnowStrip(new THREE.Vector3(a.x, WALL_TOP, a.z), new THREE.Vector3(b.x, WALL_TOP, b.z), 0.6, 0.15);
    RIGHT.collider(mid.x, mid.z, Math.abs(b.x - a.x) / 2 + 0.3, Math.abs(b.z - a.z) / 2 + 0.3);
    buildDrift(RIGHT, mid.x - s * 0.2 * Math.cos(ang), SIDEWALK_H, mid.z - 0.3 * Math.sin(Math.abs(ang)), rnd(0.6, 1.0), rnd(0.9, 1.4), rnd(0.3, 0.6));
  }
  parkPier(s * FACADE_X, zG + R, 0.62, PIER_H_OUT);
}
// neige poussée contre le portail fermé (personne ne l'a ouvert depuis le début de la tempête)
for (let x = -PARK_GATE_W + 0.6; x < PARK_GATE_W - 0.4; x += rnd(0.9, 1.4)) buildDrift(RIGHT, x, 0.06, zG + 0.55, rnd(0.8, 1.3), rnd(0.6, 0.9), rnd(0.35, 0.65));

// --- panneau gravé sur le muret de gauche, un peu incliné vers l'arrière
{
  const t = makeParkSignTextures();
  const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, color: 0xb8b2a8 });
  const a = Math.PI / 4, px = -PARK_GATE_W - R * Math.sin(a) + 0.42 * Math.sin(a), pz = zG + R - R * Math.cos(a) + 0.42 * Math.cos(a);
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.62), mat); face.position.z = 0.051; g.add(face);
  const slab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.66, 0.1), parkStone)); g.add(slab);
  const snow = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.14), MAT.snow); snow.position.y = 0.36; g.add(snow);
  g.rotation.set(-0.16, Math.atan2(-Math.sin(a), -Math.cos(a)) + Math.PI, 0, 'YXZ');
  g.position.set(px, 1.5, pz); RIGHT.add(g);
  // petite applique qui l'éclaire (sinon, à 7 m des lanternes du portail, on ne lit rien)
  addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(px + 1.3 * Math.sin(a), 2.4, pz + 1.3 * Math.cos(a))), color: new THREE.Color(0xffd2a0), intensity: 3.5, distance: 5 });
  addSubject({ label: 'Le panneau du Balloch Castle Country Park', value: 0.8, box: RIGHT.box(boxAt(px, pz, 1.1, 1.1, 1.1, 1.9)) });
}

// --- la loge du gardien, derrière le muret de droite : pierre, toit d'ardoise en pavillon sous la
// neige, deux cheminées (l'une fume), fenêtres allumées, lanterne à la porte
{
  const lx = 13, lz = zG - 7.5, W = 7, D = 6, H = 3.1, y0 = groundY(RIGHT.wx(lx, lz), RIGHT.wz(lx, lz)) - 0.2;
  bsBox(masonry, W, H, D, lx, y0 + H / 2, lz, 5);
  const roof = new THREE.ConeGeometry(1, 1, 4); roof.rotateY(Math.PI / 4); roof.scale(W * 0.78, 2.6, D * 0.78); roof.translate(lx, y0 + H + 1.3, lz);
  RIGHT.add(shadowed(new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 }))));
  const rs = new THREE.ConeGeometry(1, 1, 4); rs.rotateY(Math.PI / 4); rs.scale(W * 0.76, 2.45, D * 0.76); rs.translate(lx, y0 + H + 1.42, lz); snowGeoms.push(rs);
  for (const [cx, cz, smoke] of [[lx - 2.2, lz + 0.8, true], [lx + 2.4, lz - 1, false]]) {
    bsBox(masonry, 0.7, 2.6, 0.8, cx, y0 + H + 1.6, cz, 5);
    snowPad(cx, y0 + H + 2.9, cz, 0.72, 0.82, 0.12);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 8), paintMat(0x5a3022, 0.8, 0)); pot.position.set(cx, y0 + H + 3.1, cz); RIGHT.add(pot);
    if (smoke) buildPlume(RIGHT.wx(cx, cz), y0 + H + 3.3, RIGHT.wz(cx, cz), new THREE.Color(0.5, 0.52, 0.56), { n: 70, spread: 0.12, height: 7, size: 1.6, opacity: 0.32 });
  }
  // fenêtres allumées (face vers la rue, +z, et face vers l'allée, −x), cadres blancs
  const lit = new THREE.MeshBasicMaterial({ map: winInteriorTex[1], color: new THREE.Color(1.05, 0.85, 0.6) }), frames = [];
  const win = (x, z, rotY) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), lit); p.rotation.y = rotY; p.position.set(x, y0 + 1.75, z); RIGHT.add(p);
    const n = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    for (const [w, h, dx, dy] of [[1.02, 0.08, 0, 0.66], [1.02, 0.08, 0, -0.66], [0.08, 1.4, 0.47, 0], [0.08, 1.4, -0.47, 0], [0.9, 0.05, 0, 0]]) {
      const g = new THREE.BoxGeometry(w, h, 0.06); g.rotateY(rotY); g.translate(x + Math.cos(rotY) * dx + n.x * 0.03, y0 + 1.75 + dy, z - Math.sin(rotY) * dx + n.z * 0.03); frames.push(g);
    }
    snowPad(x + n.x * 0.08, y0 + 1.08, z + n.z * 0.08, Math.abs(n.z) > 0.5 ? 1.0 : 0.18, Math.abs(n.z) > 0.5 ? 0.18 : 1.0, 0.08);
    addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(x + n.x * 1.2, y0 + 1.6, z + n.z * 1.2)), color: new THREE.Color(0xffc080), intensity: 3, distance: 6 });
  };
  win(lx - 1.6, lz + D / 2 + 0.01, 0); win(lx + 1.8, lz + D / 2 + 0.01, 0); win(lx - W / 2 - 0.01, lz - 0.8, -Math.PI / 2);
  RIGHT.add(new THREE.Mesh(mergeGeometries(frames), paintMat(0xc9c6bd, 0.6, 0)));
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.05, 1.0), paintMat(0x1d2a20, 0.6, 0.1)); door.position.set(lx - W / 2 - 0.03, y0 + 1.02, lz + 1.6); RIGHT.add(door);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.8) })); bulb.position.set(lx - W / 2 - 0.25, y0 + 2.45, lz + 0.85); RIGHT.add(bulb);
  addPointSource({ pos: RIGHT.toWorld(new THREE.Vector3(lx - W / 2 - 0.8, y0 + 2.3, lz + 1.2)), color: new THREE.Color(0xffc27a), intensity: 5, distance: 8 });
  addSubject({ label: 'La loge du gardien du parc', value: 0.75, box: RIGHT.box(boxAt(lx, lz, W / 2 + 0.4, D / 2 + 0.4, y0, y0 + H + 3.4)), moment: () => ({ pts: 2, why: 'la cheminée de la loge fume' }) });
}
RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(masonry.map(g => g.index ? g.toNonIndexed() : g)), parkStone)));
addSubject({ label: "L'entrée du parc sous la neige", value: 0.95, box: RIGHT.box(boxAt(0, zG, PARK_GATE_W + 0.4, 0.6, 0, 3.6)) });

// --- l'allée du parc : lampadaires de part et d'autre, qui s'enfoncent dans la brume
for (const [x, z, s] of [[-2.6, zG - 8, -1], [2.6, zG - 21, 1], [-2.6, zG - 34, -1], [2.6, zG - 47, 1]]) buildLamppost(RIGHT, x, z, s);

// --- arbres du parc : grands arbres nus et sapins, jamais sur l'allée ni sur la loge
{
  const spots = [];
  for (let k = 0; spots.length < 26 && k < 400; k++) {
    const x = (Math.random() < 0.5 ? -1 : 1) * rnd(4.2, 32), z = zG - rnd(1.5, 52);
    if (Math.abs(x - 13) < 6.5 && z > zG - 13) continue;                   // la loge
    if (spots.some(p => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    const sapin = Math.random() < 0.45;
    spots.push({ x, z, kind: sapin ? 'sapin' : 'feuillu', h: sapin ? rnd(8, 15) : rnd(12, 17) });
  }
  plantParkTrees(spots);
}
flushTrees();
flushSnowPads(snowStart);
endStreet();

