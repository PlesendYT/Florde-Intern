# Docker Compose Support

**Kategorie:** 3. Terminal / Docker | **Feature:** 3.3

## Ziel
Docker Compose Projekte direkt aus der App steuern (up, down, logs, ps).

## Neue Buttons in Docker-Panel
- `docker-compose up -d` (Start)
- `docker-compose down` (Stop)
- `docker-compose logs -f` (Live-Logs)
- `docker-compose ps` (Status)

## Backend (main.js)
- Neue IPC-Handler: `docker:compose-up`, `docker:compose-down`, `docker:compose-logs`, `docker:compose-ps`
- Jeder Handler führt `docker-compose -f <pfad> <cmd>` im Projektverzeichnis aus
- `compose-logs` returned die letzten 100 Zeilen (kein Live-Streaming via IPC initial)

## UI
- Neuer Tab "Compose" im Docker-Panel, neben "Containers", "Images", "Logs"
- Zeigt docker-compose.yml Dateien im Projekt an (Scan nach `**/docker-compose*.yml`)
- Buttons werden disabled wenn keine compose-Datei gefunden wird

## Implementation
- `findComposeFiles(projectPath)` → sucht nach `docker-compose*.yml`
- `execSync` mit `cwd: projectPath, timeout: 30000`
- Ergebnisse werden im Docker-Panel als Liste mit Status angezeigt
