/* =====================================================================
   4 ter. PORTES OÙ L'ON PEUT ENTRER
   Registre rempli par le décor (pour l'instant une seule : la brownstone la plus proche du carrefour,
   dans la rue de droite, qui mène à son balcon du dernier étage). Chaque entrée, en coordonnées MONDE :
   - door {x, z}, doorY, r : la porte côté rue (on doit être sur le palier du perron, à moins de r) ;
   - out {x, z, yaw} : où l'on se retrouve en ressortant (palier, face à la rue) ;
   - balcony {x, z, y, yaw, confine {x0, x1, z0, z1}} : où l'on arrive, et le rectangle où le joueur
     peut se déplacer là-haut (les collisions au sol n'ont pas d'étage : on borne le déplacement) ;
   - balconyDoor {x, z}, rBack : la porte-fenêtre par laquelle on redescend.
   La logique (touche F, fondu, téléportation) vit dans player/doorways.js.
   ===================================================================== */
export const doorways = [];
export function addDoorway(d) { doorways.push({ onBalcony: false, ...d }); }
