# Florde Modular Architecture — Design Spec

**Datum:** 2026-08-31
**Status:** Approved (Entwurf bestätigt vom Nutzer, mit 3 Korrekturen integriert)
**Scope:** Umbau des Monolithen (`App/renderer/script.js` ~11k Zeilen, `App/main.js` ~1.5k Zeilen) in eine professionelle, skalierbare Modul-Architektur. Ziel: künftige Features werden in neuen Modulen ergänzt, ohne God-Object oder globale Namensverschmutzung.

## Problemstellung

- `App/renderer/script.js` ist ein zentraler Monolith mit ~50 Sektionen (Chat, AI-Provider, Terminal/Xterm ~2.3k Zeilen, Monaco-Editor, Workspace, Settings, Audit, MCP, Git, Management …), aller Code über globale Variablen/Funktionen geteilt.
- `App/main.js` konzentriert IPC-Handler, App-Bootstrap und Services in einer einzigen Datei.
- Kein Bundler; Drittpartei-Scripts (monaco, dockview-core, fuse, xterm) laden als klassische Script-Tags mit globalen Objekten.
- Wachstum ist unübersichtlich: neue Funktionen landen weiter in den Riesen-Dateien.

## Architektur-Grundsätze

1. **ESM-Importe** — explizite Abhängigkeiten durch `import`/`export`.
2. **Keine globale Florde-God-Object-API.** `window.Florde` wird NICHT eingeführt.
3. **Öffentliche Renderer-API** läuft ausschließlich über die **Preload → IPC-Grenze** (die bereits existiert) oder explizite ESM-Importe. Es gibt nur eine schmale, dokumentierte Schnittfläche zwischen Renderer und Main.
4. **Domänen statt Dateitypen.** Ordner nach Funktionsdomäne organisiert.
5. **Logger ≠ Audit Log.** Technische Logs und nachvollziehbare Benutzer-/KI-Aktionen sind getrennte Konzepte mit getrennten Modulen.
6. **Kleine, einzelverantwortliche Module.** Für jedes Modul beantwortbar: was tut es, wie nutzt man es, wovon hängt es ab. Interna änderbar ohne Konsumenten zu brechen.
7. **Drittpartei-Scripts** werden künftig vom Bundler gehandhabt, nicht als manuelle globale Script-Tags.

## Zielstruktur

### Renderer (`App/renderer`)

```
renderer/
└── src/
    ├── bootstrap.js          # lädt & verdrahtet alle Domänen (ersetzt script.js-Rolle)
    ├── core/                 # domänenübergreifende, UI-unabhängige Helfer
    │   ├── index.js          # interne gemeinsame Exporte (Facade NUR intern, kein window.Florde)
    │   ├── events.js         # Pub/Sub Event-Bus
    │   ├── state.js          # zentraler App-State (sauberer Umgang mit bisherigem Global-State)
    │   ├── logger.js         # technische Logs (console/terminal)
    │   └── notification.js   # Benutzer-Benachrichtigungen (showNotification)
    │
    ├── domains/              # je eine Domäne = eine klar abgegrenzte Funktion
    │   ├── chat/             # Chat-Nachrichten, sendMessage, Tool-Dispatch, Provider-Loop
    │   ├── sandbox/          # Sandbox-Manager-UI, VM-Panel, Wizard (teils vorhanden)
    │   ├── workspace/        # WORKSPACE MANAGER, FILE TABS, FILE TREE, PROJECT
    │   ├── editor/           # MONACO Editor, DIFF VIEW, INLINE DIFF, MODE TOGGLE
    │   ├── terminal/         # Xterm-Integration (inlined Monolith → eigenes Modul)
    │   ├── ai/               # AI PROVIDERS, SYSTEM PROMPT, TASK ROUTER, MODEL META, TOOLS
    │   ├── audit/            # AUDIT LOG (Benutzer-/KI-Aktionen), KI-AKTIONEN, DECISION LOG
    │   ├── settings/         # SETTINGS, THEME, PRIVACY
    │   ├── mcp/              # MCP Manager + MCP Client
    │   ├── git/              # GIT COMMIT, GIT INIT, EXPORT ZIP
    │   ├── management/       # MANAGEMENT PANEL, CONNECTED APPS
    │   └── misc/             # Vollbild, Drag&Drop, Shortcuts, Modal-Backdrop, etc.
    │
    └── ui/                   # wiederverwendbare UI-Bausteine (Modal, Tabs, Backdrop, Buttons)
```

### Main-Prozess (`App/`)

