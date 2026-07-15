@echo off
REM DealFlow AI — double-click launcher (MVP v2, P1).
REM Delegates to launch.ps1 (health-checks the stack, then opens the browser).
REM Exits non-zero if the stack never becomes healthy — never opens a broken tab.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed - see the log lines above.
  pause
  exit /b 1
)
pause
