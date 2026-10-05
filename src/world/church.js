import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACADE_X, CROSS_Z } from '../core/constants.js';
import { stone } from '../textures/index.js';
import { makeLancetTexture, makeRoseTexture, makeClockTexture } from '../textures/church.js';
import { usePhoto } from '../textures/photo.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { weather } from './weathering.js';
import { LEFT_END } from './street.js';
import { snowPad, flushSnowPads, beginStreet, endStreet, paintMat, doorMaterial, PHOTO_WHITE } from './buildings.js';
import { bsPlace, bsBox, bsStrut, bsSnowStrip } from './brownstones.js';
import { addPointSource, addSpotSource } from './lightRegistry.js';
import { addPowderCornice } from './powderSources.js';
import { addSubject, boxAt } from '../game/subjects.js';

/* =====================================================================
   10 quinquies. L'ÉGLISE DU FOND DE L'IMPASSE (rue de gauche)
   La rue de gauche finissait sur deux immeubles d'habitation ; elle finit désormais sur une petite
   église néogothique en pierre grise, serrée entre les rangées comme on en voit à Manhattan :
   - au milieu, la NEF : pignon à 21 m, portail en arc brisé à voussures et colonnettes, double porte
     à pentures sous un tympan, perron de 4 marches, ROSACE allumée de l'intérieur (vitrail), deux
     lancettes, contreforts à pinacles ;
   - côté en face, le CLOCHER : grande lancette, HORLOGE éclairée (minuit moins dix), abat-sons,
     parapet crénelé, quatre pinacles et une flèche d'ardoise à 45 m, la neige accrochée à ses
     arêtes ; un projecteur au pied l'éclaire d'en bas ;
   - côté feux, un bas-côté en appentis, une lancette.
   Repère LEFT_END (comme un côté −1 de rue : façade en x = −FACADE_X, tournée vers +x, z le long).
   Les façades sont des plaques extrudées percées (THREE.Shape à trous) : les ébrasements des baies se
   voient. Formes dessinées en (−z, y) puis tournées d'un quart de tour (rotateY) : la face avant
   regarde la rue. Matériaux : pierre (même programme que les soubassements), vitraux et cadran en
   MeshBasicMaterial à texture : aucun shader en plus.
   (Noms de premier niveau préfixés « ch » : le collage mono-fichier met tous les modules ensemble.)
   ===================================================================== */
const chX = d => -FACADE_X + d;
const CH_T0 = CROSS_Z - FACADE_X, CH_T1 = CH_T0 + 5.6, CH_TC = (CH_T0 + CH_T1) / 2;     // clocher
const CH_N0 = CH_T1, CH_N1 = CH_N0 + 12, CH_NC = (CH_N0 + CH_N1) / 2;                    // nef
const CH_A0 = CH_N1, CH_A1 = CROSS_Z + FACADE_X, CH_AC = (CH_A0 + CH_A1) / 2;            // bas-côté
const CH_EAVE = 13, CH_APEX = 21, CH_TOWER = 30, CH_SPIRE = 15.5;
const CH_YF = 0.72;                                                                       // seuil du portail (haut du perron)
const CH_W = 2.4, CH_YS = 3.5;                                                            // baie de la porte, naissance de l'arc

