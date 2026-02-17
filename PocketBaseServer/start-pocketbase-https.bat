@echo off
echo ================================================
echo Starting PocketBase with HTTPS
echo ================================================
echo.

REM Find IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP:~1%

echo Your IP Address: %IP%
echo.
echo PocketBase will be available at:
echo   - https://%IP%:8090
echo   - https://localhost:8090
echo.
echo Press Ctrl+C to stop PocketBase
echo ================================================
echo.

REM Start PocketBase with HTTPS
pocketbase.exe serve --http=%IP%:8090 --https=key.pem:cert.pem --origins="https://%IP%:3000,https://localhost:3000,https://%IP%:8090,https://localhost:8090"

pause
