import { makeCanvas, toTexture } from './canvas.js';

/* Panneaux de rue new-yorkais (world/streetSigns.js) et faces des boîtes à journaux (props.js).
   Neige collée par endroits (taches blanches floues sur le bord haut, plaques sur la face) : les
   panneaux sont à moitié ensevelis, comme tout le reste. */

/** Taches de neige collée sur un panneau : le long du bord haut, quelques plaques sur la face. */
function stickSnow(ctx, W, H, amount = 1, x0 = 0) {
  ctx.save(); ctx.translate(x0, 0); ctx.filter = 'blur(3px)'; ctx.fillStyle = 'rgba(238,242,250,0.92)';
  for (let k = 0; k < 10 * amount; k++) { ctx.beginPath(); ctx.ellipse(Math.random() * W, Math.random() * H * 0.12, 10 + Math.random() * 40, 4 + Math.random() * 10, 0, 0, Math.PI * 2); ctx.fill(); }
  for (let k = 0; k < 3 * amount; k++) { ctx.beginPath(); ctx.ellipse(Math.random() * W, Math.random() * H, 8 + Math.random() * 26, 6 + Math.random() * 14, Math.random(), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** Plaque de nom de rue : vert, liseré blanc, nom en capitales et minuscules (« Rivington St »). */
export function makeStreetNameTexture(name) {
  const W = 512, H = 118, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#0b5d34'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#f2f2ee'; ctx.lineWidth = 5; ctx.strokeRect(7, 7, W - 14, H - 14);
  ctx.fillStyle = '#f6f6f2'; ctx.font = 'bold 66px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, W / 2, H / 2 + 3);
  stickSnow(ctx, W, H, 0.8);
  return toTexture(c, true, false);
}

/** « ONE WAY » : panneau noir, flèche blanche (vers la droite ; retourner le panneau pour la gauche). */
export function makeOneWayTexture() {
  const W = 512, H = 170, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath(); ctx.moveTo(30, 52); ctx.lineTo(380, 52); ctx.lineTo(380, 18); ctx.lineTo(486, 85); ctx.lineTo(380, 152); ctx.lineTo(380, 118); ctx.lineTo(30, 118); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0c0c0c'; ctx.font = 'bold 54px Helvetica, Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('ONE WAY', 52, 88);
  stickSnow(ctx, W, H, 0.6);
  return toTexture(c, true, false);
}

/** Panneaux de stationnement (sur les lampadaires) : nettoyage alterné (P barré et balai rouges),
 *  arrêt interdit, stationnement payant. */
export function makeParkingSignTextures() {
  const out = [];
  const panel = (draw) => {
    const W = 256, H = 368, c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#f2f1ec'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    draw(ctx, W, H);
    stickSnow(ctx, W, H, 0.7);
    out.push(toTexture(c, true, false));
  };
  // nettoyage des rues : P rouge barré, balai, horaires
  panel((ctx, W) => {
    ctx.strokeStyle = '#c4161c'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(W / 2, 84, 54, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c4161c'; ctx.font = 'bold 76px Helvetica, Arial, sans-serif'; ctx.fillText('P', W / 2, 88);
    ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(W / 2 - 38, 46); ctx.lineTo(W / 2 + 38, 122); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(W / 2 + 70, 40); ctx.lineTo(W / 2 + 40, 100); ctx.stroke();       // balai
    ctx.fillRect(W / 2 + 26, 98, 30, 16);
    ctx.font = 'bold 30px Helvetica, Arial, sans-serif'; ctx.fillText('8:30AM-10AM', W / 2, 186);
    ctx.font = 'bold 34px Helvetica, Arial, sans-serif'; ctx.fillText('TUES & FRI', W / 2, 232);
    ctx.font = '22px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#1a1a1a'; ctx.fillText('STREET CLEANING', W / 2, 300);
  });
  // arrêt interdit
  panel((ctx, W) => {
    ctx.fillStyle = '#c4161c'; ctx.font = 'bold 48px Helvetica, Arial, sans-serif';
    ctx.fillText('NO', W / 2, 70); ctx.fillText('STANDING', W / 2, 130); ctx.fillText('ANYTIME', W / 2, 190);
    ctx.lineWidth = 10; ctx.strokeStyle = '#c4161c'; ctx.beginPath(); ctx.moveTo(40, 280); ctx.lineTo(W - 70, 280); ctx.stroke();
    ctx.fillStyle = '#c4161c'; ctx.beginPath(); ctx.moveTo(30, 280); ctx.lineTo(70, 252); ctx.lineTo(70, 308); ctx.closePath(); ctx.fill();
  });
  // stationnement payant
  panel((ctx, W) => {
    ctx.fillStyle = '#137a3e'; ctx.font = 'bold 84px Helvetica, Arial, sans-serif'; ctx.fillText('2', W / 2, 78);
    ctx.font = 'bold 40px Helvetica, Arial, sans-serif'; ctx.fillText('HOUR', W / 2, 140);
    ctx.font = 'bold 32px Helvetica, Arial, sans-serif'; ctx.fillText('METERED', W / 2, 200); ctx.fillText('PARKING', W / 2, 240);
    ctx.font = '24px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#1a1a1a'; ctx.fillText('9AM-7PM', W / 2, 296); ctx.fillText('EXCEPT SUNDAY', W / 2, 326);
  });
  return out;
}

/** Faces avant des boîtes à journaux (une case par journal, noms inventés) : bandeau du titre, vitre
 *  sombre derrière laquelle on devine la une, monnayeur. 5 cases de 256 × 360. */
export const NEWS_BOXES = [['THE CITY', '#9a1a14'], ['METRO DAILY', '#1d4f9a'], ['FREE WEEKLY', '#c9a21a'], ['REAL ESTATE', '#d8d8d0'], ['THE LEDGER', '#1f6a3a']];
export function makeNewsBoxTexture() {
  const CW = 256, H = 360, c = makeCanvas(CW * NEWS_BOXES.length, H), ctx = c.getContext('2d');
  NEWS_BOXES.forEach(([name, col], i) => {
    const x = i * CW;
    ctx.fillStyle = col; ctx.fillRect(x, 0, CW, H);
    const light = col === '#d8d8d0' || col === '#c9a21a';
    ctx.fillStyle = light ? '#1a1a1a' : '#f4f4f0'; ctx.font = 'bold 34px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x + CW / 2, 40, CW - 20);
    ctx.fillStyle = '#20242a'; ctx.fillRect(x + 22, 76, CW - 44, 160);                 // vitre
    ctx.fillStyle = 'rgba(220,214,200,0.55)'; ctx.fillRect(x + 40, 96, CW - 80, 124);   // la une derrière
    ctx.fillStyle = 'rgba(30,30,30,0.6)'; for (let k = 0; k < 6; k++) ctx.fillRect(x + 50, 112 + k * 17, CW - 100 - (k % 3) * 25, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 22, 250, CW - 44, 14);          // poignée
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(x + CW - 70, 286, 34, 46);                    // monnayeur
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + CW - 58, 292, 10, 24);
    stickSnow(ctx, CW, H, 0.5, x);
  });
  return toTexture(c, true, false);
}
