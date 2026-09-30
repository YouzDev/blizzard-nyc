import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from '../core/constants.js';
import { smoothNoise } from '../core/noise.js';
import { scene } from '../core/scene.js';
import { MAT } from './materials.js';
import { addSubject } from '../game/subjects.js';
import { addCollider, shadowed } from './collisions.js';
import { deliZ } from './buildings.js';
import { addContactShadow } from './contactShadows.js';
import { grimeTex } from '../textures/index.js';
import { makeAmbulanceLivery, makeTruckLivery, makeIceCreamLivery, makeVanLivery } from '../textures/liveries.js';

/* ---------------------------------------------------------------------
   HIVER SUR LES VOITURES (tout dans les shaders, repère local de la voiture :
   u le long de z, y vers le haut). Une voiture garée une nuit de tempête n'a ni
   vitres propres ni carrosserie propre — c'est ce qui trahissait les nôtres.
   --------------------------------------------------------------------- */
const carLocalVS = (shader, extra = '') => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vCarP; varying vec3 vCarN; varying float vCarSeed;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vCarP = position; vCarN = normal;
      vCarSeed = fract(sin(dot(modelMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);   // une valeur par voiture`);
};
/** Vitres givrées et enneigées : un voile de givre laiteux (cristaux fins) sur toutes
 *  les vitres, plus fort sur certaines voitures que d'autres ; de la NEIGE COLLÉE en
 *  plaques sur le pare-brise et la lunette (tournés vers le ciel) et au bas des vitres
 *  latérales. Là où il y a givre ou neige, le verre devient mat. Un seul matériau
 *  pour toutes les voitures (la quantité varie avec la position de chaque voiture). */
const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x0a1220, roughness: 0.08, metalness: 0, envMapIntensity: 1.6 });
carGlassMat.onBeforeCompile = shader => {
  shader.uniforms.uGrime = { value: grimeTex };
  carLocalVS(shader);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vCarP; varying vec3 vCarN; varying float vCarSeed; uniform sampler2D uGrime;
float cFrost, cSnow;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float amt = 0.5 + 0.5 * vCarSeed;
        float nSlow = texture2D(uGrime, vCarP.zy * 0.45 + vec2(vCarP.x * 0.31 + vCarSeed * 7.0, 0.0)).r;
        float nFine = texture2D(uGrime, vCarP.zy * 3.5 + vec2(vCarP.x * 0.9, vCarSeed * 3.0)).b;
        float up = clamp(normalize(vCarN).y, 0.0, 1.0);                      // pare-brise, lunette
        float low = 1.0 - smoothstep(1.02, 1.3, vCarP.y);                    // bas des vitres latérales
        cFrost = clamp(amt * (0.35 + 0.65 * nFine) * (0.7 + 0.3 * nSlow), 0.0, 1.0);
        cSnow = smoothstep(0.5, 0.62, nSlow * 0.55 + up * 0.5 * amt + low * 0.3 + nFine * 0.12);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.63, 0.71), cFrost * 0.9);     // givre : blanc-bleu laiteux
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.96), cSnow);           // neige collée
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(roughnessFactor, 0.5, cFrost), 0.95, cSnow);`);
};

/** Sel et gadoue sur le bas de caisse : croûte poudreuse gris clair qui monte depuis
 *  le bas et autour des roues (projections des pneus), éclaboussures plus sombres
 *  au-dessus. Uniformes propres au gabarit (hauteur du plancher, position des roues). */
function saltPaint(mat, P) {
  const u = { uGrime: { value: grimeTex }, uFloor: { value: P.floor }, uWF: { value: P.wheels[0] }, uWR: { value: P.wheels[1] } };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    carLocalVS(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCarP; varying vec3 vCarN; varying float vCarSeed; uniform sampler2D uGrime; uniform float uFloor, uWF, uWR;
float cSalt;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float h = vCarP.y;
          float low = 1.0 - smoothstep(uFloor + 0.05, uFloor + 0.62, h);
          float arch = max(exp(-pow((vCarP.z - uWF) / 0.62, 2.0)), exp(-pow((vCarP.z - uWR) / 0.62, 2.0))) * (1.0 - smoothstep(uFloor, uFloor + 0.8, h));
          float n = texture2D(uGrime, vCarP.zy * 1.4 + vec2(vCarP.x * 0.5 + vCarSeed * 9.0, 0.0)).r;
          float sp = texture2D(uGrime, vCarP.zy * 4.5 + vec2(vCarP.x, vCarSeed * 5.0)).b;
          cSalt = clamp((low * 0.85 + arch * 0.55) * (0.45 + 0.8 * n), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.5), cSalt * 0.75);               // croûte de sel
          float splash = smoothstep(0.6, 0.74, sp) * (1.0 - smoothstep(uFloor + 0.2, uFloor + 0.55, h)) * (1.0 - clamp(abs(normalize(vCarN).y) * 1.5, 0.0, 1.0));   // flancs seulement, pas le capot
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.15, 0.14), splash * 0.55);            // gadoue projetée
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, cSalt);`)
      // le vernis ne brille pas sous la croûte de sel
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 1.0 - cSalt;
        #endif`);
  };
  return mat;
}

