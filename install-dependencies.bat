@echo off
cd /d "%~dp0"

set "CODEX_NODE=C:\Users\EggacheTang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "CODEX_PNPM=C:\Users\EggacheTang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs"

if not exist "%CODEX_NODE%" (
  echo Codex bundled node.exe was not found:
  echo   %CODEX_NODE%
  echo.
  echo Install Node.js from https://nodejs.org/ or run this project inside Codex.
  pause
  exit /b 1
)

if not exist "%CODEX_PNPM%" (
  echo Codex bundled pnpm was not found:
  echo   %CODEX_PNPM%
  pause
  exit /b 1
)

set "PATH=C:\Users\EggacheTang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

"%CODEX_NODE%" "%CODEX_PNPM%" install
"%CODEX_NODE%" "%CODEX_PNPM%" approve-builds electron
"%CODEX_NODE%" "%CODEX_PNPM%" rebuild electron

echo.
echo Dependencies are ready. You can run start-electron.bat now.
pause
