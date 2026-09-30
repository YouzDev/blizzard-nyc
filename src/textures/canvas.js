import * as THREE from 'three';
import { renderer } from '../core/renderer.js';

/* =====================================================================
   2. TEXTURES PROCÉDURALES (canvas) : couleur + relief
   ===================================================================== */
export const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function toTexture(canvas, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
/** Carte de hauteur (gris) → normal map tangente (Sobel, tuile raccord). Une normal
 *  map donne des arêtes de mortier et de joints nettes sous la lumière rasante des
 *  lampadaires, là où une bumpMap ne fait qu'un flou. Convention OpenGL (+Y = +V),
 *  celle de Three.js : le sens vertical du canvas est donc inversé. */
export function heightToNormal(canvas, strength = 2) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h), octx = out.getContext('2d'), img = octx.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx * inv * 0.5 + 0.5) * 255; d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}
export function addGrain(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amount; d[i] += n; d[i+1] += n; d[i+2] += n; }
  ctx.putImageData(img, 0, 0);
}
