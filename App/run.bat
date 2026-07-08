@echo off
cd /d "%~dp0"
echo Starting Florde...
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron not found. Run install_deps.bat first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "."
