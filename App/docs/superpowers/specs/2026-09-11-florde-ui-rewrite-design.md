# Florde UI-Rewrite („Quiet Power") — Design Spec

Datum: 2026-09-11
Quelle: `Tempörare/Designdocument.md` (20 Abschnitte + Theme-Ranking)
Ansatz: **Shell-Rewrite** (vom User gewählt; Alternative Token-first verworfen)
Status: alle 4 Abschnitte vom User approved

Leitsatz: **„Florde zeigt nicht alles gleichzeitig. Florde macht alles erreichbar."**

## 1. Layout-Shell (Icon-Rail + Panel-System)

- Neue `index.html`-Shell: schmale Icon-Rail links (Florde-Mark, Chat, Editor,
  Terminal, Git, Sandbox, MCP, Tools; unten Settings + Status-Punkt).
- Daneben Dockview als echtes Panel-System: Panels öffnen, schließen,
  umsortieren; Rail-Buttons togglen Panels. Kein fest verdrahtetes Layout mehr.
- Sichtbarer Zustand (offene Panels, Rail-Auswahl) wird persistiert
  (localStorage + settings.json, keine Secrets).
- **ID-Vertrag:** Alle Element-IDs, die `script.js` per `getElementById` nutzt,
  bleiben erhalten. Die Shell ändert Struktur/Klassen, nicht die IDs.
  Ein ID-Vertrag-Test prüft das automatisiert (siehe §5).

## 2. Theme-System (semantische Tokens, 3 Themes)

- Einzige Farbbasis, nie Hardcodes in Komponenten:
  `--surface-background`, `--surface-panel`, `--surface-raised`,
  `--text-primary`, `--text-secondary`, `--text-muted`,
  `--border-subtle`, `--accent` (dunkles Violett, sparsam),
  `--status-success`, `--status-warn`, `--status-danger`.
- Built-in: **Florde Dark** (Standard; dunkles Blau + Violett),
  **Florde Light**, **Florde Midnight** (fast schwarz).
- Alte Themes entfallen; Mapping gespeicherter Werte:
  `dark` → Florde Dark, `light` → Florde Light,
  `high-contrast`/`solarized-dark`/`solarized-light` → Florde Dark.
- Keine Drop-Shadows (Tiefe via Surface-Kontrast + Border; Blur nur bei Overlays).
  Borders dezent, Radius klein–mittel (4–8px, keine Pills).
- Typografie: moderne Sans für UI; Monospace für Code/Terminal/Diff.
- Icons (Outline/Filled) nur als Informationsverstärker, keine Deko.

## 3. Chat & Agent-Cards

- Chat ist ein Werkzeug im Workspace, kein Vollbild-Chat.
- Agent-Aktionen als kompakte Cards: `● Agent` + Statuszeile + max. 3 Tool-Zeilen,
  Rest hinter „Details"-Toggle. Standard: Ruhe; Transparenz auf Bedarf.
- Normale Nachrichten ruhiger (weniger Badges); Provider-/Modell-Wahl bleibt im
  Panel-Header (inkl. bestehendem `model-select`).
- Permission-Gate-Dialog nach Doc: Aktion + Code-Block + Zeilen für
  Risiko/Sandbox/Network + `[Cancel] [Allow]`; hohes Risiko mit
  Details (betroffene Dateien, Netzwerk, Berechtigungen, Sandbox, reversibel?).
- Fallback: Unbekannte/ungeparste Inhalte rendern wie bisher, nur neu gestylt.

## 4. Status, Animation, Barrierefreiheit

- Status als aufklappbares Panel am Rail-Statuspunkt: `● Ready`; geöffnet Zeilen
  für AI (Connected), Sandbox (Backend), MCP (Server-Anzahl), Git (Clean/Dreckig),
  Agents (laufend). Keine permanente Status-Toolbar.
- Animations-Stufe in Settings: Minimal / Subtle (Standard) / Normal / Full,
  umgesetzt via `data-animation`-Attribut; `prefers-reduced-motion` wird
  respektiert. Keine dauerhaften Deko-Animationen, kein Confetti/Gamification.
- Barrierefreiheit: Kontrast, sichtbare Focus-States, Tastatursteuerung
  (Rail + Panels + Command Palette erreichbar), keine Info nur via Farbe,
  skalierbare Schrift (bestehende Font-Size-Settings bleiben).

## 5. Absicherung & Abnahme

- ID-Vertrag-Test: alle in `script.js` referenzierten IDs existieren in der
  neuen Shell (failing-first nach TDD).
- Bestehende Test-Suite bleibt grün (Stand: 391 pass; 16 pre-existing Failures
  in Permission-/Store-Tests, unverändert).
- Manuelle Klick-Pfade vor Commit: Chat senden, Provider/Modell wechseln,
  Settings speichern, Panel öffnen/schließen/togglen, Theme wechseln,
  Permission-Dialog Allow/Cancel.
- Gitleaks vor jedem Commit; ein Commit pro abgeschlossener Phase.

## Nicht-Ziele (explizit)

- Kein 4.+ Theme, keine Custom-Theme-Engine (nur Token-Basis dafür legen).
- Kein Umbau der Agent-/Provider-/MCP-Logik — nur Darstellung.
- Keine neuen Features nebenbei (YAGNI); Settings-Inhalte bleiben, nur Styling neu.
