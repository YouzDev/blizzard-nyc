import * as THREE from 'three';
import { photosSettled } from '../textures/photo.js';
import { padPointLights } from './lightLoop.js';

/* =====================================================================
   1 quater. PRÉPARATION PENDANT LE MENU
   Au chargement, la page se figeait plusieurs secondes : la toute première image
   compilait d'un coup les ~48 shaders de la scène, puis les photos arrivaient et
   figeaient encore une image ~3 s (envoi des textures à la carte graphique et
   recompilation des matériaux qui gagnaient une carte). On fait maintenant tout ça
   AVANT de lancer la boucle, pendant que l'écran de choix est affiché :
     1. attendre que les photos soient chargées et appliquées (photosSettled) ;
     2. envoyer chaque texture à la carte graphique (renderer.initTexture), par
        paquets de ~20 ms par image : la page reste réactive ;
     3. compiler tous les shaders en PARALLÈLE (renderer.compileAsync, extension
        KHR_parallel_shader_compile) : la carte graphique compile sans bloquer la page ;
     4. un PREMIER DESSIN de chaque matériau, hors écran, un paquet par image : sous
        Windows (ANGLE / Direct3D), la carte graphique finit de préparer chaque shader à
        son premier dessin, même compilé d'avance — c'était l'essentiel du blocage
        (une seule grande image figée) ;
     5. une première vraie image derrière le menu (ombres calculées une fois, passes
        de post-traitement).
   Les boutons de mode ne s'activent qu'une fois prêt : le verrouillage de la souris
   exige un clic de l'utilisateur, on ne peut donc pas « démarrer plus tard tout seul ».
   ===================================================================== */
export const startup = { ready: false, ms: 0, phases: {} };   // phases : durée de chaque étape (ms), pour mesurer
const loadFill = document.querySelector('#loadBar > div'), loadText = document.getElementById('loadText');

function showProgress(k, label) {
  const pc = Math.round(Math.min(1, k) * 100);
  if (loadFill) loadFill.style.width = pc + '%';
  if (loadText) loadText.textContent = `${label} ${pc} %`;
}
/** Image suivante (ou 50 ms si l'onglet est masqué : requestAnimationFrame n'y tourne plus). */
const nextFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 50); });

/** Un objet représentatif par couple (matériau, disposition des attributs de géométrie) :
 *  c'est ce couple que la carte graphique prépare au premier dessin. */
function warmupList(scene) {
  const reps = new Map();
  scene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isSprite || o.isLine) || !o.visible || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const attrs = o.geometry ? Object.keys(o.geometry.attributes).sort().join(',') : '';
    const key = mats.map(m => m.uuid).join('|') + '/' + attrs + (o.isInstancedMesh ? '/inst' : '') + (o.isSkinnedMesh ? '/skin' : '');
    if (!reps.has(key)) reps.set(key, o);
  });
  return [...reps.values()];
}
/** Premier dessin de chaque représentant, seul, dans une petite cible au format de celle du
 *  post-traitement (RGBA demi-flottant) ; toutes les lumières restent en place, sinon les
 *  shaders préparés ne seraient pas ceux du jeu. Budget ~20 ms par image. */
async function warmupDraws(renderer, scene, camera, onProgress) {
  const all = [];
  scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible) all.push(o); });
  const reps = warmupList(scene);
  const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
  const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;                   // les ombres seront calculées à la vraie première image
  for (const o of all) o.visible = false;
  renderer.setRenderTarget(rt);
  let longest = 0;
  try {
    for (let i = 0; i < reps.length;) {
      const tf = performance.now();
      while (i < reps.length && performance.now() - tf < 20) {
        const o = reps[i++], culled = o.frustumCulled, td = performance.now();
        o.visible = true; o.frustumCulled = false;
        renderer.render(scene, camera);
        o.visible = false; o.frustumCulled = culled;
        longest = Math.max(longest, performance.now() - td);
      }
      onProgress(i / reps.length);
      renderer.setRenderTarget(prevTarget); await nextFrame(); renderer.setRenderTarget(rt);
    }
  } finally {
    for (const o of all) o.visible = true;
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.needsUpdate = prevShadow;
    rt.dispose();
  }
  return { draws: reps.length, longest: Math.round(longest) };
}

/** Toutes les textures utilisées par les matériaux de la scène (propriétés et uniformes). */
function sceneTextures(scene) {
  const found = new Set();
  const add = v => { if (v && v.isTexture && !v.isRenderTargetTexture && v.image) found.add(v); };
  scene.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const k in m) add(m[k]);
      if (m.uniforms) for (const k in m.uniforms) add(m.uniforms[k]?.value);
    }
  });
  return [...found];
}

export async function prepareScene({ renderer, scene, camera, composer }) {
  const t0 = performance.now();
  startup.lights = padPointLights(scene);                   // AVANT toute compilation : même texte de shader à chaque visite
  showProgress(0.02, 'Préparation de la rue…');
  await nextFrame();                                        // laisse le menu s'afficher

  let tp = performance.now();
  const phase = name => { const n = performance.now(); startup.phases[name] = Math.round(n - tp); tp = n; };
  await photosSettled((done, total) => showProgress(0.02 + 0.38 * (total ? done / total : 1), 'Chargement des photos…'));

  phase('photos');
  const texs = sceneTextures(scene);
  for (let i = 0; i < texs.length;) {
    const tf = performance.now();
    while (i < texs.length && performance.now() - tf < 20) {
      const tt = performance.now(); renderer.initTexture(texs[i++]);
      startup.texLongest = Math.max(startup.texLongest ?? 0, Math.round(performance.now() - tt));
    }
    showProgress(0.4 + 0.3 * i / texs.length, 'Envoi des textures…');
    await nextFrame();
  }

  phase('textures');
  let k = 0.72;   // (les shaders vont de 72 à 94 %)
  showProgress(k, 'Préparation des shaders…');
  let lastTick = performance.now(); startup.shaderStall = 0;       // plus long blocage de la page pendant la compilation
  const creep = setInterval(() => {
    const n = performance.now(); startup.shaderStall = Math.max(startup.shaderStall, Math.round(n - lastTick - 120)); lastTick = n;
    showProgress(k = Math.min(0.94, k + 0.012), 'Préparation des shaders…');
  }, 120);
  try { await renderer.compileAsync(scene, camera); } finally { clearInterval(creep); }

  phase('shaders');
  startup.warmup = await warmupDraws(renderer, scene, camera, p => showProgress(0.94 + 0.04 * p, 'Premiers dessins…'));
  phase('premiers-dessins');
  showProgress(0.98, 'Dernière touche…');
  await nextFrame();
  composer.render();                                        // ombres + post-traitement, derrière le menu
  await nextFrame();

  phase('premiere-image');
  startup.ready = true; startup.ms = Math.round(performance.now() - t0);
  document.getElementById('loadBox').hidden = true;
  for (const b of document.querySelectorAll('.mode-btn')) b.disabled = false;
}
