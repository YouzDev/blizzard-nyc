import * as THREE from 'three';
import { FOG_DENSITY } from '../core/constants.js';
import { rnd } from '../core/noise.js';
import { renderer } from '../core/renderer.js';
import { scene, camera, FOG_COLOR } from '../core/scene.js';
import { flakeTex } from '../textures/index.js';
import { lampPositions } from '../world/lightRegistry.js';

/* =====================================================================
   11. BLIZZARD : flocons éclairés par les lampadaires (shader personnalisé)
   ===================================================================== */
export const WIND = new THREE.Vector3(1.4, 0, 3.6);
const N_LAMPS = 12;
// on ne garde que les lampes proches du joueur (mises à jour à chaque frame)
const lampPosArr = new Array(N_LAMPS).fill(0).map(() => new THREE.Vector3(0, -100, 0));
const lampColArr = new Array(N_LAMPS).fill(0).map(() => new THREE.Color(0, 0, 0));

const snowUniforms = {
  uMap: { value: flakeTex }, uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() },
  uScale: { value: 1 }, uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY },
  uLampPos: { value: lampPosArr }, uLampCol: { value: lampColArr }, uOpacity: { value: 1 },
};
const snowMat = new THREE.ShaderMaterial({
  uniforms: snowUniforms, transparent: true, depthWrite: false,
  vertexShader: `
    attribute float aSize; attribute float aSeed;
    uniform float uPixelRatio, uScale, uFogDensity, uTime;
    uniform vec3 uLampPos[${N_LAMPS}]; uniform vec3 uLampCol[${N_LAMPS}];
    varying vec3 vLight; varying float vFog, vNear, vSeed;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = -mv.z;
      gl_PointSize = clamp(aSize * uScale * uPixelRatio / dist, 1.0, 260.0);
      vec3 light = vec3(0.16, 0.20, 0.28);                       // ciel bleuté
      for (int i = 0; i < ${N_LAMPS}; i++) {
        vec3 d = position - uLampPos[i];
        float att = 9.0 / (1.0 + dot(d, d) * 0.22);
        light += uLampCol[i] * att;
      }
      vLight = light;
      vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      vNear = smoothstep(0.4, 1.6, dist);
      vSeed = aSeed;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform vec3 uFogColor; uniform float uOpacity, uTime;
    varying vec3 vLight; varying float vFog, vNear, vSeed;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      float twinkle = 0.75 + 0.25 * sin(uTime * 6.0 + vSeed * 40.0);
      vec3 col = mix(vLight, uFogColor, vFog);
      gl_FragColor = vec4(col, a * vNear * uOpacity * twinkle);
    }`,
});

function makeSnowSystem(count, box, sizeMin, sizeMax, fall, windScale, opacity) {
  const pos = new Float32Array(count * 3), size = new Float32Array(count), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i*3] = (Math.random() - 0.5) * box.x + camera.position.x; pos[i*3+1] = Math.random() * box.y; pos[i*3+2] = (Math.random() - 0.5) * box.z + camera.position.z;
    size[i] = rnd(sizeMin, sizeMax); seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = snowMat.clone(); mat.uniforms = THREE.UniformsUtils.clone(snowUniforms); mat.uniforms.uOpacity.value = opacity;
  mat.uniforms.uLampPos.value = lampPosArr; mat.uniforms.uLampCol.value = lampColArr;   // partagés
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  return { pts, pos, seed, count, box, fall, windScale, mat };
}
export const snowFar  = makeSnowSystem(15000, new THREE.Vector3(80, 26, 80), 0.045, 0.11, 2.4, 1.0, 0.9);
export const snowMid  = makeSnowSystem(3600,  new THREE.Vector3(30, 12, 30),  0.07, 0.14, 3.0, 1.15, 0.75);

/** Force des rafales (≈ 0,2 à 1,8, moyenne 1) : partagée par les flocons et le son du vent. */
export function windGust(t) { return 1 + 0.4 * Math.sin(t * 0.6) + 0.25 * Math.sin(t * 2.1 + 1.0) + 0.15 * Math.sin(t * 5.3); }

export function updateSnow(sys, dt, t) {
  const { pos, seed, count, box, fall, windScale } = sys;
  const cx = camera.position.x, cz = camera.position.z, hx = box.x / 2, hz = box.z / 2;
  const gust = windGust(t);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3, s = seed[i] * 6.283;
    pos[i3]   += (WIND.x * windScale * gust + Math.sin(t * 1.9 + s) * 1.1) * dt;
    pos[i3+1] -= (fall + Math.sin(s) * 0.7 + Math.sin(t * 3.0 + s) * 0.3) * dt;
    pos[i3+2] += (WIND.z * windScale * gust + Math.cos(t * 1.4 + s) * 0.8) * dt;
    if (pos[i3+1] < -0.5) pos[i3+1] += box.y;
    const dx = pos[i3] - cx, dz = pos[i3+2] - cz;
    if (dx > hx) pos[i3] -= box.x; else if (dx < -hx) pos[i3] += box.x;
    if (dz > hz) pos[i3+2] -= box.z; else if (dz < -hz) pos[i3+2] += box.z;
  }
  sys.pts.geometry.attributes.position.needsUpdate = true;
  sys.mat.uniforms.uTime.value = t;
}
export function updateLampUniforms() {
  const sorted = lampPositions.slice().sort((a, b) => a.pos.distanceToSquared(camera.position) - b.pos.distanceToSquared(camera.position));
  for (let i = 0; i < N_LAMPS; i++) {
    if (sorted[i]) { lampPosArr[i].copy(sorted[i].pos); lampColArr[i].copy(sorted[i].col); }
    else { lampPosArr[i].set(0, -1000, 0); lampColArr[i].set(0, 0, 0); }
  }
}
