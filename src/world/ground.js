import * as THREE from 'three';
import { ROAD_HALF, SIDEWALK_W, SIDEWALK_H, FACADE_X, STREET_Z_MAX, CROSS_Z, LEFT_END_X } from '../core/constants.js';
import { smoothNoise } from '../core/noise.js';
import { snowWalk, snowRoad } from '../textures/index.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { groundWeather, groundPhoto } from './weathering.js';
import { usePhoto } from '../textures/photo.js';
import { MAIN, LEFT, LEFT_CHUNKS } from './street.js';

/* =====================================================================
   5. SOL : neige déformée (congères, sillons de pneus), trottoirs, bordures
   ===================================================================== */
/* Lueur propre de la neige : une nuit de tempête en ville, la neige renvoie la lueur
   orangée-bleutée du ciel bas de tous côtés, et elle reste LISIBLE même loin des
   lampadaires — gris-bleu, jamais noire (voir la référence). Émissif très faible,
   modulé par la texture (les empreintes restent visibles) ; ne rehausse rien d'autre
   que la neige, donc la scène reste aussi nocturne. */
const SNOW_SKYGLOW = new THREE.Color(0.05, 0.06, 0.085);
/** Plaques d'égout (x, z monde) : la vapeur chaude fait fondre la neige autour, la
 *  plaque reste à nu sur l'asphalte mouillé. Partagé avec fx/steam.js, qui pose les
 *  plaques et les panaches exactement là où la chaussée a été creusée. */
export const MANHOLES = [[-1.6, -7], [1.7, -31], [-1.3, -57]];

// Carrefour : bordures et façades de la transversale (z), lignes de façade de la rue principale (x)
const CURB_N = CROSS_Z + ROAD_HALF, CURB_F = CROSS_Z - ROAD_HALF;      // −90 (côté joueur) / −102
const FACE_N = CROSS_Z + FACADE_X, FACE_F = CROSS_Z - FACADE_X;        // −84,8 / −107,2
// Origine du bruit le long de chaque rue (la rue principale garde la sienne : même relief qu'avant)
MAIN.noiseZ0 = -25; LEFT.noiseZ0 = 40;
// Longueur de RÉFÉRENCE des matériaux de sol : leur répétition de texture est réglée pour elle,
// et chaque plan met ses UV à l'échelle de sa propre longueur. Une seule série de matériaux
// pour toutes les rues, des tuiles de même taille partout.
const GROUND_REF = 152;

/* Hauteur de la neige, dans le repère d'une rue (x en travers, zl le long, relatif à
   l'origine du bruit). Ces fonctions servent à la fois à déplacer les vertex des plans et
   à poser au sol tout ce qui doit épouser le relief (ombres de contact) : une seule
   source de vérité, sinon les décalques flottent ou s'enterrent dans les creux. */
function roadSnowY(x, zl, manholes) {
  // trois octaves : grandes ondulations, mottes, granulé — la chaussée de la
  // référence est de la neige labourée, pas une surface lisse
  // couche de neige épaisse (~8 cm de base) et bosselée : sur la référence la
  // chaussée est BLANCHE, labourée, pas une gadoue grise et plate
  let y = 0.06 + smoothNoise(x * 0.5, zl * 0.5) * 0.12 + smoothNoise(x * 1.7, zl * 1.4) * 0.06
        + smoothNoise(x * 4.5, zl * 4.5) * 0.025 + smoothNoise(x * 11, zl * 11) * 0.008;
  // ornières : deux voies, deux traces par voie — EXACTEMENT là où la texture de
  // chaussée dessine l'asphalte mouillé (x = ±0,8 et ±2,4)
  for (const rx of [-2.4, -0.8, 0.8, 2.4]) { const d = Math.abs(x - rx); y -= 0.09 * Math.exp(-d * d * 18); }
  for (const bx of [-3.4, -1.6, 0, 1.6, 3.4]) { const d = Math.abs(x - bx); y += 0.05 * Math.exp(-d * d * 6); }   // bourrelets repoussés entre les traces
  y -= 0.03 * Math.exp(-x * x * 0.35);                                      // léger creux au milieu de la chaussée
  // cratère de fonte autour des plaques d'égout (rue principale) : la neige retombe à zéro en ~1 m
  if (manholes) for (const [mx, mz] of MANHOLES) {
    const d = Math.hypot(x - mx, zl + MAIN.noiseZ0 - mz);
    if (d < 1.5) y *= THREE.MathUtils.smoothstep(d, 0.5, 1.45);
  }
  // La chaussée reste BASSE jusqu'à la bordure : c'est le décrochement (face de la
  // bordure + bourrelet de déneigement) qui sépare route et trottoir, pas une pente.
  return y;
}
/* Neige du trottoir, comme sur la référence : une couche épaisse, des CONGÈRES qui
   montent contre les façades (jusqu'à ~40 cm, plus ou moins selon l'endroit), un
   SENTIER piétiné un peu creusé au milieu, des mottes partout. */
