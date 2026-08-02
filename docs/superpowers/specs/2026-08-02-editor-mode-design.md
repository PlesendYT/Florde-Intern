# Editor-Modus + Interaktiver Inline-Diff (Teilprojekt A)

> **Goal:** Florde bekommt einen wechselbaren **Editor-Modus vs. Chat-Modus**. Im Editor-Modus ist der Monaco-Editor editierbar (nicht mehr read-only) und die Florde-AI arbeitet direkt im Editor: Auswahl → Aktionsmenü → KI-Änderungen als **interaktiver Inline-Diff** (Cursor/Windsurf-Stil) mit Accept/Reject auf Hunk-, Zeilen- und Block-Ebene.

**Status:** Draft (Design vom User genehmigt)

---

## 1. Grundprinzip

- **Zwei Modi:** `Editor-Modus` (Standard, Editor groß, Chat schmal) und `Chat-Modus` (Chat groß, Editor schmal). Umschalter oben in der Titlebar (`</>` Editor-Icon + `💬` Chat-Icon), aktiver Modus hervorgehoben.
- **Persistenz:** `localStorage['florde-app-mode']` = `'editor' | 'chat'`, Standard `'editor'`.
- **CSS:** `body.app-mode-editor` / `body.app-mode-chat` auf `.main-content`; Flex-Spaltengrößen pro Modus.
- **Kompatibilität:** LayoutManager (dockview-core) bleibt unangetastet; die Modus-Umschaltung steuert nur die Panel-Größen der bestehenden Chat- und Editor-Panels.

## 2. Editor editierbar machen

Monaco-Haupt-Editor in `App/renderer/script.js:8758` hat aktuell `readOnly: true` (Z. 8762) und `domReadOnly: true` (Z. 8763). Beide Flags werden **entfernt** (wieder `false`). Der DiffViewer (`script.js:9018-9019`) bleibt read-only (nur Vorschau).

> Hinweis: Beim Umschalten von read-only zu editierbar muss geprüft werden, ob damit eventuell verbundene `ctrl+`-Shortcuts oder der Umgang mit `tabDirty` (Datei-als-geändert-Flag) Konflikte erzeugen. Speichern bleibt wie gehabt: Ctrl+S / Autosave / Save All.

## 3. Auswahl-Aktionsmenü (ersetzt Code-Toolbar)

Die bestehende Code-Toolbar `setupCodeToolbar` (script.js:8793) mit "Explain Me / Code Optimizer / Search Code" wird durch ein neues Aktionsmenü ersetzt. Es erscheint bei Textauswahl über dem Editor (gleiche Positionierungslogik wie `showCodeToolbar`, script.js:8839).

Aktionen bei Auswahl:
- **Was ist das?** → Erklärung in den Chat senden (Kontext + Auswahl).
- **Erklären** → ausführliche Erklärung (wie bisher).
- **Verbessern** → Optionen-Feld: optionales Ziel (z. B. "Performance", "Lesbarkeit", "TypeScript umstellen").
- **Ändern…** → eigenes Eingabefeld für eine freie Anweisung.
- **Refactoring** → explizite Refactoring-Aktion.

Alle Änderungs-Aktionen laufen über die bestehende Chat-Pipeline (`sendMessage()`, script.js) mit dem `edit_file`-Tool bzw. Code-Block-Fallback → münden im interaktiven Inline-Diff (Abschnitt 4).

## 4. Interaktiver Inline-Diff (Kern-Feature)

KI-Änderungen werden **direkt im Editor** dargestellt (Cursor/Windsurf-Stil), nicht nur im Modal.

### Ablauf

1. KI-Aktion liefert geänderte Datei (via `edit_file`-Tool / Code-Block mit vollständiger Datei).
2. Diff zwischen altem und neuem Inhalt wird berechnet → **Hunks** (zusammenhängende geänderte Zeilen-Bereiche).
3. Änderungen werden **live in den Editor übernommen** (`editor.executeEdits`), geänderte Bereiche farblich markiert (Monaco `deltaDecorations`, grün = neu, rot = entfernt innerhalb von Hunks) mit Hover-Aktionen und Floating-Toolbar über jedem Hunk.
4. Aktionen pro Hunk/Bereich:
   - **Accept** (Block) — übernimmt den Bereich endgültig (Markierung weg).
   - **Reject** (Block) — setzt den Bereich auf den Originaltext zurück (Monaco-Edit).
   - **Accept All** — alle Hunks übernehmen.
   - **Reject All** — alle Hunks zurückrollen.
   - **Accept Line** / **Reject Line** — einzelne geänderte Zeile übernehmen/verwerfen.
   - **Edit before Accept** — der geänderte Text steht bereits editierbar im Editor; der User kann ihn frei bearbeiten; der aktive Diff-Zustand (Markierung) bleibt, bis **Accept** den Bereich bestätigt (Commit) bzw. **Reject** ihn verwirft.
