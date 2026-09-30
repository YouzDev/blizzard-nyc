import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* =====================================================================
   12. POST-TRAITEMENT : bloom + masque "neige sur le visage" (réfraction) + grain
   Le masque est une passe plein écran : les plaques de neige mouillée
   déforment (réfraction) et floutent l'image derrière elles, le givre
   blanchit et brouille les bords, la fine neige voile le centre.
   ===================================================================== */
export const faceShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAccum: { value: 0.2 }, uGrade: { value: 0.55 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },   // taille à l'écran (px CSS)
    uBuffer:     { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },   // pixels réellement calculés
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime, uAccum, uGrade; uniform vec2 uResolution, uBuffer;
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec2  hash2(vec2 p){ float h = hash(p); return vec2(h, hash(p + h + 7.13)); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    // chaque octave est TOURNÉE (~37°) : sans ça les octaves partagent la même grille et, une fois
    // contrasté par smoothstep, le bruit laisse voir des carrés alignés sur l'écran
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }

    // Champ de hauteur des plaques de neige mouillée : chaque cellule héberge une plaque
    // qui apparaît, coule vers le bas en s'étirant, puis fond.
    float plaques(vec2 uv, float scale, float seed, float t, float density, float aspect){
      vec2 p = uv * scale * vec2(aspect, 1.0);
      vec2 id = floor(p), f = fract(p);
      float acc = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 r = hash2(id + o + seed);
        float life = fract(t * 0.06 + r.x * 7.31 + r.y * 3.17);
        float present = 1.0 - smoothstep(density - 0.05, density + 0.05, r.y);
        float env = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.45, 1.0, life));
        vec2 c = o + 0.2 + r * 0.6;
        float drip = life * life;
        vec2 d = f - c;
        d.y += drip * 0.6;
        d.y /= (1.0 + drip * 2.4);
        d.x *= 1.0 + 0.5 * sin(r.x * 20.0);
        float rad = (0.08 + r.x * 0.12) * env;
        float shape = length(d) + (noise(d * 10.0 + r * 30.0) - 0.5) * 0.09;
        float m = 1.0 - smoothstep(rad * 0.35, rad, shape);
        acc = max(acc, m * m * present * env);       // profil bombé (goutte)
      }
      return acc;
    }
    float heightField(vec2 uv, float t, float dens, float aspect){
      float big   = plaques(uv, 6.0, 1.0, t, dens * 0.32, aspect);
      float small = plaques(uv + vec2(0.31, 0.13), 13.0, 2.0, t * 1.25, dens * 0.45, aspect);
      return max(big, small * 0.8);
    }

    void main(){
      vec2 uv = vUv;
      float aspect = uResolution.x / uResolution.y;
      vec2 cuv = (uv - 0.5) * vec2(aspect, 1.0);
      float t = uTime;
      float dens = clamp(uAccum, 0.0, 1.0);

      // Hauteur + gradient (normale) des plaques pour la réfraction
      // Pente des gouttes par DÉRIVÉES ÉCRAN : la carte graphique calcule déjà h chez
      // les pixels voisins, dFdx/dFdy en donnent la différence gratuitement. Avant, on
      // réévaluait tout le champ de hauteur 2 fois de plus par pixel — c'était le poste
      // le plus lourd du post-traitement. Même convention qu'avant : grad = -dh/duv.
      float h  = heightField(uv, t, dens, aspect);
      // dFdx est une différence PAR PIXEL CALCULÉ : on multiplie par la taille du tampon
      // (pas par celle de l'écran), sinon la réfraction changerait avec la résolution adaptative.
      vec2 grad = -vec2(dFdx(h), dFdy(h)) * uBuffer;
      vec2 refr = grad * 0.0022 + vec2(0.0, -0.008) * h;      // déviation + glissement vers le bas

      // Givre sur les bords et voile fin au centre
      float vig = smoothstep(0.2, 0.8, length(cuv));
      // (givre des bords SUPPRIMÉ à la demande de l'utilisateur : deux zones grises quadrillées
      // à gauche et à droite de l'écran, surtout visibles en regardant vers le ciel)
      float veil = fbm(uv * 14.0 * vec2(aspect, 1.0) - vec2(0.0, t * 0.05)) * (1.0 - vig * 0.6);
      veil = smoothstep(0.58, 0.9, veil) * dens * 0.35;

      // Échantillonnage : flou proportionnel à la neige présente
      float blurAmt = (h * 2.2 + veil * 1.0) / uResolution.y * 3.0;
      vec2 suv = uv + refr;
      vec3 col = texture2D(tDiffuse, suv).rgb * 0.36;
      col += texture2D(tDiffuse, suv + vec2( blurAmt,  blurAmt)).rgb * 0.16;
      col += texture2D(tDiffuse, suv + vec2(-blurAmt,  blurAmt)).rgb * 0.16;
      col += texture2D(tDiffuse, suv + vec2( blurAmt, -blurAmt)).rgb * 0.16;
      col += texture2D(tDiffuse, suv + vec2(-blurAmt, -blurAmt)).rgb * 0.16;

      // ÉTALONNAGE « nuit de neige » (image modèle) : ombres et tons sombres tirés vers un
      // gris bleuté DE MÊME LUMINOSITÉ (la nuit ne s'éclaircit pas), hautes lumières intactes :
      // la lumière des lampes reste chaude près des globes, mais sa retombée faible ne
      // teinte plus toute l'image en brun sépia. Valeurs linéaires, avant le tone mapping.
      float lumG = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float shadowW = 1.0 - smoothstep(0.02, 0.35, lumG);
      col = mix(col, lumG * vec3(0.84, 1.0, 1.42), shadowW * uGrade);

      // Blanchiment glacé (plaques translucides, givre opaque, voile léger)
      vec3 ice = vec3(0.80, 0.86, 0.96);
      // max() : la neige collée éclaircit, elle n'ASSOMBRIT jamais — sur le trottoir devenu blanc,
      // « col*0.55 + glace » rendait les plaques en disques gris
      col = mix(col, max(col, col * 0.55 + ice * 0.45), clamp(h * 0.9, 0.0, 1.0));
      col = mix(col, max(col, col * 0.7 + ice * 0.35), veil);
      // reflet spéculaire sur le bord des gouttes
      float rim = clamp(-grad.y * 0.004, 0.0, 1.0) * h;
      col += rim * vec3(0.5, 0.55, 0.65);

      // Vignette optique + grain de pellicule
      col *= 1.0 - 0.35 * smoothstep(0.45, 1.1, length(cuv));
      col += (hash(uv * uResolution + fract(t) * 100.0) - 0.5) * 0.035;

      gl_FragColor = vec4(col, 1.0);
    }`,
};
export const facePass = new ShaderPass(faceShader);
/** Neige sur l'objectif, partagée par la boucle (accumulation, main.js) et le jeu photo :
 *  accum 0,1 (propre) → 0,65 (couvert) ; wiping > 0 = essuyage en cours (secondes restantes). */
export const lens = { accum: 0.2, wiping: 0 };
