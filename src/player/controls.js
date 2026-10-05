import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { ROAD_HALF, SIDEWALK_W, SIDEWALK_H, EYE_HEIGHT, WALK_SPEED, PLAYER_RADIUS } from '../core/constants.js';
import { renderer } from '../core/renderer.js';
import { camera } from '../core/scene.js';
import { collides, pushOut } from '../world/collisions.js';
import { curbDistance } from '../world/ground.js';
import { walkZoneY, walkZoneHit } from '../world/walkSurface.js';

/* =====================================================================
   13. CONTRÔLES FPS : PointerLock (avec repli), ZQSD/WASD, head-bobbing, collisions
   ===================================================================== */
export const controls = new PointerLockControls(camera, renderer.domElement);
const entry = document.getElementById('entry'), hud = document.getElementById('hud'), entryHint = document.getElementById('entryHint');
// Tant que le mode de jeu n'est pas choisi (boutons de l'écran d'entrée), un clic ailleurs ne lance rien.
let entryGate = () => true;
export function setEntryGate(fn) { entryGate = fn; }
let active = false, dragMode = false, lastUnlock = -Infinity, uiOpen = false, moveScale = 1;
const pointerLockAvailable = 'requestPointerLock' in document.documentElement, inIframe = window.self !== window.top;

function enterDragMode(reason) { dragMode = true; active = true; entry.classList.add('hidden'); console.warn('Mode glisser :', reason); }
function leaveGame() { active = false; releaseAll(); entry.classList.remove('hidden'); }   // on ne revient jamais dans la rue avec une touche coincée
entry.addEventListener('click', () => {
  if (!entryGate()) return;
  if (!pointerLockAvailable || inIframe) { entryHint.textContent = 'Verrouillage du curseur indisponible ici : maintenez le clic pour regarder.'; return enterDragMode('iframe/API'); }
  const since = performance.now() - lastUnlock;
  if (since < 1200) { const prev = entryHint.textContent; entryHint.textContent = 'Un instant… recliquez dans une seconde.'; setTimeout(() => (entryHint.textContent = prev), 1300 - since); return; }
  try { controls.lock(); } catch (e) { enterDragMode(e.message); }
});
controls.addEventListener('lock',   () => { active = true; entry.classList.add('hidden'); });
controls.addEventListener('unlock', () => { lastUnlock = performance.now(); if (!dragMode && !uiOpen) leaveGame(); });

/* Interface du jeu (album, édition du matin) : on libère la souris SANS afficher l'écran
   de pause, puis on la reverrouille au retour (appelé depuis un clic ou une touche :
   le navigateur exige un geste de l'utilisateur pour verrouiller). */
export function playerActive() { return active; }
/** Tests : marcher sans verrouiller la souris (window.__blizzard.activate(true), puis keys.fwd = true). */
export function debugActivate(v = true) { active = v; }
export function setMoveScale(k) { moveScale = k; }                // marche ralentie au viseur
export function openUi() { uiOpen = true; releaseAll(); active = false; if (document.pointerLockElement) controls.unlock(); }
export function closeUi(resume = true) {
  uiOpen = false;
  if (!resume) return leaveGame();
  if (dragMode) { active = true; return; }
  try { controls.lock(); } catch (e) { enterDragMode(e.message); }
}
document.addEventListener('pointerlockerror', () => { entryHint.textContent = 'Le navigateur a refusé le verrouillage : maintenez le clic pour regarder.'; enterDragMode('pointerlockerror'); });
const dragEuler = new THREE.Euler(0, 0, 0, 'YXZ'); let dragging = false;
renderer.domElement.addEventListener('mousedown', e => { if (dragMode && e.button === 0) dragging = true; });
window.addEventListener('mouseup', () => (dragging = false));
window.addEventListener('mousemove', e => {
  if (!dragMode || !dragging) return;
  dragEuler.setFromQuaternion(camera.quaternion);
  dragEuler.y -= e.movementX * 0.0022; dragEuler.x = THREE.MathUtils.clamp(dragEuler.x - e.movementY * 0.0022, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05); dragEuler.z = 0;
  camera.quaternion.setFromEuler(dragEuler);
});
window.addEventListener('keydown', e => { if (e.code === 'Escape' && dragMode) { dragMode = false; leaveGame(); } });

/* --- Clavier -----------------------------------------------------------
   On mémorise l'ensemble des TOUCHES PHYSIQUES enfoncées, pas un booléen par
   direction. Deux raisons, chacune corrigeant un blocage réel :

   1. `KeyW` et `KeyZ` (et `KeyA`/`KeyQ`) pointent la même direction pour servir
      AZERTY et QWERTY. Avec un booléen, relâcher l'une remettait la direction à
      faux alors que l'autre était encore tenue — et inversement, un relâchement
      manqué la laissait vraie pour toujours.
   2. Un `keyup` peut ne jamais arriver : touche relâchée pendant que la fenêtre
      a perdu le focus (Alt+Tab), pendant la sortie du verrouillage de souris, ou
      onglet masqué. La direction restait alors enfoncée et le joueur avançait
      tout seul jusqu'au rechargement. D'où le filet `releaseAll` ci-dessous.
   ----------------------------------------------------------------------- */