/** Arc brisé (équilatéral) de largeur w : de y0 à la naissance ys, sommet à ys + 0,866 w. Coordonnées de forme (−z, y). */
function chArch(p, u, w, y0, ys) {
  const s = -u;
  p.moveTo(s - w / 2, y0); p.lineTo(s + w / 2, y0); p.lineTo(s + w / 2, ys);
  p.absarc(s - w / 2, ys, w, 0, Math.PI / 3, false);
  p.absarc(s + w / 2, ys, w, 2 * Math.PI / 3, Math.PI, false);
  p.lineTo(s - w / 2, y0);
  return p;
}
const chApex = (w, ys) => ys + 0.866 * w;
/** Points [u, y] de l'arc brisé de largeur w (naissance ys), de la naissance gauche à la droite. */
function chArchPts(u, w, ys, n = 16) {
  const pts = [], h = n / 2;
  for (let k = 0; k <= n; k++) {
    // chaque moitié est un arc de rayon w centré sur la naissance opposée
    const left = k <= h, ang = left ? Math.PI - (k / h) * (Math.PI / 3) : Math.PI / 3 - ((k - h) / h) * (Math.PI / 3);
    pts.push([(left ? u + w / 2 : u - w / 2) + w * Math.cos(ang), ys + w * Math.sin(ang)]);
  }
  return pts;
}
function chCircle(p, u, y, r) { p.absarc(-u, y, r, 0, Math.PI * 2, false); return p; }
/** Contour polygonal [[u, y], …] → Shape (coordonnées de forme). */
function chPoly(pts) { const s = new THREE.Shape(); pts.forEach(([u, y], i) => (i ? s.lineTo(-u, y) : s.moveTo(-u, y))); s.closePath(); return s; }
/** Plaque extrudée (épaisseur depth, face arrière à la profondeur dBack), UV de position. */
function chPlate(list, shape, depth, dBack) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  g.rotateY(Math.PI / 2); g.translate(chX(dBack), 0, 0);
  return bsPlace(list, g.index ? g.toNonIndexed() : g, 5.5);
}
/** Vitrail dans une baie en arc brisé (face vers la rue), UV 0–1 sur la baie. */
function chLancetGlass(list, u, w, y0, ys, d) {
  const g = new THREE.ShapeGeometry(chArch(new THREE.Shape(), u, w, y0, ys), 16), p = g.attributes.position, uv = g.attributes.uv, top = chApex(w, ys);
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - (-u - w / 2)) / w, (p.getY(i) - y0) / (top - y0));
  g.rotateY(Math.PI / 2); g.translate(chX(d), 0, 0); list.push(g);
}
/** Suite de barres (larmier) le long de l'arc brisé de largeur w (naissance ys, profondeur d), neige dessus. */
function chArchMould(list, u, w, ys, d, s = 0.18, n = 12) {
  const pts = [], h = n / 2;
  for (let k = 0; k <= n; k++) {
    // chaque moitié est un arc de rayon w centré sur la naissance opposée
    const left = k <= h, ang = left ? Math.PI - (k / h) * (Math.PI / 3) : Math.PI / 3 - ((k - h) / h) * (Math.PI / 3);
    pts.push(new THREE.Vector3(chX(d), ys + w * Math.sin(ang), (left ? u + w / 2 : u - w / 2) + w * Math.cos(ang)));
  }
  for (let k = 0; k < n; k++) {
    const seg = []; bsStrut(seg, pts[k], pts[k + 1], s); bsPlace(list, seg[0]);
    if (Math.abs(pts[k + 1].y - pts[k].y) < 0.9 * pts[k].distanceTo(pts[k + 1])) bsSnowStrip(pts[k].clone().setY(pts[k].y + s / 2), pts[k + 1].clone().setY(pts[k + 1].y + s / 2), s + 0.08, 0.06);
  }
}

beginStreet(LEFT_END, 0);
const chStone = [], chGlass = [], chRose = [], chClock = [], chSlate = [], chRoof = [], chIron = [], chWarm = [];
/** Boîte de pierre : largeur le long de la façade w, hauteur h, profondeur d centrée en dc. */
const chBox = (w, h, d, dc, y, u, tile) => bsBox(chStone, d, h, w, chX(dc), y, u, tile);

