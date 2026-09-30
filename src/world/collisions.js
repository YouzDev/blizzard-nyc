import { FACADE_X, STREET_Z_MIN, STREET_Z_MAX } from '../core/constants.js';

/* =====================================================================
   4. COLLISIONS (AABB au sol)
   ===================================================================== */
export const colliders = [];
export function addCollider(cx, cz, hw, hd) { colliders.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd }); }
export function collides(x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX)), nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
/** Remet le cercle (x, z, r) hors de tout obstacle qu'il chevauche, par la plus
 *  petite poussée possible. Filet de sécurité appelé après CHAQUE déplacement de la
 *  caméra (marche, balancement des pas) : un joueur ne peut plus « être dedans »,
 *  donc plus de garde-fou « déjà coincé → mouvement libre » à exploiter pour traverser.
 *  Quelques itérations suffisent pour les coins où deux boîtes se touchent. */
export function pushOut(p, r) {
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const c of colliders) {
      const nx = Math.max(c.minX, Math.min(p.x, c.maxX)), nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      let dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {                                   // centre hors de la boîte : on s'écarte du point le plus proche
        const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k;
      } else {                                           // centre dans la boîte : on sort par la face la plus proche
        const ex = [p.x - c.minX + r, c.maxX - p.x + r], ez = [p.z - c.minZ + r, c.maxZ - p.z + r];
        const m = Math.min(ex[0], ex[1], ez[0], ez[1]);
        if (m === ex[0]) p.x -= ex[0]; else if (m === ex[1]) p.x += ex[1]; else if (m === ez[0]) p.z -= ez[0]; else p.z += ez[1];
      }
      moved = true;
    }
    if (!moved) return;
  }
}
addCollider(-FACADE_X - 10, 0, 10, 200);
addCollider( FACADE_X + 10, 0, 10, 200);
addCollider(0, STREET_Z_MIN - 2, 40, 2);
addCollider(0, STREET_Z_MAX + 2, 40, 2);

export const shadowCasters = [];
export function shadowed(mesh, cast = true, receive = true) { mesh.castShadow = cast; mesh.receiveShadow = receive; return mesh; }