function walkSnowY(lx, zl, s) {
  // 0 côté rue, 1 côté façade — BORNÉ : le plan déborde de 10 cm et Math.pow(u < 0, 2.4) = NaN
  const u = Math.min(1, Math.max(0, (lx * s + SIDEWALK_W / 2) / SIDEWALK_W));
  const drift = Math.pow(u, 2.4) * 0.34 * (0.55 + 0.9 * smoothNoise(zl * 0.22 + s * 7, 3.1));
  const path = -0.06 * Math.exp(-Math.pow((u - 0.45) / 0.17, 2)) * (0.6 + 0.8 * smoothNoise(zl * 0.5, s * 5));
  return 0.05 + drift + path
       + smoothNoise(lx * 0.8 + s * 9, zl * 0.6) * 0.09 + smoothNoise(lx * 2.2, zl * 2.2) * 0.05
       + smoothNoise(lx * 6 + s * 4, zl * 6) * 0.02 + smoothNoise(lx * 14, zl * 14) * 0.007;
}
/** Hauteur du sol d'une rue, dans son repère (lx, lz), hors raccords de carrefour. */
function streetGroundY(st, lx, lz) {
  const zl = lz - st.noiseZ0;
  if (Math.abs(lx) < ROAD_HALF) return roadSnowY(lx, zl, st === MAIN);
  const s = lx < 0 ? -1 : 1;
  return SIDEWALK_H + walkSnowY(lx - s * (ROAD_HALF + SIDEWALK_W / 2), zl, s);
}
const leftY = (x, z) => streetGroundY(LEFT, LEFT.lx(x, z), LEFT.lz(x, z));
/** Chaussée de la rue principale, prolongée telle quelle dans le carrefour. */
const mainRoadY = (x, z) => roadSnowY(x, z - MAIN.noiseZ0, true);
/** Chaussée de la rue de gauche : ses 3 derniers mètres se fondent dans celle du carrefour. */
function leftRoadY(x, z) {
  const hL = roadSnowY(LEFT.lx(x, z), LEFT.lz(x, z) - LEFT.noiseZ0, false);
  const t = THREE.MathUtils.smoothstep(x, -ROAD_HALF - 3.15, -ROAD_HALF - 0.15);
  return t > 0 ? THREE.MathUtils.lerp(hL, mainRoadY(x, z), t) : hL;
}
/* Les deux coins de trottoir du carrefour : la neige y passe en fondu de celle d'une rue à
   celle de l'autre. Poids w = 1 sur le bord qui touche le trottoir de la rue de gauche, 0 sur
   celui qui touche la rue principale, quelle que soit la position le long de ces bords : les
   raccords sont exacts, sans marche. a, b : 0 → 1 en travers de chaque trottoir. */
function cornerNearY(x, z) {     // coin côté feux : bordures sur deux côtés
  const a = (-ROAD_HALF - x) / SIDEWALK_W, b = (z - CURB_N) / SIDEWALK_W;
  const w = a * (1 - b) / (a * (1 - b) + b * (1 - a) + 1e-6);
  return THREE.MathUtils.lerp(streetGroundY(MAIN, x, z), leftY(x, z), w);
}
function cornerFarY(x, z) {      // coin rentrant d'en face : façades sur deux côtés
  const a = (x - ROAD_HALF) / SIDEWALK_W, b = (CURB_F - z) / SIDEWALK_W;
  const w = b * (1 - a) / (b * (1 - a) + a * (1 - b) + 1e-6);
  return THREE.MathUtils.lerp(streetGroundY(MAIN, x, z), leftY(x, z), w);
}

