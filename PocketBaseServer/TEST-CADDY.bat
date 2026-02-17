@echo off
:: Test Caddy Configuration

title Caddy Test
color 0C

echo ========================================
echo  Caddy Configuration Test
echo ========================================
echo.

:: Get IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP:~1%

echo Your IP: %IP%
echo.

:: Check Caddyfile
if not exist "Caddyfile" (
    echo [ERROR] Caddyfile not found!
    pause
    exit /b 1
)

echo Current Caddyfile:
echo ------------------
type Caddyfile
echo ------------------
echo.

:: Check if Caddy is running
tasklist /FI "IMAGENAME eq caddy.exe" 2>NUL | find /I /N "caddy.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [INFO] Caddy is currently running
    echo.
    echo Ports in use:
    netstat -ano | findstr :8090
    echo.
) else (
    echo [INFO] Caddy is not running
)

echo.
echo Test the following URLs:
echo   1. https://localhost:8090/_/
echo   2. https://%IP%:8090/_/
echo.

pause

echo.
echo Starting Caddy in FOREGROUND mode...
echo (Check for any errors about binding)
echo.
pause

caddy.exe run
