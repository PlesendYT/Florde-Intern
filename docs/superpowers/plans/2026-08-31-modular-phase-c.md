# Florde Modular Architecture — Phase C: Renderer-Domänen-Extraktion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die große Renderer-Datei (aktuell `script.js`, ~11k Zeilen) durch klare **Domänen-Extraktion** in eigenständige Module zerlegen — zuerst nach klarster Domänengrenze, Xterm/Terminal zuletzt — wobei die App nach jedem Task voll funktionsfähig bleibt.

**Architecture:** Jede Domäne wird ein eigenes Modul unter `domains/<feature>/`, das über **explizite ESM-Imports** (kein core/index.js-Barrel) auf die `core/`-Module aus Phase B zugreift. Der ursprüngliche Monolith wird schrittweise zum dünnen Orchestrator, der Module importiert und deren öffentlichen Funktionen aufruft. Reihenfolge nach Spec-Phase C: **klarste Domänengrenze zuerst, Xterm/Terminal zuletzt** (~2.3k Zeilen, stark gekoppelt).

**Tech Stack:** Vite/electron-vite (Phase A), core/ aus Phase B, Node ^22, node:test.

## Fix (verbindlich)

- **Ziel:** Alle in der Renderer-`script.js` markierten Domänen-Sektionen (AUDIT LOG, DYNAMIC TOOLS, AI PROVIDERS, CHAT SESSIONS, WORKSPACE MANAGER, PERMISSION, SYSTEM PROMPT, TASK ROUTER, SETTINGS, THEME, SANDBOX, PROJECT, PLUGIN MARKETPLACE, TERMINAL, etc.) werden zu eigenständigen Modulen. Kein Funktions- oder Verhaltensverlust.
- **Architekturregeln:**
  - **Domänen importieren nur aus `core/*`** (direkt, kein Barrel) und ggf. untereinander über explizite ESM-Imports **nur wo die Kopplung gerechtfertigt** ist. UI-Domänen hängen NICHT von anderen UI-Domänen ab, wo das vermeidbar ist.
  - **Kein `window.Florde`-God-Objekt** und kein `core/index.js`.
  - Nach jedem Task: ursprüngliche globale Referenzen (falls Aufrufer außerhalb der Domäne existieren) als dünne Aliase erhalten, bis die letzte Domäne extrahiert ist. Danach Aliase entfernen.
  - **Privilege-Invariante:** Domänen nutzen NIEMALS `node:`-Imports (fs/shell etc.) direkt; ALLES läuft über `window.electronAPI` (preload) → IPC → main.
- **Abhängigkeitsrichtung:** `domains/* → core/*`; `domains/* → window.electronAPI`; nie `core/* → domains/*`.
- **Sicherheitsanforderungen:** Kein `node:` im Renderer (Architektur-Invariante). Kern: Domänen halten die Schnittstelle exakt so, dass sie über Preload/IPC arbeiten; Shell-Funktionen bleiben in `main/services/*` (Phase D).
- **Funktionalität:** Jede Domäne verhält sich identisch zur bisherigen Monolith-Implementierung (TDD wenn Logik ohne DOM testbar; sonst Verifikation via Start/Manuell).
- **Tests:** Für domänen-Pure-Logik (Provider-Parsing, Task-Router-Klassifizierung, Status-Berechnung) node:test anlegen. DOM/UI-Domänen werden funktional verifiziert.
- **Exit-Kriterien:** `script.js` ist ein dünner Orchestrator (keine große Domänen-Logik mehr); Xterm als letzte Domäne extrahiert; App voll funktionsfähig; `node --test sandbox/__tests__/*.test.js` grün; keine `node:`-Imports im Renderer.

## Adaptiv (nach Phase B überprüfen)

