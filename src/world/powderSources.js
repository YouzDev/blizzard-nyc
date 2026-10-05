/* =====================================================================
   7 quinquies. D'OÙ LA NEIGE PEUT ÊTRE SOUFFLÉE
   Rempli par les modules du décor au moment où ils construisent (coordonnées MONDE) :
   - corniches : segment a → b le long du rebord enneigé (immeubles, brownstones) ;
   - arbres : centre de la couronne et rayon (arbres de la rue de droite, du parc).
   Lu par fx/powder.js, qui en fait tomber des paquets de neige pendant les rafales.
   ===================================================================== */
export const powderCornices = [];   // { a: Vector3, b: Vector3 }
export const powderTrees = [];      // { c: Vector3, r }
export function addPowderCornice(a, b) { powderCornices.push({ a, b }); }
export function addPowderTree(c, r) { powderTrees.push({ c, r }); }