/* =====================================================================
   8. VÉHICULES : carrosserie construite à partir d'un profil latéral
   Une voiture n'est pas deux boîtes empilées : c'est UNE silhouette continue
   (pare-chocs → capot → pare-brise → toit → lunette → malle), reprise en sections
   transversales arrondies (voir buildHull), avec les passages de roue découpés.
   Le profil est décrit en (u, y) : u le long de la voiture, avant vers +u
   (= +Z local), y la hauteur. Trois gabarits : berline, SUV, compacte.
   ===================================================================== */
const CAR_PROFILES = {
  sedan: {
    L: 4.6, W: 1.86,
    body: [[-2.3, 0.62], [-2.2, 0.92], [-1.35, 0.98], [-0.65, 1.44], [0.45, 1.46], [1.2, 1.02], [2.1, 0.9], [2.3, 0.7], [2.3, 0.36]],
    glass: [[1.14, 1.03], [0.48, 1.4], [-0.62, 1.4], [-1.26, 1.0]],
    wheels: [1.45, -1.45], wheelR: 0.33, archR: 0.44, floor: 0.36,
    roof: [-0.65, 0.45], hood: [[1.2, 1.02], [2.1, 0.9]], trunk: [[-2.2, 0.92], [-1.35, 0.98]],
    windshield: [[1.2, 1.02], [0.45, 1.46]], rear: [[-1.35, 0.98], [-0.65, 1.44]],
    pillar: -0.15, seams: [1.1, 0.05, -1.2],
  },
  suv: {
    L: 4.7, W: 1.95,
    body: [[-2.35, 0.78], [-2.3, 1.12], [-2.12, 1.64], [0.6, 1.68], [1.25, 1.16], [2.2, 1.0], [2.35, 0.82], [2.35, 0.4]],
    glass: [[1.18, 1.17], [0.62, 1.62], [-2.05, 1.6], [-2.22, 1.14]],
    wheels: [1.5, -1.5], wheelR: 0.38, archR: 0.5, floor: 0.4,
    roof: [-2.12, 0.6], hood: [[1.25, 1.16], [2.2, 1.0]], trunk: null,
    windshield: [[1.25, 1.16], [0.6, 1.68]], rear: [[-2.3, 1.12], [-2.12, 1.64]],
    pillar: -0.3, seams: [1.15, 0.05, -1.15],
  },
  hatch: {
    L: 4.0, W: 1.76,
    body: [[-2.0, 0.7], [-1.92, 1.05], [-1.25, 1.45], [0.5, 1.47], [1.22, 1.0], [1.85, 0.88], [2.0, 0.68], [2.0, 0.35]],
    glass: [[1.16, 1.01], [0.52, 1.41], [-1.18, 1.41], [-1.84, 1.06]],
    wheels: [1.3, -1.3], wheelR: 0.31, archR: 0.42, floor: 0.35,
    roof: [-1.25, 0.5], hood: [[1.22, 1.0], [1.85, 0.88]], trunk: null,
    windshield: [[1.22, 1.0], [0.5, 1.47]], rear: [[-1.92, 1.05], [-1.25, 1.45]],
    pillar: -0.25, seams: [1.05, -0.05],
  },
  // --- Véhicules utilitaires : même construction par sections, silhouettes hautes et
  // carrées. Champs en plus : tumble (rentrée de l'habitacle, quasi nulle sur une
  // caisse), tailY / plateY (feux et plaque à hauteur de pare-chocs, pas en haut de la
  // caisse), gap (joint sombre entre cabine et caisse).
  van: {            // camionnette tôlée (type Econoline / Transit)
    L: 5.3, W: 2.0,
    body: [[-2.65, 0.5], [-2.65, 2.05], [-2.55, 2.15], [0.95, 2.18], [1.75, 1.4], [2.35, 1.15], [2.65, 0.9], [2.65, 0.45]],
    glass: [[1.68, 1.43], [1.0, 2.0], [0.35, 2.0], [0.35, 1.43]],
    wheels: [1.75, -1.65], wheelR: 0.36, archR: 0.47, floor: 0.42,
    roof: [-2.55, 0.95], hood: [[1.75, 1.4], [2.35, 1.15]], trunk: null,
    windshield: [[1.75, 1.4], [0.95, 2.18]], rear: [[-2.65, 2.05], [-2.55, 2.15]],
    pillar: 0.35, seams: [1.55, 0.3, -0.9], tumble: 0.08, tailY: 1.0, plateY: 0.75,
  },
  truck: {          // camion de livraison : cabine + caisse fourgon
    L: 7.0, W: 2.3,
    body: [[-3.5, 0.75], [-3.5, 3.05], [-3.4, 3.15], [0.55, 3.15], [0.55, 2.35], [0.85, 2.3], [1.75, 1.5], [3.2, 1.25], [3.5, 1.0], [3.5, 0.55]],
    glass: [[1.68, 1.55], [0.95, 2.2], [0.72, 2.2], [0.72, 1.55]],
    wheels: [2.55, -2.2], wheelR: 0.46, archR: 0.56, floor: 0.5,
    roof: [-3.4, 0.55], hood: [[1.75, 1.5], [3.2, 1.25]], trunk: null,
    windshield: [[1.75, 1.5], [0.85, 2.3]], rear: [[-3.5, 3.05], [-3.4, 3.15]],
    pillar: 0.72, seams: [1.55], gap: 0.55, tumble: 0.03, tailY: 1.05, plateY: 0.85,
  },
  ambulance: {      // ambulance « type III » : cabine de fourgon + cellule sanitaire
    L: 6.4, W: 2.2,
    body: [[-3.2, 0.6], [-3.2, 2.7], [-3.1, 2.8], [0.95, 2.8], [0.95, 2.3], [1.4, 2.25], [2.15, 1.45], [2.85, 1.15], [3.2, 0.9], [3.2, 0.5]],
    glass: [[2.08, 1.5], [1.42, 2.15], [1.05, 2.15], [1.05, 1.5]],
    wheels: [2.2, -1.9], wheelR: 0.4, archR: 0.5, floor: 0.45,
    roof: [-3.1, 0.95], hood: [[2.15, 1.45], [2.85, 1.15]], trunk: null,
    windshield: [[2.15, 1.45], [1.4, 2.25]], rear: [[-3.2, 2.7], [-3.1, 2.8]],
    pillar: 1.05, seams: [1.95, -0.2, -2.95], gap: 0.95, tumble: 0.04, tailY: 1.0, plateY: 0.8,
  },
  icecream: {       // camion de glaces (fourgon à marchepied)
    L: 6.0, W: 2.2,
    body: [[-3.0, 0.6], [-3.0, 2.6], [-2.9, 2.7], [1.3, 2.7], [1.85, 2.45], [2.15, 1.35], [2.65, 1.15], [3.0, 0.9], [3.0, 0.5]],
    glass: [[2.1, 1.45], [1.85, 2.35], [1.4, 2.35], [1.4, 1.45]],
    wheels: [1.9, -1.9], wheelR: 0.4, archR: 0.5, floor: 0.45,
    roof: [-2.9, 1.3], hood: [[2.15, 1.35], [2.65, 1.15]], trunk: null,
    windshield: [[2.15, 1.35], [1.85, 2.45]], rear: [[-3.0, 2.6], [-2.9, 2.7]],
    pillar: 1.4, seams: [2.0], tumble: 0.05, tailY: 1.0, plateY: 0.8,
  },
};
const carMats = {
  head: new THREE.MeshStandardMaterial({ color: 0xcfd6d8, roughness: 0.15, metalness: 0.3 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x6a1414, roughness: 0.3, metalness: 0.1 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.6 }),
};

