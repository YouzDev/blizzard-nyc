#!/usr/bin/env node
/* =====================================================================
   BUILD : modules ES  →  fichier unique `blizzard-nyc.html`
   ---------------------------------------------------------------------
   Le prototype se développe dans `src/` (modules ES chargés par
   `index.html`, ce qui exige un serveur local) mais se distribue en un
   seul fichier ouvrable en `file://`, sans build ni serveur.

   Principe : on part de `src/main.js`, on suit les imports relatifs en
   profondeur d'abord — c'est exactement l'ordre d'évaluation des modules
   ES — et on colle les corps bout à bout dans un seul `<script type="module">`.
   Les imports « trois points » (`three`, `three/addons/…`) sont remontés
   en tête, dédoublonnés ; l'import map de `index.html` les résout.

   Le collage n'est sûr que parce que les noms de premier niveau sont
   uniques d'un module à l'autre (héritage du prototype mono-fichier) :
   le script le vérifie et échoue en cas de collision.

   Usage : node build.js
   ===================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const ENTRY = 'src/main.js';
const SHELL = 'index.html';
const OUT = 'blizzard-nyc.html';

const RE_IMPORT = /^import\s+(?:(.+?)\s+from\s+)?['"]([^'"]+)['"];?\s*$/;
const RE_EXPORT_LIST = /^export\s*\{[^}]*\}\s*;?\s*$/;

/* --- 1. Parcours du graphe d'imports (post-ordre = ordre d'évaluation ESM) --- */
const bare = [];          // imports à laisser tels quels (three, three/addons/…)
const order = [];         // modules dans l'ordre d'évaluation
const seen = new Set();

function visit(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`module introuvable : ${rel}`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const body = [];
  for (const line of lines) {
    const m = line.match(RE_IMPORT);
    if (m) {
      const spec = m[2];
      if (spec.startsWith('.')) {
        visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      } else if (!bare.includes(line.trim())) {
        bare.push(line.trim());
      }
      continue;                                   // l'import disparaît du corps
    }
    if (RE_EXPORT_LIST.test(line)) continue;      // `export { … };` : inutile après collage
    body.push(line.replace(/^export\s+(const|let|var|function|class)\s/, '$1 '));
  }
  order.push({ rel, body: body.join('\n').replace(/^\n+|\n+$/g, '') });
}

visit(ENTRY);

/* --- 2. Garde-fou : aucun nom de premier niveau ne doit être déclaré deux fois --- */
function topLevelNames(body) {
  const names = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^(?:const|let|var)\s+(.*)$/);
    if (m) { names.push(...declarators(m[1])); continue; }
    const f = line.match(/^(?:function|class)\s+([A-Za-z_$][\w$]*)/);
    if (f) names.push(f[1]);
  }
  return names;
}
function declarators(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (i === text.length || (ch === ',' && depth === 0)) {
      const seg = text.slice(start, i).trim();
      const name = seg.split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
      start = i + 1;
    }
  }
  return out;
}
const declaredIn = new Map();
for (const mod of order) {
  for (const name of topLevelNames(mod.body)) {
    if (declaredIn.has(name)) {
      throw new Error(`collision de nom « ${name} » entre ${declaredIn.get(name)} et ${mod.rel} : ` +
        `le collage mono-fichier met tous les modules dans la même portée, renommez-en un.`);
    }
    declaredIn.set(name, mod.rel);
  }
}

/* --- 3. Assemblage --- */
const banner = `/* FICHIER GÉNÉRÉ — ne pas éditer à la main.
   Sources : src/*.js — régénérer avec « node build.js ». */`;
const bundle = [banner, '', bare.join('\n'), '',
  ...order.map(m => `/* ───────────────────────── ${m.rel} ───────────────────────── */\n${m.body}\n`)
].join('\n');

const shell = fs.readFileSync(path.join(ROOT, SHELL), 'utf8');
const tag = /<script type="module" src="\.\/src\/main\.js"><\/script>/;
if (!tag.test(shell)) throw new Error(`balise <script type="module" src="./src/main.js"> introuvable dans ${SHELL}`);
const html = shell.replace(tag, `<script type="module">\n${bundle}</script>`);
/* --- 4. Garde-fou : le bundle doit être du JavaScript valide (node --check) ---
   Une parenthèse perdue dans un module ne casse pas le build, mais casse la page
   en silence : autant le savoir ici. */
const tmp = path.join(os.tmpdir(), 'blizzard-bundle-check.mjs');
fs.writeFileSync(tmp, bundle, 'utf8');
try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) {
  const lines = String(e.stderr || e.message).split(/\r?\n/).slice(0, 4).join('\n');
  throw new Error('bundle invalide — la page ne se chargerait pas :\n' + lines);
}

fs.writeFileSync(path.join(ROOT, OUT), html, 'utf8');

console.log(`${OUT} écrit — ${order.length} modules, ${html.split('\n').length} lignes, ${(html.length / 1024).toFixed(0)} Ko`);
console.log(order.map((m, i) => `  ${String(i + 1).padStart(2)}. ${m.rel}`).join('\n'));
