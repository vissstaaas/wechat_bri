@echo off
chcp 65001 >nul
title OmniBridge Core - Apple iCloud 授权
cd /d "%~dp0"

echo ========================================================
echo 正在启动 Apple iCloud (云上贵州) 授权窗口...
echo 请在弹出的浏览器窗口中输入 Apple ID 与双重验证码。
echo ========================================================
echo.

node node_modules/icloud-md/dist/cli.js reauthenticate ./notes

echo.
echo 授权操作结束，请回到网页刷新查看！
pause
