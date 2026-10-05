import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF, FACADE_X, SIDEWALK_H, STREET_Z_MIN, STREET_Z_MAX, FOG_DENSITY, LAMP_Z0, LAMP_PITCH, CROSS_Z, LEFT_END_X } from '../core/constants.js';
import { rnd, smoothNoise } from '../core/noise.js';
import { lampPaint, glowTex } from '../textures/index.js';
import { usePhoto } from '../textures/photo.js';
import { MAT } from './materials.js';
import { shadowed } from './collisions.js';
import { flickerLights, lampPositions, addPointSource, addSpotSource } from './lightRegistry.js';
import { addContactShadowIn } from './contactShadows.js';
import { doorGap, paintMat } from './buildings.js';
import { addSubject, boxAt } from '../game/subjects.js';
import { MAIN, LEFT, LEFT_END, RIGHT } from './street.js';
import { brownHouses, BS_ROW_END } from './brownstones.js';
import { addParkingSign, flushParkingSigns } from './streetSigns.js';
import { makeNewsBoxTexture, NEWS_BOXES } from '../textures/streetSigns.js';

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

export function buildLamppost(st, x, z, side) {
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
    uniforms: { uCenter: { value: st.toWorld(new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z)) }, uColor: { value: new THREE.Color(0.3, 0.23, 0.15) }, uR: { value: GLOW_R }, uFog: { value: FOG_DENSITY } },
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
  addSpotSource({ pos: st.toWorld(new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z)), target: st.toWorld(new THREE.Vector3(x + lantX * 1.4, SIDEWALK_H, z)),
    color: new THREE.Color(0xffcc94), intensity: 82, distance: 30, angle: 1.1, penumbra: 0.8, flick });
  // Remplissage : c'est lui qui décolle les façades du noir. Sur la référence, la
  // brique autour de chaque lampadaire est nettement lisible ; sans ce point, on
  // n'a qu'un mur noir et une flaque de lumière au sol.
  addPointSource({ pos: st.toWorld(new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y + 0.1, z)), color: new THREE.Color(0xffb266), intensity: 14, distance: 24, flick });

  g.position.set(x, SIDEWALK_H, z); st.add(g);
  // emprise explicite : la boîte du groupe engloberait la sphère de diffusion de 4,5 m
  addSubject({ label: 'Un lampadaire dans la tempête', value: 0.65, glows: true, box: st.box(boxAt(x + lantX / 2, z, Math.abs(lantX) / 2 + 0.45, 0.45, SIDEWALK_H, SIDEWALK_H + 7.4)) });
  lampPositions.push({ pos: st.toWorld(new THREE.Vector3(x + lantX, SIDEWALK_H + LAMP_Y, z)), col: new THREE.Color(0xffcc94).multiplyScalar(0.56) });   // les flocons suivent la baisse des lampes
  st.collider(x, z, 0.38, 0.38);
  addContactShadowIn(st, x, z, 1.05, 1.05, 0.5);
  // neige au pied
  buildDrift(st, x, SIDEWALK_H, z, 0.7, 0.7);
}

function buildTrashCan(st, x, z, rot) {
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
  g.position.set(x, SIDEWALK_H, z); g.rotation.y = rot; st.add(g);
  st.collider(x, z, 0.42, 0.42);
  addContactShadowIn(st, x, z, 0.62, 0.62, 0.55);
}

function buildHydrant(st, x, z) {
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
  g.position.set(x, SIDEWALK_H, z); g.rotation.y = Math.PI / 2; st.add(g);
  addSubject({ label: "Une bouche d'incendie", value: 0.55, box: st.box(boxAt(x, z, 0.42, 0.42, SIDEWALK_H, SIDEWALK_H + 1.05)) });
  st.collider(x, z, 0.3, 0.3);
  addContactShadowIn(st, x, z, 0.5, 0.5, 0.5);
  buildDrift(st, x, SIDEWALK_H, z, 0.55, 0.55);
}

export function buildDrift(st, x, y, z, sx, sz, sy = rnd(0.28, 0.55)) {
  // congère bosselée (une demi-sphère lisse faisait oreiller), profil qui s'étale au pied
  const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, seed = Math.random() * 50;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), k = 1 + (smoothNoise(px * 2.5 + seed, pz * 2.5) - 0.5) * 0.4 * py;
    p.setXYZ(i, px * (1 + 0.25 * (1 - py)), Math.pow(py, 1.3) * k, pz * (1 + 0.25 * (1 - py)));
  }
  g.computeVertexNormals();
  const d = new THREE.Mesh(g, MAT.snow);
  d.scale.set(sx, sy, sz); d.position.set(x, y, z); d.receiveShadow = true; st.add(d);
}

