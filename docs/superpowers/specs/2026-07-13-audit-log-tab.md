# Audit Log Tab — Management-Panel

## Ziel

Ein neuer Tab "Audit Log" im Management-Panel, der alle KI-bezogenen Aktionen aufzeichnet: Dateizugriffe, Command-Executions, API-Zugriffe, Notiz-Erstellungen und Chat-Aktionen — jeweils mit Entscheidungsstatus (erlaubt / blockiert / automatisch) und Grund.

## Datenmodell

```js
{
  id: Number,                    // Date.now()
  timestamp: String,             // ISO 8601
  type: String,                  // "file_read" | "file_write" | "command" | "api_access" | "note_create" | "chat"
  action: String,                // menschenlesbar: "Datei gelesen", "Command blockiert", ...
  status: String,                // "allowed" | "blocked" | "auto" | "pending"
  summary: String,               // Kurzbeschreibung für die Liste
  details: Object,               // strukturierte Details (file, command, service, reason, ...)
  source: String,                // "KI" | "User" | "System"
  project: String                // currentProject
}
```

## Speicherung

- `localStorage` unter Key `florde-audit-{project}`
- Array von Einträgen, max 500 Einträge (älteste werden verworfen)
- Gleiches Muster wie TodoList, Notes, DecisionLog

## UI-Layout

```
┌─────────────────────────────────────┐
│ 🔍 [Suchfeld          ] [🤖/📝]    │  ← Suchleiste
├─────────────────────────────────────┤
│ Typ: [▼ Alle]  Status: [▼ Alle]     │  ← Filter
│ Datum: [▼ Heute|Woche|Monat|Alle]   │
│ Chat: [▼ Alle Sessions]             │
├─────────────────────────────────────┤
│ 📄 Datei gelesen       14:30:01     │  ← Einträge
│   src/index.html ✓ Erlaubt          │
│ 🔒 Command blockiert   14:28:15     │
│   sudo apt install git ✗ Blockiert  │
│ 🤖 Notiz erstellt       14:25:00    │
│   Idee Revolution ⚡ Auto           │
├─────────────────────────────────────┤
│ [Clear Logs] [Export]               │  ← Actions
└─────────────────────────────────────┘
```

- Status-Badges: grün (allowed), rot (blocked), grau (auto), gelb (pending)
- Typ-Icons: 📄 Datei, 🔒 Command, 🔌 API, 📝 Notiz, 💬 Chat
- Klick expandiert Details
- Export als JSON-Download

## Filter

- **Typ**: file_read, file_write, command, api_access, note_create, chat (Mehrfachauswahl)
- **Status**: allowed, blocked, auto, pending (Mehrfachauswahl)
- **Datum**: Heute, Diese Woche, Dieser Monat, Alle, Benutzerdefiniert
- **Chat-Session**: Dropdown mit allen Session-IDs die im Log vorkommen

## Suche

Zwei Modi, umschaltbar mit Toggle-Button:

1. **Text-Suche** (📝): Filtert Einträge deren `summary`, `action` oder `details` den Suchtext enthalten
2. **KI-Suche** (🤖): Sendet den Suchtext an den aktiven KI-Provider mit Context der letzten Logs. Die KI antwortet mit gefilterten/analysierten Ergebnissen.

## Integration

Folgende Code-Stellen werden instrumentiert (AuditLog.log()-Aufrufe):

| Code-Stelle | Aktion | Details |
|---|---|---|
| Permission-System (allow/block) | file_read, file_write, command, api_access | Grund, Datei/Command/Service |
| Notes.create() | note_create | Notiz-Titel, "erstellt durch KI" |
| searchCodeOnline() | api_access | Service + Grund |
| RagManager.indexProject() | file_read | Datei + Grund |
| ExecutionManager.executeGoal() | command | Command + Grund |
| ChatManager.sendMessage() | chat | Session + Zusammenfassung |

## Dateien

- `App/renderer/index.html` — Tab-Button + mgmt-audit Content
- `App/renderer/style.css` — Audit-Log-Styles
- `App/renderer/script.js` — AuditLog-Objekt + Integrationen
