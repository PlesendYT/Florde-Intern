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

---

## Round 2 (User-Feedback 2026-09-11): Rail funktional, Top-Toolbar weg, ALLE Bereiche

Befund: Rail-Buttons rufen `LayoutManager.togglePanel` (existiert nicht) — Fallback wirkungslos.
Alte `.titlebar-center`-Button-Wolke (~20 Buttons) noch sichtbar. Settings, Startmenü,
Git/Docker/Terminal-Panels und Modals noch im alten Look.

### Task 6: Rail-Verdrahtung + Top-Toolbar aufräumen

**Files:**
- Modify: `App/renderer/script.js` (Rail-Handler ersetzen, ~Zeilen 4821-4840)
- Modify: `App/renderer/style.css` (`.titlebar-center` ausblenden)
- Modify: `App/renderer/index.html` (nur `type="button"` ergänzen, KEINE ID ändern/entfernen)
- Test: `renderer/__tests__/shell-ids.test.js` (grün) + Suite

**Interfaces:**
- Consumes: existierende Toggle-Handler (z. B. `btn-terminal-toggle`, `btn-mode-editor/chat`)
- Produces: funktionierende Rail (Klick = echte Panel-Umschaltung), leere Top-Toolbar

- [ ] **Step 1: Mapping recherchieren** — Für jedes `data-panel` (chat, editor, terminal, git, sandbox, mcp, tools) den existierenden Umschalt-Mechanismus finden (Button-Handler, `EditorMode`, Panel-`hidden`-Klasse). Nur Mechanismen verwenden, die bereits existieren.
- [ ] **Step 2: Handler ersetzen** — Delegations-Pattern wie die Keybindings (z. B. `document.getElementById('btn-terminal-toggle').click()`):

```js
const RAIL_TARGETS = {
  chat: 'btn-mode-chat', editor: 'btn-mode-editor', terminal: 'btn-terminal-toggle',
  // git/sandbox/mcp/tools: im Step 1 gefundene Button-IDs eintragen
};
document.querySelectorAll('#icon-rail .rail-btn[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = RAIL_TARGETS[btn.dataset.panel];
    const el = target && document.getElementById(target);
    if (el) el.click();
    document.querySelectorAll('#icon-rail .rail-btn[data-panel]').forEach(b => b.classList.toggle('active', b === btn));
    try {
      const open = JSON.parse(localStorage.getItem('florde-rail-panels') || '["chat","editor"]');
      const panel = btn.dataset.panel;
      const next = open.includes(panel) ? open.filter(p => p !== panel) : [...open, panel];
      localStorage.setItem('florde-rail-panels', JSON.stringify(next));
    } catch {}
  });
});
document.getElementById('rail-settings')?.addEventListener('click', () => document.getElementById('btn-settings')?.click());
```

`active`-Klasse = zuletzt geklickt (löst T3M1 auf: Persistenz-Array bleibt Membership, Visual ist Single-Select).
- [ ] **Step 3: `.titlebar-center` ausblenden** (IDs bleiben im DOM → Guard grün):

```css
.titlebar-center { display: none; }
```

Theme-Wechsel bleibt über Settings + Status-Panel erreichbar; Fullscreen/Export/Rest über Command Palette (`btn-cmd-palette`) und Shortcuts — als Kommentar in CSS/JS dokumentieren.
- [ ] **Step 4: Verifizieren** — `node --check renderer/script.js`; Guard grün; `npm test` → exakt die 16 bekannten Failures (`grep "^not ok"`); Gitleaks; diff/status.
- [ ] **Step 5: Commit**

```bash
git add App/renderer/script.js App/renderer/style.css App/renderer/index.html
gitleaks detect
git commit -m "feat(ui): Rail schaltet Panels wirklich, Top-Toolbar entfernt"
```

### Task 7: Full-Sweep A — Modals, Startmenü, Settings

**Files:**
- Modify: `App/renderer/style.css` (Hauptanteil), `App/renderer/permission-dialog.js` (pre-existing Hardcodes tokenisieren)
- Test: Suite + Guard

**Interfaces:**
- Consumes: Task-2-Tokens
- Produces: alle Modals + Startmenü + Settings im Quiet-Power-Look

