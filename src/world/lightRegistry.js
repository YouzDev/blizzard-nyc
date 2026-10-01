/* =====================================================================
   6 bis. REGISTRE DES SOURCES LUMINEUSES
   Rempli par les lampadaires (section 7) et le néon (section 9), lu par le
   shader des flocons (section 11) et par la boucle (section 14).
   ===================================================================== */

export const flickerLights = [];
export const lampPositions = [];       // pour éclairer les flocons dans le shader

/* Sources « virtuelles » : lampadaires, lanternes d'entrée, lumières de boutique. Elles ne
   créent PAS de lumière Three : seules les plus proches du joueur reçoivent une des vraies
   lumières, en nombre fixe, de world/lightPool.js. Le nombre de lumières reste donc le même
   quelle que soit la taille de la ville (texte des shaders constant, cache du navigateur
   valable, coût par pixel constant).
   Champs : pos (Vector3, monde), color (Color), intensity (cd), distance (portée, m), decay,
   flick (entrée de flickerLights dont on lit .k, ou null) ; projecteurs en plus : target
   (Vector3, monde), angle, penumbra. */
export const pointSources = [];
export const spotSources = [];
export function addPointSource(s) { pointSources.push({ decay: 2, flick: null, ...s, slot: null }); }
export function addSpotSource(s) { spotSources.push({ decay: 2, flick: null, ...s, slot: null }); }