```
App/
├── main.js                   # dünner Einstiegspunkt (lädt aus ./src als Import) ODER bleibt als: Bootstrap
├── src/
│   └── main/
│       ├── index.js          # App-Bootstrap, app.whenReady, Fenster
│       ├── ipc/              # ein Handler-Modul pro Domäne (sandbox.ipc.js, chat.ipc.js, mcp.ipc.js …)
│       └── services/         # leichte Services (notification, storage/better-sqlite3, …)
├── preload.js                # dünne contextBridge: reine IPC-Fassade zwischen Renderer und Main (bleibt)
└── renderer/                 # wie oben
```

> Hinweis: exakte Final-Position von `main/*` (unter `App/src/main/` vs. `App/main/`) wird in Phase 0/1 des Plans final fixiert; beide sind zulässig, solange Domänen-getrennt.

### Lade-/Abhängigkeitsrichtung

```
preload.js  (contextBridge, IPC)   ←   renderer/src/core/*  ←  renderer/src/domains/*
                                                              ↓
                                     renderer/src/bootstrap.js  (verdrahtet)
```
- **core** hat keine Abhängigkeit auf Domänen oder UI.
- **domains** importieren aus **core** und ggf. untereinander über explizite ESM-Importe (nur, wo die Kopplung gerechtfertigt ist).
- **ui** importiert aus core, aber nicht umgekehrt.
- **Renderer lernt den Main** ausschließlich über die Preload-Fassade kennen.

## Migrationspfad (iterativ-inkrementell, App bleibt lauffähig)

Jede Phase: eigene Commits, `node --check`, devourtests + Vollsuite grün, `npm start` sanity.

### Phase A — Build-Gerüst (Vite/electron-vite)
- Bundler einrichten (Vite/electron-vite), der Renderer/Main zu ES-Modulen kompiliert.
- Vendor-Scripts (monaco, dockview-core, fuse, xterm) werden per Import/Bundler geladen statt globalen Script-Tags.
- App startet unverändert korrekt (nur Build-Setup, kein Verhaltens-Umbau).

### Phase B — Core-Schicht
- `core/` anlegen: events, state, logger, notification, index.
- `showNotification` → `core/notification.js`.
- Technisches Logging → `core/logger.js`.
- **NICHT** `AuditLog` hierhin: Audit-Log (nachvollziehbare Benutzer-/KI-Aktionen) gehört zu `domains/audit/audit-log.js`.

### Phase C — Domänen-Extraktion (Reihenfolge: klare Grenze zuerst, dann Größe)
1. Zuerst Domänen mit **klarster/geringster Kopplung** extrahieren (z. B. `audit`, `git`, `settings`, `management`, `misc`) — kleiner, unabhängiger Umfang, schneller Erfolg, geringes Risiko.
2. Danach komplexere Kopplung (`workspace`, `editor`, `chat`/`ai`).
3. **Xterm/`terminal` zuletzt**: ~2.3k Zeilen, stark gekoppelt, schlechter erster Kandidat.
- Nach jeder Domäne: Funktion unverändert, Tests grün.

### Phase D — main.js zerlegen
- `main.js` in `main/ipc/*` (Handler pro Domäne) und `main/services/*` aufteilen.
- Bootstrap bleibt schlank.

## Datenfluss / Fehlerbehandlung / Tests

- **Datenfluss:** UI → Domain → core/preload → IPC → Main-Handler → Service. Ergebnisse zurück über Promise/Await durch die bestehende Preload-Fassade.
- **Fehlerbehandlung:** Jede Grenze (IPC, Module) fängt/validiert eigene Fehler; keine stillen Failures, aber auch keine ungefangenen IPC-Throws (Muster wie `trySwitchBackend` übertragen).
- **Tests:** vorhandene `sandbox/__tests__/*.test.js` bleiben Referenz. Neue Module mit Fokus auf core + Domänen-Logik (nicht UI) werden unit-testbar gehalten (keine `window`-Abhängigkeit in Logik-Teilen).
- **Audit-Log-Separation:** Sandbox-Aktionen (Snapshot, Vision, VM) loggen weiterhin in `domains/audit/audit-log.js` mit bestehenden `type: 'vm'/'vision'`.

## Konventionen für NEUE Module (Richtlinie in Context-Datei)

- Neue Features gehören in `domains/<feature>/`, nie in script.js/main.js.
- Ein Modul = ein fokussierter Zweck, explizite Exporte.
- Keine neuen freien Globale; alles über `import`.
- Öffentliche Cross-Prozess-API nur über `preload.js`.
- Ein neues Modul braucht `index.js` (öffentliche API) + ggf. Untermodule.
