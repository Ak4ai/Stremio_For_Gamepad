@echo off
title Steam for Consoles
cd /d "%~dp0"

echo ========================================================
echo               STEAM FOR CONSOLES
echo ========================================================
echo Iniciando motor de streaming e interface Xbox...

:: Start launcher in background
start /b node scripts/launcher.cjs

:: Use an app browser process with persistent storage and audio autoplay enabled.
node scripts/open-app.cjs
if errorlevel 1 pause
exit /b
