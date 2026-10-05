@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting DriveOne. Open the local address printed below.
node --env-file-if-exists=.env src/server.js
if errorlevel 1 pause
