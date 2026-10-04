import * as THREE from 'three';
import { grimeTex } from '../textures/index.js';
import { FACADE_X, LAMP_Z0, LAMP_PITCH } from '../core/constants.js';

/* REBOND DE LA NEIGE sur les façades (image modèle : on y lit la brique rouge et les
   escaliers de secours jusqu'au 2e-3e étage). Dans la réalité, la neige au sol renvoie
   la lumière des lampadaires vers le haut ; chez nous les façades tombaient au noir
   dès le premier étage. Deux termes, calculés par pixel, SANS lumière en plus :
   - chaud : la flaque de lumière de chaque lampadaire (grille connue : LAMP_Z0,
     LAMP_PITCH, côté droit décalé d'un demi-pas) éclaire le mur en face, fort au pied,
     qui s'éteint en montant et en s'éloignant du lampadaire le long de la rue ;
   - froid : la lueur du ciel renvoyée par toute la rue enneigée, faible, plus
     présente en bas.
   Seules les faces tournées vers la rue ou vers le sol (dessous des appuis, des
   corniches) le reçoivent. Uniformes PARTAGÉS : un seul réglage pour toute la rue. */
export const snowBounce = {
  uBounceWarm: { value: new THREE.Vector3(0.26, 0.17, 0.095) },
  uBounceCool: { value: new THREE.Vector3(0.03, 0.04, 0.062) },
};
import { usePhoto, loadPhotoSet, photoMean } from '../textures/photo.js';

/* =====================================================================
   6 quater. VIEILLISSEMENT DES FAÇADES (dans le shader, dans le repère de la rue)
   Une façade new-yorkaise n'est jamais propre et jamais uniforme : la suie noircit
   le haut sous la corniche, la pluie qui ruisselle des appuis de fenêtre dessine
   des coulures sombres sous chacun d'eux, les briques changent de ton par plaques.
   Faire ça dans la texture de brique la rendrait identique tous les 5,5 m ; on le
   fait ici, par pixel, d'après sa POSITION DANS LE MONDE et la géométrie réelle de
   l'immeuble (grille des fenêtres, hauteur). Coût : une lecture de texture et une
   vingtaine d'opérations par pixel de mur.
   ===================================================================== */

/** Greffe le vieillissement sur un MeshStandardMaterial. `p` (tout optionnel) :
 *  top (hauteur du haut de mur, suie sous la corniche), et pour les coulures sous
 *  appuis : z0, pitch, cols (grille des colonnes le long de Z), y0 (premier appui),
 *  floorH, rows, winW. `strength` règle l'ensemble (1 = brique).
 *  `frame` : repère de la rue (Street.frame : cos, sin, x0, z0) — tout le calcul se fait dans
 *  ce repère (façades à x = ±FACADE_X, grille des lampadaires le long de z), donc il vaut
 *  aussi pour une rue tournée ; par défaut celui du monde (rue principale).
 *  `warm` : part du rebond chaud des lampadaires (0 sur une façade sans lampadaires devant :
 *  la grille analytique en inventerait). `faceX` : plan des façades dans ce repère (±FACADE_X par
 *  défaut ; brownstones : reculées de AREA_W derrière leur cour). Uniformes, pas texte du shader :
 *  un seul programme. */
