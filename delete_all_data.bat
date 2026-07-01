@echo off
title Florde - Delete All Data

echo.
echo WARNING: This will permanently delete all Florde data:
echo   - All projects and files
echo   - All saved API keys and settings
echo   - All chat sessions
echo.
echo This cannot be undone!
echo.

set /p confirm="Type 'DELETE' to confirm: "
if not "%confirm%"=="DELETE" (
  echo Cancelled.
  pause
  exit /b
)

echo.
echo Deleting Florde data...

:: Find the userData folder for Florde
set "FLORDE_DATA=%APPDATA%\florde"
if exist "%FLORDE_DATA%" (
  rmdir /s /q "%FLORDE_DATA%"
  echo Deleted: %FLORDE_DATA%
) else (
  echo No Florde data found at %FLORDE_DATA%
)

:: Also check for Electron's default naming
set "FLORDE_ELECTRON=%APPDATA%\Electron"
if exist "%FLORDE_ELECTRON%\settings.json" (
  del "%FLORDE_ELECTRON%\settings.json" 2>nul
  rmdir /s /q "%FLORDE_ELECTRON%\projects" 2>nul
  echo Cleaned: %FLORDE_ELECTRON%
)

echo.
echo All Florde data has been deleted.
echo The next time you start Florde, it will be like the first time.
echo.
pause
