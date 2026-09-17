# Dry Run Mode — Design Spec

Datum: 2026-09-17
Status: alle 5 Abschnitte vom User approved
Ansatz: **Session-Layer über dem bestehenden Agent-Loop** (kein Fork der Agent-Logik)

Leitsatz: **Der Agent arbeitet echt, aber nichts Echtes wird angefasst.**

## 1. Modus-Umschalter + Session-Lifecycle

- `btn-agentic-mode` wird zur 3-Wege-Umschaltung Build → Plan → Dry Run
  (Klassen/Labels analog Bestand, persistiert in `florde-agent-mode`).
- Maximal **eine Dry-Run-Session pro Projekt gleichzeitig** (Session-Registry
  keyed by Projekt). Sessions verschiedener Projekte laufen unabhängig
  nebeneinander; Projektwechsel berührt fremde Sessions nicht.
- Neustart im selben Projekt oder Modus-Wechsel bei dort aktiver Session
  öffnet einen Dialog (Apply / Reject / Weiter im Dry Run).
- Solange für das aktuelle Projekt aktiv: Chat-Header zeigt permanent
  **DRY RUN + Temp-Pfad**. Anzeige und Toggle-Zustand folgen dem jeweils
  geöffneten Projekt.
- Nach Reject/Apply: Hinweis verschwindet, Toggle fällt auf den vorherigen
  Modus zurück (pro Projekt gemerkt).

## 2. Workspace-Isolation

- Bei Start Momentaufnahme des Projekts:
  - Git-Repo → `git worktree` auf Temp-Branch `florde-dryrun-<zeitstempel>`.
  - Sonst rekursive Kopie nach Temp (dicke Ordner wie `node_modules` nach
    `.gitignore`-Mustern ausgenommen, Ausnahmen dokumentiert).
- Alle Datei-Tools des Agenten bekommen einen Session-Root: Pfade außerhalb
  werden verweigert und im Op-Log vermerkt (inkl. `../`-Tricks).
- Befehle laufen mit cwd im Temp-Workspace.
- Cleanup bei Reject/Apply (Worktree entfernen + Branch löschen bzw.
  Temp-Verzeichnis löschen). Verwaiste Workspaces (Crash/Neustart) werden
  beim nächsten Start erkannt und zur Entsorgung angeboten (pro Projekt,
  inkl. Anzeige zu welchem Projekt sie gehören).

## 3. Ausführungs-Umlenkung + Command-Klassifizierung

- Jede Operation (Datei + Befehl) läuft durch den Session-Interceptor ins
  Op-Log: Status ✔/⚠/✖ plus Exit-Code und Dauer.
- Klassifizierung vor Ausführung:
  - **safe** (z. B. `python main.py`, `npm test`): läuft in Sandbox mit Temp-cwd.
  - **blocked** (schreibt außerhalb: globale `pip install`, Systempfade,
    `rm -rf /` u. ä.): wird NICHT ausgeführt, als „nicht sicher simulierbar"
    markiert.
  - **needs-approval** (Netzwerkzugriff jenseits Sandbox-Isolation): geht
    durchs bestehende Permission-Gate.
- Paketinstallationen landen nur in der isolierten Umgebung (venv im
  Temp-Workspace bzw. Sandbox-Layer), niemals im echten System.
- Verwendet wird das eingestellte Sandbox-Backend (docker/firejail/podman/
  qemu/vmware/none); seine Grenzen gelten transparent (siehe blocked).

## 4. Review / Apply

- Nach dem Lauf: Summary (Counts + Op-Liste ✔/⚠/✖) plus echter Diff
  (created/modified/deleted mit Content-Änderungen) im vorhandenen Diff-Viewer.
- Drei Buttons:
  - **Apply to Project**: kopiert Dateien zurück; Deletes/Reverts nur nach
    Einzelbestätigung; löscht danach den Temp-Workspace.
  - **Reject**: Workspace weg, nichts übernommen.
  - **Modify / Continue**: Session bleibt, Folge-Prompt arbeitet im selben
    Temp-Workspace weiter.
- Apply prüft vorher Konflikte: wurde eine echte Datei seit dem Snapshot
  extern geändert → Warnung + Auswahl pro Datei.

## 5. Safety + Fehlerfälle + Tests

- Harte Garantien:
  1. Session-Root-Enforcement auf Tool-Ebene (Pfadvalidierung).
  2. Klassifizierung ist deny-by-default bei Unsicherheit (lieber als
     „nicht simulierbar" markieren als riskieren).
  3. Apply schreibt nie blind (Konflikt-Check + Delete-Bestätigung).
  4. Temp-Workspaces liegen außerhalb des Projekts und werden immer
     aufgeräumt (auch bei Abbruch/Crash beim nächsten Start).
- Tests: Unit-Tests für Klassifizierung, Pfad-Enforcement, Diff-Erzeugung,
  Apply-Konflikte; Integrationspfad mit `none`-Backend + Kopie-Workspace;
  bestehende Suite (Gitleaks inklusive) bleibt grün.

## Nicht-Ziele (explizit)

- Kein Umbau von Build-/Plan-Logik, Chat, Settings oder Themes.
- Kein globales Session-Dashboard, keine neue Sandbox-Technologie.
- Kein automatisches Mergen per Git (Apply = dateiweises Kopieren).
