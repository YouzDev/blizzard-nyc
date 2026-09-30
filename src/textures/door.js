import { makeCanvas, toTexture, heightToNormal, addGrain } from './canvas.js';

/* =====================================================================
   PORTES D'IMMEUBLE (brownstones) — textures d'un VANTAIL entier, à l'échelle
   Un vantail de 0,63 × 2,35 m sur 256 × 1024 px (≈ 4,3 px/cm). Découpe classique
   d'une porte new-yorkaise à double vantail :
     - montants de 10 cm, traverse basse 15 cm, traverse haute 35 cm ;
     - panneau bas SURÉLEVÉ (0,15 → 0,65 m) : moulure, gorge, chanfrein, table en relief ;
     - traverse de serrure (0,65 → 0,9 m) ;
     - baie vitrée (0,9 → 2,0 m) bordée d'une moulure saillante — la vitre elle-même
       est un plan posé devant (voir buildEntrance), la texture n'y est pas vue.
   Relief en carte de hauteur → normal map (Sobel) : les moulures accrochent la lumière
   de la lanterne. Couleur : fil du bois vertical sur les montants, horizontal sur les
   traverses, vernis plus sombre dans les creux, usure claire autour de la poignée,
   frottements en bas, et la TRACE DE SEL blanchâtre laissée par la neige au pied.
   Deux variantes : bois verni (chêne teinté) ou peinture (grise, multipliée par la
   couleur du matériau) écaillée sur le bois.
   ===================================================================== */
const DOOR_W = 256, DOOR_H = 1024, DPU = DOOR_W / 0.63, DPV = DOOR_H / 2.35;
const dX = m => m * DPU, dY = m => DOOR_H - m * DPV;           // mètres depuis le bas → px depuis le haut

// zones du vantail en mètres : [x0, y0, x1, y1] (depuis le bas à gauche)
const D_STILE = 0.1;
const D_PANEL = [D_STILE, 0.15, 0.63 - D_STILE, 0.65];
const D_GLASS = [D_STILE, 0.9, 0.63 - D_STILE, 2.0];

