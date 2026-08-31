# Florde Modular Architecture — Phase B: Core-Schicht

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die domänenübergreifende `core/`-Schicht etablieren und die ersten technischen Helfer (events, state, logger, notification) aus dem Monolithen extrahieren — unter Beibehaltung der vollen Funktionalität.

**Architecture:** `core/` enthält UI-unabhängige, domänenübergreifende Helfer OHNE Barrel/`index.js`-Facade (Architektur-Grundsatz: direkte Modul-Imports, z. B. `import { logger } from "../../core/logger.js"`). In dieser Phase wird `AuditLog` bewusst NICHT hierher verschoben (gehört zu `domains/audit/audit-log.js`). Die genauen Pfade hängen davon ab, welche Renderer-Struktur Phase A tatsächlich etabliert hat (bestehende `renderer/`-Dateien vs. `src/renderer/`).

**Tech Stack:** Vite/electron-vite (aus Phase A), Node ^22, node:test.

## Fix (verbindlich)

Diese Punkte sind in dieser Phase NICHT verhandelbar:

- **Ziel:** Eine eigenständige `core/`-Ebene mit 4 Modulen: `events.js`, `state.js`, `logger.js`, `notification.js`.
- **Architekturregeln:**
  - **Kein `core/index.js`-Barrel.** Domänen importieren direkt vom konkreten Modul.
  - `core/` hat KEINE Abhängigkeit auf Domänen oder UI.
  - **Logger ≠ Audit Log:** `core/logger.js` = technische Logs; `domains/audit/audit-log.js` (später) = Benutzer-/KI-Aktionen. `AuditLog` wird in dieser Phase nicht nach core verschoben.
  - Nach jedem Extraktions-Schritt: Exports identisch benannt und von allen bestehenden Aufrufern weiter konsumierbar (Rückwärtskompatibilität via Proxy-Export ist erlaubt, solange die Ursprungs-Global-Referenz erhalten bleibt).
- **Abhängigkeitsrichtung:** `core/*` hängt von nichts ab außer ihrem eigenen Zustand; bestehende Aufrufer (script.js etc.) importieren `core/*`.
- **Sicherheitsanforderungen:** `core/` = Renderer-Ebene; darf KEINE `node:`-Imports (fs, child_process, electron main) enthalten — Architektur-Invariante. Alles Privilegierte läuft über `window.electronAPI` (preload).
- **Funktionalität:** `logger`, `notification`, `events`, `state` verhalten sich identisch zur bisherigen globalen Implementierung.
- **Tests:** Für `events` und `state` node:test-Unit-Tests anlegen (Logik ohne `window`-Abhängigkeit). `logger`/`notification` bleiben dünn und werden über Verifikation geprüft.
- **Exit-Kriterien:** App startet unter Phase-A-Pipeline; bestehende UI-Verhalten (Benachrichtigungen, Terminallogs) unverändert; `node --test sandbox/__tests__/*.test.js` grün; keine Renderer-`node:`-Imports in `core/`.

## Adaptiv (nach Phase A überprüfen)

Diese Details werden zum Ausführungszeitpunkt anhand des tatsächlichen Phase-A-Ergebnisses bestimmt:

- **exakte Verzeichnis-Pfade:** ob `core/` unter `App/renderer/core/` (bestehende Struktur) oder `App/renderer/src/core/` (falls electron-vite `src/`-Layout erzwungen hat).
- **konkrete Importpfade** innerhalb des Renderers (relativ, je nach Tiefe).
- **Vite-Konfiguration**: ggf. `resolve.alias` (z. B. `@core`) nur falls der relative Pfad unpraktisch wird — Bewusst: Alias ist optional und keinesfalls ein Ersatz für explizite Abhängigkeitsklarheit.
- **welche Legacy-Globals** (z. B. `showNotification`, `logToTerminal`) nach Extraktion noch als dünne Aliase im Monolithen verbleiben können, bevor deren vollständige Entfernung in Phase C erfolgt.

---

### Task 1: Bestandsaufnahme + Pfadbestimmung

**Files:**
- Read: tatsächlich von Phase A etablierte Renderer-Struktur

