@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ui.ps1" %*
if errorlevel 1 (
  echo.
  echo No se pudo iniciar Rey30 IDvj. Revisa el mensaje anterior.
  pause
  exit /b 1
)
