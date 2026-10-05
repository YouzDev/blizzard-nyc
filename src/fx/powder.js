import * as THREE from 'three';
import { FOG_DENSITY } from '../core/constants.js';
import { renderer } from '../core/renderer.js';
import { scene, camera, FOG_COLOR } from '../core/scene.js';
import { makePuffTexture } from '../textures/steam.js';
import { WIND, windGust, lampPosArr, lampColArr, N_LAMPS } from './snow.js';
import { powderCornices, powderTrees } from '../world/powderSources.js';
import { groundY } from '../world/ground.js';

/* =====================================================================
   11 quater. NEIGE SOUFFLÉE DES CORNICHES, PAQUETS QUI TOMBENT DES BRANCHES
   Pendant les rafales, le vent arrache la neige des rebords : un voile de poudre se détache d'un
   bout de corniche et file dans le sens du vent en retombant lentement le long de la façade ; les
   arbres lâchent un nuage de leur couronne. De temps en temps, même sans rafale, une branche se
   déleste : un paquet tombe (en accélérant) dans une traînée de poudre et éclate au sol.
   Sources près du joueur seulement (corniches et couronnes enregistrées par le décor,
   world/powderSources.js). Un seul THREE.Points de PW_POOL particules, mis à jour par le CPU (rien
   à faire quand tout est retombé) ; même éclairage que les flocons (12 lampes les plus proches).
   ===================================================================== */
const PW_POOL = 6000;
const pwPos = new Float32Array(PW_POOL * 3), pwVel = new Float32Array(PW_POOL * 3), pwLife = new Float32Array(PW_POOL), pwAge = new Float32Array(PW_POOL);
const pwSize = new Float32Array(PW_POOL), pwAlpha = new Float32Array(PW_POOL), pwKind = new Uint8Array(PW_POOL);   // pwKind : 0 poudre, 1 paquet
const pwGround = new Float32Array(PW_POOL), pwAmax = new Float32Array(PW_POOL);   // opacité propre : grains denses, brume légère
pwPos.fill(-1000);
const pwGeo = new THREE.BufferGeometry();
pwGeo.setAttribute('position', new THREE.BufferAttribute(pwPos, 3));
pwGeo.setAttribute('aSize', new THREE.BufferAttribute(pwSize, 1));
pwGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pwAlpha, 1));
export const powderMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: makePuffTexture() }, uPixelRatio: { value: renderer.getPixelRatio() }, uScale: { value: 1 },
    uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY }, uLampPos: { value: lampPosArr }, uLampCol: { value: lampColArr },
  },
  transparent: true, depthWrite: false,
  vertexShader: `
    attribute float aSize, aAlpha;
    uniform float uPixelRatio, uScale, uFogDensity;
    uniform vec3 uLampPos[${N_LAMPS}]; uniform vec3 uLampCol[${N_LAMPS}];
    varying vec3 vLight; varying float vFog, vAlpha;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = -mv.z;
      gl_PointSize = clamp(aSize * uScale * uPixelRatio / dist, 1.0, 400.0);
      vec3 light = vec3(0.2, 0.24, 0.32);                        // ciel bleuté (un peu plus que les flocons : la poudre est dense)
      for (int i = 0; i < ${N_LAMPS}; i++) { vec3 d = position - uLampPos[i]; light += uLampCol[i] * 9.0 / (1.0 + dot(d, d) * 0.22); }
      vLight = light;
      vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      vAlpha = aAlpha * smoothstep(0.3, 1.2, dist);
      gl_Position = aAlpha > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform vec3 uFogColor;
    varying vec3 vLight; varying float vFog, vAlpha;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      gl_FragColor = vec4(mix(vLight, uFogColor, vFog), a * vAlpha);
    }`,
});
const pwPoints = new THREE.Points(pwGeo, powderMat); pwPoints.frustumCulled = false; scene.add(pwPoints);

