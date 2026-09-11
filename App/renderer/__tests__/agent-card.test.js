import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(rendererDir, 'style.css'), 'utf-8');
const script = fs.readFileSync(path.join(rendererDir, 'script.js'), 'utf-8');
const permDlg = fs.readFileSync(path.join(rendererDir, 'permission-dialog.js'), 'utf-8');

function cssBlock(selector) {
  const i = css.indexOf(selector);
  assert.ok(i !== -1, `style.css must contain ${selector}`);
  // grab ~800 chars from selector for property checks
  return css.slice(i, i + 1200);
}

test('agent-card CSS exists and uses Task-2 tokens only (no hex, no shadow, radius<=8px)', () => {
  for (const sel of ['.agent-card ', '.agent-card-header', '.agent-card-dot', '.agent-card-tools', '.agent-card-details-btn', '.perm-risk-grid']) {
    assert.ok(css.includes(sel), `style.css must contain ${sel}`);
  }
  const block = cssBlock('.agent-card {');
  assert.ok(block.includes('var(--surface-panel)'), '.agent-card must use var(--surface-panel)');
  assert.ok(block.includes('var(--border-subtle)'), '.agent-card must use var(--border-subtle)');
  assert.ok(!block.includes('box-shadow'), '.agent-card must not use box-shadow');
  const radiusMatch = block.match(/border-radius:\s*(\d+)px/);
  assert.ok(radiusMatch, '.agent-card must define border-radius in px');
  assert.ok(Number(radiusMatch[1]) <= 8, `.agent-card radius must be <=8px, got ${radiusMatch[1]}px`);
  // no new hex colors inside the agent-card block
  const hexes = block.match(/#[0-9a-fA-F]{3,8}/g) || [];
  assert.deepStrictEqual(hexes, [], `agent-card block must not contain hex colors, found: ${hexes.join(',')}`);
  // collapse rule: max 3 tool lines + open override
  assert.ok(css.includes('.agent-card-tools li:nth-child(n+4)'), 'must collapse after 3 tool lines');
  assert.ok(css.includes('.agent-card.open .agent-card-tools li'), 'must expand when .open');
  // perm grid tokens
  const grid = cssBlock('.perm-risk-grid');
  assert.ok(grid.includes('var(--text-secondary)'), '.perm-risk-grid must use var(--text-secondary)');
});

test('chat renders agent activity as .agent-card with Details toggle (fallback keeps old path)', () => {
  assert.ok(script.includes('agent-card'), 'script.js must reference agent-card');
  assert.ok(script.includes('agent-card-details-btn'), 'script.js must render Details toggle button');
  assert.ok(script.includes('agent-card-tools'), 'script.js must render tool list');
  // toggle flips .open on the card, no new IDs (guard only checks IDs — classes fine)
  assert.ok(/classList\.toggle\(['"]open['"]\)/.test(script), 'toggle must flip .open class');
});

test('showPermissionPrompt renders Risiko/Sandbox/Network rows with "—" fallback, gate intact', () => {
  assert.ok(script.includes('perm-risk-grid'), 'script.js must render .perm-risk-grid');
  for (const label of ['Risiko', 'Sandbox', 'Network']) {
    assert.ok(script.includes(label), `showPermissionPrompt must render ${label} row`);
  }
  assert.ok(script.includes('—'), 'missing risk/sandbox/network values must fall back to "—"');
  // gate semantics unchanged: 4 buttons + callback(true/false) flows
  for (const cls of ['btn-allow-once', 'btn-allow-always', 'btn-block-once', 'btn-block-always']) {
    assert.ok(script.includes(cls), `gate button ${cls} must stay`);
  }
  assert.ok(script.includes('callback(true)'), 'allow path must call callback(true)');
  assert.ok(script.includes('callback(false)'), 'block path must call callback(false)');
});

test('permission-dialog.js renders Risiko/Sandbox/Network rows with "—" fallback, callback flow intact', () => {
  assert.ok(permDlg.includes('perm-risk-grid'), 'permission-dialog.js must render .perm-risk-grid');
  for (const label of ['Risiko', 'Sandbox', 'Network']) {
    assert.ok(permDlg.includes(label), `permission-dialog must render ${label} row`);
  }
  assert.ok(permDlg.includes('—'), 'permission-dialog fallback must be "—"');
  assert.ok(permDlg.includes('respondPermission'), 'permission-dialog must keep respondPermission callback flow');
  assert.ok(permDlg.includes('data-d="allow"') || permDlg.includes('allow'), 'allow decision must stay');
  assert.ok(permDlg.includes('data-d="block"') || permDlg.includes('block'), 'block decision must stay');
});
