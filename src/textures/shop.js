import { makeCanvas, toTexture, addGrain } from './canvas.js';

/** Intérieur de boutique vu à travers la vitrine : plafond de néons, rayonnages,
 *  produits, comptoir. Trois ambiances selon le type de commerce. La texture se
 *  répète horizontalement (~4 m par tuile) pour suivre la largeur de la baie. */
// palettes d'emballages : couleurs franches de marques, mais pas l'arc-en-ciel
const GROCERY = ['#c8202a', '#e8b81a', '#1a4fa0', '#efe9dc', '#e2641a', '#2a7a34', '#5a2a7a', '#1c1c1c', '#8a1a22', '#f0e04a'];
const PHARMA = ['#f4f4f0', '#e8eef4', '#d8e8f0', '#f0dce4', '#1a4fa0', '#c8202a', '#f4f4f0', '#dfeadf'];
export function makeShopInteriorTexture(kind) {
  const W = 1024, H = 384, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const rnd = (a, b) => a + Math.random() * (b - a);

  if (kind === 'laundry') {
    // laverie : murs pâles, lumière froide, rangée de machines blanches à hublot sombre
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e9f2ee'); g.addColorStop(1, '#a9b8b3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ceiling(ctx, W, H, '#f4fbff');
    for (let x = 12; x < W; x += 132) {
      ctx.fillStyle = '#f2f4f2'; roundRect(ctx, x, H * 0.36, 118, H * 0.5, 8); ctx.fill();
      ctx.fillStyle = '#c9ced0'; ctx.fillRect(x + 8, H * 0.38, 102, 22);                        // bandeau de commandes
      ctx.fillStyle = '#1a2026'; ctx.beginPath(); ctx.arc(x + 59, H * 0.66, 34, 0, 7); ctx.fill(); // hublot
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x + 48, H * 0.62, 12, 0, 7); ctx.fill();
    }
    floor(ctx, W, H, '#b9c0c4', '#8e979c');
  } else if (kind === 'bright') {
    // pharmacie / ongles / encaissement : blanc clinique, rayonnages clairsemés, affiche promo
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fbfbf7'); g.addColorStop(1, '#c8c6bf');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ceiling(ctx, W, H, '#ffffff');
    for (let y = H * 0.32; y < H * 0.82; y += H * 0.17) shelf(ctx, W, y, 0.6, H * 0.17, PHARMA);
    ctx.fillStyle = Math.random() < 0.5 ? '#c8202a' : '#1a4fa0'; ctx.fillRect(W * 0.7, H * 0.28, W * 0.22, H * 0.36);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 52px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SALE', W * 0.81, H * 0.5);
    floor(ctx, W, H, '#d9d9d4', '#a9a9a3');
  } else {
    // épicerie / bodega / liquor : chaleur, rayonnages pleins de couleurs, frigo vitré à droite, comptoir
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b89a78'); g.addColorStop(1, '#4a3424');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ceiling(ctx, W, H, '#fff1c8');
    // rayonnages : remplissage inégal, couleurs d'emballages ternies par la vitre et la distance
    for (let y = H * 0.3; y < H * 0.86; y += H * 0.185) shelf(ctx, W * 0.72, y, 0.85, H * 0.185, GROCERY);
    // ombre portée des étagères et des montants : casse la régularité du motif
    for (let x = 0; x < W * 0.72; x += 170 + Math.random() * 90) { ctx.fillStyle = 'rgba(20,12,6,0.55)'; ctx.fillRect(x, H * 0.18, 10 + Math.random() * 8, H * 0.7); }
    const sh = ctx.createLinearGradient(0, H * 0.16, 0, H * 0.5); sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.fillRect(0, H * 0.16, W, H * 0.34);
    // vitrine réfrigérée : panneau bleuté lumineux, montants, canettes en lignes
    ctx.fillStyle = '#dff0ff'; ctx.fillRect(W * 0.74, H * 0.22, W * 0.26, H * 0.66);
    for (let y = H * 0.3; y < H * 0.86; y += 36) {                 // bouteilles par rangées d'une même marque
      for (let x = W * 0.75; x < W * 0.99;) {
        const col = GROCERY[Math.floor(Math.random() * GROCERY.length)], n = 2 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n && x < W * 0.99; k++, x += 13) {
          ctx.fillStyle = col; ctx.fillRect(x, y + 8, 10, 24); ctx.fillRect(x + 3, y, 4, 9);
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x, y + 16, 10, 6);
        }
        x += 4;
      }
      ctx.fillStyle = 'rgba(200,210,220,0.9)'; ctx.fillRect(W * 0.74, y + 33, W * 0.26, 3);
    }
    ctx.fillStyle = '#2a2f35'; for (const x of [W * 0.74, W * 0.865, W * 0.99]) ctx.fillRect(x - 3, H * 0.22, 6, H * 0.66);
    floor(ctx, W, H, '#7a6a5a', '#3a3028');
    // comptoir au premier plan, à gauche
    ctx.fillStyle = '#3a2a1e'; ctx.fillRect(0, H * 0.7, W * 0.3, H * 0.3);
    ctx.fillStyle = '#8a7a66'; ctx.fillRect(0, H * 0.7, W * 0.3, 10);
  }
  addGrain(ctx, W, H, 10);
  return toTexture(c, true, true);

  function ceiling(ctx, W, H, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H * 0.16);
    for (let x = 30; x < W; x += 210) {
      ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.fillStyle = col; ctx.fillRect(x, H * 0.05, 150, 14); ctx.shadowBlur = 0;
    }
  }
  // Une tablette de produits : des LOTS d'articles identiques côte à côte (les
  // « facings » d'un vrai rayon), chacun avec sa forme — canette, boîte, bouteille,
  // sachet — et sa bande d'étiquette ; bande de prix blanche sur le chant. L'ancienne
  // version tirait des rectangles hauts et fins de teinte aléatoire : on lisait une
  // bibliothèque, pas une épicerie.
  function shelf(ctx, W, y, fill, rowH, palette) {
    const sh = ctx.createLinearGradient(0, y - rowH, 0, y - rowH * 0.55);           // ombre sous la tablette du dessus
    sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sh; ctx.fillRect(0, y - rowH, W, rowH * 0.45);
    for (let x = 4; x < W;) {
      const type = Math.random(), col = palette[Math.floor(Math.random() * palette.length)];
      const lab = Math.random() < 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)';
      let w, h, draw;
      if (type < 0.3) { w = rowH * 0.2; h = rowH * 0.34; draw = (px) => { ctx.fillStyle = col; ctx.fillRect(px, y - h, w, h); ctx.fillStyle = lab; ctx.fillRect(px, y - h * 0.7, w, h * 0.35); ctx.fillStyle = 'rgba(220,220,220,0.8)'; ctx.fillRect(px, y - h, w, 2); }; }
      else if (type < 0.6) { w = rowH * rnd(0.28, 0.42); h = rowH * rnd(0.5, 0.72); draw = (px) => { ctx.fillStyle = col; ctx.fillRect(px, y - h, w, h); ctx.fillStyle = lab; ctx.fillRect(px + 2, y - h * 0.75, w - 4, h * 0.3); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px + w - 3, y - h, 3, h); }; }
      else if (type < 0.8) { w = rowH * 0.16; h = rowH * rnd(0.6, 0.78); draw = (px) => { ctx.fillStyle = col; ctx.fillRect(px, y - h * 0.68, w, h * 0.68); ctx.fillRect(px + w * 0.3, y - h, w * 0.4, h * 0.34); ctx.fillStyle = lab; ctx.fillRect(px, y - h * 0.5, w, h * 0.22); }; }
      else { w = rowH * 0.38; h = rowH * 0.5; draw = (px) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + 2, y - h); ctx.quadraticCurveTo(px + w / 2, y - h - 6, px + w - 2, y - h); ctx.lineTo(px + w, y); ctx.fill(); ctx.fillStyle = lab; ctx.fillRect(px + 4, y - h * 0.6, w - 8, h * 0.28); }; }
      const n = 2 + Math.floor(Math.random() * 5);
      if (Math.random() > fill) { x += w * n * 0.6; continue; }                    // trou dans le rayon
      for (let k = 0; k < n && x + w < W; k++, x += w + 1) draw(x);
      x += 3;
    }
    ctx.fillStyle = 'rgba(30,20,12,0.9)'; ctx.fillRect(0, y, W, 5);                  // tablette
    ctx.fillStyle = 'rgba(235,235,225,0.9)'; ctx.fillRect(0, y + 5, W, 4);           // bande de prix
    for (let x = 10; x < W; x += rnd(40, 90)) { ctx.fillStyle = '#f2d21a'; ctx.fillRect(x, y + 5, 10, 4); }
  }
  function floor(ctx, W, H, a, b) {
    const g = ctx.createLinearGradient(0, H * 0.86, 0, H); g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.86, W, H * 0.14);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