/** Boîte posée sur la portion [t0, t1] d'un segment de profil (u1,y1)→(u2,y2), décalée
 *  vers l'extérieur de `offset`, d'épaisseur `thick` et de largeur `w`. Sert pour les
 *  plaques et dômes de neige sur capot / malle / pied de vitre. */
function onSegment(list, seg, t0, t1, thick, w, offset, pillow = false) {
  const [[u1, y1], [u2, y2]] = seg, du = u2 - u1, dy = y2 - y1, len = Math.hypot(du, dy);
  let nu = -dy / len, ny = du / len; if (ny < 0) { nu = -nu; ny = -ny; }          // normale sortante (vers le haut)
  const L = (t1 - t0) * len;
  let g;
  if (pillow) {
    // dôme : demi-ellipsoïde dont la base épouse la tôle — épais au centre, nul aux bords
    g = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(w / 2, thick, L / 2); g.rotateX(Math.PI / 2);           // hauteur le long de +z (= la normale après le rotateX suivant)
  } else g = new THREE.BoxGeometry(w, L, thick);
  // l'axe « hauteur » (+z à ce stade) doit pointer sur la normale sortante (ny, nu).
  // L'ancien angle atan2(du, dy) n'était juste que pour le pare-brise : sur le capot,
  // la malle et la lunette il RETOURNAIT le dôme, enfoui dans la carrosserie — seul
  // son bord dépassait, en arc sombre sur le capot.
  g.rotateX(Math.atan2(-ny, nu));
  const tm = (t0 + t1) / 2;
  g.translate(nu * offset, y1 + dy * tm + ny * offset, u1 + du * tm);
  list.push(g);
}
// SphereGeometry / Lathe sont indexées ou non selon le cas : on aligne tout avant fusion
const mergeAny = list => mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g));
const box = (list, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); return g; };

/* ---------------------------------------------------------------------
   Coque par SECTIONS (loft)
   L'ancienne coque était le profil latéral extrudé tout droit : flancs plans et
   verticaux, habitacle aussi large que la caisse, coins à angle vif vus de dessus —
   une plaque découpée, pas une voiture. Ici on empile des sections transversales le
   long de la voiture ; chacune est calculée à partir du profil et de trois règles
   qui font « voiture » au premier coup d'œil :
   - flanc légèrement bombé (épaule vers 45 % de la hauteur, bas de caisse rentré) ;
   - au-dessus de la ceinture de caisse, l'habitacle RENTRE vers le toit (tumblehome) :
     les vitres latérales sont inclinées, le toit est bien plus étroit que la caisse ;
   - arêtes supérieures arrondies, capot et toit légèrement bombés, coins arrondis
     vus de dessus, boucliers galbés (« nez » refermé par des anneaux).
   Vitres, montants, feux et joints de portière sont des GROUPES de faces de cette
   même coque : ils épousent la tôle au lieu d'être des boîtes posées dessus.
   --------------------------------------------------------------------- */
const CROWN = 0.03, EDGE_R = 0.09, TUMBLE = 0.2, NOSE = 0.07;
const NS1 = 6, NS2 = 3, NC = 4, NT = 7, NK = 6;      // points : flanc bas, flanc haut, arrondi, dessus ; anneaux du nez
const HALF = NS1 + NS2 + NC + NT + 1;                   // points d'une demi-section
const PAINT = 0, GLASS = 1, TRIM = 2, HEAD = 3, TAIL = 4;

