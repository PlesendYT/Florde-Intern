@echo off
cd /d "%~dp0"
echo Building Florde for Windows...
call npm run build:win
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Build complete. Output in build-output/
pause
