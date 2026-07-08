#!/bin/bash
cd "$(dirname "$0")"
echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
  echo "npm install failed."
  exit 1
fi
echo "Dependencies installed successfully."