/** Petit néon « OPEN » posé dans la vitrine. Couleur > 1 côté matériau pour le bloom. */
export function makeOpenSignTexture() {
  const W = 256, H = 128, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0608'; ctx.fillRect(0, 0, W, H);
  ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 26; ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(16, 14, W - 32, H - 28, 18) : ctx.rect(16, 14, W - 32, H - 28); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 66px Impact, "Arial Narrow", sans-serif';
  ctx.shadowBlur = 30; ctx.fillStyle = '#ff6a5a'; ctx.fillText('OPEN', W / 2, H / 2 + 2);
  ctx.shadowBlur = 8; ctx.fillStyle = '#fff0ee'; ctx.fillText('OPEN', W / 2, H / 2 + 2);
  return toTexture(c, true, false);
}

/** Planche d'autocollants et de néons de vitrine — ce qui fait qu'une vitrine de
 *  bodega new-yorkaise se reconnaît de loin : LOTTO, ATM, EBT, cartes acceptées,
 *  affiche de promo, et des néons de bière / glace / café. Une seule texture
 *  1024×512 découpée en cases ; `DECALS` donne pour chaque motif sa case (en px),
 *  sa taille réelle (m) et s'il s'agit d'un néon (rendu lumineux, bloom). */
export const DECALS = [
  { key: 'lotto',  px: [0, 0, 256, 128],     size: [0.46, 0.23], neon: false },
  { key: 'atm',    px: [256, 0, 128, 128],   size: [0.24, 0.24], neon: false },
  { key: 'ebt',    px: [384, 0, 256, 128],   size: [0.36, 0.18], neon: false },
  { key: 'cards',  px: [640, 0, 256, 128],   size: [0.3, 0.15], neon: false },
  { key: 'promo',  px: [896, 0, 128, 256],   size: [0.42, 0.84], neon: false },
  { key: 'menu',   px: [0, 128, 192, 256],   size: [0.36, 0.48], neon: false },
  { key: 'beer',   px: [192, 128, 320, 128], size: [0.62, 0.25], neon: true },
  { key: 'ice',    px: [512, 128, 192, 128], size: [0.42, 0.28], neon: true },
  { key: 'coffee', px: [704, 128, 192, 128], size: [0.46, 0.3], neon: true },
  { key: 'atmneon',px: [192, 256, 256, 128], size: [0.5, 0.25], neon: true },
];
export function makeWindowDecalAtlas() {
  const W = 1024, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const R = k => DECALS.find(d => d.key === k).px;
  const txt = (s, x, y, size, col, font = 'Impact, "Arial Narrow", sans-serif') => { ctx.font = `bold ${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, x, y); };
  const plate = (k, bg, pad = 6) => { const [x, y, w, h] = R(k); ctx.fillStyle = bg; ctx.fillRect(x + pad, y + pad, w - 2 * pad, h - 2 * pad); return [x, y, w, h]; };
  // autocollants imprimés (fond opaque, un peu passés par le soleil)
  { const [x, y, w, h] = plate('lotto', '#f2c21a'); ctx.fillStyle = '#c8202a'; ctx.fillRect(x + 14, y + 14, w - 28, h - 28); txt('LOTTO', x + w / 2, y + h / 2 + 4, 72, '#ffe24a'); }
  { const [x, y, w, h] = plate('atm', '#1a4fa0'); txt('ATM', x + w / 2, y + h / 2 + 4, 56, '#ffffff'); }
  { const [x, y, w, h] = plate('ebt', '#f4f4ee'); txt('EBT', x + 70, y + h / 2, 60, '#1a6a2a'); txt('ACCEPTED', x + 175, y + h / 2, 30, '#1a1a1a', 'Arial, sans-serif'); }
  { const [x, y, w, h] = plate('cards', '#e8e8e2');
    for (const [i, col] of ['#1a3a8a', '#d8261a', '#f0a018'].entries()) { ctx.fillStyle = col; ctx.fillRect(x + 20 + i * 76, y + 34, 64, 42); }
    txt('WE ACCEPT', x + w / 2, y + 100, 22, '#222', 'Arial, sans-serif'); }
  { const [x, y, w, h] = plate('promo', '#d8261a'); txt('SALE', x + w / 2, y + 60, 44, '#ffffff'); txt('2 FOR', x + w / 2, y + 120, 30, '#ffe24a'); txt('$5', x + w / 2, y + 175, 70, '#ffffff'); }
  { const [x, y, w, h] = plate('menu', '#efe6d0'); txt('MENU', x + w / 2, y + 34, 34, '#8a1a12');
    ctx.fillStyle = 'rgba(40,30,20,0.7)'; for (let k = 0; k < 9; k++) { ctx.fillRect(x + 22, y + 66 + k * 19, 90 + Math.random() * 40, 5); ctx.fillRect(x + w - 50, y + 66 + k * 19, 26, 5); } }
  // néons : tube coloré sur fond transparent, halo par flou
  const neon = (k, lines) => {
    const [x, y, w, h] = R(k);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (const [s, dx, dy, size, col] of lines) {
      ctx.font = `bold ${size}px "Brush Script MT", "Segoe Script", cursive`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = col; ctx.shadowBlur = 22; ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.strokeText(s, x + w / 2 + dx, y + h / 2 + dy);
      ctx.shadowBlur = 6; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.strokeText(s, x + w / 2 + dx, y + h / 2 + dy);
    }
    ctx.restore();
  };
  neon('beer', [['Cold Beer', 0, 4, 76, '#ff9a2a']]);
  neon('ice', [['ICE', 0, 4, 84, '#4ac8ff']]);
  neon('coffee', [['Coffee', 0, 4, 64, '#ff4a8a']]);
  neon('atmneon', [['ATM', 0, 4, 84, '#6aff7a']]);
  return toTexture(c, true, false);
}

/** Lambrequin imprimé : le nom du commerce et un numéro de téléphone en lettres
 *  claires sur la toile, comme sur la quasi-totalité des stores new-yorkais. */
export function makeValanceTexture(name, bgHex) {
  const W = 1024, H = 64, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#' + bgHex.toString(16).padStart(6, '0'); ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#efe8da';
  ctx.font = 'bold 38px Arial, Helvetica, sans-serif';
  const phone = `TEL. (212) 555-${String(1000 + Math.floor(Math.random() * 8999))}`;
  ctx.fillText(name, W * 0.33, H / 2 + 2);
  ctx.font = 'bold 26px Arial, Helvetica, sans-serif'; ctx.fillText(phone, W * 0.74, H / 2 + 2);
  addGrain(ctx, W, H, 14);
  return toTexture(c, true, false);
}

/** Toile rayée (deux bandes : couleur / crème) répétée sur la largeur du store. */
export function makeStripeTexture(bgHex) {
  const c = makeCanvas(8, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#' + bgHex.toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 8, 32);
  ctx.fillStyle = '#d8d0bc'; ctx.fillRect(0, 32, 8, 32);
  return toTexture(c, true, true);
}
