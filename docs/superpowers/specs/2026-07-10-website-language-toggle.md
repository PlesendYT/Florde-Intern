# Website — Sprachauswahl DE/EN

**Kategorie:** 11. Website - Technisch | **Feature:** 11.2

## Ziel
Die Website kann zwischen Deutsch und Englisch umgeschaltet werden.

## UI
- Sprach-Switcher in der Header-Navbar (rechts): "DE | EN"
- Aktive Sprache ist unterstrichen/fett
- Auswahl wird in `localStorage` gespeichert
- Default: Browser-Sprache (`navigator.language`)

## Implementation
- Ein HTML-File mit beiden Sprachen via `data-lang` Attributen:
  ```html
  <h1 data-lang="de">KI-gestützte Code-Generierung</h1>
  <h1 data-lang="en">AI-powered Code Generation</h1>
  ```
- JS-Funktion `setLanguage(lang)`:
  1. Alle `[data-lang]` Elemente durchgehen
  2. Nur Elemente mit `data-lang="lang"` anzeigen
  3. Rest ausblenden (`display: none`)
- Oder einfacher: Zwei separate Sections pro Sprache, via `lang` class
- Übersetzungs-Objekte in `script.js`: `const translations = { de: { hero_title: "...", ... }, en: { ... } }`

## Umfang
- Alle Texte der Website müssen übersetzt werden (Hero, Features, FAQ, Forms, Docs, etc.)
- Initial nur DE + EN
- Erweiterbar für weitere Sprachen
