import * as THREE from 'three';
import { renderer } from '../core/renderer.js';
import { camera } from '../core/scene.js';
import { lens } from '../fx/facePass.js';
import { controls, playerActive, openUi, closeUi, setMoveScale, setEntryGate } from '../player/controls.js';
import { playShutter } from '../audio/wind.js';
import { evaluatePhoto } from './scoring.js';
import { startup } from '../core/preload.js';

/* =====================================================================
   19. LE JEU : PHOTOGRAPHE DE PRESSE, UNE NUIT DE BLIZZARD
   10 minutes pour rapporter à la rédaction 3 à 5 photos de la rue sous la neige.
   - Viseur : clic droit maintenu (ou V pour basculer), molette = zoom.
   - Déclencher : clic gauche ou Espace (viseur levé). Note /50 immédiate.
   - Essuyer l'objectif : E (1 seconde, pas de photo pendant ce temps). Face au vent,
     la neige s'accumule sur l'objectif et floute les photos (et leur note).
   - Album : I. On y coche jusqu'à 5 photos à garder ; la carte mémoire tient 24 vues
     (on peut en supprimer). Avec 5 photos cochées, « Envoyer à la rédaction » termine
     la nuit ; sinon, à la fin des 10 minutes, les photos cochées partent d'office
     (complétées par les meilleures de la carte s'il en manque pour arriver à 3).
   - Fin : l'édition du matin — les photos envoyées, leur note, le verdict, le record.
   Le chrono ne tourne que pendant qu'on joue (pas dans l'album ni l'écran de pause).
   ===================================================================== */
const NIGHT_S = 600, CARD_SIZE = 24, KEEP_MAX = 5, KEEP_MIN = 3;
const FOV_WALK = 68, FOV_MIN = 14, FOV_MAX = 60;

const pg = {
  photos: [], timeLeft: NIGHT_S, started: false, ended: false, albumOpen: false,
  aimHold: false, aimLatch: false, zoomFov: 40, shotPending: false,
  angVel: 0, lastSpeed: 0, nextId: 1,
};
const pgPrevQ = new THREE.Quaternion();

/* --- Choix du mode, sur l'écran d'entrée ------------------------------
   « normal » : promenade libre, sans chrono ni appareil photo ; « photo » : le jeu.
   Le bouton choisi lance aussi la partie : son clic remonte jusqu'à l'écran d'entrée,
   dont le gestionnaire (controls.js) verrouille la souris — le choix est fait avant,
   dans le gestionnaire du bouton. Changer de mode = recharger (nouvelle nuit).
   ?mode=photo ou ?mode=normal dans l'URL saute le choix (tests). */
export let gameMode = null;
function chooseMode(m) {
  gameMode = m; document.body.dataset.mode = m;
  document.getElementById('modeChoice').hidden = true;
  document.getElementById('changeMode').hidden = false;
  document.getElementById('entryHint').textContent = m === 'photo'
    ? "Mode photo — cliquez n'importe où pour reprendre."
    : "Mode normal — cliquez n'importe où pour reprendre.";
}
setEntryGate(() => gameMode !== null && startup.ready);
for (const b of document.querySelectorAll('.mode-btn')) b.addEventListener('click', () => chooseMode(b.dataset.mode));
document.getElementById('changeMode').addEventListener('click', e => { e.stopPropagation(); location.reload(); });
{ const m = new URLSearchParams(location.search).get('mode'); if (m === 'photo' || m === 'normal') chooseMode(m); }
const $ = id => document.getElementById(id);
const pgHud = $('photoHud'), pgVf = $('viewfinder'), pgVfInfo = $('vfInfo'), pgFlash = $('flash'), pgWipe = $('wipe'), pgToast = $('toast');
const pgAlbum = $('album'), pgReport = $('report');
const pgThumb = document.createElement('canvas'), pgSmall = document.createElement('canvas');
pgSmall.width = 96; pgSmall.height = 54;

