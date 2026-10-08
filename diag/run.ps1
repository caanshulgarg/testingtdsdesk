# Diagnostic only: start FinCom Bridge (worker, runMode "user") as $Who, then ask it /ping and /status from curl,
# Invoke-WebRequest, Edge and Chrome (headless and headed) of the same Windows user; print what it says and logs.
param([string]$Who = 'admin', [string]$Bin = 'C:\fcdiag\bin', [string]$Here = $PSScriptRoot, [string]$Only = '')
$ErrorActionPreference = 'Continue'
$root = "C:\fcdiag\$Who"
New-Item -ItemType Directory -Force $root | Out-Null
$cred = $null
if ($Who -like 'std*') {
  $pw = 'Fc!' + [guid]::NewGuid().ToString('N').Substring(0, 16) + 'aA1'
  net user fcdiag $pw /add /y 2>$null | Out-Null
  net user fcdiag $pw | Out-Null
  $cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\fcdiag", (ConvertTo-SecureString $pw -AsPlainText -Force))
  icacls $root /grant 'fcdiag:(OI)(CI)F' | Out-Null
  icacls $Bin /grant 'fcdiag:(OI)(CI)RX' | Out-Null
  icacls $Here /grant 'fcdiag:(OI)(CI)RX' | Out-Null
}
Write-Host "=== as $Who; runner: $(whoami); EnableLUA=$((Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System).EnableLUA)"
whoami /groups | Select-String 'Mandatory Label'
function Start-As([string]$exe, [string]$argList, [string]$tag) {
  $p = @{ FilePath = $exe; ArgumentList = $argList; PassThru = $true; WorkingDirectory = $root
          RedirectStandardOutput = "$root\$tag.out"; RedirectStandardError = "$root\$tag.err" }
  if ($cred) { $p.Credential = $cred; $p.LoadUserProfile = $true }
  Start-Process @p
}
function Run-As([string]$exe, [string]$argList, [string]$tag, [int]$sec = 60) {
  $p = Start-As $exe $argList $tag
  if (-not $p.WaitForExit($sec * 1000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Get-Content "$root\$tag.out", "$root\$tag.err" -ErrorAction SilentlyContinue
}

Set-Content "$root\tds-bridge.config.json" '{"Port":9100,"Key":"diag-key-0123456789abcdef0123","AllowedOrigins":["http://localhost"]}'
$bridge = Start-As "$Bin\FinComBridge.exe" "worker --config `"$root\tds-bridge.config.json`"" 'bridge'
$diag = Start-As "$Bin\diag.exe" "serve -out `"$root\results.txt`"" 'diag'
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  try { $null = Invoke-RestMethod 'http://127.0.0.1:9100/ping' -TimeoutSec 3; $up = $true } catch { Start-Sleep 1 }
}
Write-Host "bridge pid $($bridge.Id) up=$up; diag pid $($diag.Id)"
if (-not $up) { Get-Content "$root\bridge.out", "$root\bridge.err", "$root\tds-bridge.log" -ErrorAction SilentlyContinue }

Write-Host "--- curl and Invoke-WebRequest (as $Who)"
Run-As 'powershell.exe' "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$Here\client.ps1`"" 'cli' | Write-Host

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
Write-Host "edge $((Get-Item $edge).VersionInfo.ProductVersion); chrome $((Get-Item $chrome).VersionInfo.ProductVersion)"
$common = '--no-first-run --no-default-browser-check --disable-sync --disable-background-networking'
$clients = @(
  @{ l = 'edge-headless'; e = $edge; a = '--headless=new' },
  @{ l = 'edge-headed'; e = $edge; a = '--window-size=800,600' },
  @{ l = 'chrome-headless'; e = $chrome; a = '--headless=new' },
  @{ l = 'chrome-headed'; e = $chrome; a = '--window-size=800,600' },
  @{ l = 'chrome-headless-nosandbox'; e = $chrome; a = '--headless=new --no-sandbox' },
  @{ l = 'chrome-headed-netsvc-inproc'; e = $chrome; a = '--enable-features=NetworkServiceInProcess2 --disable-features=NetworkServiceSandbox --window-size=800,600' },
  @{ l = 'edge-headed-netsandbox'; e = $edge; a = '--enable-features=NetworkServiceSandbox --window-size=800,600' },
  @{ l = 'chrome-headed-netsandbox'; e = $chrome; a = '--enable-features=NetworkServiceSandbox --window-size=800,600' },
  @{ l = 'chrome-headless-netsandbox'; e = $chrome; a = '--headless=new --enable-features=NetworkServiceSandbox' }
)
if ($Only) { $clients = $clients | Where-Object { $_.l -like $Only } }
foreach ($c in $clients) {
  $l = $c.l; $udd = "$root\udd-$l"
  Write-Host "--- $l"
  $bp = Start-As $c.e "$($c.a) $common --user-data-dir=`"$udd`" `"http://localhost:8000/?c=$l`"" "b-$l"
  $got = $false
  for ($i = 0; $i -lt 45 -and -not $got; $i++) {
    Start-Sleep 1
    $got = [bool](Select-String -Path "$root\results.txt" -Pattern "^RESULT $l " -Quiet -ErrorAction SilentlyContinue)
  }
  Write-Host "result posted: $got"
  # every process of this browser, while it still runs, as the same user the bridge runs as
  Run-As "$Bin\diag.exe" "procs $(Split-Path $c.e -Leaf)" "procs-$l" | Write-Host
  $mine = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($udd) }
  foreach ($m in $mine) { Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $bp.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
}

Write-Host "=== results ($Who)"
Get-Content "$root\results.txt" -ErrorAction SilentlyContinue
Write-Host "=== bridge log ($Who)"
Get-Content "$root\tds-bridge.log" -ErrorAction SilentlyContinue
Get-Content "$root\bridge.out", "$root\bridge.err", "$root\diag.err" -ErrorAction SilentlyContinue
Stop-Process -Id $bridge.Id, $diag.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 2
