# Tab Groups / Workspaces

**Kategorie:** 5. UI / UX | **Feature:** 5.1

## Ziel
Datei-Tabs können in Gruppen organisiert werden. Jede Gruppe hat einen Namen und kann ein- und ausgeklappt werden.

## UI
- Tab-Bar zeigt Gruppen als Section-Header
  - `[My App]  app.js  app.css  [+]`
  - `[Tests]  test.js  [+]`
- Gruppe auf-/zuklappbar via Klick auf Group-Header
- "Neue Gruppe"-Button (+) am Ende der Tab-Bar
- Drag & Drop: Tabs zwischen Gruppen ziehen
- Gruppe schließen: schließt alle Tabs in der Gruppe

## Datenstruktur
```js
tabGroups = {
  'Meine Gruppe': ['app.js', 'app.css'],
  'Tests': ['test.js', 'test.spec.js']
}
```

## Implementation
- Aktuelle `openTabs` Array bleibt, wird aber um Gruppen-Struktur erweitert
- Tab-Bar Rendering: iteriert über Group-Entries
- localStorage speichert Gruppen-Struktur pro Projekt
