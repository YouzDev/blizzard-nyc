import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { renderer } from '../core/renderer.js';
import { POINT_LIGHT_SLOTS } from '../core/lightLoop.js';
import { pointSources, spotSources } from './lightRegistry.js';
import { moon } from './ambience.js';

/* =====================================================================
   7 ter. LUMIÈRES EN NOMBRE FIXE QUI SUIVENT LE JOUEUR
   Le nombre de lumières est écrit dans le texte de chaque shader et chaque pixel les
   passe toutes en revue : une ville deux fois plus grande, c'était deux fois plus de
   lumières, des shaders à recompiler (cache du navigateur perdu) et des images plus
   lentes partout. Lampadaires, lanternes et boutiques ne créent donc plus de lumière :
   ils déclarent une SOURCE (world/lightRegistry.js), et ce module tient un jeu FIXE de
   vraies lumières — 46 points + 16 projecteurs dont 6 à ombre, plus le néon et la lueur
   de la ville, fixes : exactement les nombres d'avant (48 points, 17 projecteurs, 7 ombres).
   Il les confie aux sources les plus proches du joueur :
     - points et projecteurs : les plus proches (points : distance au bord de leur portée,
       une lanterne de 6 m compte moins loin qu'un lampadaire de 24 m) ;
     - ombres : les 6 lampadaires les plus proches d'un point 10 m DEVANT le joueur — là
       où il regarde. Au départ, c'est exactement le jeu d'avant (z entre −30 et 25).
   Une source qui entre ou sort passe par un FONDU (0,6 s) ; une ombre qui change de
   lampadaire s'efface (0,45 s) avant d'échanger les deux lampes, puis réapparaît sur
   l'autre — le shader lit l'intensité d'ombre dans shadow.radius (voir core/lightLoop.js).
   Une source déjà servie garde un avantage de 3 à 4 m : pas de va-et-vient à la limite.
   Ombres : calculées une fois, puis seulement pour la lampe qui vient de changer de place
   (shadow.autoUpdate = false sur chaque lumière, needsUpdate à la demande) ; la carte de
   la lune suit le joueur de la même façon (recalée tous les ~15 m).
   Inspection : window.__blizzard.lightPool (state, stats).
   ===================================================================== */
const SPOT_SLOTS = 16, SPOT_SHADOW_SLOTS = 6;
const POOL_FADE_S = 0.6, POOL_SHADOW_FADE_S = 0.45;
const POOL_HYST = 3, POOL_HYST_SHADOW = 4;
const SHADOW_AHEAD = 10;
const MOON_LEAD = 15, MOON_MOVE = 15, MOON_COOLDOWN = 1.5;
const MOON_OFFSET = new THREE.Vector3(-25, 45, -5);   // position − cible de la lune (direction inchangée)

const pointSlots = [], spotSlots = [], shadowSlots = [], plainSlots = [];
const poolCam = new THREE.Vector3(), poolAhead = new THREE.Vector3(), poolFwd = new THREE.Vector3(0, 0, -1), poolLead = new THREE.Vector3();
const lastAssignPos = new THREE.Vector3(1e9, 0, 0);
const moonCenter = new THREE.Vector3(0, 0, -15);      // centre de départ : celui d'ambience.js
let assignTimer = 0, moonCooldown = 0;

export const lightPool = {
  stats: { shadowRenders: 0, moonMoves: 0, handovers: 0 },
  get state() {
    const at = sl => sl.src ? `${sl.src.pos.x.toFixed(1)},${sl.src.pos.z.toFixed(1)}` : '-';
    return {
      sources: { points: pointSources.length, spots: spotSources.length },
      points: `${pointSlots.filter(s => s.src).length}/${pointSlots.length}`,
      spots: `${spotSlots.filter(s => s.src).length}/${spotSlots.length}`,
      shadows: shadowSlots.map(sl => `${at(sl)} ombre ${sl.shK.toFixed(2)}`),
      moon: `${moonCenter.x.toFixed(1)},${moonCenter.z.toFixed(1)}`,
    };
  },
};

