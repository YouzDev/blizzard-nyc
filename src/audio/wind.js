import { WIND, windGust } from '../fx/snow.js';

/* =====================================================================
   16. SON : VENT LÉGER (optionnel, coupé par défaut)
   Aucun fichier audio : le vent est SYNTHÉTISÉ avec la Web Audio API à partir
   d'un bruit rose (donc ça marche aussi en file://, sans rien télécharger).
   Trois couches filtrées du même bruit :
     - un grondement grave (passe-bas) : le souffle continu de la tempête ;
     - un sifflement (passe-bande étroit, fréquence qui glisse) : le vent dans la rue ;
     - un chuintement aigu très faible : la neige qui crépite.
   Leur volume suit les MÊMES rafales que les flocons (`windGust`) : quand la
   neige accélère à l'écran, le vent monte. Il est plus fort et plus clair face
   au vent, et vient du côté d'où il souffle (panoramique gauche / droite).
   Bouton discret en haut à droite (#sound) ou touche M. Le choix est mémorisé ;
   comme le navigateur interdit de jouer un son avant une action de l'utilisateur,
   un son mémorisé « activé » ne démarre qu'au premier clic ou à la première touche.
   ===================================================================== */
const soundBtn = document.getElementById('sound');
const SOUND_KEY = 'blizzard-son', SOUND_VOL = 0.4;
let audioCtx = null, windNodes = null, soundOn = false, soundStopTimer = 0;
try { soundOn = localStorage.getItem(SOUND_KEY) === '1'; } catch (e) { /* stockage bloqué : son coupé */ }
const windFrom = { x: 0, z: 0 };                             // direction D'OÙ vient le vent, normalisée (le vent tourne : recalculée)

/** Bruit rose stéréo (deux canaux indépendants → son large) qui boucle sans clic :
 *  la fin est fondue dans le début, et la boucle repart juste après ce fondu. */
function pinkNoise(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), fade = Math.floor(sr * 0.25);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;   // filtre de Paul Kellet
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    for (let i = 0; i < fade; i++) { const a = i / fade; d[n - fade + i] = d[n - fade + i] * (1 - a) + d[i] * a; }
  }
  return { buf, loopStart: fade / sr };
}

function buildWind() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = audioCtx, { buf, loopStart } = pinkNoise(ctx, 8);
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = loopStart; src.loopEnd = buf.duration;
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const layer = (type, freq, q) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); return { f, g };
  };
  const rumble = layer('lowpass', 320, 0.5), whistle = layer('bandpass', 600, 7), hiss = layer('highpass', 3500, 0.7);
  const pan = ctx.createStereoPanner();
  rumble.g.connect(master); whistle.g.connect(pan); pan.connect(master); hiss.g.connect(master);
  src.start(0, Math.random() * 6);
  windNodes = { master, rumble, whistle, hiss, pan };
}

function refreshButton() {
  if (!soundBtn) return;
  soundBtn.classList.toggle('on', soundOn);
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.title = soundOn ? 'Couper le son (M)' : 'Activer le son (M)';
}

function startSound() {
  if (!audioCtx) buildWind();
  clearTimeout(soundStopTimer);
  audioCtx.resume();
  windNodes.master.gain.setTargetAtTime(SOUND_VOL, audioCtx.currentTime, 0.6);   // montée douce (~2 s)
}

function setSound(on) {
  soundOn = on; refreshButton();
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch (e) { /* pas grave */ }
  if (on) startSound();
  else if (audioCtx) {
    windNodes.master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.25);
    soundStopTimer = setTimeout(() => { if (!soundOn) audioCtx.suspend(); }, 1500);   // à l'arrêt : zéro calcul audio
  }
}

refreshButton();
soundBtn?.addEventListener('click', e => { e.stopPropagation(); setSound(!soundOn); soundBtn.blur(); });
window.addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) setSound(!soundOn); });
// son mémorisé « activé » : démarre à la première action (sauf un clic sur le bouton, qui le basculerait aussitôt)
const soundGesture = e => {
  if (e.target?.closest?.('#sound') || e.code === 'KeyM') return;
  window.removeEventListener('pointerdown', soundGesture, true); window.removeEventListener('keydown', soundGesture, true);
  if (soundOn && !audioCtx) startSound();
};
window.addEventListener('pointerdown', soundGesture, true); window.addEventListener('keydown', soundGesture, true);
// onglet masqué : on suspend ; retour : on reprend si le son est activé
document.addEventListener('visibilitychange', () => {
  if (!audioCtx) return;
  if (document.hidden) audioCtx.suspend(); else if (soundOn) audioCtx.resume();
});

/** Appelé à chaque image : volumes et filtres suivent les rafales et l'orientation du joueur. */
export const windDebug = { get ctx() { return audioCtx; }, get nodes() { return windNodes; } };   // inspection (window.__blizzard.wind)

export function updateWind(t, camera) {
  if (!soundOn || !windNodes || audioCtx.state !== 'running') return;
  const { rumble, whistle, hiss, pan } = windNodes, now = audioCtx.currentTime, k = 0.25;
  const gust = Math.min(Math.max((windGust(t) - 0.2) / 1.6, 0), 1);   // 0 = accalmie, 1 = pic de rafale
  { const l = Math.hypot(WIND.x, WIND.z) || 1; windFrom.x = -WIND.x / l; windFrom.z = -WIND.z / l; }
  const e = camera.matrixWorld.elements;                                 // colonne 0 = droite, colonne 2 = arrière
  const facing = -(e[8] * windFrom.x + e[10] * windFrom.z);             // 1 = face au vent, −1 = dos au vent
  const side = e[0] * windFrom.x + e[2] * windFrom.z;                    // > 0 : le vent vient de la droite
  const face01 = 0.5 + 0.5 * facing;
  rumble.g.gain.setTargetAtTime(0.3 * (0.45 + 0.55 * gust) * (0.8 + 0.2 * face01), now, k);
  rumble.f.frequency.setTargetAtTime(230 + 260 * gust + 180 * face01, now, k);
  whistle.g.gain.setTargetAtTime(0.05 * gust * gust * (0.55 + 0.45 * face01), now, k);
  whistle.f.frequency.setTargetAtTime(470 + 380 * gust + 70 * Math.sin(t * 0.23), now, 0.4);
  hiss.g.gain.setTargetAtTime(0.012 * (0.4 + 0.6 * gust), now, k);
  pan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, side * 0.6)), now, 0.3);
}

/** Déclic d'obturateur (jeu photo) : deux claquements de bruit très courts — miroir qui se
 *  relève, rideau qui se ferme. Seulement si le son est activé (on ne crée pas de contexte audio). */
export function playShutter() {
  if (!soundOn || !audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  for (const [dt, vol] of [[0, 0.5], [0.075, 0.35]]) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8; g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t0 + dt);
  }
}