- [ ] **Step 1: Bereiche restylen** — Startmenü (`#start-menu`), Settings-Modal, alle `.modal`-Dialoge (new-project, question, prompt, confirm, app-connect, keychain, plugin, plugin-docs, ai-router), Notifications/Toasts. Regeln: nur Task-2-Tokens, keine `box-shadow` (durch Border ersetzen), Radius ≤ 8px, `.btn`/`.btn-primary`-Klassen wiederverwenden statt neuer Button-Styles, `focus-visible` überall.
- [ ] **Step 2: `permission-dialog.js`-Hardcodes** (`background:#1e1e1e`, `#444`, `box-shadow`) auf Tokens umstellen (T4M4 einlösen).
- [ ] **Step 3: Keine neuen Hex-Farben** — danach prüfen:

```bash
rg -n "#[0-9a-fA-F]{3,8}\b" App/renderer/style.css | grep -v -e "^\s*[0-9]*:\s*\*" -e "--surface" -e "--text" -e "--border" -e "--accent" -e "--status" | head -n 20
```

Jeder Treffer außerhalb der Token-Blöcke (Zeilen ~10-84) muss ein Token werden oder begründet bleiben (Monaco/xterm-Overrides ausgenommen).
- [ ] **Step 4: Verifizieren** — Suite (16 bekannte), Guard, Gitleaks, diff/status.
- [ ] **Step 5: Commit**

```bash
git add App/renderer/style.css App/renderer/permission-dialog.js
gitleaks detect
git commit -m "feat(ui): Full-Sweep A — Modals, Startmenü, Settings im Quiet-Power-Look"
```

### Task 8: Full-Sweep B — Panels, Listen, Tabellen

**Files:**
- Modify: `App/renderer/style.css` (Hauptanteil)
- Test: Suite + Guard

**Interfaces:**
- Consumes: Task-2-Tokens
- Produces: alle Arbeits-Panels im Quiet-Power-Look

- [ ] **Step 1: Bereiche restylen** — Sidebar/File-Tree + Kontextmenü, Git-Panel + Unteransichten, Docker-Panel, Terminal-Panel, Browser-/Exec-/Output-Panels, Diff-Viewer, Tab-Bars (`file-tabs`, `chat-tab-bar`, `workspace-tab-bar`), File-Tabs, Search/Snippets/Command-Palette-Ergebnisse, Audit-/Management-/Notes-/Decisions-/Keybindings-/Subagents-/RAG-Ansichten, Tabellen, Scrollbars. Gleiche Regeln wie Task 7.
- [ ] **Step 2: Shadow/Radius-Sweep** — danach muss gelten:

```bash
rg -n "box-shadow" App/renderer/style.css | head -n 20
```

Erlaubt bleiben nur begründete Ausnahmen (Overlays/Modals wenn nötig — besser Border). Jede Ausnahme im Commit-Text nennen.
- [ ] **Step 3: Verifizieren** — Suite (16 bekannte), Guard, Gitleaks, diff/status.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css
gitleaks detect
git commit -m "feat(ui): Full-Sweep B — Panels, Listen, Tabellen im Quiet-Power-Look"
```

---

## Round 3 (User-Feedback 2026-09-11): Layout nach Design-Doc, Chat unangetastet

User: komplette UI = auch Layout (§3–§6), nicht nur Farben. Chat ist gut → TABU.
Chat-Tabu umfasst: `#chat-messages`, `#chat-input`, `#chat-tab-bar`, Provider/Modell-Row,
Agent-Cards, Permission-Dialog — weder Markup noch Behavior noch Styling anfassen.

### Task 9: Navigation nach Doc gruppieren + Workspace-Toggle

**Files:**
- Modify: `App/renderer/index.html` (Rail-Gruppen, KEINE ID ändern/entfernen)
- Modify: `App/renderer/style.css` (Gruppen-Trenner, Dichte)
- Modify: `App/renderer/script.js` (Workspace-Toggle nur falls Mechanismus existiert)
- Test: Suite + Guard

