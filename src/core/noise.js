/* =====================================================================
   0 bis. BRUIT ET ALÉA
   ===================================================================== */

// petit bruit lisse en JS (déformation du sol)
export function hash1(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash1(ix, iy), b = hash1(ix + 1, iy), c = hash1(ix, iy + 1), d = hash1(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export const rnd = (a, b) => a + Math.random() * (b - a);
