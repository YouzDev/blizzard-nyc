import { makeCanvas, toTexture, addGrain } from './canvas.js';

/* Décorations latérales des véhicules utilitaires (fond transparent : la peinture de
   la carrosserie reste visible autour). Noms et numéros inventés — aucune marque. */
const LIV_W = 1024, LIV_H = 384;   // noms uniques : le build colle tous les modules dans une même portée
const livTxt = (ctx, s, x, y, size, col, font = 'bold {s}px Arial, Helvetica, sans-serif') => {
  ctx.font = font.replace('{s}', size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, x, y);
};

/** Ambulance : bandeau rouge et liseré orange, AMBULANCE en rouge, étoile de vie bleue. */
export function makeAmbulanceLivery() {
  const W = LIV_W, H = LIV_H;
  const c = makeCanvas(LIV_W, LIV_H), ctx = c.getContext('2d');
  ctx.fillStyle = '#c8161a'; ctx.fillRect(0, H * 0.62, W, H * 0.13);
  ctx.fillStyle = '#f28a1a'; ctx.fillRect(0, H * 0.76, W, H * 0.04);
  livTxt(ctx, 'AMBULANCE', W * 0.58, H * 0.38, 120, '#c8161a', 'bold {s}px Impact, "Arial Narrow", sans-serif');
  // étoile de vie : trois barres croisées, bâton au centre
  ctx.save(); ctx.translate(W * 0.12, H * 0.4); ctx.fillStyle = '#1a4fb4';
  for (let k = 0; k < 3; k++) { ctx.save(); ctx.rotate(k * Math.PI / 3); ctx.fillRect(-18, -62, 36, 124); ctx.restore(); }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-3, -40, 6, 80); ctx.restore();
  livTxt(ctx, 'EMERGENCY MEDICAL SERVICES  •  UNIT 27', W * 0.5, H * 0.69, 30, '#ffffff');
  return toTexture(c, true, false);
}

/** Camion de livraison : grand panneau à l'enseigne d'un grossiste fictif. */
export function makeTruckLivery() {
  const W = LIV_W, H = LIV_H;
  const c = makeCanvas(LIV_W, LIV_H), ctx = c.getContext('2d');
  ctx.fillStyle = '#f2efe6'; ctx.fillRect(10, 10, W - 20, H - 20);
  ctx.fillStyle = '#1e5a2c'; ctx.fillRect(10, H * 0.72, W - 20, H * 0.18);
  ctx.strokeStyle = '#1e5a2c'; ctx.lineWidth = 8; ctx.strokeRect(14, 14, W - 28, H - 28);
  livTxt(ctx, 'HUDSON VALLEY', W / 2, H * 0.3, 96, '#1e5a2c', 'bold {s}px Impact, "Arial Narrow", sans-serif');
  livTxt(ctx, 'FRESH PRODUCE & DAIRY', W / 2, H * 0.53, 50, '#c8521a');
  livTxt(ctx, 'BRONX, NY  •  (718) 555-0199', W / 2, H * 0.81, 36, '#f2efe6');
  addGrain(ctx, LIV_W, LIV_H, 10);
  return toTexture(c, true, false);
}

/** Camion de glaces : bandes pastel, ICE CREAM, cornets, et le guichet de service. */
export function makeIceCreamLivery() {
  const W = LIV_W, H = LIV_H;
  const c = makeCanvas(LIV_W, LIV_H), ctx = c.getContext('2d');
  ctx.fillStyle = '#7ab8e8'; ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.fillStyle = '#f27aa8'; ctx.fillRect(0, H * 0.72, W, H * 0.05);
  // guichet : vitre sombre + petit auvent rayé
  ctx.fillStyle = '#1a2230'; ctx.fillRect(W * 0.36, H * 0.2, W * 0.3, H * 0.44);
  ctx.strokeStyle = '#d8dde4'; ctx.lineWidth = 8; ctx.strokeRect(W * 0.36, H * 0.2, W * 0.3, H * 0.44);
  for (let k = 0; k < 10; k++) { ctx.fillStyle = k % 2 ? '#ffffff' : '#f27aa8'; ctx.fillRect(W * 0.34 + k * W * 0.034, H * 0.12, W * 0.034, H * 0.07); }
  livTxt(ctx, 'ICE CREAM', W * 0.17, H * 0.3, 70, '#1a4fb4', 'bold {s}px Impact, "Arial Narrow", sans-serif');
  livTxt(ctx, 'SOFT SERVE', W * 0.17, H * 0.48, 38, '#f27aa8');
  livTxt(ctx, 'SHAKES • SUNDAES', W * 0.84, H * 0.5, 34, '#1a4fb4');
  // cornets : gaufre en triangle quadrillé, volute blanche
  for (const cx of [W * 0.79, W * 0.9]) {
    ctx.fillStyle = '#e0a860'; ctx.beginPath(); ctx.moveTo(cx - 34, H * 0.2); ctx.lineTo(cx + 34, H * 0.2); ctx.lineTo(cx, H * 0.42); ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,30,0.6)'; ctx.lineWidth = 2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(cx + k * 14 - 20, H * 0.2); ctx.lineTo(cx + k * 14 + 20, H * 0.38); ctx.stroke(); }
    ctx.fillStyle = '#fbf6ee'; for (const [dy, r] of [[0.16, 34], [0.1, 26], [0.05, 16]]) { ctx.beginPath(); ctx.arc(cx, H * dy + 12, r, 0, Math.PI * 2); ctx.fill(); }
  }
  return toTexture(c, true, false);
}

/** Camionnette d'artisan : lettrage simple sur la portière et le flanc. */
export function makeVanLivery() {
  const W = LIV_W, H = LIV_H;
  const c = makeCanvas(LIV_W, LIV_H), ctx = c.getContext('2d');
  livTxt(ctx, "D'ANGELO & SONS", W * 0.5, H * 0.34, 84, '#1a3a6a', 'bold {s}px Impact, "Arial Narrow", sans-serif');
  livTxt(ctx, 'PLUMBING • HEATING • BOILERS', W * 0.5, H * 0.55, 40, '#b41a1a');
  livTxt(ctx, 'LIC. #2291  •  (212) 555-0173', W * 0.5, H * 0.72, 32, '#1a3a6a');
  return toTexture(c, true, false);
}