**Interfaces:**
- Consumes: bestehende Rail aus Task 3/6
- Produces: Rail in Doc-Reihenfolge mit 3 Gruppen + Trennern

- [ ] **Step 1: Rail umgruppieren** — Reihenfolge nach Doc §4: Chat, Workspace, Editor, Terminal — Trenner — Tools, MCP, Sandbox, Git — Trenner — Settings, Status. `Workspace`-Button toggelt die Datei-Sidebar (`#sidebar`) über deren existierenden Mechanismus (`btn-sidebar-toggle` falls vorhanden, sonst `hidden`-Toggle analog `toggleGitPanel`). Neue Trenner als `<div class="rail-divider">`, neue Buttons nur mit `type="button"` + `data-panel`.
- [ ] **Step 2: CSS** — `.rail-divider { height: 1px; background: var(--border-subtle); margin: 6px 8px; }`, Dichte niedrig–mittel (Rail bleibt 48px, kein Text-Label-Wildwuchs).
- [ ] **Step 3: RAIL_TARGETS/RAIL_PANELS** um `workspace` erweitern; Mapping im Kommentar dokumentieren.
- [ ] **Step 4: Verifizieren** — Guard grün; Suite 16 bekannte; Gitleaks; diff/status.
- [ ] **Step 5: Commit**

```bash
git add App/renderer/index.html App/renderer/style.css App/renderer/script.js
gitleaks detect
git commit -m "feat(ui): Rail nach Design-Doc gruppiert + Workspace-Toggle"
```

### Task 10: Panel-System mit Panel-Controls (§6)

**Files:**
- Modify: `App/renderer/index.html` (Panel-Control-Bar, KEINE ID ändern/entfernen)
- Modify: `App/renderer/style.css` (Bar + Panel-States)
- Modify: `App/renderer/script.js` (Toggle-Verdrahtung via existierende Mechanismen)
- Test: Suite + Guard

**Interfaces:**
- Consumes: existierende Panel-Toggles (terminal/docker/git/management)
- Produces: `#panel-control-bar` mit 6 Buttons, Klick öffnet/schließt Panels

- [ ] **Step 1: Control-Bar einfügen** — über dem Workspace-Bereich (NICHT im/über dem Chat-Panel):

```html
<div id="panel-control-bar" aria-label="Panels">
  <button type="button" data-opens="docker-panel">Docker</button>
  <button type="button" data-opens="terminal-panel">Terminal</button>
  <button type="button" data-opens="sandbox-panel">Sandbox</button>
  <button type="button" data-opens="git-panel">Git</button>
  <button type="button" data-opens="mcp-panel">MCP</button>
  <button type="button" data-opens="file-tree">Files</button>
</div>
```

Nur Panels verwenden, die im DOM existieren — vor dem Einfügen per `rg 'id="(docker-panel|terminal-panel|sandbox-panel|git-panel|mcp-panel|file-tree)" index.html` prüfen und Buttons auf existierende Ziele beschränken (fehlende weglassen + im Report nennen).
- [ ] **Step 2: Verdrahtung** — Klick ruft den jeweils existierenden Toggle auf (Delegation wie Task 6: vorhandene Button-`.click()` oder `hidden`-Toggle + Refresh). Sandbox/MCP nur falls echte Panels existieren — NICHT die Settings-Tabs duplizieren (die hängen bereits an der Rail).
- [ ] **Step 3: CSS** — Bar dezent (Surface-Panel, 1px Border oben, kleine Buttons, Radius ≤ 8px, Tokens only, `aria-pressed`-State auf aktivem Button).
- [ ] **Step 4: Verifizieren** — Guard grün; Suite 16 bekannte; Gitleaks; diff/status.
- [ ] **Step 5: Commit**

```bash
git add App/renderer/index.html App/renderer/style.css App/renderer/script.js
gitleaks detect
git commit -m "feat(ui): Panel-Control-Bar nach Design-Doc §6"
```

### Task 11: Visuelle Hierarchie + Dichte (§7, keine Shadows, Chat ausgenommen)

**Files:**
- Modify: `App/renderer/style.css` (nur Layout-Container, KEINE Chat-Selektoren)
- Test: Suite + Guard