/** Hauteur du sol en coordonnées MONDE (rue principale, carrefour, rue de gauche). */
export function groundY(x, z) {
  if (z > FACE_N) return streetGroundY(MAIN, x, z);
  if (z >= CURB_N) {                                      // bande du trottoir côté feux
    if (x >= -ROAD_HALF) return streetGroundY(MAIN, x, z);
    if (x >= -FACADE_X) return cornerNearY(x, z);
    return leftY(x, z);
  }
  if (z >= CURB_F) {                                      // chaussée de la transversale
    if (x >= ROAD_HALF) return streetGroundY(MAIN, x, z); // trottoir de droite de la rue principale
    if (x >= -ROAD_HALF - 0.15) return mainRoadY(x, z);   // carrefour
    return leftRoadY(x, z);
  }
  if (z >= FACE_F) {                                      // trottoir d'en face
    if (x >= ROAD_HALF) return x <= FACADE_X ? cornerFarY(x, z) : 0;
    return leftY(x, z);
  }
  return 0;
}
/** Distance (m) au bord de chaussée le plus proche, côté trottoir (< 0 sur la chaussée) :
 *  sert à la hauteur des yeux du joueur (player/controls.js), même découpage que groundY. */
export function curbDistance(x, z) {
  if (z > FACE_N) return Math.abs(x) - ROAD_HALF;
  if (z >= CURB_N) {
    if (x >= -ROAD_HALF) return Math.abs(x) - ROAD_HALF;
    if (x >= -FACADE_X) return Math.min(-ROAD_HALF - x, z - CURB_N);
    return z - CURB_N;
  }
  if (z >= CURB_F) return x >= ROAD_HALF ? x - ROAD_HALF : -Math.min(z - CURB_F, CURB_N - z);
  if (x >= ROAD_HALF) return Math.hypot(x - ROAD_HALF, CURB_F - z);
  return CURB_F - z;
}

/* ---------------------------------------------------------------------
   Matériaux partagés (répétitions réglées pour GROUND_REF)
   --------------------------------------------------------------------- */
// Chaussée : neige tassée, ornières grises ; la texture couvre toute la largeur, tuile de 12,3 m en long
for (const t of [snowRoad.map, snowRoad.normal, snowRoad.rough]) t.repeat.set(1, GROUND_REF / 12.3);
const roadMat = groundWeather(new THREE.MeshStandardMaterial({
  map: snowRoad.map, normalMap: snowRoad.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: snowRoad.rough, roughness: 1, color: 0xdce2eb, emissiveMap: snowRoad.map, emissive: SNOW_SKYGLOW }));
// photo : neige damée sur asphalte (tuile de 2 m) ; ornières et gadoue du canvas par-dessus
groundPhoto(roadMat, 'asphalt_snow', (2 * ROAD_HALF + 0.3) / 2, GROUND_REF / 2, null, [0.62, 0.65, 0.7]);   // plus grise que le trottoir
// Trottoirs : neige vallonnée, plus épaisse près des façades — et nettement plus BLANCHE que la chaussée
// la texture couvre toute la largeur du trottoir (bordure → façade), tuile de 4,5 m en long (3 dalles)
for (const t of [snowWalk.map, snowWalk.normal, snowWalk.rough]) t.repeat.set(1, GROUND_REF / 4.5);
const walkMat = groundWeather(new THREE.MeshStandardMaterial({ map: snowWalk.map, normalMap: snowWalk.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: snowWalk.rough, roughness: 1, color: 0xf2f5fa, emissiveMap: snowWalk.map, emissive: SNOW_SKYGLOW }));   // la surface la plus claire du cadre
// photo : neige tassée (sentier, côté rue) mélangée à la neige fraîche côté façade (tuiles de 2 m)
// comme sur le modèle : neige fraîche blanche sur presque toute la largeur (la neige tassée, grise
// et granuleuse, ne reste qu'en bande étroite contre la bordure, contraste réduit de moitié),
// traces de pas du canvas creusées en relief
groundPhoto(walkMat, 'snow_floor', (SIDEWALK_W + 0.2) / 2, GROUND_REF / 2, 'snow_02', [0.8, 0.83, 0.88], { blendU: [0.06, 0.28], contrast: 0.5, overlayRelief: 1 });
// Bourrelet de déneigement : neige sale poussée par la lame contre la bordure, irrégulier,
// avec des trouées (passages piétons dégagés, places où une voiture stationnait).
const ridgeMat = groundWeather(new THREE.MeshStandardMaterial({ map: snowRoad.map.clone(), normalMap: snowRoad.normal.clone(), normalScale: new THREE.Vector2(0.9, 0.9), color: 0xe2e7ef, roughness: 1, emissiveMap: snowRoad.map.clone(), emissive: SNOW_SKYGLOW }), 0.6);   // neige repoussée, blanche
for (const tx of [ridgeMat.map, ridgeMat.normalMap]) { tx.repeat.set(0.15, GROUND_REF / 12.3); tx.needsUpdate = true; }   // la bande propre, le long des voitures
groundPhoto(ridgeMat, 'snow_03', 1.8 / 2, GROUND_REF / 2, null, [0.72, 0.75, 0.8]);      // photo : neige grumeleuse, blanchie