/** Hauteur de la silhouette (profil latéral) à l'abscisse u. */
function profileTop(P, u) {
  let y = -Infinity;
  for (let i = 0; i < P.body.length - 1; i++) {
    const [u1, y1] = P.body[i], [u2, y2] = P.body[i + 1];
    if (u1 === u2 || u < Math.min(u1, u2) - 1e-6 || u > Math.max(u1, u2) + 1e-6) continue;
    y = Math.max(y, y1 + (y2 - y1) * (u - u1) / (u2 - u1));
  }
  return y;
}
/** Point (u, y) dans le polygone du vitrage latéral ? */
function inPoly(u, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, yi] = poly[i], [uj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && u < (uj - ui) * (y - yi) / (yj - yi) + ui) inside = !inside;
  }
  return inside;
}

/** Prépare une fois par gabarit : bornes, ceinture de caisse et demi-largeur hw(u, y). */
function prepareProfile(P) {
  if (P.hwAt) return P;
  const uR = P.body[0][0], uF = P.body[P.body.length - 1][0], W2 = P.W / 2;
  const belt = P.glass[0][1], roofMax = Math.max(...P.body.map(p => p[1]));
  const span = belt - P.floor, beltDrop = 0.06 * 0.55 * 0.55;
  Object.assign(P, { uR, uF, belt, roofMax });
  P.hwAt = (u, y) => {
    const v = (y - P.floor) / span - 0.45;
    const h = y <= belt ? W2 - 0.06 * v * v                                   // flanc bombé
                        : W2 - beltDrop - (P.tumble ?? TUMBLE) * (y - belt) / (roofMax - belt);   // habitacle qui rentre
    const e = Math.min(1, (uF - u) / 0.45, (u - uR) / 0.45);                  // coins arrondis vus de dessus
    return h * (0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - (1 - e) ** 2)));
  };
  return P;
}

/** Demi-section à l'abscisse u : du bas du flanc (passage de roue compris) jusqu'au milieu du dessus. */
function carSection(P, u) {
  let yBot = P.floor;
  for (const wu of P.wheels) { const d = u - wu; if (Math.abs(d) < P.archR) yBot = Math.max(yBot, P.floor + Math.sqrt(P.archR ** 2 - d * d)); }
  const yTop = profileTop(P, u), r = Math.min(EDGE_R, 0.4 * (yTop - yBot));
  const ySide = yTop - r, yBreak = Math.min(P.belt, yBot + 0.75 * (ySide - yBot));   // un rang pile sur la ceinture
  const pts = [];
  for (let k = 0; k < NS1; k++) { const y = yBot + (yBreak - yBot) * k / NS1; pts.push([P.hwAt(u, y), y]); }
  for (let k = 0; k < NS2; k++) { const y = yBreak + (ySide - yBreak) * k / NS2; pts.push([P.hwAt(u, y), y]); }
  const hwS = P.hwAt(u, ySide), x0 = Math.max(0.05, hwS - r);
  for (let k = 0; k < NC; k++) { const a = k / NC * Math.PI / 2; pts.push([x0 + (hwS - x0) * Math.cos(a), ySide + r * Math.sin(a)]); }
  for (let k = 0; k <= NT; k++) { const x = x0 * (1 - k / NT); pts.push([x, yTop + CROWN * (1 - (x / x0) ** 2)]); }
  return pts;
}

