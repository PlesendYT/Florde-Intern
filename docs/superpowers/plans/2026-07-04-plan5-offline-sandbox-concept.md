# Plan 5: Full Offline & Sandbox (Konzept)

> **Dieser Plan ist ein Konzept/Skizze. Keine Code-Änderungen.**
> Dient als Entscheidungsgrundlage für einen späteren Implementierungszyklus.

## Full Offline Mode

### Beschreibung
Ein Settings-Toggle der die App komplett vom Internet trennt.

### Verhalten (AN)
- Alle nicht-lokalen Provider werden ausgeblendet/deaktiviert (OpenAI, Claude, Gemini, OpenCode, etc.)
- Übrig bleiben nur: Ollama, LM Studio, lokale Modelle
- AI kann keine `web_search` / `web_fetch` Tools nutzen
- App-interne Internetberechtigung wird entzogen (falls möglich via Electron `session` API)
- Auch Update-Checks werden unterdrückt
- Badge in UI: "Full Offline Mode" (oben links oder in Statusleiste)

### Sub-Toggle: Full Offline Projects
- Zusätzlicher Toggle nur sichtbar wenn Full Offline AN
- AI darf nur Projekte ohne Internet-Features öffnen/bearbeiten
- Projekte die `package.json` mit Netzwerk-Dependencies haben → Warnung
- Zusätzliches Badge: "Full Offline Project Mode"

### UI-Indikatoren
- Haupt-Badge: `🔒 Full Offline` / `🔒 Full Offline Project Mode`
- Provider-Auswahl: Cloud-Provider ausgegraut mit Tooltip "Nicht verfügbar im Offline-Modus"
- Tool-Liste: Web-Tools ausgegraut

---

## Virtual PC Sandbox

### Beschreibung
Eine VM-basierte Sandbox für absolut sichere Code-Ausführung.

### Architektur-Skizze
```
Florde App
  └─ Sandbox Manager
       ├─ VM-Instanz (Docker-Container oder QEMU)
       │    ├─ Eigenes Dateisystem (gemountetes Volume oder Copy-on-Write)
       │    ├─ Netzwerk (optional, kontrolliert)
       │    └─ Ressourcen-Limits (CPU, RAM, Disk)
       ├─ Snapshot-Manager
       │    ├─ Vor jeder Ausführung: Snapshot
       │    └─ Rollback auf Knopfdruck
       └─ Kommunikation
            ├─ STDIN/STDOUT Pipe zur VM
            └─ File-Sync zwischen Host-Projekt und VM
```

### Mögliche Implementierungen

| Option | Vorteil | Nachteil |
|--------|---------|----------|
| **Docker** | Einfach, weit verbreitet | Kein vollständiges OS-Isolation |
| **QEMU** | Echte VM, voll isoliert | Setup komplex, Ressourcen-lastig |
| **Firecracker** | Leichtgewichtig, schnell | Nur Linux, MicroVM |

### Features (gewünscht)
- Auto-Snapshot vor jeder Shell-Ausführung
- Rollback bei gefährlichen Operationen
- Netzwerk komplett deaktiviert (default) oder auf Whitelist-Basis
- Ressourcen-Limits: max 4GB RAM, 2 CPU Kerne, 10GB Disk
- File-Sync: Host-Verzeichnis wird in VM gemountet, Änderungen bidirektional syncen
- Zeitlimit: VM wird nach 1h Inaktivität zerstört

### UI-Integration
- "In Sandbox ausführen" Button bei Shell-Befehlen
- Sandbox-Status-Indikator (läuft/gestoppt/fehler)
- Snapshot-Timeline mit "Zurücksetzen zu Snapshot X"

### Offene Fragen
- Soll die VM persistent sein oder pro Session neu?
- Wie wird die VM verteilt? (Docker-Image download? QEMU-Image bundled?)
- Plattform-Kompatibilität? (Windows: WSL2 + Docker? macOS: Hypervisor.framework?)
