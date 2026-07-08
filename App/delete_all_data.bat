@echo off
cd /d "%~dp0"
echo WARNING: This will delete ALL Florde user data including:
echo   - All projects and files
echo   - Settings and API keys
echo   - Chat history
echo   - Plugins
echo.
set /p confirm="Are you sure you want to continue? (y/N): "
if /i not "%confirm%"=="y" exit /b 0

echo Deleting Florde user data...
set "appdata=%APPDATA%\Florde"
if exist "%appdata%" (
  rmdir /s /q "%appdata%"
  echo Deleted: %appdata%
) else (
  echo No user data found at %appdata%
)
echo Done.
pause
