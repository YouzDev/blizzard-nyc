import * as THREE from 'three';
import { FOG_DENSITY, WALK_SPEED } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { windGust } from '../fx/snow.js';
import { photoSubjects, subjectBox } from './subjects.js';

/* =====================================================================
   18. NOTATION D'UNE PHOTO (0 à 50)
   Évaluée AU DÉCLENCHEMENT, sur l'état exact de la scène à cet instant :
     Sujet        /15  intérêt du sujet principal × qualité de sa présence dans le cadre
                       (taille, entier ou coupé, masqué ou non, noyé dans la brume ou non)
     Composition  /10  sujet près des points / lignes de tiers plutôt que plein centre
     Lumière      /10  « esthétique » lue sur les PIXELS de la photo réelle : exposition,
                       contraste, points lumineux sans zones brûlées, contraste chaud /
                       froid, richesse (autres sujets dans le cadre)
     Netteté      /10  neige sur l'objectif, bougé (rotation de la caméra), marche
     Moment       /5   bonus de l'instant (gyrophares allumés, feu au rouge, rafale…)
   Le sujet principal n'est pas imposé : c'est celui qui « tient » le mieux la photo
   (intérêt × présence). On cherche dans le registre game/subjects.js.
   ===================================================================== */
const SC_F = [0.1, 0.5, 0.9];                            // échantillons dans la boîte (3 × 3 × 3)
const scV = new THREE.Vector3(), scP = new THREE.Vector3(), scC = new THREE.Vector3(), scDir = new THREE.Vector3();
const scRay = new THREE.Raycaster();
const scSmooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
let scOccluders = null;

/** Objets qui peuvent MASQUER un sujet : tout ce qui est opaque, sauf le sol (le tester
 *  coûterait des centaines de milliers de triangles par rayon, et il ne cache presque rien). */
function occluderList() {
  if (scOccluders) return scOccluders;
  scOccluders = [];
  scene.traverse(o => {
    if (!o.isMesh || o.userData.noOcclude) return;
    const m = o.material;
    if (!Array.isArray(m) && (m.depthWrite === false || m.blending === THREE.AdditiveBlending)) return;   // lueurs, ciel, décalques
    scOccluders.push(o);
  });
  return scOccluders;
}

/** Présence de chaque sujet dans le cadre (sans l'occlusion, qui coûte des rayons). */
function measureSubject(s, camera) {
  const b = subjectBox(s);
  b.getCenter(scC);
  const dist = scC.distanceTo(camera.position);
  if (dist > 110) return null;
  let inside = 0, total = 0, minU = 1, minV = 1, maxU = 0, maxV = 0, su = 0, sv = 0;
  const pts = [];
  for (const fx of SC_F) for (const fy of SC_F) for (const fz of SC_F) {
    scP.set(THREE.MathUtils.lerp(b.min.x, b.max.x, fx), THREE.MathUtils.lerp(b.min.y, b.max.y, fy), THREE.MathUtils.lerp(b.min.z, b.max.z, fz));
    total++;
    scV.copy(scP).applyMatrix4(camera.matrixWorldInverse);
    if (scV.z > -camera.near) continue;                                    // derrière l'objectif
    scV.copy(scP).project(camera);
    if (Math.abs(scV.x) > 1 || Math.abs(scV.y) > 1) continue;             // hors cadre
    const u = scV.x * 0.5 + 0.5, v = 0.5 - scV.y * 0.5;
    inside++; su += u; sv += v; pts.push(scP.clone());
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  if (!inside) return null;
  const completeness = inside / total;
  const area = (maxU - minU) * (maxV - minV);
  const size = scSmooth(0.004, 0.05, area) * (1 - 0.35 * scSmooth(0.55, 0.95, area));   // trop petit = illisible ; plein cadre = étouffant
  const fd = s.glows ? FOG_DENSITY * 0.5 : FOG_DENSITY;                   // un sujet lumineux perce la brume
  const fog = Math.exp(-(fd * dist) * (fd * dist));
  const pre = size * Math.pow(completeness, 0.6) * fog;
  return { s, b, dist, completeness, area, size, fog, pre, cu: su / inside, cv: sv / inside, pts, vis: 1 };
}

/** Part des points visibles du sujet (quelques rayons vers ses échantillons dans le cadre). */
function visibility(m, camera) {
  const list = occluderList(), grow = m.b.clone().expandByScalar(0.2);
  const n = Math.min(5, m.pts.length), step = m.pts.length / n;
  let seen = 0;
  for (let i = 0; i < n; i++) {
    const p = m.pts[Math.floor(i * step)], d = p.distanceTo(camera.position);
    scDir.subVectors(p, camera.position).normalize();
    scRay.set(camera.position, scDir); scRay.far = d + 0.5;
    const hit = scRay.intersectObjects(list, false)[0];
    if (!hit || hit.distance >= d - 0.35 || grow.containsPoint(hit.point)) seen++;
  }
  return seen / n;
}

/** Lecture « esthétique » des pixels de la photo (image réduite, valeurs affichées 0..1). */
function readPixels(img) {
  const d = img.data, n = d.length / 4;
  let sum = 0, sum2 = 0, high = 0, blown = 0, warm = 0, cool = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; sum2 += l * l;
    if (l > 0.82) high++;
    if (l > 0.97) blown++;
    if (r - b > 0.12 && l > 0.25) warm++;
    if (b - r > 0.04 && l > 0.12) cool++;
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std, high: high / n, blown: blown / n, warm: warm / n, cool: cool / n };
}

