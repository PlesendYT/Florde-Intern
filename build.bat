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

echo [Installer] Copying to App_Installer and Website\App_Download...
for %%f in ("%~dp0App\dist\Florde Setup*.exe") do (
    if exist "%%f" (
        copy "%%f" "%~dp0App_Installer\" /Y
        echo [OK] Installer copied to App_Installer
        if not exist "%~dp0Website\App_Download" mkdir "%~dp0Website\App_Download"
        copy "%%f" "%~dp0Website\App_Download\" /Y
        echo [OK] Installer copied to Website\App_Download for download
    )
)
if not exist "%~dp0App\dist\Florde Setup*.exe" (
    echo [WARN] No installer found in App\dist. Build may have failed.
)

echo.
echo Build complete. Output in dist/, App/dist/, App_Installer/, and Website/App_Download/
pause
