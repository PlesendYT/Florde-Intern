# Florde Feature Pack V2 — Spec

> **Goal:** Erweiterung von Florde um neue Provider, Chat-Features, Sicherheitssysteme und Editor-Verbesserungen.
> **Architektur:** Electron App (`App/`) + statische Website (`Website/`). Kein Build-Step.

---

## Plan-Übersicht

| Plan | Kategorie | Aufwand |
|------|-----------|---------|
| 1 | Providers & Capabilities | large |
| 2 | Chat & UI Enhancements | medium |
| 3 | Security, Shell & Settings | large |
| 4 | Editor & Fixes | small |
| 5 | Full Offline & Sandbox (Konzept) | sketch |

---

## Plan 1: Providers & Capabilities

### OpenCode Provider
- Neuer Provider "OpenCode" in provider list
- API-kompatibel (gleiche Endpunkt-Struktur wie OpenAI-kompatible APIs)
- Basis-URL konfigurierbar
- API-Key Feld
- Models: frei eingebbar oder aus vordefinierter Liste

### Mistral Provider — Modelle
- Bestehenden Mistral-Provider erweitern um:
  - Mistral:Devstral (verschiedene Versionen)
  - Mistral:Codestral (verschiedene Versionen)
  - Mistral:Mistral-Tiny
- Als Model-Optionen im Provider, nicht als separate Provider

### Tool Capability Detection
- Vor erstem Request prüfen: Unterstützt das Modell native Tool Calling?
- Falls ja → Tools API verwenden
- Falls nein → Chat-basierte Tools (System-Prompt mit Tool-Beschreibungen, AI response parsen)

### Capability Detection System
- Beim ersten Laden eines Modells automatisch testen auf:
  - Tool Calling, Thinking, Streaming, JSON Mode, Vision, Images
  - Embeddings, Function Calling, Custom Temperature, Seed, Context Caching
- Ergebnisse werden beim Klick auf "Save" in Settings gecached
- Bei Modellwechsel oder neuer Settings-Speicherung neu testen

### Temperature Settings
- In Provider-Einstellungen: Temperatur-Regler pro Provider
- Nur aktiv/anpassbar wenn Capability "Custom Temperature" vorhanden

### Model Info Indicator
- Im Editor: Kleine Anzeige welches Modell aktiv ist
- Details im Hover/Klick:
  - Limits, Rate Limit, Burst, Token Limit
  - Kosten pro Token (Input/Output)
  - Kontext-Fenster (Context Window)
  - RAM/VRAM Verbrauch (für lokale Modelle)
  - Capabilities (Häkchen-Liste)
  - Average Response Time, Avg Tokens/sec
  - Average Tool Success Rate, Temperature
- Bei Ollama und anderen lokalen LLMs: Live-Ressourcen-Anzeige

### Free/API-Key Indicator
- In Modell-Liste: Symbol ob das Modell kostenlos ist oder API-Key benötigt

---

## Plan 2: Chat & UI Enhancements

### See Thoughts (Standard: AN)
- Settings-Toggle "See Thoughts" — standardmäßig aktiviert
- AI schreibt Gedanken mit speziellem Start-Zeichen (z.B. `[think]`) und End-Zeichen (z.B. `[/think]`)
- Gedanken-Text wird im Chat grau dargestellt (CSS: `color: var(--text3)`, kursiv)
- Getrennt vom normalen Output sichtbar

### Instant Mode
- Settings-Toggle "Instant Mode"
- **AN (Standard für Mistral-artige Modelle):** Komplette Antwort buffern, sobald fertig alles auf einmal in den Chat schreiben
- **AUS:** Text-Animation — sobald Antwort komplett, Zeichen für Zeichen sichtbar machen (reines visuelles Tippen, kein echtes Streaming)
- Gilt auch für Tool-Calls: Ergebnisse werden mit dem Text zusammen dargestellt

### AI Activity Display
- Live-Anzeige im Chat als System-Nachricht (grau, klein)
- Zeigt: `Reading README.md`, `Editing main.ts`, `Creating index.html`, `SHELL: npm install`, `Waiting (Rate Limit) Retry in 5s.`
- AI schreibt selbst kurz was sie tut → erscheint in dieser Activity-Zeile
- Aktivitätszeile aktualisiert sich live während der AI-Response

### Collapsible Toolbar
- Obere Funktionsleiste standardmäßig **eingeklappt**
- Knopf ganz rechts zum Auf-/Zuklappen
- Im eingeklappten Zustand nur der Aufklapp-Knopf sichtbar

### Ollama Model Selector in Settings
- In Settings bei Ollama-Provider: Rechts neben dem Modell-Auswahlfeld ein Dropdown-Pfeil
- Dropdown zeigt:
  - Liste der per `ollama list` installierten Modelle
  - Ganz unten: "Download Model" Eintrag
- "Download Model" öffnet:
  - Suchfeld (oben) + Liste bekannter Modelle (unten)
  - Bei Eingabe: Prüfung ob valider Modellname
  - Download-Button → `ollama pull <name>` mit Fortschrittsbalken + Live-Log

### Website: Ollama Tool Note
- Auf `Website/index.html` im Bereich Features/Description ergänzen:
  - Hinweis dass Flordes AI-Agent auch mit Ollama-Modellen Tools nutzen kann (falls Modell keine nativen Tools unterstützt)

---

## Plan 3: Security, Shell & Settings

### Configurable Timeout
- Settings: Timeout-Eingabe (Standard 30 Minuten)
- Timeout zählt nur wenn AI keine Antwort, keinen Tool-Call, keine Shell-Ausführung, keinen Download sendet
- Wenn Shell läuft oder Download aktiv → kein Timeout
- Wenn Permission-Request wartet → kein Timeout-Abzug
- Timeout-UI: Anzeige im Chat wenn Zeit knapp wird

