@echo off
title Florde

echo Starting Florde...
echo.

echo [Website] Opening landing page...
start "" "%~dp0Website\index.html"

echo [App] Launching Electron app...
cd /d "%~dp0App"
start "" cmd /c "npm start"

echo.
echo Both running. Close the app window to stop.