- **exakte Verzeichnis-Pfade:** `domains/` unter `renderer/` bzw. `renderer/src/` (je nach Phase-A-Layout).
- **konkrete Importpfade** zu `core/*` (relativ je nach Tiefe) und zu `domains/*`.
- **welche `script.js`-Zeilen** aktuell die jeweilige Domäne enthalten (Zeilennummern verschieben sich durch Phase-B-Edits); die Sektion muss zur Ausführungszeit per `// ====`-Marker lokalisiert werden (siehe Task 1).
- **ob bereits extrahierte Module** als Browser-Global-Alias oder echter ESM-Import konsumiert werden — je nachdem, ob `script.js` inzwischen Modul-Eintrag ist.
- **Vite/anpassungen:** ggf. dynamische Imports (`import()`), wenn das Laden einzelner Domänen lazy sein soll (z. B. Marketplace/Sandbox erst bei Bedarf).

---

### Task 0: Sektions-Inventur (Bestandsaufnahme, bindend für alle Tasks)

**Files:**
- Read: `App/renderer/script.js`

**Interfaces:**
- Consumes: Phase-B-Ergebnis (finale Pfade)
- Produces: verbindliche Liste von Domänen in Extraktionsreihenfolge (klarste Grenze zuerst, Terminal zuletzt).

- [ ] Step 1: Sektionen markieren

```bash
cd App
grep -n "// ====================" renderer/script.js
```

Expected: Liste aller Sektions-Marker mit Zeilennummern. Diese bildet die Domänenliste.

- [ ] Step 2: Reihenfolge festlegen (fixed gemäß Spec)

Domänen in dieser Reihenfolge extrahieren (klarste Grenze zuerst, xterm last), adaptiv an die tatsächlichen Marker angepasst:
1. Audit Log (falls als eigenständig trennbar)
2. DYNAMIC TOOLS / TOOL-REGISTRY
3. AI PROVIDERS (Provider-Parsing getestet)
4. CHAT SESSIONS
5. WORKSPACE MANAGER
6. PERMISSION
7. SYSTEM PROMPT
8. TASK ROUTER (Klassifizierung getestet)
9. SETTINGS
10. THEME
11. SANDBOX
12. PROJECT
13. PLUGIN MARKETPLACE
14. TERMINAL/XTERM (zuletzt, ~2.3k Zeilen)

- [ ] Step 3: Ergebnis als Doku (kein Commit nötig)

---

### Task 1: Audit-Log-Domäne extrahieren

**Files:**
- Create: `<domains-path>/audit/audit-log.js`
- Modify: `App/renderer/script.js`

**Interfaces:**
- Produces: `export function logAudit(entry)`, `export function getAuditEntries()`, `export function clearAudit()` — dasselbe Verhalten wie die bisherigen `AuditLog.*`-Funktionen des Monolithen.

- [ ] Step 1: bisherige AuditLog-Referenzen lokalisieren

```bash
cd App
grep -n "AuditLog\.\|auditLog(" renderer/script.js | head -30
```

- [ ] Step 2: domänen-Modul erstellen

Extrahiere den kompletten bisherigen AuditLog-Block (der über `window.electronAPI`/IPC oder lokal persistiert) in `domains/audit/audit-log.js`, exportiert als `logAudit`, `getAuditEntries`, `clearAudit` mit identischer Logik. **Fix:** Speichermechanismus unverändert (nicht vereinfachen).

- [ ] Step 3: Aufrufer im Monolithen auf neues Modul umstellen ODER dünne Aliase

```js
// im Monolithen-Kopf, falls nötig übergangsweise:
const AuditLog = { log: logAudit, getEntries: getAuditEntries, clear: clearAudit };
```
Alle bisherigen `AuditLog.*`-Aufrufe bleiben so gültig.

- [ ] Step 4: Verifikation (Manuell/Start)

Chat-/Tool-Aktion → Audit-Eintrag erscheint wie gehabt; UI-Log unverändert.

- [ ] Step 5: Commit

```bash
git add <domains>/audit/audit-log.js
git commit -m "refactor(domains): extract audit log into domains/audit"
```

---

### Task 2: AI-Provider-Domäne extrahieren (mit TDD)

**Files:**
- Create: `<domains-path>/ai/providers.js`
- Create: `<tests-path>/providers.test.js`
- Modify: `App/renderer/script.js`

