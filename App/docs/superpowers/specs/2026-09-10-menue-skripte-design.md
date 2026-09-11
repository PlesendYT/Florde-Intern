# Design: menue.bat + menue.sh (Konsolidierung der 14 Skripte)

Datum: 2026-09-10
Status: freigegeben (Ansatz A)
Repo-Stand: cdc8410 First Beta Release, Root enthält direkt die App-Dateien (kein `App/`-Unterordner mehr).

## 1. Ziel
Die 14 Einzelskripte (`build.bat/sh`, `build_all.bat/sh`, `clean.bat/sh`, `delete_all_data.bat/sh`, `install_deps.bat/sh`, `run.bat/sh`, `start.bat/sh`) werden zu genau 2 interaktiven Menüdateien zusammengeführt:
- `menue.bat` (Windows, `cmd`, ASCII ohne Umlaute wegen `menue`-Schreibweise)
- `menue.sh` (Linux/macOS, `bash`)

Beide enthalten den Code inline (kein Aufruf der alten Dateien). Nach erfolgreichem Test werden die 14 alten Dateien gelöscht. Zusätzlich werden offensichtliche Build-Blocker repariert, damit die Menüpunkte tatsächlich laufen.

## 2. Architektur
- Je eine Datei im Repo-Root, nebeneinander gleichwertig. Keine dritte Datei, kein Wrapper, keine Node-Abhängigkeit für das Menü selbst.
- Struktur pro Datei: Kopf (cd zum Skriptverzeichnis) → Funktionen/Labels pro Aktion → Hauptmenü-Loop → CLI-Direktaufruf (`menue.bat install`, `menue.sh build:linux` usw.).
- `menue.bat`: `:label`-Unterroutinen mit `call`, `errorlevel`-Prüfung, `pause` nur im interaktiven Modus, `exit /b`-Codes.
- `menue.sh`: `set -u`, Funktionen pro Aktion, `read`-Menü, `chmod +x`-fähig, Exit-Codes, kein `set -e`-Abbruch im Menüloop.

## 3. Menüpunkte (beide Menüs identisch)
```
1 = Install (npm install)
2 = Run (electron . normal)
3 = Start Dev (electron . --dev)
4 = Build... (Untermenü: win / linux / mac / alle)
5 = Build All (npm run build = win+linux)
6 = Clean (build-output, dist, node_modules entfernen)
7 = Delete All Data (mit y/N-Bestätigung)
0 = Exit
```
CLI-Aliase: `install`, `run`, `dev|start`, `build:win|build:linux|build:mac|build:all`, `build_all|all`, `clean`, `delete-data`, `help`. Unbekanntes Argument → Hilfe + Exit-Code 1.

Build-Untermenü löst die Alt-Divergenz auf (`build.bat` war `build:win`, `build.sh` war `build:linux`): beide Menüs bieten alle 4 Ziele über `npm run build:win|build:linux|build:mac|build` an.

## 4. Übernommene Logik (aus den 14 Dateien, verifiziert 2026-09-10)
- Install: `npm install`, Fehler → Abbruch mit Meldung.
- Run/Dev: Prüfung auf `node_modules/electron/dist/electron(.exe)` vorher; fehlt → Hinweis auf Menüpunkt 1. `.bat` nutzt `start "" electron . [--dev]`, `.sh` startet im Hintergrund mit `&`.
- Clean: `build-output dist node_modules` löschen.
- Delete-Data: Warntext + `y/N`-Abfrage, Default Nein. Windows: `%APPDATA%\Florde`, Linux: `$HOME/.config/Florde`. Nur bei `y/Y` löschen.
- Build: `npm run build*`, Fehler → `Build failed` + Code 1.

## 5. Reparaturen ("wieder gehen")
- Ausführbarkeit: `menue.sh` mit LF + `chmod +x`; `menue.bat` mit CRLF.
- Pfad-Bug: `package.json` verweist auf `../config/icon/...`, aber `config/` existiert im neuen flachen Root nicht → Build bricht. Fix im Plan: Pfade auf existierende Icons korrigieren oder fehlende `config/icon/`-Dateien wiederherstellen, danach `npm run build:bundle` trocken verifizieren.
- Electron-Pfad: auf flachen Root prüfen (`node_modules/electron/...` relativ zum Skript, kein `App/`-Prefix mehr).
- `nul`-Datei im Root (26 Bytes, Windows-Artefakt) wird nicht angefasst.

## 6. Fehlerbehandlung
- Jede Aktion meldet Erfolg/Fehler im Klartext und kehrt ins Menü zurück (Loop bricht nur bei 0 oder Ctrl+C).
- Fehlercodes: 0 ok, 1 allgemeiner Fehler/Build-Fail/npm-Fail, Abbruch bei Delete ohne Confirm = 0.
- Kein `pause`-Block bei CLI-Direktaufruf (CI-freundlich).

## 7. Test (read-only wo möglich, schreibend nur für neue Dateien)
- `cmd /c menue.bat help` und `bash -n menue.sh` + `menue.sh help` müssen fehlerfrei laufen.
- Menü-Logik trocken testen: `clean --dry-run` nicht nötig; stattdessen Syntaxchecks + manuelle Menüprobe für Punkte 1–7 mit Abbruch an der Bestätigungsstelle bei Punkt 7.
- Nach Umsetzung: `git status`, `git diff --stat`, dann Commit.

## 8. Außerhalb des Scopes
- Keine Änderung an `main.js`, `preload.js`, Renderer, Sandbox, Providern.
- Kein neues Node-Skript, kein Python, keine CI-Workflows.
- Kein Löschen von `installer.nsh`, `LICENSE.txt`, `docker/`.