**Interfaces:**
- Consumes: Task-2-Tokens
- Produces: 4 Ebenen Background → Surface → Raised → Overlay durchgängig

- [ ] **Step 1: Ebenen zuordnen** — App-Hintergrund → `--surface-background`; Sidebar/Rail/Panel-Container → `--surface-panel`; Cards/Popups/inner Panels → `--surface-raised`; Modals/Overlays bleiben (Task 7). Nur Container, deren aktuelle Farbe VORHER per Screenshot/DOM-Logik anders war, umstellen — keine Ratestöße bei Unsicherheit, dann liegenlassen + im Report nennen.
- [ ] **Step 2: Dichte** — Panel-Paddings auf 8–12px vereinheitlichen wo inkonsistent, Panel-Header kompakt (eine Zeile, kleine Schrift). Chat-Selektoren (`chat-*`, `agent-card`, `msg`, `perm-*`) strikt ausnehmen — per `git diff | grep "^[+-].*chat" ` muss 0 herauskommen (Ausnahme: `chat-tab-bar` aus Task 8 bleibt wie sie ist).
- [ ] **Step 3: Verifizieren** — Suite 16 bekannte; Guard; Chat-Diff-Check `git diff | grep -iE "^[+-].*(chat-msg|agent-card|permission-prompt|chat-input|chat-messages)"` muss leer sein; Gitleaks; diff/status.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css
gitleaks detect
git commit -m "feat(ui): visuelle Hierarchie + Dichte, Chat unangetastet"
```

---

## Round 4 (User-Feedback 2026-09-12): Echte Layout-Änderungen, Chat tabu

User-Befund (alle 5 am Code verifiziert): Sidebar kollabiert nicht vollständig,
Rail-Active wird nie initialisiert/gesynct, Animationen sind 2 Alibi-Zeilen,
Titlebar-Links unverändert, Gesamt-Layout strukturell gleich. Round 3 war zu
konservativ — Round 4 ändert Verhalten sichtbar. Chat-Tabu (Markup/Behavior/
Styling von allem mit `chat-*`, `agent-card`, `perm-*`) gilt weiter.

### Task 12: Sidebar-Kollaps + Rail-Active-Sync

**Files:**
- Modify: `App/renderer/style.css`, `App/renderer/script.js`
- Modify: `App/renderer/index.html` (nur falls nötig, KEINE ID ändern/entfernen)
- Test: Suite + Guard

- [ ] **Step 1: Echter Kollaps** — `#sidebar.hidden, #sidebar-resizer.hidden { display: none; }` plus `.main-area`/Nachbar per Flex auffüllen lassen (falls nötig `min-width: 0` prüfen). Bestand: Toggle in `script.js` (~4180) setzt nur Klassen — CSS-Seite fehlte/war löchrig.
- [ ] **Step 2: Active-Sync** — Beim Init `active`-Klasse aus `florde-rail-panels`/Defaults setzen (z. B. chat+editor aktiv wenn sichtbar); `aria-pressed` auf Rail-Buttons synchron zu `active` halten; Panel-Bar-Refresh (`refreshPanelBar`) auch bei Rail-Klicks aufrufen (T10-Minor einlösen).
- [ ] **Step 3: Verifizieren** — Guard grün; Suite 16 bekannte; Gitleaks; diff/status.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css App/renderer/script.js App/renderer/index.html
gitleaks detect
git commit -m "feat(ui): Sidebar kollabiert vollständig, Rail-Active synchron"
```

### Task 13: Titlebar verschlanken (Steuerung → Rail/Status)

**Files:**
- Modify: `App/renderer/style.css`, `App/renderer/script.js` (nur falls Handler nötig)
- Modify: `App/renderer/index.html` (nur `hidden`-Klassen/Attribute, KEINE ID ändern/entfernen)
- Test: Suite + Guard

- [ ] **Step 1: Duplikate raus** — `btn-mode-editor`/`btn-mode-chat` ausblenden (Rail kann das; IDs bleiben). `btn-settings` ausblenden (Rail hat es). Verwaiste `toolbar-scroll-left/right` ausblenden (T6M1 einlösen). Übrig oben: Projektname (klein), Privacy-Indikator, Save All, Menü, Theme nur via Settings/Status.
- [ ] **Step 2: `privacy-indicator` in Status-Nähe** — Knoten per JS ans Status-Panel/`status-dot`-Umfeld umhängen ODER per CSS in die Rail-Ecke ziehen, ohne seine `textContent`-Updates zu brechen (ID bleibt, nur Position). Falls Umhängen riskant: klein + dezent in Titlebar lassen + im Report begründen.
- [ ] **Step 3: Verifizieren** — Guard grün; Suite 16 bekannte; Gitleaks; diff/status.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css App/renderer/script.js App/renderer/index.html
gitleaks detect
git commit -m "feat(ui): Titlebar verschlankt, Steuerung in Rail/Status"
```

