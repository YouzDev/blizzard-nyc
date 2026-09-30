import * as THREE from 'three';

/* =====================================================================
   1. RENDU / SCÈNE / CAMÉRA / BROUILLARD
   ===================================================================== */
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Ombres STATIQUES : rien de ce qui projette une ombre ne bouge (immeubles, voitures,
// mobilier), les lampes sont fixes (le scintillement ne change que leur intensité) et
// la caméra d'ombre de la lune ne suit pas le joueur. Les 8 cartes d'ombre sont donc
// calculées à la première image puis réutilisées, au lieu de redessiner la scène
// 8 fois de plus à chaque image. ⚠ Si un jour quelque chose de MOBILE doit projeter
// une ombre (voiture qui roule, ombre du joueur), il faudra repasser
// `renderer.shadowMap.needsUpdate = true` à chaque image où il bouge.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
document.body.appendChild(renderer.domElement);