export const keys = { fwd: false, back: false, left: false, right: false };
const KEYMAP = { KeyW: 'fwd', KeyZ: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', KeyQ: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const held = new Set();
function refreshKeys() {
  keys.fwd = keys.back = keys.left = keys.right = false;
  for (const code of held) keys[KEYMAP[code]] = true;
}
function releaseAll() { if (held.size) { held.clear(); refreshKeys(); } }
window.addEventListener('keydown', e => { if (KEYMAP[e.code]) { held.add(e.code); refreshKeys(); e.preventDefault(); } });
window.addEventListener('keyup',   e => { if (held.delete(e.code)) refreshKeys(); });
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) releaseAll(); });
controls.addEventListener('unlock', releaseAll);

const velocity = new THREE.Vector3(), fwdDir = new THREE.Vector3(), rightDir = new THREE.Vector3(), moveDir = new THREE.Vector3(), target = new THREE.Vector3();
let bobPhase = 0, walkAmount = 0, lastSway = 0;
export function groundHeightAt(x, z) {
  // perrons, escalier du métro : leur propre surface (world/walkSurface.js)
  const wy = walkZoneY(x, z);
  if (wy !== null) return wy + 0.03;
  // d : distance au bord de chaussée côté trottoir (rue principale : |x| − ROAD_HALF ; rue de
  // gauche et coins du carrefour : voir ground.js)
  const d = curbDistance(x, z), k = THREE.MathUtils.smoothstep(d, -0.3, 0.2);
  const wall = THREE.MathUtils.clamp(d / SIDEWALK_W, 0, 1);
  // suit (en lissé) la neige de ground.js : ~10 cm sur la chaussée, congère qui monte vers les murs
  return SIDEWALK_H * k + (0.1 + Math.pow(wall, 2.4) * 0.3) * k + 0.1 * (1 - k) + 0.03;
}
export function updatePlayer(dt) {
  camera.getWorldDirection(fwdDir); fwdDir.y = 0; fwdDir.normalize();
  rightDir.crossVectors(fwdDir, camera.up).normalize();
  moveDir.set(0, 0, 0);
  if (keys.fwd) moveDir.add(fwdDir); if (keys.back) moveDir.sub(fwdDir); if (keys.right) moveDir.add(rightDir); if (keys.left) moveDir.sub(rightDir);
  const wants = moveDir.lengthSq() > 0; if (wants) moveDir.normalize();
  target.copy(moveDir).multiplyScalar(WALK_SPEED * moveScale * (walkZoneHit?.stairs ? 0.62 : 1));   // on ralentit dans les marches
  velocity.lerp(target, 1 - Math.exp(-dt * 8));
  if (!active) velocity.set(0, 0, 0);
  const p = camera.position;
  // Déplacement axe par axe (glissement le long des obstacles), puis poussée hors de
  // tout chevauchement résiduel. L'ancien garde-fou « déjà coincé → mouvement libre »
  // était exploitable : le balancement des pas poussait la caméra de 2 cm dans une
  // voiture, et le tour suivant tout passait à travers.
  const nx = p.x + velocity.x * dt; if (!collides(nx, p.z, PLAYER_RADIUS)) p.x = nx; else velocity.x = 0;
  const nz = p.z + velocity.z * dt; if (!collides(p.x, nz, PLAYER_RADIUS)) p.z = nz; else velocity.z = 0;
  const speed = Math.hypot(velocity.x, velocity.z);
  walkAmount = THREE.MathUtils.lerp(walkAmount, Math.min(speed / WALK_SPEED, 1), 1 - Math.exp(-dt * 6));
  // Cadence : bobPhase fait un cycle par ENJAMBÉE (deux pas) — c'est le balancement
  // latéral —, et bobY oscille à 2×, donc un creux par pas. À pleine vitesse on vise
  // ~110 pas/min (1,85 Hz), soit bobPhase à 0,92 Hz ≈ 5,8 rad/s. L'ancien 1,85π
  // donnait 178 pas/min : une cadence de course, pas une marche dans la neige.
  bobPhase += dt * (1.15 * Math.PI) * (0.6 + speed / WALK_SPEED);
  // Head-bobbing : oscillation verticale + léger balancement latéral EN POSITION.
  // On ne touche jamais à la rotation de la caméra (elle appartient à PointerLockControls,
  // et réécrire rotation.z ferait basculer l'horizon) : l'horizon reste toujours droit.
  const bobY = Math.sin(bobPhase * 2) * 0.045 * walkAmount;
  const sway = Math.sin(bobPhase) * 0.025 * walkAmount;
  p.x += rightDir.x * (sway - lastSway); p.z += rightDir.z * (sway - lastSway); lastSway = sway;
  pushOut(p, PLAYER_RADIUS);                              // le balancement ne peut pas nous mettre dans un obstacle
  // hauteur des pieds lissée : on monte une marche en ~0,15 s au lieu d'y être téléporté
  const gy = groundHeightAt(p.x, p.z);
  footY = footY === null ? gy : footY + (gy - footY) * (1 - Math.exp(-dt * 14));
  p.y = footY + EYE_HEIGHT + bobY;
  // un pas = un demi-tour de bobPhase : trace laissée dans la neige (fx/footprints.js)
  const step = Math.floor(bobPhase / Math.PI);
  if (step !== lastStep) {
    lastStep = step;
    if (walkAmount > 0.35 && speed > 0.4 && onStep) onStep(p.x + rightDir.x * 0.12 * (step % 2 ? 1 : -1), p.z + rightDir.z * 0.12 * (step % 2 ? 1 : -1), Math.atan2(velocity.x, velocity.z), step % 2);
  }
  return speed;
}
let footY = null, lastStep = 0, onStep = null;
/** Appelé à chaque pas : (x, z, cap, pied 0 | 1). */
export function setStepHandler(fn) { onStep = fn; }

export { hud, fwdDir };
