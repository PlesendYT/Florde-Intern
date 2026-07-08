#!/bin/bash
cd "$(dirname "$0")"
echo "WARNING: This will delete ALL Florde user data including:"
echo "  - All projects and files"
echo "  - Settings and API keys"
echo "  - Chat history"
echo "  - Plugins"
echo ""
read -p "Are you sure you want to continue? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  exit 0
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