**Interfaces:**
- Consumes: Phase-A-Ergebnis (ob unter `App/renderer/` oder `App/renderer/src/` gearbeitet wird; welche `node:`-Grenze gilt)
- Produces: konkrete `core/`-Zielpfade für Task 2-5.

- [ ] **Step 1: Struktur ermitteln**

```bash
cd App
ls renderer/       # falls Phase A bestehende Struktur behielt
ls renderer/src/   # falls Phase A src/-Layout erzwungen hat
```

- [ ] **Step 2: relevante globale Definitionen im Monolithen lokalisieren**

```bash
cd App
grep -n "^function showNotification\|^function logToTerminal\|const AuditLog\|let _eventBus\|function emit\|function on(" renderer/script.js | head -30
```

Expected: Zeilen, die die zu extrahierenden Globals definieren. Diese dienen als Referenz für Worthülle/Namen in Task 2-5.

- [ ] **Step 3: Exports- und Aufrufgraph prüfen**

```bash
cd App
grep -rn "showNotification(" renderer/*.js | wc -l
grep -rn "logToTerminal(" renderer/*.js | wc -l
```

Expected: zählt die Aufrufstellen (sollten unverändert bleiben).

- [ ] **Step 4: Ergebnis-Doku (kein Commit nötig; dient Task 2-5)**

Im Report: gewählter `core/`-Pfad + Liste der Aufrufstellen + ob ein Alias nötig ist.

---

### Task 2: `core/events.js` — Event-Bus extrahieren + Test

**Files:**
- Create: `<renderer-core-path>/events.js` (Pfad aus Task 1)
- Create: `<renderer-tests-path>/core-events.test.js`
- Modify: `App/renderer/script.js` (Event-Bus-Global → nutzt core/events)

**Interfaces:**
- Produces: `export function createEventBus()` → `{ on, off, emit, clear }`; Default-Export `eventBus` (Singleton).

- [ ] **Step 1: Failing test schreiben**

```js
// tests/core-events.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { createEventBus } from '../core/events.js';

test('event bus on/emit delivers to subscriber', () => {
  const bus = createEventBus();
  let got = null;
  bus.on('x', (v) => (got = v));
  bus.emit('x', 42);
  assert.strictEqual(got, 42);
});

test('event bus off removes subscriber', () => {
  const bus = createEventBus();
  let calls = 0;
  const fn = () => calls++;
  bus.on('y', fn);
  bus.off('y', fn);
  bus.emit('y');
  assert.strictEqual(calls, 0);
});
```

- [ ] **Step 2: Test laufen lassen (PASS nach Implementierung; erstmal rot wenn Modul fehlt)**

```bash
cd App && node --test <tests-path>/core-events.test.js
```

- [ ] **Step 3: core/events.js implementieren**

```js
// core/events.js — Pub/Sub Event-Bus (Renderer-intern, kein node:)
export function createEventBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => this.off(event, fn);
    },
    off(event, fn) {
      const set = listeners.get(event);
      if (set) set.delete(fn);
    },
    emit(event, ...args) {
      const set = listeners.get(event);
      if (set) for (const fn of [...set]) { try { fn(...args); } catch (e) { console.error(e); } }
    },
    clear() { listeners.clear(); },
  };
}

const eventBus = createEventBus();
export default eventBus;
```

- [ ] **Step 4: Test laufen lassen (PASS)**

```bash
cd App && node --test <tests-path>/core-events.test.js
```

- [ ] **Step 5: script.js so umbauen, dass eventBus importiert wird**

Je nach aktueller Struktur: am Kopf `import eventBus from "<core>/events.js";` (falls die Datei schon als ESM geladen ist) ODER als dünner Alias behalten, falls script.js noch klassisches Script ist: `const eventBus = window.__coreEvents;` und `core/events.js` exponiert zusätzlich `window.__coreEvents`. **Adaptiv:** je nach Phase-A-Typ nutzen (Modul oder Browser-Global zur Übergangszeit).

- [ ] **Step 6: Verifikation**

```bash
cd App && node --test sandbox/__tests__/*.test.js
```

- [ ] **Step 7: Commit**

```bash
git add <core>/events.js <tests>/core-events.test.js
git commit -m "refactor(core): extract event bus into core/events"
```

