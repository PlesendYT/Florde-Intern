# Florde Modular Architecture — Phase A: Vite/electron-vite Build-Gerüst

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** electron-vite als Build-/Dev-Pipeline anschließen und die bestehende App unverändert lauffähig halten (kein Verhaltens-Umbau in dieser Phase).

**Architecture:** electron-vite verarbeitet Main-, Preload- und Renderer-Prozesse zu ES-Modul-Mehrfach-Bundles. Diese Phase zeigt electron-vite auf die **bestehenden** Einträge (`App/main.js`, `App/preload.js`, `App/renderer/index.html`), statt einen Struktur-Umzug zu erzwingen. Die 30 klassischen Script-Tags in index.html bleiben zunächst erhalten (sie sind über globale `const`-Referenzen gekoppelt); ihre Umstellung auf ESM-Imports erfolgt in den Phasen B+ per Modul-Extraktion.

**Tech Stack:** electron ^30, electron-vite, Vite, Node ^22.

## Global Constraints

- App muss nach jedem Schritt mit `npm start` (electron-vite dev) identisch starten.
- Kein Verhaltens-Umbau: `main.js`/`preload.js`/`renderer/index.html`-Datenlogik unverändert in dieser Phase.
- `npm run build` (electron-builder) muss weiterhin funktionieren (Build-Pipeline wird in Phase A angepasst, Bundle-Output aus electron-vite).
- Renderer-Domänen dürfen (Architektur-Invariante der Spec) NUR über die Preload-Fassade auf Node/fs/shell zugreifen — gilt ab jetzt, auch wenn diese Phase hauptsächlich Build-Konfiguration ist.
- Bestehende Tests `App/sandbox/__tests__/*.test.js` laufen weiter: `node --test sandbox/__tests__/*.test.js` = grün.
- **Bewusste Phase-A-Deviation von der Spec:** Die Spec-Phase-A möchte Vendor-Scripts künftig per Bundler-Import statt globaler Script-Tags. Hier werden die 30 klassischen Script-Tags in index.html **vorerst beibehalten**, weil sie über globale `const`-Referenzen (auch eigene Scripts wie `i18n.js`, `script.js`) wechselseitig gekoppelt sind — ein sofortiger Modul-Umbau würde sie brechen. Ab Phase B werden sie inkrementell zu ESM-Imports (die Vendor-Assets werden dabei dem Vite-Graph übergeben). Diese Abweichung ist beabsichtigt und dient der Inkrementalität.

---

### Task 1: electron-vite installieren und config anlegen

**Files:**
- Modify: `App/package.json` (scripts + devDependency)
- Create: `App/electron.vite.config.mjs`
- Create: `App/nodemon.json` (optional, dev-Neustart; nur falls gewünscht)

**Interfaces:**
- Consumes: bestehende `main.js`, `preload.js`, `renderer/index.html`
- Produces: `npm run dev` (electron-vite dev) und `npm run dev:build` (electron-vite build)

- [ ] **Step 1: dependency installieren**

```bash
cd App
npm install -D electron-vite
```

Expected: `electron-vite` erscheint in `package.json` devDependencies; `node_modules/.bin/electron-vite` existiert.

- [ ] **Step 2: electron.vite.config.mjs anlegen**

```js
// App/electron.vite.config.mjs
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: 'main.js',       // bestehender Einstieg, noch KEIN src/-Umzug
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: 'preload.js',
      },
    },
  },
  renderer: {
    root: 'renderer',
    build: {
      outDir: '../out/renderer',
      rollupOptions: {
        input: 'renderer/index.html',   // klassische Script-Tags bleiben
      },
    },
  },
});
```

> Hinweis: `renderer.root` ist `renderer`, daher wird `index.html` relativ zum root referenziert. Falls electron-vite über `main`/`preload` die gemeinsame `renderer`-Unterordner-Konvention erzwingt, können wir in Step 5 (Verifikation) Pfade nachjustieren — Ziel: bestehende Dateien ohne Kopie verwenden.

- [ ] **Step 3: package.json scripts erweitern**

In `App/package.json` `scripts` ergänzen:

```json
    "dev": "electron-vite dev",
    "dev:watch": "electron-vite dev --watch",
    "build:bundle": "electron-vite build"
```

- [ ] **Step 4: dev-Start prüfen (darf kurz starred)**

```bash
cd App
npm run dev
```

Expected: Electron-Fenster öffnet sich; die App lädt wie zuvor (Darstellung/Logik unverändert). Terminal zeigt electron-vite dev-Pipeline. Beenden mit `Ctrl+C`.

- [ ] **Step 5: Falls Fehler bei Pfaden → anpassen**

