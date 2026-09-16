#!/bin/bash
# Florde Menue - fasst alle bisherigen *.sh Skripte in einer Datei zusammen.
# Aufruf interaktiv: ./menue.sh
# Direktaufruf:      ./menue.sh install|run|dev|build:win|build:linux|build:mac|build:all|build_all|clean|delete-data|help
cd "$(dirname "$0")"

do_install() {
  echo "Installing dependencies..."
  npm install
  if [ $? -ne 0 ]; then
    echo "npm install failed."
    return 1
  fi
  echo "Dependencies installed successfully."
}

do_run() {
  echo "Starting Florde..."
  if [ ! -f "node_modules/electron/dist/electron" ]; then
    echo "Electron not found. Run menu item 1 (Install) first."
    return 1
  fi
  ./node_modules/electron/dist/electron . &
}

do_dev() {
  echo "Starting Florde with DevTools..."
  if [ ! -f "node_modules/electron/dist/electron" ]; then
    echo "Electron not found. Run menu item 1 (Install) first."
    return 1
  fi
  ./node_modules/electron/dist/electron . --dev &
}

do_build() {
  target="$1"
  # Windows builds need Windows: native modules (better-sqlite3/node-pty)
  # cannot be cross-compiled (node-gyp refuses linux->win32) and no
  # Electron-44 prebuilds exist. Windows installers are built in CI
  # (.github/workflows/build.yml) on windows-latest runners.
  if [ "$target" = "win" ]; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        echo "Building Florde (win, native)..."
        npm run build:win
        ;;
      *)
        echo "Windows builds need Windows (native modules can't cross-compile)."
        echo "They run in CI: .github/workflows/build.yml (Actions -> Build installers -> Artifacts)."
        echo "On a Windows machine choose this option again for a local build."
        return 1
        ;;
    esac
  else
    case "$target" in
      linux) npm_script="build:linux" ;;
      mac)   npm_script="build:mac" ;;
      all)   npm_script="build" ;;
      *) echo "Unknown build target: $target (win/linux/mac/all)"; return 1 ;;
    esac
    echo "Building Florde ($target)..."
    npm run "$npm_script"
  fi
  if [ $? -ne 0 ]; then
    echo "Build failed."
    return 1
  fi
  echo "Build complete. Output in build-output/"
}

do_build_all() {
  echo "Building Florde for Windows, Linux, and macOS..."
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) npm run build ;;
    # "build" bundles win+linux, but win needs Windows (see do_build):
    # build linux locally, win comes from CI.
    *) npm run build:linux && echo "NOTE: Windows installer comes from CI (.github/workflows/build.yml)." ;;
  esac
  if [ $? -ne 0 ]; then
    echo "Build failed."
    return 1
  fi
  echo "Build complete. Output in build-output/"
}

do_clean() {
  echo "Cleaning Florde build artifacts..."
  rm -rf build-output dist node_modules
  echo "Clean complete."
}

do_delete_data() {
  echo "WARNING: This will delete ALL Florde user data including:"
  echo "  - All projects and files"
  echo "  - Settings and API keys"
  echo "  - Chat history"
  echo "  - Plugins"
  echo ""
  read -p "Are you sure you want to continue? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    return 0
  fi
  echo "Deleting Florde user data..."
  appdata="$HOME/.config/Florde"
  if [ -d "$appdata" ]; then
    rm -rf "$appdata"
    echo "Deleted: $appdata"
  else
    echo "No user data found at $appdata"
  fi
  echo "Done."
}

show_help() {
  echo "Usage: ./menue.sh [command]"
  echo ""
  echo "Commands:"
  echo "  install       Install dependencies (npm install)"
  echo "  run           Start Florde"
  echo "  dev           Start Florde with DevTools"
  echo "  build:win     Build for Windows"
  echo "  build:linux   Build for Linux"
  echo "  build:mac     Build for macOS"
  echo "  build:all     Build for Windows + Linux (npm run build)"
  echo "  build_all     Same as build:all"
  echo "  clean         Remove build-output, dist, node_modules"
  echo "  delete-data   Delete ALL Florde user data (asks first)"
  echo "  help          Show this help"
  echo ""
  echo "Without arguments the interactive menu is shown."
}

build_submenu() {
  echo ""
  echo "--- Build ---"
  echo "1) Windows"
  echo "2) Linux"
  echo "3) macOS"
  echo "4) Alle (Windows + Linux)"
  echo "0) Zurueck"
  read -p "Wahl: " b || return 0
  case "$b" in
    1) do_build win ;;
    2) do_build linux ;;
    3) do_build mac ;;
    4) do_build all ;;
    0) return 0 ;;
    *) echo "Ungueltige Wahl."; return 1 ;;
  esac
}

show_menu() {
  echo ""
  echo "===== Florde Menue ====="
  echo "1) Install (Abhaengigkeiten installieren)"
  echo "2) Run (Florde starten)"
  echo "3) Start Dev (mit DevTools)"
  echo "4) Build... (Win/Linux/Mac/Alle)"
  echo "5) Build All (Windows + Linux)"
  echo "6) Clean (build-output, dist, node_modules loeschen)"
  echo "7) Delete All Data (ALLE Nutzerdaten loeschen)"
  echo "0) Exit"
}

# Direktaufruf per Argument (fuer Automatisierung, ohne Pause/Loop)
if [ $# -gt 0 ]; then
  case "$1" in
    install) do_install ;;
    run) do_run ;;
    dev|start) do_dev ;;
    build:win) do_build win ;;
    build:linux) do_build linux ;;
    build:mac) do_build mac ;;
    build:all|all) do_build all ;;
    build_all) do_build_all ;;
    clean) do_clean ;;
    delete-data|delete_data) do_delete_data ;;
    help|--help|-h) show_help ;;
    *) echo "Unknown command: $1"; show_help; exit 1 ;;
  esac
  exit $?
fi

while true; do
  show_menu
  read -p "Wahl: " choice || break
  case "$choice" in
    1) do_install ;;
    2) do_run ;;
    3) do_dev ;;
    4) build_submenu ;;
    5) do_build_all ;;
    6) do_clean ;;
    7) do_delete_data ;;
    0) echo "Tschuess!"; exit 0 ;;
    *) echo "Ungueltige Wahl, bitte 0-7." ;;
  esac
  echo ""
  read -p "Weiter mit Enter..." dummy || break
done
