# Florde UI-Rewrite („Quiet Power") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite der Florde-App-Shell nach der approved Design-Spec (`App/docs/superpowers/specs/2026-09-11-florde-ui-rewrite-design.md`): Icon-Rail + Dockview-Panel-System, 3 semantische Themes, kompakte Agent-Cards, Status-Panel, Animations-Stufen.

**Architecture:** Shell-Rewrite bei erhaltenem ID-Vertrag: `index.html`-Struktur und `style.css` werden neu aufgebaut, alle `getElementById`-IDs bleiben bestehen, sodass `script.js` (~11k Zeilen) ohne Logik-Änderung weiterläuft. Neue UI-State (Rail, Animation) persistiert in localStorage/settings.json ohne Secrets.

**Tech Stack:** Electron renderer, Vanilla JS + Dockview (`dockview-core`), CSS Custom Properties, node:test.

## Global Constraints

- Alle bestehenden Element-IDs bleiben erhalten (ID-Vertrag, §5 der Spec).
- Keine API-Keys/Secrets in localStorage, settings.json oder Logs (Keys nur OS-Keychain).
- `prefers-reduced-motion` wird immer respektiert.
- Keine Drop-Shadows; Borders dezent; Radius 4–8px.
- Gitleaks vor jedem Commit; ein Commit pro Task.
- Keine Logik-Umbauten an Agent/Provider/MCP — nur Darstellung.
- Test-Basis: 391 pass / 16 pre-existing Failures (Permission-/Store-Tests); diese 16 dürfen sich nicht ändern.

---

### Task 1: ID-Vertrag-Test (Regression Guard)

**Files:**
- Create: `App/renderer/__tests__/shell-ids.test.js`

**Interfaces:**
- Consumes: `App/renderer/index.html` (IDs), alle `App/renderer/*.js` + `App/renderer/*/*.js` (referenzierte IDs)
- Produces: Guard, der in Task 3–5 bei jeder Shell-Änderung grün bleiben muss

- [ ] **Step 1: Write the test**

```js
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

test('every getElementById/querySelector ID used in renderer JS exists in index.html', () => {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf-8');
  const present = new Set([...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  const wanted = new Set();
  for (const f of collectJs(rendererDir)) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) wanted.add(m[1]);
    for (const m of src.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)) wanted.add(m[1]);
  }
  // Dynamisch erzeugte IDs (Laufzeit), nicht in statischem HTML:
  const dynamic = new Set(['task-indicator', 'loop-indicator', 'model-info-popup', 'fallback-switch', 'fallback-disable', 'fallback-dismiss']);
  const missing = [...wanted].filter(id => !present.has(id) && !dynamic.has(id));
  assert.deepStrictEqual(missing, [], `IDs referenced in JS but missing in index.html: ${missing.join(', ')}`);
});

test('rail + status + animation hooks exist (rewrite targets)', () => {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf-8');
  for (const id of ['icon-rail', 'status-panel', 'status-dot']) {
    assert.ok(html.includes(`id="${id}"`), `index.html must contain id="${id}"`);
  }
});
```

