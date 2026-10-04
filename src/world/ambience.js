import * as THREE from 'three';
import { STREET_Z_MIN, CROSS_Z, LEFT_END_X, RIGHT_END_X } from '../core/constants.js';
import { rnd } from '../core/noise.js';
import { scene, skyMat } from '../core/scene.js';

/* =====================================================================
   10. LUMIÈRE D'AMBIANCE FROIDE + lune + lueur de la ville + gratte-ciel lointains
   ===================================================================== */
// Ciel de neige : la couche nuageuse renvoie la lueur de la ville vers le sol.
// C'est cette lumière-là — pas les lampadaires — qui fait « lire » la neige comme
// blanche ; les briques, elles, restent sombres (roughness élevée, albédo faible).
scene.add(new THREE.HemisphereLight(0x4a5f84, 0x1c2431, 0.24));   // couleur « sol » relevée : aucune sous-face ne doit rendre noir pur
export const moon = new THREE.DirectionalLight(0x8ea6d4, 0.17);   // sa carte d'ombre suit le joueur (world/lightPool.js)
moon.position.set(-25, 45, -20); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -45; moon.shadow.camera.right = 45; moon.shadow.camera.top = 45; moon.shadow.camera.bottom = -45;
moon.shadow.camera.near = 5; moon.shadow.camera.far = 140; moon.shadow.bias = -0.0008; moon.shadow.radius = 3;
moon.target.position.set(0, 0, -15); scene.add(moon); scene.add(moon.target);
const cityGlow = new THREE.PointLight(0x7488bd, 90, 120, 2); cityGlow.position.set(0, 20, STREET_Z_MIN - 5); scene.add(cityGlow);

// Tours au bout de la rue. À 130–170 m, le brouillard les effaçait complètement : seules
// leurs fenêtres flottaient dans le vide. Sur le modèle, on devine au contraire de hautes
// SILHOUETTES bleutées dans la brume. Leur matériau calcule donc la couleur du ciel juste
// derrière (mêmes uniformes que la voûte céleste) et la fonce un peu : la silhouette reste
// toujours lisible, plus claire au pied (brume épaisse) qu'au sommet, sans jamais pouvoir
// se découper plus claire que le ciel.
{
  const towerMat = new THREE.ShaderMaterial({
    uniforms: { uHorizon: skyMat.uniforms.uHorizon, uTop: skyMat.uniforms.uTop },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uHorizon, uTop; varying vec3 vW;
      void main(){
        float h = normalize(vW - cameraPosition).y;
        vec3 sky = mix(uHorizon, uTop, smoothstep(0.08, 0.95, h)) + uHorizon * vec3(0.9, 1.0, 1.25) * (pow(max(0.0, 1.0 - abs(h)), 10.0) + 0.9 * pow(max(0.0, 1.0 - abs(h)), 4.0));   // même formule que la voûte
        float haze = exp(-max(vW.y, 0.0) / 45.0);                 // brume plus épaisse au pied des tours
        gl_FragColor = vec4(sky * vec3(0.86, 0.94, 1.08) * mix(0.5, 0.85, haze), 1.0);
      }`,
  });
  const winGeo = new THREE.PlaneGeometry(1.1, 1.6);
  const wins = [], qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), qXn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), one = new THREE.Vector3(1, 1, 1);
  /** Tour de côté w, hauteur h ; fenêtres sur la face tournée vers la rue (+z ; faceX : +1 → +x pour la
   *  rue de gauche, −1 → −x pour celle de droite). */
  const tower = (x, z, w, h, faceX) => {
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat); t.position.set(x, h / 2, z); scene.add(t);
    const cols = Math.floor(w / 3), rows = Math.floor(h / 3.5);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (Math.random() < 0.35) {
      const a = -w / 2 + (c + 0.5) * (w / cols), y = (r + 0.5) * (h / rows);
      wins.push(faceX ? new THREE.Matrix4().compose(new THREE.Vector3(x + faceX * (w / 2 + 0.05), y, z + a), faceX > 0 ? qX : qXn, one) : new THREE.Matrix4().makeTranslation(x + a, y, z + w / 2 + 0.05));
    }
  };
  // plus hautes qu'avant (45–95 m), et un tiers d'entre elles dans l'axe de la rue, là où on les voit ;
  // reculées derrière la rangée d'immeubles qui ferme le carrefour (elle s'arrête à ~121 m)
  for (let i = 0; i < 13; i++) tower(i % 3 === 0 ? rnd(-22, 22) : rnd(-80, 80), STREET_Z_MIN - rnd(58, 100), rnd(14, 26), rnd(70, 140), false);
  // au-delà du fond de la rue de gauche : leurs silhouettes dépassent des immeubles de l'impasse
  for (let i = 0; i < 5; i++) tower(LEFT_END_X - rnd(60, 110), CROSS_Z + (i % 2 ? rnd(-15, 15) : rnd(-55, 55)), rnd(14, 26), rnd(70, 140), 1);
  // au-delà du parc, au bout de la rue de droite : la ville de l'autre côté des arbres
  for (let i = 0; i < 4; i++) tower(RIGHT_END_X + rnd(230, 290), CROSS_Z + (i % 2 ? -1 : 1) * rnd(40, 90), rnd(16, 26), rnd(50, 95), -1);
  const inst = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.2, 0.17), fog: false }), wins.length);
  wins.forEach((m, i) => inst.setMatrixAt(i, m)); scene.add(inst);
}
