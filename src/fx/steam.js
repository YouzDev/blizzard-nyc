import * as THREE from 'three';
import { FOG_DENSITY } from '../core/constants.js';
import { renderer } from '../core/renderer.js';
import { scene, FOG_COLOR } from '../core/scene.js';
import { makePuffTexture } from '../textures/steam.js';
import { MAT } from '../world/materials.js';
import { lampPositions } from '../world/lightRegistry.js';
import { MANHOLES } from '../world/ground.js';
import { WIND } from './snow.js';
import { addSubject, boxAt } from '../game/subjects.js';

/* =====================================================================
   11 bis. VAPEUR DES BOUCHES D'ÉGOUT
   Une plaque en fonte au milieu de la chaussée, une auréole de neige fondue
   autour, et un panache de bouffées qui montent en se dilatant, poussées par
   le vent, éclairées par le lampadaire le plus proche. Toute l'animation est
   dans le vertex shader (phase = fract(temps + décalage)) : le CPU ne fait que
   pousser uTime.
   ===================================================================== */
const puffTex = makePuffTexture();
export const steamMats = [];

const STEAM_VERT = `
  attribute float aPhase, aSeed, aSize;
  uniform float uTime, uPixelRatio, uScale, uFogDensity, uHeight;
  uniform vec3 uWind;
  varying float vAlpha, vFog, vSeed;
  void main(){
    float life = fract(uTime * 0.16 + aPhase);              // 0 : sort de la plaque, 1 : dissipé
    float s = aSeed * 6.283;
    // montée ralentie, dérive au vent qui s'accentue, léger tourbillon
    vec3 p = position;
    p.y += uHeight * pow(life, 0.72);
    p.xz += uWind.xz * 0.28 * life * life + vec2(sin(uTime * 0.9 + s), cos(uTime * 0.7 + s)) * (0.15 + 0.5 * life);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float size = aSize * (0.5 + 2.4 * life);                   // la bouffée se dilate en montant
    gl_PointSize = clamp(size * uScale * uPixelRatio / dist, 2.0, 600.0);
    vAlpha = smoothstep(0.0, 0.12, life) * pow(1.0 - life, 1.6) * smoothstep(0.6, 2.5, dist);
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    vSeed = aSeed;
    gl_Position = projectionMatrix * mv;
  }`;
const STEAM_FRAG = `
  uniform sampler2D uMap; uniform vec3 uColor, uFogColor; uniform float uOpacity;
  varying float vAlpha, vFog, vSeed;
  void main(){
    // rotation de la texture par particule pour éviter les bouffées identiques
    float a = vSeed * 6.283; vec2 c = gl_PointCoord - 0.5;
    vec2 uv = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a)) + 0.5;
    float t = texture2D(uMap, uv).a;
    vec3 col = mix(uColor, uFogColor, vFog);
    gl_FragColor = vec4(col, t * vAlpha * uOpacity);
  }`;

function buildManhole(x, z) {
  addSubject({ label: "La vapeur d'une plaque d'égout", value: 0.8, box: boxAt(x, z, 0.9, 0.9, 0, 2.6), moment: () => ({ pts: 2, why: 'panache de vapeur' }) });
  // plaque en fonte + auréole sombre de neige fondue (la vapeur est chaude)
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 28), MAT.iron); cover.position.set(x, 0.025, z); cover.receiveShadow = true; scene.add(cover);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 6, 28), MAT.iron); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.035, z); scene.add(rim);
  const melt = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85 }));
  melt.rotation.x = -Math.PI / 2; melt.position.set(x, 0.008, z); melt.receiveShadow = true; scene.add(melt);

  // teinte : blanc-gris froid réchauffé par le lampadaire le plus proche
  const here = new THREE.Vector3(x, 2, z);
  let best = null, bd = Infinity;
  for (const l of lampPositions) { const d = l.pos.distanceTo(here); if (d < bd) { bd = d; best = l; } }
  const tint = new THREE.Color(0.62, 0.66, 0.72);
  if (best) tint.lerp(best.col, THREE.MathUtils.clamp(1 - bd / 16, 0, 0.55));

  buildPlume(x, 0.07, z, tint);
}

/** Panache de bouffées (vapeur d'égout, fumée de cheminée) : réparties dans un petit disque, phases
 *  étalées, toute l'animation dans le shader. o : n, spread, height, size, opacity. */
export function buildPlume(x, y, z, tint, o = {}) {
  const N = o.n ?? 110, pos = new Float32Array(N * 3), phase = new Float32Array(N), seed = new Float32Array(N), size = new Float32Array(N), sp = o.spread ?? 0.3, sk = o.size ?? 1;
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * sp;
    pos[i * 3] = x + Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + Math.sin(a) * r;
    phase[i] = i / N; seed[i] = Math.random(); size[i] = (0.55 + Math.random() * 0.5) * sk;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: puffTex }, uTime: { value: Math.random() * 100 }, uPixelRatio: { value: renderer.getPixelRatio() }, uScale: { value: 1 },
      uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY }, uWind: { value: WIND }, uHeight: { value: o.height ?? 3.2 + Math.random() * 1.2 },
      uColor: { value: tint }, uOpacity: { value: o.opacity ?? 0.42 },
    },
    vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  steamMats.push(mat);
}

// Trois plaques au milieu de la chaussée, décalées d'une voie à l'autre
for (const [x, z] of MANHOLES) buildManhole(x, z);   // positions partagées avec le cratère de fonte (ground.js)

export function updateSteam(dt) {
  for (const m of steamMats) m.uniforms.uTime.value += dt;
}