// --- Nef : pignon percé (portail, rosace, deux lancettes), corps et toit enneigé
{
  const s = chPoly([[CH_N0, 0], [CH_N1, 0], [CH_N1, CH_EAVE], [CH_NC, CH_APEX], [CH_N0, CH_EAVE]]);
  s.holes.push(chArch(new THREE.Path(), CH_NC, CH_W + 1.5, CH_YF, CH_YS));
  s.holes.push(chCircle(new THREE.Path(), CH_NC, 9.9, 2.2));
  for (const e of [-1, 1]) s.holes.push(chArch(new THREE.Path(), CH_NC + e * 4.1, 0.9, 7.0, 10.2));
  chPlate(chStone, s, 0.7, -0.7);
  bsBox(chStone, 29.85, CH_EAVE, 12, chX(-15.675), CH_EAVE / 2, CH_NC);       // corps de la nef (derrière les vantaux)
  const roof = new THREE.ExtrudeGeometry(chPoly([[CH_N0 - 0.3, CH_EAVE - 0.1], [CH_N1 + 0.3, CH_EAVE - 0.1], [CH_NC, CH_APEX + 0.1]]), { depth: 29.5, bevelEnabled: false });
  roof.rotateY(Math.PI / 2); roof.translate(chX(-30.2), 0, 0); chRoof.push(roof);
  // voussures : la baie se resserre par ressauts jusqu'à la porte ; colonnettes dans les angles
  // (anneau en U ouvert en bas : un trou qui toucherait le bord serait ignoré par la triangulation)
  for (const [wo, wi, d0] of [[CH_W + 1.5, CH_W + 1.0, -0.23], [CH_W + 1.0, CH_W + 0.5, -0.46]]) {
    const outer = chArchPts(CH_NC, wo, CH_YS), inner = chArchPts(CH_NC, wi, CH_YS).reverse();
    chPlate(chStone, chPoly([[CH_NC - wo / 2, CH_YF], ...outer, [CH_NC + wo / 2, CH_YF], [CH_NC + wi / 2, CH_YF], ...inner, [CH_NC - wi / 2, CH_YF]]), d0 + 0.7, -0.7);
  }
  for (let k = 0; k < 3; k++) for (const e of [-1, 1]) {
    const x = chX(-0.6 + 0.23 * k), z = CH_NC + e * (CH_W / 2 + 0.25 * k + 0.12);
    const g = new THREE.CylinderGeometry(0.09, 0.09, CH_YS - CH_YF, 10); g.translate(x, (CH_YF + CH_YS) / 2, z); bsPlace(chStone, g);
    const cap = new THREE.BoxGeometry(0.26, 0.18, 0.26); cap.translate(x, CH_YS + 0.02, z); bsPlace(chStone, cap);
  }
  // porte : deux vantaux (même bois), pentures en fer, tympan de pierre sous l'arc
  const doorMat = doorMaterial();
  for (const e of [-1, 1]) {
    const leaf = new THREE.BoxGeometry(0.08, CH_YS - CH_YF, CH_W / 2 - 0.03); leaf.translate(chX(-0.66), (CH_YF + CH_YS) / 2, CH_NC + e * CH_W / 4);
    const m = new THREE.Mesh(leaf, doorMat); m.castShadow = true; LEFT_END.add(m);
    for (const y of [CH_YF + 0.5, (CH_YF + CH_YS) / 2, CH_YS - 0.5]) { const h = new THREE.BoxGeometry(0.03, 0.07, CH_W / 2 - 0.25); h.translate(chX(-0.6), y, CH_NC + e * (CH_W / 4 + 0.08)); chIron.push(h); }
    const ring = new THREE.TorusGeometry(0.09, 0.015, 6, 14); ring.rotateY(Math.PI / 2); ring.translate(chX(-0.6), CH_YF + 1.15, CH_NC + e * 0.18); chIron.push(ring);
  }
  { const g = new THREE.ShapeGeometry(chArch(new THREE.Shape(), CH_NC, CH_W, CH_YS, CH_YS), 16); g.rotateY(Math.PI / 2); g.translate(chX(-0.66), 0, 0); bsPlace(chStone, g); }
  chBox(CH_W + 0.1, 0.22, 0.2, -0.6, CH_YS, CH_NC);                                         // linteau
  chArchMould(chStone, CH_NC, CH_W + 1.7, CH_YS, 0.08, 0.2, 12);                            // larmier sur le portail
  // rosace : vitrail au fond, remplage de pierre devant (anneaux et rayons), moulure
  { const g = new THREE.CircleGeometry(2.2, 48); g.rotateY(Math.PI / 2); g.translate(chX(-0.5), 9.9, CH_NC); chRose.push(g); }
  for (const r of [0.55, 1.45, 2.2]) { const t = new THREE.TorusGeometry(r, r === 2.2 ? 0.16 : 0.07, 6, 48); t.rotateY(Math.PI / 2); t.translate(chX(r === 2.2 ? 0.02 : -0.42), 9.9, CH_NC); bsPlace(chStone, t); }
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    bsStrut(chStone, new THREE.Vector3(chX(-0.42), 9.9 + sn * 0.55, CH_NC + c * 0.55), new THREE.Vector3(chX(-0.42), 9.9 + sn * 2.2, CH_NC + c * 2.2), 0.08);
  }
  snowPad(chX(-0.15), 7.72, CH_NC, 0.6, 1.6, 0.1);
  // deux lancettes de part et d'autre de la rosace
  for (const e of [-1, 1]) { chLancetGlass(chGlass, CH_NC + e * 4.1, 0.9, 7.0, 10.2, -0.45); chBox(1.2, 0.12, 0.42, -0.05, 6.94, CH_NC + e * 4.1); snowPad(chX(-0.05), 7.0, CH_NC + e * 4.1, 0.42, 1.15, 0.08); }
  // rampants du pignon (chaperon) et croix de faîte
  const pa = new THREE.Vector3(chX(0.1), CH_EAVE + 0.1, CH_N0 - 0.25), pb = new THREE.Vector3(chX(0.1), CH_APEX + 0.25, CH_NC), pc = new THREE.Vector3(chX(0.1), CH_EAVE + 0.1, CH_N1 + 0.25);
  for (const [a, b] of [[pa, pb], [pb, pc]]) { const seg = []; bsStrut(seg, a, b, 0.42); bsPlace(chStone, seg[0]); bsSnowStrip(a.clone().setY(a.y + 0.22), b.clone().setY(b.y + 0.22), 0.5, 0.12); }
  chBox(0.18, 1.6, 0.18, 0.1, CH_APEX + 1.1, CH_NC); chBox(0.95, 0.18, 0.18, 0.1, CH_APEX + 1.35, CH_NC);
  snowPad(chX(0.1), CH_APEX + 1.44, CH_NC, 0.2, 0.95, 0.05);
  addPowderCornice(LEFT_END.toWorld(new THREE.Vector3(chX(0.3), CH_EAVE + 2, CH_N0 + 1)), LEFT_END.toWorld(new THREE.Vector3(chX(0.3), CH_APEX - 1, CH_NC - 1)));
}
// perron : quatre marches de granit, neige ; socle ; contreforts à ressauts et pinacles
for (let j = 0; j < 4; j++) {
  const top = CH_YF - j * 0.18, dd = 0.75 + j * 0.32;
  bsBox(chStone, dd, top + 0.1, 5.4 + j * 0.3, chX(dd / 2), (top - 0.1) / 2, CH_NC, 2.5);
  snowPad(chX(dd - 0.16), top, CH_NC, 0.3, 5.3 + j * 0.3, 0.1);
}
snowPad(chX(0.35), CH_YF, CH_NC, 0.6, 5.2, 0.06);
LEFT_END.doorZones.push({ side: -1, z0: CH_NC - 3.3, z1: CH_NC + 3.3 });
chBox(CH_A1 - CH_T0, 0.8, 0.14, 0.07, 0.4, (CH_T0 + CH_A1) / 2);
for (const u of [CH_N0, CH_N1]) {
  for (const [d, y0, y1] of [[1.1, 0, 6], [0.75, 6, 10.5], [0.45, 10.5, CH_EAVE + 0.6]]) { chBox(0.9, y1 - y0, d, d / 2, (y0 + y1) / 2, u); snowPad(chX(d / 2), y1, u, d, 0.9, 0.12); }
  chBox(0.62, 1.4, 0.62, 0.0, CH_EAVE + 1.3, u);
  const pin = new THREE.ConeGeometry(0.46, 1.9, 4); pin.rotateY(Math.PI / 4); pin.translate(chX(0), CH_EAVE + 2.95, u); bsPlace(chStone, pin);
  snowPad(chX(0), CH_EAVE + 2.0, u, 0.6, 0.6, 0.1);
}

