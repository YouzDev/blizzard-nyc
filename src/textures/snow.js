import { makeCanvas, toTexture, heightToNormal, addGrain } from './canvas.js';

/* Neige au sol, à L'ÉCHELLE RÉELLE. Deux textures :
   - TROTTOIR : couvre toute la largeur du trottoir (u = 0 bordure → u = 1 façade) sur
     4,5 m de long (3 dalles). Trois bandes, comme dans une vraie rue après une nuit
     de neige : gadoue grise et salée contre la bordure, passage piétiné au milieu
     (neige tassée, joints de dalles qui transparaissent, empreintes de semelles),
     neige fraîche intacte contre les façades.
   - CHAUSSÉE : couvre toute la largeur de la chaussée (12,3 m) sur 12,3 m de long.
     Deux voies, chacune avec sa paire d'ORNIÈRES : la neige y est chassée jusqu'à
     l'asphalte mouillé, sombre et LISSE (rugosité basse → les lampadaires s'y
     reflètent), bordée de gadoue brune remuée ; entre les ornières, neige tassée
     sale ; le long des voitures garées, neige plus propre.
   Chaque texture : couleur + normal map + rugosité (neige très mate, piquée de
   cristaux lisses qui scintillent sous les lampes quand on se déplace).
   Les motifs aléatoires sont redessinés décalés d'une tuile pour rester raccord. */

/** Semelle de chaussure (vue de dessus), orientée vers +y local. l : longueur en px. */
function sole(ctx, l, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.ellipse(0, -l * 0.18, l * 0.19, l * 0.32, 0, 0, Math.PI * 2); ctx.fill();   // avant-pied
  ctx.beginPath(); ctx.ellipse(0, l * 0.3, l * 0.15, l * 0.2, 0, 0, Math.PI * 2); ctx.fill();      // talon
  ctx.fillRect(-l * 0.12, -l * 0.02, l * 0.24, l * 0.26);                                         // cambrure
}

