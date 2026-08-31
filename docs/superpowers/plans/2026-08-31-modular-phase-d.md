# Florde Modular Architecture — Phase D: Main-Prozess (main.js → services + ipc)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Main-Prozess-Monolithen (`App/main.js`, ~1.5k Zeilen) in `main/services/*` (fachliche Dienste: Sandbox, Shell, Settings, DB, Translations, Snapshots, etc.) und `main/ipc/*` (dünne IPC-Handler, die nur als Vermittler zu Services fungieren) aufteilen. Am Ende ist `main.js` ein dünner Einstieg, der Services registriert, IPC-Handler bindet und `app.whenReady` orchestriert.

**Architecture:** `main/ipc/*` enthält ausschließlich IPC-Kanal-Mapping (ipcMain.handle → Service-Aufruf, Ergebnis-Form: `{ ok: true, ... }` / `{ ok: false, error }`). `main/services/*` bündelt die echte Logik (exakt die bestehende `sandbox/`-Struktur bleibt). `preload.js` bleibt die einzige Bridge und wird nicht funktional verändert (nur ggf. Pfad-/Import-Anpassung).

**Tech Stack:** electron-vite (Phase A), Node ^22, node:test.

## Fix (verbindlich)

- **Ziel:** `main.js` → dünner Einstieg; alle IPC-`ipcMain.handle`-Blockaden als `main/ipc/*`; alle Service-Logik in `main/services/*`.
- **Architekturregeln:**
  - **Kennt `main/ipc/*` die Services?** Ja, IPC-Handler rufen Services auf.
  - **Kennt `main/services/*` die IPC?** Nein — Services kennen kein `ipcMain`, kein `BrowserWindow` (außer wo nötig, klar dokumentiert), keine UI. Sie sind reine Funktionalität + fs/shell/DB/sandbox.
  - `main/ipc/*` enthält KEINE schwere Logik — nur Verdrahtung.
  - `main/index.js` (Einstieg) instanziiert Services und ruft `registerIpcHandlers(...)` auf.
  - **Privilege-Invariante bleibt:** Der Renderer erreicht diese Services NUR durch preload→IPC→main. Nichts Neues wird im Renderer exponiert.
  - Bestehende `sandbox/`-Implementierung (`App/sandbox/*`) bleibt unangetastet als Service, nur ihre Ein-/Bundenschnittstelle wird durch `main/services/*` referenziert.
- **Abhängigkeitsrichtung:** `main/index.js → main/ipc/* → main/services/*`; `main/index.js → main/services/*`; Services hängen nicht zurück auf IPC.
- **Sicherheitsanforderungen:** Gleiche Privilegien-Grenze wie bisher — nichts Neues im Renderer freigeben. Exisiterende Sandbox-/Shell-Pfade unverändert (kein Refactoring der Sicherheitslogik in dieser Phase, nur Umzug/Orchestrierung).
- **Funktionalität:** Jede IPC-Funktion verhält sich identisch; Response-Formate unverändert; `sandbox:switch` gibt weiter `{ ok, error }` zurück (bestehende Semantik).
- **Tests:** Für service-reine Logik (z. B. die bereits getesteten `sandbox/*`) weiter nutzen; für neue Service-Bündel, falls sie isolierte Logik enthalten, node:test. IPC-Handler sind dünn und werden funktional verifiziert.
- **Exit-Kriterien:** `main.js` (bzw. `src/main/index.js`) enthält nur noch Einstieg + `app.whenReady`-Orchestrierung; alle IPC in `main/ipc/*`; alle Services gelistet; Vollsuite grün; App über Phase-A-Pipeline startet; build/electron-builder ok.

## Adaptiv (nach Phase C überprüfen)

- **exakte Verzeichnis-Pfade:** `main/` eine Ebene über den bereits bestehenden `renderer/`-Modulen — genaue Lage (App-Wurzel oder `src/main/`) ergibt sich aus Phase A (`src/`-Layout oder bestehende Struktur).
- **konkrete Importpfade** nach `sandbox/*`, `preload.js`, `services/*`, `ipc/*`.
- **welche Legacy-Steuerungen** bereits durch die electron-vite-`out/`-Build gedeckt sind (main startet am Ende aus `out/main/`).
- **die aktuelle geordnete Liste der `ipcMain.handle`-Kanäle** (Zeilennummern aus `main.js`; verschieben sich mit Phase-A/-B-Edits).
- **ob `restoreSandboxBackend()` und andere Zustands-Init bereits in einen Service ausgelagert** oder im Einstieg verbleiben.

---