// Placement, rue par rue (repère de la rue). `sides` : pour chaque côté, l'étendue le long de la
// rue où poser lampadaires, poubelles, bouches d'incendie et congères de façade.
/** Lampadaires de la grille LAMP_Z0 / LAMP_PITCH (côté +1 décalé d'un demi-pas) : c'est aussi elle
 *  que le rebond sur les façades suppose (weathering.js), dans le repère de chaque rue. */
function furnishStreet(st, sides) {
  for (const s of [-1, 1]) {
    const S = sides[s < 0 ? 0 : 1], [l0, l1] = S.lamps;
    const first = LAMP_Z0 + (s > 0 ? LAMP_PITCH / 2 : 0);
    for (let z = first + LAMP_PITCH * Math.ceil((l0 - first) / LAMP_PITCH); z < l1; z += LAMP_PITCH) {
      buildLamppost(st, s * (ROAD_HALF + 0.55), z, s);
      if (Math.random() < 0.5) addParkingSign(st, s * (ROAD_HALF + 0.55), z);   // panneau de stationnement (streetSigns.js)
    }
  }
  for (const s of [-1, 1]) {
    const S = sides[s < 0 ? 0 : 1], [w0, w1] = S.wall;
    for (let z = w0 + 3; z < w1; z += rnd(8, 15)) {
      if (Math.random() < 0.5) continue;                           // un côté sur deux en moyenne, comme avant
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const zk = z + k * 0.85;
        if (zk > w1 - 0.5 || doorGap(st, s, zk) < 0.45) continue;  // jamais dans les marches d'un perron ni devant une porte
        buildTrashCan(st, s * (FACADE_X - 0.6 - (k % 2) * 0.1), zk, Math.random() * 6);
      }
    }
    for (const z of S.hydrants) buildHydrant(st, s * (ROAD_HALF + 0.75), z);
    for (let z = w0; z < w1; z += rnd(2.5, 6)) {
      // congère raccourcie pour s'arrêter avant un perron ou une porte (elle s'étale sur ~1,25 × sz)
      const gap = Math.min(doorGap(st, s, z), (w1 - z) * 2, (z - w0) * 2), sz = Math.min(rnd(1.5, 3.8), gap / 1.3);
      if (sz > 0.6) buildDrift(st, s * (FACADE_X - 0.25), SIDEWALK_H + 0.12, z, rnd(0.8, 1.8), sz);
    }
  }
}
const hydrantsEvery = (z0, z1, offset) => { const out = []; for (let z = z0 + offset; z < z1; z += 26) out.push(z); return out; };

