@echo off
cd /d "%~dp0"

if not exist node_modules\electron\dist\electron.exe (
  echo Electron dependencies are not installed yet.
  echo.
  echo Please run install-dependencies.bat first.
  echo.
  pause
  exit /b 1
)

node_modules\electron\dist\electron.exe .
