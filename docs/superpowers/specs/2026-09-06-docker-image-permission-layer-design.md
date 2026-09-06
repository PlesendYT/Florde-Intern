# Design: Docker-Image + Main-seitiger Permission-Layer für das Sandbox-System

Datum: 2026-09-06
Status: Abgestimmt

## Überblick

Florde braucht ein neues, reproduzierbares Docker-Sandbox-Image auf Basis von
`debian:bookworm-slim` sowie einen **Main-seitigen Permission-Layer**, der alle
Sandbox-Backends (none, firejail, docker, podman, vmware, qemu) absichert.
Kernanforderung: Die KI darf kritische Aktionen - insbesondere `sudo` und
Installationen - nur mit Zustimmung des Florde-Users ausführen. Jede Aktion ist
pro Tool-Kategorie, pro Befehlsmuster (Regex) und pro Backend einstellbar:
`allow` (darf einfach) / `ask` (muss angenommen werden) / `block` (darf nie).

Drei große Teile:
1. Docker-Image `florde/sandbox:bookworm` mit Standard-Tools (Dockerfile im Repo)
2. Custom-Tool-Installation (Settings-Liste + KI-nachinstallieren, pro Projekt + optional global)
3. Main-seitiger Permission-Layer für alle Backends mit interaktivem Zustimmungs-Dialog

## 1. Docker-Image

**Basis:** `debian:bookworm-slim`

**Struktur:**
- `App/docker/sandbox/Dockerfile` - baut `florde/sandbox:bookworm`
- `App/docker/sandbox/entrypoint.sh` - Init-Skript beim Container-Start (Custom-Tool-Installation)

**Eingebackene Standard-Tools:**
- Pflicht: `bash`, `coreutils`, `findutils`, `grep`, `sed`, `awk`, `curl`, `git`, `tar`, `gzip`, `zip`, `unzip`, `xz-utils`, `jq`, `python3`, `python3-pip`
- Sinnvoll: `procps`, `util-linux`, `iproute2`, `dnsutils`, `less`
- Abhängig vom Projekt (per Build-Arg optional): `gcc`, `g++`, `make`, `nodejs`, `npm` (weitere wie OpenJDK, rustc, golang nur wenn benötigt)

**Sudo:** Das Image erstellt einen dedizierten Sandbox-User; `sudo` ist installiert.
Kommandos laufen als Sandbox-User; privilegierte Befehle laufen über das
Permission-Gate (siehe Sektion 3).

**Build-Prozess:** Standard-Image wird beim ersten Sandbox-Start gebaut, falls es
lokal nicht existiert (`docker build`). Eine geleaste Variante `docker pull` wird
unterstützt, falls das Image auf einer Registry gepusht ist. Default = lokal bauen.

**Migration des Default-Images:** Der bisherige Default `florde/sandbox:minimal`
(`docker.js:15`) wird durch `florde/sandbox:bookworm` ersetzt. Ein expliziter
Image-Pfad aus den Settings (falls vom User gesetzt) bleibt vorrangig.

## 2. Custom-Tool-Installation

**Zwei Wege:**

**A) Settings-Liste (User-konfiguriert, pro Projekt):**
- "Custom Tools"-Sektion in den Sandbox-Settings. User trägt Einträge ein:
  - `apt`-Paketname, `.deb`-Dateipfad (Host), `AppImage`-Dateipfad, `snap`-Paketname
- Pro Eintrag eine Checkbox **"Global"** (Default: **aus** = nur pro Projekt).
- Gespeichert in Settings/DB mit Projektbezug + Global-Flag.

**B) KI-nachinstallieren (mit Zustimmung):**
- KI darf `sudo apt-get install`, `.deb`, AppImage installieren - durch Permission-Layer.
- `sudo`/`apt install` = Default `ask` (User-Zustimmung erforderlich).
- Nach Zustimmung läuft der Befehl im Container.

**Persistenz (pro Projekt + optional global):**
- Docker-Backend erzeugt pro Projekt ein benanntes Volume: `florde-sbx-<projekthash>-tools`
  → `/opt/custom-tools`.