// Rue principale : à gauche, le mobilier s'arrête au coin (pas de façade au-delà) ; à droite il
// longe la rangée jusqu'au trottoir d'en face de la transversale.
furnishStreet(MAIN, [
  { lamps: [STREET_Z_MIN, STREET_Z_MAX], wall: [CROSS_Z + FACADE_X, STREET_Z_MAX], hydrants: hydrantsEvery(STREET_Z_MIN, STREET_Z_MAX, 12) },
  { lamps: [STREET_Z_MIN, STREET_Z_MAX + LAMP_PITCH / 2], wall: [CROSS_Z + FACADE_X, STREET_Z_MAX], hydrants: hydrantsEvery(STREET_Z_MIN, STREET_Z_MAX, 25) },
]);
// Rue de gauche : rien dans le carrefour ; côté feux jusqu'à l'angle de l'immeuble du coin, en
// face jusqu'au fond du T.
furnishStreet(LEFT, [
  { lamps: [LEFT_END_X + 3, -FACADE_X - 2], wall: [LEFT_END_X + 0.5, -FACADE_X - 0.5], hydrants: hydrantsEvery(LEFT_END_X, -FACADE_X - 4, 12) },
  { lamps: [LEFT_END_X + 3, ROAD_HALF - 2], wall: [LEFT_END_X + 0.5, FACADE_X - 0.5], hydrants: hydrantsEvery(LEFT_END_X, ROAD_HALF - 4, 25) },
]);
// Rue de droite (brownstones) : le long des grilles des cours, rien dans le carrefour ni devant le parc.
furnishStreet(RIGHT, [
  { lamps: [BS_ROW_END + 2, -FACADE_X - 2], wall: [BS_ROW_END + 0.5, -FACADE_X - 0.5], hydrants: hydrantsEvery(BS_ROW_END, -FACADE_X - 4, 7) },
  { lamps: [BS_ROW_END + 2, -FACADE_X - 2], wall: [BS_ROW_END + 0.5, -FACADE_X - 0.5], hydrants: hydrantsEvery(BS_ROW_END, -FACADE_X - 4, 19) },
]);
flushParkingSigns();
// Poubelles rangées dans les cours anglaises, derrière la grille (une maison sur deux)
for (const h of brownHouses) {
  if (Math.random() < 0.5 || h.free[1] - h.free[0] < 0.9) continue;
  const n = 1 + (Math.random() < 0.5 ? 1 : 0), z = rnd(h.free[0], h.free[1] - 0.85 * (n - 1));
  for (let k = 0; k < n; k++) buildTrashCan(RIGHT, h.side * (FACADE_X + 0.75), z + k * 0.85, Math.random() * 6);
}
/* Boîtes à journaux et boîte aux lettres (demande utilisateur : « l'esprit New York ») : la rangée de
   distributeurs de couleur au bord du trottoir, tournés vers les passants (noms de journaux inventés),
   et la boîte aux lettres bleue à dôme sur ses quatre pieds (sans logo). Ensevelies : dôme de neige
   sur chaque toit, congère au pied de la rangée. */
// peinture mate (non métallique : sous un ciel de nuit, un métal ne renvoie presque rien) ; la face
// imprimée garde une très faible lueur propre pour se lire hors des flaques de lumière
const newsTex = makeNewsBoxTexture(), newsFaceMat = new THREE.MeshStandardMaterial({ map: newsTex, roughness: 0.45, metalness: 0.05, emissiveMap: newsTex, emissive: new THREE.Color(0.16, 0.16, 0.16) });
const newsColors = NEWS_BOXES.map(([, c]) => paintMat(new THREE.Color(c).getHex(), 0.5, 0.05));
const mailMat = paintMat(0x1c3578, 0.45, 0.35);
/** Rangée de n boîtes à journaux le long de la rue (repère de st), au bord du trottoir du côté side, à partir de z0. */
function buildNewsBoxes(st, side, x, z0, n) {
  const W = 0.5, face = side;                                   // face avant tournée vers les façades
  const order = NEWS_BOXES.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, n);
  order.forEach((k, i) => {
    const z = z0 + i * (W + 0.06), g = new THREE.Group();
    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, W), newsColors[k])); body.position.y = 0.63; g.add(body);
    const ped = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), MAT.metal)); ped.position.y = 0.16; g.add(ped);
    const lid = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, W + 0.04), newsColors[k])); lid.position.y = 0.97; g.add(lid);
    // face avant : la case de la planche (UV)
    const fg = new THREE.PlaneGeometry(W - 0.04, 0.58), uv = fg.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setX(j, (k + uv.getX(j)) / NEWS_BOXES.length);
    const fm = new THREE.Mesh(fg, newsFaceMat); fm.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2; fm.position.set(face * 0.212, 0.64, 0); g.add(fm);
    const sn = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow); sn.scale.set(0.8, 0.4 + Math.random() * 0.25, 0.92); sn.position.y = 0.99; g.add(sn);
    g.position.set(x, SIDEWALK_H, z); g.rotation.y = (Math.random() - 0.5) * 0.08; st.add(g);
  });
  const L = n * (W + 0.06), zc = z0 + (L - W - 0.06) / 2;
  buildDrift(st, x, SIDEWALK_H, zc, 0.5, L / 2 + 0.2, rnd(0.2, 0.32));
  st.collider(x, zc, 0.3, L / 2);
  addContactShadowIn(st, x, zc, 0.55, L / 2 + 0.2, 0.5);
  addSubject({ label: 'Les distributeurs de journaux sous la neige', value: 0.5, box: st.box(boxAt(x, zc, 0.3, L / 2, SIDEWALK_H, SIDEWALK_H + 1.2)) });
}
/** Boîte aux lettres bleue : caisse, dôme, quatre pieds, trappe ; neige sur le dôme. */
function buildMailbox(st, side, x, z) {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.52), mailMat)); body.position.y = 0.72; g.add(body);
  const dome = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 18, 1, false, 0, Math.PI), mailMat)); dome.rotation.z = Math.PI / 2; dome.position.y = 1.08; g.add(dome);
  for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), mailMat); leg.position.set(a * 0.21, 0.18, b * 0.22); g.add(leg); }
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.34), MAT.metal); flap.position.set(side * 0.265, 0.98, 0); flap.rotation.z = side * 0.25; g.add(flap);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6 })); plate.position.set(side * 0.256, 0.62, 0); g.add(plate);
  const sn = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow); sn.scale.set(0.9, 0.55, 0.95); sn.position.y = 1.2; g.add(sn);
  g.position.set(x, SIDEWALK_H, z); st.add(g);
  buildDrift(st, x, SIDEWALK_H, z, 0.42, 0.42, 0.2);
  st.collider(x, z, 0.32, 0.32);
  addContactShadowIn(st, x, z, 0.45, 0.45, 0.55);
  addSubject({ label: 'Une boîte aux lettres ensevelie', value: 0.5, box: st.box(boxAt(x, z, 0.3, 0.3, SIDEWALK_H, SIDEWALK_H + 1.4)) });
}
// au coin de la rue principale (trottoir de droite, avant le carrefour), près du départ (trottoir de
// gauche), et devant la bodega de la rue de gauche, à côté de la bouche de métro
buildNewsBoxes(MAIN, 1, ROAD_HALF + 0.85, CROSS_Z + FACADE_X + 2.6, 4); buildMailbox(MAIN, 1, ROAD_HALF + 0.85, CROSS_Z + FACADE_X + 5.4);
buildNewsBoxes(MAIN, -1, -(ROAD_HALF + 0.85), 4.2, 3); buildMailbox(MAIN, -1, -(ROAD_HALF + 0.85), 6.4);
buildMailbox(LEFT, -1, -(ROAD_HALF + 0.85), -22.9);