- [ ] **Step 2: Run test, confirm second subtest FAILS (rail IDs fehlen noch), first passes (baseline)**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/shell-ids.test.js`
Expected: `not ok` für `rail + status + animation hooks exist`, `ok` für ID-Vertrag (Baseline grün)

- [ ] **Step 3: Commit (Test only)**

```bash
git add App/renderer/__tests__/shell-ids.test.js
git commit -m "test(ui): ID-Vertrag-Guard + Rewrite-Ziel-IDs (RED für Rail)"
```

---

### Task 2: Theme-System (Tokens + 3 Themes + Migration)

**Files:**
- Modify: `App/renderer/domains/theme/theme.js`
- Modify: `App/renderer/style.css` (Token-Block + 3 Theme-Blöcke, alte Blöcke entfernen)
- Modify: `App/renderer/index.html` (Settings-Select `settings-theme`: 3 Optionen)
- Modify: `App/renderer/script.js` (Zeilen ~2955, ~6625: Legacy-Fallbacks via `migrateTheme`)
- Test: `App/renderer/__tests__/theme-migrate.test.js` (neu)

**Interfaces:**
- Consumes: Spec §2 (Token-Namen, Theme-Namen, Mapping)
- Produces: `migrateTheme(name)` in `window.__theme`; CSS-Vars `--surface-background/--surface-panel/--surface-raised/--text-primary/--text-secondary/--text-muted/--border-subtle/--accent/--status-success/--status-warn/--status-danger`; `data-theme="florde-dark|florde-light|florde-midnight"`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { migrateTheme, THEME_CYCLE, DEFAULT_THEME } from '../domains/theme/theme.js';

test('only 3 built-in themes, dark is default', () => {
  assert.deepStrictEqual(THEME_CYCLE, ['florde-dark', 'florde-light', 'florde-midnight']);
  assert.strictEqual(DEFAULT_THEME, 'florde-dark');
});

test('legacy themes map to new equivalents', () => {
  assert.strictEqual(migrateTheme('dark'), 'florde-dark');
  assert.strictEqual(migrateTheme('light'), 'florde-light');
  assert.strictEqual(migrateTheme('high-contrast'), 'florde-dark');
  assert.strictEqual(migrateTheme('solarized-dark'), 'florde-dark');
  assert.strictEqual(migrateTheme('solarized-light'), 'florde-light');
  assert.strictEqual(migrateTheme('florde-midnight'), 'florde-midnight');
  assert.strictEqual(migrateTheme(undefined), 'florde-dark');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/theme-migrate.test.js`
Expected: FAIL (`migrateTheme is not a function`)

- [ ] **Step 3: Minimal implementation — `theme.js` ersetzen**

```js
export const THEME_CYCLE = ['florde-dark', 'florde-light', 'florde-midnight'];
export const DEFAULT_THEME = 'florde-dark';

const LEGACY_MAP = {
  dark: 'florde-dark',
  light: 'florde-light',
  'high-contrast': 'florde-dark',
  'solarized-dark': 'florde-dark',
  'solarized-light': 'florde-light',
};

export function migrateTheme(theme) {
  if (!theme) return DEFAULT_THEME;
  if (THEME_CYCLE.includes(theme)) return theme;
  return LEGACY_MAP[theme] || DEFAULT_THEME;
}

export function isLightTheme(theme) {
  return migrateTheme(theme) === 'florde-light';
}

export function normalizeTheme(theme) {
  return migrateTheme(theme);
}

export function nextTheme(current) {
  const i = THEME_CYCLE.indexOf(migrateTheme(current));
  return THEME_CYCLE[(i === -1 ? 0 : i + 1) % THEME_CYCLE.length];
}

export function monacoThemeFor(theme) {
  return isLightTheme(theme) ? 'vs' : 'vs-dark';
}

const api = { THEME_CYCLE, DEFAULT_THEME, isLightTheme, normalizeTheme, nextTheme, monacoThemeFor, migrateTheme };
if (typeof window !== 'undefined') window.__theme = api;
export default api;
```

- [ ] **Step 4: `style.css` Token-Block einfügen (nach `:root`), alte Theme-Blöcke ersetzen**

```css
:root, [data-theme="florde-dark"] {
  --surface-background: #0b1020;
  --surface-panel: #111832;
  --surface-raised: #1a2342;
  --text-primary: #e6eaf2;
  --text-secondary: #a3adc2;
  --text-muted: #5d6880;
  --border-subtle: rgba(163, 173, 194, 0.14);
  --accent: #7c5cfc;
  --accent-ink: #ffffff;
  --status-success: #34d399;
  --status-warn: #fbbf24;
  --status-danger: #f87171;
}
[data-theme="florde-light"] {
  --surface-background: #f2f4fa;
  --surface-panel: #ffffff;
  --surface-raised: #e8ecf5;
  --text-primary: #131a2e;
  --text-secondary: #4a5578;
  --text-muted: #8a93ad;
  --border-subtle: rgba(19, 26, 46, 0.12);
  --accent: #6d4df6;
  --accent-ink: #ffffff;
  --status-success: #059669;
  --status-warn: #b45309;
  --status-danger: #dc2626;
}
[data-theme="florde-midnight"] {
  --surface-background: #05070d;
  --surface-panel: #0a0e1a;
  --surface-raised: #121728;
  --text-primary: #dfe4f0;
  --text-secondary: #949cab;
  --text-muted: #525a70;
  --border-subtle: rgba(148, 156, 171, 0.12);
  --accent: #8b6cff;
  --accent-ink: #ffffff;
  --status-success: #34d399;
  --status-warn: #fbbf24;
  --status-danger: #f87171;
}
```