**Interfaces:**
- Produces: `export function parseProviderConfig(raw)`, `export function listActiveProviders()`, `export function classifyProvider(input)`.

- [ ] Step 1: Failing test

```js
// tests/providers.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyProvider } from '../domains/ai/providers.js';

test('classifyProvider recognizes known vendor by keyword', () => {
  const r = classifyProvider({ name: 'ollama default', baseUrl: 'http://localhost:11434' });
  assert.strictEqual(r.kind, 'ollama');
});

test('parseProviderConfig extracts baseUrl from settings', () => {
  const cfg = parseProviderConfig({ baseUrl: 'http://x:8080', apiKey: '' });
  assert.strictEqual(cfg.baseUrl, 'http://x:8080');
});
```

> Falls die Monolith-Logik andere Signaturen hat, Tests auf die REALEN Funktionen anpassen (die vorliegenden sind repräsentativ; adaptiv an tatsächliche Namen).

- [ ] Step 2: Test rot

```bash
cd App && node --test <tests>/providers.test.js
```

- [ ] Step 3: Implementieren (Monolith-Provider-Logik nach domains/ai/providers.js; getestete Signatur)

- [ ] Step 4: Test grün

```bash
cd App && node --test <tests>/providers.test.js
```

- [ ] Step 5: Aufrufer im Monolithen dünn verdrahten + Verifikation

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run dev
```

- [ ] Step 6: Commit

```bash
git add <domains>/ai/providers.js <tests>/providers.test.js
git commit -m "refactor(domains): extract AI provider logic with tests"
```

---

### Task 3: Task-Router-Domäne extrahieren (mit TDD)

**Files:**
- Create: `<domains-path>/tasks/router.js`
- Create: `<tests-path>/router.test.js`
- Modify: `App/renderer/script.js`

**Interfaces:**
- Produces: `export function classifyTask(message)` → Ergebnis, das `_taskClassification`-Logik ersetzt; `export function routeToExecutor(classification)`.

- [ ] Step 1: Failing test

```js
// tests/router.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyTask } from '../domains/tasks/router.js';

test('classifyTask detects sandbox intent', () => {
  const c = classifyTask('starte eine sandbox mit ubuntu');
  assert.strictEqual(c.intent, 'sandbox');
});

test('classifyTask defaults to chat for unknown', () => {
  const c = classifyTask('hallo wie geht es dir');
  assert.strictEqual(c.intent, 'chat');
});
```

> Adaptiv: auf die REALEN Muster/Begriffe der vorhandenen `_taskClassification` abstimmen.

- [ ] Step 2: rot → Step 3: implementieren (Monolith-Klassifikator nach domains/tasks/router.js) → Step 4: grün

```bash
cd App && node --test <tests>/router.test.js
```

- [ ] Step 5: Verdrahten + Vollsuite + Start

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run dev
```

- [ ] Step 6: Commit

```bash
git add <domains>/tasks/router.js <tests>/router.test.js
git commit -m "refactor(domains): extract task router logic with tests"
```

---

### Task 4: Weitere Domänen extrahieren (Pattern)

**Files:**
- Create: `<domains-path>/<feature>/index-oder-module>.js` je Domäne
- Modify: `App/renderer/script.js`

**Interfaces / Pattern** (für jede weitere Domäne in Reihenfolge aus Task 0):
- Mit reiner Logik → TDD-Modul + node:test (wie Task 2/3).
- Mit überwiegend DOM/UI → Modul exportiert `init(DOMRoots, electronAPI)`; Aufruf im Monolithen-Orchestrator; Verifikation per Start.

- [ ] Step 1: Für jede Domäne (SANDBOX, CHAT SESSIONS, WORKSPACE MANAGER, PERMISSION, SYSTEM PROMPT, SETTINGS, THEME, PROJECT, PLUGIN MARKETPLACE):
  - Sektion im Monolithen lokalisieren (Marker aus Task 0)
  - in `<domains>/<feature>/` auslagern
  - Exports definieren (adaptiv an reale Aufrufer)
  - Aufrufer im Monolithen auf die Modul-Imports umstellen; ggf. dünne Alias-Global übergangsweise
  - Vollsuite + `npm run dev` Grün-Check je Domäne

