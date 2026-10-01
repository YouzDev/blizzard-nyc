/* =====================================================================
   0. CONSTANTES
   La rue est alignée sur l'axe Z, le joueur regarde vers -Z.
   ===================================================================== */
export const ROAD_HALF     = 6;
export const SIDEWALK_W    = 5.2;   // large trottoir new-yorkais : le mobilier reste au bord, le couloir piéton fait ~2,7 m
export const FACADE_X      = ROAD_HALF + SIDEWALK_W;   // ±11.2
export const SIDEWALK_H    = 0.18;
export const STREET_Z_MIN  = -90;
export const STREET_Z_MAX  = 40;
export const EYE_HEIGHT    = 1.72;
export const WALK_SPEED    = 3.2;
export const PLAYER_RADIUS = 0.42;
export const FOG_DENSITY   = 0.023;
// lampadaires : un tous les 17 m de chaque côté, côté droit décalé d'un demi-pas
export const LAMP_Z0       = STREET_Z_MIN + 6;
export const LAMP_PITCH    = 17;
// Carrefour au bout de la rue : la transversale a le même profil (chaussée de 12 m,
// trottoirs de 5,2 m), sa bordure côté joueur à z = STREET_Z_MIN. À gauche des feux, elle
// devient la RUE DE GAUCHE, fermée au fond par des façades (impasse) à x = LEFT_END_X ;
// à droite, la rangée d'immeubles de la rue principale continue (pas encore de rue).
export const CROSS_Z       = STREET_Z_MIN - ROAD_HALF;    // −96 : axe de la transversale
export const LEFT_END_X    = -110;