Alte Blöcke `[data-theme="dark"]`, `[data-theme="light"]`, `[data-theme="high-contrast"]`, `[data-theme="solarized-dark"]`, `[data-theme="solarized-light"]` löschen. Rückwärtskompatibel: zusätzlich `[data-theme="dark"] { @extend florde-dark }` NICHT nötig, da `migrateTheme` alte Werte nie mehr ans DOM lässt.

- [ ] **Step 5: `index.html` settings-theme-Optionen + `script.js`-Fallbacks**

`index.html`: Optionen des `select#settings-theme` ersetzen durch:
```html
<option value="florde-dark">Florde Dark</option>
<option value="florde-light">Florde Light</option>
<option value="florde-midnight">Florde Midnight</option>
```
`script.js` Zeile ~2956: `isLightTheme`-Fallback `(t => t === 'light' || t === 'solarized-light')` ersetzen durch `(t => (window.__theme ? window.__theme.isLightTheme(t) : t === 'florde-light'))`. Zeile ~6625: lokale `THEME_CYCLE`-Konstante löschen, `__theme.nextTheme` direkt nutzen (Fallback behalten falls `__theme` fehlt).

- [ ] **Step 6: Run tests**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/theme-migrate.test.js renderer/__tests__/theme.test.js renderer/__tests__/shell-ids.test.js`
Expected: theme-migrate 2/2 PASS; theme.test.js ggf. an neue Namen anpassen (falls es alte Namen asserted → im selben Commit mitziehen, kein separater Task)

- [ ] **Step 7: Commit**

```bash
git add App/renderer/domains/theme/theme.js App/renderer/style.css App/renderer/index.html App/renderer/script.js App/renderer/__tests__/theme-migrate.test.js
gitleaks detect
git commit -m "feat(ui): semantische Tokens + 3 Themes (Dark/Light/Midnight) mit Legacy-Mapping"
```

---

### Task 3: Icon-Rail + Shell-Restrukturierung

**Files:**
- Modify: `App/renderer/index.html` (Rail-Element + Panel-Container, IDs unverändert)
- Modify: `App/renderer/style.css` (Rail-, Panel-, Responsive-Styles)
- Modify: `App/renderer/script.js` (Rail-Toggle-Handler + Persistenz, ~10 Zeilen)
- Test: `renderer/__tests__/shell-ids.test.js` (muss grün werden/bleiben)

**Interfaces:**
- Consumes: Task 1 (ID-Guard), Task 2 (Tokens)
- Produces: `#icon-rail` mit Buttons `data-panel="chat|editor|terminal|git|sandbox|mcp|tools"`, `#status-dot`; Persistenz-Keys `florde-rail-panels` (JSON-Array offener Panels)

- [ ] **Step 1: `index.html` — Rail direkt nach `<div id="app-view">` einfügen, Panels in Dockview-Container belassen**

```html
<nav id="icon-rail" aria-label="Workspace">
  <div class="rail-brand">F</div>
  <button class="rail-btn" data-panel="chat" title="Chat">💬</button>
  <button class="rail-btn" data-panel="editor" title="Editor">&lt;/&gt;</button>
  <button class="rail-btn" data-panel="terminal" title="Terminal">⌁</button>
  <button class="rail-btn" data-panel="git" title="Git">⑂</button>
  <button class="rail-btn" data-panel="sandbox" title="Sandbox">▣</button>
  <button class="rail-btn" data-panel="mcp" title="MCP">🔌</button>
  <button class="rail-btn" data-panel="tools" title="Tools">🛠</button>
  <div class="rail-spacer"></div>
  <button class="rail-btn" id="rail-settings" title="Settings">⚙</button>
  <button class="rail-btn" id="status-dot" title="Florde Status">●</button>
</nav>
<div id="status-panel" class="hidden" role="dialog" aria-label="Florde Status"></div>
```

