import * as THREE from 'three';
import { makeCanvas, toTexture } from './canvas.js';

/* Textures de l'église du fond de l'impasse (world/church.js) : vitraux allumés de l'intérieur
   (lancettes, rosace) et cadran d'horloge du clocher. Couleurs de verre profondes, réseau de
   plomb noir ; le centre plus lumineux que les bords (la lumière de la nef passe mieux au milieu). */
const CH_GLASS = ['#1c3c9a', '#2a54c0', '#8e1420', '#b8222a', '#c98a1a', '#e0b040', '#2f6a3a', '#5a2a7a', '#d8c8a0'];
const chPick = a => a[Math.floor(Math.random() * a.length)];

/** Lancette : bordure de petits carreaux, deux médaillons ronds, fond en losanges. 256 × 640. */
export function makeLancetTexture() {
  const W = 256, H = 640, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#100c0a'; ctx.fillRect(0, 0, W, H);
  const piece = (path, col) => { ctx.fillStyle = col; ctx.fill(path); ctx.lineWidth = 5; ctx.strokeStyle = '#100c0a'; ctx.stroke(path); };
  // fond : losanges bleus et rouges
  const s = 40;
  for (let y = -s; y < H + s; y += s) for (let x = -s; x < W + s; x += s) {
    const p = new Path2D(); const cx = x + ((y / s) % 2 ? s / 2 : 0);
    p.moveTo(cx, y - s / 2); p.lineTo(cx + s / 2, y); p.lineTo(cx, y + s / 2); p.lineTo(cx - s / 2, y); p.closePath();
    piece(p, Math.random() < 0.6 ? chPick(['#1c3c9a', '#2a54c0', '#22408a']) : chPick(['#8e1420', '#a01a26']));
  }
  // bordure de petits carreaux ambre et verts
  for (let y = 0; y < H; y += 24) for (const x of [0, W - 22]) { const p = new Path2D(); p.rect(x, y, 22, 24); piece(p, chPick(['#c98a1a', '#2f6a3a', '#e0b040'])); }
  // médaillons : anneaux concentriques, une silhouette claire au centre
  for (const cy of [H * 0.34, H * 0.7]) {
    for (const [r, col] of [[82, chPick(CH_GLASS)], [70, '#e0b040'], [58, chPick(CH_GLASS)], [40, '#d8c8a0']]) { const p = new Path2D(); p.arc(W / 2, cy, r, 0, Math.PI * 2); piece(p, col); }
    const f = new Path2D(); f.arc(W / 2, cy - 14, 10, 0, Math.PI * 2); f.moveTo(W / 2 - 14, cy + 30); f.lineTo(W / 2, cy - 4); f.lineTo(W / 2 + 14, cy + 30); f.closePath(); piece(f, chPick(['#8e1420', '#5a2a7a', '#2a54c0']));
  }
  // lumière : plus vive au centre, assourdie sur les bords
  const g = ctx.createRadialGradient(W / 2, H * 0.5, 30, W / 2, H * 0.5, H * 0.6);
  g.addColorStop(0, 'rgba(255,230,190,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const t = toTexture(c, true, false); return t;
}

/** Rosace : cœur doré, couronne de 12 pétales, couronne de 24 lobes, rayons de plomb. 512². */
export function makeRoseTexture() {
  const S = 512, c = makeCanvas(S, S), ctx = c.getContext('2d'), C = S / 2;
  ctx.fillStyle = '#100c0a'; ctx.fillRect(0, 0, S, S);
  const piece = (p, col, lw = 6) => { ctx.fillStyle = col; ctx.fill(p); ctx.lineWidth = lw; ctx.strokeStyle = '#100c0a'; ctx.stroke(p); };
  // fond de la couronne extérieure
  { const p = new Path2D(); p.arc(C, C, 250, 0, Math.PI * 2); piece(p, '#1c3c9a'); }
  for (let k = 0; k < 24; k++) {                       // lobes extérieurs
    const a = k / 24 * Math.PI * 2, p = new Path2D(); p.arc(C + Math.cos(a) * 205, C + Math.sin(a) * 205, 30, 0, Math.PI * 2); piece(p, k % 2 ? '#b8222a' : '#e0b040');
  }
  { const p = new Path2D(); p.arc(C, C, 168, 0, Math.PI * 2); piece(p, '#22408a'); }
  for (let k = 0; k < 12; k++) {                       // pétales
    const a = k / 12 * Math.PI * 2, p = new Path2D();
    p.ellipse(C + Math.cos(a) * 105, C + Math.sin(a) * 105, 58, 26, a, 0, Math.PI * 2); piece(p, k % 2 ? '#8e1420' : '#2a54c0');
    const q = new Path2D(); q.arc(C + Math.cos(a) * 105, C + Math.sin(a) * 105, 12, 0, Math.PI * 2); piece(q, '#e0b040', 4);
  }
  { const p = new Path2D(); p.arc(C, C, 46, 0, Math.PI * 2); piece(p, '#e0b040'); const q = new Path2D(); q.arc(C, C, 22, 0, Math.PI * 2); piece(q, '#f2e2b0'); }
  ctx.strokeStyle = '#100c0a'; ctx.lineWidth = 5;
  for (let k = 0; k < 24; k++) { const a = (k + 0.5) / 24 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * 170, C + Math.sin(a) * 170); ctx.lineTo(C + Math.cos(a) * 250, C + Math.sin(a) * 250); ctx.stroke(); }
  const g = ctx.createRadialGradient(C, C, 20, C, C, 256); g.addColorStop(0, 'rgba(255,230,190,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTexture(c, true, false);
}

/** Cadran d'horloge éclairé (minuit moins dix) : chiffres romains, aiguilles noires. 256². */
export function makeClockTexture() {
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d'), C = S / 2;
  ctx.fillStyle = '#efe4c4'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(C, C, 120, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(C, C, 98, 0, Math.PI * 2); ctx.stroke();
  const NUM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  ctx.fillStyle = '#1a1612'; ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2 - Math.PI / 2;
    ctx.save(); ctx.translate(C + Math.cos(a) * 110, C + Math.sin(a) * 110); ctx.rotate(a + Math.PI / 2); ctx.fillText(NUM[k], 0, 0); ctx.restore();
  }
  for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2; ctx.lineWidth = k % 5 ? 1.5 : 3; ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * 92, C + Math.sin(a) * 92); ctx.lineTo(C + Math.cos(a) * 98, C + Math.sin(a) * 98); ctx.stroke(); }
  const hand = (a, len, w) => { ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(C + Math.cos(a - Math.PI / 2) * len, C + Math.sin(a - Math.PI / 2) * len); ctx.stroke(); };
  hand((11 + 50 / 60) / 12 * Math.PI * 2, 58, 8); hand(50 / 60 * Math.PI * 2, 86, 5);
  ctx.beginPath(); ctx.arc(C, C, 7, 0, Math.PI * 2); ctx.fill();
  const t = toTexture(c, true, false); t.colorSpace = THREE.SRGBColorSpace; return t;
}