- Bei global markierten Tools zusätzlich ein gemeinsames Volume `florde-tools-global`
  → `/opt/global-tools`.
- Beim Container-Start installiert `entrypoint.sh`:
  1. Bereits im pro-Projekt-Volume liegende Tools werden wiederverwendet (keine Neuinstallation).
  2. Neue Tools aus der Settings-Liste werden installiert (apt/.deb/AppImage) und dauerhaft
     im pro-Projekt-Volume (bzw. global-Volume wenn "Global") abgelegt.
- Projekt-Hash: stabiler Hash aus dem Projekt-Pfad als Suffix des Volume-/Container-Namens,
  damit gleicher Container-Name stabil pro Projekt.

## 3. Main-seitiger Permission-Layer

**Kern-Modul:** `App/main/services/permission-gate.js` - Klasse `PermissionGate`.

- Prüft jede Sandbox-Ausführung im Main-Prozess (nicht nur Client-seitig).
- Eingehängt in: `sandbox-service.exec()`, `execSandboxCommand()`,
  Datei-Operationen (`readFile`/`writeFile`/`deleteFile`), VM-Aktionen.
- Zugriff auf SQLite-`permissions`-Tabelle (bisher totes Schema wird aktiviert).
- Bei `ask` sendet er eine Genehmigungsanfrage an die UI (Sektion 4) und
  erlaubt oder blockt danach.

**Drei Regel-Ebenen:**
1. **Tool-Kategorie:** `file-read`, `file-write`, `file-delete`, `exec`, `apt-install`,
   `sudo`, `git`, `network`, `docker`, `process`, `env`, `vm`, ...
2. **Befehlsmuster (Regex):** z.B. `^cat .*` (immer erlaubt), `^rm -rf /` (immer blocken),
   `^sudo apt-get install -y .*` (ask wenn nicht voreingestellt).
3. **Backend:** Regeln pro Backend (docker/firejail/none/...).

**Precedence (Auswertungs-Reihenfolge):**
1. Exakte/Regex-Regel (meiste Spezifität)
2. Tool-Kategorie
3. Backend-Default
4. Global-Default (Default: `ask` für kritisch, `allow` für sicher)

**Risiko-Klassifizierung auf Main-Seite:**
- Das bisher renderer-seitige `assessShellRisk` (critical/high/medium/low) wird auf
  Main-Seite gespiegelt bzw. als gemeinsames Modul extrahiert, damit die Sicherheit
  nicht nur client-seitig ist.

**User-Konfiguration:** Jede Tool-Kategorie/Befehlsmuster hat einen Modus
`allow`/`ask`/`block` - einstellbar in den Settings. Regeln leben in der
SQLite-`permissions`-Tabelle (pro Projekt + Global-Flag), konsistent zu den Tools.

## 4. Zustimmungs-UX & UI-Anbindung

**Interaktiver Genehmigungs-Dialog (Main → Renderer):**
- Bei `ask`-Aktion sendet Main via IPC `sandbox:permission-request` an den Renderer.
- Dialog zeigt: Aktion (Tool/Gruppe + Befehl oder Datei + Ziel/Backend),
  Risiko-Badge (critical/high/medium/low), Buttons:
  **Allow Once / Always Allow / Block Once / Always Block**.
- Auswahl geht an Main zurück. **Always Allow/Block** erzeugt eine persistente Regel
  in der SQLite-`permissions`-Tabelle (pro Projekt + optional Global).
- **Allow** → Aktion wird fortgeführt; **Block** → Aktion abgebrochen mit Meldung an die KI.

**Sicherheit bei Allow Once (transient vs. persistent):**
- **Allow Once** merkt sich der Main transient, NUR bis der einzelne Befehl gelaufen ist -
  nicht über die nächste Anfrage hinweg.
- Nur **Always** erzeugt eine dauerhafte Regel.

