@echo off
:: WorkTrack Pro - Server Startup with AUTO-CONFIGURED Caddy

title WorkTrack Pro - Server Startup
color 0E

cls
echo ========================================
echo  WorkTrack Pro - Server Setup
echo ========================================
echo.

:: Get IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :ip_found
)
:ip_found
set IP=%IP:~1%

echo Detected IP: %IP%
echo.

:: Check for executables
if not exist "pocketbase.exe" (
    echo [ERROR] pocketbase.exe not found!
    pause
    exit /b 1
)

if not exist "caddy.exe" (
    echo [ERROR] caddy.exe not found!
    pause
    exit /b 1
)

:: Generate Caddyfile with correct IP
echo Generating Caddyfile...
(
echo # Auto-generated Caddyfile
echo # Generated: %date% %time%
echo.
echo # Listen on network IP
echo %IP%:8090 {
echo     reverse_proxy localhost:8091
echo     tls internal
echo.
echo     header {
echo         Access-Control-Allow-Origin *
echo         Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS"
echo         Access-Control-Allow-Headers "Content-Type, Authorization"
echo     }
echo }
echo.
echo # Also listen on localhost
echo localhost:8090 {
echo     reverse_proxy localhost:8091
echo     tls internal
echo }
) > Caddyfile

echo [OK] Caddyfile generated for IP: %IP%
echo.

echo ========================================
echo Starting Services
echo ========================================
echo.

:: Start PocketBase
echo [1/2] Starting PocketBase...
start "PocketBase" /MIN cmd /c "title PocketBase ^| Internal && pocketbase.exe serve --http=127.0.0.1:8091 --origins=* && pause"
timeout /t 3 >nul
echo      [OK] PocketBase running

:: Start Caddy
echo [2/2] Starting Caddy...
start "Caddy" cmd /c "title Caddy ^| HTTPS Proxy && echo ========================================== && echo Caddy HTTPS Proxy && echo ========================================== && echo. && echo Listening on: && echo   - https://%IP%:8090 && echo   - https://localhost:8090 && echo. && echo Proxying to: http://localhost:8091 && echo. && echo Press Ctrl+C to stop && echo ========================================== && echo. && caddy.exe run && pause"

timeout /t 5 >nul
echo      [OK] Caddy started
echo.

echo ========================================
echo  Servers Running!
echo ========================================
echo.
echo Access at:
echo   Computer: https://localhost:8090
echo   Mobile:   https://%IP%:8090
echo.
echo PocketBase Admin:
echo   https://%IP%:8090/_/
echo.
echo Update your Vite .env file:
echo   VITE_POCKETBASE_URL=https://%IP%:8090
echo.
echo ========================================
echo.
echo Check the Caddy window to verify it's listening
echo on the correct IP address!
echo.
pause