// --- Clocher : corps, façade percée (porte, lancette, horloge, abat-sons), cordons, parapet, pinacles, flèche
{
  bsBox(chStone, 5.7, CH_TOWER, 5.6, chX(-3.35), CH_TOWER / 2, CH_TC);
  const s = chPoly([[CH_T0, 0], [CH_T1, 0], [CH_T1, CH_TOWER], [CH_T0, CH_TOWER]]);
  s.holes.push(chArch(new THREE.Path(), CH_TC, 1.2, 0.2, 2.5));
  s.holes.push(chArch(new THREE.Path(), CH_TC, 1.3, 9.0, 14.3));
  s.holes.push(chCircle(new THREE.Path(), CH_TC, 19.0, 1.15));
  for (const e of [-1, 1]) s.holes.push(chArch(new THREE.Path(), CH_TC + e * 0.85, 0.85, 23.3, 26.5));
  chPlate(chStone, s, 0.7, -0.5);
  // petite porte, grande lancette, cadran, abat-sons (lames d'ardoise dans les baies)
  { const leaf = new THREE.BoxGeometry(0.06, 2.3, 1.15); leaf.translate(chX(-0.46), 0.2 + 1.15, CH_TC); LEFT_END.add(new THREE.Mesh(leaf, doorMaterial())); }
  chLancetGlass(chGlass, CH_TC, 1.3, 9.0, 14.3, -0.45);
  chBox(1.7, 0.14, 0.5, 0.0, 8.93, CH_TC); snowPad(chX(0.0), 9.0, CH_TC, 0.5, 1.65, 0.09);
  { const g = new THREE.CircleGeometry(1.15, 40); g.rotateY(Math.PI / 2); g.translate(chX(-0.3), 19.0, CH_TC); chClock.push(g); }
  { const t = new THREE.TorusGeometry(1.2, 0.14, 6, 40); t.rotateY(Math.PI / 2); t.translate(chX(0.22), 19.0, CH_TC); bsPlace(chStone, t); }
  for (const e of [-1, 1]) for (let y = 23.5; y < chApex(0.85, 26.5) - 0.2; y += 0.32) {
    const lv = new THREE.BoxGeometry(0.04, 0.06, 0.8); lv.rotateZ(-0.6); lv.translate(chX(-0.3), y, CH_TC + e * 0.85); chSlate.push(lv);
  }
  for (const y of [7.6, 16.8, 22.4]) { chBox(6.0, 0.28, 0.32, 0.36, y, CH_TC); snowPad(chX(0.36), y + 0.14, CH_TC, 0.32, 5.95, 0.11); }
  addPowderCornice(LEFT_END.toWorld(new THREE.Vector3(chX(0.5), 22.6, CH_T0 + 0.3)), LEFT_END.toWorld(new THREE.Vector3(chX(0.5), 22.6, CH_T1 - 0.3)));
  // parapet crénelé, pinacles d'angle
  for (const [cd, cu, w, d] of [[0.15, CH_TC, 5.9, 0.4], [-6.15, CH_TC, 5.9, 0.4], [-3.0, CH_T0, 0.4, 6.3], [-3.0, CH_T1, 0.4, 6.3]]) {
    bsBox(chStone, d, 0.9, w, chX(cd), CH_TOWER + 0.45, cu);
    if (w > 1) for (let k = -2; k <= 2; k++) chBox(0.6, 0.5, d, cd, CH_TOWER + 1.15, cu + k * 1.15);
    snowPad(chX(cd), CH_TOWER + 0.9, cu, d, w, 0.12);
  }
  for (const [du, dd] of [[CH_T0, 0.15], [CH_T1, 0.15], [CH_T0, -6.15], [CH_T1, -6.15]]) {
    chBox(0.7, 2.2, 0.7, dd, CH_TOWER + 1.1, du);
    const pin = new THREE.ConeGeometry(0.52, 2.4, 4); pin.rotateY(Math.PI / 4); pin.translate(chX(dd), CH_TOWER + 3.4, du); bsPlace(chStone, pin);
    snowPad(chX(dd), CH_TOWER + 2.2, du, 0.68, 0.68, 0.1);
  }
  // flèche d'ardoise, neige accrochée aux arêtes, croix
  const sc = new THREE.Vector3(chX(-3.0), CH_TOWER + 0.6, CH_TC), R = 2.45;
  const sp = new THREE.ConeGeometry(R * Math.SQRT2, CH_SPIRE, 4, 6); sp.rotateY(Math.PI / 4); sp.translate(sc.x, sc.y + CH_SPIRE / 2, sc.z); chSlate.push(sp);
  const tip = new THREE.Vector3(sc.x, sc.y + CH_SPIRE, sc.z);
  for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) bsSnowStrip(new THREE.Vector3(sc.x + a * R, sc.y + 0.05, sc.z + b * R).lerp(tip, 0.02), tip.clone().setY(tip.y - 0.4), 0.22, 0.09);
  const ball = new THREE.SphereGeometry(0.16, 10, 8); ball.translate(tip.x, tip.y + 0.12, tip.z); chIron.push(ball);
  const v = new THREE.BoxGeometry(0.08, 1.5, 0.08); v.translate(tip.x, tip.y + 0.9, tip.z); chIron.push(v);
  const hz = new THREE.BoxGeometry(0.08, 0.08, 0.8); hz.translate(tip.x, tip.y + 1.2, tip.z); chIron.push(hz);
}

