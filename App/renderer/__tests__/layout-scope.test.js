import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf-8');
const layoutJs = fs.readFileSync(path.join(__dirname, '..', 'layout-manager.js'), 'utf-8');

function parseRules(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    declarations: m[2],
    raw: m[1].trim(),
  }));
}

// Scoped = gated on diff-viewer-visible state (or another explicit state
// ancestor). Bare global selectors hide IDE chrome unconditionally.
function isScoped(sel) {
  return sel.includes(':has(') || /(^|[\s>+~])body[.\[]/.test(sel);
}

test('diff-viewer chrome-hiding rules are scoped to diff-visible state', () => {
  const rules = parseRules(css);
  // The diff-viewer chrome-hiding intent is the only rule block that hides
  // BOTH #sidebar and .editor-panel in one selector list.
  const chromeRules = rules.filter(
    (r) =>
      /display\s*:\s*none/.test(r.declarations) &&
      r.raw.includes('#sidebar') &&
      r.raw.includes('.editor-panel')
  );
  assert.ok(
    chromeRules.length > 0,
    'expected at least one chrome-hiding rule block for #sidebar/.editor-panel'
  );
  for (const r of chromeRules) {
    for (const sel of r.selectors) {
      assert.ok(
        isScoped(sel),
        `unscoped global chrome-hiding selector (sidebar/editor always hidden): "${sel}"`
      );
    }
  }
});

test('no bare global chrome selectors in any display:none rule', () => {
  const rules = parseRules(css);
  const BARE = new Set([
    '#sidebar',
    '.sidebar-resizer',
    '#file-tabs',
    '#file-name',
    '#project-type-badge',
    '.editor-panel',
  ]);
  const offenders = [];
  for (const r of rules) {
    if (!/display\s*:\s*none/.test(r.declarations)) continue;
    for (const sel of r.selectors) {
      if (BARE.has(sel)) offenders.push(sel);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `bare global chrome-hiding selectors (always hidden): ${offenders.join(', ')}`
  );
});

// activate() must never detach an element it cannot re-attach: detaching
// first and re-attaching only-if-host-exists loses DOM nodes (black
// workspace) when dockview content isn't rendered yet. All moves go through
// moveIntoPanel (host check before detach), critical failures restore the
// static layout and reset _active so a later retry can run.
test('activate moves only into existing panel hosts (fail-safe)', () => {
  assert.ok(
    /const moveIntoPanel = \(panelId, element, key/.test(layoutJs),
    'moveIntoPanel helper missing'
  );
  assert.ok(
    /if \(!host\) return false/.test(layoutJs),
    'moveIntoPanel must bail before detaching when host is missing'
  );
  for (const key of ['chatPanel', 'mainContent']) {
    assert.ok(
      new RegExp(`moveIntoPanel\\('(?:chat|editor)',[^)]*'${key}'`).test(layoutJs),
      `critical move for ${key} must go through moveIntoPanel`
    );
  }
  assert.ok(
    /_restoreStatic\(\)/.test(layoutJs) && /this\._active = false/.test(layoutJs),
    'critical-move failure must restore static layout and reset _active'
  );
  assert.ok(
    !/panel\.element\.appendChild/.test(layoutJs),
    'bare panel.element access must stay fixed (use panelHost)'
  );
});
