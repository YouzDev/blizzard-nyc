import * as THREE from 'three';

/* =====================================================================
   1 quinquies. ÉCLAIRAGE EN BOUCLE (shaders compacts, image identique)
   Three.js r160 écrit le calcul de CHAQUE lumière en toutes lettres dans chaque
   shader (« #pragma unroll_loop_start » : la boucle est recopiée autant de fois qu'il
   y a de lumières). Avec 36 PointLight + 17 SpotLight, chaque matériau standard
   contenait 53 copies du même calcul : les 81 shaders étaient énormes, longs à
   compiler et à préparer au premier dessin (l'essentiel du temps de chargement).

   On remplace ce morceau (ShaderChunk.lights_fragment_begin) AVANT toute compilation :
     - les lumières qui projettent une ombre (ici les 7 projecteurs des lampadaires
       proches + aucune PointLight) restent recopiées : lire une carte d'ombre exige
       un indice constant ;
     - toutes les autres passent dans une VRAIE boucle, une seule copie du calcul ;
     - la boucle saute une lumière au-delà de sa portée (`distance`) : Three y
       multiplie déjà sa contribution par zéro (atténuation coupée), le résultat est
       donc le même, mais le pixel ne paie plus le calcul de 46 lumières lointaines.
   Même fonctions (getPointLightInfo, getSpotLightInfo, RE_Direct), même ordre : même image.
   Three range les lumières à ombre en premier : elles occupent les indices
   0 … NUM_*_SHADOWS − 1, la boucle prend la suite.
   Non géré : les projecteurs à texture (SpotLight.map) — le shader refuserait de
   compiler avec un message clair (#error) si on en ajoutait un.

   Mesures / tests (URL) : ?lightloop=0 remet le morceau d'origine ; ?lightcompare
   compile les deux versions (bascule par le define BLZ_LIGHTS_ORIGINAL) pour comparer
   l'image pixel par pixel ; ?shaderbust=xxx change le texte des shaders, donc force
   une vraie « première visite » (le navigateur garde les shaders compilés en cache).
   ===================================================================== */
const LIGHTS_ORIGINAL = THREE.ShaderChunk.lights_fragment_begin;

const POINT_BLOCK = `#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
	#define BLZ_POINT_FIRST NUM_POINT_LIGHT_SHADOWS
	#else
	#define BLZ_POINT_FIRST 0
	#endif
	for ( int i = BLZ_POINT_FIRST; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		vec3 blzL = pointLight.position - geometryPosition;
		if ( pointLight.distance > 0.0 && dot( blzL, blzL ) >= pointLight.distance * pointLight.distance ) continue;
		getPointLightInfo( pointLight, geometryPosition, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#undef BLZ_POINT_FIRST
#endif
`;

const SPOT_BLOCK = `#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	#if NUM_SPOT_LIGHT_MAPS > 0
	#error lightLoop: SpotLight.map is not supported by the compact light loop
	#endif
	SpotLight spotLight;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
	#define BLZ_SPOT_FIRST NUM_SPOT_LIGHT_SHADOWS
	#else
	#define BLZ_SPOT_FIRST 0
	#endif
	for ( int i = BLZ_SPOT_FIRST; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		vec3 blzS = spotLight.position - geometryPosition;
		if ( spotLight.distance > 0.0 && dot( blzS, blzS ) >= spotLight.distance * spotLight.distance ) continue;
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#undef BLZ_SPOT_FIRST
#endif
`;

/** Morceau d'origine avec les deux blocs remplacés ; null si Three a changé (on garde l'origine). */
function compactChunk(src) {
  const p0 = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const s0 = src.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
  const d0 = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  if (p0 < 0 || s0 < p0 || d0 < s0) return null;
  return src.slice(0, p0) + POINT_BLOCK + SPOT_BLOCK + src.slice(d0);
}

const lightParams = new URLSearchParams(location.search);
const compact = compactChunk(LIGHTS_ORIGINAL);
if (!compact) console.warn('lightLoop : morceau lights_fragment_begin inattendu (version de Three ?), éclairage d\'origine conservé');
export const lightLoop = {
  mode: !compact || lightParams.get('lightloop') === '0' ? 'origine' : lightParams.has('lightcompare') ? 'comparaison' : 'boucle',
  original: LIGHTS_ORIGINAL, compact,
};
let lightChunk = lightLoop.mode === 'origine' ? LIGHTS_ORIGINAL
  : lightLoop.mode === 'comparaison' ? `#ifdef BLZ_LIGHTS_ORIGINAL\n${LIGHTS_ORIGINAL}\n#else\n${compact}\n#endif\n`
  : compact;
if (lightParams.has('shaderbust')) lightChunk += `\n// shaderbust ${String(lightParams.get('shaderbust')).replace(/[^\w-]/g, '')}\n`;
THREE.ShaderChunk.lights_fragment_begin = lightChunk;

/* --- Nombre de lumières FIXE, pour que le navigateur réutilise ses shaders d'une visite à l'autre.
   Le nombre de PointLight est écrit dans le texte de chaque shader (NUM_POINT_LIGHTS). Or il
   varie d'une rue à l'autre (lanternes d'entrée, boutiques ouvertes, enseignes allumées, tirées
   au hasard : 36, 38…) : chaque visite tombait sur un autre texte, le cache de shaders du
   navigateur ne servait jamais, et la 2e visite était aussi lente que la 1re. On complète donc
   jusqu'à un nombre fixe avec des lumières ÉTEINTES (noires, intensité 0, portée minuscule,
   loin sous le sol) : la boucle les écarte au premier test, elles n'éclairent rien.
   Au-delà de POINT_LIGHT_SLOTS (rue exceptionnelle), on arrondit au multiple de 8 suivant :
   seule une telle rue recompile. Les SpotLight (16 lampadaires + néon) sont en nombre fixe. */
export const POINT_LIGHT_SLOTS = 48;
export function padPointLights(scene) {
  let n = 0;
  scene.traverse(o => { if (o.isPointLight) n++; });
  const target = n <= POINT_LIGHT_SLOTS ? POINT_LIGHT_SLOTS : Math.ceil(n / 8) * 8;
  for (let i = n; i < target; i++) {
    const l = new THREE.PointLight(0x000000, 0, 0.001, 2);
    l.position.set(0, -1000, 0); l.name = 'lumiere-de-remplissage';
    scene.add(l);
  }
  return { avant: n, apres: target };
}
