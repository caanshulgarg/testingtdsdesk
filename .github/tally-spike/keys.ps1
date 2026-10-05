# Bring the window of process $proc (or title match) to the front and send keys with SendKeys
param([string]$match, [string]$keys)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W32 { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }
'@ -ErrorAction SilentlyContinue
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -match $match -or $_.ProcessName -match $match) } | Select-Object -First 1
if (-not $p) { Write-Host "[keys] no window matching '$match'"; return }
[W32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait($keys)
Write-Host "[keys] sent '$keys' to $($p.ProcessName) '$($p.MainWindowTitle)'"