Häufige electron-vite-Anforderungen: Einträge unter `src/main`, `src/preload`, `src/renderer`. Da die Spec auf genau diese Zielstruktur (Phase D) abzielt, ist der konforme Weg bei Pfad-Fehlern dieser:

```js
// electron.vite.config.mjs — Variante mit src/-Pfaden (NUR wenn Task 1 Step 2 nicht greift)
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('src/main/index.js') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('src/preload/index.js') } } },
  renderer: { root: resolve('src/renderer'), build: { rollupOptions: { input: resolve('src/renderer/index.html') } } },
});
```

Falls dieser Pfad nötig wird, sind die Create-/Edit-Schritte der nachfolgenden Tasks entsprechend um `src/`-Wrapper angepasst (siehe Task 2-4 Hinweise). **Wichtig:** Nur die Einstiegspunkte verschieben (dünne Wrapper), NICHT die Fach-Logik von `main.js`/`preload.js` — das ist Phase D.

- [ ] **Step 6: Commit**

```bash
cd /home/plesend/Documents/GitHub/Florde
git add App/package.json App/package-lock.json App/electron.vite.config.mjs
git commit -m "build: add electron-vite dev/build pipeline"
```

---

### Task 2: Preload als einzige Cross-Process-Grenze absichern (kein Verhaltensänderung)

**Files:**
- Read/verify: `App/preload.js` (bestehende contextBridge-Exposes)

**Interfaces:**
- Consumes: bestehender `preload.js`
- Produces: dokumentierte Bestätigung, dass alle Renderer→Main-Angriffe über `window.electronAPI` (contextBridge) laufen.

- [ ] **Step 1: preload.js auf `contextBridge`-Nutzung prüfen**

```bash
cd App
grep -n "contextBridge\|exposeInMainWorld\|ipcRenderer.invoke" preload.js | head -40
```

Expected: alle Renderer-Brücken laufen über `contextBridge.exposeInMainWorld`; direkte `ipcRenderer`-Nutzung nur innerhalb preload.js.

- [ ] **Step 2: sicherstellen, dass preload keine Node-APIs exponiert**

```bash
grep -n "require(\"node:\|require(\"fs\|require(\"child_process\|require('node:" preload.js
```

Expected: keine Treffer (oder nur dokumentierte, unvermeidbare). Falls Treffer: im Report angeben, WARUM (Preload ist per electron-vite sandboxed by default). Kein Umbau in dieser Phase — nur Verifikation und Dokumentation.

- [ ] **Step 3: Report-Notiz (keine Code-Änderung erwartet)**

Im Task-Report festhalten: Preload ist der einzige Bridge-Punkt; erfüllt die Architektur-Invariante. Falls electron-vite `sandbox`-Verhalten ändert, prüfen mit Binär-/Manuell-Test, dass `window.electronAPI.*` im Renderer weiter verfügbar ist (z. B. in DevTools-Konsole `.electronAPI` abfragen).

- [ ] **Step 4: Commit** (falls nur Verifikation, leerer/nur-Doku-Commit überspringen und stattdessen in Task 1/3 verrechnen)

---

### Task 3: Launch-Integration — `npm start` nutzt electron-vite-Build

**Files:**
- Modify: `App/package.json` (`main`-Feld + `start`-Script)

**Interfaces:**
- Consumes: Build-Output aus Task 1/2 (`out/main/index.js`)
- Produces: `npm start` läuft gegen den gebundelten Main-Einstieg.

- [ ] **Step 1: package.json `main` auf gebündelten Output umstellen**

In `App/package.json`:
```json
  "main": "out/main/index.js"
```

> Bei der Einstiegspunkt-Variante (Step 5 Task 1) wäre es `out/main/index.js` (electron-vite default). Passt der tatsächliche Output-Name (z. B. `out/main/main.js`), entsprechend anpassen — nach `npm run dev:build` das `out/`-Verzeichnis prüfen.

- [ ] **Step 2: prod-artigen Start testen**

```bash
cd App
npm run dev:build
npm start
```

Expected: App zeigt das Fenster identisch. Jede IPC-Funktion (z. B. Sandbox-Status, Settings) funktioniert — stichprobenartig über DevTools-Konsole: `await window.electronAPI.sandbox.status()` liefert `{ active, backends }`.

- [ ] **Step 3: bestehende Sandbox-Tests laufen lassen**

```bash
cd App
node --test sandbox/__tests__/*.test.js
```

Expected: alle Tests grün (unverändert 166/166; keine neuen Failures durch Build-Pipeline).

- [ ] **Step 4: Commit**

```bash
cd /home/plesend/Documents/GitHub/Florde
git add App/package.json
git commit -m "build: run electron app from electron-vite bundle output"
```

---

### Task 4: Build/electron-builder-Pipeline integrieren

