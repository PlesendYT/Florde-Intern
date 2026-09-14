import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '..');

// Regression guards for two silent startup breakages:
// 1. layout-manager used non-existent `panel.element` (IDockviewPanel exposes
//    the content host as panel.view.content.element) — crashed activate() and
//    orphaned the chat panel.
// 2. TerminalManager.create() fired IPC `terminal:create` with null path at
//    page load (no project open) — rejected by ShellService._assertTerminalCwd.
test('layout-manager never touches non-existent panel.element', () => {
  const src = fs.readFileSync(path.join(rendererDir, 'layout-manager.js'), 'utf-8');
  assert.ok(!/(?<![\w.])panel\.element\b/.test(src), 'bare panel.element access found');
  assert.ok(!/\bp\s*\?\s*p\.element\b/.test(src), 'p ? p.element access found');
  assert.ok(src.includes('panel.view.content.element'), 'must resolve host via panel.view.content.element');
});

test('TerminalManager.create skips IPC when no project path is known', () => {
  const src = fs.readFileSync(path.join(rendererDir, 'script.js'), 'utf-8');
  const idx = src.indexOf('async create(projectPath, splitId)');
  assert.ok(idx !== -1, 'TerminalManager.create not found');
  const body = src.slice(idx, idx + 1200);
  assert.ok(body.includes('if (!targetPath) return null'), 'must return null when no path is known');
  assert.ok(body.indexOf('if (!targetPath)') < body.indexOf('terminal.create'), 'guard must run before IPC');
});
