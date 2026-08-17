@echo off
setlocal
cd /d "%~dp0"
call npm install --no-audit --no-fund
if errorlevel 1 exit /b 1
node -e "const Database = require('better-sqlite3'); new Database(':memory:').close()" >nul 2>&1
if errorlevel 1 (
  echo Rebuilding better-sqlite3 for the active Node version...
  call npm rebuild better-sqlite3
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
node dist\run.js %*