Regel: Kein bestehendes `id="..."` umbenennen/entfernen/verschieben, das in Task 1 gefunden wurde. Nur NEUE Elemente + Klassen.

- [ ] **Step 2: `style.css` Rail-Styles (nur Tokens aus Task 2)**

```css
#icon-rail { width: 48px; background: var(--surface-panel); border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; align-items: center; padding: 8px 0; gap: 4px; }
.rail-btn { width: 36px; height: 36px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
.rail-btn:hover { background: var(--surface-raised); color: var(--text-primary); }
.rail-btn.active { color: var(--accent); border-color: var(--border-subtle); background: var(--surface-raised); }
.rail-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rail-spacer { flex: 1; }
#status-dot { color: var(--status-success); font-size: 0.8rem; }
#status-panel { position: absolute; left: 56px; bottom: 12px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px 14px; min-width: 220px; z-index: 50; }
```

- [ ] **Step 3: `script.js` — Rail-Handler (nahe Privacy/Provider-Sektion)**

```js
document.querySelectorAll('#icon-rail .rail-btn[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    document.querySelectorAll('#icon-rail .rail-btn[data-panel]').forEach(b => b.classList.toggle('active', b === btn));
    try {
      const open = JSON.parse(localStorage.getItem('florde-rail-panels') || '["chat","editor"]');
      const next = open.includes(panel) ? open.filter(p => p !== panel) : [...open, panel];
      localStorage.setItem('florde-rail-panels', JSON.stringify(next));
    } catch {}
    if (window.LayoutManager && typeof window.LayoutManager.togglePanel === 'function') {
      window.LayoutManager.togglePanel(panel);
    } else {
      document.getElementById('app-view')?.setAttribute('data-active-panel', panel);
    }
  });
});
document.getElementById('status-dot')?.addEventListener('click', () => {
  document.getElementById('status-panel')?.classList.toggle('hidden');
});
```

- [ ] **Step 4: Run tests — ID-Guard + Suite**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/shell-ids.test.js`
Expected: beide Subtests PASS (Rail-IDs existieren jetzt)
Run: `npm test` → 391+ pass, fail weiterhin exakt die 16 bekannten (Namen via `grep "^not ok"` vergleichen)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/index.html App/renderer/style.css App/renderer/script.js
gitleaks detect
git commit -m "feat(ui): Icon-Rail + Status-Panel-Shell bei erhaltenem ID-Vertrag"
```

---

### Task 4: Chat Agent-Cards + Permission-Dialog-Restyle

**Files:**
- Modify: `App/renderer/style.css` (`.agent-card`, `.agent-card-details`, Permission-Dialog-Klassen)
- Modify: `App/renderer/script.js` (Agent-Block-Rendering: Details-Toggle; `showPermissionPrompt` ~Zeile 1373: Risiko/Sandbox/Network-Zeilen)
- Modify: `App/renderer/permission-dialog.js` (falls dort Markup liegt: gleiche Struktur, neue Klassen)
- Test: vorhandene `chat-sessions.test.js` + manueller Klick-Pfad

**Interfaces:**
- Consumes: Task 2 (Tokens), bestehende Chat-Container-IDs (`chat-messages`, `chat-input`, `btn-send`)
- Produces: `.agent-card` (kompakt, max. 3 Tool-Zeilen + Details-Toggle), Permission-Dialog mit Risiko-Zeilen

- [ ] **Step 1: CSS-Klassen ergänzen**

```css
.agent-card { background: var(--surface-panel); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px 10px; margin: 6px 0; }
.agent-card-header { display: flex; gap: 8px; align-items: baseline; color: var(--text-primary); font-size: 0.85rem; }
.agent-card-dot { color: var(--accent); }
.agent-card-tools { color: var(--text-secondary); font-size: 0.8rem; margin: 4px 0 0 16px; }
.agent-card-tools li:nth-child(n+4) { display: none; }
.agent-card.open .agent-card-tools li { display: list-item; }
.agent-card-details-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.78rem; padding: 2px 0; }
.perm-risk-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 0.8rem; color: var(--text-secondary); margin: 8px 0; }
```

