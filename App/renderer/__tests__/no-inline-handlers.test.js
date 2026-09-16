import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '..');

// CSP `script-src 'self'` (index.html meta tag) blocks inline event handlers.
// Every `onclick="..."` / `onkeydown="..."` in markup or generated HTML is a
// dead control (e.g. all settings toggles + close-X were broken by this).
// Handlers must be wired via addEventListener (direct or delegated).
const INLINE_RE = /\son(?:click|dblclick|change|input|submit|keydown|keyup|keypress|focus|blur|mouseover|mouseenter|mouseleave|scroll|load|error)\s*=\s*["']/i;

function collectJs(base) {
  const out = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'lib' || e.name === 'node_modules') continue;
    const p = path.join(base, e.name);
    if (e.isDirectory()) out.push(...collectJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('index.html has no inline event handlers (CSP)', () => {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf-8');
  const hits = [];
  html.split('\n').forEach((line, i) => {
    if (INLINE_RE.test(line)) hits.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  assert.deepStrictEqual(hits, [], `inline handlers blocked by CSP:\n${hits.join('\n')}`);
});

test('renderer JS generates no inline event handler attributes (CSP)', () => {
  const hits = [];
  for (const f of collectJs(rendererDir)) {
    const src = fs.readFileSync(f, 'utf-8');
    src.split('\n').forEach((line, i) => {
      if (INLINE_RE.test(line)) hits.push(`${path.relative(rendererDir, f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(hits, [], `inline handlers blocked by CSP:\n${hits.join('\n')}`);
});
