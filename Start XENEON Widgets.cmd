@echo off
setlocal

cd /d "%~dp0"

rem --- Prefer the native XENEON Edge Host if published ---
if exist "%~dp0publish\XenonEdgeHost.exe" (
  echo Starting XENEON Edge Host...
  start "" "%~dp0publish\XenonEdgeHost.exe"
  goto :done
)

rem --- Fall back to bridge-only mode ---
echo Native host not found. Starting bridge-only mode...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-xeneon.ps1"

:done
endlocal
