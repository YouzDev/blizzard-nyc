import { FACADE_X, STREET_Z_MAX, CROSS_Z, LEFT_END_X, RIGHT_END_X, AREA_W } from '../core/constants.js';

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
// Murs : les façades (plans x = ±FACADE_X de la rue principale, z = CROSS_Z ± FACADE_X de la
// transversale — dans la rue de droite, ce sont les grilles des cours anglaises), le fond de
// l'impasse de gauche et l'entrée du parc (grille fermée) ; derrière le départ, une limite à z = STREET_Z_MAX + 2.
{
  const near = CROSS_Z + FACADE_X, far = CROSS_Z - FACADE_X, x0 = LEFT_END_X - 20, x1 = RIGHT_END_X + 30;
  addCollider(-FACADE_X - 10, (near + 200) / 2, 10, (200 - near) / 2);          // gauche de la rue principale, jusqu'au coin
  addCollider( FACADE_X + 10, (near + 200) / 2, 10, (200 - near) / 2);          // droite de la rue principale, jusqu'au coin
  addCollider(0, STREET_Z_MAX + 2, 40, 2);                                      // derrière le départ
  addCollider((x0 - FACADE_X) / 2, near + 10, (-FACADE_X - x0) / 2, 10);        // rue de gauche, côté feux
  // Rue de droite : les murs sont les FAÇADES des brownstones, reculées de AREA_W ; les cours
  // anglaises entre la grille et la maison sont fermées maison par maison (brownstones.js), sauf
  // le couloir de chaque perron : on monte jusqu'à la porte.
  addCollider((FACADE_X + x1) / 2, near + AREA_W + 10, (x1 - FACADE_X) / 2, 10);   // rue de droite, côté feux
  addCollider(FACADE_X + 7, near + AREA_W / 2, 7, AREA_W / 2);                    // côté de l'immeuble d'angle de la rue principale
  addCollider((x0 + FACADE_X) / 2, far - 10, (FACADE_X - x0) / 2, 10);           // en face : rue de gauche, fond du T
  addCollider((FACADE_X + x1) / 2, far - AREA_W - 10, (x1 - FACADE_X) / 2, 10);  // en face : rue de droite
  addCollider(LEFT_END_X - 10, CROSS_Z, 10, FACADE_X + 10);                     // fond de l'impasse
  addCollider(RIGHT_END_X + 10, CROSS_Z, 10, FACADE_X + 10);                    // entrée du parc
}

export const shadowCasters = [];
export function shadowed(mesh, cast = true, receive = true) { mesh.castShadow = cast; mesh.receiveShadow = receive; return mesh; }
