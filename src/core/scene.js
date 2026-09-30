import * as THREE from 'three';
import { FOG_DENSITY, SIDEWALK_H, EYE_HEIGHT } from './constants.js';

/* =====================================================================
   1 bis. SCÈNE / CAMÉRA / BROUILLARD / VOÛTE CÉLESTE
   ===================================================================== */

export const scene = new THREE.Scene();
// Brume de blizzard : dans une chute de neige nocturne en ville, la lueur urbaine
// est diffusée par les flocons — le fond de rue est donc un voile gris-bleu CLAIR,
// pas du noir. C'est ce qui donne la profondeur de l'image de référence.
export const FOG_COLOR = new THREE.Color(0x1a2336);   // même luminosité que 0x1b2230, un peu plus bleue (image modèle)
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

export const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 260);
camera.position.set(-8.2, SIDEWALK_H + EYE_HEIGHT, 10);   // milieu du couloir piéton (entre lampadaires et clôtures)
scene.add(camera);

// Voûte céleste : dégradé nuit avec lueur urbaine à l'horizon.
// Le matériau est exporté : il sert aussi à cuire la carte d'environnement (voir
// core/environment.js), pour que ciel et réflexions ne puissent pas diverger.
export const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    // L'horizon EST la brume, littéralement : on passe `FOG_COLOR` en uniforme au
    // lieu de recopier des valeurs à la main. Sinon un objet lointain, fondu à
    // 99,99 % dans le brouillard, se découpe en silhouette sur un ciel qui n'a pas
    // la même couleur — c'est ce qui faisait apparaître les tours du fond en
    // masses NOIRES. Piège : `new THREE.Color(0x…)` est converti en LINÉAIRE par
    // Three, alors que le shader écrit du linéaire ; recopier les chiffres hexa
    // donnait un horizon 8,7× trop clair.
    uHorizon: { value: FOG_COLOR },
    uTop:     { value: FOG_COLOR.clone().multiplyScalar(0.3) },
  },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
      uniform vec3 uHorizon, uTop;
      varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        // la brume éclairée monte haut : le ciel ne s'assombrit que vers le zénith
        vec3 c = mix(uHorizon, uTop, smoothstep(0.08, 0.95, h));
        // lueur de la ville diffusée par la neige : gris-bleu, pas orange (sur le modèle le fond
        // de rue est un voile bleuté ; l'ancienne lueur chaude rougissait le point de fuite)
        // plus large que le reste de la voûte : c'est le ciel qu'on voit dans l'ouverture de la rue,
        // et c'est sur lui que se détachent les silhouettes (tours du fond, corniches) comme sur le modèle
        c += uHorizon * vec3(0.9, 1.0, 1.25) * (pow(max(0.0, 1.0 - abs(h)), 10.0) + 0.9 * pow(max(0.0, 1.0 - abs(h)), 4.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(230, 24, 16), skyMat));