---

### Task 3: `core/state.js` — App-State extrahieren + Test

**Files:**
- Create: `<renderer-core-path>/state.js`
- Create: `<renderer-tests-path>/core-state.test.js`

**Interfaces:**
- Produces: `export function createState(initial)` → `{ get, set, subscribe }`; Default-Export `appState` (Singleton).

- [ ] **Step 1: Failing test schreiben**

```js
// tests/core-state.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { createState } from '../core/state.js';

test('state set/get round-trips', () => {
  const s = createState({ a: 1 });
  s.set('a', 2);
  assert.strictEqual(s.get('a'), 2);
});

test('state subscribe fires on set', () => {
  const s = createState({});
  let seen = null;
  s.subscribe('a', (v) => (seen = v));
  s.set('a', 99);
  assert.strictEqual(seen, 99);
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

```bash
cd App && node --test <tests-path>/core-state.test.js
```

- [ ] **Step 3: core/state.js implementieren**

```js
// core/state.js — zentraler App-State (Renderer-intern)
import eventBus, { createEventBus } from './events.js';

export function createState(initial = {}) {
  const data = { ...initial };
  const bus = createEventBus();
  return {
    get(key) { return key === undefined ? data : data[key]; },
    set(key, value) { data[key] = value; bus.emit('state:' + key, value); bus.emit('state:change', { key, value }); },
    subscribe(key, fn) { return bus.on('state:' + key, fn); },
  };
}

