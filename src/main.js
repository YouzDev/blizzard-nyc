import * as THREE from 'three';
// EN PREMIER : remplace le calcul des lumières dans les shaders avant toute compilation (voir le module)
import { lightLoop } from './core/lightLoop.js';
import { WALK_SPEED, PLAYER_RADIUS } from './core/constants.js';
import { collides } from './world/collisions.js';
import { renderer } from './core/renderer.js';
import { camera, scene, sky } from './core/scene.js';
import './core/environment.js';

// Modules de décor : importés pour leurs effets de bord, dans l'ordre de construction.
import './world/ground.js';
import './world/buildings.js';
import './world/props.js';
import { updateVehicles } from './world/vehicles.js';
import { neonMat, neonZ } from './world/neon.js';
import './world/ambience.js';
import { updateTrafficLights } from './world/intersection.js';
import { flickerLights } from './world/lightRegistry.js';
import { initLightPool, updateLightPool, lightPool } from './world/lightPool.js';
import { updateStreetVisibility, streetZones } from './world/street.js';

import { WIND, snowFar, snowMid, updateSnow, updateLampUniforms } from './fx/snow.js';
import { steamMats, updateSteam } from './fx/steam.js';
import { facePass, lens } from './fx/facePass.js';
import { composer } from './fx/postprocessing.js';
import { adaptiveRes } from './fx/adaptiveResolution.js';
import { hud, fwdDir, updatePlayer, keys } from './player/controls.js';
import { updateWind, windDebug } from './audio/wind.js';
import { snowBounce } from './world/weathering.js';
import { updatePhotoGame, afterRenderPhoto, photoDebug } from './game/photoGame.js';
import { prepareScene, startup } from './core/preload.js';

// Point de vue forçable par l'URL, pour les tests visuels : ?x=-6.5&z=deli&yaw=90&pitch=-5
// (yaw en degrés, 0 = vers −Z, 90 = vers −X ; « z=deli » vise l'enseigne néon).
{
  const q = new URLSearchParams(location.search);
  if (q.has('x')) camera.position.x = parseFloat(q.get('x'));
  if (q.has('z')) camera.position.z = q.get('z') === 'deli' ? neonZ + 3 : parseFloat(q.get('z'));
  // si le point demandé tombe dans un obstacle (voiture, lampadaire…), on glisse
  // vers le trottoir le plus proche jusqu'à être libre
  if (q.has('x') || q.has('z')) {
    const p = camera.position, dir = p.x <= 0 ? -1 : 1;
    for (let k = 0; k < 40 && collides(p.x, p.z, PLAYER_RADIUS); k++) p.x += dir * 0.25;
  }
  if (q.has('yaw') || q.has('pitch')) {
    camera.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(parseFloat(q.get('pitch') ?? '0')), THREE.MathUtils.degToRad(parseFloat(q.get('yaw') ?? '0')), 0, 'YXZ'));
  }
}

// Vraies lumières en nombre fixe, confiées aux sources les plus proches du joueur (après
// la construction de la rue et le point de vue forcé, avant toute compilation de shader)
initLightPool(camera);

// Matrices FIGÉES : à chaque image, Three recompose la matrice de chacun des ~1 600
// objets de la scène, alors que seule la caméra bouge (flocons et vapeur s'animent
// dans leurs tampons ou leurs shaders, pas par leur position ; les lampes et les feux
// ne changent que d'intensité ou de couleur). On calcule tout une fois et on fige.
// ⚠ Un objet qu'on voudrait déplacer plus tard devra repasser matrixAutoUpdate = true.
scene.updateMatrixWorld(true);
scene.traverse(o => { if (o !== camera && o !== scene) o.matrixAutoUpdate = false; });

// Crochet de débogage / tests visuels : position de la caméra et test de collision
// lisibles depuis la console (le reste vit en portée module).
window.__blizzard = { camera, scene, renderer, composer, collides, step: updatePlayer, keys, adaptiveRes, wind: windDebug, snowBounce, photo: photoDebug, startup, lightLoop, lightPool, streetZones };

// Touche P : « qu'est-ce que je regarde ? » — position, orientation et objet visé au
// centre de l'écran, affichés dans le HUD et en console. Pour signaler un artefact.
{
  const rc = new THREE.Raycaster(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  window.addEventListener('keydown', ev => {
    if (ev.code !== 'KeyP') return;
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = rc.intersectObjects(scene.children, true).find(h => h.object.isMesh);
    e.setFromQuaternion(camera.quaternion);
    const p = camera.position, deg = THREE.MathUtils.radToDeg;
    let what = 'rien';
    if (hit) {
      const o = hit.object, c = o.material?.color;
      what = `${o.geometry?.type ?? o.type} / ${o.material?.type ?? '?'} #${c ? c.getHexString() : '------'} à ${hit.distance.toFixed(1)} m`;
    }
    const msg = `x=${p.x.toFixed(2)} z=${p.z.toFixed(2)} yaw=${deg(e.y).toFixed(0)} pitch=${deg(e.x).toFixed(0)} — visé : ${what}`;
    hud.textContent = msg; console.log('[P]', msg, hit?.object);
    hud.dataset.hold = String(performance.now() + 6000);           // la boucle laisse le message 6 s
  });
}

/* =====================================================================
   14. BOUCLE
   ===================================================================== */
const clock = new THREE.Clock();
let fpsTimer = 0, frames = 0;
const windDir = WIND.clone().normalize();

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();                               // non borné : sert à mesurer les ips
  frame(rawDt, clock.elapsedTime);
}
// Tests : faire avancer le jeu image par image depuis la console, même onglet masqué
// (requestAnimationFrame y est suspendu) — window.__blizzard.tick(1 / 60, 30)
window.__blizzard.tick = (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) frame(dt, clock.elapsedTime += dt); };

