@echo off
setlocal EnableExtensions
REM WeiXun launcher that routes Node/undici traffic through an HTTP(S) proxy.
REM The Supabase host (*.supabase.co) is not reachable directly from some networks.
REM
REM Usage:  start-project-with-proxy.bat
REM         start-project-with-proxy.bat http://127.0.0.1:PORT
REM
REM With no argument it reuses the Windows system proxy (the VPN/proxy client that
REM is already running), then falls back to http://127.0.0.1:7897.

set "PROXY_URL=%~1"
if defined PROXY_URL goto :have_proxy

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { $p=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer; if ($p) { ($p -split ';')[0] } } catch { }"`) do set "SYS_PROXY=%%i"
if defined SYS_PROXY set "PROXY_URL=%SYS_PROXY%"
if not defined PROXY_URL set "PROXY_URL=http://127.0.0.1:7897"

:have_proxy
echo.
echo [INFO] Proxy for Supabase / AI requests: %PROXY_URL%
echo [INFO] Override with: start-project-with-proxy.bat http://127.0.0.1:PORT
echo.

set "HTTP_PROXY=%PROXY_URL%"
set "HTTPS_PROXY=%PROXY_URL%"
set "ALL_PROXY=%PROXY_URL%"
set "NO_PROXY=localhost,127.0.0.1,::1"
REM Node 24+ makes fetch/undici honour the proxy variables above.
set "NODE_USE_ENV_PROXY=1"

call "%~dp0start-project.bat"
exit /b %ERRORLEVEL%
