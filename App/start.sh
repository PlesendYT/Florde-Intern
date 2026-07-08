#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Florde with DevTools..."
if [ ! -f "node_modules/electron/dist/electron" ]; then
  echo "Electron not found. Run install_deps.sh first."
  exit 1
fi
./node_modules/electron/dist/electron . --dev &
