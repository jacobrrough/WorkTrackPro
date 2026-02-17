@echo off
:: Stop All Services

title Stop WorkTrack Pro
color 0C

echo Stopping all WorkTrack Pro services...
echo.

taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM pocketbase.exe >nul 2>&1
taskkill /F /IM caddy.exe >nul 2>&1

echo All services stopped.
timeout /t 2 >nul
