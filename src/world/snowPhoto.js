import * as THREE from 'three';
import { loadPhotoSet, photoMean } from '../textures/photo.js';
import { grimeTex } from '../textures/index.js';

/* =====================================================================
   6 quinquies. NEIGE PHOTO SUR LES OBJETS (projection triplanaire)
   La neige posée sur les voitures, les rebords, les poubelles, les congères… était
   un blanc uni et lisse. Ces objets ont des UV de toutes sortes (sphères, nappes
   étirées sur 3 m, dômes) : plaquer la photo dessus la déformerait. On la PROJETTE
   donc depuis les trois axes du monde, en tuiles de 2 m, et on mélange les trois
   projections selon l'orientation de la surface (le dessus prend la vue d'en haut,
   les flancs les vues de côté). Idem pour le relief (mélange « whiteout »). Le grain
   de la neige est ainsi continu d'un objet à l'autre et à la bonne échelle partout.
   Même principe de secours que le reste : tant que la photo n'est pas chargée (ou en
   file://), le matériau reste en blanc uni.
   ===================================================================== */
const snowTri = {
  uSnowOn: { value: 0 }, uSnowMap: { value: grimeTex }, uSnowNrm: { value: grimeTex },
  uSnowScale: { value: 0.5 }, uSnowGain: { value: new THREE.Vector3(1, 1, 1) },
};
// une seule fois : les matériaux de neige partagent ces uniformes
loadPhotoSet('snow_02').then(set => {
  const m = photoMean(set.map), target = [0.9, 0.92, 0.96];
  snowTri.uSnowGain.value.set(...target.map((t, i) => Math.min(2.5, Math.max(0.4, t / Math.max(1e-3, m.getComponent(i))))));
  snowTri.uSnowMap.value = set.map; snowTri.uSnowNrm.value = set.normal; snowTri.uSnowOn.value = 1;
}).catch(() => {});

/** Greffe la neige photo triplanaire sur un MeshStandardMaterial de neige. */
export function snowPhoto(mat) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, snowTri);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSP; varying vec3 vSN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSP; varying vec3 vSN;
        uniform sampler2D uSnowMap, uSnowNrm; uniform float uSnowOn, uSnowScale; uniform vec3 uSnowGain;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 snN = normalize(vSN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 snW = pow(abs(snN), vec3(4.0)); snW /= (snW.x + snW.y + snW.z);
        vec2 snUX = vSP.zy * uSnowScale, snUY = vSP.xz * uSnowScale, snUZ = vSP.xy * uSnowScale;
        if (uSnowOn > 0.5) {
          vec3 snC = texture2D(uSnowMap, snUX).rgb * snW.x + texture2D(uSnowMap, snUY).rgb * snW.y + texture2D(uSnowMap, snUZ).rgb * snW.z;
          diffuseColor.rgb *= snC * uSnowGain;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uSnowOn > 0.5) {
          // relief : mélange « whiteout » des trois projections, exprimé dans le monde puis ramené en repère vue
          vec3 tX = texture2D(uSnowNrm, snUX).xyz * 2.0 - 1.0, tY = texture2D(uSnowNrm, snUY).xyz * 2.0 - 1.0, tZ = texture2D(uSnowNrm, snUZ).xyz * 2.0 - 1.0;
          tX = vec3(tX.xy * 0.8 + snN.zy, abs(tX.z) * snN.x);
          tY = vec3(tY.xy * 0.8 + snN.xz, abs(tY.z) * snN.y);
          tZ = vec3(tZ.xy * 0.8 + snN.xy, abs(tZ.z) * snN.z);
          vec3 snWorld = normalize(tX.zyx * snW.x + tY.xzy * snW.y + tZ.xyz * snW.z);
          normal = normalize(mat3(viewMatrix) * snWorld);
        }`);
  };
  return mat;
}
