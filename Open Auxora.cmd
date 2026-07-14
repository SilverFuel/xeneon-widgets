@echo off
setlocal

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-xeneon.ps1"
set EXITCODE=%ERRORLEVEL%

if not %EXITCODE% EQU 0 pause
endlocal & exit /b %EXITCODE%
