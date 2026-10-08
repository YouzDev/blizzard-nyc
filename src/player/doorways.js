import { camera } from '../core/scene.js';
import { doorways } from '../world/doorways.js';
import { playerActive, playerFootY, teleportPlayer, setConfine } from './controls.js';

/* =====================================================================
   13 bis. ENTRER PAR UNE PORTE (demande utilisateur)
   Sur le palier d'une porte du registre (world/doorways.js), une invite s'affiche : F pour entrer.
   Fondu au noir, on se retrouve sur le balcon du dernier étage, face à la rue ; là-haut le
   déplacement est borné au balcon (setConfine). Devant la porte-fenêtre, F fait redescendre sur le
   palier du perron. Pas de pièce intérieure pour l'instant : la porte est un passage.
   (Noms de premier niveau préfixés « door » : le collage mono-fichier met tous les modules ensemble.)
   ===================================================================== */
const doorPromptEl = document.getElementById('prompt'), doorFadeEl = document.getElementById('fade');
let doorNear = null, doorBusy = false, doorShown = '';
const doorDist2 = (p, q) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2;

/** À chaque image, après le déplacement du joueur : quelle porte est à portée ? */
export function updateDoorways() {
  if (doorBusy) return;
  doorNear = null;
  const p = camera.position, fy = playerFootY();
  for (const d of doorways) {
    if (d.onBalcony) { if (doorDist2(p, d.balconyDoor) < d.rBack ** 2) doorNear = { d, dir: 'down' }; }
    else if (fy !== null && Math.abs(fy - d.doorY) < 0.6 && doorDist2(p, d.door) < d.r ** 2) doorNear = { d, dir: 'up' };
  }
  const text = !doorNear || !playerActive() ? '' : doorNear.dir === 'up' ? '<kbd>F</kbd> entrer — monter au balcon' : '<kbd>F</kbd> redescendre dans la rue';
  if (text !== doorShown) { doorPromptEl.innerHTML = text; doorPromptEl.classList.toggle('on', !!text); doorShown = text; }
}

/** Fondu au noir, saut, fondu retour (le temps que les lumières suivent : ~1 s après un saut). */
function doorTransition() {
  const { d, dir } = doorNear;
  doorBusy = true; doorPromptEl.classList.remove('on'); doorShown = '';
  doorFadeEl.classList.add('on');
  setTimeout(() => {
    if (dir === 'up') { setConfine(d.balcony.confine); teleportPlayer(d.balcony.x, d.balcony.z, d.balcony.yaw, -0.12); d.onBalcony = true; }
    else { setConfine(null); teleportPlayer(d.out.x, d.out.z, d.out.yaw, -0.05); d.onBalcony = false; }
    setTimeout(() => { doorFadeEl.classList.remove('on'); doorBusy = false; }, 650);
  }, 380);
}
window.addEventListener('keydown', e => {
  if (e.code !== 'KeyF' || e.repeat || doorBusy || !doorNear || !playerActive()) return;
  doorTransition();
});
/** Tests : comme la touche F (renvoie 'up', 'down' ou null). */
export function useDoorForTest() { if (!doorNear || doorBusy) return null; const dir = doorNear.dir; doorTransition(); return dir; }
