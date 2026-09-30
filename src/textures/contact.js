import { makeCanvas, toTexture } from './canvas.js';

/** Tache d'ombre de contact : noir opaque au centre, transparent au bord.
 *  Seul le canal alpha compte, le matériau est noir. */
export function makeContactBlobTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.4, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTexture(c, false, false);
}

/** Dégradé de bord : opaque en u = 0, transparent en u = 1. Pour la jonction
 *  mur / sol, qui est une ligne et non une tache. */
export function makeContactEdgeTexture() {
  const W = 64, H = 4, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.22, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return toTexture(c, false, false);
}