**Verzahnung mit bestehendem Renderer-PermissionManager:**
- Der bisherige renderer-seitige `PermissionManager` (localStorage) bleibt für die
  bestehenden Tool-Gate-Abfragen, wird aber mit dem neuen Main-Gate verzahnt.
  Langfristig ist das Main-Gate die Quelle der Wahrheit; localStorage-Defaults können
  migriert werden (optional, nicht zwingend in diesem Batch).
- Bestehende Risiko-UI (Critical-Warning mit 10s-Hold, Sandbox-Denied-Overlay) bleibt
  erhalten und wird auch für Main-seitige Prompts wiederverwendet.

**Settings-UI ("Permission-Regeln"):**
- Liste in den Settings: für jedes Tool/pauschale Regel + ggf. Befehlsmuster einstellbar
  **Allow / Ask / Block**, plus **Global**-Checkbox.
- Regeln werden im Main-Prozess in SQLite gespeichert und vom Gate genutzt.
- UI zeigt den aktuellen Backend-Kontext.

## 5. Integration & Tests

**Einbindung des Gates in die Ausführungspfade:**
1. `sandbox-service.exec()` - KI-Exec-Pfad (über Backend) → Gate vor `manager.exec()`.
2. `execSandboxCommand()` - Host-Pfad (Git-Autocommit, Projekt-Aktionen, Git-Clone) → Gate.
   (Dieser Weg umgeht aktuell das Backend komplett und wäre sonst eine Sicherheitslücke.)
3. Datei-Operationen (`readFile`/`writeFile`/`deleteFile`) → Gate gegen
   `file-read`/`file-write`/`file-delete`-Kategorien.
4. VM-Aktionen (Snapshot, Maus, Tastatur) → Gate gegen `vm`-Kategorien.

**API-Erweiterung (IPC/Preload):**
- Neue Kanäle:
  - `sandbox:permission-register` (Main merkt transient erlaubte Aktion)
  - `sandbox:permission-request` (Main → Renderer)
  - `sandbox:permission-respond` (Renderer → Main)
  - `sandbox:get-permission-rules` / `sandbox:set-permission-rules` (Settings-UI)

**sudo-Handling im Container:**
- Dedizierter Sandbox-User im Image; `sudo` installiert.
- KI schickt `sudo`-Befehle als Ganzes durch das Gate (erkennbar am `sudo`-Regex);
  User wird gefragt. Kommandos laufen als Sandbox-User; privilegierte über den
  approbierten Pfad. `sudo` wird nie an der Engine vorbei ausgeführt.

**Persistenz-Verifizierung:**
- Volumes `florde-sbx-<hash>-tools` und `florde-tools-global` werden erzeugt/gemountet,
  einschließlich Custom-Tool-Installation via `entrypoint.sh`.

**Tests:**
- PermissionGate-Modul: Precedence, Regex-Auswertung, allow/ask/block, pro-Backend-Regeln,
  Global-Flag, transient-vs-persistent-Merken.
- Risiko-Klassifizierung: critical/high/medium/low (sudo, apt install, rm -rf, curl|bash, ...).
- Docker-Backend: Standard-Image, Volume-Mounting, Custom-Tool-Installation
  (dort wo Docker verfügbar; übersprungen wenn nicht, analog docker-backend.test.js).
- Integration IPC: `sandbox:exec`-Kette mit gestubbtem PermissionGate.
- Bestehende 195 Renderer- + 166 Sandbox-Tests bleiben grün.

**Artefakte:**
- `App/docker/sandbox/Dockerfile`, `App/docker/sandbox/entrypoint.sh`
- `App/main/services/permission-gate.js` (neues Modul)
- Erweiterungen: `sandbox-service.js`, `sandbox/backends/docker.js`, `sandbox/manager.js`,
  `main/ipc/sandbox.js`, `preload.js`, `storage.js` (Permissions-Methoden), `main/services/shared.js`
- Renderer: `sandbox-settings.js`, Permission-UI-Erweiterung, Dialog-Integrationsmodul
- Tests: neue Testdateien + bestehende angepasst