/** UV v d'un plan de longueur len mises à l'échelle de la longueur de référence. */
function scaleV(g, len) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / GROUND_REF); }

/* ---------------------------------------------------------------------
   Sol d'une rue, dans son repère : chaussée, trottoirs, bordures, bourrelets.
   Chaque pièce a sa propre étendue le long de la rue (carrefour, impasse) ; `roadY(lx, lz)`
   donne la hauteur de la chaussée (raccords compris). `chunks` : limites de tronçons (z de la
   rue) — chaque pièce est alors coupée en plans séparés, masquables (voir street.js). Pour
   qu'aucune couture ne se voie entre deux plans, leurs normales sont tirées de la fonction de
   hauteur elle-même (et non des triangles de chaque plan) et leurs UV suivent la position le
   long de la rue.
   --------------------------------------------------------------------- */
function buildStreetGround(st, spec, chunks = []) {
  const cut = (z0, z1) => { const out = []; let a = z0; for (const b of chunks) if (b > a && b < z1) { out.push([a, b]); a = b; } out.push([a, z1]); return out; };
  /** Plan de largeur w posé de z0 à z1 ; h(px, pz, zc) : hauteur en coordonnées du plan (après la
   *  rotation éventuelle, px et pz sont relatifs à son centre, dans le repère de la rue). */
  const strip = (w, z0, z1, segW, step, flip, h, mat, cx, cy) => {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const g = new THREE.PlaneGeometry(w, len, segW, Math.max(1, Math.round(len / step))); g.rotateX(-Math.PI / 2);
    if (flip) g.rotateY(Math.PI);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, h(p.getX(i), p.getZ(i), zc));
    if (chunks.length) {
      const n = g.attributes.normal, uv = g.attributes.uv, e = 0.05;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), pz = p.getZ(i);
        const dx = (h(px + e, pz, zc) - h(px - e, pz, zc)) / (2 * e), dz = (h(px, pz + e, zc) - h(px, pz - e, zc)) / (2 * e), l = Math.hypot(dx, 1, dz);
        n.setXYZ(i, -dx / l, 1 / l, -dz / l);
        uv.setY(i, (zc + pz) / GROUND_REF);
      }
    } else { g.computeVertexNormals(); scaleV(g, len); }
    const m = shadowed(new THREE.Mesh(g, mat), false, true);
    m.position.set(cx, cy, zc); m.userData.noOcclude = true; st.add(m);   // (noOcclude : ignoré par les rayons de la notation photo)
  };
  // Chaussée : plan subdivisé, vertex déplacés (bruit + sillons)
  for (const [z0, z1] of cut(...spec.road)) strip(2 * ROAD_HALF + 0.3, z0, z1, 64, 0.245, false, (px, pz, zc) => spec.roadY(px, zc + pz), roadMat, 0, 0);
  for (const s of [-1, 1]) {
    const side = s < 0 ? spec.left : spec.right;
    // Trottoir : u = 0 de la texture (neige grise) doit toujours tomber côté rue
    for (const [z0, z1] of cut(...side.walk))
      strip(SIDEWALK_W + 0.2, z0, z1, 30, 0.22, s < 0, (px, pz, zc) => walkSnowY(px, zc + pz - st.noiseZ0, s), walkMat, s * (ROAD_HALF + SIDEWALK_W / 2), SIDEWALK_H);
    // Bordure en granit : 22 cm de haut, face côté rue visible (15–20 cm au-dessus de la gadoue)
    for (const [z0, z1] of cut(...side.curb)) {
      const len = z1 - z0, zc = (z0 + z1) / 2;
      const curbMat = MAT.granite.clone(); usePhoto(curbMat, 'concrete_wall_008', len / 2.7, 0.1);   // pierre taillée, gris granit (couleur du matériau)
      const curb = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.32, SIDEWALK_H + 0.06, len), curbMat), false, true);
      curb.position.set(s * (ROAD_HALF + 0.04), (SIDEWALK_H + 0.06) / 2 - 0.01, zc); st.add(curb);
      const curbSnow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, len), MAT.snow);          // fine pellicule sur le dessus
      curbSnow.position.set(s * (ROAD_HALF + 0.1), SIDEWALK_H + 0.07, zc); st.add(curbSnow);
    }
    // Bourrelet : bande subdivisée, profil en cloche centré juste devant la bordure,
    // hauteur qui varie le long de la rue (0,2 → 0,7 m), s'effondre dans les trouées et
    // s'amenuise à ses deux bouts (passages piétons du carrefour)
    const [r0, r1] = side.ridge;
    const ridgeH = (lx, z) => {
      const bell = Math.exp(-(lx * lx) / (0.5 * 0.5));
      const gap = smoothNoise(z * 0.11 + s * 13, 2.5);                                          // trouées : bruit lent
      const along = 0.2 + 0.5 * smoothNoise(z * 0.45 + s * 5, 7.3);
      const ends = THREE.MathUtils.smoothstep(z, r0, r0 + 1.6) * (1 - THREE.MathUtils.smoothstep(z, r1 - 1.6, r1));
      return ((gap < 0.3 ? 0.06 : along) * bell + (smoothNoise(lx * 4 + s, z * 3) * 0.09 + smoothNoise(lx * 9, z * 8) * 0.03) * bell) * ends;   // mottes
    };
    for (const [z0, z1] of cut(r0, r1)) strip(1.8, z0, z1, 12, 0.27, false, (px, pz, zc) => ridgeH(px, zc + pz), ridgeMat, s * (ROAD_HALF - 0.42), 0.06);
  }
}