5. Erst nach Accept/Reject wird die finale Version über den bestehenden Speicher-Flow gespeichert (Ctrl+S / Autosave / Save All). Offene Diff-Zustände werden beim Speichern aufgehoben.
6. Ein "Diff aktiv"-Indikator (z. B. im Editor-Tab oder Statusbereich) zeigt an, dass unbeantwortete Änderungen vorliegen.

### Dateinavigation

- Tab-Wechsel mit unbeantworteten Diff-Änderungen: Zustand pro Datei behalten; beim Wechsel zurück wird der Diff-Zustand wiederhergestellt.

## 5. Datei-/Struktur-Änderungen

### Neue Dateien

```
App/renderer/
├── editor-mode.js              ← EditorMode-Objekt: init(), setMode('editor'|'chat'), showSelectionMenu(selection), Prompt-Builder
├── inline-diff.js              ← InlineDiff: Hunk-Berechnung, Anwendung, Decorationen, Accept/Reject-Logik, Zustand pro Datei
├── diff-utils.js               ← reine Diff-zu-Hunks-Berechnung (testbar, ohne DOM/Monaco)
└── __tests__/
    ├── diff-utils.test.js      ← Hunk-Berechnung, Accept/Reject/Line/Block, Edit-before-Accept (Zustand)
    ├── editor-mode.test.js     ← Modus-Logik, localStorage, Aktionen->Prompt-Builder
    └── inline-diff.test.js     ← Akzeptieren/Verwerfen auf Hunk/Zeilen/Block-Ebene, Originalwiederherstellung
```

### Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `App/renderer/script.js` | `readOnly`/`domReadOnly` entfernen (Z. 8762-8763); `setupCodeToolbar` durch EditorMode-Aktionsmenü ersetzen (Z. 8793-8852); Bridges: `sendMessage`, `editor`, Datei-Kontext an EditorMode/inline-diff bereitstellen; Init-Aufruf |
| `App/renderer/style.css` | Modus-Klassen (`body.app-mode-editor`/`-chat`), Aktionsmenü-Styles, Hunk-Markierungs-Styles, Diff-Indikator |
| `App/renderer/index.html` | Toggle-Buttons in Titlebar (`</>` + `💬`) |

## 6. Modul-APIs (Auszug)

```js
// editor-mode.js
const EditorMode = {
  init(),                        // Toggle-Buttons binden, gespeicherten Modus laden, anwenden
  setMode(mode),                 // 'editor' | 'chat'; localStorage + body-Klassen + Panelgrößen
  showSelectionMenu(selection),  // Aktionsmenü bei Auswahl anzeigen
  _buildPrompt(action, text, lang, fileName, goal) // Prompt-Konstruktion
};

// inline-diff.js
const InlineDiff = {
  applyToEditor(fileName, newContent),  // Diff anwenden, Hunks markieren
  accept(hunkId), reject(hunkId),       // Block
  acceptLine(hunkId, line), rejectLine(hunkId, line),
  acceptAll(), rejectAll(),
  isActive(fileName),                   // offener Diff-Zustand?
  getPendingCount()                     // für Indikator
};

// diff-utils.js (pure)
function computeHunks(oldContent, newContent) → [{ id, startLine, endLine, originalLines[], newLines[], removed, added }]
```

## 7. Testing

| Test | Ebene |
|------|-------|
| Hunk-Berechnung: Einfügung, Löschung, Ersetzung, mehrere getrennte Hunks | diff-utils (Unit) |
| Accept/Reject eines Hunks stellt Original wieder her | inline-diff (Unit) |
| Accept/Reject einzelner Zeilen | inline-diff (Unit) |
| Edit-before-Accept: Text änderbar, Commit übernimmt | inline-diff (Unit) |
| Accept All / Reject All | inline-diff (Unit) |
| Modus-Umschaltung: localStorage, Standardwert 'editor', body-Klassen | editor-mode (Unit) |
| Prompt-Builder: alle Aktionen erzeugen korrekte Prompts mit Kontext | editor-mode (Unit) |
| Manuell: Editor editierbar, Toggle sichtbar, Inline-Diff mit Monaco rendert | Manuell (dev) |

## 8. Out of Scope (dieses Projekt)

- Änderungen an Dateien außerhalb der aktuell geöffneten Tab (laufen weiter über `showDiffView`-Modal).
- Der bestehende `showDiffView`-Modal (script.js:5360) bleibt als Fallback für Multi-File-Änderungen erhalten.
