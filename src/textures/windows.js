import { makeCanvas, toTexture } from './canvas.js';

/** Intérieurs de fenêtres allumées : nu, rideaux, stores. */
export function makeWindowInteriorTextures() {
  const mk = (draw) => { const c = makeCanvas(64, 96), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 96); g.addColorStop(0, '#ffe2b0'); g.addColorStop(1, '#c48c50');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 96); draw(ctx); return toTexture(c, true, false); };
  const plain = mk(ctx => { ctx.fillStyle = 'rgba(60,30,20,0.35)'; ctx.fillRect(0, 60, 64, 36); });     // meuble sombre en bas
  const curtain = mk(ctx => {
    for (const x of [0, 44]) { const g = ctx.createLinearGradient(x, 0, x + 20, 0); g.addColorStop(0, '#3a2418'); g.addColorStop(1, '#6a4a30'); ctx.fillStyle = g; ctx.fillRect(x, 0, 20, 96); }
    for (let x = 2; x < 64; x += 5) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, 0, 2, 96); }
  });
  const blinds = mk(ctx => { for (let y = 0; y < 96; y += 6) { ctx.fillStyle = 'rgba(40,30,25,0.75)'; ctx.fillRect(0, y, 64, 2.5); } });
  return [plain, curtain, blinds];
}

/** Fenêtres ÉTEINTES : sans rien derrière la vitre, une façade de nuit n'est qu'un
 *  damier de trous noirs. Ici ce qu'on devine d'une pièce sombre : store à
 *  enrouleur à moitié baissé, rideaux tirés, stores vénitiens fermés. Couleurs
 *  sourdes : ces textures sont ÉCLAIRÉES par la rue (matériau standard), elles ne
 *  brillent pas d'elles-mêmes. */
export function makeDarkWindowTextures() {
  const mk = (draw) => { const c = makeCanvas(64, 96), ctx = c.getContext('2d');
    ctx.fillStyle = '#16181c'; ctx.fillRect(0, 0, 64, 96); draw(ctx); return toTexture(c, true, false); };
  const shade = mk(ctx => {                                           // store à enrouleur, arrêté à mi-hauteur
    const y = 30 + Math.random() * 30, g = ctx.createLinearGradient(0, 0, 0, y);
    g.addColorStop(0, '#8a8272'); g.addColorStop(1, '#6e675a'); ctx.fillStyle = g; ctx.fillRect(2, 0, 60, y);
    ctx.fillStyle = '#3a342c'; ctx.fillRect(2, y - 3, 60, 3);          // barre de lestage
  });
  const curtain = mk(ctx => {                                         // rideaux tirés, plis verticaux
    for (let x = 0; x < 64; x += 4) { ctx.fillStyle = x % 8 ? '#4a3a34' : '#3a2c28'; ctx.fillRect(x, 0, 4, 96); }
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(30, 0, 3, 96);      // jonction des deux pans
  });
  const blinds = mk(ctx => { for (let y = 0; y < 96; y += 5) { ctx.fillStyle = '#6c6c68'; ctx.fillRect(0, y, 64, 3.5); } });
  return [shade, curtain, blinds];
}
