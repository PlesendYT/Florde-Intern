# Einsteiger-UI (Teilprojekt C)

> **Goal:** Florde wird für neue Nutzer übersichtlicher und intuitiver — ohne Profis Features zu nehmen. Ein **Einsteiger-Modus** reduziert visuelles Rauschen, erklärt die wichtigsten Elemente beim ersten Start (Tour) und bündelt fortgeschrittene Funktionen hinter einer "Erweitert"-Sektion.

**Status:** Draft

---

## 1. Grundprinzip

- **UI-Level:** `Einsteiger` (Standard) vs. `Erweitert`. Umschaltbar in den Einstellungen und über einen Schnell-Umschalter. Persistenz: `localStorage['florde-ui-level']` = `'beginner' | 'advanced'`, Standard `'beginner'`.
- **CSS:** `body.ui-level-beginner` / `body.ui-level-advanced` steuert Sichtbarkeit & Dichte via CSS-Klassen — keine doppelte Logik.
- Der in Teilprojekt A eingeführte Editor/Chat-Modus bleibt davon unabhängig (betrifft Layout, nicht Dichte).

## 2. Maßnahmen (konkret, implementierbar)

### 2.1 First-Run-Tour
- Beim allerersten Start (kein `florde-seen-onboarding` in localStorage) erscheint ein **Onboarding-Dialog** (3–4 Schritte):
  1. Projekt öffnen/anlegen (Button direkt im Dialog)
  2. Editor-Modus: Datei wählen, Code editieren, KI-Auswahl-Aktionsmenü
  3. Chat: Florde-AI, Befehle (`/help`, `/sum`, `!memory`)
  4. "Erweitert"-Modus erwähnen
- Jeder Schritt: Icon + 1–2 Sätze + "Weiter/Überspringen". Kein Tutorial-Zwang.

### 2.2 Übersichtlichere Titlebar
- Icons ohne erkennbares Symbol bekommen ein **Label als Tooltip** (viele haben bereits `title`; fehlende ergänzen: `btn-save-all`, `btn-back-menu`, `btn-theme-toggle`, `btn-fullscreen`, `btn-export-zip`, `btn-ci-toggle`, `btn-management-toggle` — Z. 124-161 in `index.html`).
- Im Einsteiger-Modus: fortgeschrittene Buttons (`btn-audit-log`, `btn-docker-toggle`, `btn-dev-utils`, `btn-ci-toggle`) in ein übergeordnetes **"⋮ Mehr"-Menü** gruppieren; die Kernaktionen bleiben direkt sichtbar (Datei-Suche, Git, Terminal, Browser, Einstellungen, Save All, Menu).

### 2.3 Sidebar-Gruppierung
- Sidebar-Abschnitte (Dateien, Git, Search, etc.) bekommen im Einsteiger-Modus eine klare Hierarchie: **Dateien** zuerst und prominent; sekundäre Panels einklappbar (gesteuert durch `body.ui-level-beginner`).
- Leere Zustände mit Hilfe-Text: z. B. leerer Dateibaum → "Noch keine Dateien. Projekt öffnen über 'Menu' → Open Project."

### 2.4 Status & Feedback
- Aktions-Feedback, das schon existiert (`logToTerminal`), wird im Einsteiger-Modus zusätzlich als kurze **Toast-Meldung** unten rechts angezeigt (z. B. "Datei gespeichert", "Änderung angewendet"). Neue Mini-Funktion `showToast(msg, type)`.
- Ladezustände bei KI-Anfragen (Spinner im Chat) bleiben; unverständliche Fehlertexte werden durch freundlichere ersetzt (zentrale Mapping-Stelle).

### 2.5 Konsistente Icons & Begriffe
- Im Einsteiger-Modus zeigen Sidebar/Tab-Beschriftungen **Wort + Icon** statt nur Icon (z. B. "📁 Dateien", "🔍 Suche") — per CSS-Label-Elementen.
- Einheitliche, neutrale Begriffe im UI ("Speichern" statt "Save All", "Menü" statt "Menu") — nur im Einsteiger-Modus umgestellt (kein Refactor der IDs).

## 3. Datei-/Struktur-Änderungen

### Neue Dateien

```
App/renderer/
├── ui-level.js                ← UiLevel: init(), setLevel('beginner'|'advanced'), Tour-Steuerung
├── toast.js                   ← showToast(msg, type, duration) + Container (Mini, getrennt testbar)
└── __tests__/
    ├── ui-level.test.js       ← Level-Persistenz, body-Klassen, Standard 'beginner'
    └── toast.test.js          ← Queue, Dauer, Typen
```

### Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `App/renderer/index.html` | Onboarding-Modal; "⋮ Mehr"-Menü in Titlebar; fehlende `title`-Tooltips; Einsteiger-Labels |
| `App/renderer/script.js` | Init-Aufruf `UiLevel.init()`; Toast-Ersatz für Kern-Aktionen (`logToTerminal`-Erfolgsfälle); freundlichere Fehlermeldungen |
| `App/renderer/style.css` | `body.ui-level-beginner/-advanced`-Regeln, Onboarding-, Toast- und Label-Styles |
| `App/renderer/editor-mode.js` | nicht betroffen (A) — nur falls Toggle im Onboarding verlinkt |

### Modul-API (Auszug)

```js
// ui-level.js
const UiLevel = {
  init(),                        // Level laden, anwenden, Tour ggf. starten
  setLevel('beginner'|'advanced'),
  isBeginner(),
  startTour()                    // Onboarding-Dialog (idempotent via florde-seen-onboarding)
};
// toast.js
function showToast(message, type = 'info', duration = 2500) { ... } // queue, stack
```

## 4. Testing

| Test | Ebene |
|------|-------|
| Level-Persistenz & Standard 'beginner', body-Klassen | ui-level (Unit) |
| Tour startet nur beim ersten Start (Flag) | ui-level (Unit) |
| Toast-Queue, Verweildauer, Typ-Klassen | toast (Unit) |
| Manuell: Onboarding-Dialog, Einsteiger-Titlebar ("⋮ Mehr"), Toast bei Save | Manuell (dev) |

## 5. Out of Scope

- Komplettes UI-Redesign / neues Design-System.
- Umbenennung von IDs oder Refactoring bestehender Funktionen (nur CSS-/HTML-/Aufruf-Ebene).
- Einstellungen-Umbau (nur neuer Schalter "UI-Level").
