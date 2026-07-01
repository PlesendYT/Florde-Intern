@echo off
title Florde Dev

echo Starting Florde in Dev Mode...
echo.

echo [Website] Opening landing page...
start "" "%~dp0Website\index.html"

echo [App] Launching Electron app with DevTools...
cd /d "%~dp0App"
start "" cmd /c "npm start -- --dev"

echo.
echo Dev mode active. Right-click anywhere in the app to open DevTools.
pause