### Task 14: Echtes Animations-System

**Files:**
- Modify: `App/renderer/style.css` (Keyframes + Stufen)
- Test: Suite + `rg`-Nachweis der Stufen

- [ ] **Step 1: Keyframes** — `florde-fade-slide-in` (Panels/Modals/Toasts), `florde-fade` (Tabs), Rail-Active-Transition, Status-Punkt-Puls nur bei Aktivität. Ruhig: kurze Wege (2–4px), keine Bounces, kein Loop außer Status-Betriebsanzeige.
- [ ] **Step 2: Stufen** — minimal (alles aus, vorhanden lassen), subtle = Standard (120–150ms, opacity + max 2px), normal (200ms + 4px Slide), full (250ms + leichtes Stagger bei Listen). `prefers-reduced-motion` erzwingt minimal (vorhanden lassen/erweitern).
- [ ] **Step 3: Verifizieren** — `rg -n "florde-fade|data-animation" style.css` zeigt alle 4 Stufen; Suite; Guard; Gitleaks.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css
gitleaks detect
git commit -m "feat(ui): Animations-System mit 4 Stufen"
```

### Task 15: Struktur-Rest (Workspace-First, Dichte, Startmenü)

**Files:**
- Modify: `App/renderer/style.css`, ggf. `index.html`/`script.js` (KEINE ID ändern/entfernen, Chat tabu)
- Test: Suite + Guard + Chat-Hard-Gate aus Task 11

- [ ] **Step 1: Lücken schließen** — Startmenü-Layout straffen (Dichte, eine ruhige Spalte + Aktionen, kein Wildwuchs); `workspace-tab-bar` + Panel-Header auf eine kompakte Zeile; leere/optionale Bereiche erst bei Bedarf (bestehende `hidden`-Mechanismen nutzen, keine neuen Features).
- [ ] **Step 2: Chat-Hard-Gate** — `git diff | grep -iE "^[+-].*(chat-msg|agent-card|permission-prompt|chat-input|chat-messages)"` muss leer sein.
- [ ] **Step 3: Verifizieren** — Suite 16 bekannte; Guard; Gitleaks; diff/status.
- [ ] **Step 4: Commit**

```bash
git add App/renderer/style.css App/renderer/index.html App/renderer/script.js
gitleaks detect
git commit -m "feat(ui): Struktur-Rest Workspace-First, Chat unangetastet"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

1. **Spec-Coverage:** §1 Shell → Task 3; §2 Tokens/Themes → Task 2; §3 Chat/Permission → Task 4; §4 Status/Animation/A11y → Task 3+5 (Focus-States in Task 3-CSS, Rest via Token-Kontraste); §5 Absicherung → Task 1+5. Lücke geschlossen: Focus-States explizit in Task 3 enthalten.
2. **Placeholder-Scan:** Keine TBD/TODOs; alle Code-Blöcke konkret mit Datei + Zeilen-Hinweis. Einzig `LayoutManager.togglePanel` existiert ggf. noch nicht → Task 3 Step 3 enthält Fallback (`data-active-panel`), kein Blocker.
3. **Typ-Konsistenz:** Theme-Namen `florde-dark|florde-light|florde-midnight` überall identisch; Persistenz-Keys `florde-rail-panels`, `florde-animation` je einmal definiert; `migrateTheme` in `window.__theme` für `script.js`-Fallbacks verfügbar.
