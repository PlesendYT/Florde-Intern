# Commit History Search

**Kategorie:** 4. Git | **Feature:** 4.4

## Ziel
Durchsuchen der Git-Commit-History nach Nachrichten, Autoren, Dateien oder Inhalten.

## UI
- Suchfeld im Git-Panel (oben, fixiert)
- Ergebnisse als Liste unterhalb: Commit-Hash, Message, Author, Datum
- Suchmodus via Dropdown: "Message", "Author", "Files", "Content (diff)"

## Backend
- `git log --all --grep=<query>` für Message-Suche
- `git log --all --author=<query>` für Author-Suche
- `git log --all -- <filepath>` für Datei-Suche
- `git log --all -S<text> --source --all` für Content-Suche (pickaxe)
- Max 50 Ergebnisse, sortiert nach Datum (neueste zuerst)

## Interaktion
- Klick auf Ergebnis zeigt den Commit-Diff im Diff-Viewer
- Escape/Close-Button leert die Suche
- Suchergebnisse bleiben sichtbar bis "Clear" geklickt wird
