@echo off
setlocal
echo ===================================================
echo   Stremio For Gamepad - Compilador Tauri (.exe)
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

echo 2. Compilando frontend (Vite)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao compilar os arquivos do frontend.
    pause
    exit /b 1
)

echo 3. Compilando binario nativo Tauri (.exe)...
call npx @tauri-apps/cli build --target x86_64-pc-windows-gnu
if %errorlevel% neq 0 (
    echo [ERRO] Falha na compilacao Tauri.
    pause
    exit /b 1
)

echo 4. Sincronizando pasta release...
if not exist "release" mkdir release
if not exist "release\bin" mkdir release\bin
copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\app.exe" "release\Stremio_For_Gamepad.exe" >nul
copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\WebView2Loader.dll" "release\WebView2Loader.dll" >nul
for /r "src-tauri\target\x86_64-pc-windows-gnu" %%f in (steam_api64.dll) do (
    copy /Y "%%f" "release\steam_api64.dll" >nul 2>&1
    copy /Y "%%f" "src-tauri\target\x86_64-pc-windows-gnu\release\steam_api64.dll" >nul 2>&1
)
if exist "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\nsis\*.exe" (
    copy /Y "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\nsis\*.exe" "release\" >nul
)
xcopy /E /I /Y "bin\server" "release\bin\server" >nul

echo.
echo ===================================================
echo [SUCESSO] Build completo!
echo Executavel pronto em: release\Stremio_For_Gamepad.exe
echo Instaladores prontos em: release\
echo ===================================================
echo.