// Rue principale : la chaussée descend jusqu'à la bordure d'en face de la transversale (le
// carrefour lui appartient) ; le trottoir de gauche s'arrête au coin, celui de droite longe
// la rangée d'immeubles jusqu'au trottoir d'en face. Bourrelets interrompus aux passages piétons.
buildStreetGround(MAIN, {
  road: [CURB_F, STREET_Z_MAX + 10], roadY: (lx, lz) => mainRoadY(lx, lz),
  left: { walk: [FACE_N, STREET_Z_MAX + 10], curb: [CURB_N - 0.12, STREET_Z_MAX + 10], ridge: [CURB_N + 4, STREET_Z_MAX + 10] },
  right: { walk: [CURB_F, STREET_Z_MAX + 10], curb: [CURB_F, STREET_Z_MAX + 10], ridge: [CURB_N + 2, STREET_Z_MAX + 10] },
});
// Rue de gauche (dans son repère : z le long de la rue, vers −x monde) : de l'impasse au carrefour.
// La chaussée finit au bord de celle de la rue principale ; le trottoir côté feux au coin, celui
// d'en face au trottoir de droite de la rue principale (fond du T).
buildStreetGround(LEFT, {
  road: [LEFT_END_X, -ROAD_HALF - 0.15], roadY: (lx, lz) => leftRoadY(LEFT.wx(lx, lz), LEFT.wz(lx, lz)),
  left: { walk: [LEFT_END_X, -FACADE_X], curb: [LEFT_END_X, -ROAD_HALF + 0.12], ridge: [LEFT_END_X + 2, -FACADE_X - 1] },
  right: { walk: [LEFT_END_X, ROAD_HALF], curb: [LEFT_END_X, ROAD_HALF + 0.2], ridge: [LEFT_END_X + 2, ROAD_HALF - 3] },
}, LEFT_CHUNKS);

/* Coins de trottoir du carrefour : petits plans en coordonnées monde, hauteur = groundY
   (fondu entre les deux trottoirs), UV raccordées à celles des trottoirs voisins : u = 0 contre
   les bordures (neige tassée), 1 contre les façades. */
function cornerPatch(x0, x1, z0, z1, uOf, vOf) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 24, 24); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < p.count; i++) {
    const x = cx + p.getX(i), z = cz + p.getZ(i);
    p.setY(i, groundY(x, z)); uv.setXY(i, uOf(x, z), vOf(x, z));
  }
  g.computeVertexNormals();
  const m = shadowed(new THREE.Mesh(g, walkMat), false, true);
  m.position.set(cx, 0, cz); m.userData.noOcclude = true; MAIN.add(m);
}
const clamp01 = v => Math.min(1, Math.max(0, v));
cornerPatch(-FACADE_X, -ROAD_HALF, CURB_N, FACE_N,
  (x, z) => Math.min(clamp01((-ROAD_HALF - x) / SIDEWALK_W), clamp01((z - CURB_N) / SIDEWALK_W)), (x, z) => (z - FACE_N) / GROUND_REF);
cornerPatch(ROAD_HALF, FACADE_X, FACE_F, CURB_F,
  (x, z) => Math.max(clamp01((x - ROAD_HALF) / SIDEWALK_W), clamp01((CURB_F - z) / SIDEWALK_W)), (x, z) => 1 + (CURB_F - z) / GROUND_REF);

// (au fond de l'impasse, chaussée et trottoirs vont jusqu'aux façades ; la neige poussée par
// les chasse-neige y est posée par props.js)
export { FACE_N, FACE_F, CURB_N, CURB_F };