/**
 * @param camera  caméra au moment du déclenchement (matrices à jour : juste après le rendu)
 * @param img     ImageData de la photo réduite (≈ 96 × 54)
 * @param lens    neige sur l'objectif (0,1 propre → 0,65 couvert)
 * @param angVel  vitesse de rotation de la caméra (rad/s), speed : vitesse de marche (m/s)
 */
export function evaluatePhoto({ camera, img, lens, angVel, speed, t }) {
  // --- sujets dans le cadre ; rayons d'occlusion seulement pour les 6 plus présents
  const cands = [];
  for (const s of photoSubjects) {
    if (s.active && !s.active()) continue;
    const m = measureSubject(s, camera);
    if (m && m.pre * s.value > 0.01) cands.push(m);
  }
  cands.sort((a, b) => b.pre * b.s.value - a.pre * a.s.value);
  const top = cands.slice(0, 6);
  for (const m of top) m.vis = visibility(m, camera);
  for (const m of top) m.presence = m.pre * m.vis;
  top.sort((a, b) => b.presence * b.s.value - a.presence * a.s.value);
  const main = top[0] && top[0].presence > 0.05 ? top[0] : null;
  const others = top.slice(1).filter(m => main && m.presence * m.s.value > 0.12 * main.presence * main.s.value);

  const pix = readPixels(img);
  const remarks = [], good = [];

  // --- Sujet /15
  let sujet = 2;
  if (main) {
    sujet = 15 * main.s.value * Math.pow(main.presence, 0.8);
    if (main.size < 0.5) remarks.push('Sujet trop petit : approche-toi ou zoome (molette).');
    if (main.completeness < 0.7) remarks.push('Sujet coupé par le bord du cadre.');
    if (main.vis < 0.7) remarks.push('Sujet en partie masqué par un obstacle.');
    if (main.fog < 0.6) remarks.push('Sujet noyé dans la brume : rapproche-toi.');
  } else remarks.push('Pas de vrai sujet : cadre un élément de la rue.');

  // --- Composition /10 : points et lignes de tiers
  let compo = 0.3;
  if (main) {
    const { cu, cv } = main;
    let dPt = Infinity;
    for (const px of [1 / 3, 2 / 3]) for (const py of [1 / 3, 2 / 3]) dPt = Math.min(dPt, Math.hypot(cu - px, cv - py));
    const onPt = 1 - scSmooth(0.03, 0.2, dPt);
    const onLineU = 0.65 * (1 - scSmooth(0.02, 0.12, Math.min(Math.abs(cu - 1 / 3), Math.abs(cu - 2 / 3))));
    const onLineV = 0.5 * (1 - scSmooth(0.02, 0.12, Math.min(Math.abs(cv - 1 / 3), Math.abs(cv - 2 / 3))));
    compo = Math.max(onPt, onLineU, onLineV, 0.1);
    if (compo > 0.8) good.push('Bien placé sur les lignes de tiers.');
    else if (Math.hypot(cu - 0.5, cv - 0.5) < 0.1) remarks.push('Composition trop centrée : décale le sujet sur un tiers.');
  }

  // --- Lumière / esthétique /10
  const e1 = scSmooth(0.04, 0.14, pix.mean) * (1 - scSmooth(0.5, 0.75, pix.mean));
  const e2 = scSmooth(0.06, 0.2, pix.std);
  const e3 = scSmooth(0.002, 0.015, pix.high) * (1 - scSmooth(0.06, 0.2, pix.blown));
  const e4 = scSmooth(0.01, 0.06, Math.min(pix.warm, pix.cool));
  const e5 = Math.min(1, others.length / 2);
  const esth = 0.22 * e1 + 0.24 * e2 + 0.2 * e3 + 0.17 * e4 + 0.17 * e5;
  if (e1 < 0.4) remarks.push(pix.mean < 0.1 ? 'Image trop sombre : cherche la lumière d\'un lampadaire.' : 'Image trop claire.');
  if (pix.blown > 0.08) remarks.push('Lumière brûlée : évite de viser une lampe en plein cadre.');
  if (e4 > 0.7) good.push('Beau contraste entre lumière chaude et nuit bleue.');
  if (e5 >= 1) good.push('Cadre riche : plusieurs éléments de la rue.');

  // --- Netteté /10
  const lensK = THREE.MathUtils.clamp((lens - 0.12) / 0.5, 0, 1);
  const motion = scSmooth(0.25, 2.0, angVel), walk = Math.min(1, speed / WALK_SPEED);
  const sharp = (1 - 0.8 * lensK) * (1 - 0.7 * motion) * (1 - 0.3 * walk);
  if (lensK > 0.35) remarks.push('Objectif couvert de neige : essuie-le (E) ou tourne le dos au vent.');
  if (motion > 0.4) remarks.push('Bougé : immobilise la visée avant de déclencher.');
  else if (walk > 0.5) remarks.push('Photo prise en marchant : arrête-toi pour plus de netteté.');

  // --- Moment /5
  let moment = 0;
  const bonus = [];
  const mm = main && main.s.moment ? main.s.moment() : null;
  if (mm) { moment += mm.pts; (mm.pts > 0 ? bonus : remarks).push(mm.pts > 0 ? mm.why : `Dommage : ${mm.why}.`); }
  for (const o of others) { const om = o.s.moment ? o.s.moment() : null; if (om && om.pts > 0) { moment += om.pts * 0.5; bonus.push(om.why); } }
  if (windGust(t) > 1.45) { moment += 2; bonus.push('en pleine rafale'); }
  moment = Math.min(5, moment);
  if (bonus.length) good.push('Bonus : ' + bonus.join(', ') + '.');

  const parts = { sujet: Math.round(sujet), compo: Math.round(10 * compo), esth: Math.round(10 * esth), net: Math.round(10 * sharp), moment: Math.round(moment) };
  const total = THREE.MathUtils.clamp(parts.sujet + parts.compo + parts.esth + parts.net + parts.moment, 0, 50);
  return {
    total, parts,
    subject: main ? main.s.label : 'La rue sous la neige',
    remarks: [...good.slice(0, 2), ...remarks.slice(0, 2)],
  };
}
