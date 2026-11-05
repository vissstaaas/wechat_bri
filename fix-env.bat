@echo off
chcp 936 >nul
echo ============================================================
echo [1] Checking AppDomain Manager / .NET Hook Environment Vars
echo ============================================================

set APPDOMAIN_MANAGER_ASM=
set APPDOMAIN_MANAGER_TYPE=
set COMPLUS_Version=
set COMPLUS_InstallRoot=

echo Testing PowerShell in clean environment...
powershell.exe -NoProfile -Command "Write-Host '[SUCCESS] PowerShell CLR is WORKING!' -ForegroundColor Green"
if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo [FOUND CAUSE] The issue is caused by toxic .NET environment variables!
    echo Removing toxic variables from Windows Registry...
    echo ============================================================
    reg delete "HKCU\Environment" /v APPDOMAIN_MANAGER_ASM /f 2>nul
    reg delete "HKCU\Environment" /v APPDOMAIN_MANAGER_TYPE /f 2>nul
    reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v APPDOMAIN_MANAGER_ASM /f 2>nul
    reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v APPDOMAIN_MANAGER_TYPE /f 2>nul
    echo Done! Please restart Antigravity or reopen terminal.
    pause
    exit /b 0
)

echo.
echo PowerShell still failed. Checking registry entries...
reg query "HKCU\Environment" 2>nul | findstr /i "APPDOMAIN COMPLUS DOTNET"
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" 2>nul | findstr /i "APPDOMAIN COMPLUS DOTNET"

echo.
echo ============================================================
echo [2] Running System Repair (Requires Administrator)
echo ============================================================
sfc /scannow
pause
