@echo off
cd /d "%~dp0"
echo Building Florde for Windows, Linux, and macOS...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Build complete. Output in build-output/
pause