/** Empreinte complète (rebord, creux, crampons) en couleur, hauteur et rugosité. */
function footprint(c, h, r, x, y, ang, l, depth) {
  for (const [ctx, kind] of [[c, 0], [h, 1], [r, 2]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    if (kind === 1) {                                                   // relief : rebord relevé, creux, crampons
      ctx.save(); ctx.scale(1.25, 1.12); sole(ctx, l, `rgba(200,200,200,${0.5 * depth})`); ctx.restore();
      sole(ctx, l, `rgba(40,40,40,${0.85 * depth})`);
      ctx.fillStyle = `rgba(95,95,95,${0.7 * depth})`;
      for (let k = -0.42; k < 0.5; k += 0.09) ctx.fillRect(-l * 0.14, k * l, l * 0.28, l * 0.035);
    } else if (kind === 0) {                                            // couleur : creux bleuté (ombre), rebord clair
      ctx.save(); ctx.scale(1.25, 1.12); sole(ctx, l, `rgba(255,255,255,${0.35 * depth})`); ctx.restore();
      sole(ctx, l, `rgba(104,116,140,${0.32 * depth})`);
    } else {                                                            // rugosité : neige tassée dans l'empreinte, plus lisse
      sole(ctx, l, `rgba(150,150,150,${0.6 * depth})`);
    }
    ctx.restore();
  }
}

/** Dessine f(dx) pour dx ∈ {−W, 0, +W} : raccord horizontal des motifs qui débordent. */
const wrapX = (W, f) => { for (const dx of [-W, 0, W]) f(dx); };

export function makeSnowTextures(isRoad) {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const h = makeCanvas(S, S), hctx = h.getContext('2d'), r = makeCanvas(S, S), rctx = r.getContext('2d');
  // échelle : px par mètre sur chaque axe (la tuile n'est pas carrée en mètres)
  const WU = isRoad ? 12.3 : 5.4, WV = isRoad ? 12.3 : 4.5, pu = S / WU, pv = S / WV;
  const X = m => m * pu, Y = m => m * pv;

  // --- fond : neige, relief moyen, très mate
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#ebebeb'; rctx.fillRect(0, 0, S, S);              // rugosité ≈ 0,92

  // ondulations douces : creux bleutés, crêtes chaudes
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S, y = Math.random() * S, rad = 30 + Math.random() * 90, dip = Math.random() < 0.55;
    for (const dy of [-S, 0, S]) wrapX(S, dx => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      g.addColorStop(0, dip ? 'rgba(150,166,194,0.25)' : 'rgba(255,250,242,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      const gh = hctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gh.addColorStop(0, dip ? 'rgba(70,70,70,0.5)' : 'rgba(190,190,190,0.5)'); gh.addColorStop(1, 'rgba(128,128,128,0)');
      hctx.fillStyle = gh; hctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }

  if (!isRoad) {
    // ================= TROTTOIR =================
    const uCurbSlush = 0.13, uPathEnd = 0.74;
    // passage piétiné : neige tassée, plus grise, relief écrasé
    const gp = ctx.createLinearGradient(0, 0, S, 0);
    gp.addColorStop(0, 'rgba(150,158,172,0.18)'); gp.addColorStop(uCurbSlush, 'rgba(160,168,182,0.07)');
    gp.addColorStop(0.45, 'rgba(170,178,192,0.05)');   // à peine grisé : sur le modèle le passage reste blanc gp.addColorStop(uPathEnd, 'rgba(180,188,200,0.04)'); gp.addColorStop(0.85, 'rgba(180,188,200,0)');
    ctx.fillStyle = gp; ctx.fillRect(0, 0, S, S);
    const rp = rctx.createLinearGradient(0, 0, S, 0);                   // tassé = un peu plus lisse
    rp.addColorStop(0, 'rgba(170,170,170,0.8)'); rp.addColorStop(uPathEnd, 'rgba(200,200,200,0.4)'); rp.addColorStop(0.85, 'rgba(235,235,235,0)');
    rctx.fillStyle = rp; rctx.fillRect(0, 0, S, S);
    // joints des dalles (1,5 m) : transparaissent là où la neige est piétinée
    const joint = (x0, y0, w, hh, a) => {
      ctx.fillStyle = `rgba(92,100,116,${a})`; ctx.fillRect(x0, y0, w, hh);
      hctx.fillStyle = `rgba(50,50,50,${a * 2.4})`; hctx.fillRect(x0, y0, w, hh);
    };
    for (let k = 1; k * 1.5 < WU; k++) {
      const x = X(k * 1.5 - 0.2), a = 0.26 * (1 - Math.min(1, Math.max(0, (x / S - 0.2) / 0.6)));
      joint(x, 0, 3, S, a + 0.04);
    }
    for (let k = 0; k < 3; k++) {
      const y = Y(k * 1.5 + 0.4);
      for (let x = 0; x < S; x += 4) joint(x, y, 4, 3, 0.3 * Math.max(0.1, 1 - x / (S * 0.8)));
    }
    // gadoue grise contre la bordure, flaques de fonte (sel), sombres et lisses
    // (discrètes : sur le trottoir devenu blanc, les anciennes — sombres, lisses, 16 par tuile —
    // se lisaient comme une file de disques noirs le long de la bordure ; le modèle n'en montre pas)
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * X(0.6), y = Math.random() * S, rw = X(0.1 + Math.random() * 0.2), rh = Y(0.15 + Math.random() * 0.5);
      for (const dy of [-S, 0, S]) {
        ctx.fillStyle = `rgba(120,128,142,${0.1 + Math.random() * 0.12})`; ctx.beginPath(); ctx.ellipse(x, y + dy, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
        rctx.fillStyle = 'rgba(150,150,150,0.5)'; rctx.beginPath(); rctx.ellipse(x, y + dy, rw * 0.8, rh * 0.8, 0, 0, Math.PI * 2); rctx.fill();
        hctx.fillStyle = 'rgba(90,90,90,0.5)'; hctx.beginPath(); hctx.ellipse(x, y + dy, rw, rh, 0, 0, Math.PI * 2); hctx.fill();
      }
    }
    // sel de déneigement : granulés bleu pâle et blancs, plus denses côté bordure
    for (let i = 0; i < 900; i++) {
      const x = Math.pow(Math.random(), 1.8) * S * 0.8, y = Math.random() * S, s = 1.5 + Math.random() * 2;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(168,196,228,0.55)' : 'rgba(236,240,246,0.5)'; ctx.fillRect(x, y, s, s);
      hctx.fillStyle = 'rgba(200,200,200,0.6)'; hctx.fillRect(x, y, s, s);
      rctx.fillStyle = 'rgba(90,90,90,0.8)'; rctx.fillRect(x, y, s, s);
      if (Math.random() < 0.25) { ctx.fillStyle = 'rgba(70,78,92,0.22)'; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 2.5, 0, Math.PI * 2); ctx.fill(); }   // auréole de fonte
    }
    // pistes d'empreintes le long du trottoir (périodes entières sur la tuile → raccord)
    const lengthPx = Y(0.29);
    const trail = (u0, amp, k, phase, dir, depth, stride) => {
      let n = 0;
      for (let y = 0; y < S; y += Y(stride), n++) {
        const a = 6.283 * k * y / S + phase, cx = X(u0 * WU) + X(amp) * Math.sin(a);
        const heading = Math.atan2(X(amp) * 6.283 * k * Math.cos(a) / S, 1) * dir;
        const lat = ((n % 2) * 2 - 1) * X(0.09);
        const px = cx + lat, ang = -heading + (dir > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.25;
        wrapX(S, dx => footprint(ctx, hctx, rctx, px + dx, y, ang, lengthPx, depth));
      }
    };
    for (let t = 0; t < 10; t++) trail(0.2 + Math.random() * 0.5, 0.05 + Math.random() * 0.25, 1 + Math.floor(Math.random() * 2), Math.random() * 6.28, Math.random() < 0.5 ? 1 : -1, 0.35 + Math.random() * 0.45, 0.36 + Math.random() * 0.08);
    for (let t = 0; t < 2; t++) trail(0.82 + Math.random() * 0.1, 0.03, 1, Math.random() * 6.28, Math.random() < 0.5 ? 1 : -1, 0.9, 0.4);   // quelques pas dans la neige fraîche : profonds
  } else {
    // ================= CHAUSSÉE =================
    // neige tassée sale partout, plus propre le long des voitures garées
    const gr = ctx.createLinearGradient(0, 0, S, 0);
    gr.addColorStop(0, 'rgba(140,148,160,0.08)'); gr.addColorStop(0.19, 'rgba(140,148,160,0.1)');
    gr.addColorStop(0.3, 'rgba(130,134,142,0.2)'); gr.addColorStop(0.5, 'rgba(134,138,146,0.18)'); gr.addColorStop(0.7, 'rgba(130,134,142,0.2)');
    gr.addColorStop(0.81, 'rgba(140,148,160,0.1)'); gr.addColorStop(1, 'rgba(140,148,160,0.08)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
    // ornières : deux voies, deux traces par voie (écartement 1,6 m), qui ondulent un peu
    for (const xc of [-2.4, -0.8, 0.8, 2.4]) {
      const u0 = X(xc + WU / 2), wob = X(0.06 + Math.random() * 0.08), ph = Math.random() * 6.28, k = 1 + Math.floor(Math.random() * 2);
      for (let y = 0; y < S; y += 2) {
        const cx = u0 + wob * Math.sin(6.283 * k * y / S + ph);
        const tw = X(0.3 + 0.05 * Math.sin(y * 0.05 + ph));
        // gadoue brune remuée sur les bords de l'ornière
        ctx.fillStyle = `rgba(120,118,116,${0.08 + Math.random() * 0.1})`; ctx.fillRect(cx - tw * 1.1, y, tw * 2.2, 2);
        hctx.fillStyle = 'rgba(160,160,160,0.25)'; hctx.fillRect(cx - tw * 1.05, y, tw * 0.35, 2); hctx.fillRect(cx + tw * 0.7, y, tw * 0.35, 2);
        // fond de l'ornière : asphalte mouillé, sombre, lisse
        ctx.fillStyle = Math.random() < 0.06 ? 'rgba(40,44,52,0.55)' : `rgba(118,126,142,${0.35 + Math.random() * 0.15})`; ctx.fillRect(cx - tw / 2, y, tw, 2);   // neige damée grise, rares taches mouillées
        hctx.fillStyle = 'rgba(55,55,55,0.9)'; hctx.fillRect(cx - tw / 2, y, tw, 2);
        rctx.fillStyle = `rgba(${110 + Math.random() * 40 | 0},${110 + Math.random() * 40 | 0},${110 + Math.random() * 40 | 0},0.9)`; rctx.fillRect(cx - tw / 2, y, tw, 2);   // damé = un peu lustré
        // sculptures du pneu imprimées dans la neige résiduelle
        if (y % 6 === 0) { ctx.fillStyle = 'rgba(120,124,132,0.3)'; ctx.fillRect(cx - tw * 0.45, y, tw * 0.25, 1.5); ctx.fillRect(cx + tw * 0.2, y + 3, tw * 0.25, 1.5); }
      }
    }
    // plaques de glace et de gadoue, grains de sable et de sel
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * S, y = Math.random() * S, rw = X(0.08 + Math.random() * 0.25), rh = Y(0.1 + Math.random() * 0.5);
      const ice = Math.random() < 0.3;
      for (const dy of [-S, 0, S]) wrapX(S, dx => {
        ctx.fillStyle = ice ? 'rgba(60,66,76,0.16)' : `rgba(82,74,64,${0.05 + Math.random() * 0.1})`;
        ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rw, rh, Math.random() * 3, 0, Math.PI * 2); ctx.fill();
        if (ice) { rctx.fillStyle = 'rgba(70,70,70,0.7)'; rctx.beginPath(); rctx.ellipse(x + dx, y + dy, rw, rh, 0, 0, Math.PI * 2); rctx.fill(); }
      });
    }
    for (let i = 0; i < 5000; i++) {
      const s = 1 + Math.random() * 1.8;
      ctx.fillStyle = Math.random() < 0.3 ? `rgba(90,80,70,${0.15 + Math.random() * 0.25})` : 'rgba(225,232,244,0.6)';
      ctx.fillRect(Math.random() * S, Math.random() * S, s, s);
    }
    // quelques traversées piétonnes
    for (let t = 0; t < 2; t++) {
      const y0 = Math.random() * S, ang = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      for (let x = X(0.8); x < S - X(0.8); x += X(0.38)) wrapX(S, dx => footprint(ctx, hctx, rctx, x + dx, y0 + (x - S / 2) * Math.tan(ang - Math.PI / 2) * 0.1 + ((x / X(0.38)) % 2 ? 6 : -6), ang, Y(0.29), 0.4));
    }
  }

  // --- cristaux : grain fin partout, et quelques paillettes LISSES qui scintillent
  for (let i = 0; i < 16000; i++) {
    const v = 205 + Math.random() * 50, s = 1 + Math.random() * 2.5, x = Math.random() * S, y = Math.random() * S;
    ctx.fillStyle = `rgba(${v - 8},${v},${v + 12},${Math.random() * 0.45})`; ctx.fillRect(x, y, s, s);
    hctx.fillStyle = `rgba(${90 + Math.random() * 170 | 0},128,128,0.4)`; hctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < (isRoad ? 1500 : 4000); i++) {
    const x = Math.random() * S, y = Math.random() * S;
    rctx.fillStyle = `rgb(${20 + Math.random() * 40 | 0},${20 + Math.random() * 40 | 0},${20 + Math.random() * 40 | 0})`; rctx.fillRect(x, y, 1.5, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x, y, 1.5, 1.5);
  }
  addGrain(ctx, S, S, 8);
  return { map: toTexture(c), normal: toTexture(heightToNormal(h, 2.2), false), rough: toTexture(r, false) };
}
