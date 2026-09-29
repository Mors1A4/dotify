@echo off
cd /d C:\Users\monty\Documents\AB\notify
echo [1/4] Building Frontend bundle...
call npm run build
if %ERRORLEVEL% neq 0 (
  echo Frontend build failed!
  exit /b %ERRORLEVEL%
)

echo [2/4] Building Tauri release binary...
call npx tauri build --no-bundle
if %ERRORLEVEL% neq 0 (
  echo Tauri build failed!
  exit /b %ERRORLEVEL%
)

echo [3/4] Deploying binary to app and local distributions...
powershell -NoProfile -Command "Stop-Process -Name app -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1000;"
copy /y "src-tauri\target\release\app.exe" "%LOCALAPPDATA%\dotify\app.exe"
copy /y "src-tauri\target\release\app.exe" "dotify.exe"

echo [4/4] Launching updated Dotify application...
powershell -NoProfile -Command "Start-Process '%LOCALAPPDATA%\dotify\app.exe'"
echo Successfully deployed and launched Dotify!