### Task 1: IPC-Kanal-Inventur + Service-Artefakt bestimmen

**Files:**
- Read: `App/main.js`

**Interfaces:**
- Consumes: Phase-A-Layout, Phase-C-Ergebnis
- Produces: verbindliche Liste aller IPC-Kanäle + Service-Bündel.

- [ ] Step 1: IPC-Kanäle listen

```bash
cd App
grep -n "ipcMain.handle\|ipcMain.on" main.js
```

Expected: Liste aller Register-Handler. Diese werden in `main/ipc/*` aufgeteilt (gruppiert: `sandbox.js`, `settings.js`, `file.js`, `shell.js`, `translation.js`, `db.js`, `system.js`, `misc.js` — nach Kanal-Präfix).

- [ ] Step 2: Service-Bündel + deren Abhängigkeiten bestimmen

```bash
cd App
grep -n "require(\|from \"\.\/sandbox" main.js | head -40
```

- [ ] Step 3: Ergebnis-Doku (kein Commit)

---

### Task 2: Sandbox-Service-Bündel + sandbox-IPC-Handler

**Files:**
- Create: `<main>/services/sandbox-service.js`
- Create: `<main>/ipc/sandbox.js`
- Modify: `<main>/index.js` (Einstieg)

**Interfaces:**
- Consumes: `App/sandbox/*` (bestehender Manager)
- Produces:
  - `services/sandbox-service.js`: `export class SandboxService { status(); switchBackend(type); setNetwork(n); getSettings(); ... }` delegiert an `sandboxManager`; hält `restoreSandboxBackend()`-Init-Logik.
  - `ipc/sandbox.js`: `export function registerSandboxIpc({ ipcMain, sandboxService })` registriert `sandbox:switch`, `sandbox:status`, `sandbox:config`, etc. mit bestehenden Kanalnamen + `{ ok }`-Format.

- [ ] Step 1: SandboxService erstellen

```js
// main/services/sandbox-service.js
import { sandboxManager } from '../../sandbox/manager.js';   // adaptiver Pfad

export class SandboxService {
  constructor() { this._manager = sandboxManager; }
  async status() { return this._manager.status(); }
  async trySwitch(type) { return this._manager.trySwitchBackend(type); }   // bestehende Semantik
  async setNetwork(n) { return this._manager.setNetwork(n); }
  async restore() { return this._manager.restoreSandboxBackend?.(); }
}
```
> **Fix:** delegiert exakt an die bestehende, bereits getestete `sandbox/`-Logik; keine Neuimplementierung.

- [ ] Step 2: sandbox-IPC registrieren

```js
// main/ipc/sandbox.js
export function registerSandboxIpc({ ipcMain, sandboxService }) {
  ipcMain.handle('sandbox:switch', async (_e, type) => sandboxService.trySwitch(type));
  ipcMain.handle('sandbox:status', async () => sandboxService.status());
  ipcMain.handle('sandbox:config', (_e, cfg) => sandboxService.setNetwork(cfg));
}
```
(Adapterpfade/Handler-Namen auf die reale Kanal-Liste aus Task 1 abstimmen.)

- [ ] Step 3: Einstieg (main/index.js) so erweitern, dass SandboxService + Handler registriert werden, REST vorerst im Einstieg

```js
// main/index.js (Ausschnitt)
import { SandboxService } from './services/sandbox-service.js';
import { registerSandboxIpc } from './ipc/sandbox.js';
const sandboxService = new SandboxService();
registerSandboxIpc({ ipcMain, sandboxService });
```
Die bisher im Einstieg bestehenden `sandbox:*`-Handler entfernen (jetzt über registerSandboxIpc).

- [ ] Step 4: Verifikation

```bash
cd App && npm run build:bundle && npm start
```
Sandbox-Umschaltung/Status in UI unverändert; Wiederherstellung beim Start funktioniert.

- [ ] Step 5: Commit

```bash
git add <main>/services/sandbox-service.js <main>/ipc/sandbox.js <main>/index.js
git commit -m "refactor(main): extract sandbox service + ipc handlers"
```

---

### Task 3: Settings/Translation-Service + IPC

**Files:**
- Create: `<main>/services/settings-service.js`, `<main>/services/translation-service.js`
- Create: `<main>/ipc/settings.js`, `<main>/ipc/translation.js`
- Modify: `<main>/index.js`

**Interfaces:**
- Consumes: bestehende Settings/Translation-Logik aus main.js
- Produces: Services + IPC-Registrierungen mit identischen Kanalnamen (z. B. `settings:get`, `settings:set`, `translation:getCache`, `translation:*`). Einstieg ruft beide `register...Ipc` auf.

