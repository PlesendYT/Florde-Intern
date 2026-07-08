@echo off
cd /d "%~dp0"
echo Cleaning Florde build artifacts...
if exist "build-output\" rmdir /s /q "build-output"
if exist "dist\" rmdir /s /q "dist"
echo Removing node_modules...
if exist "node_modules\" rmdir /s /q "node_modules"
echo Clean complete.
pause
