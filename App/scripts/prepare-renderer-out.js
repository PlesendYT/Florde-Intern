// Spiegelt Classic-Scripts + Libs nach out/, weil electron-vite nur
// type="module"-Scripts bundelt. Alles andere (script.js & Co,
// ../node_modules-Refs wie xterm/monaco) würde im gebauten Installer
// 404 laufen -> UI startet, aber kein Knopf funktioniert.
// Läuft nach jedem `electron-vite build`, vor electron-builder.
// Aufruf: node scripts/prepare-renderer-out.js
const fs = require('node:fs');
const path = require('node:path');

// Alle .js unter renderer/ (Top-Level + tools/ + git/ + domains/ + lib/ ...),
// Struktur bleibt erhalten. Nur .js — CSS/Assets kommen aus dem Bundle.
const RENDERER_JS_DIRS = ['.'];

// [srcRel, destRel], relativ zu App/ bzw. out/. Pfade müssen zu den
// ../node_modules-Referenzen in renderer/index.html passen:
// Seite lädt aus out/renderer/ -> ../node_modules = out/node_modules.
const NODE_MODULES_MIRRORS = [
  ['node_modules/@xterm', 'node_modules/@xterm'],
  ['node_modules/monaco-editor/min', 'node_modules/monaco-editor/min'],
];

function collectJsFiles(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectJsFiles(full, base));
    else if (e.name.endsWith('.js')) out.push(path.relative(base, full));
  }
  return out;
}

function prepareRendererOut(opts = {}) {
  const appDir = opts.appDir || path.join(__dirname, '..');
  const outDir = opts.outDir || path.join(appDir, 'out');
  const copied = [];

  if (opts.rendererJs !== false) {
    const rendererDir = path.join(appDir, 'renderer');
    if (!fs.existsSync(rendererDir)) {
      throw new Error('prepare-renderer-out: renderer/ fehlt: ' + rendererDir);
    }
    for (const rel of collectJsFiles(rendererDir, rendererDir)) {
      const src = path.join(rendererDir, rel);
      const dest = path.join(outDir, 'renderer', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(rel.split(path.sep).join('/'));
    }
  }

  const mirrors = opts.nodeMirrors !== undefined ? opts.nodeMirrors : NODE_MODULES_MIRRORS;
  for (const [srcRel, destRel] of mirrors) {
    const src = path.join(appDir, srcRel);
    const dest = path.join(outDir, destRel);
    if (!fs.existsSync(src)) {
      throw new Error('prepare-renderer-out: Quelle fehlt: ' + src);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }

  return { copied };
}

module.exports = { prepareRendererOut, RENDERER_JS_DIRS, NODE_MODULES_MIRRORS };

if (require.main === module) {
  try {
    const res = prepareRendererOut({});
    console.log(`prepare-renderer-out: ${res.copied.length} renderer-js + ${NODE_MODULES_MIRRORS.length} node-mirrors nach out/`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
