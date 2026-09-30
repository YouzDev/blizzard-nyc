import { makeCanvas, toTexture, addGrain } from './canvas.js';

/** Portière de taxi : bandes à damier et "NYC TAXI". */
export function makeTaxiSideTexture() {
  const c = makeCanvas(512, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#e9ab1f'; ctx.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 512; x += 16) { ctx.fillStyle = (x / 16) % 2 ? '#111' : '#eee'; ctx.fillRect(x, 60, 16, 8); }
  ctx.fillStyle = '#111'; ctx.font = 'bold 36px Arial, sans-serif'; ctx.fillText('NYC TAXI', 200, 46);
  ctx.font = '18px Arial, sans-serif'; ctx.fillText('4K21', 30, 105);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 128); ctx.stroke();   // ligne de portière
  addGrain(ctx, 512, 128, 14);
  return toTexture(c, true, false);
}
