@echo off
cd /d "%~dp0"
echo Starting Florde with DevTools...
start "" "node_modules\electron\dist\electron.exe" "." "--dev"
