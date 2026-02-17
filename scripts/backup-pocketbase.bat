@echo off
:: Backup PocketBase pb_data to avoid data loss.
:: Run this regularly (e.g. daily via Task Scheduler) and/or before updates.

setlocal
set PB=%~dp0..\PocketBaseServer
set BACKUP_ROOT=%~dp0..\backups
set STAMP=%date:~-4,4%-%date:~-10,2%-%date:~-7,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
set STAMP=%STAMP: =0%
set DEST=%BACKUP_ROOT%\pb_data_%STAMP%

if not exist "%PB%\pb_data" (
    echo [ERROR] PocketBase data not found at: %PB%\pb_data
    pause
    exit /b 1
)

echo Backing up PocketBase data...
echo From: %PB%\pb_data
echo To:   %DEST%
echo.

mkdir "%BACKUP_ROOT%" 2>nul
xcopy "%PB%\pb_data" "%DEST%" /E /I /H /Y

if %ERRORLEVEL% equ 0 (
    echo [OK] Backup saved to: %DEST%
    echo.
    echo Tip: Copy this folder to OneDrive, Google Drive, or external drive for off-machine backup.
) else (
    echo [ERROR] Backup failed.
    exit /b 1
)

endlocal
pause