/** Rectangle en mètres → px, avec un retrait `i` px de chaque côté. */
function dRectPx(ctx, r, i) { const x = dX(r[0]) + i, y = dY(r[3]) + i, w = dX(r[2] - r[0]) - 2 * i, h = (dY(r[1]) - dY(r[3])) - 2 * i; if (w > 0 && h > 0) ctx.fillRect(x, y, w, h); }
const dGrey = v => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${c},${c},${c})`; };

export function makeDoorLeafTextures(kind) {
  const c = makeCanvas(DOOR_W, DOOR_H), ctx = c.getContext('2d');
  const h = makeCanvas(DOOR_W, DOOR_H), hctx = h.getContext('2d');
  const r = makeCanvas(DOOR_W, DOOR_H), rctx = r.getContext('2d');
  const wood = kind === 'wood';

  // ---------- COULEUR : bois (ou sous-couche) avec son fil
  const base = wood ? [118, 72, 42] : [178, 176, 172];
  ctx.fillStyle = `rgb(${base})`; ctx.fillRect(0, 0, DOOR_W, DOOR_H);
  const grain = (x0, y0, x1, y1, vertical) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    const n = vertical ? (x1 - x0) * 0.9 : (y1 - y0) * 0.9;
    for (let i = 0; i < n; i++) {
      const t = Math.random(), dark = Math.random() < 0.55, a = (wood ? 0.1 : 0.035) + Math.random() * (wood ? 0.16 : 0.05);
      ctx.strokeStyle = dark ? `rgba(40,20,8,${a})` : `rgba(150,96,58,${a})`;
      if (!wood) ctx.strokeStyle = dark ? `rgba(90,90,90,${a})` : `rgba(230,230,230,${a})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.8; ctx.beginPath();
      if (vertical) { const x = x0 + t * (x1 - x0), wob = Math.random() * 3; for (let y = y0; y <= y1; y += 16) ctx.lineTo(x + Math.sin(y * 0.02 + i) * wob, y); }
      else { const y = y0 + t * (y1 - y0), wob = Math.random() * 3; for (let x = x0; x <= x1; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * wob); }
      ctx.stroke();
    }
    // quelques nœuds / flammes sur le bois verni
    if (wood) for (let k = 0; k < 2; k++) {
      const cx = x0 + Math.random() * (x1 - x0), cy = y0 + Math.random() * (y1 - y0), g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10 + Math.random() * 14);
      g.addColorStop(0, 'rgba(40,20,8,0.3)'); g.addColorStop(1, 'rgba(40,20,8,0)'); ctx.fillStyle = g; ctx.fillRect(cx - 30, cy - 30, 60, 60);
    }
    ctx.restore();
  };
  const sL = dX(D_STILE), sR = dX(0.63 - D_STILE);
  grain(0, 0, sL, DOOR_H, true); grain(sR, 0, DOOR_W, DOOR_H, true);                               // montants : fil vertical
  for (const [y0, y1] of [[0, 0.15], [0.65, 0.9], [2.0, 2.35]]) grain(sL, dY(y1), sR, dY(y0), false);   // traverses : fil horizontal
  grain(dX(D_PANEL[0]), dY(D_PANEL[3]), dX(D_PANEL[2]), dY(D_PANEL[1]), true);                             // panneau : fil vertical

  // ---------- RELIEF
  hctx.fillStyle = dGrey(0.55); hctx.fillRect(0, 0, DOOR_W, DOOR_H);
  // panneau surélevé : moulure (petite saillie), gorge, chanfrein qui remonte, table plate
  const panelProfile = i => i < 4 ? 0.68 : i < 8 ? 0.28 : i < 30 ? 0.34 + (i - 8) / 22 * 0.4 : 0.74;
  for (let i = 0; i < 60; i++) { hctx.fillStyle = dGrey(panelProfile(i)); dRectPx(hctx, D_PANEL, i); }
  // moulure saillante (bolection) autour de la vitre : bourrelet sur 10 px à l'extérieur de la baie
  for (let i = -10; i <= 0; i++) { const t = (i + 10) / 10; hctx.fillStyle = dGrey(0.55 + 0.3 * Math.sin(t * Math.PI)); dRectPx(hctx, D_GLASS, i); }
  hctx.fillStyle = dGrey(0.3); dRectPx(hctx, D_GLASS, 1);
  // assemblages traverse / montant : fente sombre
  hctx.fillStyle = dGrey(0.42);
  for (const [y0, y1] of [[0, 0.15], [0.65, 0.9], [2.0, 2.35]]) { hctx.fillRect(sL - 1, dY(y1), 2, dY(y0) - dY(y1)); hctx.fillRect(sR - 1, dY(y1), 2, dY(y0) - dY(y1)); }
  // fil du bois à peine en relief
  for (let i = 0; i < 400; i++) { hctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; hctx.fillRect(Math.random() * DOOR_W, Math.random() * DOOR_H, 1, 20 + Math.random() * 60); }

  // ---------- Vernis / peinture plus sombre dans les creux (lecture de la hauteur)
  {
    const hd = hctx.getImageData(0, 0, DOOR_W, DOOR_H).data, img = ctx.getImageData(0, 0, DOOR_W, DOOR_H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = hd[i] / 255, k = 0.72 + 0.5 * Math.min(1, v / 0.55); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- Usure : écaillures (peinture), poignée, bas de porte, sel
  if (!wood) {
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * DOOR_W, y = DOOR_H * (0.55 + 0.45 * Math.pow(Math.random(), 0.6)), rw = 2 + Math.random() * 7, rh = 1 + Math.random() * 5;
      ctx.fillStyle = 'rgba(58,40,26,0.9)'; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, Math.random() * 3, 0, Math.PI * 2); ctx.fill();   // bois à nu
      rctx.fillStyle = 'rgba(245,245,245,0.9)'; rctx.beginPath(); rctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); rctx.fill();
    }
  }
  // patine des mains autour de la poignée (côté intérieur du vantail, x = 0.63 m)
  const gh = ctx.createRadialGradient(DOOR_W - 18, dY(1.05), 0, DOOR_W - 18, dY(1.05), 60);
  gh.addColorStop(0, wood ? 'rgba(20,10,4,0.45)' : 'rgba(40,40,40,0.35)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gh; ctx.fillRect(DOOR_W - 90, dY(1.05) - 70, 90, 140);
  // coups de pied et frottements en bas
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(20,14,10,${0.08 + Math.random() * 0.15})`; ctx.fillRect(Math.random() * DOOR_W, dY(0.05 + Math.random() * 0.35), 4 + Math.random() * 18, 1 + Math.random() * 2); }
  // trace de sel : liseré blanchâtre irrégulier à 8–22 cm, voile en dessous (la neige fond contre la porte)
  for (let x = 0; x < DOOR_W; x += 2) {
    const yLine = dY(0.12 + 0.07 * Math.sin(x * 0.045) * Math.sin(x * 0.013 + 1.3) + Math.random() * 0.01);
    ctx.fillStyle = 'rgba(225,228,232,0.35)'; ctx.fillRect(x, yLine, 2, 2 + Math.random() * 2);
    ctx.fillStyle = 'rgba(210,214,220,0.12)'; ctx.fillRect(x, yLine, 2, DOOR_H - yLine);
  }
  addGrain(ctx, DOOR_W, DOOR_H, wood ? 10 : 7);

  // ---------- RUGOSITÉ : vernis lustré (0,35), usé mat aux coins et au bas
  rctx.globalCompositeOperation = 'destination-over';
  rctx.fillStyle = dGrey(wood ? 0.38 : 0.5); rctx.fillRect(0, 0, DOOR_W, DOOR_H);
  rctx.globalCompositeOperation = 'source-over';
  const gb = rctx.createLinearGradient(0, dY(0.5), 0, DOOR_H); gb.addColorStop(0, 'rgba(230,230,230,0)'); gb.addColorStop(1, 'rgba(230,230,230,0.7)');
  rctx.fillStyle = gb; rctx.fillRect(0, dY(0.5), DOOR_W, DOOR_H - dY(0.5));

  const map = toTexture(c, true, false), normal = toTexture(heightToNormal(h, 3.5), false, false), rough = toTexture(r, false, false);
  return { map, normal, rough };
}

/** Vitre du hall : verre dépoli éclairé de l'intérieur (plus clair en haut, vers le plafonnier),
 *  liseré gravé à 3 cm du bord, ombres floues de l'escalier et de la rampe derrière. */
export function makeHallGlassTexture() {
  const W = 128, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fff0d0'); g.addColorStop(0.45, '#d9b88a'); g.addColorStop(1, '#8a6a48');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // silhouettes floues : limon d'escalier en diagonale, barreaux, porte du fond
  ctx.filter = 'blur(6px)';
  ctx.strokeStyle = 'rgba(60,38,20,0.55)'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(-10, H * 0.95); ctx.lineTo(W * 0.9, H * 0.35); ctx.stroke();
  ctx.lineWidth = 4; for (let k = 0; k < 6; k++) { const x = k * 22; ctx.beginPath(); ctx.moveTo(x, H * 0.95 - x * 0.66); ctx.lineTo(x, H * 0.72 - x * 0.66); ctx.stroke(); }
  ctx.fillStyle = 'rgba(70,45,24,0.4)'; ctx.fillRect(W * 0.62, H * 0.3, W * 0.26, H * 0.62);
  ctx.filter = 'none';
  // verre dépoli : grain fin, liseré gravé (plus clair) et coins ornés
  addGrain(ctx, W, H, 16);
  ctx.strokeStyle = 'rgba(255,248,230,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.strokeStyle = 'rgba(255,248,230,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(15, 15, W - 30, H - 30);
  for (const [x, y] of [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10]]) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }
  return toTexture(c, true, false);
}

/** Imposte : une seule vitre éclairée, le NUMÉRO de l'immeuble peint à la feuille d'or
 *  (lettres cernées de noir), comme sur tous les brownstones. */
export function makeTransomTexture(num) {
  const W = 512, H = 196, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ffe9c0'); g.addColorStop(1, '#c79a66');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.filter = 'blur(8px)'; ctx.fillStyle = 'rgba(255,250,235,0.7)'; ctx.beginPath(); ctx.ellipse(W / 2, 20, 90, 40, 0, 0, Math.PI * 2); ctx.fill(); ctx.filter = 'none';   // plafonnier du hall
  addGrain(ctx, W, H, 12);
  ctx.font = 'bold 118px Georgia, "Times New Roman", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = '#1a0e06'; ctx.strokeText(String(num), W / 2, H / 2 + 6);
  const gold = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.8); gold.addColorStop(0, '#fff2b0'); gold.addColorStop(0.5, '#d4a23c'); gold.addColorStop(1, '#8a5c14');
  ctx.fillStyle = gold; ctx.fillText(String(num), W / 2, H / 2 + 6);
  return toTexture(c, true, false);
}
