import { makeBrickTextures } from './brick.js';
import { makeStoneTextures } from './stone.js';
import { makeBrownstoneTextures } from './brownstone.js';
import { makeSnowTextures } from './snow.js';
import { makeFlakeTexture } from './flake.js';
import { makeGratingTexture } from './grating.js';
import { makeNeonTexture } from './neon.js';
import { makeTaxiSideTexture } from './taxi.js';
import { makeWindowInteriorTextures, makeDarkWindowTextures } from './windows.js';
import { makeGrimeTexture } from './grime.js';
import { makeShutterTexture } from './shutter.js';
import { makeConcreteTextures } from './concrete.js';
import { makeContactBlobTexture, makeContactEdgeTexture } from './contact.js';
import { makeLamppostTextures, makeGlowTexture } from './lamppost.js';

/* =====================================================================
   2 bis. INSTANCIATION DES TEXTURES (une seule fois, au chargement)
   ===================================================================== */

export const brick   = makeBrickTextures();
export const stone   = makeStoneTextures();
export const brownstone = makeBrownstoneTextures();
export const snowWalk= makeSnowTextures(false);
export const snowRoad= makeSnowTextures(true);
export const flakeTex= makeFlakeTexture();
export const gratTex = makeGratingTexture();
export const neonTex = makeNeonTexture();
export const taxiSideTex = makeTaxiSideTexture();
export const winInteriorTex = makeWindowInteriorTextures();
export const winDarkTex = makeDarkWindowTextures();
export const grimeTex = makeGrimeTexture();
export const shutterTex = makeShutterTexture();
export const concrete = makeConcreteTextures();
export const contactBlobTex = makeContactBlobTexture();
export const contactEdgeTex = makeContactEdgeTexture();
export const lampPaint = makeLamppostTextures();
export const glowTex = makeGlowTexture();
