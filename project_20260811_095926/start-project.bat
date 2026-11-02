@echo off
setlocal EnableExtensions EnableDelayedExpansion
title WeiXun Project Server

set "PROJECT_ROOT=%~dp0"
set "APP_DIR=%PROJECT_ROOT%projects"
set "APP_PORT=%WEIXUN_PORT%"
if not defined APP_PORT set "APP_PORT=5000"
set "APP_URL=http://127.0.0.1:%APP_PORT%/"

echo.
echo ========================================
echo   WeiXun Project - One Click Start
echo ========================================
echo.

if not exist "%APP_DIR%\package.json" (
  echo [ERROR] Application directory was not found:
  echo         %APP_DIR%
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo         Install Node.js 20 or newer, then try again.
  goto :failed
)

cd /d "%APP_DIR%"

if not exist ".env.local" (
  echo [ERROR] projects\.env.local was not found.
  echo         Copy .env.example to .env.local and fill in the required values.
  goto :failed
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo [ERROR] Project dependencies are missing.
  echo         Open PowerShell in the projects directory and run: corepack pnpm install --frozen-lockfile
  goto :failed
)

if not exist "node_modules\.bin\next.cmd" (
  echo [ERROR] The local Next.js executable is missing.
  echo         Open PowerShell in the projects directory and run: corepack pnpm install --frozen-lockfile
  goto :failed
)

if not exist "node_modules\.bin\tsup.cmd" (
  echo [ERROR] The local server build executable is missing.
  echo         Open PowerShell in the projects directory and run: corepack pnpm install --frozen-lockfile
  goto :failed
)

echo [1/4] Checking environment configuration...
call "node_modules\.bin\tsx.cmd" scripts\check-local-env.ts
if errorlevel 1 goto :failed

echo [2/4] Checking database connectivity...
call "node_modules\.bin\tsx.cmd" scripts\check-runtime-services.ts
if errorlevel 1 goto :failed

if not exist ".next\BUILD_ID" goto :build
if not exist "dist\server.js" goto :build
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$next=(Get-Item '.next\BUILD_ID').LastWriteTimeUtc; $server=(Get-Item 'dist\server.js').LastWriteTimeUtc; $cutoff=if($next -lt $server){$next}else{$server}; $inputs=@(Get-Item 'package.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs' -ErrorAction SilentlyContinue)+@(Get-ChildItem 'src','public' -Recurse -File -ErrorAction SilentlyContinue); if($inputs | Where-Object { $_.LastWriteTimeUtc -gt $cutoff }){exit 1}else{exit 0}"
if errorlevel 1 goto :build_stale
goto :build_ready

:build_stale
echo [3/4] Source files changed after the last production build. Rebuilding...
goto :run_build

:build
echo [3/4] Production build was not found. Building now...
:run_build
call "node_modules\.bin\next.cmd" build
if errorlevel 1 goto :failed
call "node_modules\.bin\tsup.cmd" src\server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
if errorlevel 1 goto :failed
goto :select_port

:build_ready
echo [3/4] Existing production build matches the current source.

:select_port
set /p "BUILD_ID="<".next\BUILD_ID"
set /a PORT_ATTEMPTS=0

:check_port
set "APP_URL=http://127.0.0.1:!APP_PORT!/"
netstat -ano | findstr /R /C:":!APP_PORT! .*LISTENING" >nul
if errorlevel 1 goto :start_server

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try {$h=Invoke-RestMethod -TimeoutSec 3 '!APP_URL!api/health/startup'; if($h.app -eq 'weixun-project' -and $h.buildId -eq '!BUILD_ID!' -and $h.database -eq 'ok'){exit 0}}catch{}; exit 1"
if not errorlevel 1 (
  echo [4/4] Current healthy build is already running at !APP_URL!
  if not "%WEIXUN_SKIP_BROWSER%"=="1" start "" "!APP_URL!"
  goto :success
)

if !PORT_ATTEMPTS! EQU 0 echo [INFO] Port !APP_PORT! is occupied by another or outdated service. Looking for a free port...
set /a APP_PORT+=1
set /a PORT_ATTEMPTS+=1
if !PORT_ATTEMPTS! GTR 10 (
  echo [ERROR] No free port was found in the next 10 ports.
  goto :failed
)
goto :check_port

:start_server
echo [4/4] Starting current build at !APP_URL!
echo.
echo Keep this window open while using the application.
echo Press Ctrl+C or close this window to stop the service.
echo.

if not "%WEIXUN_SKIP_BROWSER%"=="1" (
  rem Wait for the HTTP listener instead of guessing a fixed startup delay.
  rem A cold Next production server can take longer than two seconds to prepare.
  start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "$ready=$false; 1..30 | %% { try { $health=Invoke-RestMethod -TimeoutSec 1 '!APP_URL!api/health/startup'; if($health.database -eq 'ok'){$ready=$true; break} } catch { Start-Sleep -Seconds 1 } }; if ($ready) { Start-Process '!APP_URL!' }"
)

set "NODE_ENV=production"
set "HOSTNAME=127.0.0.1"
set "PORT=!APP_PORT!"
set "WEIXUN_BUILD_ID=!BUILD_ID!"
node dist\server.js
if errorlevel 1 goto :failed
goto :success

:failed
echo.
echo [FAILED] The service did not start. Read the message above.
pause
exit /b 1

:success
echo.
echo [DONE]
exit /b 0
