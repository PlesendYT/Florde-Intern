# Templates entfernen

**Kategorie:** 6. Productivity | **Feature:** 6.4

## Ziel
Alle Projekt-Templates aus der App entfernen.

## Was fällt weg
- Template-Auswahl im "New Project" Modal (`<select id="project-template">`)
- Template-Optionen: `web-app`, `python-script`, `node-api`, `react-app`, `cli-tool`
- `Blank project` als einzige Option (oder direkt kein Select mehr)

## Änderungen
- `index.html`: `<select id="project-template">` entfernen
- `script.js`: Template-bezogene Logik entfernen (Übergabe an createProject)
- `main.js`: `create-sandbox-project` Handler vereinfachen (kein Template-Parameter mehr)
- `preload.js`: `createSandboxProject` Signatur anpassen

## Ergebnis
- Neues Projekt = leeres Sandbox-Verzeichnis
- Reduziert UI-Komplexität im "New Project" Dialog
