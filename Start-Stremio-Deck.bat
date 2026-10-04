@echo off
title Stremio Deck
cd /d "%~dp0"

echo ========================================================
echo               STREMIO FOR GAMEPAD (DECK)
echo ========================================================
echo Iniciando motor de streaming e interface Xbox...

:: Start launcher in background
start /b node scripts/launcher.cjs

:: Use an app browser process with persistent storage and audio autoplay enabled.
node scripts/open-app.cjs
if errorlevel 1 pause
exit /b