/** Lumière rangée hors service : noire, sans portée, loin sous le sol (écartée au premier test du shader). */
function poolPark(l) {
  l.intensity = 0; l.distance = 0.001; l.position.set(0, -1000, 0); l.updateMatrix(); l.updateMatrixWorld();
  if (l.isSpotLight) { l.target.position.set(0, -1001, 0); l.target.updateMatrix(); l.target.updateMatrixWorld(); }
}
function poolBind(sl, s, fade) {
  sl.src = s; s.slot = sl; sl.fade = fade; sl.target = 1;
  const l = sl.light;
  l.color.copy(s.color); l.distance = s.distance; l.decay = s.decay; l.position.copy(s.pos);
  if (l.isSpotLight) { l.angle = s.angle; l.penumbra = s.penumbra; l.target.position.copy(s.target); l.target.updateMatrix(); l.target.updateMatrixWorld(); }
  l.updateMatrix(); l.updateMatrixWorld();
  l.intensity = s.intensity * (s.flick?.k ?? 1) * fade;
}
function poolUnbind(sl) {
  if (sl.src && sl.src.slot === sl) sl.src.slot = null;
  sl.src = null; sl.fade = 0; sl.target = 0; sl.handover = null;
  poolPark(sl.light);
}
/** Déplace la source du projecteur P vers H (libre), avec son état de fondu. */
function poolMove(P, H) {
  const s = P.src, f = P.fade, t = P.target;
  poolUnbind(P); poolBind(H, s, f); H.target = t;
}
/** Échange les sources de deux projecteurs (chacune garde son fondu). */
function poolSwap(a, b) {
  const sa = a.src, sb = b.src, fa = a.fade, fb = b.fade, ta = a.target, tb = b.target;
  if (sb) poolBind(a, sb, fb); else poolUnbind(a);
  a.target = tb;
  if (sa) poolBind(b, sa, fa); else poolUnbind(b);
  b.target = ta;
}
function poolShadowRender(sl) {
  sl.light.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; lightPool.stats.shadowRenders++;
}
/** Les n meilleures sources selon key (plus petit = plus important). */
function poolRank(list, n, key) {
  for (const s of list) s._k = key(s);
  return list.slice().sort((a, b) => a._k - b._k).slice(0, n);
}

function assignPoints(instant) {
  const want = poolRank(pointSources, pointSlots.length, s => s.pos.distanceTo(poolCam) - s.distance - (s.slot ? POOL_HYST : 0));
  const wanted = new Set(want);
  for (const sl of pointSlots) if (sl.src && !wanted.has(sl.src)) { if (instant) poolUnbind(sl); else sl.target = 0; }
  for (const s of want) {
    if (s.slot) { s.slot.target = 1; continue; }                 // redemandée : annule un fondu de sortie
    const free = pointSlots.find(sl => !sl.src);
    if (!free) break;                                             // une place se libère à la fin d'un fondu
    poolBind(free, s, instant ? 1 : 0);
  }
}

function assignSpots(instant) {
  const want = poolRank(spotSources, spotSlots.length, s => s.pos.distanceTo(poolCam) - (s.slot ? POOL_HYST : 0));
  const wanted = new Set(want);
  const wantShadow = new Set(poolRank(want, shadowSlots.length, s => s.pos.distanceTo(poolAhead) - (s.slot?.shadow ? POOL_HYST_SHADOW : 0)));
  for (const sl of spotSlots) if (sl.src && !wanted.has(sl.src)) { if (instant) poolUnbind(sl); else sl.target = 0; }
  for (const s of want) {
    if (s.slot) { s.slot.target = 1; continue; }
    const free = (wantShadow.has(s) ? shadowSlots : plainSlots).find(sl => !sl.src) || spotSlots.find(sl => !sl.src);
    if (!free) continue;
    poolBind(free, s, instant ? 1 : 0);
    // la lumière part de zéro : son ombre peut être pleine tout de suite, rien ne saute
    if (free.shadow) { free.shK = 1; free.shTarget = 1; free.handover = null; poolShadowRender(free); }
  }
  // ombres : un lampadaire qui la mérite mais attend dans un projecteur sans ombre
  for (const s of wantShadow) {
    const P = s.slot;
    if (!P || P.shadow) continue;
    let H = shadowSlots.find(sl => !sl.src);
    if (H) { poolMove(P, H); H.shK = 0; H.shTarget = 1; H.handover = null; poolShadowRender(H); continue; }
    if (shadowSlots.some(sl => sl.handover === s)) continue;    // échange déjà en cours
    H = shadowSlots.find(sl => sl.src && !wantShadow.has(sl.src) && !sl.handover);
    if (H) { H.handover = s; H.shTarget = 0; lightPool.stats.handovers++; }   // on efface d'abord l'ombre actuelle
  }
}

function poolAssign(camera, instant) {
  poolCam.copy(camera.position);
  poolFwd.set(0, 0, -1).applyQuaternion(camera.quaternion); poolFwd.y = 0;
  if (poolFwd.lengthSq() < 1e-4) poolFwd.set(0, 0, -1); else poolFwd.normalize();   // regard vertical : direction par défaut
  poolAhead.copy(poolCam).addScaledVector(poolFwd, SHADOW_AHEAD);
  assignPoints(instant);
  assignSpots(instant);
}

/** Crée les vraies lumières (APRÈS la construction de la rue, AVANT toute compilation) et
 *  fait une première répartition, sans fondu, autour de la caméra. */
