@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo         Building Dotify Android Release APK
echo ========================================================
echo.

cd /d "%~dp0"

set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "ANDROID_HOME=C:\Users\monty\AppData\Local\Android\Sdk"
set "NDK_HOME=C:\Users\monty\AppData\Local\Android\Sdk\ndk\27.0.12077973"

echo [1/3] Building Web Frontend (Vite)...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Vite build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Building Tauri Android Release APK...
if exist "src-tauri\gen\android\gradlew.bat" (
    call "src-tauri\gen\android\gradlew.bat" --project-dir "src-tauri\gen\android" --stop >nul 2>&1
)
if exist "src-tauri\gen\android\buildSrc\build" (
    echo [CLEAN] Clearing stale buildSrc cache...
    rd /s /q "src-tauri\gen\android\buildSrc\build" >nul 2>&1
)
if exist "src-tauri\gen\android\app\build" (
    echo [CLEAN] Clearing stale Android app build directory...
    rd /s /q "src-tauri\gen\android\app\build" >nul 2>&1
)
call npx tauri android build --apk
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tauri Android build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Signing APK with Android Debug Keystore...
set APKSIGNER="C:\Users\monty\AppData\Local\Android\Sdk\build-tools\34.0.0\apksigner.bat"
set KEYSTORE="C:\Users\monty\.android\debug.keystore"
set UNSIGNED="src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"

if not exist %APKSIGNER% (
    echo [WARN] Could not find apksigner at default path, searching...
    for /f "delims=" %%i in ('dir /s /b "C:\Users\monty\AppData\Local\Android\Sdk\build-tools\*apksigner.bat" 2^>nul') do (
        set APKSIGNER="%%i"
    )
)

call %APKSIGNER% sign --ks %KEYSTORE% --ks-pass pass:android --out dotify.apk %UNSIGNED%
if %ERRORLEVEL% neq 0 (
    echo [ERROR] APK signing failed!
    exit /b %ERRORLEVEL%
)

call %APKSIGNER% verify --verbose dotify.apk

echo.
echo ========================================================
echo   SUCCESS: dotify.apk successfully built and signed!
echo   Location: %~dp0dotify.apk
echo ========================================================
echo.
