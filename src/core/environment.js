import * as THREE from 'three';
import { renderer } from './renderer.js';
import { scene, skyMat } from './scene.js';

/* =====================================================================
   1 ter. CARTE D'ENVIRONNEMENT (réflexions)
   En PBR, un matériau métallique n'a PAS de composante diffuse : il ne rend
   que ce qu'il réfléchit. Sans carte d'environnement, il ne réfléchit rien et
   rend donc NOIR PUR, quelles que soient les lumières de la scène. C'est ce
   qui transformait les vitres, la ferronnerie et les lampadaires en trous noirs.

   On cuit donc une petite carte à partir du shader de ciel lui-même : ciel et
   réflexions ne peuvent pas diverger, et ça reste cohérent si on retouche la
   nuit. Coût : une seule cuisson au chargement, zéro par frame.
   ===================================================================== */
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMat));
  const target = pmrem.fromScene(envScene, 0, 1, 100);
  scene.environment = target.texture;
  pmrem.dispose();
}
