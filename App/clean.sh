#!/bin/bash
cd "$(dirname "$0")"
echo "Cleaning Florde build artifacts..."
rm -rf build-output dist node_modules
echo "Clean complete."