// --- Bas-côté en appentis (côté feux) : lancette, rampant enneigé
{
  const s = chPoly([[CH_A0, 0], [CH_A1, 0], [CH_A1, 7.4], [CH_A0, 9.6]]);
  s.holes.push(chArch(new THREE.Path(), CH_AC, 1.1, 3.0, 5.6));
  chPlate(chStone, s, 0.6, -0.6);
  bsBox(chStone, 18, 9.6, CH_A1 - CH_A0, chX(-9.6), 4.8, CH_AC);
  chLancetGlass(chGlass, CH_AC, 1.1, 3.0, 5.6, -0.42);
  chBox(1.4, 0.12, 0.4, -0.02, 2.94, CH_AC); snowPad(chX(-0.02), 3.0, CH_AC, 0.4, 1.35, 0.08);
  const a = new THREE.Vector3(chX(0.08), 9.7, CH_A0), b = new THREE.Vector3(chX(0.08), 7.5, CH_A1 + 0.1);
  const seg = []; bsStrut(seg, a, b, 0.36); bsPlace(chStone, seg[0]); bsSnowStrip(a.clone().setY(a.y + 0.19), b.clone().setY(b.y + 0.19), 0.42, 0.12);
  const roof = new THREE.ExtrudeGeometry(chPoly([[CH_A0, 9.5], [CH_A1 + 0.2, 7.3], [CH_A1 + 0.2, 7.0], [CH_A0, 7.0]]), { depth: 17.6, bevelEnabled: false });
  roof.rotateY(Math.PI / 2); roof.translate(chX(-18), 0, 0); chRoof.push(roof);
}

