import { makeCanvas, toTexture, addGrain } from './canvas.js';

/** Enseigne de boutique : caisson lumineux (rétro-éclairé, tubes inégaux) ou panneau éteint et encrassé.
 *  1024×192 pour une bande d'environ 8 m × 0,8 m : les lettres restent nettes de près. */
export function makeSignTexture(text, lit) {
  const W = 1024, H = 192, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const palettes = [['#8f1a12', '#fff2e0'], ['#1a2a6a', '#ffe36a'], ['#f2c21a', '#1a1a1a'], ['#1c1c1c', '#ff5a3a'], ['#2a5a2a', '#f4f4e0'], ['#f4f0e6', '#b3121a'], ['#0e3a6a', '#ffffff']];
  const [bg, fg] = palettes[Math.floor(Math.random() * palettes.length)];

  // fond : caisson rétro-éclairé (centre plus clair, bords qui tombent) ou panneau mat éteint
  if (lit) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, bg); g.addColorStop(1, shade(bg, 0.55));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // tubes fatigués : quelques zones plus sombres, une bande faiblarde
    for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.14})`; ctx.fillRect(Math.random() * W, 0, 60 + Math.random() * 160, H); }
  } else {
    ctx.fillStyle = shade(bg, 0.28); ctx.fillRect(0, 0, W, H);
  }
  // cadre en aluminium : bord sombre + filet clair
  ctx.strokeStyle = '#1c1c1e'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.strokeRect(17, 17, W - 34, H - 34);

  // nom : taille ajustée à la largeur disponible
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sub = Math.random() < 0.45 ? SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)] : null;
  let size = sub ? 96 : 118;
  do { ctx.font = `bold ${size}px Impact, "Arial Narrow", sans-serif`; size -= 4; } while (ctx.measureText(text).width > W - 120 && size > 40);
  const ty = sub ? H * 0.42 : H / 2;
  ctx.fillStyle = lit ? fg : shade(fg, 0.42);
  if (lit) { ctx.shadowColor = fg; ctx.shadowBlur = 18; }
  ctx.fillText(text, W / 2, ty);
  ctx.shadowBlur = 0;
  if (sub) {
    ctx.font = `bold 34px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = lit ? fg : shade(fg, 0.4);
    ctx.fillText(sub, W / 2, H * 0.78);
  }
  // encrassement : coulures depuis le haut, poussière dans les angles
  ctx.fillStyle = `rgba(0,0,0,${lit ? 0.12 : 0.32})`;
  for (let i = 0; i < 18; i++) ctx.fillRect(Math.random() * W, 16, 3 + Math.random() * 8, 20 + Math.random() * (lit ? 40 : 120));
  addGrain(ctx, W, H, lit ? 10 : 18);
  return toTexture(c, true, false);
}

/** Assombrit / éclaircit une couleur hexa (#rrggbb) d'un facteur. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k | 0), g = Math.min(255, ((n >> 8) & 255) * k | 0), b = Math.min(255, (n & 255) * k | 0);
  return `rgb(${r},${g},${b})`;
}

const SUBTITLES = ['OPEN 24 HOURS', 'WE DELIVER', 'ATM INSIDE', 'SINCE 1979', 'LOTTO • BEER • ICE', 'COLD CUTS • SANDWICHES', 'WASH & FOLD', 'SAME DAY SERVICE', 'KEYS MADE', 'TEL. 212-555-0148'];

export const SHOP_NAMES = ['LAUNDROMAT', 'DELI GROCERY', '24 HR PHARMACY', 'NAILS SPA', 'TAILOR', 'LIQUORS', 'BODEGA', 'DRY CLEANERS', 'LOCKSMITH', 'BARBER SHOP', 'DISCOUNT', 'CHECK CASHING',
  'PIZZA', 'HARDWARE', 'SMOKE SHOP', 'FLORIST', 'SHOE REPAIR', 'MINI MARKET', 'WINE & SPIRITS', 'THAI KITCHEN', 'BAGELS', 'COFFEE SHOP'];