/* Sacs-poubelle sous la neige au bord du trottoir (rue de droite, demande utilisateur) : à New York
   les sacs attendent le ramassage en tas contre la bordure, et la tempête les a ensevelis. Sacs noirs
   surtout, quelques sacs de recyclage bleutés ; chacun déformé (bas écrasé, haut noué), un dôme de
   neige dessus, une congère autour du tas. Entre les lampadaires et les arbres, jamais devant une
   bouche d'incendie. Fusionnés par couleur pour toute la rue. */
const bagGeoms = new Map(), bagSnow = [];
function bagGeo(r, seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (smoothNoise(x * 2.2 + seed, z * 2.2 + y) - 0.5) * 0.35;           // plis du plastique
    y = y < 0 ? y * 0.45 : y * (1 + 0.25 * Math.max(0, 1 - Math.hypot(x, z) * 1.6)); // posé (bas écrasé), haut pincé
    p.setXYZ(i, x * k * r, (y + 0.45) * k * r * 0.8, z * k * r);
  }
  g.computeVertexNormals(); return g;
}
function buildBagHeap(st, x, z, len) {
  const n = Math.max(2, Math.round(len / 0.42));
  for (let k = 0; k < n; k++) {
    const r = rnd(0.24, 0.34), color = Math.random() < 0.8 ? 0x0b0b0d : Math.random() < 0.5 ? 0x4c6a86 : 0x1e2a20;
    const bx = x + rnd(-0.18, 0.18), bz = z - len / 2 + (k + 0.5) * len / n + rnd(-0.08, 0.08), by = SIDEWALK_H + 0.02 + (k % 3 === 1 ? 0.2 : 0);
    const rot = new THREE.Matrix4().makeRotationY(Math.random() * 6.28).setPosition(bx, by, bz), seed = Math.random() * 40;
    if (!bagGeoms.has(color)) bagGeoms.set(color, []);
    bagGeoms.get(color).push(bagGeo(r, seed).applyMatrix4(rot));
    const knot = new THREE.ConeGeometry(0.05, 0.12, 6); knot.translate(0, r * 1.45, 0); bagGeoms.get(color).push(knot.applyMatrix4(rot).toNonIndexed());
    // dôme de neige sur le dessus du sac
    const cap = new THREE.SphereGeometry(r * 0.92, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4); cap.scale(1, 0.55, 1); cap.translate(0, r * 0.75, 0); bagSnow.push(cap.applyMatrix4(rot));
  }
  buildDrift(st, x, SIDEWALK_H, z, 0.62, len / 2 + 0.3, rnd(0.18, 0.3));
  st.collider(x, z, 0.45, len / 2 + 0.15);
  addContactShadowIn(st, x, z, 0.7, len / 2 + 0.35, 0.55);
}
{
  const hyd = [...hydrantsEvery(BS_ROW_END, -FACADE_X - 4, 7), ...hydrantsEvery(BS_ROW_END, -FACADE_X - 4, 19)];
  for (const s of [-1, 1]) {
    const first = LAMP_Z0 + (s > 0 ? LAMP_PITCH / 2 : 0);
    for (let z = first + LAMP_PITCH * Math.ceil((BS_ROW_END - first) / LAMP_PITCH); z < -FACADE_X; z += LAMP_PITCH) for (const q of [0.25, 0.75]) {
      const zb = z + q * LAMP_PITCH, len = rnd(1.0, 2.2);
      if (Math.random() > 0.42 || zb - len / 2 < BS_ROW_END + 2 || zb + len / 2 > -FACADE_X - 3 || hyd.some(h => Math.abs(h - zb) < len / 2 + 1)) continue;
      buildBagHeap(RIGHT, s * (ROAD_HALF + 0.78), zb, len);
    }
  }
  for (const [c, l] of bagGeoms) RIGHT.add(shadowed(new THREE.Mesh(mergeGeometries(l.map(g => g.index ? g.toNonIndexed() : g)), paintMat(c, 0.3, 0))));
  if (bagSnow.length) { const m = new THREE.Mesh(mergeGeometries(bagSnow.map(g => g.index ? g.toNonIndexed() : g)), MAT.snow); m.receiveShadow = true; RIGHT.add(m); }
}

