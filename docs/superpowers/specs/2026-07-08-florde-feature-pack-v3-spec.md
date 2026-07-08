# Florde Feature Pack V3 — Spec

> **Goal:** Ollama Model Manager, Agent Mode Enhancements, MCP Support, Full App Bug Hunt
> **Architektur:** Electron App (`App/`), kein Build-Step.

---

## Feature 1: Ollama Model Manager

### Status Quo
- "Models ▼" Button listet installierte Modelle via `/api/tags`
- Klick auf ein Modell setzt es im Input-Feld
- "Download Model" öffnet Modal mit Quick-Select-Buttons und Streaming-Download via `/api/pull`
- Keine Delete-Funktion, keine Modell-Infos, kein Live-Status

### Neu
- **Model Delete**: Rechtsklick oder Delete-Button pro Model → `ollama rm <name>` mit Bestätigung
- **Model Info**: Klick auf Modell zeigt Details (Größe, Modified, Digest, Parameter)
- **Live Status**: Zeigt running/available Status des Ollama-Service
- **Search**: Im Download-Modal ein Suchfeld, das live gegen ollama.com/library sucht (oder lokale Liste filtert)
- **Auto-Refresh**: Nach Download/Delete wird die Model-Liste automatisch aktualisiert

### Implementation
- Alles in `script.js` + `style.css`
- Keine neuen Abhängigkeiten
- Delete via fetch POST `/api/delete`
- Info via fetch GET `/api/show`
- Status via fetch GET `/api/ps` (running models)

---

## Feature 2: Agent Mode Enhancements

### Status Quo
- Toggle-Button "Plan" / "Build"
- In Plan-Mode: AI generiert Plan vor der Ausführung
- Plan wird in Modal angezeigt, User approved/declines
- Nach Approval: Plan wird als System-Nachricht in den Chat-History injiziert
- Danach normale Ausführung

### Neu
- **Step-by-Step Execution**: Plan wird in einzelne Schritte zerlegt. Nach jedem Schritt zeigt das UI was passiert ist und wartet auf User-Bestätigung ("Continue", "Skip", "Modify").
- **Plan Editing**: User kann den Plan vor der Ausführung bearbeiten (Textarea statt Read-only)
- **Progress Tracking**: In der Chat-UI wird angezeigt: "Step 3/7: Running npm install" mit Fortschrittsbalken
- **Audit Trail**: Jeder Schritt wird im Chat als separate Nachricht dokumentiert ("AI executed: wrote src/foo.js")
- **Toggle Persistence**: Settings-Speicher ob Plan oder Build Mode aktiv ist

### Abgrenzung
- `executeToolCall` bleibt unverändert
- Nur die Schleife in `sendMessage` wird erweitert, die tool_calls verarbeitet
- Bestehender Plan-Modal wird durch erweiterten Modal ersetzt

---

## Feature 3: MCP (Model Context Protocol) Support

### Was ist MCP?
MCP ist ein offener Standard (von Anthropic), der AI-Assistenten erlaubt, externe Tools und Datenquellen via Server anzuschließen. Ein MCP-Server bietet Tools und Resources an, die der AI via Client nutzen kann.

### Architektur
```
Florde AI → executeToolCall → MCP Client (embedded) → MCP Server (stdio/HTTP)
```
- Florde startet MCP-Server als Subprozesse (stdio) oder verbindet via HTTP/SSE
- Jeder Server bietet eine Liste von Tools an (name, description, parameters)
- Diese Tools werden in `getActiveTools()` aufgenommen → AI kann sie nutzen
- `executeToolCall` routed MCP-Tools an den entsprechenden Server

### Config
- Settings-Tab "MCP Servers"
- Pro Server: Name, Command (stdio), Args, Env-Vars, oder URL (HTTP)
- Toggle Enable/Disable pro Server
- JSON Editor für advanced config (MCP Standard-Format)
- Status: Connected/Connecting/Error

### MCP Client (embedded)
Da Electron keinen nativen MCP-Client mitbringt, implementieren wir einen einfachen Client:
- **stdio Transport**: `spawn` Prozess, kommuniziert via stdin/stdout JSON-RPC 2.0
- **HTTP/SSE Transport**: fetch + EventSource für entfernte Server
- Nachrichten: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- Keep-Alive + Reconnect bei Verbindungsabbruch

### Implementation
- Neue Datei `App/renderer/mcp-client.js`
- MCP Client Klasse mit stdio + HTTP Transports
- Integration in `getActiveTools()` und `executeToolCall()`
- Settings-UI in `index.html` + `script.js`

### Sicherheit
- MCP-Tools erben die Permission-Regeln von Florde (PermissionManager)
- Server-Commands werden in einer Whitelist geprüft (kein `rm -rf /`)
- User muss neuen Server explizit aktivieren
- Timeout pro Tool-Call (30s default)

---

## Feature 4: Full App Bug Hunt

### Vorgehen
Systematischer Review aller Module auf:
1. **Uncaught Errors**: try/catch-Lücken in async functions
2. **Race Conditions**: Timing-Issues in DOM-Manipulation, Event-Handler
3. **Memory Leaks**: nicht entfernte Event-Listener, nicht gecleante Intervalle
4. **Edge Cases**: Leere Inputs, undefined/NaN, disconnected states
5. **XSS/Security**: Nicht-escaped User-Input in innerHTML
6. **DOM Bugs**: Falsche Selektoren, fehlende Elemente, doppelte IDs
7. **CSS Issues**: Layout-Brüche, fehlende States (loading, error, empty)
8. **Preload/IPC**: Ungehandelte Promise-Rejections in electronAPI

### Module
1. `script.js` (5450+ lines) — Hauptlogik
2. `style.css` (1000+ lines) — Styles
3. `index.html` (820 lines) — DOM
4. `plugin-system.js` — Plugin Registry
5. `preload.js` — IPC Bridge
6. `main.js` — Electron Main Process

### Dokumentation
- Jeder Bug wird mit file:line, Root Cause, Fix dokumentiert
- Kritische Bugs werden sofort gefixt, kosmetische gesammelt

---

## Timeline

1. Spec schreiben (done)
2. Feature 1: Ollama Model Manager (~1 Session)
3. Feature 2: Agent Mode Enhancements (~2 Sessions)
4. Feature 3: MCP Support (~3 Sessions)
5. Feature 4: Bug Hunt + Fixes (~2 Sessions)
6. Final Verification