### Auto-Accept System
- Settings-Toggle "Auto Accept" (Standard: AUS)
- Wenn AN: Keine Fragen bei write/read/edit/create
- **Ausnahmen (TROTZDEM fragen, konfigurierbar):**
  - Shell-Ausführung
  - Zugriff außerhalb des Projekts
  - Git-Operationen
  - Terminal allgemein
- "Manage Auto Exceptions" Button (sichtbar wenn Auto Accept AN)
- Pro Kategorie: Allow/Ask/Block
- Standard: Alle Ausnahmen auf "Ask"

### Sandbox Denied UI
- Statt kryptischer "Access denied: invalid sandbox path"-Fehler:
  - Rote Fragebox im Chat
  - Text: "Der Agent möchte auf [Pfad] zugreifen"
  - Allow/Deny Buttons

### Shell Risk Assessment
- Jeder Shell-Befehl durchläuft Risikoanalyse:
  - **Safe:** `ls`, `pwd`, `echo`, `cat` (read-only)
  - **Low:** `cd`, `mkdir`, einfache writes
  - **Medium:** `npm install`, `git push`, `chmod`
  - **High:** `sudo`, `rm -rf`, `dd`, `curl ... | sh`, `wget -O- | sh`, Netzwerkzugriffe
  - **Critical:** `rm -rf /`, `format`, `dd if=/dev/zero`, Bootloader, System-Config
- **Risk Override Detection:**
  - Musterbasierte Erkennung (Regex-Liste) ergänzt AI-Bewertung
  - Höhere Stufe gewinnt IMMER
  - Erkannte Muster werden im UI angezeigt ("Gefundenes Muster: rm -rf /")

### Expandable Shell View
- Shell-Bereich aufklappbar
- Zeigt: Vollständigen Befehl, Live-Preview (stdout/stderr), Exit Code, Laufzeit
- Aktionen: Stop Process, Restart, Copy Command, "Ask Florde What The Command Does"
- Letzteres: AI erklärt was der Befehl tut

### Critical Shell Warning
- Bei "Critical": IMMER rote Warnung (auch mit Auto Accept)
- AI schreibt: Warum critical, was passieren kann, was der Befehl macht
- Benutzer muss Button **10 Sekunden gedrückt halten**
- Danach erscheint "Wirklich ausführen?"-Button (einmal klicken)

### 429 Exponential Backoff
- Bei 429/Rate-Limit: Exponentielles Backoff (1s, 2s, 4s, 8s, 16s, 32s, max 60s)
- Fortschritt wird gespeichert (letzter erfolgreicher Schritt)
- Nach Wiederherstellung: Agent macht genau da weiter wo aufgehört
- UI: "Rate Limited — Retry in Xs" Countdown

### API Key Validation
- Beim Testen/Validieren eines API-Keys:
  - Sende Nachricht "say yes" an das Modell
  - **Valid:** Response kommt (beliebiger Inhalt, nicht nur "yes")
  - **Limited:** 429, 402, Timeout (3 Minuten) → Key gültig aber aktuell nicht nutzbar
  - **Invalid:** 401, 403, model_not_found, bad_endpoint, andere Fehler
- Ergebnis-Anzeige in Settings

### Plugin Disable Fix
- Plugin deaktivieren (disabled) → Tools des Plugins werden nicht mehr geladen/nicht an AI übergeben
- Bug: aktuell werden disabled plugins trotzdem genutzt → fixen

---

## Plan 4: Editor & Fixes

### Live Editor Sync
- Editor immer synchron mit Dateisystem
- Wenn AI `projectWriteFile` ausführt → Datei im Editor sofort aktualisieren (reload)
- Wenn Datei extern geändert → Watcher erkennt Änderung, Editor aktualisiert
- Kein manuelles "Reload" nötig

### Sandbox ZIP Download Fix
- Im Sandbox-Projekt: ZIP-Download erlaubt Ordnerauswahl
- Aber Download wird nicht ausgeführt → Fix: Datei tatsächlich in ausgewählten Ordner speichern

### AI-Generated Confirmation Descriptions
- Bei Shell/Write/Edit-Operationen:
  - AI schreibt **kurze Zusammenfassung** was getan wird
  - Bei Shell: Befehl ganz oben, Zusammenfassung darunter
  - Wird in der Confirmation-Box angezeigt

---

## Plan 5: Full Offline & Sandbox (Konzept)

> Nur Konzept/Skizze — keine Implementation in diesem Zyklus.

### Full Offline Mode
- Settings-Toggle "Full Offline"
- Wenn AN:
  - Nur lokale LLMs als Provider (Ollama, LM Studio, etc.)
  - Cloud-Provider ausgeblendet/deaktiviert
  - AI kann keine Web-Suche/Fetch durchführen
  - App-interne Internetberechtigung deaktiviert
  - Anzeige: "Full Offline Mode" Badge in UI
- Sub-Toggle "Full Offline Projects":
  - KI darf nur Projekte ohne Internet-Features öffnen/bearbeiten
  - Zusätzliche Anzeige: "Full Offline Project Mode"

### Virtual PC Sandbox (Konzept)
- VM-basierte Sandbox für sichere Code-Ausführung
- Isoliertes Windows/macOS/Linux-System
- AI-Agent hat Vollzugriff auf Sandbox, Host bleibt geschützt
- Implementierung: Docker-Container oder QEMU-VM
- Ressourcen-Limits (CPU, RAM, Disk, Network)
- Snapshot/Rollback-Funktion
- (Nur Konzept — kein Code)
