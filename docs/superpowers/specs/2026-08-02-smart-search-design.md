# Smart Search (Teilprojekt B)

> **Goal:** Eine **eine** Suche über alle Wissensquellen in Florde. Statt nur Dateinamen zu durchsuchen, liefert die Smart Search **gebündelte Ergebnisse** aus: Datei, Symbol, Issue, Memory, Commit, Todo, Decision — alles zusammen in einer Ansicht, mit Navigation per Klick.

**Status:** Draft

---

## 1. Konzept

Ein zentrales Such-Overlay (ähnlich `showQuickOpen`, script.js:6736, aber mächtiger), geöffnet per **Ctrl+Shift+P** (oder Klick auf ein Such-Icon). Bei jedem Tastendruck werden **alle Quellen parallel** durchsucht (async, mit Debounce), Ergebnisse nach Kategorie gruppiert angezeigt:

```
> Login Button

📄 Datei        …/src/components/LoginButton.jsx     (3 Treffer)
🔣 Symbol       LoginButton (class) → src/components/LoginButton.jsx
🐛 Issue        GitHub #42: "Login button broken on mobile"
🧠 Memory       memory.md: "Login flow uses OAuth2"
🕓 Commit       a1b2c3: "fix login button styles"
✅ Todo         "Refactor login button validation" (offen)
📌 Decision     "Login via OAuth2 statt Basic Auth"
```

Jede Zeile ist klickbar und navigiert zum Ziel (Datei öffnen, Zeile anspringen, Git-/Management-Panel öffnen, Issue-URL öffnen).

## 2. Quellen & vorhandene Bausteine

| Quelle | Datenquelle | Bestehender Baustein |
|--------|-------------|----------------------|
| **Datei** | Projekt-Dateien | `showQuickOpen()` (script.js:6736, Fuse, Ctrl+P) |
| **Symbol** | Monaco Document Symbols / Lightweight-Extraktor | Neu (`symbols.js`) |
| **Issue** | Verbundene Services (GitHub/GitLab/Linear `search_issues`) | Service-Definitionen + Tool-Layer (script.js:5887ff) |
| **Memory** | `.florde/memory/*.md` (rules, memory, goals, style, architecture, decisions) | `electronAPI.flordeFs.memoryList/Read` (main.js:1268-1287) |
| **Commit** | Git-Log | `electronAPI.gitLog(project, n)` (script.js:4738, main.js `git:exec` :671) |
| **Todo** | SQLite `todos` | `TodoList` (script.js:6899) |
| **Decision** | SQLite `decisions` + `decisions.md` | `DecisionLog` (script.js:7370), `flordeDb` |

**Debounce:** ~150 ms nach letztem Tastendruck → Suche starten. Ergebnisse im Promises.all bündeln, leere Kategorien ausblenden.

## 3. Symbol-Extraktion

Da Monaco-Document-Symbols pro geladener Datei asynchron sind und nicht jede Datei geöffnet ist, wird ein **leichgewichtiger Regex-Extraktor** (`symbols.js`) verwendet, der gängige Sprachen abdeckt:

- **JS/TS/JSX/TSX:** `function name(`, `const name =`, `class Name`, `interface Name`, `type Name`, `export default`, Objekt-Methoden
- **Python:** `def name(`, `class Name`
- **HTML/CSS:** `id="..."`, `.class-name`, `@media`, `function`
- **Fallback:** generische `Identifier`-Erkennung für unbekannte Endungen

Für die aktuell geöffnete Datei kann zusätzlich `monaco.languages`/Language-Service genutzt werden (falls verfügbar), sonst der Regex-Extraktor. Ausgabe pro Symbol: `{ name, kind, file, line, preview }`.

## 4. Issue-Suche (verbundene Services)

- Wenn ein Issue-Service (GitHub/GitLab/Linear) verbunden ist (Token vorhanden), wird dessen Such-Endpunkt über den bestehenden Tool-/API-Layer abgefragt (`search_issues` / `list_issues`).
- **Async + Timeout (2–3 s):** Wird kein Service verbunden / Timeout → Kategorie ausblenden (nie die gesamte Suche blockieren).
- Ergebnis-Zeile öffnet die Issue-URL im Standard-Browser (bzw. zeigt Details im Chat an).

## 5. Navigation

| Ergebnis | Klick-Aktion |
|----------|--------------|
| Datei | `openTab(path)` |
| Symbol | `openTab(path)` + Cursor auf `line` setzen |
| Memory | Datei im Editor öffnen (`.florde/memory/…`) |
| Commit | Git-Panel öffnen + Commit-Hash hervorheben |
| Todo | Management-Panel Tab `todo` öffnen |
| Decision | Management-Panel Tab `decisions` öffnen |
| Issue | URL im Browser öffnen |

## 6. Datei-/Struktur-Änderungen

### Neue Dateien

```
App/renderer/
├── smart-search.js          ← SmartSearch: Overlay, Debounce, Aggregation, Render, Navigation
├── symbols.js               ← Symbol-Extraktor (pure, regex-basiert, testbar)
└── __tests__/
    ├── symbols.test.js      ← Extraktion für JS/TS/Python/HTML/CSS + Fallback
    └── smart-search.test.js ← Aggregation, Kategorie-Rendering, Navigation (pure Teile)
```

### Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `App/renderer/index.html` | Such-Icon/Shortcut-Hinweis; Container für Overlay (oder dynamisch wie `showQuickOpen`) |
| `App/renderer/script.js` | Ctrl+Shift+P an SmartSearch binden; Bridges zu `openTab`, `sendMessage`, Git-Log, DB-Zugriffe; `showQuickOpen` bleibt für Ctrl+P (Dateien) |
| `App/renderer/style.css` | Overlay-Styles, Kategorie-Gruppierung, Icons, Hover |

### Modul-API (Auszug)

```js
// smart-search.js
const SmartSearch = {
  open(), close(),                        // Overlay anzeigen/schließen (Esc, Blur)
  _search(query) → Promise<{ file, symbol, issue, memory, commit, todo, decision }[]>,
  _render(results),                       // gruppiert nach Kategorie
  _navigate(entry)                        // Klick-Aktion je Kategorie
};
// symbols.js (pure)
function extractSymbols(content, language) → [{ name, kind, line, preview }]
```

## 7. Testing

| Test | Ebene |
|------|-------|
| Symbol-Extraktion JS/TS/Python/HTML/CSS, Kommentare/F-Strings werden ignoriert | symbols (Unit) |
| Aggregation: leere Kategorien werden ausgeblendet, Sortierung stabil | smart-search (Unit) |
| Debounce: schnelle Eingaben lösen nur finale Suche aus | smart-search (Unit) |
| Navigation-Mapping: jede Kategorie → korrekte Aktion | smart-search (Unit) |
| Issue-Timeouts blockieren Rest nicht | smart-search (Unit) |
| Manuell: Overlay öffnen (Ctrl+Shift+P), echte Suche über Projektdateien, Klick-Navigation | Manuell (dev) |

## 8. Out of Scope

- Volltext-Index über alle Dateien (nur Dateinamen/Inhalte der quellbezogenen Quellen; kein persistenter Index).
- Semantic Search / Embeddings (falls später: eigener Baustein, RAG-Panel vorhanden).
- KI-generierte Antworten in der Suche selbst.
