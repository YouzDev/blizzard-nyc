import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACADE_X } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { neonTex, flakeTex } from '../textures/index.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { deliZ } from './buildings.js';
import { flickerLights, lampPositions } from './lightRegistry.js';
import { addSubject, boxAt } from '../game/subjects.js';

/* =====================================================================
   9. ENSEIGNE NÉON "DELI PIZZA" + lumière rouge (spot avec ombres)
   ===================================================================== */
export const neonZ = deliZ - 3;
export let neonMat;
{
  const signW = 1.55, signH = 3.1, sx = -FACADE_X + 0.2 + signW / 2, sy = 6.4;
  neonMat = new THREE.MeshBasicMaterial({ map: neonTex, side: THREE.DoubleSide, color: new THREE.Color(1.9, 1.9, 1.9) });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), neonMat); sign.position.set(sx, sy, neonZ); scene.add(sign);
  const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(signW, signH, 0.18), MAT.iron)); box.position.set(sx, sy, neonZ - 0.1); scene.add(box);
  const sign2 = sign.clone(); sign2.position.z = neonZ - 0.2; sign2.rotation.y = Math.PI; scene.add(sign2);
  for (const yy of [sy + signH / 2 + 0.08, sy - signH / 2 - 0.08]) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(signW + 0.3, 0.07, 0.07), MAT.iron); br.position.set(-FACADE_X + 0.15 + signW / 2, yy, neonZ - 0.1); scene.add(br);
  }
  const signSnow = new THREE.Mesh(new RoundedBoxGeometry(signW, 0.2, 0.34, 2, 0.08), MAT.snow); signSnow.position.set(sx, sy + signH / 2 + 0.18, neonZ - 0.1); scene.add(signSnow);

  // portée 13 m (et non 24) : sur le modèle le rouge du néon reste une flaque locale. À 24 m
  // il atteignait le lampadaire suivant et en projetait l'ombre (congère, socle) vers le
  // joueur : des disques sombres bien visibles depuis que le trottoir est blanc
  const red = new THREE.SpotLight(0xff2e1c, 220, 13, 1.25, 0.9, 2);
  red.position.set(-FACADE_X + 1.4, sy - 0.4, neonZ);
  red.target.position.set(-FACADE_X + 3.5, 0, neonZ + 1.5); scene.add(red); scene.add(red.target);
  red.castShadow = true; red.shadow.mapSize.set(1024, 1024); red.shadow.bias = -0.0005; red.shadow.radius = 4;
  const redFill = new THREE.PointLight(0xff3a24, 26, 16, 2); redFill.position.set(-FACADE_X + 1.2, sy, neonZ); scene.add(redFill);
  const neonFlicker = { lights: [red, redFill], base: [220, 26], neon: true, seed: 0, k: 1 };
  flickerLights.push(neonFlicker);
  addSubject({ label: 'Le néon DELI – PIZZA', value: 1, glows: true, box: boxAt(sx, neonZ - 0.1, signW / 2 + 0.1, 0.35, sy - signH / 2 - 0.1, sy + signH / 2 + 0.35),
    moment: () => (neonFlicker.k > 0.8 ? { pts: 2, why: 'néon bien allumé' } : { pts: 0, why: 'néon saisi pendant un clignotement' }) });
  lampPositions.push({ pos: new THREE.Vector3(-FACADE_X + 1.2, sy, neonZ), col: new THREE.Color(0xff2e1c) });

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: flakeTex, color: 0xff3020, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(6, 7, 1); halo.position.set(sx + 0.4, sy, neonZ + 0.3); scene.add(halo);
}