let pwCursor = 0, pwAlive = 0;
function pwSpawn(x, y, z, vx, vy, vz, sz, lf, k, amax = 0.85) {
  const i = pwCursor; pwCursor = (pwCursor + 1) % PW_POOL;
  if (pwLife[i] <= 0) pwAlive++;
  pwPos[i * 3] = x; pwPos[i * 3 + 1] = y; pwPos[i * 3 + 2] = z;
  pwVel[i * 3] = vx; pwVel[i * 3 + 1] = vy; pwVel[i * 3 + 2] = vz;
  pwSize[i] = sz; pwLife[i] = lf; pwAge[i] = 0; pwKind[i] = k; pwAmax[i] = amax; pwGround[i] = groundY(x, z) + 0.05;
}
const pwTmp = new THREE.Vector3(), pwFwd = new THREE.Vector3();
/** Source proche et plutôt devant le joueur (au hasard parmi celles qui conviennent). */
function pwPickNear(list, center, maxD) {
  camera.getWorldDirection(pwFwd);
  const cand = [];
  for (const s of list) {
    const c = center(s), d = c.distanceTo(camera.position);
    if (d > maxD || d < 3) continue;
    pwTmp.subVectors(c, camera.position).normalize();
    if (pwTmp.dot(pwFwd) > 0.2) cand.push(s);
  }
  return cand.length ? cand[Math.floor(Math.random() * cand.length)] : null;
}
const pwCorniceMid = s => s.a.clone().add(s.b).multiplyScalar(0.5);

/** Voile de poudre arraché à un bout de corniche (2 à 5 m), poussé par le vent. */
function pwCorniceBurst(s, strength) {
  const len = s.a.distanceTo(s.b), L = Math.min(len, 2 + Math.random() * 3), t0 = Math.random() * Math.max(0, len - L);
  const n = Math.round(160 + 200 * strength);
  for (let k = 0; k < n; k++) {
    const haze = k % 9 === 0;                                     // une bouffée de brume pour huit grains
    pwTmp.lerpVectors(s.a, s.b, (t0 + Math.random() * L) / len);
    pwSpawn(pwTmp.x + (Math.random() - 0.5) * 0.3, pwTmp.y + Math.random() * 0.25, pwTmp.z + (Math.random() - 0.5) * 0.3,
      WIND.x * 0.5 + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.5, WIND.z * 0.5 + (Math.random() - 0.5) * 0.6,
      haze ? 0.7 + Math.random() * 0.9 : 0.05 + Math.random() * 0.07, 4 + Math.random() * 4, 0, haze ? 0.16 : 0.85);
  }
}
/** Nuage lâché par la couronne d'un arbre (rafale). */
function pwTreeBurst(s, strength) {
  const n = Math.round(160 + 180 * strength);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * s.r, haze = k % 10 === 0;
    pwSpawn(s.c.x + Math.cos(a) * r, s.c.y + (Math.random() - 0.3) * s.r * 0.7, s.c.z + Math.sin(a) * r,
      WIND.x * 0.4, -0.2 + Math.random() * 0.4, WIND.z * 0.4, haze ? 0.8 + Math.random() * 0.8 : 0.05 + Math.random() * 0.06, 3.5 + Math.random() * 3, 0, haze ? 0.14 : 0.8);
  }
}
/** Une branche se déleste : quelques gros paquets qui tombent, une traînée de poudre. */
function pwTreeDrop(s) {
  const a = Math.random() * 6.283, r = (0.3 + Math.random() * 0.7) * s.r;
  const x = s.c.x + Math.cos(a) * r, y = s.c.y + (Math.random() - 0.2) * s.r * 0.6, z = s.c.z + Math.sin(a) * r;
  for (let k = 0; k < 4 + Math.floor(Math.random() * 4); k++)
    pwSpawn(x + (Math.random() - 0.5) * 0.25, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.3, -0.3 - Math.random() * 0.5, (Math.random() - 0.5) * 0.3, 0.08 + Math.random() * 0.06, 6, 1, 1);
  for (let k = 0; k < 70; k++) {
    const haze = k % 7 === 0;
    pwSpawn(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, -0.4 - Math.random() * 0.8, (Math.random() - 0.5) * 0.4, haze ? 0.4 + Math.random() * 0.4 : 0.04 + Math.random() * 0.05, 2.5 + Math.random() * 2, 0, haze ? 0.2 : 0.85);
  }
}
/** Le paquet éclate en touchant le sol. */
function pwSplash(x, y, z) {
  for (let k = 0; k < 24; k++) { const a = Math.random() * 6.283, v = 0.3 + Math.random() * 0.6; pwSpawn(x, y + 0.05, z, Math.cos(a) * v, 0.4 + Math.random() * 0.5, Math.sin(a) * v, k < 3 ? 0.4 + Math.random() * 0.3 : 0.05 + Math.random() * 0.05, 1.2 + Math.random(), 0, k < 3 ? 0.25 : 0.85); }
}