/** Coque complète : géométrie indexée avec un groupe par matériau (PAINT…TAIL). */
function buildHull(P) {
  // abscisses des sections : pas régulier + tous les points singuliers (cassures du
  // profil, bords des vitres et du montant, joints de portière, arcs de roue serrés)
  const us = [];
  for (let u = P.uR; u < P.uF; u += 0.09) us.push(u);
  us.push(P.uF, ...P.body.map(p => p[0]), ...P.glass.map(p => p[0]), P.pillar - 0.05, P.pillar + 0.05);
  for (const s of P.seams) us.push(s - 0.007, s + 0.007);
  for (let i = 1; i < P.body.length - 2; i++) if (P.body[i][0] === P.body[i + 1][0]) us.push(P.body[i][0] - 0.015, P.body[i][0] + 0.015);   // marche cabine / caisse : arête nette
  if (P.gap !== undefined) us.push(P.gap - 0.04, P.gap + 0.04);
  for (const wu of P.wheels) for (let k = -4; k <= 4; k++) us.push(wu + P.archR * Math.sin(k * Math.PI / 8));
  const sorted = us.filter(u => u >= P.uR && u <= P.uF).sort((a, b) => a - b);
  const slices = sorted.filter((u, i) => i === 0 || u - sorted[i - 1] > 0.01);
  if (P.uF - slices[slices.length - 1] > 1e-6) slices.push(P.uF);

  // section complète : côté droit de bas en haut, puis côté gauche en miroir
  const full = u => { const h = carSection(P, u), f = h.map(([x, y]) => [x, y, u]); for (let j = HALF - 2; j >= 0; j--) f.push([-h[j][0], h[j][1], u]); return f; };
  const secs = slices.map(full);
  // nez : la section d'extrémité se referme en quelques anneaux (bouclier galbé)
  const nose = (sec, dir) => {
    const yMid = (sec[0][1] + sec[HALF - 1][1]) / 2, out = [];
    for (let k = 1; k <= NK; k++) {
      // anneaux d'échelle régulière (facettes égales), bombé en quart de cercle
      const c = 1 - k / NK, du = dir * NOSE * Math.sqrt(1 - c * c);
      out.push(sec.map(([x, y, u]) => [x * c, yMid + (y - yMid) * c, u + du]));
    }
    return out;
  };
  const rings = [...nose(secs[0], -1).reverse(), ...secs, ...nose(secs[secs.length - 1], 1)];

  const N = 2 * HALF - 1, W2 = P.W / 2, pos = [], groups = [[], [], [], [], []];
  const yF = profileTop(P, P.uF), yR = profileTop(P, P.uR), yT = P.tailY ?? yR + 0.16;   // feux arrière : à hauteur de pare-chocs sur les utilitaires
  const inSeg = (seg, uc) => uc > Math.min(seg[0][0], seg[1][0]) + 0.02 && uc < Math.max(seg[0][0], seg[1][0]) - 0.02;
  for (const r of rings) for (const [x, y, u] of r) pos.push(x, y, u);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N, q = [rings[i][j], rings[i + 1][j], rings[i + 1][j1], rings[i][j1]];
    const xc = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, yc = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const uc = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4, ax = Math.abs(xc);
    const hj = j < HALF - 1 ? j : j === N - 1 ? -1 : 2 * HALF - 3 - j;         // indice dans la demi-section
    const isNose = i < NK || i >= rings.length - 1 - NK;
    const region = isNose ? 'nose' : hj < 0 ? 'under' : hj < NS1 + NS2 ? 'side' : hj < NS1 + NS2 + NC ? 'corner' : 'top';
    let m = PAINT;
    if (region === 'under') m = TRIM;
    else if (region === 'side' && inPoly(uc, yc, P.glass)) m = Math.abs(uc - P.pillar) < 0.05 ? TRIM : GLASS;   // vitres, montant B noir
    else if (region === 'top' && (inSeg(P.windshield, uc) || inSeg(P.rear, uc))) m = GLASS;                     // pare-brise, lunette
    else if (P.gap !== undefined && region !== 'nose' && region !== 'under' && Math.abs(uc - P.gap) < 0.04) m = TRIM;   // joint cabine / caisse
    else if (region === 'side' && yc < P.belt - 0.03 && P.seams.some(s => Math.abs(uc - s) < 0.008)) m = TRIM;  // joints de portière
    else if (uc > P.uF - 0.3 && yc > yF - 0.12 && yc < yF + 0.1 && ax > 0.34 * W2 && ax < 0.96 * W2) m = HEAD;
    else if (uc < P.uR + 0.24 && Math.abs(yc - yT) < 0.14 && ax > 0.42 * W2) m = TAIL;
    else if ((uc > P.uF - 0.4 || uc < P.uR + 0.4) && yc < P.floor + 0.1) m = TRIM;                             // bas des boucliers
    const a = i * N + j, b = (i + 1) * N + j, c = (i + 1) * N + j1, d = i * N + j1;
    groups[m].push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx = []; let start = 0;
  groups.forEach((list, mi) => { if (list.length) { g.addGroup(start, list.length, mi); idx.push(...list); start += list.length; } });
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Pneu au flanc arrondi (révolution), axe le long de X. */
function tireGeometry(R, w) {
  const pts = [new THREE.Vector2(R * 0.6, -w / 2)];
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + Math.PI * k / 8;
    pts.push(new THREE.Vector2(R - 0.05 + 0.05 * Math.pow(Math.cos(a), 0.4), (w / 2) * Math.sin(a)));   // bande de roulement plate, épaules rondes
  }
  pts.push(new THREE.Vector2(R * 0.6, w / 2));
  const g = new THREE.LatheGeometry(pts, 20); g.rotateZ(Math.PI / 2);
  return g;
}

