@echo off
:: WorkTrack Pro - START WITH PROXY (USES NETWORK IP FOR PROXY TARGET)

setlocal enabledelayedexpansion
title WorkTrack Pro
color 0B

cls
echo ========================================
echo  WorkTrack Pro - Starting WITH PROXY
echo ========================================
echo.

:: Check and install dependencies (first time only)
if not exist "node_modules" (
    echo ========================================
    echo  Installing Dependencies (First Time)
    echo ========================================
    echo.
    echo This may take a few minutes...
    echo.
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed successfully
    echo.
) else (
    echo [OK] Dependencies already installed
    echo.
)

:: Get IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :ip_found
)
:ip_found
set IP=%IP:~1%
echo IP: %IP%
echo.

:: Generate SSL certs if needed
if not exist "key.pem" (
    echo Generating SSL certificates...
    openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost" >nul 2>&1
    echo [OK] Certificates created
    echo.
)

:: Update .env with PROXY URL
(
echo VITE_POCKETBASE_URL=https://%IP%:3000
) > .env
echo [OK] .env configured with proxy URL
echo.

:: Update vite.config.ts with PROXY pointing to NETWORK IP
echo Updating vite.config.ts with proxy...
(
echo import { defineConfig } from 'vite'
echo import react from '@vitejs/plugin-react'
echo import fs from 'fs'
echo import path from 'path'
echo.
echo export default defineConfig^(^{
echo   plugins: [react^(^)],
echo   server: {
echo     https: {
echo       key: fs.readFileSync^(path.resolve^(__dirname, 'key.pem'^)^),
echo       cert: fs.readFileSync^(path.resolve^(__dirname, 'cert.pem'^)^),
echo     },
echo     host: '0.0.0.0',
echo     port: 3000,
echo     proxy: {
echo       '/api': {
echo         target: 'http://%IP%:8090',
echo         changeOrigin: true,
echo         secure: false,
echo         rewrite: ^(path^) =^> path
echo       },
echo       '/_': {
echo         target: 'http://%IP%:8090',
echo         changeOrigin: true,
echo         secure: false
echo       }
echo     }
echo   }
echo }^)
) > vite.config.ts
echo [OK] vite.config.ts updated with proxy to %IP%:8090
echo.

echo ========================================
echo Starting Servers
echo ========================================
echo.

:: Start PocketBase on NETWORK IP
if not exist "PocketBaseServer\pocketbase.exe" (
    echo [ERROR] PocketBaseServer\pocketbase.exe not found!
    pause
    exit /b 1
)

echo Starting PocketBase on %IP%:8090...
cd PocketBaseServer
start "PocketBase" /MIN cmd /c "title PocketBase && pocketbase.exe serve --http=%IP%:8090 --origins=* && pause"
cd ..

timeout /t 3 >nul
echo [OK] PocketBase started
echo.

echo Starting Vite with HTTPS and proxy...
echo.
echo ========================================
echo  Access At:
echo ========================================
echo.
echo   App:    https://%IP%:3000
echo   Admin:  http://%IP%:8090/_/
echo.
echo   Proxy:  /api -^> http://%IP%:8090
echo.
echo ========================================
echo.

call npm run dev

echo.
echo Vite stopped. Run STOP-ALL.bat to stop PocketBase.
pause