const aiming = () => gameMode === 'photo' && (pg.aimHold || pg.aimLatch) && playerActive() && !pg.ended;
const selected = () => pg.photos.filter(p => p.keep);
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const focal = fov => Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2));   // équivalent 24 × 36, en mm

let toastTimer = 0;
function toast(msg, ms = 2600) {
  pgToast.textContent = msg; pgToast.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => pgToast.classList.remove('on'), ms);
}
const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

/* --- Commandes ------------------------------------------------------- */
function canPlay() { return gameMode === 'photo' && playerActive() && !pg.ended && !pg.albumOpen; }
function shoot() {
  if (!aiming() || pg.shotPending) return;
  if (lens.wiping > 0) return toast('Essuyage en cours…', 1200);
  if (pg.photos.length >= CARD_SIZE) return toast('Carte mémoire pleine : ouvre l\'album (I) pour faire de la place.');
  pg.shotPending = true;                                   // capturé juste après le prochain rendu (afterRenderPhoto)
}
function wipeLens() {
  if (!canPlay() || lens.wiping > 0) return;
  lens.wiping = 1;                                         // main.js ramène la neige à zéro en 1 s
  replay(pgWipe, 'go');
}
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousedown', e => {
  if (!canPlay()) return;
  if (e.button === 2) pg.aimHold = true;
  else if (e.button === 0) shoot();
});
window.addEventListener('mouseup', e => { if (e.button === 2) pg.aimHold = false; });
window.addEventListener('wheel', e => {
  if (!aiming()) return;
  pg.zoomFov = THREE.MathUtils.clamp(pg.zoomFov * Math.exp(e.deltaY * 0.0012), FOV_MIN, FOV_MAX);
  e.preventDefault();
}, { passive: false });
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'KeyI') { if (pg.albumOpen) closeAlbum(true); else if (canPlay()) openAlbum(); return; }
  if (e.code === 'Escape' && pg.albumOpen) { closeAlbum(false); return; }
  if (!canPlay()) return;
  if (e.code === 'KeyV') pg.aimLatch = !pg.aimLatch;
  else if (e.code === 'KeyE') wipeLens();
  else if (e.code === 'Space') { shoot(); e.preventDefault(); }
});

/* --- Boucle ------------------------------------------------------------ */
/** Chaque image, avant le rendu. Renvoie true si le champ de vision a changé (flocons à recaler). */
export function updatePhotoGame(dt, t, speed) {
  if (gameMode !== 'photo') { pgHud.textContent = ''; return false; }   // mode normal : ni chrono, ni appareil
  pg.lastSpeed = speed;
  if (playerActive() && !pg.ended) {
    pg.started = true;
    pg.timeLeft = Math.max(0, pg.timeLeft - dt);
    if (pg.timeLeft <= 0) endNight(true);
  }
  // vitesse de rotation de la caméra (pour le bougé), lissée
  const ang = 2 * Math.acos(Math.min(1, Math.abs(pgPrevQ.dot(camera.quaternion))));
  pg.angVel = THREE.MathUtils.lerp(pg.angVel, dt > 0 ? ang / dt : 0, 1 - Math.exp(-dt * 12));
  pgPrevQ.copy(camera.quaternion);

  // hors jeu (pause, album, fenêtre qui perd le focus) : le viseur se baisse — sinon un clic
  // droit relâché hors de la fenêtre, ou V resté enclenché, le laissait levé au retour
  if (!playerActive()) pg.aimHold = pg.aimLatch = false;
  // viseur, zoom, marche ralentie, souris moins sensible au téléobjectif
  const aim = aiming();
  pgVf.classList.toggle('on', aim);
  setMoveScale(aim ? 0.45 : 1);
  const target = aim ? pg.zoomFov : FOV_WALK;
  let changed = false;
  if (Math.abs(camera.fov - target) > 0.01) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, target, 1 - Math.exp(-dt * 14));
    if (Math.abs(camera.fov - target) < 0.02) camera.fov = target;
    camera.updateProjectionMatrix(); changed = true;
  }
  controls.pointerSpeed = camera.fov / FOV_WALK;
  if (aim) {
    const snowy = lens.accum > 0.3 ? 'objectif enneigé — E pour essuyer' : lens.accum > 0.18 ? 'objectif un peu humide' : 'objectif propre';
    pgVfInfo.textContent = lens.wiping > 0 ? 'essuyage…' : `${focal(camera.fov)} mm · ${snowy}`;
  }
  // HUD
  if (!pg.ended) {
    const low = pg.timeLeft < 60 ? ' class="low"' : '';
    pgHud.innerHTML = `<span${low}>${fmtTime(pg.timeLeft)}</span> · ${pg.photos.length}/${CARD_SIZE} photos · gardées ${selected().length}/${KEEP_MAX}` +
      (pg.started ? '' : ' · <em>clic droit pour viser</em>');
  }
  return changed;
}

