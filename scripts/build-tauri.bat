@echo off
setlocal
echo ===================================================
echo   Steam for Consoles - Compilador Tauri (.exe)
echo ===================================================
echo.

set "PATH=E:\msys64\mingw64\bin;C:\Users\HENRIQUE\.cargo\bin;%PATH%"

echo 1. Verificando compilador GCC e Rust...
where gcc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Compilador GCC nao encontrado no PATH.
    pause
    exit /b 1
)
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Cargo nao encontrado no PATH.
    pause
    exit /b 1
)

echo 2. Compilando frontend e binario nativo Tauri (.exe)...
rem Tauri runs beforeBuildCommand itself; do not compile the frontend twice.
call npx @tauri-apps/cli build --target x86_64-pc-windows-gnu
if %errorlevel% neq 0 (
    echo [ERRO] Falha na compilacao Tauri.
    pause
    exit /b 1
)

echo 3. Sincronizando pasta release...
if not exist "release" mkdir release
if not exist "release\bin" mkdir release\bin
copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\app.exe" "release\Steam_for_Consoles.exe" >nul
if %errorlevel% neq 0 (
    echo [ERRO] Nao foi possivel atualizar release\Steam_for_Consoles.exe. Feche o aplicativo antes de compilar.
    exit /b 1
)
copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\WebView2Loader.dll" "release\WebView2Loader.dll" >nul
rem No Steamworks test SDK or AppID file is required for non-Steam shortcuts.
rem Do not copy stale steam_api64.dll files from previous builds.
if exist "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\nsis\*.exe" (
    copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\nsis\*.exe" "release\" >nul
)
if exist "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\msi\*.msi" (
    copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\msi\*.msi" "release\" >nul
)
xcopy /E /I /Y "bin\server" "release\bin\server" >nul

echo.
echo ===================================================
echo [SUCESSO] Build completo!
echo Executavel pronto em: release\Steam_for_Consoles.exe
echo Instaladores prontos em: release\
echo ===================================================
echo.