// Fond de l'impasse : la neige que les chasse-neige ont poussée contre les façades, une
// longue congère d'un trottoir à l'autre (la chaussée arrive au pied des immeubles).
for (let lx = -FACADE_X + 0.6; lx < FACADE_X - 0.4; lx += rnd(1.3, 2.1)) {
  if (doorGap(LEFT_END, -1, LEFT.wz(lx, 0)) < 0.5) continue;      // devant les portes : passage dégagé à la pelle
  const onRoad = Math.abs(lx) < ROAD_HALF;
  buildDrift(LEFT, lx, onRoad ? 0.08 : SIDEWALK_H + 0.1, LEFT_END_X + 0.9, rnd(1.0, 1.7), rnd(1.1, 1.6), onRoad ? rnd(0.65, 1.1) : rnd(0.4, 0.7));
}
LEFT.collider(0, LEFT_END_X + 0.9, FACADE_X, 1.1);

// Panneau de stationnement + parcmètre (rue principale, à droite du départ)
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), MAT.metal); pole.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.4, -2); MAIN.add(pole);
  const sign = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.95, 0.5), new THREE.MeshStandardMaterial({ color: 0xd4dae2, roughness: 0.5 })));
  sign.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 2.35, -2); MAIN.add(sign);
  const red = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xc02020 })); red.position.set(ROAD_HALF + 0.57, SIDEWALK_H + 2.5, -2); red.rotation.y = -Math.PI / 2; MAIN.add(red);
  MAIN.collider(ROAD_HALF + 0.6, -2, 0.12, 0.12);
  addContactShadowIn(MAIN, ROAD_HALF + 0.6, -2, 0.3, 0.3, 0.45);
  const meter = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.14), MAT.iron)); meter.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.25, 7.5); MAIN.add(meter);
  const mp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 8), MAT.metal); mp.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 0.52, 7.5); MAIN.add(mp);
  const ms = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.14), MAT.snow); ms.position.set(ROAD_HALF + 0.6, SIDEWALK_H + 1.49, 7.5); MAIN.add(ms);
  MAIN.collider(ROAD_HALF + 0.6, 7.5, 0.15, 0.15);
  addContactShadowIn(MAIN, ROAD_HALF + 0.6, 7.5, 0.3, 0.3, 0.45);
}