/** Juste après le rendu : l'image est encore dans le tampon, on la capture. */
export function afterRenderPhoto(t) {
  if (!pg.shotPending) return;
  pg.shotPending = false;
  const src = renderer.domElement, W = 960, H = Math.round(W * src.height / src.width);
  pgThumb.width = W; pgThumb.height = H;
  pgThumb.getContext('2d').drawImage(src, 0, 0, W, H);
  const sctx = pgSmall.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0, pgSmall.width, pgSmall.height);
  const r = evaluatePhoto({ camera, img: sctx.getImageData(0, 0, pgSmall.width, pgSmall.height), lens: lens.accum, angVel: pg.angVel, speed: pg.lastSpeed, t });
  const photo = { id: pg.nextId++, url: pgThumb.toDataURL('image/jpeg', 0.88), ...r, keep: false };
  pg.photos.push(photo);
  replay(pgFlash, 'go'); playShutter();
  toast(`Photo ${photo.id} — ${photo.total}/50 · ${photo.subject}`);
}

/* --- Album (inventaire) ------------------------------------------------ */
const partsLine = p => `Sujet ${p.parts.sujet}/15 · Compo ${p.parts.compo}/10 · Lumière ${p.parts.esth}/10 · Netteté ${p.parts.net}/10 · Moment ${p.parts.moment}/5`;
function openAlbum() {
  pg.albumOpen = true; pg.aimHold = false; openUi();
  renderAlbum(); pgAlbum.classList.add('open');
}
function closeAlbum(resume) {
  pg.albumOpen = false; pgAlbum.classList.remove('open');
  if (!pg.ended) closeUi(resume);
}
function renderAlbum() {
  const n = selected().length;
  pgAlbum.innerHTML = `
    <div class="al-head">
      <div><h2>Carte mémoire</h2><p>${pg.photos.length}/${CARD_SIZE} photos · ${fmtTime(pg.timeLeft)} restantes (chrono en pause) · clique une photo pour la garder</p></div>
      <div class="al-actions">
        <button class="btn" data-act="resume">Reprendre (I)</button>
        <button class="btn main" data-act="send" ${n === KEEP_MAX ? '' : 'disabled'}>Envoyer à la rédaction (${n}/${KEEP_MAX})</button>
      </div>
    </div>
    ${pg.photos.length ? '' : '<p class="al-empty">Aucune photo pour l\'instant. Clic droit pour lever le viseur, clic gauche pour déclencher.</p>'}
    <div class="cards">${pg.photos.map(p => `
      <div class="card${p.keep ? ' sel' : ''}" data-id="${p.id}">
        <img src="${p.url}" alt="">
        <span class="score">${p.total}/50</span>
        <button class="del" data-del="${p.id}" title="Supprimer">×</button>
        ${p.keep ? '<span class="tick">✓ gardée</span>' : ''}
        <div class="subj">${p.subject}</div>
        <div class="parts">${partsLine(p)}</div>
        <div class="rem">${p.remarks.join(' ')}</div>
      </div>`).join('')}</div>`;
}
pgAlbum.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'resume') return closeAlbum(true);
  if (act === 'send') return endNight(false);
  const del = e.target.closest('[data-del]');
  if (del) { pg.photos = pg.photos.filter(p => p.id !== +del.dataset.del); return renderAlbum(); }
  const card = e.target.closest('.card');
  if (!card) return;
  const p = pg.photos.find(q => q.id === +card.dataset.id);
  if (!p.keep && selected().length >= KEEP_MAX) { toast(`${KEEP_MAX} photos maximum : décoche-en une d'abord.`); return; }
  p.keep = !p.keep; renderAlbum();
});

