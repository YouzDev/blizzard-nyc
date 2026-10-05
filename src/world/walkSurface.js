/* =====================================================================
   4 bis. SURFACES PRATICABLES HORS DU SOL
   Le sol (ground.js) donne la hauteur de la neige partout ; certaines zones ont leur propre
   surface sous les pieds : les perrons des brownstones (on monte jusqu'aux portes), l'escalier
   du métro (on descend jusqu'à la grille). Chaque zone : une boîte MONDE (x0, x1, z0, z1) et
   y(x, z) → hauteur de la surface (neige comprise), ou null hors de la partie praticable.
   Lues par les contrôles (hauteur des yeux) et par les traces de pas.
   ===================================================================== */
export const walkZones = [];
/** { x0, x1, z0, z1, y(x, z), stairs } ; stairs : on y ralentit (marches). */
export function addWalkZone(z) { walkZones.push(z); return z; }
/** Zone touchée par le dernier appel à walkZoneY (ou null). */
export let walkZoneHit = null;
/** Hauteur de la surface praticable en (x, z) monde, ou null si aucune zone ne s'y trouve. */
export function walkZoneY(x, z) {
  for (const w of walkZones) {
    if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
    const y = w.y(x, z);
    if (y !== null) { walkZoneHit = w; return y; }
  }
  walkZoneHit = null;
  return null;
}
