import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF, FACADE_X, SIDEWALK_H, STREET_Z_MIN, STREET_Z_MAX, FOG_DENSITY, LAMP_Z0, LAMP_PITCH } from '../core/constants.js';
import { rnd, smoothNoise } from '../core/noise.js';
import { scene } from '../core/scene.js';
import { lampPaint, glowTex } from '../textures/index.js';
import { usePhoto } from '../textures/photo.js';
import { MAT } from './materials.js';
import { addCollider, shadowed } from './collisions.js';
import { flickerLights, lampPositions, addPointSource, addSpotSource } from './lightRegistry.js';
import { addContactShadow } from './contactShadows.js';
import { doorGap } from './buildings.js';
import { addSubject, boxAt } from '../game/subjects.js';

/* =====================================================================
   7. LAMPADAIRES ORNEMENTAUX, POUBELLES, BOUCHES D'INCENDIE, CONGÈRES
   ===================================================================== */

// Fonte peinte (vert-noir, éclats, rouille, sel au pied) : partagée par tous les lampadaires
const lampPaintMat = new THREE.MeshStandardMaterial({
  map: lampPaint.map, roughnessMap: lampPaint.roughnessMap, normalMap: lampPaint.normalMap,
  normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0.15, envMapIntensity: 1.1,   // peinture : diélectrique, presque pas métallique
});
// relief et rugosité d'une fonte piquée de rouille (photo), sans toucher à la couleur de la peinture
usePhoto(lampPaintMat, 'rust_coarse_01', 0.5, 2, m => { m.map = lampPaint.map; });

// Globe en verre dépoli prismatique. Un MeshBasic blanc saturé ne montrait qu'une
// boule plate ; ici le verre est plus lumineux là où on regarde à travers vers
// l'ampoule (face à l'œil, vers le milieu) et plus sourd sur les bords, avec les
// côtes verticales du verre prismatique. Couleurs > 1 : c'est le bloom qui fait la lueur.
const globeVS = `
  varying vec3 vN, vV; varying float vY, vA;
  #include <fog_pars_vertex>
  void main(){
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = -mvPosition.xyz;
    vY = position.y; vA = atan(position.z, position.x);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const globeFS = `
  uniform vec3 uColor; uniform float uK, uY0, uY1;
  varying vec3 vN, vV; varying float vY, vA;
  #include <fog_pars_fragment>
  void main(){
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    float t = clamp((vY - uY0) / (uY1 - uY0), 0.0, 1.0);
    float bulb = exp(-pow((t - 0.55) * 2.6, 2.0));                 // l'ampoule, vers le milieu du globe
    float rib = 0.8 + 0.2 * pow(abs(cos(vA * 12.0)), 3.0);         // côtes du verre prismatique
    float c = (0.4 + 1.35 * pow(ndv, 1.8) * (0.45 + 0.85 * bulb)) * rib;
    gl_FragColor = vec4(uColor * c * uK, 1.0);
    #include <fog_fragment>
  }`;

// Cône de lumière dans la neige en suspension : sous chaque lanterne, l'air chargé
// de flocons diffuse la lumière et dessine un cône pâle — c'est LE signe d'un
// lampadaire dans une tempête. Additif, sans écriture de profondeur, bords fondus
// (plus on voit la paroi par la tranche, plus elle s'efface), brouillard calculé à
// la main : en additif, la brume de Three AJOUTERAIT sa couleur au lieu d'éteindre.
const coneVS = `
  uniform float uH, uFog;
  varying float vH, vFog; varying vec3 vN, vV;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vH = position.y / uH + 0.5;                                     // 0 au sol, 1 à la lanterne
    vN = normalize(normalMatrix * normal); vV = -mv.xyz;
    float d = length(mv.xyz); vFog = exp(-uFog * uFog * d * d);
    gl_Position = projectionMatrix * mv;
  }`;
const coneFS = `
  uniform vec3 uColor; uniform float uK;
  varying float vH, vFog; varying vec3 vN, vV;
  void main(){
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 3.0);
    float a = (0.1 + 0.9 * pow(vH, 2.2)) * smoothstep(0.0, 0.2, vH) * edge * vFog * uK;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