/** Construit la carrosserie dans le groupe g. Retourne le profil (avec hwAt) pour les extras. */
function buildCarBody(g, kind, paint, snowDepth, tailMat = carMats.tail) {
  const P = prepareProfile(CAR_PROFILES[kind]), W = P.W, yF = profileTop(P, P.uF);
  const dark = [], snow = [];

  if (!paint.userData.salted) { saltPaint(paint, P); paint.userData.salted = true; }   // MAT.taxi : partagé, une seule fois
  g.add(shadowed(new THREE.Mesh(buildHull(P), [paint, carGlassMat, MAT.iron, carMats.head, tailMat])));

  // rétroviseurs, poignées (posés sur la tôle grâce à hwAt), plancher sombre entre les
  // roues : les passages de roue traversent la coque, il ne faut pas voir au travers
  const uM = P.glass[0][0] - 0.3;
  for (const sx of [-1, 1]) {
    box(dark, 0.1, 0.09, 0.17, sx * (P.hwAt(uM, P.belt + 0.08) + 0.06), P.belt + 0.08, uM);
    for (const su of P.seams.slice(0, P.seams.length > 2 ? 2 : 1)) {
      const hu = su - 0.4, hy = P.floor + 0.55;
      box(dark, 0.02, 0.03, 0.14, sx * (P.hwAt(hu, hy) + 0.008), hy, hu);
    }
  }
  box(dark, W - 0.52, P.archR, P.uF - P.uR - 0.4, 0, P.floor + P.archR / 2 - 0.05, (P.uF + P.uR) / 2);
  box(dark, 0.3 * W, 0.11, 0.03, 0, yF - 0.075, P.uF + NOSE * 0.84);                       // calandre, entre les phares
  const yRm = P.plateY ?? (P.floor + profileTop(P, P.uR)) / 2;
  g.add(new THREE.Mesh(box([], 0.32, 0.15, 0.02, 0, yRm, P.uR - NOSE - 0.004), carMats.plate));

  // --- Roues : pneu + enjoliveur, toutes fusionnées
  const tires = [], hubs = [];
  for (const wu of P.wheels) for (const sx of [-1, 1]) {
    const t = tireGeometry(P.wheelR, 0.22); t.translate(sx * (W / 2 - 0.13), P.floor, wu); tires.push(t);
    const h = new THREE.CylinderGeometry(P.wheelR * 0.56, P.wheelR * 0.56, 0.2, 14); h.rotateZ(Math.PI / 2); h.translate(sx * (W / 2 - 0.13), P.floor, wu); hubs.push(h);
  }
  g.add(shadowed(new THREE.Mesh(mergeAny(tires), MAT.iron)));
  g.add(new THREE.Mesh(mergeGeometries(hubs), MAT.metal));

  // --- Neige : toit, capot, malle, bas de pare-brise et de lunette ; congères contre les flancs
  // (toit plus étroit que la caisse désormais : le manteau suit la largeur réelle du toit)
  const [r0, r1] = P.roof, rm = (r0 + r1) / 2, roofY = profileTop(P, rm) + CROWN, roofW = 2 * P.hwAt(rm, roofY - CROWN);
  const dome = (w, h, L, x, y, z) => { const d = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2); d.scale(w / 2, h, L / 2); d.translate(x, y, z); snow.push(d); };
  const hRoof = 0.2 + 0.24 * snowDepth, rl = r1 - r0;
  dome(roofW + 0.04, hRoof, rl + 0.2, 0, roofY - 0.07, rm);                                  // manteau principal, déborde un peu du toit
  dome(roofW * 0.7, hRoof * 0.85, rl * 0.7, (Math.random() - 0.5) * 0.25, roofY - 0.02, rm + (Math.random() - 0.5) * 0.4 * rl);
  const hHood = 0.1 + 0.12 * snowDepth;
  onSegment(snow, P.hood, 0.0, 1.0, hHood, W - 0.16, -0.01, true);
  onSegment(snow, P.hood, 0.25, 0.95, hHood * 0.8, W * 0.58, 0.04, true);
  if (P.trunk) { onSegment(snow, P.trunk, 0.0, 1.0, hHood, W - 0.16, -0.01, true); onSegment(snow, P.trunk, 0.1, 0.8, hHood * 0.8, W * 0.6, 0.04, true); }
  onSegment(snow, P.windshield, -0.05, 0.55, 0.13, W - 0.36, 0.01, true);                    // bourrelet au pied du pare-brise
  onSegment(snow, P.rear, -0.05, 0.6, 0.13, W - 0.4, 0.01, true);
  // bourrelet contre les flancs : une nappe continue à profil en cloche, adossée à la
  // caisse (sa moitié intérieure est cachée dedans), bouts effilés, hauteur ondulée.
  // Un demi-ellipsoïde allongé se lisait comme un aileron, un chapelet de sphères
  // comme des boules de coton.
  for (const sx of [-1, 1]) {
    const bw = 0.9, bl = P.L + 0.4, bank = new THREE.PlaneGeometry(bw, bl, 8, 28); bank.rotateX(-Math.PI / 2);
    const p = bank.attributes.position, hB = 0.28 + 0.18 * snowDepth, seedB = Math.random() * 50;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i), e = Math.min(1, (bl / 2 - Math.abs(lz)) / 0.9);
      const n = smoothNoise(lz * 0.9 + seedB, sx * 3);                                  // mottes : hauteur ET largeur varient
      const a = (2 * lx) / (bw * (0.65 + 0.45 * n));
      p.setY(i, hB * (0.45 + 0.8 * n) * Math.pow(Math.max(0, 1 - a * a), 1.6) * Math.pow(Math.max(0, e), 0.7));
    }
    bank.translate(sx * (W / 2 + 0.02), 0, 0); snow.push(bank);
  }

  // La neige n'est jamais plane : on bosselle les faces supérieures avec un bruit
  // lisse (épaisseur inégale, bourrelets), les flancs restent collés à la tôle.
  const nrm = new THREE.Vector3(), seedN = Math.random() * 40;
  for (const sg of snow) {
    const pos = sg.attributes.position, nor = sg.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      nrm.fromBufferAttribute(nor, i);
      const up = Math.max(0, nrm.y);
      const px = pos.getX(i), pz = pos.getZ(i);
      const d = (smoothNoise(px * 2.6 + seedN, pz * 2.2) - 0.5) * 0.16 + (smoothNoise(px * 8 + seedN, pz * 8) - 0.5) * 0.04;
      pos.setXYZ(i, px + nrm.x * d * up, pos.getY(i) + nrm.y * d * up, pz + nrm.z * d * up);
    }
    sg.computeVertexNormals();
  }

  g.add(new THREE.Mesh(mergeAny(dark), MAT.iron));
  const sn = new THREE.Mesh(mergeAny(snow), MAT.snow); sn.receiveShadow = true; g.add(sn);
  return P;
}

