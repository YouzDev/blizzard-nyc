import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STREET_Z_MIN, CROSS_Z, LEFT_END_X, RIGHT_END_X } from '../core/constants.js';
import { rnd } from '../core/noise.js';
import { scene, skyMat } from '../core/scene.js';
import { glowTex } from '../textures/index.js';
import { addSubject } from '../game/subjects.js';

let beaconMat = null;
/** Feu d'obstacle du gratte-ciel : un éclat rouge toutes les 1,5 s. */
export function updateAmbience(t) { if (beaconMat) beaconMat.color.setRGB(Math.sin(t * 4.2) > 0.6 ? 2 : 0.15, 0.06, 0.04); }

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
  // … en laissant libre le milieu de l'axe (|x| < 8 m) : c'est par là qu'on voit le gratte-ciel du fond
  for (let i = 0; i < 13; i++) {
    const w = rnd(14, 26); let x = i % 3 === 0 ? rnd(-22, 22) : rnd(-80, 80);
    if (Math.abs(x) < 8 + w / 2) x = (x < 0 ? -1 : 1) * (8 + w / 2 + rnd(0, 4));
    tower(x, STREET_Z_MIN - rnd(58, 100), w, rnd(70, 140), false);
  }
  /* LE GRATTE-CIEL DU FOND (demande utilisateur : « l'esprit New York ») : dans l'axe de la rue
     principale, à ~580 m du départ, une tour Art déco à ressauts de 270 m, son mât et son antenne ;
     sa couronne est illuminée en ROUGE et VERT pour Noël et perce la tempête (hors brouillard, avec
     un halo), le feu d'obstacle rouge clignote au sommet. Corps : même matériau que les autres tours
     (silhouette un peu plus sombre que le ciel). Plan lointain de la caméra repoussé à 700 m (scene.js). */
  {
    const LX = 0, LZ = -560;
    const tiers = [[44, 36, 120], [34, 28, 175], [26, 22, 215], [19, 17, 238], [14, 13, 252], [10, 10, 262], [7, 7, 270]];
    const lit = { red: [], green: [], white: [] };
    let y0 = 0;
    tiers.forEach(([w, d, top], i) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, top - y0, d), towerMat); t.position.set(LX, (y0 + top) / 2, LZ); scene.add(t);
      if (i < 3) for (let r = 0; r < Math.floor((top - y0) / 4); r++) for (let c = 0; c < Math.floor(w / 3.2); c++) if (Math.random() < 0.22)
        wins.push(new THREE.Matrix4().makeTranslation(LX - w / 2 + (c + 0.5) * (w / Math.floor(w / 3.2)), y0 + (r + 0.5) * 4, LZ + d / 2 + 0.05));
      if (i >= 3) {                                                 // couronne : chaque ressaut éclairé, rouge / vert en alternance
        const key = i === tiers.length - 1 ? 'white' : i % 2 ? 'red' : 'green', h = top - y0 - 0.6;
        for (const [nx, nz, len] of [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]]) {
          const g = new THREE.PlaneGeometry(len, h); g.rotateY(Math.atan2(nx, nz)); g.translate(LX + nx * (w / 2 + 0.2), (y0 + top) / 2, LZ + nz * (d / 2 + 0.2)); lit[key].push(g);
        }
      }
      y0 = top;
    });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 22, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.3, 0.28), fog: false })); mast.position.set(LX, 281, LZ); scene.add(mast);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 26, 6), towerMat); ant.position.set(LX, 305, LZ); scene.add(ant);
    // voilées par la neige : couleurs assourdies, c'est le halo qui fait la lumière
    const COL = { red: new THREE.Color(0.42, 0.06, 0.05), green: new THREE.Color(0.05, 0.32, 0.13), white: new THREE.Color(0.4, 0.39, 0.35) };
    for (const k in lit) scene.add(new THREE.Mesh(mergeGeometries(lit[k]), new THREE.MeshBasicMaterial({ color: COL[k], fog: false })));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.7, 0.45, 0.4), transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.set(190, 190, 1); halo.position.set(LX, 245, LZ); scene.add(halo);
    beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.12, 0.08), fog: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), beaconMat); beacon.position.set(LX, 319, LZ); scene.add(beacon);
    addSubject({ label: 'Le gratte-ciel illuminé pour Noël', value: 0.85, glows: true, box: new THREE.Box3(new THREE.Vector3(LX - 10, 215, LZ - 10), new THREE.Vector3(LX + 10, 320, LZ + 10)) });
  }
  // au-delà du fond de la rue de gauche : leurs silhouettes dépassent des immeubles de l'impasse
  for (let i = 0; i < 5; i++) tower(LEFT_END_X - rnd(60, 110), CROSS_Z + (i % 2 ? rnd(-15, 15) : rnd(-55, 55)), rnd(14, 26), rnd(70, 140), 1);
  // au-delà du parc, au bout de la rue de droite : la ville de l'autre côté des arbres
  for (let i = 0; i < 4; i++) tower(RIGHT_END_X + rnd(230, 290), CROSS_Z + (i % 2 ? -1 : 1) * rnd(40, 90), rnd(16, 26), rnd(50, 95), -1);
  const inst = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.2, 0.17), fog: false }), wins.length);
  wins.forEach((m, i) => inst.setMatrixAt(i, m)); scene.add(inst);
}
