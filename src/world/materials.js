import * as THREE from 'three';
import { stone, concrete, taxiSideTex, shutterTex, gratTex } from '../textures/index.js';
import { snowPhoto } from './snowPhoto.js';
import { usePhoto } from '../textures/photo.js';

/* =====================================================================
   3. MATÉRIAUX
   ===================================================================== */
export const MAT = {
  snow:   new THREE.MeshStandardMaterial({ color: 0xe7edf6, roughness: 0.98, emissive: new THREE.Color(0.05, 0.06, 0.085) }),   // même lueur propre que la neige au sol (ground.js)
  metal:  new THREE.MeshStandardMaterial({ color: 0x191c21, roughness: 0.5, metalness: 0.75, envMapIntensity: 1.2 }),
  iron:   new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.65, metalness: 0.55, envMapIntensity: 1.2 }),
  trash:  new THREE.MeshStandardMaterial({ color: 0x1b3226, roughness: 0.75, metalness: 0.2 }),
  hydrant:new THREE.MeshStandardMaterial({ color: 0x8c1c14, roughness: 0.5, metalness: 0.25 }),
  taxi:   new THREE.MeshPhysicalMaterial({ color: 0xe9ab1f, roughness: 0.4, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.12 }),   // jaune vernis
  taxiSide:new THREE.MeshStandardMaterial({ map: taxiSideTex, roughness: 0.4, metalness: 0.2 }),
  // Le verre est un DIÉLECTRIQUE : metalness 0. À 0.8 il n'avait aucune diffuse et,
  // faute de réflexion, rendait noir pur — d'où les vitres en trous noirs.
  glass:  new THREE.MeshStandardMaterial({ color: 0x0a1220, roughness: 0.08, metalness: 0, envMapIntensity: 1.6 }),
  awning: new THREE.MeshStandardMaterial({ color: 0x4a1410, roughness: 0.9 }),
  stone:  new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: stone.rough, roughness: 1, color: new THREE.Color(0.56, 0.42, 0.34) }),   // brownstone (perrons) ; soubassements teintés par immeuble
  granite:new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normal, normalScale: new THREE.Vector2(0.4, 0.4), color: 0x7c7f86, roughness: 0.7, metalness: 0.05 }),
  concrete:new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normal, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xece8e0, roughness: 0.95 }),
  wood:   new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.8 }),
  paint:  new THREE.MeshStandardMaterial({ color: 0x1a2a22, roughness: 0.55, metalness: 0.1 }),
  shutter:new THREE.MeshStandardMaterial({ map: shutterTex, roughness: 0.55, metalness: 0.6 }),
  storeGlass: new THREE.MeshStandardMaterial({ color: 0x0a1220, roughness: 0.05, metalness: 0, envMapIntensity: 1.6, transparent: true, opacity: 0.45 }),
  grating:new THREE.MeshStandardMaterial({ map: gratTex, alphaMap: gratTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x222, roughness: 0.7, metalness: 0.5 }),
};
MAT.grating.map.repeat.set(4, 12);
snowPhoto(MAT.snow);   // grain de neige photo projeté (voitures, rebords, congères, mobilier)
// Photos sur les matériaux partagés (secours : leur version actuelle). MAT.stone est cloné
// par chaque soubassement AVANT que la photo arrive : seuls les perrons la reçoivent.
const PHOTO_W = new THREE.Color(1, 1, 1);
usePhoto(MAT.stone, 'red_sandstone_pavement', 1, 1, m => m.color.lerp(PHOTO_W, 0.55));       // perrons : dalles de brownstone
for (const m of [MAT.trash, MAT.hydrant])                                                      // fonte piquée : relief seulement,
  usePhoto(m, 'rust_coarse_01', 1, 0.5, mm => { mm.map = null; mm.normalScale.set(0.6, 0.6); mm.roughness = 0.75; }); // la peinture garde sa couleur (et un peu de brillant)
usePhoto(MAT.paint, 'distressed_painted_planks', 0.6, 1.2, m => { m.color.multiplyScalar(4); m.metalness = 0.05; });   // cadres de fenêtres : bois peint écaillé
// béton : les UV de `worldBox` valent 5,5 m par tuile → 2 répétitions = une tuile de 2,75 m
MAT.concrete.map.repeat.set(2, 2); MAT.concrete.normalMap.repeat.set(2, 2);
