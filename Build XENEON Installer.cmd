@echo off
setlocal

cd /d "%~dp0"

echo Building XENEON Edge Host installer...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\build-installer.ps1"
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% EQU 0 (
  echo.
  echo Installer created:
  echo   %~dp0app\dist\XenonEdgeHost-Setup.exe
  echo.
)

pause
endlocal & exit /b %EXITCODE%
