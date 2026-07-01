@echo off
title Florde Builder

echo Building Florde...
echo.

echo [Website] Copying static files...
if not exist "%~dp0dist\Website" mkdir "%~dp0dist\Website"
copy "%~dp0Website\index.html" "%~dp0dist\Website\"
copy "%~dp0Website\style.css" "%~dp0dist\Website\"
copy "%~dp0Website\script.js" "%~dp0dist\Website\"

echo [App] Building Electron app...
cd /d "%~dp0App"
call npm run build

echo.
echo Build complete. Output in dist/ and App/dist/
pause
