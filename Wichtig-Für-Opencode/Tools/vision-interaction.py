#!/usr/bin/env python3
"""Vision-Interaction-Helfer: Screenshots ansehen und Mausklicks ausführen.

Damit kann ein Vision-Modell (z.B. über OpenCode) eine laufende GUI-App
wie Florde prüfen: Fenster in den Vordergrund holen, Screenshot speichern
(-> danach als Bild einlesen und analysieren), an Koordinaten klicken.

Benötigt: xdotool, gnome-screenshot, eine laufende X11-Session.

Beispiele:
  Screenshot des Florde-Fensters:
    python vision-interaction.py --app Florde --action screenshot --file /tmp/shot.png
  Klick auf (x=200, y=150) im Florde-Fenster:
    python vision-interaction.py --app Florde --action click --x 200 --y 150
  Offene Fenster auflisten (Namen für --app finden):
    python vision-interaction.py --action list
"""

import argparse
import subprocess
import sys
import time


def run(cmd):
    """Führt ein Kommando aus, gibt (returncode, stdout, stderr) zurück."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError as exc:
        return 127, "", "Befehl nicht gefunden: %s (%s)" % (" ".join(cmd), exc)
    except subprocess.TimeoutExpired:
        return 124, "", "Zeitüberschreitung: %s" % " ".join(cmd)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def check_tool(name):
    rc, _, _ = run(["command", "-v", name])
    # 'command -v' läuft über sh; Fallback direkt:
    if rc != 0:
        rc2, _, _ = run(["which", name])
        return rc2 == 0
    return True


def find_window_ids(appname):
    """Fenster-IDs, deren Titel appname enthält (nur sichtbare)."""
    rc, out, err = run(
        ["xdotool", "search", "--onlyvisible", "--name", appname]
    )
    if rc != 0 or not out:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def list_windows(_args):
    rc, out, err = run(["xdotool", "search", "--onlyvisible", "--name", ""])
    if rc != 0:
        print("Fehler bei Fenstersuche: %s" % err, file=sys.stderr)
        return 1
    for wid in out.splitlines():
        wid = wid.strip()
        if not wid:
            continue
        _, name, _ = run(["xdotool", "getwindowname", wid])
        print("%s  %s" % (wid, name))
    return 0


def focus_window(appname):
    """Holt das erste passende Fenster in den Vordergrund. Gibt ID oder None."""
    ids = find_window_ids(appname)
    if not ids:
        print("Kein sichtbares Fenster für --app %r gefunden." % appname,
              file=sys.stderr)
        return None
    wid = ids[0]
    rc, _, err = run(["xdotool", "windowactivate", "--sync", wid])
    if rc != 0:
        print("Fenster %s konnte nicht fokussiert werden: %s" % (wid, err),
              file=sys.stderr)
        return None
    time.sleep(0.4)
    return wid


def do_screenshot(args):
    if not args.file:
        print("Fehler: --action screenshot braucht --file DATEI.",
              file=sys.stderr)
        return 2
    if args.app:
        if focus_window(args.app) is None:
            return 1
        # -w = aktives Fenster aufnehmen
        cmd = ["gnome-screenshot", "-w", "-f", args.file]
    else:
        cmd = ["gnome-screenshot", "-f", args.file]
    # Kurze Pause, damit Menüs/Animationen sich setzen.
    time.sleep(0.3)
    rc, _, err = run(cmd)
    if rc != 0:
        print("Screenshot fehlgeschlagen: %s" % err, file=sys.stderr)
        return 1
    print("OK screenshot: %s" % args.file)
    return 0


def do_click(args):
    if args.x is None or args.y is None:
        print("Fehler: --action click braucht --x und --y (Pixelkoordinaten).",
              file=sys.stderr)
        return 2
    if args.app:
        if focus_window(args.app) is None:
            return 1
    rc, _, err = run(
        ["xdotool", "mousemove", str(args.x), str(args.y), "click", "1"]
    )
    if rc != 0:
        print("Klick fehlgeschlagen: %s" % err, file=sys.stderr)
        return 1
    print("OK click: %d,%d" % (args.x, args.y))
    return 0


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Screenshots speichern und Mausklicks für Vision-Modelle."
    )
    parser.add_argument("--app", default=None,
                        help="Fenstername (Teil des Titels), z.B. Florde")
    parser.add_argument("--action", required=True,
                        choices=["screenshot", "click", "list"],
                        help="screenshot | click | list")
    parser.add_argument("--file", default=None,
                        help="Zieldatei für --action screenshot (.png)")
    parser.add_argument("--x", type=int, default=None,
                        help="X-Koordinate für --action click")
    parser.add_argument("--y", type=int, default=None,
                        help="Y-Koordinate für --action click")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    for tool in ("xdotool", "gnome-screenshot"):
        if not check_tool(tool):
            print("Fehlt: %s (bitte installieren)." % tool, file=sys.stderr)
            return 3
    if args.action == "list":
        return list_windows(args)
    if args.action == "screenshot":
        return do_screenshot(args)
    if args.action == "click":
        return do_click(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