**Files:**
- Modify: `App/package.json` (`build.files` + `build`-Script-Reihenfolge)

**Interfaces:**
- Consumes: `out/`-Output von electron-vite
- Produces: `npm run build` erzeugt weiterhin installer.

- [ ] **Step 1: build.files um `out/**` erweitern**

In `App/package.json` `build.files`:
```json
    "files": [
      "out/**/*",
      "preload.js",
      "renderer/**/*",
      "LICENSE.txt"
    ]
```

> Falls electron-vite mit `src/`-Pfaden läuft, `renderer/**/*` ggf. durch das gebündelte `out/renderer/**/*` ersetzen. Report notiert den tatsächlichen Build-Output.

- [ ] **Step 2: build-Script voranstellen von electron-vite build**

In `App/package.json` `scripts.build`:
```json
    "build": "electron-vite build && electron-builder --win --linux",
    "build:win": "electron-vite build && electron-builder --win",
    "build:linux": "electron-vite build && electron-builder --linux",
    "build:mac": "electron-vite build && electron-builder --mac"
```

- [ ] **Step 3: Build-Sanity prüfen (Linux, ohne sign)**

```bash
cd App
npx electron-builder --linux dir 2>&1 | tail -20
```

Expected: Build startet und erzeugt `dist/`/`build-output/` ohne Fehler. Falls `out`/`main`-Pfad-Konflikt: prüfen dass `build.files` den gebündelten Code einschließt.

- [ ] **Step 4: Commit**

```bash
cd App
git add App/package.json
cd /home/plesend/Documents/GitHub/Florde
git commit -m "build: integrate electron-vite output into electron-builder pipeline"
```

---

### Task 5: Phase-A-Verifikation + Konvention für neue Module dokumentieren

**Files:**
- Create: `docs/superpowers/plans/2026-08-31-modular-phase-a.md` (diese Datei ggf. bereits vorliegt; falls ja, überspringen)
- Modify: `docs/superpowers/plans/` (Conventions-Hinweis auf Phase B)

**Interfaces:**
- Consumes: Task 1-4 Ergebnis
- Produces: nachvollziehbares Phase-A-Ende + klarer Übergang zu Phase B.

- [ ] **Step 1: Vollsuite + Start-Sanity**

```bash
cd App
node --test sandbox/__tests__/*.test.js   # alle grün
npm run dev                               # Fenster startet
npm run build:bundle                      # build ok
```

Expected: 166/166 grün, Fenster startet identisch, bundle-bau fehlerfrei.

- [ ] **Step 2: Konvention (in Context-Datei hinterlegen — du legst sie an)**

Im Report/Notiz: neue Module ab jetzt unter `renderer/src/domains/<feature>/`; Import über `../../core/...` direkt (kein barrel); Renderer niemals `node:`-Import (Architektur-Invariante).

- [ ] **Step 3: Selbst-Review (Spec-Konformanz)**

- Läuft die App nach jedem Task unverändert? (ok)
- Kein Verhaltens-Umbau in dieser Phase? (ok)
- Renderer-Grenze eingehalten? (ok)
- Blocker: falls electron-vite den `src/`-Pfad erzwingt, müssen evtl. `src/main`/`src/preload`/`src/renderer` als dünne Wrapper existieren und `main.js`/`preload.js` Logik darein (nur Einstieg, nicht Phase D). Diese Abweichung explizit im Report festschreiben.

- [ ] **Step 4: Commit** (falls Doku-Datei geändert)

```bash
cd /home/plesend/Documents/GitHub/Florde
git add -f docs/superpowers/plans/2026-08-31-modular-phase-a.md
git commit -m "docs: phase A completion + new module conventions"
```

---

## Self-Review-Notizen (Phase A)

- **Spec-Coverage:** Phase A aus Spec-Abschnitt „Migrationspfad" vollständig (Bundler, dev/build, unveränderter Start). Optional „src/"-Pfade erst in Phase D bei Struktur-Umzug.
- **Risiko:** electron-vite `renderer.root` + klassische 30 Script-Tags. Vite lässt klassische `<script type="text/javascript">`-Tags durch (bundlert sie nicht zu Modulen), daher bleibt der bestehende globale Referenz-Graph funktionsfähig. Das ist gewollt für Phase A.
- **Type Konsistenz:** `out/main/index.js` (oder `out/main/main.js`) — im Plan an den tatsächlichen electron-vite-Output in Task 3.1 angepasst; beide Varianten sind dokumentiert.
- **Keine Platzhalter:** alle Schritte enthalten konkrete config-json/scripts.
- **Blocker-Erkenntnis:** Falls electron-vite strikt `src/`-Layout verlangt, ist der Wrapper-Umzug in Task 1 Step 5 dokumentiert — danach Pfad-Konvention konsistent für Phase B+.