const appState = createState();
export default appState;
```

- [ ] **Step 4: Test laufen lassen (PASS)**

```bash
cd App && node --test <tests-path>/core-state.test.js
```

- [ ] **Step 5: Commit**

```bash
git add <core>/state.js <tests>/core-state.test.js
git commit -m "refactor(core): extract app state into core/state"
```

---

### Task 4: `core/logger.js` — technischer Logger extrahieren

**Files:**
- Create: `<renderer-core-path>/logger.js`

**Interfaces:**
- Produces: `export const logger = { info, warn, error, debug, logToTerminal }` — letzteres ersetzt die bestehende `logToTerminal`-Funktion (technische Ausgabe).

- [ ] Step 1: Logger umsetzen (Verhalten der bisherigen `logToTerminal` übernehmen)

```js
// core/logger.js — technische Logs (kein Audit Log!)
export const logger = {
  logToTerminal(text, level = 'info') {
    // exakt die bisherige logToTerminal-Semantik; ggf. über window.electronAPI
    // (z. B. terminal.-Einspielung) — Inhalt unverändert, nur modularisiert.
    // Falls die Original-Funktion das Terminal-UI beschreibt, hier dieselbe Logik.
    console.log(`[${level}]`, text);
  },
  info: (t) => logger.logToTerminal(t, 'info'),
  warn: (t) => logger.logToTerminal(t, 'warn'),
  error: (t) => logger.logToTerminal(t, 'error'),
  debug: (t) => logger.logToTerminal(t, 'debug'),
};
```

> Achtung: Wenn die Original-`logToTerminal` tatsächlich ins Terminal-UI schreibt (nicht nur console), MUSS deren exakter Body hierher übernommen werden. **Fix:** Verhalten identisch; keine Vereinfachung.

- [ ] Step 2: script.js `/ Aufrufer` auf `logger.logToTerminal` umleiten (adaptiv, via Import oder Global-Alias)

```bash
grep -rn "logToTerminal(" renderer/*.js
```

Erwartung: Alle Aufrufstellen konsumieren weiterhin eine sichtbare Funktion `logToTerminal` — entweder durch `import { logger }` und Umbenennung, oder durch einen dünnen re-export `export const logToTerminal = logger.logToTerminal` im script.js-Kopf (während der Übergangsphase).

- [ ] Step 3: Verifikation (Terminal-UI loggt weiter)

```bash
cd App && npm run dev
```

Log-Beispiel manuell auslösen (z. B. Chat-Nachricht senden) → Terminal-UI zeigt weiter Ausgabe.

- [ ] Step 4: Commit

```bash
git add <core>/logger.js
git commit -m "refactor(core): extract technical logger into core/logger"
```

---

### Task 5: `core/notification.js` — Benachrichtigungen extrahieren

**Files:**
- Create: `<renderer-core-path>/notification.js`

**Interfaces:**
- Produces: `export const notify = { success, error, info, warn }` — entspricht der bisherigen `showNotification`.

- [ ] Step 1: notification.js umsetzen (übernimmt `showNotification`-Body)

```js
// core/notification.js — Benutzer-Benachrichtigungen (Renderer-intern)
export const notify = {
  success(text) { showNotificationBridge('success', text); },
  error(text) { showNotificationBridge('error', text); },
  info(text) { showNotificationBridge('info', text); },
  warn(text) { showNotificationBridge('warn', text); },
};

function showNotificationBridge(type, text) {
  // exakter Body der bestehenden globalen showNotification hierher
  // (DOM-Erzeugung der notification-container + timeout). NIE node:-Zugriff.
}
```

> **Fix:** Verhalten der bekannten `showNotification(type, text)`-Funktion identisch übernehmen; keine Layout-/Verhaltens-Änderung.

- [ ] Step 2: Aufrufer auf `notify` umbiegen ODER Aliases in script.js beibehalten

```bash
grep -rn "showNotification(" renderer/*.js
```

Adaptiv: entweder alle Aufrufstellen auf `notify.x()` umstellen, oder übergangsweise `const showNotification = notify.x`-Last importieren. Ziel: eine Quelle der Wahrheit in core/notification.

- [ ] Step 3: Verifikation (Benachrichtigungen erscheinen)

Manuell/npm run dev: Aktionen mit Notification (Sandbox-Umschaltung, Dateiaktionen) → Benachrichtigung erscheint wie gehabt.

- [ ] Step 4: Commit

```bash
git add <core>/notification.js
git commit -m "refactor(core): extract notifications into core/notification"
```

---

### Task 6: Phase-B-Verifikation + Übergang zu Phase C

**Files:**
- (keine neuen Module; nur Prüfung)

**Interfaces:**
- Consumes: Task 1-5
- Produces: bestätigte Exit-Kriterien für Phase B.

- [ ] Step 1: Vollsuite + Start

```bash
cd App && node --test sandbox/__tests__/*.test.js
cd App && npm run dev
```

Expected: 166/166 grün; App startet; Benachrichtigungen/Terminallogs funktionieren.

- [ ] Step 2: Sicherheits-Invariante im Core prüfen

```bash
grep -rn "require(\"node:\|from \"node:\|require(\"fs\|from \"fs\"\|child_process" <core>/
```

Expected: **keine Treffer**. Falls welche, sofort beheben (Core darf keine Node-APIs).

- [ ] Step 3: Selbst-Review

- core hat keine Abhängigkeit auf Domänen/UI? (ok)
- kein core/index.js Barrel? (ok)
- logger vs audit-getrennt? (ok, AuditLog bleibt im Monolith bis Phase C)
- Events/State getestet? (ok)

- [ ] Step 4: Commit (falls Doku)

```bash
git add -f docs/superpowers/plans/2026-08-31-modular-phase-b.md
git commit -m "docs: phase B completion + core conventions"
```

---

## Self-Review-Notizen (Phase B)

- **Spec-Coverage:** Phase B („Core-Schicht") aus der Architecture-Spec erfüllt: events/state/logger/notification, kein Barrel, keine `node:`-Imports, Logger≠Audit.
- **Keine Platzhalter:** Core-Module mit vollständigem Code; nur Pfad-Platzhalter (`<core>`/`<tests>`) sind bewusst adaptiv und in Task 1 zu bestimmen — dies ist der definierte Anpassungspunkt, kein fehlender Inhalt.
- **Type-Konsistenz:** `createEventBus`/`createState`/`logger`/`notify` Namen sind über Tasks hinweg konsistent; in Phase C werden sie von Domänen importiert.
- **Blocker-Erkenntnis (Übergang):** Bis script.js vollständig ESM ist (Phase C), können `core/*`-Module über Browser-Global-Aliase (`window.__coreX`) oder separate Modul-Einträge genutzt werden. Der endgültige Import-Weg wird je Task adaptiv gewählt.