// --- Lanternes du portail
for (const e of [-1, 1]) {
  const u = CH_NC + e * 2.55, y = 3.1;
  const arm = new THREE.BoxGeometry(0.4, 0.04, 0.04); arm.translate(chX(0.2), y + 0.38, u); chIron.push(arm);
  const cage = new THREE.CylinderGeometry(0.15, 0.11, 0.42, 6); cage.translate(chX(0.38), y, u); chWarm.push(cage);
  const cap = new THREE.ConeGeometry(0.2, 0.2, 6); cap.translate(chX(0.38), y + 0.31, u); chIron.push(cap);
  snowPad(chX(0.38), y + 0.38, u, 0.2, 0.2, 0.06);
}

// --- Matériaux et fusion
const chStoneMat = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: stone.rough, roughness: 1, color: new THREE.Color(0.95, 0.94, 0.92) });
weather(chStoneMat, { strength: 0.9, top: CH_TOWER, frame: LEFT_END.frame, warm: 0 });
usePhoto(chStoneMat, 'sandstone_blocks_08', 5.5 / 3, 5.5 / 3, m => m.color.setRGB(0.95, 0.94, 0.95).lerp(PHOTO_WHITE, 0.3));
const chNI = list => mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g));
LEFT_END.add(shadowed(new THREE.Mesh(chNI(chStone), chStoneMat)));
LEFT_END.add(new THREE.Mesh(mergeGeometries(chGlass), new THREE.MeshBasicMaterial({ map: makeLancetTexture(), color: new THREE.Color(1.5, 1.35, 1.2) })));
LEFT_END.add(new THREE.Mesh(mergeGeometries(chRose), new THREE.MeshBasicMaterial({ map: makeRoseTexture(), color: new THREE.Color(1.6, 1.45, 1.3) })));
LEFT_END.add(new THREE.Mesh(mergeGeometries(chClock), new THREE.MeshBasicMaterial({ map: makeClockTexture(), color: new THREE.Color(1.15, 1.08, 0.95) })));
LEFT_END.add(shadowed(new THREE.Mesh(chNI(chSlate), paintMat(0x2b2e34, 0.65, 0.15))));
{ const m = new THREE.Mesh(chNI(chRoof), MAT.snow); m.receiveShadow = true; LEFT_END.add(m); }
LEFT_END.add(shadowed(new THREE.Mesh(chNI(chIron), MAT.iron)));
LEFT_END.add(new THREE.Mesh(chNI(chWarm), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.4, 0.75) })));
flushSnowPads(0);
endStreet();

