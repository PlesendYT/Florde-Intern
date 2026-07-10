# Website — Dokumentation / Getting Started Guide

**Kategorie:** 8. Website - Content | **Feature:** 8.2

## Ziel
Eine Dokumentationsseite mit Getting-Started-Guide für neue Benutzer.

## Seitenstruktur
- `/docs/` — Übersicht
- `/docs/getting-started/` — Installation & erste Schritte
- `/docs/usage/` — Chat, Projekte, Terminal, Git
- `/docs/plugins/` — Plugin-System erklären

## Inhalt Getting Started
1. **Installation**: Download, Ausführen, Systemvoraussetzungen
2. **Erster Chat**: "Create a calculator app" als Beispiel-Prompt
3. **Projekt-Struktur**: Was passiert wenn AI Code schreibt
4. **Nächste Schritte**: Terminal, Git, Docker

## Implementation
- Neue HTML-Datei: `docs.html` (oder Section in `index.html`)
- Navigation in der Header-Navbar: "Docs"
- Sidebar mit Kapiteln
- Code-Beispiele mit Syntax-Highlighting via CSS (keine externe Lib)
