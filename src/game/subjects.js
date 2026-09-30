import * as THREE from 'three';

/* =====================================================================
   17. SUJETS PHOTOGRAPHIABLES
   Chaque élément de la rue qui peut faire l'objet d'une photo s'inscrit ici au
   moment où il est construit (véhicules, néon, lampadaires, vapeur, feux, portes,
   vitrines, escaliers de secours, châteaux d'eau…). La notation (game/scoring.js)
   ne connaît que ce registre : ajouter un sujet, c'est UN appel à addSubject.

   Champs :
     label   nom lisible (« Le néon DELI – PIZZA »)
     value   intérêt du sujet, 0..1 (le néon du deli vaut plus qu'une voiture garée)
     object  objet 3D dont la boîte englobante sert d'emprise (calculée au 1er besoin,
             quand les matrices sont figées) — OU —
     box     emprise explicite (THREE.Box3, coordonnées monde) : obligatoire pour les
             objets dont la boîte serait faussée (lampadaire : sa sphère de diffusion
             de 4,5 m engloberait la moitié de la rue)
     glows   sujet lumineux : il reste visible dans la brume (néon, feux, vitrine)
     moment  () => { pts, why } | null : bonus de l'instant (gyrophares allumés,
             feu au rouge…), évalué AU DÉCLENCHEMENT
     active  () => bool (facultatif) : sujet présent seulement par moments — prévu
             pour les apparitions temporaires (un oiseau pendant 2 minutes…)
   ===================================================================== */
export const photoSubjects = [];

export function addSubject(s) { photoSubjects.push(s); return s; }

/** Emprise monde du sujet (mise en cache : la scène est statique). */
export function subjectBox(s) {
  if (!s._box) s._box = s.box ? s.box.clone() : new THREE.Box3().setFromObject(s.object);
  return s._box;
}

/** Boîte à partir d'un centre (x, z), d'un intervalle de hauteur et de demi-largeurs. */
export function boxAt(x, z, hx, hz, y0, y1) {
  return new THREE.Box3(new THREE.Vector3(x - hx, y0, z - hz), new THREE.Vector3(x + hx, y1, z + hz));
}
