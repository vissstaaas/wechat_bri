param(
    [Parameter(Mandatory = $true)][string]$Cmd,
    [string]$Dir = $PWD
)

# 用 Win32 CreateProcessW + lpDesktop=WinSta0\default 把子进程强制启动到
# 当前会话的交互桌面，解决"服务进程/后台进程弹窗落在隐藏桌面"的问题。
$sig = @"
using System;
using System.Runtime.InteropServices;

public class DesktopLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

    public static int Run(string cmd, string dir) {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "WinSta0\\default";
        si.dwFlags = 0;
        si.wShowWindow = 1; // SW_SHOWNORMAL
        PROCESS_INFORMATION pi;
        bool ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false,
                                0x00000010 /* CREATE_NEW_CONSOLE */,
                                IntPtr.Zero, dir, ref si, out pi);
        if (!ok) {
            return -Marshal.GetLastWin32Error();
        }
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return pi.dwProcessId;
    }
}
"@

Add-Type -TypeDefinition $sig -ErrorAction Stop
$res = [DesktopLauncher]::Run($Cmd, $Dir)
if ($res -lt 0) {
    Write-Error "DesktopLauncher failed with Win32 error $res"
    exit 1
}
Write-Output "Launched PID on default desktop: $res"
