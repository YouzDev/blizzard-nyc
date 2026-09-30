import { renderer } from '../core/renderer.js';
import { composer } from './postprocessing.js';

/* =====================================================================
   14 bis. RÉSOLUTION ADAPTATIVE
   Le jeu est limité par les PIXELS (≈ 15 ms par mégapixel mesurés) : sur un écran
   1080p il tombait autour de 28 ips. Plutôt que de choisir une résolution fixe pour
   tout le monde, le jeu mesure son propre débit d'images et ajuste la résolution
   de rendu interne (entre 50 % et 100 % de la résolution normale, par côté) ; le
   navigateur agrandit ensuite l'image à la taille de la fenêtre.
   Dans cette ambiance (brume, flocons, givre, grain, bloom), l'image un peu plus
   douce est quasi invisible — une saccade, elle, se sent tout de suite.

   Règles :
   - mesure sur des fenêtres d'1 s, après 2,5 s d'échauffement (compilation des
     shaders, premières cartes d'ombre) ; les images de plus de 250 ms (onglet
     masqué, Alt+Tab) ne sont pas des mesures ;
   - sous 52 ips : on baisse d'un coup vers ~58 ips. Le temps d'image vaut à peu
     près un coût fixe (~3 ms : ombres, CPU, passes) + une part proportionnelle au
     nombre de pixels, donc au CARRÉ de l'échelle. D'où l'échelle visée :
     échelle × √((T_visé − 3) / (T_mesuré − 3)). Sans le coût fixe, on tombait
     trop court (1080p : ~52 ips au lieu de 58) ;
   - à 57 ips ou plus (plafond d'un écran 60 Hz) : on remonte de 5 %, à l'essai ;
     si la mesure suivante ne tient pas 55 ips, on redescend aussitôt. Sans ce
     retour, une remontée pouvait se coincer à 52 ips, entre les deux seuils ;
   - un palier qui a fait décrocher devient un plafond (30 s, doublé à chaque essai
     raté, jusqu'à 4 min), sinon on oscillerait sans fin entre deux paliers
     (chaque changement réalloue les tampons de rendu, une petite saccade) ;
   - au moins 1,5 s entre deux changements, le temps que la mesure se stabilise.

   `?res=0.75` dans l'URL fige l'échelle (comparaisons, captures) ; `?res=1` coupe
   l'adaptation.
   ===================================================================== */
const RES_MIN = 0.5, RES_MAX = 1, FPS_LOW = 52, FPS_HIGH = 57, FPS_KEEP = 55, FPS_AIM = 58, FIXED_MS = 3;
const basePixelRatio = renderer.getPixelRatio();          // min(dpr, 1.5), fixé dans core/renderer.js
const resParam = new URLSearchParams(location.search).get('res');
const resFixed = resParam !== null && !isNaN(parseFloat(resParam));

export const adaptiveRes = {
  scale: 1,
  onChange: () => {},        // branché par main.js (flocons, vapeur, passe visage)
  set(s) {
    this.scale = s;
    renderer.setPixelRatio(basePixelRatio * s);
    composer.setPixelRatio(basePixelRatio * s);
    this.onChange();
  },
  update(rawDt) {
    if (resFixed) return;
    const st = resState;
    if (st.warm > 0) { st.warm -= rawDt; return; }
    if (rawDt > 0.25) return;
    st.acc += rawDt; st.frames++; st.cooldown -= rawDt; st.ceilingTimer -= rawDt;
    if (st.ceilingTimer <= 0) st.ceiling = RES_MAX;
    if (st.acc < 1) return;
    const fps = st.frames / st.acc; st.acc = 0; st.frames = 0;
    if (st.cooldown > 0) return;
    const q = x => Math.round(x * 20) / 20;                  // paliers de 5 %
    const trial = st.trial; st.trial = false;
    if (trial && fps < FPS_KEEP) {                           // la remontée ne tient pas : retour
      st.ceiling = this.scale - 0.05; st.ceilingTimer = st.backoff; st.backoff = Math.min(240, st.backoff * 2);
      this.set(q(this.scale - 0.05)); st.cooldown = 1.5;
    } else if (fps < FPS_LOW && this.scale > RES_MIN) {
      const ratio = (1000 / FPS_AIM - FIXED_MS) / Math.max(1, 1000 / fps - FIXED_MS);
      const next = Math.max(RES_MIN, Math.min(this.scale - 0.05, q(this.scale * Math.sqrt(ratio))));
      st.ceiling = this.scale - 0.05; st.ceilingTimer = 30;
      this.set(next); st.cooldown = 1.5;
    } else if (fps >= FPS_HIGH && this.scale < st.ceiling - 1e-6) {
      this.set(Math.min(st.ceiling, q(this.scale + 0.05))); st.cooldown = 2; st.trial = true;
    }
  },
};
const resState = { warm: 2.5, acc: 0, frames: 0, cooldown: 0, ceiling: RES_MAX, ceilingTimer: 0, trial: false, backoff: 30 };
if (resFixed) adaptiveRes.set(Math.min(RES_MAX, Math.max(0.25, parseFloat(resParam))));