// --- Lumières : lanternes du portail, lueur de la rosace sur la neige, projecteur sur le clocher
const chW3 = (d, y, u) => LEFT_END.toWorld(new THREE.Vector3(chX(d), y, u));
addPointSource({ pos: chW3(1.0, 3.0, CH_NC), color: new THREE.Color(0xffc27a), intensity: 7, distance: 8 });
addPointSource({ pos: chW3(2.6, 9.0, CH_NC), color: new THREE.Color(0xffb8a0), intensity: 4, distance: 11 });
// projecteurs au pied, comme une église illuminée la nuit : le clocher, le pignon ; lueur froide du ciel
// renvoyée par la neige de l'impasse (sans elle, la pierre se fondait dans le noir)
addSpotSource({ pos: chW3(2.2, 0.6, CH_TC), target: chW3(-0.5, 24, CH_TC), color: new THREE.Color(0xffe2b8), intensity: 90, distance: 45, angle: 0.3, penumbra: 0.7 });
addSpotSource({ pos: chW3(4.5, 0.6, CH_NC), target: chW3(-0.5, 14, CH_NC), color: new THREE.Color(0xffe6c4), intensity: 70, distance: 30, angle: 0.5, penumbra: 0.8 });
addPointSource({ pos: chW3(7, 13, CH_NC - 1), color: new THREE.Color(0x9fb3d9), intensity: 18, distance: 26 });

addSubject({ label: 'Une église sous la neige', value: 0.95, glows: true, box: LEFT_END.box(boxAt(chX(0.5), CROSS_Z, 1.5, FACADE_X, 0, CH_TOWER + CH_SPIRE)) });
addSubject({ label: 'La rosace illuminée', value: 0.85, glows: true, box: LEFT_END.box(boxAt(chX(0), CH_NC, 0.5, 2.4, 7.5, 12.3)) });
addSubject({ label: "L'horloge du clocher (minuit moins dix)", value: 0.75, glows: true, box: LEFT_END.box(boxAt(chX(0), CH_TC, 0.5, 1.3, 17.7, 20.3)) });
