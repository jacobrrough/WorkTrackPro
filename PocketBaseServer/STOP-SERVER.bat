@echo off
:: Stop PocketBase and Caddy servers

title Stop Servers
color 0C

echo Stopping PocketBase...
taskkill /F /IM pocketbase.exe >nul 2>&1
if errorlevel 1 (
    echo [INFO] PocketBase not running
) else (
    echo [OK] PocketBase stopped
)

echo.
echo Stopping Caddy...
taskkill /F /IM caddy.exe >nul 2>&1
if errorlevel 1 (
    echo [INFO] Caddy not running
) else (
    echo [OK] Caddy stopped
)

echo.
echo All servers stopped.
timeout /t 2 >nul
