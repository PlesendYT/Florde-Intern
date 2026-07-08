#!/bin/bash
cd "$(dirname "$0")"
echo "Building Florde for Linux..."
npm run build:linux
if [ $? -ne 0 ]; then
  echo "Build failed."
  exit 1
fi
echo "Build complete. Output in build-output/"
