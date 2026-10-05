import * as THREE from 'three';
import { FOG_DENSITY } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { groundY } from '../world/ground.js';
import { walkZoneY } from '../world/walkSurface.js';
import { setStepHandler } from '../player/controls.js';

/* =====================================================================
   11 ter. TRACES DE PAS DU JOUEUR
   À chaque pas, une empreinte de semelle est posée dans la neige (sol, perrons, marches du
   métro) ; la neige qui tombe la comble peu à peu : nette au début, ses bords s'adoucissent et
   elle s'efface en ~4 minutes. Dans la neige intacte de la rue de droite, on voit son chemin en
   se retournant.
   Un seul objet instancié (anneau de PRINTS empreintes, la plus ancienne est réutilisée) ; tout
   l'effacement est dans le shader (âge = uTime − aBirth). Rendu en MULTIPLICATION : l'empreinte
   ne peut que foncer la neige (creux bleuté, à l'ombre), quelle que soit la lumière qui l'éclaire —
   pas de calcul d'éclairage, la neige dessous l'a déjà fait. Seul le liseré de neige repoussée
   multiplie par un peu plus que 1 (la cible de rendu est en flottants).
   ===================================================================== */
const PRINTS = 600;
const footUniforms = { uTime: { value: 0 }, uFogDensity: { value: FOG_DENSITY } };
const footMat = new THREE.ShaderMaterial({
  uniforms: footUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.MultiplyBlending, premultipliedAlpha: true,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  vertexShader: `
    attribute float aBirth;
    uniform float uTime, uFogDensity;
    varying vec2 vUv; varying float vK, vAge, vFog;
    void main(){
      vUv = uv;
      vAge = uTime - aBirth;
      // enfoncée en 0,1 s ; comblée par la neige qui tombe entre ~30 s et 4 minutes
      vK = smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(30.0, 240.0, vAge));
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vFog = exp(-uFogDensity * uFogDensity * mv.z * mv.z);
      gl_Position = projectionMatrix * mv;
      if (vK <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // empreinte effacée (ou pas encore posée) : hors champ
    }`,
  fragmentShader: `
    varying vec2 vUv; varying float vK, vAge, vFog;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;                                   // x en travers, y le long (pointe en +1)
      // semelle : avant-pied large, cambrure, talon
      float d = min(min(length((p - vec2(0.04, 0.26)) / vec2(0.66, 0.45)), length((p - vec2(-0.01, -0.45)) / vec2(0.53, 0.25))),
                    length((p - vec2(0.09, -0.1)) / vec2(0.42, 0.3)));   // ~28 × 11 cm
      float soft = 0.1 + 0.5 * smoothstep(0.0, 200.0, vAge);       // les bords s'émoussent sous la neige fraîche
      float shape = 1.0 - smoothstep(1.0 - soft, 1.0, d);
      float tread = 0.82 + 0.18 * step(0.5, fract(p.y * 6.5 + 0.25)) * (1.0 - smoothstep(30.0, 90.0, vAge));   // crampons, vite comblés
      float k = shape * tread * vK * vFog * 0.8;
      // liseré de neige repoussée autour du creux, un peu plus clair : c'est lui qui donne la profondeur
      float rim = (smoothstep(0.9, 1.08, d) - smoothstep(1.12, 1.42, d)) * vK * vFog * (1.0 - smoothstep(20.0, 120.0, vAge));
      gl_FragColor = vec4(mix(vec3(1.0), vec3(0.3, 0.38, 0.56), k) * (1.0 + 0.22 * rim), 1.0);   // creux bleuté : la neige y est à l'ombre
    }`,
});
const footGeo = new THREE.PlaneGeometry(0.17, 0.4); footGeo.rotateX(-Math.PI / 2);   // un peu plus grand que la semelle : place pour le liseré
const footBirths = new Float32Array(PRINTS).fill(-1e6);
footGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(footBirths, 1));
const footMesh = new THREE.InstancedMesh(footGeo, footMat, PRINTS);
footMesh.frustumCulled = false; footMesh.renderOrder = -5;          // avant les autres transparents (flocons, vapeur)
footMesh.userData.noOcclude = true;
scene.add(footMesh);

let footNext = 0;
const footM4 = new THREE.Matrix4(), footQ = new THREE.Quaternion(), footE = new THREE.Euler(), footPos = new THREE.Vector3(), footScl = new THREE.Vector3();
setStepHandler((x, z, heading, foot) => {
  const wy = walkZoneY(x, z), y = wy ?? groundY(x, z);
  if (y < -0.8) return;                                              // fond de l'escalier du métro : plus de neige
  footQ.setFromEuler(footE.set(0, heading + Math.PI, 0));
  footM4.compose(footPos.set(x, y + (wy === null ? 0.035 : 0.01), z), footQ, footScl.set(foot ? -1 : 1, 1, 0.95 + Math.random() * 0.1));
  footMesh.setMatrixAt(footNext, footM4); footBirths[footNext] = footUniforms.uTime.value;
  footMesh.instanceMatrix.needsUpdate = true; footGeo.attributes.aBirth.needsUpdate = true;
  footNext = (footNext + 1) % PRINTS;
});
export function updateFootprints(t) { footUniforms.uTime.value = t; }
