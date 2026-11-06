@echo off
chcp 65001 >nul
title OmniBridge Core - 企业级智能数据总线 (WeChat + iCloud)
cd /d "%~dp0"

echo ========================================================
echo 🚀 正在启动 OmniBridge Core (v3.0.0)...
echo 📡 访问入口: http://localhost:3080 或 http://localhost:3090
echo 🔒 架构特性: 云上贵州原生 CloudKit + 微信官方 Agent SDK
echo ========================================================
echo.

start "" "http://localhost:3080"
node src/app.js
pause
