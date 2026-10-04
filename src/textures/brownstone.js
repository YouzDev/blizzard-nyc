import { makeCanvas, toTexture, addGrain, heightToNormal } from './canvas.js';

/** BROWNSTONE : le grès brun des maisons de Brooklyn et de Harlem, posé en grands blocs LISSES à
 *  joints fins (appareil réglé) — rien à voir avec le soubassement refendu de stone.js. Ce qui le
 *  rend reconnaissable :
 *   - une surface presque mate et unie, des joints à peine marqués (un trait, pas un creux) ;
 *   - l'ÉCAILLAGE propre à ce grès stratifié : des plaques de surface tombées, à bord net, qui
 *     laissent voir une pierre plus claire, plus rouge et plus rugueuse ;
 *   - des RÉPARATIONS au mortier teinté, d'un ton légèrement différent, plus lisses ;
 *   - des coulures sombres sous les joints, quelques veines.
 *  Couleur presque neutre et chaude : la teinte (chocolat, brun-rouge, grès peint) est donnée par
 *  le matériau, comme pour la pierre des soubassements. La tuile couvre 5,5 m × 5,5 m : l'échelle
 *  des UV de worldBox (buildings.js). Couleur + normal map + rugosité. */
export function makeBrownstoneTextures() {
  const S = 1024, px = S / 5.5;                                       // ≈ 186 px par mètre
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const h = makeCanvas(S, S), hctx = h.getContext('2d');
  const r = makeCanvas(S, S), rctx = r.getContext('2d');
  ctx.fillStyle = '#9c8c80'; ctx.fillRect(0, 0, S, S);                // joints : mortier gris-brun
  hctx.fillStyle = '#8c8c8c'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#f0f0f0'; rctx.fillRect(0, 0, S, S);
  /** dessine f(dx) pour les trois copies horizontales qui assurent le raccord de la tuile */
  const wrap3 = f => { for (const dx of [-S, 0, S]) f(dx); };

  // assises de 0,42 à 0,56 m, la dernière recalée pour boucler la tuile ; blocs de 0,9 à 1,7 m
  const rows = []; let y = 0;
  while (y < S - 0.42 * px) { const hh = Math.round((0.42 + Math.random() * 0.14) * px); rows.push([y, hh]); y += hh; }
  rows[rows.length - 1][1] += S - y;
  for (const [y0, hh] of rows) {
    let x = -Math.random() * px;
    const blocks = [];
    while (x < S) { const w = Math.round((0.9 + Math.random() * 0.8) * px); blocks.push([x, w]); x += w; }
    for (const [x0, w] of blocks) {
      const t = Math.random(), base = 178 + t * 30;
      const tint = [base + 8 + (Math.random() - 0.5) * 10, base + (Math.random() - 0.5) * 8, base - 10 + (Math.random() - 0.5) * 8];
      const fh = 196 + t * 24 | 0;
      wrap3(dx => {
        const bx = x0 + dx;
        // joint fin : 2 px de mortier, arête adoucie d'1 px (la pierre est tendre, ses angles s'usent)
        ctx.fillStyle = `rgb(${tint.map(v => v * 0.93 | 0).join(',')})`; ctx.fillRect(bx + 1, y0 + 1, w - 2, hh - 2);
        ctx.fillStyle = `rgb(${tint.map(v => v | 0).join(',')})`; ctx.fillRect(bx + 2, y0 + 2, w - 4, hh - 4);
        hctx.fillStyle = `rgb(${fh - 14},${fh - 14},${fh - 14})`; hctx.fillRect(bx + 1, y0 + 1, w - 2, hh - 2);
        hctx.fillStyle = `rgb(${fh},${fh},${fh})`; hctx.fillRect(bx + 2, y0 + 2, w - 4, hh - 4);
        rctx.fillStyle = '#dadada'; rctx.fillRect(bx + 2, y0 + 2, w - 4, hh - 4);
      });
      // nuances douces dans le bloc (le grès est veiné de bancs plus ou moins rouges)
      for (let k = 0; k < 3; k++) {
        const gx = x0 + Math.random() * w, gy = y0 + Math.random() * hh, gr = 20 + Math.random() * 60, warm = Math.random() < 0.5;
        wrap3(dx => {
          const g = ctx.createRadialGradient(gx + dx, gy, 0, gx + dx, gy, gr);
          g.addColorStop(0, warm ? 'rgba(150,90,60,0.08)' : 'rgba(60,50,45,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(gx + dx - gr, gy - gr, gr * 2, gr * 2);
        });
      }
      // coulure sombre sous le joint supérieur
      if (Math.random() < 0.3) {
        const sx = x0 + Math.random() * w, len = Math.min(hh * (0.4 + Math.random() * 1.4), S - y0), sw = 3 + Math.random() * 12;
        wrap3(dx => {
          const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, 'rgba(25,18,14,0.22)'); g.addColorStop(1, 'rgba(25,18,14,0)');
          ctx.fillStyle = g; ctx.fillRect(sx + dx, y0, sw, len);
        });
      }
    }
  }

  /** contour irrégulier autour de (cx, cy), rayon moyen rad (bord net : éclat de pierre) */
  const blob = (g, cx, cy, rad, ex = 1) => {
    g.beginPath();
    const n = 14, ph = Math.random() * 6.28;
    for (let i = 0; i <= n; i++) {
      const a = i / n * 6.283, k = rad * (0.6 + 0.4 * Math.sin(a * 3 + ph) * Math.random() + 0.3 * Math.random());
      const px2 = cx + Math.cos(a) * k * ex, py2 = cy + Math.sin(a) * k;
      i ? g.lineTo(px2, py2) : g.moveTo(px2, py2);
    }
    g.closePath();
  };
  // (taches et éclats tenus loin du haut et du bas de la tuile : pas de raccord vertical à gérer)
  // RÉPARATIONS au mortier teinté : plaques plus lisses, d'un ton un peu différent, contour visible
  for (let i = 0; i < 4; i++) {
    const rad = (0.2 + Math.random() * 0.35) * px, cx = Math.random() * S, cy = rad * 1.4 + Math.random() * (S - rad * 2.8), tone = Math.random() < 0.5;
    wrap3(dx => {
      blob(ctx, cx + dx, cy, rad, 1.6); ctx.fillStyle = tone ? 'rgba(120,80,62,0.22)' : 'rgba(150,140,132,0.18)'; ctx.fill();
      ctx.strokeStyle = 'rgba(40,30,24,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();
      blob(rctx, cx + dx, cy, rad, 1.6); rctx.fillStyle = '#b4b4b4'; rctx.fill();
      blob(hctx, cx + dx, cy, rad, 1.6); hctx.fillStyle = 'rgba(214,214,214,0.8)'; hctx.fill();
    });
  }
  // ÉCAILLAGE : la croûte est tombée, la pierre dessous est plus claire, plus rouge, plus rugueuse,
  // EN CREUX avec un bord net (la normal map en fait une petite marche sous la lumière rasante)
  for (let i = 0; i < 9; i++) {
    const rad = (0.06 + Math.random() * 0.22) * px, cx = Math.random() * S, cy = rad * 1.4 + Math.random() * (S - rad * 2.8);
    wrap3(dx => {
      blob(ctx, cx + dx, cy, rad, 1.3); ctx.fillStyle = 'rgba(214,170,140,0.5)'; ctx.fill();
      blob(hctx, cx + dx, cy, rad, 1.3); hctx.fillStyle = 'rgb(150,150,150)'; hctx.fill();
      blob(rctx, cx + dx, cy, rad, 1.3); rctx.fillStyle = '#ffffff'; rctx.fill();
      for (let k = 0; k < rad * 1.5; k++) {                          // grain grossier de la pierre à nu
        const qx = cx + dx + (Math.random() - 0.5) * rad * 1.6, qy = cy + (Math.random() - 0.5) * rad * 1.2;
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '90,60,45' : '235,200,170'},0.25)`; ctx.fillRect(qx, qy, 2, 2);
        hctx.fillStyle = `rgba(${Math.random() < 0.5 ? '120,120,120' : '175,175,175'},0.6)`; hctx.fillRect(qx, qy, 2, 2);
      }
    });
  }
  // piqûres et veines fines, très peu : la pierre doit rester LISSE
  for (let i = 0; i < 260; i++) {
    const qx = Math.random() * S, qy = Math.random() * S, s = 1 + Math.random() * 1.5;
    ctx.fillStyle = `rgba(40,28,20,${Math.random() * 0.25})`; ctx.fillRect(qx, qy, s, s);
    hctx.fillStyle = 'rgba(120,120,120,0.4)'; hctx.fillRect(qx, qy, s, s);
  }
  addGrain(ctx, S, S, 10); addGrain(hctx, S, S, 6);
  return { map: toTexture(c), normal: toTexture(heightToNormal(h, 2.2), false), rough: toTexture(r, false) };
}
