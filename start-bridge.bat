@echo off
title NoteBridge AI
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto NO_NODE

if not exist "node_modules" goto INSTALL_DEPS
goto CHECK_LOGIN

:INSTALL_DEPS
echo [INFO] Installing dependencies...
call npm install
if errorlevel 1 goto INSTALL_FAILED

:CHECK_LOGIN
node check-login.js
if errorlevel 42 goto DO_LOGIN
goto RUN_SERVER

:DO_LOGIN
echo [INFO] WeChat not bound yet, starting QR login...
node login-wechat.js
if errorlevel 1 goto LOGIN_FAILED

:RUN_SERVER
echo [INFO] Starting server on http://localhost:3080
node server.js
pause
exit /b 0

:INSTALL_FAILED
echo [ERROR] npm install failed. Check your network.
pause
exit /b 1

:LOGIN_FAILED
echo [ERROR] WeChat login not completed.
pause
exit /b 1

:NO_NODE
echo [ERROR] Node.js not found. Install Node.js 22.13+ from https://nodejs.org/
pause
exit /b 1
