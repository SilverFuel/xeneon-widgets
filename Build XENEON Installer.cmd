@echo off
setlocal

cd /d "%~dp0"

echo Building XENEON Edge Host installer...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\build-installer.ps1"
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% EQU 0 (
  echo.
  echo Installer created in:
  echo   %~dp0app\dist
  echo.
  echo The file name includes the app version and build time.
  echo.
)

pause
endlocal & exit /b %EXITCODE%