function frame(rawDt, t) {
  const dt = Math.min(rawDt, 0.05);
  const speed = updatePlayer(dt);
  updateStreetVisibility(camera);                               // rue de gauche : on ne dessine que ce que l'ouverture du carrefour laisse voir
  if (updatePhotoGame(dt, t, speed)) updateScale();             // viseur / zoom : le champ de vision a changé

  updateLampUniforms();
  updateSnow(snowFar, dt, t); updateSnow(snowMid, dt, t);
  updateSteam(dt);
  updateTrafficLights(t);
  updateVehicles(t);                                            // gyrophares de l'ambulance
  updateWind(t, camera);                                        // son du vent (si activé)

  // accumulation sur le visage : face au vent / vers le ciel / en marchant ; fonte lente
  camera.getWorldDirection(fwdDir);
  const facing = THREE.MathUtils.clamp(-fwdDir.dot(windDir), 0, 1), lookUp = THREE.MathUtils.clamp(fwdDir.y, 0, 1);
  const gain = (0.22 + 0.9 * facing + 0.5 * lookUp) * (1 + 0.6 * speed / WALK_SPEED) * 0.07;
  const melt = 0.05 + 0.03 * (1 - facing);
  if (lens.wiping > 0) {                                        // essuyage (jeu photo) : objectif propre en 1 s
    lens.accum -= (lens.accum - 0.1) * Math.min(1, dt / lens.wiping);
    lens.wiping = Math.max(0, lens.wiping - dt);
  } else lens.accum = THREE.MathUtils.clamp(lens.accum + (gain - melt) * dt, 0.1, 0.65);
  facePass.uniforms.uAccum.value = lens.accum; facePass.uniforms.uTime.value = t;

  // scintillement des lanternes, clignotement du néon
  for (const f of flickerLights) {
    const k = f.neon
      ? (Math.random() < 0.015 ? 0.35 : 1) * (0.93 + 0.07 * Math.sin(t * 43.0))
      : 0.92 + 0.08 * Math.sin(t * 8.0 + f.seed) + 0.03 * Math.sin(t * 27.0 + f.seed * 3);
    f.lights.forEach((l, i) => (l.intensity = f.base[i] * k));
    if (f.halos) for (const h of f.halos) h.sprite.material.opacity = h.base * k;
    f.k = k;                                                    // lu par la notation des photos (néon allumé ?)
    if (f.uK) f.uK.value = k;                                   // globe et cône de lumière des lampadaires
    if (f.neon) neonMat.color.setScalar(1.9 * k);
  }
  updateLightPool(dt, camera);                                  // lumières et ombres qui suivent le joueur (lit f.k)
  sky.position.copy(camera.position); sky.updateMatrix();       // voûte centrée sur le joueur (matrices figées : à la main)

  composer.render();
  afterRenderPhoto(t);                                          // capture d'une photo demandée (tampon encore plein)
  adaptiveRes.update(rawDt);

  frames++; fpsTimer += dt;
  if (fpsTimer > 0.5 && !(hud.dataset.hold > performance.now())) { hud.textContent = `${Math.round(frames / fpsTimer)} ips — rendu ${Math.round(adaptiveRes.scale * 100)} % — neige sur le visage ${Math.round(lens.accum * 100)} %`; frames = 0; fpsTimer = 0; }
}

/* =====================================================================
   15. REDIMENSIONNEMENT
   ===================================================================== */
function updateScale() {
  const h = window.innerHeight;
  const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const sys of [snowFar, snowMid]) { sys.mat.uniforms.uScale.value = s; sys.mat.uniforms.uPixelRatio.value = renderer.getPixelRatio(); }
  for (const m of steamMats) { m.uniforms.uScale.value = s; m.uniforms.uPixelRatio.value = renderer.getPixelRatio(); }
  renderer.getDrawingBufferSize(facePass.uniforms.uBuffer.value);
}
// la résolution adaptative change le rapport pixels/écran : taille des flocons et de la
// vapeur (en pixels calculés) et pente des gouttes de la passe visage à recaler
adaptiveRes.onChange = updateScale;
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
  facePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  updateScale();
}
window.addEventListener('resize', onResize);
updateScale();
// photos, textures et shaders préparés pendant le menu, PUIS la boucle (voir core/preload.js)
prepareScene({ renderer, scene, camera, composer }).then(animate, e => { console.error('préparation', e); animate(); });
