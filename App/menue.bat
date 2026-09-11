@echo off
REM Florde Menue - fasst alle bisherigen *.bat Skripte in einer Datei zusammen.
REM Aufruf interaktiv: menue.bat
REM Direktaufruf:      menue.bat install ^| run ^| dev ^| build:win ^| build:linux ^| build:mac ^| build:all ^| build_all ^| clean ^| delete-data ^| help
cd /d "%~dp0"

if not "%~1"=="" goto direct
goto menu

:direct
if /i "%~1"=="install" goto act_install
if /i "%~1"=="run" goto act_run
if /i "%~1"=="dev" goto act_dev
if /i "%~1"=="start" goto act_dev
if /i "%~1"=="build:win" goto act_build_win
if /i "%~1"=="build:linux" goto act_build_linux
if /i "%~1"=="build:mac" goto act_build_mac
if /i "%~1"=="build:all" goto act_build_all_arg
if /i "%~1"=="all" goto act_build_all_arg
if /i "%~1"=="build_all" goto act_build_all_files
if /i "%~1"=="clean" goto act_clean
if /i "%~1"=="delete-data" goto act_delete
if /i "%~1"=="delete_data" goto act_delete
if /i "%~1"=="help" goto act_help
if /i "%~1"=="--help" goto act_help
if /i "%~1"=="-h" goto act_help
echo Unknown command: %~1
goto act_help_err

:menu
echo.
echo ===== Florde Menue =====
echo 1^) Install ^(Abhaengigkeiten installieren^)
echo 2^) Run ^(Florde starten^)
echo 3^) Start Dev ^(mit DevTools^)
echo 4^) Build... ^(Win/Linux/Mac/Alle^)
echo 5^) Build All ^(Windows + Linux^)
echo 6^) Clean ^(build-output, dist, node_modules loeschen^)
echo 7^) Delete All Data ^(ALLE Nutzerdaten loeschen^)
echo 0^) Exit
set /p choice="Wahl: "
if "%choice%"=="1" goto act_install_menu
if "%choice%"=="2" goto act_run_menu
if "%choice%"=="3" goto act_dev_menu
if "%choice%"=="4" goto build_submenu
if "%choice%"=="5" goto act_build_all_files_menu
if "%choice%"=="6" goto act_clean_menu
if "%choice%"=="7" goto act_delete_menu
if "%choice%"=="0" goto eof_exit
echo Ungueltige Wahl, bitte 0-7.
pause
goto menu

:build_submenu
echo.
echo --- Build ---
echo 1^) Windows
echo 2^) Linux
echo 3^) macOS
echo 4^) Alle ^(Windows + Linux^)
echo 0^) Zurueck
set /p bchoice="Wahl: "
if "%bchoice%"=="1" goto act_build_win_menu
if "%bchoice%"=="2" goto act_build_linux_menu
if "%bchoice%"=="3" goto act_build_mac_menu
if "%bchoice%"=="4" goto act_build_all_arg_menu
if "%bchoice%"=="0" goto menu
echo Ungueltige Wahl.
pause
goto menu

:act_install
call npm install
if errorlevel 1 (
  echo npm install failed.
  exit /b 1
)
echo Dependencies installed successfully.
exit /b 0

:act_run
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron not found. Run menu item 1 (Install) first.
  exit /b 1
)
echo Starting Florde...
start "" "node_modules\electron\dist\electron.exe" "."
exit /b 0

:act_dev
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron not found. Run menu item 1 (Install) first.
  exit /b 1
)
echo Starting Florde with DevTools...
start "" "node_modules\electron\dist\electron.exe" "." "--dev"
exit /b 0

:act_build_win
echo Building Florde for Windows...
call npm run build:win
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build complete. Output in build-output/
exit /b 0

:act_build_linux
echo Building Florde for Linux...
call npm run build:linux
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build complete. Output in build-output/
exit /b 0

:act_build_mac
echo Building Florde for macOS...
call npm run build:mac
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build complete. Output in build-output/
exit /b 0

:act_build_all_arg
echo Building Florde for Windows, Linux, and macOS...
call npm run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build complete. Output in build-output/
exit /b 0

:act_build_all_files
echo Building Florde for Windows, Linux, and macOS...
call npm run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build complete. Output in build-output/
exit /b 0

:act_clean
echo Cleaning Florde build artifacts...
if exist "build-output\" rmdir /s /q "build-output"
if exist "dist\" rmdir /s /q "dist"
echo Removing node_modules...
if exist "node_modules\" rmdir /s /q "node_modules"
echo Clean complete.
exit /b 0

:act_delete
echo WARNING: This will delete ALL Florde user data including:
echo   - All projects and files
echo   - Settings and API keys
echo   - Chat history
echo   - Plugins
echo.
set /p confirm="Are you sure you want to continue? (y/N): "
if /i not "%confirm%"=="y" (
  echo Aborted.
  exit /b 0
)
echo Deleting Florde user data...
set "appdata=%APPDATA%\Florde"
if exist "%appdata%" (
  rmdir /s /q "%appdata%"
  echo Deleted: %appdata%
) else (
  echo No user data found at %appdata%
)
echo Done.
exit /b 0

:act_help
echo Usage: menue.bat [command]
echo.
echo Commands:
echo   install       Install dependencies (npm install)
echo   run           Start Florde
echo   dev           Start Florde with DevTools
echo   build:win     Build for Windows
echo   build:linux   Build for Linux
echo   build:mac     Build for macOS
echo   build:all     Build for Windows + Linux (npm run build)
echo   build_all     Same as build:all
echo   clean         Remove build-output, dist, node_modules
echo   delete-data   Delete ALL Florde user data (asks first)
echo   help          Show this help
echo.
echo Without arguments the interactive menu is shown.
exit /b 0

:act_help_err
call :act_help
exit /b 1

:act_install_menu
call :act_install
pause
goto menu

:act_run_menu
call :act_run
pause
goto menu

:act_dev_menu
call :act_dev
pause
goto menu

:act_build_win_menu
call :act_build_win
pause
goto menu

:act_build_linux_menu
call :act_build_linux
pause
goto menu

:act_build_mac_menu
call :act_build_mac
pause
goto menu

:act_build_all_arg_menu
call :act_build_all_arg
pause
goto menu

:act_build_all_files_menu
call :act_build_all_files
pause
goto menu

:act_clean_menu
call :act_clean
pause
goto menu

:act_delete_menu
call :act_delete
pause
goto menu

:eof_exit
echo Tschuess!
exit /b 0
