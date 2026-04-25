@echo off
setlocal

cd /d "%~dp0"

rem --- Prefer the native XENEON Edge Host if published ---
if exist "%~dp0publish\XenonEdgeHost.exe" (
echo Starting XENEON Edge Host...
start "" "%~dp0publish\XenonEdgeHost.exe"
goto :done
)

rem --- Use the installed per-user app when publish output is not present ---
if exist "%LOCALAPPDATA%\Programs\XenonEdgeHost\XenonEdgeHost.exe" (
  echo Starting installed XENEON Edge Host...
  start "" "%LOCALAPPDATA%\Programs\XenonEdgeHost\XenonEdgeHost.exe"
  goto :done
)

echo XENEON Edge Host was not found.
echo Build the installer with "Build XENEON Installer.cmd", or run app\publish.ps1 first.
pause

:done
endlocal
