import * as THREE from 'three';
import { ROAD_HALF, CROSS_Z } from '../core/constants.js';
import { scene } from '../core/scene.js';
import { flakeTex } from '../textures/index.js';
import { MAT } from './materials.js';
import { shadowed, addCollider } from './collisions.js';
import { addSubject } from '../game/subjects.js';

/* =====================================================================
   10 bis. CARREFOUR : feux de circulation
   Au bout de la rue, la transversale (z = CROSS_Z) : à gauche elle devient la rue de
   gauche, à droite la rangée d'immeubles continue (sol et immeubles : ground.js,
   buildings.js). Deux potences façon New York aux coins : mât, bras horizontal au-dessus
   de la voie, caisson olive à trois lampes tourné vers le joueur, signal piéton sur le mât.
   Les lampes sont hors brouillard mais volontairement ternes, avec un halo :
   à 100 m dans la tempête, un feu n'est qu'une tache de couleur.
   ===================================================================== */
const CROSS_W = 13;                       // (place des mâts : 1 m derrière la bordure de la transversale)

const signalMats = {
  housing: new THREE.MeshStandardMaterial({ color: 0x5a5212, roughness: 0.6, metalness: 0.3 }),
  off: new THREE.MeshBasicMaterial({ color: 0x1a1210, fog: false }),
};
const LAMP_COLORS = { red: new THREE.Color(1.5, 0.12, 0.06), yellow: new THREE.Color(1.5, 0.9, 0.12), green: new THREE.Color(0.1, 1.3, 0.45) };
const signals = [];                         // { lamps: {red, yellow, green}, halos, ped }

function buildSignal(side) {
  const g = new THREE.Group();
  const px = side * (ROAD_HALF + 1.2), pz = CROSS_Z + CROSS_W / 2 + 1.0, armLen = ROAD_HALF + 1.2 - 2.2;
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6.2, 12), MAT.metal)); pole.position.set(px, 3.1, pz); g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12), MAT.metal); base.position.set(px, 0.25, pz); g.add(base);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, armLen, 10), MAT.metal);
  arm.rotation.z = Math.PI / 2; arm.position.set(px - side * armLen / 2, 5.85, pz); g.add(arm);
  const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, armLen * 0.7, 6), MAT.metal);
  brace.position.set(px - side * armLen * 0.35, 6.2, pz); brace.rotation.z = Math.PI / 2 + side * 0.18; g.add(brace);
  const snowArm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.08, 0.14), MAT.snow); snowArm.position.set(px - side * armLen / 2, 5.95, pz); g.add(snowArm);

  // caisson à trois lampes, face au joueur (+Z), avec casquettes
  const hx = px - side * armLen, hy = 5.05;
  const head = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.1, 0.3), signalMats.housing)); head.position.set(hx, hy, pz); g.add(head);
  const headSnow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.34), MAT.snow); headSnow.position.set(hx, hy + 0.6, pz); g.add(headSnow);
  const lamps = {}, halos = {};
  [['red', 0.34], ['yellow', 0], ['green', -0.34]].forEach(([name, dy]) => {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), signalMats.off.clone()); lamp.position.set(hx, hy + dy, pz + 0.16); g.add(lamp);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 12, 1, true, Math.PI, Math.PI), signalMats.housing);
    visor.rotation.x = Math.PI / 2; visor.position.set(hx, hy + dy + 0.02, pz + 0.22); g.add(visor);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: flakeTex, color: LAMP_COLORS[name], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.set(1.6, 1.6, 1); halo.position.set(hx, hy + dy, pz + 0.3); g.add(halo);
    lamps[name] = lamp; halos[name] = halo;
  });

  // signal piéton sur le mât : main orange / silhouette blanche
  const pedBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.22), signalMats.housing); pedBox.position.set(px - side * 0.05, 2.7, pz + 0.02); g.add(pedBox);
  const ped = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshBasicMaterial({ color: 0xff7a1a, fog: false })); ped.position.set(px - side * 0.05, 2.7, pz + 0.14); g.add(ped);

  scene.add(g);
  addCollider(px, pz, 0.2, 0.2);                 // on ne traverse plus les mâts
  signals.push({ lamps, halos, ped });
  addSubject({ label: 'Les feux du carrefour', value: 0.7, glows: true, object: g,
    moment: () => (trafficState === 'red' ? { pts: 4, why: 'feu au rouge' } : trafficState === 'yellow' ? { pts: 2, why: "feu à l'orange" } : null) });
}
buildSignal(-1);
buildSignal(1);

// Cycle : rouge 9 s → vert 7 s → orange 2,5 s. Les deux caissons regardent le joueur,
// donc affichent la même couleur (c'est le même sens de circulation).
const CYCLE = [['red', 9], ['green', 7], ['yellow', 2.5]], CYCLE_T = CYCLE.reduce((a, c) => a + c[1], 0);
export let trafficState = 'red';                 // lu par la notation des photos
export function updateTrafficLights(t) {
  let u = t % CYCLE_T, state = 'red';
  for (const [name, d] of CYCLE) { if (u < d) { state = name; break; } u -= d; }
  trafficState = state;
  for (const s of signals) {
    for (const name in s.lamps) {
      const on = name === state;
      s.lamps[name].material.color.copy(on ? LAMP_COLORS[name] : signalMats.off.color);
      s.halos[name].material.opacity = on ? 0.32 : 0;
    }
    s.ped.material.color.setHex(state === 'red' ? 0xf4f4ff : 0xff7a1a);
  }
}
