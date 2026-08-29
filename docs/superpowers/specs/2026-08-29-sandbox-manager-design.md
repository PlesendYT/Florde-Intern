# Sandbox Manager — Vervollständigung der Sandbox Aufgabe

Datum: 2026-08-29
Status: Entwurf zur Freigabe

Dieses Dokument beschreibt die vollständige Implementierung der Datei
`Sandbox Aufgabe.md` im Projekt-Root. Ziel: alle Punkte der Aufgaben-Datei
in Florde implementieren.

Prinzip: Es wird der Reihe nach gebaut. Jeder Punkt wird abgehakt
(Checkliste am Ende).

---

## 1. Erst-Setup-Wizard ("Wie soll die KI arbeiten dürfen?")

### Verhalten
- Beim **ersten App-Start** erscheint ein Wizard-Modal (wenn in den Settings
  kein `sandbox.configured` gesetzt ist).
- Der Wizard ist danach jederzeit über den Sandbox-Settings-Tab erneut
  erreichbar ("Setup erneut starten").
- Er zeigt die Sandbox-Typen mit **Vor- und Nachteilen** (siehe Aufgabe):
  - Kleine Sandbox (none): schnell, wenig Isolation
  - Firejail: schnell, Linux-only, keine echte VM
  - Docker/Podman: gute Isolation, reproduzierbar, braucht Docker/Ressourcen
  - VM (VMware/QEMU): höchste Isolation, riskante Tests möglich, Vision-fähig
- Pro Option: Name, Beschreibung, Vorteile (✓), Nachteile (✗).
- Auswahl wird in den Settings gespeichert: `sandbox.type`,
  `sandbox.configured: true`.

### Technisch
- Neue Datei: `App/renderer/sandbox-wizard.js`
- Aufruf aus `script.js`: nach `loadSettings()`, wenn `!settings.sandbox?.configured`
- Speichern über bestandenes `saveSettingsToDisk`.

---

## 2. PC-Empfehlung ("Empfohlen für deinen PC")

### Verhalten
- Button im Wizard: "Empfohlen für deinen PC".
- **Nur nach Button-Klick** wird `SystemDetector.detect()` + `recommend()` ausgeführt.
- Anzeige mit Checkmarks:
  ```
  Empfohlen für deinen PC
  CPU ✓ Ryzen 7 7800X
  RAM ✓ 32 GB
  GPU ✓ RTX 3060
  → Empfehlung: Docker Sandbox
  ```
- Empfehlung kann die Vorauswahl im Wizard setzen ("Als Auswahl übernehmen").

### Technisch
- Nutzt vorhandenes `window.electronAPI.sandbox.detect()` / `.recommend()`.
- Kein neues Backend nötig.

---

## 3. Vision-Modus

### Verhalten
- KI-Modelle mit `vision: true` (aus MODEL_META) bekommen statt des Tools
  `take_screenshot` ein Tool `vision_request` ("Darf ich den Bildschirm sehen?").
- **Pro Aufgabe, nicht pro Bildschirm**: Sobald die KI eine Textantwort
  liefert, endet die Vision-Session.
- Während eine Vision-Session aktiv ist, zeigt der Senden-Button **"Stop"**
  statt "Senden" — ein Klick bricht die Session manuell ab.
