import * as THREE from 'three';
import { loadPhotoSet } from '../textures/photo.js';

// carrelage photo (dirty_tiles, tuile de 2,3 m) pour le sol des épiceries : uniformes
// PARTAGÉS par tous les intérieurs, remplis quand la photo est chargée (secours : damier)
const floorPhoto = { uFloorTex: { value: null }, uFloorReady: { value: 0 } };
loadPhotoSet('dirty_tiles').then(set => { floorPhoto.uFloorTex.value = set.map; floorPhoto.uFloorReady.value = 1; }).catch(() => {});

/* =====================================================================
   6 bis. INTÉRIEURS DE BOUTIQUE EN FAUSSE 3D (« interior mapping »)
   L'intérieur était une image plate collée 35 cm derrière la vitre : aucune
   profondeur, et dès qu'on se déplaçait on voyait que c'était un poster. Ici le
   plan derrière la vitre ne montre pas une image, il CALCULE ce qu'on verrait dans
   une pièce de 4 m de profond : pour chaque pixel, on prolonge le rayon de vue
   derrière la vitre et on cherche quelle paroi il touche en premier — sol carrelé,
   plafond à tubes fluorescents, murs latéraux, mur du fond (la texture de rayonnages,
   de machines…) — et, devant le fond, une gondole basse qui passe devant le mur.
   Un seul plan, donc un seul appel de dessin, mais une vraie parallaxe : les
   rayons glissent les uns devant les autres quand on longe la vitrine.
   Repère : celui du plan (x le long de la vitrine, y vers le haut, z vers la rue) ;
   la pièce s'étend vers z < 0.
   ===================================================================== */
const interiorVS = `
  varying vec3 vP, vCam;
  #include <fog_pars_vertex>
  void main(){
    vP = position;
    vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const interiorFS = `
  uniform sampler2D uWall;
  uniform vec3 uTint, uFloorA, uFloorB, uCeil;
  uniform float uHW, uYF, uYC, uDepth, uGondZ, uGondH, uGondOn, uBright, uFloorReady, uFloorUse;
  uniform sampler2D uFloorTex;
  varying vec3 vP, vCam;
  #include <fog_pars_fragment>
  // un rayon qui part du pixel de la vitre, vers l'intérieur
  void main(){
    vec3 d = normalize(vP - vCam);
    if (d.z >= -1e-4) discard;
    vec3 o = vP;
    float xw = uHW + 0.35;                                      // la pièce déborde un peu la vitrine
    float tx = ((d.x > 0.0 ? xw : -xw) - o.x) / d.x;
    float ty = ((d.y > 0.0 ? uYC : uYF) - o.y) / d.y;
    float tz = (-uDepth - o.z) / d.z;
    float t = min(tx, min(ty, tz));
    vec3 h = o + d * t, col;
    float wallV = (h.y - uYF) / (uYC - uYF);
    if (t == tz) {                                              // mur du fond : rayonnages, machines…
      col = texture2D(uWall, vec2((h.x + xw) / 4.2, wallV)).rgb;
    } else if (t == tx) {                                       // murs latéraux : même décor, en retrait et plus sombre
      col = texture2D(uWall, vec2(-h.z / 4.2 + 0.37 * sign(d.x), wallV)).rgb * 0.62;
    } else if (d.y < 0.0) {                                     // sol : carrelage, reflet laiteux des tubes au fond
      vec2 g = floor(h.xz / 0.3);
      col = mix(uFloorA, uFloorB, mod(g.x + g.y, 2.0));
      if (uFloorReady * uFloorUse > 0.5) col = texture2D(uFloorTex, h.xz / 2.3).rgb * 0.85;   // carrelage photo (épiceries)
      col *= 0.8 + 0.5 * smoothstep(0.0, uDepth, -h.z);
    } else {                                                    // plafond : dalles sombres + tubes fluorescents
      float strip = step(0.84, fract(-h.z / 1.3 + 0.2)) * step(abs(h.x), xw - 0.4);
      col = uCeil * 0.35 + uCeil * 2.2 * strip;
    }
    // gondole basse devant le fond : coupe le rayon si elle est touchée avant la paroi
    if (uGondOn > 0.5) {
      float tg = (-uGondZ - o.z) / d.z;
      vec3 hg = o + d * tg;
      float gap = step(0.9, fract((hg.x + xw) / 3.1));          // allées tous les ~3 m
      if (tg < t && hg.y < uYF + uGondH && gap < 0.5) {
        float gv = (hg.y - uYF) / uGondH;
        col = texture2D(uWall, vec2((hg.x + xw) / 3.3 + 0.5, 0.3 + gv * 0.34)).rgb * 0.9;
        col *= step(gv, 0.97) * 0.85 + 0.15;                    // chant supérieur sombre
        t = tg; h = hg;
      }
    }
    // occlusion aux angles de la pièce, lumière qui baisse vers le fond
    float edge = min(min(h.y - uYF, uYC - h.y), xw - abs(h.x));
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.6, edge);
    col *= mix(1.0, 0.65, clamp(-h.z / (uDepth * 1.4), 0.0, 1.0));
    gl_FragColor = vec4(col * uTint * uBright, 1.0);
    #include <fog_fragment>
  }`;

const KIND_STYLE = {
  grocery: { tint: [1.0, 0.88, 0.72], floorA: [0.36, 0.3, 0.24], floorB: [0.22, 0.18, 0.14], ceil: [1.0, 0.92, 0.75], gond: 1, gondH: 1.35 },
  laundry: { tint: [0.86, 0.96, 1.0], floorA: [0.72, 0.74, 0.74], floorB: [0.5, 0.52, 0.54], ceil: [0.9, 0.97, 1.0], gond: 1, gondH: 0.9 },
  bright:  { tint: [1.0, 0.98, 0.94], floorA: [0.78, 0.78, 0.76], floorB: [0.62, 0.62, 0.6], ceil: [1.0, 1.0, 0.98], gond: 1, gondH: 1.2 },
};

/** Matériau d'intérieur pour une vitrine de largeur `w` (m) et de hauteur `h` (m),
 *  dont le bas est à `floorBelow` m au-dessus du sol intérieur. */
export function makeInteriorMaterial(wallTex, kind, w, h, floorBelow) {
  const st = KIND_STYLE[kind] ?? KIND_STYLE.grocery;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uWall: { value: wallTex },
      uTint: { value: new THREE.Vector3(...st.tint) }, uFloorA: { value: new THREE.Vector3(...st.floorA) },
      uFloorB: { value: new THREE.Vector3(...st.floorB) }, uCeil: { value: new THREE.Vector3(...st.ceil) },
      uHW: { value: w / 2 }, uYF: { value: -h / 2 - floorBelow }, uYC: { value: h / 2 + 0.75 },
      uDepth: { value: 4.0 }, uGondZ: { value: 1.5 + Math.random() * 0.5 }, uGondH: { value: st.gondH }, uGondOn: { value: st.gond },
      uBright: { value: 0.85 },
    }]),
    vertexShader: interiorVS, fragmentShader: interiorFS, fog: true,
  });
  Object.assign(mat.uniforms, floorPhoto);                     // après le merge : objets partagés, pas des copies
  mat.uniforms.uFloorUse = { value: kind === 'grocery' ? 1 : 0 };
  return mat;
}
