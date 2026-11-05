@echo off
chcp 65001 >nul
title [修复] .NET CLR / PowerShell 运行时修复工具

:: ── 检查管理员权限 ──────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ============================================================
    echo  [错误] 请右键此文件，选择"以管理员身份运行"
    echo ============================================================
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  .NET CLR / PowerShell 运行时修复工具
echo  修复目标: HRESULT 80131522 (TypeLoadException)
echo ============================================================
echo.

:: ── Step 1: DISM 系统映像修复 ──────────────────────────────────
echo [1/4] 正在执行 DISM 系统映像修复 (可能需要 5-10 分钟)...
echo.
DISM /Online /Cleanup-Image /RestoreHealth
if %errorlevel% neq 0 (
    echo [警告] DISM 修复返回非零，继续后续步骤...
) else (
    echo [完成] DISM 修复成功。
)
echo.

:: ── Step 2: 系统文件检查器 ─────────────────────────────────────
echo [2/4] 正在执行系统文件检查 sfc /scannow (可能需要 5-10 分钟)...
echo.
sfc /scannow
echo.

:: ── Step 3: 重新注册 .NET Framework 程序集 ─────────────────────
echo [3/4] 正在重新注册 .NET Framework 本机映像...
echo.

set "FWDIR=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319"
if not exist "%FWDIR%\ngen.exe" (
    set "FWDIR=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319"
)

if exist "%FWDIR%\ngen.exe" (
    echo   使用: %FWDIR%\ngen.exe
    "%FWDIR%\ngen.exe" update /force /queue
    "%FWDIR%\ngen.exe" executeQueuedItems
    echo [完成] .NET 本机映像重新生成完毕。
) else (
    echo [跳过] 未找到 ngen.exe，可能需要手动安装 .NET Framework 4.8。
)
echo.

:: ── Step 4: 验证 PowerShell 是否恢复 ──────────────────────────
echo [4/4] 正在验证 PowerShell 是否恢复正常...
echo.
powershell -NoProfile -Command "Write-Host '[验证通过] PowerShell CLR 已恢复正常!' -ForegroundColor Green; $PSVersionTable"
if %errorlevel% neq 0 (
    echo.
    echo ============================================================
    echo  [未完全修复] PowerShell 仍然异常。
    echo  建议重启电脑后再次运行此脚本，或手动安装:
    echo  https://dotnet.microsoft.com/download/dotnet-framework/net48
    echo ============================================================
) else (
    echo.
    echo ============================================================
    echo  [全部完成] 系统修复成功！PowerShell 已恢复。
    echo  现在可以正常使用 Antigravity 的后台命令了。
    echo ============================================================
)
echo.
pause