function buildTaxi(x, z, rotY = 0) {
  const g = new THREE.Group();
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.15, 0.1) });   // feux allumés (bloom)
  const P = buildCarBody(g, 'sedan', MAT.taxi, 1, tailMat);
  // bandeau damier / « NYC TAXI » sur les portières, entre les passages de roue ;
  // plan subdivisé dont chaque sommet est plaqué sur le flanc bombé
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(2.0, 0.5, 1, 8); pg.rotateY(s * Math.PI / 2); pg.translate(0, P.floor + 0.38, 0);
    const p = pg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, s * (P.hwAt(p.getZ(i), p.getY(i)) + 0.006));
    g.add(new THREE.Mesh(pg, MAT.taxiSide));
  }
  const topSign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.7) })); topSign.position.set(0, P.roofMax + CROWN + 0.08, 0.1); g.add(topSign);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  addCollider(x, z, P.W / 2 + 0.34, P.L / 2 + 0.4);
  addContactShadow(x, z, P.W / 2 + 0.45, P.L / 2 + 0.35, 0.6, rotY, 6);
  addSubject({ label: 'Un taxi jaune enseveli', value: 0.9, object: g });
}

/** Voiture garée le long du trottoir, ensevelie : sur l'image de référence les
 *  voitures ne sont plus que des volumes sombres coiffés d'une épaisse couche de
 *  neige, roues à moitié prises dans la congère du chasse-neige. C'est cette file
 *  de véhicules qui donne l'échelle et la profondeur de la rue. */
function buildParkedCar(x, z, rotY, bodyColor, snowDepth = 1, kind = 'sedan') {
  const g = new THREE.Group();
  // vernis (clearcoat) : une 2e couche brillante par-dessus la peinture — les lampadaires y glissent en reflets nets
  const paint = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 });
  const P = buildCarBody(g, kind, paint, snowDepth);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  addCollider(x, z, P.W / 2 + 0.34, P.L / 2 + 0.4);   // jusqu'aux congères latérales et aux pare-chocs
  addContactShadow(x, z, P.W / 2 + 0.45, P.L / 2 + 0.35, 0.6, rotY, 6);
  addSubject({ label: 'Une voiture ensevelie sous la neige', value: 0.4, object: g });
}

/* ---------------------------------------------------------------------
   VÉHICULES UTILITAIRES garés dans la neige : camionnette, camion de livraison,
   ambulance, camion de glaces. Même coque par sections que les voitures (profils
   van / truck / ambulance / icecream), même neige, même sel, même givre ; en plus
   une décoration plaquée sur chaque flanc et quelques accessoires.
   --------------------------------------------------------------------- */
const liveryTex = {};
const SPECIALS = {
  van:       { color: 0xdfe2e4, livery: makeVanLivery,       area: [-2.2, 1.2, 1.05, 1.95] },
  truck:     { color: 0xeeeeea, livery: makeTruckLivery,     area: [-3.25, 0.35, 1.15, 2.95] },
  ambulance: { color: 0xf0f0ec, livery: makeAmbulanceLivery, area: [-3.0, 0.8, 0.95, 2.55] },
  icecream:  { color: 0xf4f2ee, livery: makeIceCreamLivery,  area: [-2.75, 1.15, 0.9, 2.5] },
};
// rampe lumineuse de l'ambulance : deux matériaux qui alternent (rouge / blanc), animés dans updateVehicles
const beaconMats = [new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.02, 0.02) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.25, 0.25) })];

/** Plan de décoration plaqué sur le flanc (chaque sommet suit hwAt) ; lisible des deux côtés. */
function liveryPlanes(g, P, tex, [u0, u1, y0, y1]) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, roughness: 0.5, metalness: 0 });
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(u1 - u0, y1 - y0, 24, 6); pg.rotateY(s * Math.PI / 2);
    pg.translate(0, (y0 + y1) / 2, (u0 + u1) / 2);
    const p = pg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, s * (P.hwAt(p.getZ(i), p.getY(i)) + 0.008));
    pg.computeVertexNormals();
    g.add(new THREE.Mesh(pg, mat));
  }
}