export function weather(mat, p = {}) {
  const u = {
    uGrime: { value: grimeTex },
    uTop: { value: p.top ?? 1e4 },                 // par défaut : pas de suie de corniche
    uWin: { value: p.pitch ? 1 : 0 },
    uZ0: { value: p.z0 ?? 0 }, uPitch: { value: p.pitch ?? 1 }, uCols: { value: p.cols ?? 0 },
    uY0: { value: p.y0 ?? 0 }, uFloorH: { value: p.floorH ?? 1 }, uRows: { value: p.rows ?? 0 }, uWinW: { value: p.winW ?? 1 },
    uStrength: { value: p.strength ?? 1 },
    uEscZ: { value: p.escZ ?? 0 }, uEscW: { value: p.escW ?? 0 }, uEscY0: { value: p.escY0 ?? 0 }, uEscN: { value: p.escN ?? 0 },
    uFrame: { value: p.frame ?? new THREE.Vector4(1, 0, 0, 0) }, uWarm: { value: p.warm ?? 1 },
    uFaceX: { value: p.faceX ?? FACADE_X },          // plan des façades de la rue (brownstones : reculées derrière leur cour)
  };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u, snowBounce);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform vec4 uFrame;')
      // vWPos / vWNrm : position et normale dans le REPÈRE DE LA RUE (le monde, pour la rue principale)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 wpF = modelMatrix * vec4(transformed, 1.0);
          vec2 dF = wpF.xz - uFrame.zw;
          vWPos = vec3(uFrame.x * dF.x - uFrame.y * dF.y, wpF.y, uFrame.y * dF.x + uFrame.x * dF.y);
          vec3 nF = normalize(mat3(modelMatrix) * objectNormal);
          vWNrm = vec3(uFrame.x * nF.x - uFrame.y * nF.z, nF.y, uFrame.y * nF.x + uFrame.x * nF.z);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D uGrime;
        uniform float uTop, uWin, uZ0, uPitch, uCols, uY0, uFloorH, uRows, uWinW, uStrength, uEscZ, uEscW, uEscY0, uEscN, uWarm, uFaceX;
        uniform vec3 uBounceWarm, uBounceCool;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float sideB = vWPos.x < 0.0 ? -1.0 : 1.0;
          // faces vers la rue (normale opposée au côté) ou vers le sol
          float faceB = max(max(-sideB * vWNrm.x, 0.0), max(-vWNrm.y, 0.0));
          float yB = max(vWPos.y, 0.0);
          // lampadaire le plus proche de ce côté-ci : écart le long de la rue
          float z0B = ${LAMP_Z0.toFixed(2)} + (sideB > 0.0 ? ${(LAMP_PITCH / 2).toFixed(2)} : 0.0);
          float dzB = vWPos.z - z0B - ${LAMP_PITCH.toFixed(2)} * floor((vWPos.z - z0B) / ${LAMP_PITCH.toFixed(2)} + 0.5);
          // distance à la façade : le rebond concerne les murs de rue, pas l'intérieur des îlots
          float nearB = 1.0 - smoothstep(1.5, 4.0, abs(abs(vWPos.x) - uFaceX));
          float warmB = exp(-dzB * dzB / 24.0) / (1.0 + yB * yB / 14.0);
          float coolB = exp(-yB / 9.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * faceB * nearB * (uBounceWarm * warmB * uWarm + uBounceCool * coolB);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          bool facadeX = abs(vWNrm.x) > 0.5;                      // façade sur rue (plan YZ) ?
          vec2 wuv = facadeX ? vWPos.zy : vWPos.xy;
          vec3 gm = texture2D(uGrime, wuv / 17.0).rgb;
          float f = mix(0.7, 1.16, gm.r);                        // plaques : casse la répétition de la brique
          f *= 1.0 - 0.28 * gm.g;                                 // coulures verticales partout
          float soot = smoothstep(uTop - 3.2, uTop - 0.2, vWPos.y); // suie sous la corniche
          f *= 1.0 - 0.5 * soot * (0.55 + 0.45 * gm.g);
          if (uWin > 0.5 && facadeX) {
            // coulures sous les appuis : colonne et étage de la fenêtre la plus proche au-dessus
            float zl = (vWPos.z - uZ0) / uPitch, col = floor(zl);
            float dz = abs(fract(zl) - 0.5) * uPitch;            // écart horizontal à l'axe de la fenêtre
            float r = ceil((vWPos.y - uY0) / uFloorH);           // appui situé au-dessus du point
            float dy = uY0 + r * uFloorH - vWPos.y;               // distance sous cet appui
            if (col >= 0.0 && col < uCols && r >= 0.0 && r < uRows) {
              float n = texture2D(uGrime, vec2(vWPos.z * 0.9, vWPos.y * 0.05)).b;        // irrégularité, étirée en hauteur
              float ends = exp(-pow((dz - uWinW * 0.46) / 0.07, 2.0));                   // deux traînées aux bouts de l'appui
              float wash = 1.0 - smoothstep(uWinW * 0.25, uWinW * 0.55, dz);             // voile plus large au milieu
              float fall = exp(-dy / (0.9 + 1.5 * n));                                   // s'efface en descendant
              f *= 1.0 - 0.7 * clamp((1.0 * ends + 0.55 * wash) * fall * (0.45 + 0.9 * n), 0.0, 1.0);
            }
          }
          diffuseColor.rgb *= mix(1.0, f, uStrength);
          // rouille de l'escalier de secours : l'eau qui ruisselle des paliers en fonte
          // teinte la brique en brun-orangé sous chacun d'eux, en traînées verticales
          if (uEscN > 0.5 && facadeX && abs(vWPos.z - uEscZ) < uEscW * 0.5 + 0.15) {
            float re = ceil((vWPos.y - uEscY0) / 3.2), dyE = uEscY0 + re * 3.2 - vWPos.y;
            if (re >= 0.0 && re < uEscN) {
              float streak = smoothstep(0.12, 0.55, texture2D(uGrime, vec2(vWPos.z * 1.9, vWPos.y * 0.04)).g);
              float ends = exp(-pow((abs(vWPos.z - uEscZ) - uEscW * 0.5 + 0.05) / 0.12, 2.0));   // sous les consoles
              float rust = clamp((0.8 * streak + 0.9 * ends) * exp(-dyE / 1.8), 0.0, 1.0) * uStrength;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.12, 0.05), rust * 0.72);
            }
          }
        }`);
  };
  return mat;
}

/** Variante pour le SOL (trottoirs, chaussée) : la tuile de trottoir se répète tous
 *  les 4,5 m, ses flaques et ses pistes aussi. On module donc, en coordonnées monde
 *  (x, z), la teinte (plaques plus ou moins piétinées) et on ajoute des zones plus
 *  humides — plus sombres et plus lisses, donc qui accrochent les reflets des
 *  lampadaires — là où la carte de salissure est basse. */
export function groundWeather(mat, strength = 1) {
  const u = {
    uGrime: { value: grimeTex }, uGStrength: { value: strength },
    // mode PHOTO (voir groundPhoto) : la photo devient la texture de base, et l'ancienne
    // texture canvas (zones, empreintes, ornières, sel) est MULTIPLIÉE par-dessus
    uPhotoOn: { value: 0 }, uPhotoRepeat: { value: new THREE.Vector2(1, 1) },
    uOverlay: { value: mat.map }, uOverlayRepeat: { value: new THREE.Vector2(1, 1) },
    uSnowB: { value: mat.map }, uBlendOn: { value: 0 },
    uGainA: { value: new THREE.Vector3(1, 1, 1) }, uGainB: { value: new THREE.Vector3(1, 1, 1) },   // normalisation des photos
    // trottoir : bande (u) où la 2e photo prend le relais, contraste de la 1re photo,
    // relief tiré du canvas (empreintes) ajouté à celui de la photo
    uBlendU: { value: new THREE.Vector2(0.6, 0.88) }, uMeanA: { value: new THREE.Vector3(1, 1, 1) }, uContrastA: { value: 1 },
    uOvNrmK: { value: 0 },
  };
  mat.userData.groundUniforms = u;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGPos; uniform sampler2D uGrime, uOverlay, uSnowB; uniform float uGStrength, uPhotoOn, uBlendOn;
        uniform vec2 uPhotoRepeat, uOverlayRepeat, uBlendU; uniform vec3 uGainA, uGainB, uMeanA; uniform float uContrastA, uOvNrmK;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float gOvH = 0.0;                                                     // « hauteur » lue dans le canvas (relief des traces)
        #ifdef USE_MAP
        if (uPhotoOn > 0.5) {
          vec2 uv0 = vMapUv / uPhotoRepeat;                                   // UV d'origine du plan
          diffuseColor.rgb *= uGainA;                                         // photo ramenée à la teinte voulue
          diffuseColor.rgb = mix(uMeanA * diffuse, diffuseColor.rgb, uContrastA);   // contraste réduit (grains sombres de la neige tassée)
          // trottoir : neige fraîche (2e photo) sur presque toute la largeur, neige tassée
          // seulement le long de la bordure ; limite irrégulière (bruit monde), jamais un trait net
          if (uBlendOn > 0.5) {
            float nB = texture2D(uGrime, vGPos.xz / 6.0).b;
            float wB = smoothstep(uBlendU.x, uBlendU.y, uv0.x + (nB - 0.5) * 0.2);
            diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uSnowB, vMapUv).rgb * uGainB * diffuse, wB);
          }
          // détails du canvas (empreintes, ornières, gadoue, sel) ; sa neige propre ≈ 1
          vec3 ov = texture2D(uOverlay, uv0 * uOverlayRepeat).rgb / vec3(0.76, 0.807, 0.871);
          diffuseColor.rgb *= clamp(ov, 0.0, 1.15);
          gOvH = dot(ov, vec3(0.3, 0.4, 0.3));                                // empreintes = creux sombres, rebords clairs
        }
        #endif
        vec3 gGm = texture2D(uGrime, vGPos.xz / 9.0).rgb;
        float gWet = (1.0 - smoothstep(0.0, 0.1, gGm.r)) * uGStrength;            // zones humides (rares)
        diffuseColor.rgb *= mix(1.0, mix(0.93, 1.04, gGm.r), uGStrength) * (1.0 - 0.15 * gWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 - 0.4 * gWet;`)
      // relief : en mode photo, la normal map est celle de la photo et les traces de pas du
      // canvas n'étaient plus que des taches. On leur rend du volume par « bump » en dérivées
      // écran de la teinte du canvas (déjà lue) : AUCUNE texture en plus — le shader du sol
      // est à la limite des 16 textures (cartes d'ombre des lampadaires comprises).
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uOvNrmK > 0.0) {
          vec2 dH = vec2(dFdx(gOvH), dFdy(gOvH)) * 0.06 * uOvNrmK;
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2));
        }`);
  };
  return mat;
}

/** Passe un matériau de sol (déjà traité par groundWeather) en mode photo : la photo
 *  `name` en texture de base, répétée ru × rv sur le plan ; l'ancienne texture canvas
 *  multipliée par-dessus avec sa répétition d'origine ; `blendWith` : 2e photo mélangée
 *  côté façade (trottoir). Si les photos ne chargent pas, rien ne change. */
export function groundPhoto(mat, name, ru, rv, blendWith = null, target = [0.8, 0.83, 0.88], opts = {}) {
  const u = mat.userData.groundUniforms, overlay = mat.map, ovRepeat = mat.map.repeat.clone();
  if (opts.blendU) u.uBlendU.value.set(...opts.blendU);
  u.uMeanA.value.set(...target); u.uContrastA.value = opts.contrast ?? 1;
  // gain par canal = teinte voulue / moyenne de la photo (borné : on corrige, on ne réinvente pas)
  const gain = (tex, out) => { const m = photoMean(tex); out.set(...target.map((t, i) => Math.min(2.5, Math.max(0.4, t / Math.max(1e-3, m.getComponent(i)))))); };
  const apply = setB => usePhoto(mat, name, ru, rv, (mm, s) => {
    u.uOverlay.value = overlay; u.uOverlayRepeat.value.copy(ovRepeat);
    u.uOvNrmK.value = opts.overlayRelief ?? 0;
    u.uPhotoRepeat.value.set(ru, rv); u.uPhotoOn.value = 1;
    gain(s.map, u.uGainA.value);
    if (setB) { const b = setB.map.clone(); b.repeat.set(ru, rv); b.needsUpdate = true; u.uSnowB.value = b; u.uBlendOn.value = 1; gain(setB.map, u.uGainB.value); }
  });
  if (blendWith) loadPhotoSet(blendWith).then(apply).catch(() => apply(null)); else apply(null);
}