- [ ] Step 2: Commit je Domäne

```bash
git add <domains>/<feature>/
git commit -m "refactor(domains): extract <feature> into domains/<feature>"
```

---

### Task 5: Xterm/Terminal als LETZTE Domäne extrahieren

**Files:**
- Create: `<domains-path>/terminal/xterm.js` (und `html.js`/`fit.js` je nach Aufteilung)
- Modify: `App/renderer/script.js`, `App/renderer/index.html`

**Interfaces:**
- Produces: `export function createTerminal(container)` → Handles mit `write`, `resize`, `onData`, `dispose`; nutzt `@xterm/xterm` Import (statt globalem Tag).

- [ ] Step 1: xterm-Wrapper als Modul mit `@xterm/xterm`-Import erstellen

Die globale `XTerm`/`FitAddon`-Nutzung aus dem Monolithen in `domains/terminal/` verlagern; die ~2.3k Zeilen Terminal-Code strukturiert exportieren. Index.html: globales xterm-Script-Tag entfernen (Bundle übernimmt per Import).

- [ ] Step 2: script.js-Terninalaufrufe verdrahten; globales xterm-Tag aus index.html entfernen

- [ ] Step 3: Verifikation (Terminal öffnen, PTY/Docker-Shell rendert, Fit funktioniert, Web-Links)

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run dev
```

- [ ] Step 4: Commit

```bash
git add <domains>/terminal/
git commit -m "refactor(domains): extract xterm terminal as final domain"
```

---

### Task 6: Monolith-Entschlackung + Abschluss

**Files:**
- Modify: `App/renderer/script.js`

**Interfaces:**
- Consumes: Task 1-5
- Produces: `script.js` als dünner Orchestrator.

- [ ] Step 1: übrig gebliebene dünne Alias-Globals entfernen (alle Aufrufer inzwischen Modul-Importe)

```bash
grep -n "const AuditLog =\|const eventBus =\|const logToTerminal =\|const showNotification =" renderer/script.js
```

Erwartung: keine (alle via Import). Selektiv verbleibende entfernen.

- [ ] Step 2: script.js auf Orchestrator-Rolle prüfen (kein großer Domänen-Block mehr, nur Init + Verdrahtung)

- [ ] Step 3: Vollverifikation

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run dev
```

- [ ] Step 4: Sicherheits-Invariante renderer-weit prüfen

```bash
grep -rn "require(\"node:\|from \"node:\|child_process\|\"fs\"" renderer/domains/ renderer/core/
```

Expected: keine Treffer. `window.electronAPI`-Nutzung weiter die einzige Grenze.

- [ ] Step 5: Commit + Doku

```bash
git add App/renderer/
git add -f docs/superpowers/plans/2026-08-31-modular-phase-c.md
git commit -m "refactor(domains): complete renderer domain extraction; script.js is now thin orchestrator"
```

---

## Self-Review-Notizen (Phase C)

- **Spec-Coverage:** Phase C („Renderer-Domänen") vollständig: alle Sektionen ausgelagert, Terminal/Xterm zuletzt, App durchgehend lauffähig.
- **Keine Platzhalter:** TDD-Code gestellt (Task 2/3); übrige via klares Pattern + Verdrahtung/Verifikation. Pfad-Platzhalter `<domains>/<tests>` sind definierte adaptive Anpassungspunkte.
- **Type-Konsistenz:** `core/*`-Namen aus Phase B referenziert; Domänen-Exports konsistent benannt; `window.electronAPI` bleibt einzige Grenze.
- **Blocker-Erkenntnis:** Solange `script.js` kein ESM-Modul ist, sind Domänen-Imports über Browser-Global-Aliase oder separate Modul-Einträge zu verdrahten — je Task adaptiv.
