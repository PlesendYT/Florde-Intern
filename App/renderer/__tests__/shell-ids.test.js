import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '..');

function collectJs(base) {
  const out = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'lib') continue;
    const p = path.join(base, e.name);
    if (e.isDirectory()) out.push(...collectJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// IDs present in static index.html, IDs provided at runtime by JS
// (.id = '...', setAttribute('id', '...'), id="..." in JS template strings),
// and IDs read via getElementById, split into UNGUARDED reads
// (getElementById('x') NOT immediately followed by '?.') vs GUARDED reads
// (getElementById('x')?. — null-safe at the call site).
function collectIds() {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf-8');
  const present = new Set([...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  const provided = new Set();
  const unguarded = new Set();
  const guarded = new Set();
  for (const f of collectJs(rendererDir)) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)) provided.add(m[1]);
    for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)) provided.add(m[1]);
    for (const m of src.matchAll(/(?:^|[^A-Za-z0-9_-])id="([A-Za-z0-9_-]+)"/gm)) provided.add(m[1]);
    for (const m of src.matchAll(/getElementById\(\s*(['"])([A-Za-z0-9_-]+)\1\s*\)(\?\.)?/g)) {
      (m[3] ? guarded : unguarded).add(m[2]);
    }
  }
  return { present, provided, unguarded, guarded };
}

test('unguarded getElementById reads resolve to static HTML or JS-provided IDs', () => {
  const { present, provided, unguarded } = collectIds();
  // KNOWN baseline (2026-09-11, branch feat/ui-rewrite-quiet-power):
  // these IDs are read WITHOUT '?.' at the call site and exist neither in
  // static index.html nor as JS-provided runtime IDs — latent-NPE watchlist.
  // Verified: every dereference is still null-safe (const + '?.' uses or
  // explicit `if (x)`), EXCEPT btn-layout-snap (script.js:9083), whose
  // unguarded read sits in a ternary branch that only survives via
  // short-circuit of the guarded condition. Any NEW entry here fails.
  // Sites: todo-panel script.js:8006, notes-panel script.js:8152,
  // execution-panel script.js:10717+10743, exec-badge script.js:10861
  // (`if (badge)`), ollama-hub-badge tools/ollama-manager.js:59
  // (`if (badge)`), ollama-hub-panel tools/ollama-manager.js:91,
  // skills-panel tools/skills.js:22, btn-layout-snap script.js:9083.
  const KNOWN_UNGUARDED_MISSING = new Set([
    'btn-layout-snap',
    'exec-badge',
    'execution-panel',
    'notes-panel',
    'ollama-hub-badge',
    'ollama-hub-panel',
    'skills-panel',
    'todo-panel',
  ]);
  const missing = [...unguarded].filter(id => !present.has(id) && !provided.has(id));
  const unexpected = missing.filter(id => !KNOWN_UNGUARDED_MISSING.has(id));
  assert.deepStrictEqual(unexpected, [], `NEW unguarded-but-missing IDs (latent NPE risk): ${unexpected.join(', ')}`);
  const resolved = [...KNOWN_UNGUARDED_MISSING].filter(id => present.has(id) || provided.has(id));
  assert.deepStrictEqual(resolved, [], `known-missing IDs now exist — remove from KNOWN_UNGUARDED_MISSING: ${resolved.join(', ')}`);
});

test('guarded-but-missing IDs stay within the known ?.-guarded set', () => {
  const { present, provided, guarded } = collectIds();
  // KNOWN baseline (2026-09-11): these IDs are missing from static HTML and
  // JS-provided runtime IDs, but every known read site uses '?.' (dead /
  // not-yet-wired panels: todo, notes, rag, skills, execution, ollama-hub,
  // plus toolbar buttons). Any NEW guarded-missing ID fails the guard.
  // NOTE: btn-layout-snap, execution-panel, notes-panel, ollama-hub-panel,
  // skills-panel, todo-panel ALSO have unguarded read sites — see the
  // KNOWN_UNGUARDED_MISSING watchlist in the subtest above.
  const KNOWN_GUARDED_MISSING = new Set([
    'btn-close-all-tabs',
    'btn-cmd-palette',
    'btn-exec-close',
    'btn-exec-toggle',
    'btn-git-commit-show',
    'btn-layout-snap',
    'btn-notes-close',
    'btn-notes-toggle',
    'btn-ollama-hub',
    'btn-ollama-hub-close',
    'btn-plugins',
    'btn-rag-close',
    'btn-rag-toggle',
    'btn-sidebar-toggle',
    'btn-skills-close',
    'btn-skills-toggle',
    'btn-todo-close',
    'btn-todo-toggle',
    'execution-panel',
    'notes-panel',
    'ollama-hub-panel',
    'rag-panel',
    'skills-panel',
    'todo-panel',
  ]);
  const missing = [...guarded].filter(id => !present.has(id) && !provided.has(id));
  const unexpected = missing.filter(id => !KNOWN_GUARDED_MISSING.has(id));
  assert.deepStrictEqual(unexpected, [], `NEW guarded-but-missing IDs: ${unexpected.join(', ')}`);
  const resolved = [...KNOWN_GUARDED_MISSING].filter(id => present.has(id) || provided.has(id));
  assert.deepStrictEqual(resolved, [], `known-missing IDs now exist — remove from KNOWN_GUARDED_MISSING: ${resolved.join(', ')}`);
});

test('rail + status + animation hooks exist (rewrite targets)', () => {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf-8');
  for (const id of ['icon-rail', 'status-panel', 'status-dot']) {
    assert.ok(html.includes(`id="${id}"`), `index.html must contain id="${id}"`);
  }
});
