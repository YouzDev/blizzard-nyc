import * as THREE from 'three';
import { ROAD_HALF, SIDEWALK_W, SIDEWALK_H, STREET_Z_MIN, STREET_Z_MAX } from '../core/constants.js';
import { smoothNoise } from '../core/noise.js';
import { scene } from '../core/scene.js';
import { snowWalk, snowRoad } from '../textures/index.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { groundWeather, groundPhoto } from './weathering.js';
import { usePhoto } from '../textures/photo.js';

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
export const STREET_LEN = STREET_Z_MAX - STREET_Z_MIN + 20;
export const STREET_ZC = (STREET_Z_MAX + STREET_Z_MIN) / 2;

/* Hauteur de la neige, en coordonnées LOCALES aux maillages (z relatif à STREET_ZC).
   Ces deux fonctions servent à la fois à déplacer les vertex des plans et à poser au
   sol tout ce qui doit épouser le relief (ombres de contact) : une seule source de
   vérité, sinon les décalques flottent ou s'enterrent dans les creux. */
function roadSnowY(x, zl) {
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
  // cratère de fonte autour des plaques d'égout : la neige retombe à zéro en ~1 m
  for (const [mx, mz] of MANHOLES) {
    const d = Math.hypot(x - mx, zl + STREET_ZC - mz);
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
/** Hauteur du sol en coordonnées MONDE. */
export function groundY(x, z) {
  const zl = z - STREET_ZC;
  if (Math.abs(x) < ROAD_HALF) return roadSnowY(x, zl);
  const s = x < 0 ? -1 : 1;
  return SIDEWALK_H + walkSnowY(x - s * (ROAD_HALF + SIDEWALK_W / 2), zl, s);
}

{
  const len = STREET_LEN, zc = STREET_ZC;

  // Chaussée : plan subdivisé, vertex déplacés (bruit + sillons)
  const roadW = 2 * ROAD_HALF + 0.3;
  const roadGeo = new THREE.PlaneGeometry(roadW, len, 64, 620);
  roadGeo.rotateX(-Math.PI / 2);
  const rp = roadGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    rp.setY(i, roadSnowY(rp.getX(i), rp.getZ(i)));
  }
  roadGeo.computeVertexNormals();
  // la texture couvre toute la largeur de la chaussée, tuile de 12,3 m en long
  for (const t of [snowRoad.map, snowRoad.normal, snowRoad.rough]) t.repeat.set(1, len / 12.3);
  const road = shadowed(new THREE.Mesh(roadGeo, groundWeather(new THREE.MeshStandardMaterial({
    map: snowRoad.map, normalMap: snowRoad.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: snowRoad.rough, roughness: 1, color: 0xdce2eb, emissiveMap: snowRoad.map, emissive: SNOW_SKYGLOW }))), false, true);   // neige tassée, ornières grises
  road.position.set(0, 0, zc); road.userData.noOcclude = true; scene.add(road);   // (noOcclude : ignoré par les rayons de la notation photo)
  // photo : neige damée sur asphalte (tuile de 2 m) ; ornières et gadoue du canvas par-dessus
  groundPhoto(road.material, 'asphalt_snow', roadW / 2, len / 2, null, [0.62, 0.65, 0.7]);   // plus grise que le trottoir

  // Trottoirs : neige vallonnée, plus épaisse près des façades — et nettement plus BLANCHE que la chaussée
  // la texture couvre toute la largeur du trottoir (bordure → façade), tuile de 4,5 m en long (3 dalles)
  for (const t of [snowWalk.map, snowWalk.normal, snowWalk.rough]) t.repeat.set(1, len / 4.5);
  const walkMat = groundWeather(new THREE.MeshStandardMaterial({ map: snowWalk.map, normalMap: snowWalk.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: snowWalk.rough, roughness: 1, color: 0xf2f5fa, emissiveMap: snowWalk.map, emissive: SNOW_SKYGLOW }));   // la surface la plus claire du cadre
  // Bourrelet de déneigement : neige sale poussée par la lame contre la bordure, irrégulier,
  // avec des trouées (passages piétons dégagés, places où une voiture stationnait).
  // photo : neige tassée (sentier, côté rue) mélangée à la neige fraîche côté façade (tuiles de 2 m)
  // comme sur le modèle : neige fraîche blanche sur presque toute la largeur (la neige tassée, grise
  // et granuleuse, ne reste qu'en bande étroite contre la bordure, contraste réduit de moitié),
  // traces de pas du canvas creusées en relief
  groundPhoto(walkMat, 'snow_floor', (SIDEWALK_W + 0.2) / 2, len / 2, 'snow_02', [0.8, 0.83, 0.88], { blendU: [0.06, 0.28], contrast: 0.5, overlayRelief: 1 });
  const ridgeMat = groundWeather(new THREE.MeshStandardMaterial({ map: snowRoad.map.clone(), normalMap: snowRoad.normal.clone(), normalScale: new THREE.Vector2(0.9, 0.9), color: 0xe2e7ef, roughness: 1, emissiveMap: snowRoad.map.clone(), emissive: SNOW_SKYGLOW }), 0.6);   // neige repoussée, blanche
  for (const tx of [ridgeMat.map, ridgeMat.normalMap]) { tx.repeat.set(0.15, len / 12.3); tx.needsUpdate = true; }   // la bande propre, le long des voitures
  groundPhoto(ridgeMat, 'snow_03', 1.8 / 2, len / 2, null, [0.72, 0.75, 0.8]);      // photo : neige grumeleuse, blanchie
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(SIDEWALK_W + 0.2, len, 30, 680); g.rotateX(-Math.PI / 2);
    if (s < 0) g.rotateY(Math.PI);        // u = 0 de la texture (neige grise) doit toujours tomber côté rue
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, walkSnowY(p.getX(i), p.getZ(i), s));
    }
    g.computeVertexNormals();
    const walk = shadowed(new THREE.Mesh(g, walkMat), false, true);
    walk.position.set(s * (ROAD_HALF + SIDEWALK_W / 2), SIDEWALK_H, zc); walk.userData.noOcclude = true; scene.add(walk);
    // Bordure en granit : 22 cm de haut, face côté rue visible (15–20 cm au-dessus de la gadoue)
    const curbMat = MAT.granite.clone(); usePhoto(curbMat, 'concrete_wall_008', len / 2.7, 0.1);   // pierre taillée, gris granit (couleur du matériau)
    const curb = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.32, SIDEWALK_H + 0.06, len), curbMat), false, true);
    curb.position.set(s * (ROAD_HALF + 0.04), (SIDEWALK_H + 0.06) / 2 - 0.01, zc); scene.add(curb);
    const curbSnow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, len), MAT.snow);          // fine pellicule sur le dessus
    curbSnow.position.set(s * (ROAD_HALF + 0.1), SIDEWALK_H + 0.07, zc); scene.add(curbSnow);

    // Bourrelet : bande subdivisée, profil en cloche centré juste devant la bordure,
    // hauteur qui varie le long de la rue (0,2 → 0,7 m) et s'effondre dans les trouées
    const rw = 1.8, rg = new THREE.PlaneGeometry(rw, len, 12, 560); rg.rotateX(-Math.PI / 2);
    const rp2 = rg.attributes.position;
    for (let i = 0; i < rp2.count; i++) {
      const lx = rp2.getX(i), z = rp2.getZ(i) + zc;
      const bell = Math.exp(-(lx * lx) / (0.5 * 0.5));
      const gap = smoothNoise(z * 0.11 + s * 13, 2.5);                                          // trouées : bruit lent
      const along = 0.2 + 0.5 * smoothNoise(z * 0.45 + s * 5, 7.3);
      const h = (gap < 0.3 ? 0.06 : along) * bell + (smoothNoise(lx * 4 + s, z * 3) * 0.09 + smoothNoise(lx * 9, z * 8) * 0.03) * bell;   // mottes
      rp2.setY(i, h);
    }
    rg.computeVertexNormals();
    const ridge = shadowed(new THREE.Mesh(rg, ridgeMat), false, true);
    ridge.position.set(s * (ROAD_HALF - 0.42), 0.06, zc); ridge.userData.noOcclude = true; scene.add(ridge);
  }
}