function buildSpecialVehicle(kind, x, z, rotY, snowDepth = 1) {
  const S = SPECIALS[kind], g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: S.color, roughness: 0.4, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 });
  const P = buildCarBody(g, kind, paint, snowDepth);
  liveryTex[kind] = liveryTex[kind] || S.livery();
  liveryPlanes(g, P, liveryTex[kind], S.area);
  const extra = [];
  if (kind === 'ambulance') {
    // rampe sur la cabine + feux d'angle sur la cellule, en alternance rouge / blanc
    const yCab = profileTop(P, 1.2) + CROWN;
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), beaconMats[k % 2]);
      m.position.set(-0.6 + k * 0.4, yCab + 0.07, 1.25); g.add(m);
    }
    for (const sx of [-1, 1]) for (const [u, k] of [[0.85, 0], [-3.05, 1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.12), beaconMats[(k + (sx > 0 ? 1 : 0)) % 2]);
      m.position.set(sx * (P.W / 2 - 0.1), P.roofMax - 0.12, u); g.add(m);
    }
  } else if (kind === 'icecream') {
    // cornet géant sur l'avant du toit (gaufre + volute), à moitié enneigé
    const cone = new THREE.ConeGeometry(0.28, 0.75, 16); cone.rotateX(Math.PI); cone.translate(0, P.roofMax + 0.6, 0.8);
    const swirl = []; for (const [dy, r] of [[1.1, 0.34], [1.33, 0.26], [1.51, 0.17], [1.65, 0.08]]) { const sp = new THREE.SphereGeometry(r, 14, 10); sp.scale(1, 0.75, 1); sp.translate(0, P.roofMax + dy, 0.8); swirl.push(sp); }
    g.add(new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ color: 0xc88a48, roughness: 0.8 })));
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 10), MAT.metal); stand.position.set(0, P.roofMax + 0.12, 0.8); g.add(stand);   // socle : le cornet ne tient pas sur sa pointe
    g.add(new THREE.Mesh(mergeGeometries(swirl), new THREE.MeshStandardMaterial({ color: 0xf6efe4, roughness: 0.6 })));
  } else if (kind === 'truck') {
    // porte roulante à l'arrière de la caisse
    const door = new THREE.Mesh(new THREE.PlaneGeometry(P.W * 0.8, 2.1), MAT.shutter); door.rotation.y = Math.PI; door.position.set(0, 1.95, P.uR - NOSE - 0.01); g.add(door);
  }
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  addCollider(x, z, P.W / 2 + 0.34, P.L / 2 + 0.4);
  addContactShadow(x, z, P.W / 2 + 0.45, P.L / 2 + 0.35, 0.62, rotY, 8);
  const sub = SPECIAL_SUBJECTS[kind];
  addSubject({ label: sub.label, value: sub.value, object: g, moment: sub.moment });
}

// sujets photo des utilitaires : l'ambulance vaut surtout gyrophares ALLUMÉS (instant à saisir)
let beaconLit = false;
const SPECIAL_SUBJECTS = {
  ambulance: { label: 'Une ambulance dans la tempête', value: 0.95, moment: () => (beaconLit ? { pts: 5, why: 'gyrophares allumés' } : { pts: 0, why: 'gyrophares éteints au déclenchement' }) },
  icecream:  { label: 'Un camion de glaces sous le blizzard', value: 0.9, moment: () => ({ pts: 3, why: 'un marchand de glaces en pleine tempête' }) },
  truck:     { label: 'Un camion de livraison enneigé', value: 0.6 },
  van:       { label: "Une camionnette d'artisan", value: 0.55 },
};

/** Animation (seulement des couleurs de matériau : les matrices restent figées).
 *  Gyrophares de l'ambulance : alternance rouge / blanc, deux éclats rapides par seconde. */
export function updateVehicles(t) {
  const ph = (t * 2.2) % 1, a = ph < 0.18 || (ph > 0.3 && ph < 0.46);
  beaconLit = a;
  beaconMats[0].color.setRGB(a ? 3.2 : 0.3, a ? 0.2 : 0.02, a ? 0.12 : 0.02);
  beaconMats[1].color.setScalar(a ? 0.25 : 2.6);
}

buildTaxi(ROAD_HALF - 1.3, 4.5, 0.02);
buildTaxi(-(ROAD_HALF - 1.3), -40, -0.03);
buildTaxi(ROAD_HALF - 1.3, -62, 0.01);

// File de voitures garées des deux côtés, avec des trous — une rangée continue
// ferait décor de jeu ; les intervalles irréguliers et le mélange de gabarits font vrai.
const CAR_COLORS = [0x1b232e, 0x2c2320, 0x353a41, 0x1f2a33, 0x101215, 0x4a1f1b, 0x28322c];
{
  let ci = 0;
  const kinds = ['sedan', 'suv', 'sedan', 'hatch', 'sedan', 'suv', 'hatch', 'sedan', 'suv'];
  const park = (side, z, snowDepth) => {
    // les voitures garées regardent toutes dans le sens de la circulation de leur côté
    buildParkedCar(side * (ROAD_HALF - 1.3), z, (side < 0 ? 0 : Math.PI) + side * 0.01 * ((ci % 3) - 1),
      CAR_COLORS[ci % CAR_COLORS.length], snowDepth, kinds[ci % kinds.length]); ci++;
  };
  // emplacements de la rue ; à gauche, on laisse la devanture du deli dégagée (et le point de vue « z=deli » libre)
  const slots = [...[-9, -21.5, -34, -53, -75].map(z => [1, z]),
                 ...[-15, -28, -47, -68].filter(z => Math.abs(z - deliZ) > 7).map(z => [-1, z])];
  // les 4 utilitaires prennent 4 emplacements tirés au hasard À CHAQUE LANCEMENT (mélange de
  // Fisher-Yates) : on les croise un peu partout d'une partie à l'autre. Tous les emplacements
  // sont espacés d'au moins 12,5 m et à 7 m au moins des taxis : même le camion (7 m) y tient.
  const order = slots.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const specialAt = new Map(['van', 'truck', 'icecream', 'ambulance'].map((k, n) => [order[n], k]));
  slots.forEach(([side, z], i) => {
    const depth = 0.8 + Math.random() * 0.5, sp = specialAt.get(i);
    if (sp) buildSpecialVehicle(sp, side * (ROAD_HALF - 1.35), z, side < 0 ? 0 : Math.PI, depth); else park(side, z, depth);
  });
}
