import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { renderer } from '../core/renderer.js';
import { scene, camera } from '../core/scene.js';
import { facePass } from './facePass.js';

/* =====================================================================
   12 bis. CHAÎNE DE POST-TRAITEMENT
   RenderPass → UnrealBloomPass → passe « neige sur le visage » → OutputPass
   ===================================================================== */

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.55, 0.95);
composer.addPass(bloom);
composer.addPass(facePass);
composer.addPass(new OutputPass());