export function initLightPool(camera) {
  let fixed = 0;
  scene.traverse(o => { if (o.isPointLight) fixed++; });          // néon, lueur de la ville : restent fixes
  for (let i = 0; i < Math.max(0, POINT_LIGHT_SLOTS - fixed); i++) {
    const l = new THREE.PointLight(0x000000, 0, 0.001, 2); l.name = 'lumiere-pool';
    poolPark(l); scene.add(l);
    pointSlots.push({ light: l, shadow: false, src: null, fade: 0, target: 0 });
  }
  for (let i = 0; i < SPOT_SLOTS; i++) {
    const shadow = i < SPOT_SHADOW_SLOTS;
    const l = new THREE.SpotLight(0x000000, 0, 0.001, 1.1, 0.8, 2); l.name = 'projecteur-pool';
    if (shadow) {
      l.castShadow = true; l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 0.45; l.shadow.camera.far = 30; l.shadow.bias = -0.0005; l.shadow.radius = 1;
    }
    scene.add(l); scene.add(l.target); poolPark(l);
    const sl = { light: l, shadow, src: null, fade: 0, target: 0, shK: 1, shTarget: 1, handover: null };
    spotSlots.push(sl); (shadow ? shadowSlots : plainSlots).push(sl);
  }
  // ombres à la demande, lumière par lumière (la 1re image les calcule toutes)
  scene.traverse(o => { if (o.isLight && o.castShadow) { o.shadow.autoUpdate = false; o.shadow.needsUpdate = !o.name.endsWith('-pool'); } });
  renderer.shadowMap.needsUpdate = true;
  poolAssign(camera, true);
  lastAssignPos.copy(camera.position);
}

function poolFade(sl, dt) {
  if (!sl.src) return;
  const k = dt / POOL_FADE_S;
  sl.fade = sl.target > sl.fade ? Math.min(sl.target, sl.fade + k) : Math.max(sl.target, sl.fade - k);
  if (sl.fade <= 0 && sl.target <= 0) { poolUnbind(sl); return; }
  sl.light.intensity = sl.src.intensity * (sl.src.flick?.k ?? 1) * sl.fade;   // scintillement du lampadaire compris
}
function poolShadowFade(H, dt) {
  const k = dt / POOL_SHADOW_FADE_S;
  H.shK = H.shTarget > H.shK ? Math.min(H.shTarget, H.shK + k) : Math.max(H.shTarget, H.shK - k);
  if (H.handover && H.shK <= 0) {
    // ombre effacée : les deux lampes échangent leur projecteur (image identique à cet instant),
    // puis l'ombre réapparaît sur la nouvelle
    const s = H.handover, P = s.slot;
    H.handover = null;
    if (H.src && P && P !== H && !P.shadow) { poolSwap(H, P); poolShadowRender(H); }
    H.shTarget = 1;
  }
  H.light.shadow.radius = H.shK;
}
function followMoon(camera, dt) {
  moonCooldown -= dt;
  poolLead.copy(camera.position).addScaledVector(poolFwd, MOON_LEAD);
  if (moonCooldown > 0 || Math.hypot(poolLead.x - moonCenter.x, poolLead.z - moonCenter.z) < MOON_MOVE) return;
  moonCooldown = MOON_COOLDOWN;
  moonCenter.set(poolLead.x, 0, poolLead.z);
  moon.target.position.copy(moonCenter); moon.position.copy(moonCenter).add(MOON_OFFSET);
  moon.target.updateMatrix(); moon.target.updateMatrixWorld(); moon.updateMatrix(); moon.updateMatrixWorld();
  moon.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; lightPool.stats.moonMoves++;
}

/** Des objets viennent d'apparaître ou de disparaître en nombre (masquage des rues, street.js) :
 *  les cartes d'ombre calculées pendant qu'ils étaient masqués n'ont pas leurs ombres — on refait
 *  celles des projecteurs en service et celle de la lune, une fois. */
export function refreshPoolShadows() {
  for (const sl of shadowSlots) if (sl.src) poolShadowRender(sl);
  moon.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
}

/** À chaque image, APRÈS le scintillement des lampes (main.js) et avant le rendu. */
export function updateLightPool(dt, camera) {
  assignTimer += dt;
  if (assignTimer > 0.2 || camera.position.distanceToSquared(lastAssignPos) > 0.25) {
    assignTimer = 0; lastAssignPos.copy(camera.position);
    poolAssign(camera, false);
  }
  for (const sl of pointSlots) poolFade(sl, dt);
  for (const sl of spotSlots) poolFade(sl, dt);
  for (const H of shadowSlots) poolShadowFade(H, dt);
  followMoon(camera, dt);
}