- [ ] Step 1-3: analog Task 2 — Settings/Translation-Code aus main.js in Services, dünne IPC-Handler, Einstieg registriert.

- [ ] Step 4: Verifikation

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm start
```
Einstellungen laden/speichern + Übersetzung (i18n) funktionieren wie gehabt.

- [ ] Step 5: Commit

```bash
git add <main>/services/settings-service.js <main>/services/translation-service.js <main>/ipc/settings.js <main>/ipc/translation.js
git commit -m "refactor(main): extract settings + translation services and ipc"
```

---

### Task 4: Übrige Services + IPC (File, Shell, DB, System, Misc)

**Files:**
- Create: `<main>/services/{file-service,shell-service,db-service,system-service}.js`
- Create: `<main>/ipc/{file,shell,db,system,misc}.js`
- Modify: `<main>/index.js`

**Interfaces:**
- Produces: Services halten die echte Logik (ZIP-Export execSync, Datei-Lesarten, Shell-Aufrufe, DB-Queries, Snapshots, System-Info); `ipc/*` registrieren je Kanal-Präfix; Einstieg bindet alle Handler + Services.

- [ ] Step 1-3: analog Task 2 — für jede Kanal-Gruppe aus Task 1. Einstieg konsolidiert in `app.whenReady`: Services instanziieren → `register...Ipc(...)` für alle → `restoreSandboxBackend()` → `createWindow()`.

- [ ] Step 4: Vollverifikation + Sicherheit

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run build:bundle && npm start
```
Alle funktionalen Prüfungen (Sandbox, Settings, Dateiaktion, Terminal/PTY, DB) erklären identisch. Prüfen, dass IPC-Handler NUR im `main/ipc/*` liegen: `grep -rn "ipcMain.handle" <main>/index.js` → keine Treffer.

- [ ] Step 5: Commit

```bash
git add <main>/services/ <main>/ipc/
git commit -m "refactor(main): extract remaining services + ipc; main.js is thin entry"
```

---

### Task 5: main.js-Entschlackung + Struktur-Umzug auf src/

**Files:**
- Modify: `<main>/index.js` (Anpassung der restlichen Main-Logik: window-Erzeugung, app-Events)
- Modify: `App/package.json` (`main`-Feld, falls Struktur geändert)

**Interfaces:**
- Consumes: Task 1-4
- Produces: `<main>/index.js` = rein Einstieg/Orchestrierung; bei `src/`-Struktur sind alle main-Teile unter `src/main/`.

- [ ] Step 1: restlichen Main-Code sichten und dünn halten (Window-Erzeugung, Menu, app-Events; KEINE ipcMain.handle/Service-Logik mehr)

- [ ] Step 2: ggf. main-Pfad in package.json anpassen

```json
  "main": "out/main/index.js"
```
(falls `src/`-Layout: electron-vite bündelt `src/main/index.js` nach `out/main/index.js`.)

- [ ] Step 3: Endform verifizieren

```bash
cd App && node --test sandbox/__tests__/*.test.js && npm run build:bundle && npm start && npm run build:linux
```

- [ ] Step 4: Sicherheits-Invariante (main behält ihre Privilegien; nichts im Renderer neu freigegeben)

Bestätigung: `preload.js` unverändert; Renderer weiter nur über `window.electronAPI`.

- [ ] Step 5: Commit + Doku

```bash
git add App/
git add -f docs/superpowers/plans/2026-08-31-modular-phase-d.md
git commit -m "refactor(main): finalize main entry orchestration; complete modular split"
```

---

## Self-Review-Notizen (Phase D)

- **Spec-Coverage:** Phase D („Main-Prozess") vollständig: IPC in `main/ipc/*`, Service-Logik in `main/services/*`, main.js dünner Einstieg, preload unverändert als Bridge.
- **Keine Platzhalter:** Representative Service-/IPC-Codeblöcke für Sandbox (Task 2) vollständig; übrige folgen demselben Muster mit adaptiver Kanal-Liste (Anpassungspunkt).
- **Type-Konsistenz:** `SandboxService.trySwitch` delegiert an die dokumentierte, getestete `sandboxManager.trySwitchBackend`; IPC-Registrierungs-Signatur (`{ ipcMain, service }`) konsistent über Tasks.
- **Blocker-Erkenntnis:** Abhängig von Phase-A-Ausgang ob `src/main/` vs. Pflanz; Task 5 macht finalen `main`-Feld-Umzug. `sandbox/` bleibt als getesteter Service unangetastet.