- [ ] **Step 2: Minimaler Render-Eingriff — Agent-Container bekommen `.agent-card` + Toggle-Button; `showPermissionPrompt` rendert Risiko/Sandbox/Network aus den vorhandenen Args (`risk`, `sandbox`, `network` falls vorhanden, sonst „—")**

- [ ] **Step 3: Run tests**

Run: `npm test` → fail weiterhin exakt die 16 bekannten

- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css App/renderer/script.js App/renderer/permission-dialog.js
gitleaks detect
git commit -m "feat(ui): kompakte Agent-Cards + Permission-Dialog nach Design-Spec"
```

---

### Task 5: Animations-Stufen + Status-Panel-Inhalt + Cleanup

**Files:**
- Modify: `App/renderer/index.html` (Settings-Select `animation-level`: minimal/subtle/normal/full)
- Modify: `App/renderer/style.css` (`[data-animation]`-Regeln + `prefers-reduced-motion`)
- Modify: `App/renderer/script.js` (Status-Panel füllen: AI/Sandbox/MCP/Git/Agents; Animations-Persistenz `florde-animation`)
- Modify: `App/renderer/style.css` (alte Theme-Blöcke/Dead-CSS entfernen — nur was sicher ungenutzt ist, per `rg` geprüft)
- Test: Suite + ID-Guard + manuelle Klick-Pfade

**Interfaces:**
- Consumes: Task 2–4
- Produces: `data-animation` auf `<html>`; `#status-panel`-Inhalt; finale Suite

- [ ] **Step 1: Settings-Select + Persistenz**

```html
<label>Animation
  <select id="animation-level">
    <option value="minimal">Minimal</option>
    <option value="subtle" selected>Subtle</option>
    <option value="normal">Normal</option>
    <option value="full">Full</option>
  </select>
</label>
```

```js
function applyAnimationLevel(level) {
  const allowed = ['minimal', 'subtle', 'normal', 'full'];
  const v = allowed.includes(level) ? level : 'subtle';
  document.documentElement.setAttribute('data-animation', v);
  try { localStorage.setItem('florde-animation', v); } catch {}
}
// init: applyAnimationLevel(localStorage.getItem('florde-animation') || 'subtle')
// save: in Settings-Save mitziehen: saveSettingsToDisk({ animation: document.getElementById('animation-level').value })
```

- [ ] **Step 2: CSS-Regeln**

```css
[data-animation="minimal"] * { animation: none !important; transition: none !important; }
[data-animation="subtle"] .agent-card, [data-animation="subtle"] .modal { transition: opacity 120ms ease; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

- [ ] **Step 3: Status-Panel-Inhalt rendern (vorhandene Quellen nutzen: Provider-Status, Sandbox-Backend, MCP-Serverliste, Git-Status, Agent-Count)**

- [ ] **Step 4: Full verification**

Run: `npm test` → fail exakt die 16 bekannten; `node --check renderer/script.js`; Gitleaks; `git status`/`git diff` prüfen
Manuell: Chat senden, Provider/Modell wechseln, Settings speichern, Panel togglen, Theme wechseln, Permission Allow/Cancel

- [ ] **Step 5: Commit**

```bash
git add -A  # NUR nach git-status-Review: keine Secrets/Build-Artefakte
gitleaks detect
git commit -m "feat(ui): Animations-Stufen + Status-Panel + CSS-Cleanup (Rewrite komplett)"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

1. **Spec-Coverage:** §1 Shell → Task 3; §2 Tokens/Themes → Task 2; §3 Chat/Permission → Task 4; §4 Status/Animation/A11y → Task 3+5 (Focus-States in Task 3-CSS, Rest via Token-Kontraste); §5 Absicherung → Task 1+5. Lücke geschlossen: Focus-States explizit in Task 3 enthalten.
2. **Placeholder-Scan:** Keine TBD/TODOs; alle Code-Blöcke konkret mit Datei + Zeilen-Hinweis. Einzig `LayoutManager.togglePanel` existiert ggf. noch nicht → Task 3 Step 3 enthält Fallback (`data-active-panel`), kein Blocker.
3. **Typ-Konsistenz:** Theme-Namen `florde-dark|florde-light|florde-midnight` überall identisch; Persistenz-Keys `florde-rail-panels`, `florde-animation` je einmal definiert; `migrateTheme` in `window.__theme` für `script.js`-Fallbacks verfügbar.