- Berechtigung wird pro Aufgabe erteilt (Dialog "Vision Erlaubnis für diese
  Aufgabe: Ja/Nein").
- Audit-Log Einträge:
  - "Vision Session gestartet"
  - "Vision Erlaubnis nur für diese Aufgabe"
  - "Vision Session beendet (Antwort)"/"(manuell)"

### Technisch
- `script.js`: Tool-Registry anpassen in `TOOLS` (bei Zeile ~180).
  - Modell-Bewusstes Registrieren: je nach aktivem Modell `vision_request`
    statt/neben `take_screenshot`.
- Neuer Zustand `visionSession = { active, taskId, project }`.
- Senden-Button-Logik: bei aktiver Session Label "Stop" und anderer Handler.
- Ende der Session: wenn Textantwort gerendert wird, Session beenden.
- AuditLog.log() mit Typ `vision`.

---

## 4. VM-Live-Ansicht (wie Manus) + Pause/Stop/Übernehmen + Audit Log

### Verhalten
- Wenn der aktive Sandbox-Typ eine VM ist (vmware/qemu), erscheint im
  Sandbox-Bereich ein **VM-Panel** mit Live-Ansicht.
- Live-Ansicht via **VNC-Stream** (Weg 1, vom User gewählt). Der Brower zeigt
  das VNC-Bild als `<canvas>`-Stream.
- Buttons im Panel:
  - **Anhalten (Pause)**: KI-Aktionen pausieren (Task-Queue pausieren,
    VM läuft weiter).
  - **Stop**: KI-Aufgabe abbrechen (Task-Queue leeren, laufenden Tool-Call
    abbrechen).
  - **Übernehmen**: User übernimmt die Kontrolle — Maus & Tastatur im
    VNC-Canvas werden an die VM weitergeleitet.
- Audit Log:
  - "Vision Session gestartet" (auch hier)
  - "Sandbox z.B Florde VM03 Aktionen: <Aktion>"
  - VM-Interaktionen (screenshot, mouse, key, snapshot) werden geloggt mit Typ `vm`.

### Technisch
- Neue Datei: `App/renderer/sandbox-vm-panel.js`
- Backend: `vnc-client.js` vorhanden (rfb2). Bisher Single-Use-Socket pro
  Aktion. Für Live-Stream: persistenten VNC-Socket im Main-Prozess halten
  und Frames per IPC an Renderer senden, oder VNC-Client im Renderer
  (WebSocket-Fallback). Entscheidung in der Implementierung zugunsten
  `vnc-client` mit persistentem Socket + Frame-Push.
- Main: IPC `sandbox:vm-start-stream`, `sandbox:vm-stop-stream`,
  `sandbox:vm-pause`, `sandbox:vm-stop-task`, `sandbox:vm-takeover`.
  `sandbox:vm-mouse` und `sandbox:vm-key` existieren bereits.
- Pause/Stop wirken auf Task-Queue in `script.js` (KI-Loop pausieren/abbrechen).

---

## 5. Auto-Snapshots vor riskanten Änderungen (kontextbasiert)

### Verhalten
- Kontext-basiert (vom User gewählt): Beim Start eines KI-Tasks fragt Florde
  die KI nach einer Risiko-Bewertung (strukturiertes Feld im System-Prompt):
  - `risk: "low" | "medium" | "high"`
  - Bei `high`: `createSnapshot("pre-task-<timestamp>")` vor der Ausführung.
  - Bei `medium`: Nachfrage an User ("Snapshot erstellen? Ja/Nein").
  - Bei `low`: kein Snapshot.
- Wenn ein Snapshot existiert, wird er im Audit Log protokolliert.
- Optionaler manueller Button "Snapshot jetzt" im VM-Panel.

### Technisch
- `main.js`: IPC `sandbox:vm-snapshot` existiert bereits.
- `script.js`: Vor dem Senden eines Tasks (bei Task-Start) Risiko-Preflight.
- Modell-übergreifend: nur bei VM-Backends (vmware/qemu) aktiv.

---

## 6. OS-Templates + Image-Download

### Verhalten
- Templates erweitern (`os-templates.js`): Windows 11 Light, Windows 10,
  Ubuntu, Linux Mint, Arch, Debian, Fedora, Benutzerdefiniert.
- Auswahl-UI (im Wizard bei VM-Typ oder im VM-Panel).
- **Florde lädt das Image selbst herunter**: von offizieller Quelle in
  `sandbox/images/` (oder den Wert aus `sandbox.imagesDir`).
- Fortschrittsanzeige (Download-%) und Fehlerbehandlung.
- Benutzerdefiniert: User gibt Pfad zu eigenem ISO/Image an.

### Technisch
- `os-templates.js`: TEMPLATES um Windows 11 Light, Windows 10, Linux Mint
  erweitern (mit ISO-Quellen).
- `main.js`: IPC `sandbox:download-image` (Download + Fortschritt per Event).
- Template-Auswahl speichert in `sandbox.vmTemplate`.

---

## 7. Netzwerk-Auswahl

### Verhalten
- Optionen (Radio/Select):
  - Kein Internet
  - Nur localhost
  - Nur Projektserver
  - Alles
  - Benutzerdefiniert
- Übersetzung pro Backend:
  - Docker: `--network none` / `--network host` / benutzerdefiniertes Netz
  - Firejail: `--net=none`, `--net=lo`, etc.
  - VM (vmware/qemu): Netzwerk-Vorlage im VMX/VM-Konfig.
- Gespeichert in `sandbox.network`.

### Technisch
- `main.js`: IPC `sandbox:set-network` → an manager/active backend weitergeben.
- Backends: `_network`-Optionen anpassen (docker hat `_network` bereits).
- UI in Wizard + Sandbox-Settings.

---

## Checkliste der Aufgaben-Datei (Abhaken)

- [ ] Punkt 1: Sandbox als isolierte Arbeitsumgebung (Wizard, Typen+Vor/Nachteile)
- [ ] Punkt 2: Florde Sandbox-Manager (Manager existiert, Config wird ergänzt)
- [ ] Frage beim ersten Einrichten (Wizard beim ersten Start)
- [ ] Vor- und Nachteile je Sandbox-Typ
- [ ] Empfehlung je nach Setup (RAM/CPU/GPU) — nach Button-Klick
- [ ] "Empfohlen für deinen PC"-Anzeige mit CPU/RAM/GPU ✓
- [ ] Vision: nicht nach Screenshot fragen, sondern nach Sehen (vision_request)
- [ ] Vision pro Aufgabe (nicht pro Bildschirm)
- [ ] Vision beendet: Textantwort kommt / Stop-Button
- [ ] VM-Live-Ansicht (wie Manus): User sieht den Bildschirm
- [ ] Buttons: Anhalten (Pause), Stop (abbrechen), Übernehmen (Maus)
- [ ] Audit Log: Vision Session, Aufgabe, Sandbox Aktionen
- [ ] Auto-Snapshots vor riskanten Änderungen (kontextbasiert)
- [ ] OS-Auswahl bei VMware: Linux / Windows (light) / anderes
- [ ] Vision-Modell: UI oder Headless
- [ ] OS-Templates: Windows 11 Light, Windows 10, Ubuntu, Mint, Arch, Debian, Fedora, Custom
- [ ] Florde lädt Image selbst herunter
- [ ] Netzwerk-Auswahl (kein Inet/localhost/Projektserver/alles/custom)

---

## Nicht-Technische Hinweise

- Sprach: UI-Beschriftungen auf Deutsch (bestehende Gewohnheit), Text im
  Audit Log gemixt (bestehend).
- Bestehende Struktur nutzen, keine Refactorings außerhalb des Ziels.
- Tests: Besiehende Sandbox-Tests grün halten; Docker-Tests scheitern an
  fehlendem Image (`florde/sandbox:minimal`) — als bekannt markieren.