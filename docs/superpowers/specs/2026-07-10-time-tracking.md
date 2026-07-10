# Time Tracking

**Kategorie:** 6. Productivity | **Feature:** 6.3

## Ziel
Zeit erfassen, die in einem Projekt verbracht wird.

## UI
- Timer in der Titlebar oder Statusleiste (neben Projektname)
- Start/Stop Button (▶ / ⏸)
- Anzeige: `hh:mm:ss` (aktuelle Session) + `(total: Xh Ym)` (alle Sessions heute)
- Kleiner Chart/Statistik im Settings-Panel oder eigenem Tab

## Daten
```json
// .florde/time-tracking.json
{
  "sessions": [
    { "start": "2026-07-10T09:00:00Z", "end": "2026-07-10T11:30:00Z" },
    { "start": "2026-07-10T13:00:00Z", "end": null }
  ],
  "totalToday": 9000000  // ms
}
```

## Verhalten
- Timer läuft auch wenn die App minimiert ist (via `setInterval`)
- Beim Schließen der App wird laufender Timer gestoppt (via `beforeunload`)
- Tägliche Statistik: Gesamtzeit pro Tag (letzte 7 Tage als Balkendiagramm)

## Implementation
- `timeTracking.js` Modul
- `startTimer()`, `stopTimer()`, `getTotalToday()`, `getStats(days)`
- Timer aktualisiert die Anzeige alle 1 Sekunde
- Daten werden nach jedem Stop gespeichert
