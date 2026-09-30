# Textures photo

Toutes les textures de ce dossier viennent de **Poly Haven** (https://polyhaven.com) et sont sous licence **CC0** (domaine public : usage libre, sans attribution obligatoire).
Téléchargées en résolution **1K**, JPG, trois cartes par texture : couleur (`_diff`), relief au format OpenGL (`_nor_gl`, la convention de Three.js), rugosité (`_rough`). Empreinte MD5 vérifiée contre l'API Poly Haven au téléchargement.

| Dossier | Taille réelle couverte | Usage prévu |
|---|---|---|
| `red_bricks_04` | 2,5 × 2,5 m | brique principale des façades |
| `red_brick_03` | 1 × 1 m | seconde brique (variété entre immeubles) |
| `large_sandstone_blocks` | 3 × 3 m | soubassement en pierre à joints creusés |
| `sandstone_blocks_08` | 3 × 3 m | soubassement variante, calcaire clair |
| `snow_02` | 2 × 2 m | neige fraîche (façades, congères, mobilier) |
| `snow_floor` | 2 × 2 m | neige tassée (sentier piétiné du trottoir) |
| `asphalt_snow` | 2 × 2 m | chaussée : neige damée sur asphalte |
| `snow_03` | 2 × 2 m | neige sale et grumeleuse (bourrelet, bord de trottoir) |
| `painted_metal_shutter` | 2 × 2 m | rideaux métalliques des boutiques fermées |
| `concrete_wall_008` | 2,7 × 2,7 m | pierre reconstituée : linteaux, appuis, corniches, entrées ; teintée gris granit pour la bordure et le socle |
| `rust_coarse_01` | 2,2 × 2,2 m | relief et rugosité seulement (fonte piquée) pour escaliers de secours et lampadaires ; la couleur reste la peinture noire |
| `painted_worn_brick` | 1,8 × 1,8 m | brique peinte crème écaillée (~1 immeuble sur 5) |
| `black_painted_planks` | 1,6 × 1,6 m | bois peint noir : portes et huisseries de devanture de couleur noire |
| `distressed_painted_planks` | 1,6 × 1,6 m | bois peint clair écaillé, multiplié par la couleur : portes et huisseries vertes, bordeaux, bleues… |
| `dirty_tiles` | 2,3 × 2,3 m | carrelage rouge-brun encrassé du sol des épiceries (intérieurs en fausse 3D) |
| `red_sandstone_pavement` | 2,15 × 2,15 m | dalles de grès brun (brownstone) : marches des perrons |

Écartées après aperçu : `granite_wall` (moellons bruts empilés, pas une pierre de bordure taillée), `red_sandstone_wall` (petits moellons à face brute dans le mortier, pas des marches).

Réutilisations sans téléchargement : `rust_coarse_01` (relief seulement) sur poubelles et bouches d'incendie, `distressed_painted_planks` sur les cadres de fenêtres.

Pour en ajouter une : récupérer les URL via `https://api.polyhaven.com/files/<nom>` (clés `Diffuse`, `nor_gl`, `Rough` → `1k` → `jpg`), ranger sous `assets/textures/<nom>/<nom>_<carte>_1k.jpg`.