let pwLastGust = 0, pwNextDrop = 3, pwNextGust = 0;
export const powderState = { alive: 0, bursts: 0, drops: 0 };
export function updatePowder(dt, t) {
  const g = windGust(t);
  // rafale : le vent arrache la neige des rebords et des couronnes proches
  pwNextGust -= dt;
  if (g > 1.35 && (pwLastGust <= 1.35 || pwNextGust <= 0)) {
    const strength = Math.min(1, (g - 1.35) / 0.4 + 0.3);
    for (let k = 0; k < 2; k++) { const c = pwPickNear(powderCornices, pwCorniceMid, 38); if (c) { pwCorniceBurst(c, strength); powderState.bursts++; } }
    const tr = pwPickNear(powderTrees, s => s.c, 32); if (tr) { pwTreeBurst(tr, strength); powderState.bursts++; }
    pwNextGust = 0.9 + Math.random() * 1.2;
  }
  pwLastGust = g;
  // branches qui se délestent, plus souvent dans le vent
  pwNextDrop -= dt * (0.6 + 0.5 * g);
  if (pwNextDrop <= 0) { const tr = pwPickNear(powderTrees, s => s.c, 28); if (tr) { pwTreeDrop(tr); powderState.drops++; } pwNextDrop = 2 + Math.random() * 5; }
  if (!pwAlive) return;

  const relax = 1 - Math.exp(-dt * 1.6), wx = WIND.x * g * 0.75, wz = WIND.z * g * 0.75;
  pwAlive = 0;
  for (let i = 0; i < PW_POOL; i++) {
    if (pwLife[i] <= 0) continue;
    const i3 = i * 3;
    pwAge[i] += dt;
    if (pwAge[i] >= pwLife[i]) { pwLife[i] = 0; pwAlpha[i] = 0; continue; }
    if (pwKind[i]) {                                              // paquet : chute libre (un peu freinée), dérive au vent
      pwVel[i3 + 1] -= 9.8 * dt * 0.8; pwVel[i3] += (wx * 0.3 - pwVel[i3]) * relax * 0.3; pwVel[i3 + 2] += (wz * 0.3 - pwVel[i3 + 2]) * relax * 0.3;
    } else {                                                      // poudre : suit le vent, retombe lentement
      pwVel[i3] += (wx - pwVel[i3]) * relax; pwVel[i3 + 1] += (-0.75 - pwVel[i3 + 1]) * relax; pwVel[i3 + 2] += (wz - pwVel[i3 + 2]) * relax;
      if (pwAmax[i] < 0.5) pwSize[i] += dt * 0.25;                // la brume se dilate
    }
    pwPos[i3] += pwVel[i3] * dt; pwPos[i3 + 1] += pwVel[i3 + 1] * dt; pwPos[i3 + 2] += pwVel[i3 + 2] * dt;
    if (pwPos[i3 + 1] < pwGround[i]) {
      if (pwKind[i]) { pwLife[i] = 0; pwAlpha[i] = 0; pwSplash(pwPos[i3], pwGround[i], pwPos[i3 + 2]); continue; }
      pwPos[i3 + 1] = pwGround[i]; pwVel[i3 + 1] = 0;
    }
    const f = pwAge[i] / pwLife[i];
    pwAlpha[i] = pwKind[i] ? 1 : Math.min(1, pwAge[i] / 0.25) * (1 - f) * (1 - f) * pwAmax[i];
    pwAlive++;
  }
  powderState.alive = pwAlive;
  pwGeo.attributes.position.needsUpdate = true; pwGeo.attributes.aSize.needsUpdate = true; pwGeo.attributes.aAlpha.needsUpdate = true;
}