/* --- Fin de la nuit : l'édition du matin ------------------------------- */
function endNight(timeUp) {
  if (pg.ended) return;
  pg.ended = true; pg.aimHold = pg.aimLatch = false;
  pgVf.classList.remove('on'); pgAlbum.classList.remove('open'); pg.albumOpen = false;
  openUi();
  let sent = selected();
  if (sent.length < KEEP_MIN) {                            // la rédaction pioche dans la carte pour boucler
    const rest = pg.photos.filter(p => !p.keep).sort((a, b) => b.total - a.total);
    sent = [...sent, ...rest.slice(0, KEEP_MIN - sent.length)];
  }
  const total = sent.reduce((s, p) => s + p.total, 0), best = sent.reduce((b, p) => (!b || p.total > b.total ? p : b), null);
  const verdict = !sent.length ? 'Aucune photo rendue : la rédaction boucle sans toi.'
    : total >= 200 ? 'À la une ! La rédaction fait sa couverture avec ta photo.'
    : total >= 150 ? 'Publié : un beau portfolio en pages intérieures.'
    : total >= 100 ? 'Publié en petit format, page 14.'
    : 'Refusé : la rédaction attendait mieux de cette nuit de blizzard.';
  let record = 0;
  try { record = +localStorage.getItem('blizzard-record') || 0; if (total > record) localStorage.setItem('blizzard-record', String(total)); } catch (e) { /* stockage bloqué */ }
  pgHud.textContent = '';
  pgReport.innerHTML = `
    <div class="rep-head">
      <p class="rep-kicker">${timeUp ? 'Fin de la nuit — 10 minutes écoulées' : 'Envoyé à la rédaction'}</p>
      <h2>L'édition du matin</h2>
      <p class="rep-verdict">${verdict}</p>
      <p class="rep-total"><strong>${total}</strong> / ${KEEP_MAX * 50}${sent.length < KEEP_MAX ? ` · ${sent.length} photo${sent.length > 1 ? 's' : ''} rendue${sent.length > 1 ? 's' : ''} sur ${KEEP_MAX}` : ''}
        ${best ? ` · meilleure photo ${best.total}/50` : ''} · record ${Math.max(record, total)}</p>
      <button class="btn main" data-act="again">Nouvelle nuit</button>
    </div>
    ${sent.map(p => `
      <figure class="rep-photo">
        <img src="${p.url}" alt="">
        <figcaption>
          <div class="rep-score">${p.total}<span>/50</span></div>
          <div class="subj">${p.subject}</div>
          <div class="parts">${partsLine(p)}</div>
          <div class="rem">${p.remarks.join(' ')}</div>
          <a class="btn" href="${p.url}" download="blizzard-nyc-photo-${p.id}.jpg">Télécharger</a>
        </figcaption>
      </figure>`).join('')}`;
  pgReport.classList.add('open');
}
pgReport.addEventListener('click', e => { if (e.target.closest('[data-act="again"]')) location.reload(); });

// inspection / tests depuis la console
export const photoDebug = { state: pg, shoot: () => { pg.aimLatch = true; pg.shotPending = true; }, endNight };
