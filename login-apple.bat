@echo off
title NoteBridge AI - Apple iCloud Login
cd /d "%~dp0"

if not exist "node_modules" call npm install

echo [INFO] Starting Apple iCloud login...
node node_modules/icloud-md/dist/cli.js clone ./notes
pause