// DIFFUSION de la lanterne dans l'air chargé de neige. Le cône seul faisait
// « projecteur » ; en vrai, chaque flocon et chaque gouttelette renvoie la lumière
// dans toutes les directions, et l'on voit une boule de lumière qui s'éteint
// progressivement autour de la lanterne. Pour chaque pixel, on intègre
// analytiquement la lumière reçue le long du rayon de vue (intensité en 1/d²) :
//   ∫ dt / ((t − tc)² + h²) = [atan((t − tc) / h)] / h
// (tc : point du rayon le plus proche de la lampe, h : distance à ce point).
// On retranche la valeur au bord pour que la contribution tombe à zéro EN DOUCEUR au bord de la
// sphère englobante (pas de contour visible). Plus fort sous la lanterne qu'au-dessus
// (le chapeau coupe la lumière vers le ciel), éteint par la brume avec la distance.
// Sphère en double face : de l'extérieur on ne garde que les faces avant, de
// l'intérieur (joueur sous le lampadaire) il ne reste que les faces arrière.
// Rayon 4,5 m : la sphère ne rentre ni dans les façades (à 4,65 m) ni dans les voitures.
const glowVS = `
  varying vec3 vWorld;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const glowFS = `
  uniform vec3 uCenter, uColor; uniform float uR, uK, uFog;
  varying vec3 vWorld;
  void main(){
    vec3 O = cameraPosition, D = normalize(vWorld - O), L = uCenter - O;
    bool outside = dot(L, L) > uR * uR;
    if (outside && !gl_FrontFacing) discard;                    // une seule traversée comptée
    float tc = dot(L, D), h2 = dot(L, L) - tc * tc;
    float s2 = uR * uR - h2; if (s2 <= 0.0) discard;
    float s = sqrt(s2), t0 = max(tc - s, 0.0), t1 = tc + s;
    // deux termes : diffusion directe en 1/d² (serrée, 30 cm de cœur pour éviter la
    // singularité dans le globe) + diffusion multiple, qui élargit la lueur (1,5 m de
    // cœur) : dans une tempête, la lumière rebondit de flocon en flocon
    float hA = sqrt(h2 + 0.09), hB = sqrt(h2 + 2.25), dt = t1 - t0;
    float IA = (atan((t1 - tc) / hA) - atan((t0 - tc) / hA)) / hA - dt / (uR * uR + 0.09);
    float IB = (atan((t1 - tc) / hB) - atan((t0 - tc) / hB)) / hB - dt / (uR * uR + 2.25);
    float I = 0.3 * IA + 0.5 * IB;                              // diffusion large réduite : la lueur reste autour du globe (modèle)
    vec3 P = O + D * clamp(tc, t0, t1);
    float down = mix(1.0, 0.3, smoothstep(-0.5, 0.35, normalize(P - uCenter).y));   // chapeau : peu de lumière vers le haut
    float fog = exp(-uFog * uFog * dot(L, L));
    gl_FragColor = vec4(uColor * max(I, 0.0) * down * fog * uK, 1.0);
  }`;

/** Géométrie placée : rotation (x, y, z) puis translation, sans index (fusion). */
function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z));
  return g;
}

function buildLamppost(x, z, side) {
  const g = new THREE.Group(), metal = [], snow = [];
  // socle tourné (profil ornemental)
  const profile = [[0, 0], [0.36, 0], [0.36, 0.12], [0.3, 0.18], [0.3, 0.4], [0.22, 0.5], [0.2, 0.9], [0.24, 1.0], [0.16, 1.1], [0.1, 1.2]].map(p => new THREE.Vector2(p[0], p[1]));
  metal.push(placed(new THREE.LatheGeometry(profile, 24), 0, 0, 0));
  // fût CANNELÉ : 16 cannelures creusées dans le cylindre (déplacement radial)
  const pole = new THREE.CylinderGeometry(0.08, 0.11, 5.2, 96, 1, true), pp = pole.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const px = pp.getX(i), pz = pp.getZ(i), a = Math.atan2(pz, px);
    const k = 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.cos(16 * a), 3);
    pp.setX(i, px * k); pp.setZ(i, pz * k);
  }
  pole.computeVertexNormals();
  metal.push(placed(pole, 0, 3.7, 0));
  metal.push(placed(new THREE.TorusGeometry(0.13, 0.03, 8, 20), 0, 6.28, 0, Math.PI / 2));   // collier
  // col de cygne vers la rue + volute décorative
  const armRot = side < 0 ? Math.PI / 2 : 0, lantX = side * -0.85;
  metal.push(placed(new THREE.TorusGeometry(0.85, 0.05, 10, 28, Math.PI / 2), side * -0.85, 6.3, 0, 0, 0, armRot));
  metal.push(placed(new THREE.TorusGeometry(0.2, 0.035, 8, 20, Math.PI * 1.6), side * -0.15, 6.9, 0, 0, 0, side < 0 ? 0.3 : Math.PI - 0.3));
  // neige posée sur le dessus du col (la partie presque horizontale seulement)
  const ridge = new THREE.TorusGeometry(0.85, 0.045, 6, 14, 0.9); ridge.scale(1, 1, 1.15);
  snow.push(placed(ridge, side * -0.85, 6.3 + 0.035, 0, 0, 0, side < 0 ? Math.PI / 2 : Math.PI / 2 - 0.9));

  // --- Lanterne suspendue au bout du col (y = 7,15) : tige, chapeau en cloche,
  // globe en poire cerclé de 6 côtes, fleuron sous le globe
  const Y_TOP = 6.98, Y_RIM = 6.8, Y_BOT = 6.14;
  metal.push(placed(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), lantX, 7.07, 0));
  const hood = [[0.04, Y_TOP + 0.04], [0.09, Y_TOP], [0.2, Y_TOP - 0.05], [0.3, Y_TOP - 0.11], [0.36, Y_RIM + 0.02], [0.37, Y_RIM], [0.3, Y_RIM - 0.01]]
    .map(([rr, yy]) => new THREE.Vector2(rr, yy)).reverse();         // de l'intérieur vers le haut : faces vers l'extérieur
  metal.push(placed(new THREE.LatheGeometry(hood, 24), lantX, 0, 0));
  const globeProf = [[0.001, Y_BOT], [0.08, Y_BOT + 0.03], [0.2, Y_BOT + 0.14], [0.3, Y_BOT + 0.3], [0.33, Y_BOT + 0.44], [0.31, Y_RIM - 0.08], [0.28, Y_RIM]];
  const gpts = globeProf.map(([rr, yy]) => new THREE.Vector2(rr, yy));
  for (let k = 0; k < 6; k++) {                                       // côtes du cerclage, collées au verre
    const a = k / 6 * Math.PI * 2 + 0.26;
    const curve = new THREE.CatmullRomCurve3(globeProf.slice(1).map(([rr, yy]) => new THREE.Vector3(lantX + Math.cos(a) * (rr + 0.012), yy, Math.sin(a) * (rr + 0.012))));
    metal.push(placed(new THREE.TubeGeometry(curve, 14, 0.011, 4), 0, 0, 0));
  }
  metal.push(placed(new THREE.SphereGeometry(0.05, 10, 8), lantX, Y_BOT - 0.03, 0));
  metal.push(placed(new THREE.ConeGeometry(0.03, 0.1, 8), lantX, Y_BOT - 0.12, 0, Math.PI));
  const metalMesh = shadowed(new THREE.Mesh(mergeGeometries(metal), lampPaintMat)); g.add(metalMesh);

  const uK = { value: 1 };                                            // scintillement, partagé globe / cône
  const globeMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(1.36, 0.92, 0.44) }, uY0: { value: Y_BOT }, uY1: { value: Y_RIM } }]),
    vertexShader: globeVS, fragmentShader: globeFS, fog: true,
  });
  globeMat.uniforms.uK = uK;
  const globe = new THREE.Mesh(new THREE.LatheGeometry(gpts, 28), globeMat); globe.position.x = lantX; g.add(globe);
  // neige sur le chapeau
  const cs = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2); cs.scale(0.3, 0.1 + Math.random() * 0.05, 0.3);
  snow.push(placed(cs, lantX, Y_TOP - 0.07, 0));
  const snowMesh = new THREE.Mesh(mergeGeometries(snow.map(s => s.index ? s.toNonIndexed() : s)), MAT.snow); snowMesh.receiveShadow = true; g.add(snowMesh);

  const LAMP_Y = 6.5;                                                 // centre du globe
  // Halo en deux couches : un cœur serré + une large diffusion dans la neige en
  // suspension, comme la glare autour du luminaire sur l'image de référence.
  const halos = [];
  for (const [scale, opacity, col] of [[3.6, 0.18, 0xffc27e], [7.5, 0.06, 0xffc88a]]) {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    h.scale.set(scale, scale, 1); h.position.set(lantX, LAMP_Y, 0); g.add(h);
    halos.push({ sprite: h, base: opacity });
  }
  // cône de lumière (voir coneVS) : sommet au globe, s'ouvre jusqu'au trottoir
  const CONE_H = LAMP_Y - 0.25;
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.1, 0.07, 0.04) }, uH: { value: CONE_H }, uFog: { value: FOG_DENSITY } },   // discret : il ne fait que relier la diffusion au sol
    vertexShader: coneVS, fragmentShader: coneFS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  coneMat.uniforms.uK = uK;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.7, CONE_H, 32, 1, true), coneMat);
  cone.position.set(lantX, LAMP_Y - 0.25 - CONE_H / 2, 0); g.add(cone);
  // diffusion tout autour de la lanterne (voir glowFS)
  const GLOW_R = 4.5;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uCenter: { value: new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z) }, uColor: { value: new THREE.Color(0.3, 0.23, 0.15) }, uR: { value: GLOW_R }, uFog: { value: FOG_DENSITY } },
    vertexShader: glowVS, fragmentShader: glowFS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  glowMat.uniforms.uK = uK;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(GLOW_R, 24, 16), glowMat);
  glow.position.set(lantX, LAMP_Y, 0); glow.frustumCulled = true; g.add(glow);

  // Éclairage : spot chaud vers le trottoir + point doux pour les façades. Ce sont des
  // SOURCES : les vraies lumières (et les ombres) vont aux lampadaires les plus proches du
  // joueur, voir world/lightPool.js.
  const flick = { lights: [], base: [], halos, uK, seed: Math.random() * 10 };
  flickerLights.push(flick);
  addSpotSource({ pos: new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z), target: new THREE.Vector3(x + lantX * 1.4, SIDEWALK_H, z),
    color: new THREE.Color(0xffcc94), intensity: 82, distance: 30, angle: 1.1, penumbra: 0.8, flick });
  // Remplissage : c'est lui qui décolle les façades du noir. Sur la référence, la
  // brique autour de chaque lampadaire est nettement lisible ; sans ce point, on
  // n'a qu'un mur noir et une flaque de lumière au sol.
  addPointSource({ pos: new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y + 0.1, z), color: new THREE.Color(0xffb266), intensity: 14, distance: 24, flick });

  g.position.set(x, SIDEWALK_H, z); scene.add(g);
  // emprise explicite : la boîte du groupe engloberait la sphère de diffusion de 4,5 m
  addSubject({ label: 'Un lampadaire dans la tempête', value: 0.65, glows: true, box: boxAt(x + lantX / 2, z, Math.abs(lantX) / 2 + 0.45, 0.45, SIDEWALK_H, SIDEWALK_H + 7.4) });
  lampPositions.push({ pos: new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z), col: new THREE.Color(0xffcc94).multiplyScalar(0.56) });   // les flocons suivent la baisse des lampes
  addCollider(x, z, 0.38, 0.38);
  addContactShadow(x, z, 1.05, 1.05, 0.5);
  // neige au pied
  buildDrift(x, SIDEWALK_H, z, 0.7, 0.7);
}

function buildTrashCan(x, z, rot) {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.33, 0.98, 20), MAT.trash)); body.position.y = 0.49; g.add(body);
  // cannelures verticales
  for (let k = 0; k < 10; k++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.9, 0.035), MAT.trash);
    const a = (k / 10) * Math.PI * 2; rib.position.set(Math.cos(a) * 0.365, 0.49, Math.sin(a) * 0.365); rib.rotation.y = -a; g.add(rib);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.028, 8, 24), MAT.iron); rim.rotation.x = Math.PI / 2; rim.position.y = 0.98; g.add(rim);
  // tas de neige sur le couvercle : épais et bosselé comme sur la référence (une calotte lisse faisait bonnet)
  const sg = new THREE.SphereGeometry(0.44, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), sp = sg.attributes.position, seed = Math.random() * 20;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i); const k = 1 + (smoothNoise(x * 6 + seed, z * 6) - 0.5) * 0.35 * (y / 0.44); sp.setXYZ(i, x * k, y * k, z * k); }
  sg.computeVertexNormals();
  const snow = new THREE.Mesh(sg, MAT.snow); snow.scale.set(1, 0.75 + Math.random() * 0.4, 1); snow.position.y = 0.95; g.add(snow);
  // coulée de neige sur le côté
  const drip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), MAT.snow); drip.scale.set(0.7, 1.6, 0.5); drip.position.set(0.3, 0.85, 0.15); g.add(drip);
  g.position.set(x, SIDEWALK_H, z); g.rotation.y = rot; scene.add(g);
  addCollider(x, z, 0.42, 0.42);
  addContactShadow(x, z, 0.62, 0.62, 0.55);
}

function buildHydrant(x, z) {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.72, 12), MAT.hydrant)); body.position.y = 0.36; g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 16), MAT.hydrant); ring.rotation.x = Math.PI / 2; ring.position.y = 0.7; g.add(ring);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), MAT.hydrant); top.position.y = 0.76; g.add(top);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.16, 8), MAT.hydrant); cap.position.y = 0.96; g.add(cap);
  for (const s of [-1, 1]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.24, 10), MAT.hydrant); noz.rotation.z = Math.PI / 2; noz.position.set(s * 0.23, 0.52, 0); g.add(noz);
    const nc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.08, 6), MAT.iron); nc.rotation.z = Math.PI / 2; nc.position.set(s * 0.37, 0.52, 0); g.add(nc);
  }
  const snow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow); snow.scale.set(1, 0.55, 1); snow.position.y = 0.86; g.add(snow);
  g.position.set(x, SIDEWALK_H, z); g.rotation.y = Math.PI / 2; scene.add(g);
  addSubject({ label: "Une bouche d'incendie", value: 0.55, box: boxAt(x, z, 0.42, 0.42, SIDEWALK_H, SIDEWALK_H + 1.05) });
  addCollider(x, z, 0.3, 0.3);
  addContactShadow(x, z, 0.5, 0.5, 0.5);
  buildDrift(x, SIDEWALK_H, z, 0.55, 0.55);
}

function buildDrift(x, y, z, sx, sz) {
  // congère bosselée (une demi-sphère lisse faisait oreiller), profil qui s'étale au pied
  const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, seed = Math.random() * 50;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), k = 1 + (smoothNoise(px * 2.5 + seed, pz * 2.5) - 0.5) * 0.4 * py;
    p.setXYZ(i, px * (1 + 0.25 * (1 - py)), Math.pow(py, 1.3) * k, pz * (1 + 0.25 * (1 - py)));
  }
  g.computeVertexNormals();
  const d = new THREE.Mesh(g, MAT.snow);
  d.scale.set(sx, rnd(0.28, 0.55), sz); d.position.set(x, y, z); d.receiveShadow = true; scene.add(d);
}

// Placement
let lampIndex = 0;
for (let z = LAMP_Z0; z < STREET_Z_MAX; z += LAMP_PITCH) {   // grille connue aussi du rebond sur les façades (weathering.js)
  buildLamppost(-(ROAD_HALF + 0.55), z, -1);
  buildLamppost( (ROAD_HALF + 0.55), z + LAMP_PITCH / 2, 1);
  lampIndex++;
}
for (let z = STREET_Z_MIN + 3; z < STREET_Z_MAX; z += rnd(8, 15)) {
  const side = Math.random() < 0.5 ? -1 : 1, n = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const zk = z + k * 0.85;
    if (doorGap(side, zk) < 0.45) continue;                    // jamais dans les marches d'un perron ni devant une porte
    buildTrashCan(side * (FACADE_X - 0.6 - (k % 2) * 0.1), zk, Math.random() * 6);
  }
}
for (let z = STREET_Z_MIN + 12; z < STREET_Z_MAX; z += 26) { buildHydrant(-(ROAD_HALF + 0.75), z); buildHydrant((ROAD_HALF + 0.75), z + 13); }
for (let z = STREET_Z_MIN; z < STREET_Z_MAX; z += rnd(2.5, 6)) {
  for (const s of [-1, 1]) {
    // congère raccourcie pour s'arrêter avant un perron ou une porte (elle s'étale sur ~1,25 × sz)
    const gap = doorGap(s, z), sz = Math.min(rnd(1.5, 3.8), gap / 1.3);
    if (sz > 0.6) buildDrift(s * (FACADE_X - 0.25), SIDEWALK_H + 0.12, z, rnd(0.8, 1.8), sz);
  }
}
// Panneau de stationnement + parcmètre
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), MAT.metal); pole.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.4, -2); scene.add(pole);
  const sign = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.95, 0.5), new THREE.MeshStandardMaterial({ color: 0xd4dae2, roughness: 0.5 })));
  sign.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 2.35, -2); scene.add(sign);
  const red = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xc02020 })); red.position.set(ROAD_HALF + 0.57, SIDEWALK_H + 2.5, -2); red.rotation.y = -Math.PI / 2; scene.add(red);
  addCollider(ROAD_HALF + 0.6, -2, 0.12, 0.12);
  addContactShadow(ROAD_HALF + 0.6, -2, 0.3, 0.3, 0.45);
  const meter = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.14), MAT.iron)); meter.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.25, 7.5); scene.add(meter);
  const mp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 8), MAT.metal); mp.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 0.52, 7.5); scene.add(mp);
  const ms = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.14), MAT.snow); ms.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.49, 7.5); scene.add(ms);
  addCollider(ROAD_HALF + 0.6, 7.5, 0.15, 0.15);
  addContactShadow(ROAD_HALF + 0.6, 7.5, 0.3, 0.3, 0.45);
}
