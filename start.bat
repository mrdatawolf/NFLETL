@echo off
setlocal
cd /d "%~dp0"
call npm install --no-audit --no-fund
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
node dist\run.js %*
