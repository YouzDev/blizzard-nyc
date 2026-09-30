import * as THREE from 'three';
import { renderer } from '../core/renderer.js';

/* =====================================================================
   2 ter. TEXTURES PHOTO (Poly Haven, CC0 — voir assets/textures/SOURCES.md)
   Le jeu démarre avec les textures générées en canvas, puis bascule sur les photos
   dès qu'elles sont chargées : aucune attente au lancement, et SECOURS automatique —
   si une image manque ou ne se charge pas, le matériau garde sa texture canvas.
   En file:// on ne tente même pas : le navigateur y considère chaque fichier comme
   une origine étrangère et refuse de l'envoyer à la carte graphique (texture noire,
   erreur de sécurité) — blizzard-nyc.html reste donc jouable, avec le canvas.
   Chaque jeu de textures = couleur (sRGB) + relief OpenGL + rugosité, en 1K.
   ===================================================================== */
export const PHOTO_ENABLED = location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nophoto');
const texLoader = new THREE.TextureLoader();
const photoCache = new Map();
let photoSetsDone = 0;                       // jeux terminés (chargés ou en échec), pour la progression

/** Charge (une seule fois) les trois cartes d'une texture : Promise<{ map, normal, rough }>. */
export function loadPhotoSet(name) {
  if (!PHOTO_ENABLED) return Promise.reject(new Error('photos désactivées'));
  if (!photoCache.has(name)) {
    const one = (suffix, srgb) => new Promise((ok, ko) => texLoader.load(`assets/textures/${name}/${name}_${suffix}_1k.jpg`, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      ok(t);
    }, undefined, ko));
    const p = Promise.all([one('diff', true), one('nor_gl', false), one('rough', false)]).then(([map, normal, rough]) => ({ map, normal, rough }));
    p.then(() => photoSetsDone++, () => photoSetsDone++);
    photoCache.set(name, p);
  }
  return photoCache.get(name);
}

/** Couleur moyenne (linéaire) d'une texture chargée : l'image est réduite à 16×16 dans
 *  un canvas. Sert à normaliser les photos de neige — chacune a été prise sous une
 *  lumière différente (snow_floor est grise, snow_03 brunâtre), alors que dans le jeu
 *  la neige doit garder le blanc bleuté choisi, quelle que soit la photo. */
export function photoMean(tex) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(tex.image, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data, m = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += Math.pow(d[i + k] / 255, 2.2);
  return new THREE.Vector3(m[0] / 256, m[1] / 256, m[2] / 256);
}

/** Copie d'un jeu (même image, répétition propre) : chaque usage a son échelle. */
function withRepeat(set, ru, rv) {
  const c = t => { const k = t.clone(); k.repeat.set(ru, rv); k.needsUpdate = true; return k; };
  return { map: c(set.map), normal: c(set.normal), rough: c(set.rough) };
}

/** Bascule un MeshStandardMaterial sur la photo `name` dès qu'elle est prête.
 *  ru / rv : répétition à appliquer (dépend des UV de la géométrie).
 *  `after(mat, set)` : réglages propres à l'usage (teinte, uniformes du shader…). */
export function usePhoto(mat, name, ru, rv, after) {
  loadPhotoSet(name).then(set => {
    const s = withRepeat(set, ru, rv);
    mat.map = s.map; mat.normalMap = s.normal; mat.roughnessMap = s.rough; mat.roughness = 1;
    if (after) after(mat, s);
    mat.needsUpdate = true;
  }).catch(() => { /* secours : on garde la texture canvas */ });
}

/** Attend que TOUTES les photos demandées soient arrivées (ou en échec) ET appliquées aux
 *  matériaux : les .then des appelants passent avant nous, et certains en demandent
 *  d'autres en cascade (sol : 2e photo après la 1re) — on boucle tant que la liste grandit.
 *  onProgress(faits, total) ; renvoie false si le délai est dépassé (les retardataires
 *  basculeront plus tard, avec un petit à-coup). Sans photos (file://), résout aussitôt. */
export async function photosSettled(onProgress, timeoutMs = 8000) {
  const t0 = performance.now();
  for (;;) {
    const n = photoCache.size;
    await Promise.race([Promise.allSettled([...photoCache.values()]), new Promise(r => setTimeout(r, 120))]);
    onProgress?.(photoSetsDone, photoCache.size);
    await new Promise(r => setTimeout(r, 0));             // laisse les matériaux basculer
    if (photoSetsDone === photoCache.size && photoCache.size === n) return true;
    if (performance.now() - t0 > timeoutMs) return false;
  }
}
