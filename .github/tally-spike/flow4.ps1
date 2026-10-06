# Round 4: FinCom Bridge 2.3.0 (built from $env:BRIDGE_SHA, the setup in $env:BRIDGE_DIST) on real TallyPrime, its cloud
# a local stub (stub.py). Both bridges are installed with the real setup, "just for me" (/S /CURRENTUSER /MODE=sole):
#   user 1: runneradmin (the runner's own user), its Tally on 9000, company "FinCom Spike Co"
#   user 2: fcuser2, a local Windows user made here (not an administrator); everything of theirs (the settings, the setup,
#           the bridge it starts, their own Tally on 9001 with company "FinCom Spike U2") runs as fcuser2 through
#           Start-Process -Credential -LoadUserProfile (the secondary logon: no interactive sign-in on a hosted runner)
# Steps 1-5 on user 1's Tally by keys: create, alter, Alt+2 copy, cancel, delete; step 6: the two bridges side by side
# (ports, the /ping proof, beats, attribution of recorder lines, user 2's own Tally events). One PASS/FAIL line each,
# kept in round4\results.txt (the workflow fails the job on any FAIL).
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $rec = 'C:\ProgramData\FinCom\recorder'
$co1 = 'FinCom Spike Co'; $co2 = 'FinCom Spike U2'
$out = Join-Path $env:RES 'round4'; New-Item -ItemType Directory -Force $out | Out-Null
$fc = 'C:\fcspike'; New-Item -ItemType Directory -Force $fc, "$fc\tmp", "$fc\u2data", $rec | Out-Null
& icacls.exe $fc /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null
# the recorder folder as the all-users install leaves it for Tally's add-on: every user may add and write their own files
& icacls.exe $rec /grant '*S-1-5-32-545:(OI)(CI)M' /Q | Out-Null
$resultsFile = Join-Path $out 'results.txt'; Set-Content $resultsFile -Value @() -Encoding UTF8
$script:fails = 0
# harness failures (user 2's scheduled task never ran a step): not the bridge's; a HARNESS line, the job fails apart from FAIL
$script:harness = 0
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function Result($step, [bool]$ok, $evidence, [bool]$harness = $false) {
  $l = '{0} {1}: {2}' -f $(if ($ok) { 'PASS' } elseif ($harness) { 'HARNESS' } else { 'FAIL' }), $step, $evidence
  Write-Host "######## $l"; Add-Content -Path $resultsFile -Value $l -Encoding UTF8
}
function Shot($n) { & "$PSScriptRoot\shot.ps1" "r4-$n" }

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W32F4 { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }
'@
$script:tallyPids = @{}
# keys to one Tally's window by its process (two Tallys run: never by name); the other Tally is minimised first
function KeysTo([int]$port, [string]$k, $wait = 3, $n = '') {
  $tp = $script:tallyPids[$port]
  $p = Get-Process -Id $tp -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { Write-Host "[keys] Tally :$port (pid $tp) has no window"; return }
  foreach ($o in $script:tallyPids.Keys) {
    if ($o -ne $port) { $q = Get-Process -Id $script:tallyPids[$o] -ErrorAction SilentlyContinue; if ($q -and $q.MainWindowHandle -ne 0) { [W32F4]::ShowWindow($q.MainWindowHandle, 6) | Out-Null } }
  }
  [W32F4]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [W32F4]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 700
  [System.Windows.Forms.SendKeys]::SendWait($k)
  Write-Host "[keys] '$k' -> Tally :$port '$($p.MainWindowTitle)'"
  Start-Sleep $wait; if ($n) { Shot $n }
}
function Post([int]$port, $body, $label = '') {
  try { $c = (Invoke-WebRequest "http://localhost:$port" -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60).Content
    if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 600) { $s = $s.Substring(0, 600) + '...' }; Write-Host "[$label :$port] $s" }
    return $c } catch { Write-Host "[$label :$port] failed: $($_.Exception.Message)"; return '' }
}
function ListCo([int]$port) { Post $port '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>' 'companies' }
function AddLedger([int]$port, $co) {
  Post $port ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Spike Income" ACTION="Create"><NAME.LIST><NAME>Spike Income</NAME></NAME.LIST><PARENT>Indirect Incomes</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'ledger Spike Income' | Out-Null
}
# Tally's vouchers of a company: GUID, MasterID, AlterID, cancelled
function Vouchers([int]$port, $co) {
  $x = Post $port ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, AMOUNT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $l = @()
  try {
    $d = [xml]($x -replace '&#4;', '')
    foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) {
      $l += [pscustomobject]@{ guid = "$($v.GUID.'#text')$(if ($v.GUID -is [string]) { $v.GUID })".Trim(); mid = [int]("$($v.MASTERID.'#text')$(if ($v.MASTERID -is [string]) { $v.MASTERID })".Trim()); aid = [int]("$($v.ALTERID.'#text')$(if ($v.ALTERID -is [string]) { $v.ALTERID })".Trim()); cancelled = ("$($v.ISCANCELLED.'#text')$(if ($v.ISCANCELLED -is [string]) { $v.ISCANCELLED })".Trim() -eq 'Yes'); vno = "$($v.VOUCHERNUMBER.'#text')$(if ($v.VOUCHERNUMBER -is [string]) { $v.VOUCHERNUMBER })".Trim() }
    }
  } catch { Write-Host "vouchers :$port parse: $_"; Set-Content (Join-Path $out "vouchers-unparsed-$port.xml") $x }
  $l | ForEach-Object { Write-Host ("  Tally :{0} voucher mid={1} aid={2} guid={3} no={4} cancelled={5}" -f $port, $_.mid, $_.aid, $_.guid, $_.vno, $_.cancelled) }
  return , $l
}
function WaitPort([int]$port, $sec = 90) {
  for ($i = 0; $i -lt $sec / 3; $i++) { Start-Sleep 3; try { Invoke-WebRequest "http://localhost:$port" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true } catch {} }
  return $false
}
function Write-TallyIni($path, $data, [int]$port, $tdl, $load) {
  $l = @('[Tally]', "Data = $data", "Config = $(Split-Path $path)", "LangPath = $(Split-Path $path)\lang", 'Client Server = Both', "ServerPort = $port", 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($load) { $l += @('Default Companies = Yes', "Load = $load") } else { $l += 'Default Companies = No' }
  if ($tdl) { $l += "TDL = $tdl" }
  Set-Content -Path $path -Value $l -Encoding ASCII
}

# ---- the bridge built from the ref
Say '---- the bridge built from the ref'
$setupSrc = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-*.exe' | Select-Object -First 1
Get-Content (Join-Path $env:BRIDGE_DIST 'bridge-source.txt') | Write-Host
$origin = Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue
Write-Host "$origin"
Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO $origin; on this runner SHA-256 $((Get-FileHash $setupSrc.FullName).Hash.ToLower())"
Write-Host "setup: $($setupSrc.Name) $($setupSrc.Length) bytes SHA256 $((Get-FileHash $setupSrc.FullName).Hash)"
$setup = "$fc\FinComBridge-Setup.exe"; Copy-Item $setupSrc.FullName $setup
$tdl = "$fc\FinComRecorder.tdl"; Copy-Item (Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl') $tdl
& icacls.exe $fc /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null

# ---- the second Windows user (not an administrator)
Say '---- the second Windows user (not an administrator)'
$u2 = 'fcuser2'
$chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $b = New-Object byte[] 20; $rng.GetBytes($b)
$pw = (-join ($b | ForEach-Object { $chars[$_ % $chars.Length] })) + 'Aa1!'  # never printed
$sec = ConvertTo-SecureString $pw -AsPlainText -Force
New-LocalUser -Name $u2 -Password $sec -PasswordNeverExpires -AccountNeverExpires -Description 'FinCom round 4 user 2' | Out-Null
try { Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545').Name -Member $u2 } catch {}
$cred2 = New-Object System.Management.Automation.PSCredential ($u2, $sec)
$sid2 = (Get-LocalUser $u2).SID.Value
Write-Host "user 2: $u2 $sid2; administrators: $((Get-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-544').Name | ForEach-Object Name) -join ', ')"
# its profile, made once by the secondary logon
$p0 = Start-Process cmd.exe -ArgumentList '/c', 'exit' -Credential $cred2 -LoadUserProfile -WorkingDirectory $fc -PassThru; $null = $p0.Handle; $null = $p0.WaitForExit(120000)
$prof2 = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid2" -ErrorAction SilentlyContinue).ProfileImagePath
if (-not $prof2) { $prof2 = "C:\Users\$u2" }
Write-Host "user 2's profile: $prof2"
# A program started with -Credential keeps the CALLER's environment (USERNAME, LOCALAPPDATA, TEMP...): user 2's own is
# put in place for each start (round 4's first try wrote user 2's settings into runneradmin's folder)
$envU2 = @{ USERNAME = $u2; USERPROFILE = $prof2; LOCALAPPDATA = "$prof2\AppData\Local"; APPDATA = "$prof2\AppData\Roaming"; HOMEPATH = $prof2.Substring(2); HOMEDRIVE = $prof2.Substring(0, 2); TEMP = "$fc\tmp"; TMP = "$fc\tmp" }
function AsU2([string]$file, [string[]]$argv, [int]$waitMs = 300000) {
  $saved = @{}; foreach ($k in $envU2.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envU2[$k]) }
  try {
    $sp = @{ FilePath = $file; Credential = $cred2; LoadUserProfile = $true; WorkingDirectory = $fc; PassThru = $true }
    if ($argv.Count) { $sp.ArgumentList = $argv }
    $p = Start-Process @sp
    $null = $p.Handle
  } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
  if ($waitMs -le 0) { return $p }
  if (-not $p.WaitForExit($waitMs)) { Write-Host "[as $u2] $file did not end in time"; return -1 }
  return $p.ExitCode
}

# ---- user 2 in a Windows session of their own: a Remote Desktop connection from this desktop to 127.0.0.2 (as on a
# shared server); when that cannot be had, user 2's programs run through the secondary logon in the runner's session
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' fDenyTSConnections 0
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' UserAuthentication 0
try { Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction Stop } catch { Write-Host "firewall: $_" }
try { Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-555').Name -Member $u2 } catch { Write-Host "Remote Desktop Users: $_" }
Start-Service TermService -ErrorAction SilentlyContinue
New-Item -Force 'HKCU:\Software\Microsoft\Terminal Server Client' | Out-Null
Set-ItemProperty 'HKCU:\Software\Microsoft\Terminal Server Client' AuthenticationLevelOverride 0 -Type DWord
& cmdkey.exe "/generic:TERMSRV/127.0.0.2" "/user:$u2" "/pass:$pw" | Out-Null
Set-Content "$fc\u2.rdp" -Encoding ASCII -Value @('full address:s:127.0.0.2', "username:s:$u2", 'screen mode id:i:1', 'desktopwidth:i:1024', 'desktopheight:i:740', 'authentication level:i:0', 'prompt for credentials:i:0', 'promptcredentialonce:i:0', 'redirectclipboard:i:0', 'redirectprinters:i:0', 'redirectsmartcards:i:0', 'redirectdrives:i:0', 'audiomode:i:2')
# /v: rather than an .rdp file (Windows Server 2025 asks before it opens an .rdp file)
$mstsc = Start-Process mstsc.exe -ArgumentList '/v:127.0.0.2', '/w:1024', '/h:740' -PassThru
$rdp = $false; $sess2 = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 4
  $q = (& query.exe session 2>&1) -join "`n"
  $m = [regex]::Match($q, "(?im)\s$u2\s+(\d+)\s+Active")
  if ($m.Success) { $sess2 = [int]$m.Groups[1].Value; $rdp = $true; break }
  if ($i % 5 -eq 2) { Shot ("rdp-wait-{0:d2}" -f $i) }
  # a question from the Remote Desktop client (an .rdp file's consent, a certificate): its own keys (I understand / Yes)
  if ($i -in 4, 9, 14) {
    Get-Process mstsc -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  mstsc window: '$($_.MainWindowTitle)'" }
    $w = Get-Process mstsc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($w) { [W32F4]::SetForegroundWindow($w.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500; [System.Windows.Forms.SendKeys]::SendWait('%i'); Start-Sleep 1; [System.Windows.Forms.SendKeys]::SendWait('%y'); Start-Sleep 1; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
  }
}
Write-Host (& query.exe session 2>&1 | Out-String)
Say "user 2's own Windows session by Remote Desktop: $rdp (session $sess2)"
if (-not $rdp) { Stop-Process -Id $mstsc.Id -Force -ErrorAction SilentlyContinue }
if ($rdp) {
  # the sign-in finished (explorer up) before anything is started there
  for ($i = 0; $i -lt 30; $i++) { if (Get-Process explorer -ErrorAction SilentlyContinue | Where-Object SessionId -eq $sess2) { break }; Start-Sleep 3 }
  Start-Sleep 20; Shot '03-rdp-session'
}
# user 2's programs in that session: a scheduled task of user 2's, run only while they are signed in (/IT), runs
# C:\fcspike\task.ps1, which runs the script named in task-in.json and writes its output and a done mark
Set-Content "$fc\task.ps1" -Encoding UTF8 -Value @'
$in = Get-Content C:\fcspike\task-in.json -Raw | ConvertFrom-Json
$a = @($in.argv | ForEach-Object { [string]$_ })
try { & $in.script @a *>&1 | Out-File C:\fcspike\task-out.txt -Encoding utf8 } catch { "ERROR $_" | Out-File C:\fcspike\task-out.txt -Append -Encoding utf8 }
"done" | Set-Content C:\fcspike\task-done.txt
'@
if ($rdp) {
  # an interactive task: it runs as user 2 in the session they are signed in to (no password stored)
  # through a headless console host: no window of its own that would take the front from user 2's Tally
  $act = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\fcspike\task.ps1' -WorkingDirectory $fc
  $pr = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$u2" -LogonType Interactive -RunLevel Limited
  $st = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
  try { Register-ScheduledTask -TaskName fcu2 -Action $act -Principal $pr -Settings $st -Force -ErrorAction Stop | Out-Null; Write-Host "task fcu2 registered for $u2 (interactive)" } catch { Write-Host "task: $_" }
}
# a PowerShell script run as user 2 (in their session, or through the secondary logon); its output back as lines
function U2Script([string]$script, [string[]]$argv = @(), [int]$sec = 300) {
  Remove-Item "$fc\task-done.txt", "$fc\task-out.txt" -ErrorAction SilentlyContinue
  if ($rdp) {
    # the previous run writes its done mark just before its PowerShell ends: a start while it still runs is dropped
    # (MultipleInstances IgnoreNew), so wait for the task to be Ready first
    for ($w = 0; $w -lt 40 -and (Get-ScheduledTask fcu2 -ErrorAction SilentlyContinue).State -eq 'Running'; $w++) { Start-Sleep -Milliseconds 500 }
    @{ script = $script; argv = $argv } | ConvertTo-Json | Set-Content "$fc\task-in.json" -Encoding UTF8
    try { Start-ScheduledTask -TaskName fcu2 -ErrorAction Stop } catch { Write-Host "  task start: $_" }
    $t0 = Get-Date; $until = $t0.AddSeconds($sec); $restarts = 0; $next = $t0.AddSeconds(30)
    while (-not (Test-Path "$fc\task-done.txt") -and (Get-Date) -lt $until) {
      Start-Sleep -Milliseconds 500
      if ((Get-Date) -ge $next -and $restarts -lt 3 -and -not (Test-Path "$fc\task-done.txt")) {
        $next = (Get-Date).AddSeconds(30)
        $stt = (Get-ScheduledTask fcu2 -ErrorAction SilentlyContinue).State
        if ($stt -eq 'Ready') {
          $restarts++; $ti = Get-ScheduledTaskInfo -TaskName fcu2 -ErrorAction SilentlyContinue
          Write-Host "  [harness] task fcu2 has not run $script after $([int]((Get-Date) - $t0).TotalSeconds) s (state Ready, last run $($ti.LastRunTime) result 0x$('{0:x}' -f $ti.LastTaskResult)): Start-ScheduledTask again ($restarts of 3)"
          try { Start-ScheduledTask -TaskName fcu2 -ErrorAction Stop } catch { Write-Host "  task start: $_" }
        }
      }
    }
    if (-not (Test-Path "$fc\task-done.txt")) {
      $ti = Get-ScheduledTaskInfo -TaskName fcu2 -ErrorAction SilentlyContinue
      $script:harness++
      Write-Host "  HARNESS: user 2's task did not run: task fcu2 did not finish $script in $sec s after $restarts restart(s): last run $($ti.LastRunTime) result 0x$('{0:x}' -f $ti.LastTaskResult), state $((Get-ScheduledTask fcu2).State)"
    } elseif ($restarts) { Write-Host "  [harness] task fcu2 ran $script after $restarts restart(s)" }
  } else {
    $null = AsU2 'powershell.exe' (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"") + @($argv | ForEach-Object { "`"$_`"" })) ($sec * 1000)
  }
  $r = @(Get-Content "$fc\task-out.txt" -ErrorAction SilentlyContinue); $r | ForEach-Object { Write-Host "  [as $u2] $_" }; return , $r
}
# what user 2's scripts use: start a program and say its process; keys to their Tally (in their session); a screenshot
Set-Content "$fc\start.ps1" -Encoding UTF8 -Value @'
param($file, $wd, $a1, $a2, $a3)
$argv = @($a1, $a2, $a3) | Where-Object { $_ }
$sp = @{ FilePath = $file; WorkingDirectory = $wd; PassThru = $true }; if ($argv) { $sp.ArgumentList = $argv }
$p = Start-Process @sp
"pid=$($p.Id) session=$($p.SessionId) user=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
'@
Set-Content "$fc\runwait.ps1" -Encoding UTF8 -Value @'
param($file, $a1, $a2, $a3)
$p = Start-Process -FilePath $file -ArgumentList (@($a1, $a2, $a3) | Where-Object { $_ }) -PassThru; $null = $p.Handle
$null = $p.WaitForExit(300000); "exit=$($p.ExitCode) user=$([Security.Principal.WindowsIdentity]::GetCurrent().Name) session=$((Get-Process -Id $PID).SessionId)"
'@
Set-Content "$fc\keys2.ps1" -Encoding UTF8 -Value @'
param($k, $wait, $shot)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class K2 { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); }
"@
$me = (Get-Process -Id $PID).SessionId
$p = Get-Process tally -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $me -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $fg = ([K2]::GetForegroundWindow() -eq $p.MainWindowHandle)
  for ($t = 0; $t -lt 5 -and -not $fg; $t++) {
    [K2]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [K2]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [K2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; [K2]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 700; $fg = ([K2]::GetForegroundWindow() -eq $p.MainWindowHandle)
  }
  if ($k) { for ($t = 0; $t -lt 4; $t++) { try { [System.Windows.Forms.SendKeys]::SendWait($k); break } catch { "SendWait try $t`: $_"; Start-Sleep 2 } } }
  "keys '$k' -> Tally pid $($p.Id) '$($p.MainWindowTitle)' session $me foreground=$fg"
} else { if ($k) { [System.Windows.Forms.SendKeys]::SendWait($k) }; "no Tally window in session $me; keys '$k' to the window in front" }
Start-Sleep ([int]$wait)
if ($shot) {
  try { $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save("C:\fcspike\shots\$shot.png"); "shot $shot" } catch { "shot $shot failed: $_" }
}
'@
New-Item -ItemType Directory -Force "$fc\shots" | Out-Null
& icacls.exe $fc /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null
Set-Content "$fc\who.ps1" -Encoding UTF8 -Value '"who=$([Security.Principal.WindowsIdentity]::GetCurrent().Name) session=$((Get-Process -Id $PID).SessionId)"'
if ($rdp) {
  $w = (U2Script "$fc\who.ps1" @() 60) -join ' '
  if ($w -notmatch "who=\S*\\$u2 session=$sess2") {
    Write-Host "user 2's task did not run in their session ($w): their programs go through the secondary logon instead"
    $rdp = $false; & logoff.exe $sess2 2>&1 | Out-Null; Stop-Process -Id $mstsc.Id -Force -ErrorAction SilentlyContinue
  } else { $null = U2Script "$fc\keys2.ps1" @('{ENTER}', '2', 'u2-desktop') }  # a notice on user 2's new desktop closed
}
Add-Content -Path $resultsFile -Encoding UTF8 -Value $(if ($rdp) { "INFO user 2 ($u2) works in a Windows session of their own (session $sess2, by a Remote Desktop connection to 127.0.0.2); runneradmin in session $((Get-Process -Id $PID).SessionId)" } else { "INFO no session of their own for user 2: their programs run through the secondary logon (Start-Process -Credential) in the runner's session $((Get-Process -Id $PID).SessionId)" })

# ---- the stub cloud
Say '---- the stub cloud'
$stubLog = Join-Path $out 'stub-requests.jsonl'
$py = (Get-Command python).Source
$stub = Start-Process -FilePath $py -ArgumentList "`"$PSScriptRoot\stub.py`" 8787 `"$stubLog`"" -PassThru -WindowStyle Hidden
Start-Sleep 3

# ---- user 1's Tally (9000) with the add-on; a copy of the program for user 2 first (its own tally.ini and port)
Say '---- user 1''s Tally (9000) with the add-on; a copy of the program for user 2 first (its own tally.ini and port)'
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
$t2dir = "$fc\tally2"
Get-Process | Where-Object { $_.Path -like "$dir\*" } | ForEach-Object { Write-Host "  still running from the Tally folder: $($_.Name) $($_.Id)" }
& robocopy.exe $dir $t2dir /E /R:0 /W:0 /XD logs /NFL /NDL /NJH /NP | Select-Object -Last 8 | ForEach-Object { Write-Host "  robocopy: $_" }
Write-Host "[$(Get-Date -Format HH:mm:ss)] copy for user 2: robocopy $LASTEXITCODE, tally.exe there: $(Test-Path "$t2dir\tally.exe")"
& icacls.exe $t2dir /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null
Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue
Write-TallyIni (Join-Path $dir 'tally.ini') $data1 9000 $tdl 100000
$t1 = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tallyPids[9000] = $t1.Id
Write-Host "Tally :9000 answers: $(WaitPort 9000)"; Start-Sleep 5
KeysTo 9000 'a' 4; KeysTo 9000 't' 10 '00-tally1'
AddLedger 9000 $co1
# check 7: a party like the owner's (Salesify Marketing LLP, Sundry Debtors, balances kept bill by bill), before the bridges start
$sal = 'Salesify Marketing LLP'
Post 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="' + $sal + '" ACTION="Create"><NAME.LIST><NAME>' + $sal + '</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') "ledger $sal (bill-by-bill)" | Out-Null

# check 8's masters on user 1's Tally (before the bridges start): a unit, two stock items with a GST rate, a Sales and a
# Purchase ledger (inventory values affected), CGST and SGST duty ledgers (9% each, amounts entered on the invoice), a
# customer and a supplier (no bill-by-bill: no allocation screen on the invoices)
function Imp([int]$port, $co, $report, $msg, $label) { Post $port ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $label }
function Led($n, $parent, $extra = '') { "<LEDGER NAME=`"$n`" ACTION=`"Create`"><NAME.LIST><NAME>$n</NAME></NAME.LIST><PARENT>$parent</PARENT>$extra</LEDGER>" }
function StockNames([int]$port, $co) { Post $port ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCSI</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCSI" ISMODIFY="No"><TYPE>StockItem</TYPE><FETCH>Name,BaseUnits</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'stock items' }
Say '---- check 8''s masters on user 1''s Tally: unit, two stock items (GST 18%), Sales/Purchase, CGST/SGST 9%, customer, supplier'
Imp 9000 $co1 'All Masters' '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>0</DECIMALPLACES></UNIT>' 'unit Nos' | Out-Null
$gstd = '<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY><GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><TAXABILITY>Taxable</TAXABILITY><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST>'
$items8 = 'Spike Widget', 'Spike Gadget'
foreach ($it in $items8) { Imp 9000 $co1 'All Masters' "<STOCKITEM NAME=`"$it`" ACTION=`"Create`"><NAME.LIST><NAME>$it</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS>$gstd</STOCKITEM>" "stock item $it (GST 18%)" | Out-Null }
$si = StockNames 9000 $co1
foreach ($it in $items8) { if ($si -notmatch [regex]::Escape($it)) { Write-Host "  stock item $it not made with its GST details: made without them"; Imp 9000 $co1 'All Masters' "<STOCKITEM NAME=`"$it`" ACTION=`"Create`"><NAME.LIST><NAME>$it</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>" "stock item $it" | Out-Null } }
Imp 9000 $co1 'All Masters' ((Led 'Spike Sales' 'Sales Accounts' '<AFFECTSSTOCK>Yes</AFFECTSSTOCK>') + (Led 'Spike Purchase' 'Purchase Accounts' '<AFFECTSSTOCK>Yes</AFFECTSSTOCK>') + (Led 'Spike CGST' 'Duties &amp; Taxes' '<TAXTYPE>Others</TAXTYPE>') + (Led 'Spike SGST' 'Duties &amp; Taxes' '<TAXTYPE>Others</TAXTYPE>') + (Led 'Spike Trader' 'Sundry Debtors' '<ISBILLWISEON>No</ISBILLWISEON>') + (Led 'Spike Supplier' 'Sundry Creditors' '<ISBILLWISEON>No</ISBILLWISEON>')) 'check 8 ledgers' | Out-Null
StockNames 9000 $co1 | Out-Null

# ---- user 2's own Tally (9001), run as fcuser2: a company made by keys, then started again with it and the add-on
Say '---- user 2''s own Tally (9001), run as fcuser2: a company made by keys, then started again with it and the add-on'
$tally2 = $false
function StartTally2 {
  if ($rdp) { $r = U2Script "$fc\start.ps1" @("$t2dir\tally.exe", $t2dir); $script:t2pid = [int][regex]::Match(($r -join ' '), 'pid=(\d+)').Groups[1].Value }
  else { $t = AsU2 "$t2dir\tally.exe" @() 0; $script:t2pid = $t.Id; $script:tallyPids[9001] = $t.Id }
}
function Keys2([string]$k, $wait = 3, [string]$n = '') { if ($rdp) { $null = U2Script "$fc\keys2.ps1" @($k, "$wait", $n) } else { KeysTo 9001 $k $wait $n } }
Write-TallyIni "$t2dir\tally.ini" "$fc\u2data" 9001 $null $null
StartTally2
$up2 = WaitPort 9001
Write-Host "Tally :9001 (pid $($script:t2pid)) answers: $up2; owner: $((Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId=$($script:t2pid)") -MethodName GetOwner).User); session $((Get-Process -Id $script:t2pid -ErrorAction SilentlyContinue).SessionId) (runner's own: $((Get-Process -Id $PID).SessionId))"
if ($up2) {
  Start-Sleep 5; Keys2 'a' 4; Keys2 't' 10 '01-tally2-start'
  Keys2 '{ENTER}' 5 '01b-tally2-create-company'
  Keys2 $co2 2 ''
  Keys2 '^a' 8 '01c-tally2-ctrl-a'
  $have = (ListCo 9001) -match [regex]::Escape($co2)
  foreach ($k in @('y', '^a', '{ENTER}', 'y', '{ESC}', 'y')) { if ($have) { break }; Keys2 $k 6 ''; $have = (ListCo 9001) -match [regex]::Escape($co2) }
  Keys2 '^a' 5 '01d-tally2-company'
  $f2 = Get-ChildItem "$fc\u2data" -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
  Write-Host "user 2's company made: $have, folder $($f2.Name)"
  if ($have -and $f2) {
    Stop-Process -Id $script:t2pid -Force; Start-Sleep 3
    Write-TallyIni "$t2dir\tally.ini" "$fc\u2data" 9001 $tdl $f2.Name
    StartTally2
    if (WaitPort 9001) { Start-Sleep 5; Keys2 'a' 4; Keys2 't' 10 '01e-tally2-gateway'; AddLedger 9001 $co2; $tally2 = ((ListCo 9001) -match [regex]::Escape($co2))
      # one voucher there before the bridges start, as in user 1's company (flow.ps1): with none, ALTVCHID is 0 and the
      # bridge records no starting point, so a first entry goes without its GUID and body (seen in run 37334848535)
      Post 9001 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co2 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Spike Party" ACTION="Create"><NAME.LIST><NAME>Spike Party</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'ledger Spike Party' | Out-Null
      Post 9001 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co2 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260401</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>round 4 user 2 first entry</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'journal :9001' | Out-Null
    }
  }
}
Write-Host "== user 2's own Tally with its company and the add-on: $tally2"

# ---- the bridges, each installed by its own Windows user with the real setup, just for me; the settings seeded first
Say '---- the bridges, each installed by its own Windows user with the real setup, just for me; the settings seeded first'
# (FinCom's address = the stub, a made-up computer key, the user's own Tally port), as the setup keeps them
# in their own sessions each bridge finds its own Tally (TallyPorts auto, as installed); in one shared session the port is set
function SeedJson($key, [int]$tport) { $tp = if ($rdp) { 'auto' } else { @($tport) }; (@{ CloudUrl = 'http://127.0.0.1:8787/'; CloudKey = "plain:$key"; TallyPorts = $tp } | ConvertTo-Json -Compress) }
$h1 = Join-Path $env:LOCALAPPDATA 'TDS Desk Bridge'; New-Item -ItemType Directory -Force $h1 | Out-Null
Set-Content "$h1\tds-bridge.config.json" (SeedJson 'spike-computer-key-user1' 9000) -Encoding UTF8
$p = Start-Process -FilePath $setup -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
if (-not $p.WaitForExit(300000)) { Write-Host 'setup (user 1) did not end' }
Write-Host "setup as runneradmin (just for me) ended with $($p.ExitCode)"
Get-Content "$env:LOCALAPPDATA\FinCom Bridge\install.log" -ErrorAction SilentlyContinue | Select-Object -Last 8 | ForEach-Object { Write-Host "  install.log 1: $_" }
Set-Content "$fc\seed2.json" (SeedJson 'spike-computer-key-user2' 9001) -Encoding UTF8
Set-Content "$fc\seed.ps1" -Encoding UTF8 -Value @(
  '$h = Join-Path $env:LOCALAPPDATA "TDS Desk Bridge"; New-Item -ItemType Directory -Force $h | Out-Null',
  'Copy-Item C:\fcspike\seed2.json (Join-Path $h "tds-bridge.config.json")',
  '"$([Security.Principal.WindowsIdentity]::GetCurrent().Name) session $((Get-Process -Id $PID).SessionId) $env:LOCALAPPDATA" | Set-Content C:\fcspike\seed-done.txt')
$null = U2Script "$fc\seed.ps1"
Write-Host "seed as ${u2}: $(Get-Content $fc\seed-done.txt -ErrorAction SilentlyContinue)"
if ($rdp) { $c = U2Script "$fc\runwait.ps1" @($setup, '/S', '/CURRENTUSER', '/MODE=sole') } else { $c = AsU2 $setup @('/S', '/CURRENTUSER', '/MODE=sole') }
Write-Host "setup as $u2 (just for me) ended: $c"
$h2 = Join-Path $prof2 'AppData\Local\TDS Desk Bridge'
Get-Content "$prof2\AppData\Local\FinCom Bridge\install.log" -ErrorAction SilentlyContinue | Select-Object -Last 8 | ForEach-Object { Write-Host "  install.log 2: $_" }
Start-Sleep 10
$cfg1 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
$cfg2 = Get-Content "$h2\tds-bridge.config.json" -Raw | ConvertFrom-Json
$B = @{
  1 = @{ user = 'runneradmin'; port = [int]$cfg1.Port; key = $cfg1.Key; id = "go-$($cfg1.InstanceId)"; log = "$h1\tds-bridge.log"; co = $co1; tport = 9000 }
  2 = @{ user = $u2; port = [int]$cfg2.Port; key = $cfg2.Key; id = "go-$($cfg2.InstanceId)"; log = "$h2\tds-bridge.log"; co = $co2; tport = 9001 }
}
foreach ($n in 1, 2) { Write-Host ("bridge {0}: user {1}, port {2}, id {3}, key {4} chars, Owner {5}, OwnerSid {6}" -f $n, $B[$n].user, $B[$n].port, $B[$n].id, "$($B[$n].key)".Length, $(if ($n -eq 1) { $cfg1.Owner } else { $cfg2.Owner }), $(if ($n -eq 1) { $cfg1.OwnerSid } else { $cfg2.OwnerSid })) }
Shot '02-bridges'

$logSeen = @{ 1 = 0; 2 = 0 }
function Snap($step) {
  foreach ($n in 1, 2) {
    $f = $B[$n].log
    if (Test-Path $f) { $l = @(Get-Content $f); $new = @($l | Select-Object -Skip $script:logSeen[$n]); $script:logSeen[$n] = $l.Count
      Set-Content (Join-Path $out "bridge$n-log-$step.txt") $new -Encoding UTF8; $new | ForEach-Object { Write-Host "  bridge$n log: $_" } }
  }
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "rec-$step-$($_.Name)") }
}
# the stub's requests, and its recorder lines flattened (with the bridge that sent each)
function StubReqs { if (Test-Path $stubLog) { @(Get-Content $stubLog -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json }) } else { @() } }
function StubLines([int]$from = 0) {
  $r = StubReqs; $l = @()
  for ($i = $from; $i -lt $r.Count; $i++) {
    $o = $r[$i]; if ($o.kind -ne 'recorder_lines') { continue }
    foreach ($x in @($o.body.lines)) {
      if (-not $x) { continue }
      $l += [pscustomobject]@{ i = $i; at = $o.at; bid = $o.body.bridge.id; buser = $o.body.bridge.user; bport = $o.body.bridge.port; device = $o.device; company = $o.body.company
        ev = $x.event; guid = "$($x.object_guid)"; mid = $x.master_id; aid = $x.alter_id; xml = "$($x.xml)"; lineGuid = $x.lineGuid; ids = $x.idsMismatch; held = "$($x.heldWhy)"; vch = "$($x.vch_type)/$($x.vch_no)/$($x.vch_date)" }
    }
  }
  return , $l
}
function Ev($x) { if (-not $x) { return '(no line)' }; 'stub {0} recorder_lines event={1} guid={2} mid={3} aid={4} vch={5} user={6} bridge={7} port={8} company={9} body={10}{11}' -f $x.at, $x.ev, $(if ($x.guid) { $x.guid } else { "''" }), $x.mid, $x.aid, $x.vch, $x.buser, $x.bid, $x.bport, $x.company, $(if ($x.xml) { "yes($($x.xml.Length) chars)" } else { 'none' }), ("$(if ($x.ids) { " idsMismatch lineGuid=$($x.lineGuid)" })$(if ($x.held) { " heldWhy=$($x.held)" })") }
function WaitLine([int]$from, [scriptblock]$pred, $sec = 150) {
  $until = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $until) { $m = @((StubLines $from) | Where-Object $pred); if ($m.Count) { Start-Sleep 5; return , @((StubLines $from) | Where-Object $pred) }; Start-Sleep 5 }
  return , @()
}
function Mark { (StubReqs).Count }
function PrintNew($from) { (StubLines $from) | ForEach-Object { Write-Host "  $(Ev $_)" } }

# ---- 6a: both bridges run at once, on their own ports, as their own users
Say '---- 6a: both bridges run at once, on their own ports, as their own users'
$procs = Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; user = (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User; session = $_.SessionId; cmd = $_.CommandLine } }
$procs | ForEach-Object { Write-Host "  process $($_.pid) as $($_.user) in session $($_.session): $($_.cmd)" }
$lis = Get-NetTCPConnection -State Listen -LocalPort (9100..9199) -ErrorAction SilentlyContinue | ForEach-Object { $pp = $_.OwningProcess; [pscustomobject]@{ port = $_.LocalPort; pid = $pp; user = ($procs | Where-Object pid -eq $pp).user } }
$lis | ForEach-Object { Write-Host "  listening 127.0.0.1:$($_.port) pid $($_.pid) user $($_.user)" }
Get-Process tally -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  Tally pid $($_.Id) session $($_.SessionId) owner $((Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)") -MethodName GetOwner).User)" }
$l1 = $lis | Where-Object { $_.port -eq $B[1].port -and $_.user -eq 'runneradmin' }; $l2 = $lis | Where-Object { $_.port -eq $B[2].port -and $_.user -eq $u2 }
$s1 = ($procs | Where-Object pid -eq $l1.pid).session; $s2 = ($procs | Where-Object pid -eq $l2.pid).session
Result '6a two bridges at once' ([bool]$l1 -and [bool]$l2 -and $B[1].port -ne $B[2].port -and $B[1].id -ne $B[2].id) ("bridge 1 runneradmin on 127.0.0.1:{0} (pid {1}, session {7}, {2}); bridge 2 {3} on 127.0.0.1:{4} (pid {5}, session {8}, {6}); both listening at {9}" -f $B[1].port, $l1.pid, $B[1].id, $u2, $B[2].port, $l2.pid, $B[2].id, $s1, $s2, (Get-Date -Format HH:mm:ss))

# ---- 6b: the /ping proof: HMAC-SHA256(bridge key, nonce || bridge id || port), only to the bridge's own Windows user
Say '---- 6b: the /ping proof: HMAC-SHA256(bridge key, nonce || bridge id || port), only to the bridge''s own Windows user'
function Hmac($key, $msg) { $h = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key)); (($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg)) | ForEach-Object { $_.ToString('x2') }) -join '') }
function Expect($n, $nonce) { Hmac $B[$n].key ($nonce + $B[$n].id + $B[$n].port) }
# as FinCom's page asks (its Origin; since 246ffef the proof goes only to an allowed Origin or the key's holder)
function Ping($port, $nonce, $origin = 'https://app.fincom.live') { $h = @{}; if ($origin) { $h.Origin = $origin }; try { Invoke-RestMethod "http://127.0.0.1:$port/ping?n=$nonce" -Headers $h -TimeoutSec 10 } catch { $null } }
function Code($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10).StatusCode } catch { [int]$_.Exception.Response.StatusCode } }
$n1 = ([guid]::NewGuid().ToString('N')); $n2 = ([guid]::NewGuid().ToString('N'))
$pa = Ping $B[1].port $n1    # runneradmin asks its own bridge
$pb = Ping $B[2].port $n1    # runneradmin asks user 2's bridge
$pn = Ping $B[1].port ([guid]::NewGuid().ToString('N')) ''   # no Origin (a page after DNS rebinding sends none)
Write-Host "runneradmin -> own bridge, no Origin: $($pn | ConvertTo-Json -Compress)"
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO /ping with a nonce but no Origin (own bridge): proof {0}" -f $(if ($pn.proof) { 'given' } else { 'not given' }))
$sa = Code "http://127.0.0.1:$($B[1].port)/status"; $sb = Code "http://127.0.0.1:$($B[2].port)/status"
Write-Host "runneradmin -> own bridge: $($pa | ConvertTo-Json -Compress)"
Write-Host "runneradmin -> user 2's bridge: $($pb | ConvertTo-Json -Compress)"
# the same asked by user 2 (a script run as fcuser2)
Set-Content "$fc\ping2.ps1" -Encoding UTF8 -Value @'
param($p1, $p2, $nonce)
function Ping($port) { try { Invoke-RestMethod "http://127.0.0.1:$port/ping?n=$nonce" -Headers @{ Origin = 'https://app.fincom.live' } -TimeoutSec 10 } catch { @{ error = "$_" } } }
function Code($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10).StatusCode } catch { [int]$_.Exception.Response.StatusCode } }
@{ who = [Security.Principal.WindowsIdentity]::GetCurrent().Name; session = (Get-Process -Id $PID).SessionId; own = (Ping $p2); other = (Ping $p1); ownStatus = (Code "http://127.0.0.1:$p2/status"); otherStatus = (Code "http://127.0.0.1:$p1/status") } | ConvertTo-Json -Depth 5 | Set-Content C:\fcspike\ping2.json
'@
$c = U2Script "$fc\ping2.ps1" @("$($B[1].port)", "$($B[2].port)", $n2)
$q = Get-Content "$fc\ping2.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
Write-Host "as $u2 ($c): $($q | ConvertTo-Json -Compress -Depth 5)"
$chk = @(
  @('bridge 1 proves itself to runneradmin', ($pa.yours -eq $true -and $pa.bridgeId -eq $B[1].id -and $pa.proof -and $pa.proof -eq (Expect 1 $n1)), "yours=$($pa.yours) bridgeId=$($pa.bridgeId) port=$($pa.port) proof=$($pa.proof)"),
  @('bridge 1 proof checked against user 2 identity fails', ($pa.proof -and $pa.proof -ne (Expect 2 $n1)), "HMAC(key2, nonce||$($B[2].id)||$($B[2].port))=$(Expect 2 $n1)"),
  @('bridge 2 proves itself to fcuser2', ($q.own.yours -eq $true -and $q.own.bridgeId -eq $B[2].id -and $q.own.proof -and $q.own.proof -eq (Expect 2 $n2)), "yours=$($q.own.yours) bridgeId=$($q.own.bridgeId) port=$($q.own.port) proof=$($q.own.proof)"),
  @('bridge 2 proof checked against user 1 identity fails', ($q.own.proof -and $q.own.proof -ne (Expect 1 $n2)), "HMAC(key1, nonce||$($B[1].id)||$($B[1].port))=$(Expect 1 $n2)"),
  @('bridge 2 gives runneradmin no proof', ($pb -and $pb.yours -eq $false -and -not $pb.proof -and -not $pb.bridgeId), "yours=$($pb.yours) proof=$($pb.proof) bridgeId=$($pb.bridgeId)"),
  @('bridge 1 gives fcuser2 no proof', ($q.other -and $q.other.yours -eq $false -and -not $q.other.proof -and -not $q.other.bridgeId), "yours=$($q.other.yours) proof=$($q.other.proof)"),
  @('other users refused 403 beyond /ping', ($sb -eq 403 -and $q.otherStatus -eq 403 -and $sa -ne 403 -and $q.ownStatus -ne 403), "runneradmin: own /status $sa, other $sb; fcuser2: own /status $($q.ownStatus), other $($q.otherStatus)")
)
$okb = $true; foreach ($x in $chk) { Write-Host ("  {0} {1}: {2}" -f $(if ($x[1]) { 'ok  ' } else { 'NOT ' }), $x[0], $x[2]); if (-not $x[1]) { $okb = $false } }
Result '6b /ping proof' $okb (($chk | ForEach-Object { "$($_[0]): $(if ($_[1]) { 'ok' } else { 'NO' })" }) -join '; ')

Snap 'start'
Start-Sleep 30

# ---- steps 1-5 on user 1's Tally (9000), as round 3
Say '---- steps 1-5 on user 1''s Tally (9000), as round 3'
function DayBook($n, $d = '2-10-2026') { KeysTo 9000 '%g' 3; KeysTo 9000 'Day Book' 2; KeysTo 9000 '{ENTER}' 4; KeysTo 9000 '{F2}' 3; KeysTo 9000 "$d{ENTER}" 4 "$n-daybook" }
$before = Vouchers 9000 $co1
$m = Mark
KeysTo 9000 'v' 4 '10-vouchers'; KeysTo 9000 '{F6}' 3; KeysTo 9000 '{F2}' 3; KeysTo 9000 '2-10-2026{ENTER}' 3
KeysTo 9000 'Cash{ENTER}' 3; KeysTo 9000 'Spike Income{ENTER}' 3 '11-particular'; KeysTo 9000 '700{ENTER}' 3; KeysTo 9000 '^a' 5 '12-created'
$after = Vouchers 9000 $co1
$new = @($after | Where-Object { $_.mid -notin @($before | ForEach-Object mid) })[0]
$hit = WaitLine $m { $_.ev -eq 'created' -and $_.company -eq $co1 }
Snap '1-create'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
Result '1 create' ([bool]$new -and [bool]$x -and $x.guid -eq $new.guid -and [int]$x.mid -eq $new.mid -and [bool]$x.xml -and $x.buser -match 'runneradmin$') ("Tally made mid {0} guid {1}; {2}" -f $new.mid, $new.guid, (Ev $x))
$src = $new

# ---- check 7's entry: a Receipt like the owner's (NWS144 Receipt 213) by keys on the screen left by step 1 (a new Receipt):
# dated 1-10-2026 (the Day Book of 2-10-2026 that steps 2-5 work in does not show it), Cash, the bill-by-bill party with a
# New Ref bill allocation, Ctrl+A
Say '---- check 7''s entry: a Receipt from Salesify Marketing LLP with a bill allocation (New Ref SAL-213), by keys'
$salBefore = Vouchers 9000 $co1
KeysTo 9000 '{F2}' 3; KeysTo 9000 '1-10-2026{ENTER}' 3; KeysTo 9000 'Cash{ENTER}' 3
KeysTo 9000 "$sal{ENTER}" 3 '40-sal-party'; KeysTo 9000 '450{ENTER}' 4 '41-sal-billwise'
KeysTo 9000 'New Ref{ENTER}' 3 '42-sal-newref'; KeysTo 9000 'SAL-213{ENTER}' 3 '43-sal-name'; KeysTo 9000 '{ENTER}' 3 '44-sal-due'; KeysTo 9000 '{ENTER}' 3 '45-sal-amount'
$salNew = $null
for ($t = 0; $t -lt 3 -and -not $salNew; $t++) {
  KeysTo 9000 '^a' 5 "46-sal-ctrl-a-$t"
  $salNew = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($salBefore | ForEach-Object mid) })[0]
}
Write-Host "check 7 entry saved: $(if ($salNew) { "mid $($salNew.mid) guid $($salNew.guid) no $($salNew.vno)" } else { 'NO' })"
$script:salGuid = if ($salNew) { $salNew.guid } else { '(none)' }

# ---- check 8's entries: a purchase, a sales invoice and a credit note in item invoice mode, by keys on the screen left by
# the Receipt above (a new Receipt), dated 1-10-2026; each saved with Ctrl+A. One the keys could not save is imported by the
# harness and then saved on the screen (Day Book of 1-10-2026, the last entry, Enter, Ctrl+A): said as such
Say '---- check 8''s entries: purchase, sales invoice and credit note with items, by keys (item invoice mode)'
function ItemRows($rows) { $k = @(); foreach ($r in $rows) { $k += , @("$($r[0]){ENTER}", 3, ''); $k += , @("$($r[1]){ENTER}", 2, ''); $k += , @("$($r[2]){ENTER}", 2, ''); $k += , @('{ENTER}', 2, ''); $k += , @('{ENTER}', 2, "item-$($r[0] -replace ' ', '')") }; return , $k }
$inv8 = [ordered]@{
  purchase = @{ key = @('{F9}'); type = 'Purchase'; party = 'Spike Supplier'; ledger = 'Spike Purchase'; rows = @(, @('Spike Widget', 10, 200)) + @(, @('Spike Gadget', 10, 300)); tax = 450; head = @(@('SUP-101{ENTER}', 2, 'supinv'), @('{ENTER}', 2, 'supdate')) }
  sales = @{ key = @('{F8}'); type = 'Sales'; party = 'Spike Trader'; ledger = 'Spike Sales'; rows = @(, @('Spike Widget', 2, 250)) + @(, @('Spike Gadget', 3, 400)); tax = 153; head = @() }
  credit = @{ key = @('{F10}', 'Credit Note{ENTER}'); type = 'Credit Note'; party = 'Spike Trader'; ledger = 'Spike Sales'; rows = @(, @('Spike Widget', 1, 250)); tax = 22.5; head = @() }
}
# after the party Tally opens two screens, Receipt / Dispatch Details (run 37399828148) and then Party Details (Supplier /
# Buyer, run 37402702702): each accepted with Ctrl+A
foreach ($kind in $inv8.Keys) {
  $d = $inv8[$kind]; $d.how = 'none'; $d.guid = '(none)'
  $pre = Vouchers 9000 $co1
  $seq = @($d.key | ForEach-Object { , @($_, 4, "50-$kind-type") }) + @(@('^h', 3, "51-$kind-mode"), @('Item Invoice{ENTER}', 3, ''), @('{F2}', 3, ''), @('1-10-2026{ENTER}', 3, "52-$kind-date")) + $d.head + @(@("$($d.party){ENTER}", 3, "53-$kind-party"), @('^a', 3, "53b-$kind-dispatch-details-accepted"), @('^a', 3, "53c-$kind-party-details-accepted"), @("$($d.ledger){ENTER}", 3, "54-$kind-ledger")) + (ItemRows $d.rows) + @(@('{ENTER}', 3, "56-$kind-items-done"), @('Spike CGST{ENTER}', 2, ''), @('9{ENTER}', 2, ''), @('{ENTER}', 2, ''), @('Spike SGST{ENTER}', 2, ''), @('9{ENTER}', 2, ''), @('{ENTER}', 2, "57-$kind-taxes"))
  foreach ($q in $seq) { KeysTo 9000 $q[0] $q[1] $(if ($q[2] -and $q[2] -notmatch '^\d') { "55-$kind-$($q[2])" } else { $q[2] }) }
  $nv = $null
  for ($t = 0; $t -lt 3 -and -not $nv; $t++) { KeysTo 9000 '^a' 5 "58-$kind-ctrl-a-$t"; $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0] }
  if ($nv) { $d.how = 'keys'; $d.guid = $nv.guid; $d.mid = $nv.mid }
  else { KeysTo 9000 '{ESC}' 2; KeysTo 9000 'y' 3 "59-$kind-left"; KeysTo 9000 'v' 4 "59-$kind-vouchers" }
  Write-Host "check 8 ${kind} by keys: $(if ($nv) { "saved, mid $($nv.mid) guid $($nv.guid) no $($nv.vno)" } else { 'NOT saved' })"
}
# the fallback: imported by the harness (as Tally keeps an item invoice: party and duties in LEDGERENTRIES, each item's sales
# or purchase ledger in its ACCOUNTINGALLOCATIONS), then saved on the screen so the add-on writes its line
function InvXml($d) {
  $sales = $d.type -eq 'Sales'; $sg = if ($sales) { 1 } else { -1 }   # Sales: party Dr; Purchase and Credit Note: party Cr
  $net = 0; $it = ''
  foreach ($r in $d.rows) { $a = [decimal]$r[1] * [decimal]$r[2]; $net += $a; $v = $sg * $a; $dp = if ($v -lt 0) { 'Yes' } else { 'No' }
    $it += "<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>$($r[0])</STOCKITEMNAME><ISDEEMEDPOSITIVE>$dp</ISDEEMEDPOSITIVE><RATE>$($r[2]).00/Nos</RATE><AMOUNT>$v</AMOUNT><ACTUALQTY> $($r[1]) Nos</ACTUALQTY><BILLEDQTY> $($r[1]) Nos</BILLEDQTY><BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>$v</AMOUNT><ACTUALQTY> $($r[1]) Nos</ACTUALQTY><BILLEDQTY> $($r[1]) Nos</BILLEDQTY></BATCHALLOCATIONS.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>$($d.ledger)</LEDGERNAME><ISDEEMEDPOSITIVE>$dp</ISDEEMEDPOSITIVE><AMOUNT>$v</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>" }
  $tax = [decimal]$d.tax; $tot = $net + 2 * $tax; $pv = -$sg * $tot; $tv = $sg * $tax
  $le = "<LEDGERENTRIES.LIST><LEDGERNAME>$($d.party)</LEDGERNAME><ISDEEMEDPOSITIVE>$(if ($pv -lt 0) { 'Yes' } else { 'No' })</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>$pv</AMOUNT></LEDGERENTRIES.LIST>"
  foreach ($tl in 'Spike CGST', 'Spike SGST') { $le += "<LEDGERENTRIES.LIST><LEDGERNAME>$tl</LEDGERNAME><ISDEEMEDPOSITIVE>$(if ($tv -lt 0) { 'Yes' } else { 'No' })</ISDEEMEDPOSITIVE><AMOUNT>$tv</AMOUNT></LEDGERENTRIES.LIST>" }
  "<VOUCHER VCHTYPE=`"$($d.type)`" ACTION=`"Create`" OBJVIEW=`"Invoice Voucher View`"><DATE>20261001</DATE><VOUCHERTYPENAME>$($d.type)</VOUCHERTYPENAME><PARTYLEDGERNAME>$($d.party)</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE>$(if ($d.type -eq 'Purchase') { '<REFERENCE>SUP-101</REFERENCE>' })$le$it</VOUCHER>"
}
foreach ($kind in $inv8.Keys) {
  $d = $inv8[$kind]; if ($d.how -ne 'none') { continue }
  $pre = Vouchers 9000 $co1
  Imp 9000 $co1 'Vouchers' (InvXml $d) "check 8 $kind imported" | Out-Null
  $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0]
  if (-not $nv) { Write-Host "check 8 $kind could not be imported either"; continue }
  $d.guid = $nv.guid; $d.mid = $nv.mid; $d.how = 'imported by the harness, saved on the screen'
  # the Day Book lists by voucher type, not by entry (run 37399828148): only this type (F4), then its last entry
  DayBook "60-$kind" '1-10-2026'; KeysTo 9000 '{F4}' 3; KeysTo 9000 "$($d.type){ENTER}" 4 "60b-$kind-type"; KeysTo 9000 '{END}' 2; KeysTo 9000 '{ENTER}' 4 "61-$kind-open"; KeysTo 9000 '^a' 5 "62-$kind-saved"
  Write-Host "check 8 ${kind}: imported mid $($nv.mid) guid $($nv.guid), saved again on the screen"
}

$m = Mark
DayBook '13'; KeysTo 9000 '{END}' 2; KeysTo 9000 '{ENTER}' 4 '14-open'
KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2 '15-at-amount'; KeysTo 9000 '800{ENTER}' 2; KeysTo 9000 '^a' 5 '16-altered'
$after2 = Vouchers 9000 $co1
$srcNow = @($after2 | Where-Object mid -eq $src.mid)[0]
$hit = WaitLine 0 { $_.ev -eq 'altered' -and $_.company -eq $co1 -and $_.guid -eq $src.guid }
Snap '2-alter'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
Result '2 alter' ([bool]$x -and $x.guid -eq $src.guid -and [int]$x.aid -eq $srcNow.aid -and $srcNow.aid -gt $src.aid -and [bool]$x.xml) ("Tally: mid {0} AlterID {1} -> {2}; {3}" -f $src.mid, $src.aid, $srcNow.aid, (Ev $x))

$m = Mark
DayBook '17'; KeysTo 9000 '{END}' 2; KeysTo 9000 '%2' 4 '18-duplicate'
KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2 '19-dup-at-amount'; KeysTo 9000 '900{ENTER}' 2; KeysTo 9000 '^a' 5 '20-dup-saved'
$after3 = Vouchers 9000 $co1
$dup = @($after3 | Where-Object { $_.mid -notin @($after2 | ForEach-Object mid) })[0]
$srcThen = @($after3 | Where-Object mid -eq $src.mid)[0]
$hit = WaitLine 0 { $_.ev -eq 'created' -and $_.company -eq $co1 -and $_.guid -ne $src.guid -and $_.guid -ne $script:salGuid -and $_.vch -like '*/20261002' }
Start-Sleep 20
Snap '3-copy'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
$srcLines = @((StubLines $m) | Where-Object { $_.company -eq $co1 -and ($_.guid -eq $src.guid -or "$($_.mid)" -eq "$($src.mid)") })
Result '3 Alt+2 copy' ([bool]$dup -and [bool]$x -and $x.guid -eq $dup.guid -and $x.guid -ne $src.guid -and [bool]$x.xml -and $srcThen.aid -eq $srcNow.aid -and $srcLines.Count -eq 0) ("Tally made mid {0} guid {1}; source mid {2} AlterID still {3}, no line for it; {4}" -f $dup.mid, $dup.guid, $src.mid, $srcThen.aid, (Ev $x))

$m = Mark
DayBook '21'; KeysTo 9000 '{HOME}' 2; KeysTo 9000 '%x' 3; KeysTo 9000 'y' 4 '22-cancelled'
$after4 = Vouchers 9000 $co1
$canc = @($after4 | Where-Object { $_.cancelled -and $_.mid -notin @($after3 | Where-Object cancelled | ForEach-Object mid) })[0]
$hit = WaitLine 0 { $_.ev -eq 'cancelled' -and $_.company -eq $co1 }
Snap '4-cancel'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
Result '4 cancel' ([bool]$canc -and [bool]$x -and $x.guid -and $x.guid -eq $canc.guid) ("Tally cancelled mid {0} guid {1}; {2}" -f $canc.mid, $canc.guid, (Ev $x))

$m = Mark
DayBook '23'; KeysTo 9000 '{END}' 2; KeysTo 9000 '%d' 3; KeysTo 9000 'y' 4 '24-deleted'
$after5 = Vouchers 9000 $co1
$del = @($after4 | Where-Object { $_.mid -notin @($after5 | ForEach-Object mid) })[0]
$hit = WaitLine 0 { $_.ev -eq 'deleted' -and $_.company -eq $co1 }
Snap '5-delete'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
Result '5 delete' ([bool]$del -and [bool]$x -and $x.guid -and $x.guid -eq $del.guid) ("Tally deleted mid {0} guid {1}; {2}" -f $del.mid, $del.guid, (Ev $x))

# ---- 6d: user 2's own Tally event (a Receipt on 9001), recorded by user 2's bridge
Say '---- 6d: user 2''s own Tally event (a Receipt on 9001), recorded by user 2''s bridge'
if ($tally2) {
  $h0 = $script:harness
  $b2 = Vouchers 9001 $co2
  Keys2 'v' 4 '30-u2-vouchers'; Keys2 '{F6}' 3; Keys2 '{F2}' 3; Keys2 '2-10-2026{ENTER}' 3
  Keys2 'Cash{ENTER}' 3; Keys2 'Spike Income{ENTER}' 3 '31-u2-particular'; Keys2 '450{ENTER}' 3; Keys2 '^a' 5 '32-u2-created'
  $a2 = Vouchers 9001 $co2
  $new2 = @($a2 | Where-Object { $_.mid -notin @($b2 | ForEach-Object mid) })[0]
  $hit = WaitLine 0 { $_.ev -eq 'created' -and $_.company -eq $co2 }
  Snap '6-user2'
  $x = @($hit | Where-Object bid -eq $B[2].id)[0]
  $hn = $script:harness - $h0
  Result '6d user 2 own Tally event' ([bool]$new2 -and [bool]$x -and $x.guid -eq $new2.guid -and [bool]$x.xml -and $x.buser -match "$u2$") ("{3}Tally :9001 (as $u2) made mid {0} guid {1}; {2}" -f $new2.mid, $new2.guid, (Ev $x), $(if ($hn) { "user 2's task did not run ($hn keystroke step(s) never ran, so no entry was made in user 2's Tally; not the bridge's); " } else { '' })) ($hn -gt 0)
} else {
  Result '6d user 2 own Tally event' $false 'user 2''s own Tally (9001) could not be brought up with its company: see the log and r4-01* screenshots'
}
Start-Sleep 20; Snap 'end'

# ---- 6c: the beats, 6e: every recorder line attributed to the user whose Tally made it
Say '---- 6c: the beats, 6e: every recorder line attributed to the user whose Tally made it'
$reqs = StubReqs
foreach ($n in 1, 2) {
  $bt = @($reqs | Where-Object { $_.kind -eq 'beat' -and $_.body.bridge.id -eq $B[$n].id })
  $B[$n].beats = $bt.Count; $B[$n].beat = $bt | Select-Object -Last 1
}
function BeatEv($n) { $o = $B[$n].beat; if (-not $o) { return "bridge $n ($($B[$n].id)): no beat" }; 'stub {0} beat x{1} bridge={2} user={3} windowsUser={4} bridgePort={5} tallyPort={6} dataFolder={7} device={8} computer={9}' -f $o.at, $B[$n].beats, $o.body.bridge.id, $o.body.bridge.user, $o.body.windowsUser, $o.body.bridgePort, $o.body.tallyPort, $o.body.dataFolder, $o.device, $o.body.computer }
$o1 = $B[1].beat; $o2 = $B[2].beat
$okc = $o1 -and $o2 -and $o1.body.bridge.id -ne $o2.body.bridge.id -and $o1.body.windowsUser -ne $o2.body.windowsUser -and $o1.body.windowsUser -match 'runneradmin$' -and $o2.body.windowsUser -match "$u2$" -and [int]$o1.body.bridgePort -eq $B[1].port -and [int]$o2.body.bridgePort -eq $B[2].port -and $o1.device -ne $o2.device
Result '6c beats' ([bool]$okc) ("{0} | {1}" -f (BeatEv 1), (BeatEv 2))
$all = StubLines 0
$all | ForEach-Object { Write-Host "  all: $(Ev $_)" }
$wrong = @($all | Where-Object { ($_.company -eq $co1 -and $_.bid -ne $B[1].id) -or ($_.company -eq $co2 -and $_.bid -ne $B[2].id) -or ($_.bid -eq $B[1].id -and $_.buser -notmatch 'runneradmin$') -or ($_.bid -eq $B[2].id -and $_.buser -notmatch "$u2$") })
$n1l = @($all | Where-Object bid -eq $B[1].id).Count; $n2l = @($all | Where-Object bid -eq $B[2].id).Count
Result '6e attribution' ($wrong.Count -eq 0 -and $n1l -gt 0) ("{0} line(s) from bridge 1 (runneradmin, {1}), {2} from bridge 2 ({3}, {4}); misattributed: {5}{6}" -f $n1l, $co1, $n2l, $u2, $co2, $wrong.Count, $(if ($wrong.Count) { ' e.g. ' + (Ev $wrong[0]) } else { '' }))

# ---- 7: the body as the cloud reads it: each created/altered/imported line's xml through tally-ingest's parse.js (parseDay at
# the bridge ref), the voucher of the line's GUID and its lines, as cleanRecorderLine does
Say '---- 7: each created/altered/imported line''s xml through the cloud''s parse.js (parseDay at the bridge ref)'
$parseJs = Join-Path $env:BRIDGE_DIST 'cloud\tally-cloud\parse.js'
$bodies = @($all | Where-Object { $_.ev -in 'created', 'altered', 'imported' } | ForEach-Object { [pscustomobject]@{ label = "$($_.company) $($_.ev) $($_.vch) bridge $($_.bid) at $($_.at)"; guid = $_.guid; ev = $_.ev; xml = $_.xml } })
$pin = Join-Path $out 'parse-in.json'; $pout = Join-Path $out 'parse-check.json'
ConvertTo-Json -InputObject $bodies -Depth 5 | Set-Content $pin -Encoding UTF8
& node (Join-Path $PSScriptRoot 'parsecheck.mjs') $parseJs $pin $pout 2>&1 | ForEach-Object { Write-Host "  $_" }
$pc = @(); try { $pc = @(Get-Content $pout -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { Write-Host "parse check output: $_" }
foreach ($o in $pc) {
  $ls = (@($o.lines) | ForEach-Object { "$($_.ledger) $($_.amount)$(if (@($_.bills).Count) { ' bills[' + ((@($_.bills) | ForEach-Object { ($_ | ForEach-Object { "$_" }) -join '/' }) -join '; ') + ']' })" }) -join ', '
  $l = "PARSE {0} {1}: guid {2}; xml {3} chars; parseDay vouchers {4} (guids {5}), with this GUID {6}; type={7} no={8} date={9} party={10}; lines: {11}{12}" -f $(if ($o.ok) { 'ok' } else { 'NO' }), $o.label, $o.guid, $o.xmlChars, $o.parsedVouchers, ((@($o.parsedGuids) | ForEach-Object { if ($_) { $_ } else { "''" } }) -join ','), $o.match, $o.type, $o.no, $o.date, $o.party, $(if ($ls) { $ls } else { 'none' }), $(if ($o.error) { " error $($o.error)" } else { '' })
  Write-Host "  $l"; Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO $l"
}
$salPc = @($pc | Where-Object { $_.guid -and $_.guid -eq $script:salGuid -and $_.ev -eq 'created' })[0]
$salBills = if ($salPc) { @(@($salPc.lines) | Where-Object { $_.ledger -eq $sal } | ForEach-Object { @($_.bills) } | Where-Object { $_ }).Count } else { 0 }
$bad = @($pc | Where-Object { -not $_.ok })
$ok7 = $pc.Count -gt 0 -and $bad.Count -eq 0 -and $pc.Count -eq $bodies.Count -and [bool]$salPc -and $salPc.ok -and $salBills -ge 1
Result '7 body through the cloud''s parse.js' $ok7 ("{0} created/altered line(s) read with parse.js at the bridge ref: {1} with exactly one voucher of the line's GUID and >= 2 non-zero ledger lines, {2} without; the Receipt from {3} (entered by keys, {4}): {5}" -f $pc.Count, ($pc.Count - $bad.Count), $bad.Count, $sal, $(if ($salNew) { "Tally mid $($salNew.mid) guid $($salNew.guid)" } else { 'NOT saved in Tally' }), $(if (-not $salPc) { 'no created line with its GUID' } else { "type=$($salPc.type) no=$($salPc.no) date=$($salPc.date) party=$($salPc.party), $(@($salPc.lines).Count) line(s), $($salPc.nonZero) non-zero, $salBills bill allocation(s) on the party line" }))

# ---- 8: the item invoices' lines through parse.js against Tally's own figures (an export the harness asks Tally for)
Say '---- 8: item invoices: parse.js (bridge ref) against Tally''s own figures, ledger by ledger'
$bver = ([regex]::Match($setupSrc.Name, '(\d+\.\d+\.\d+)')).Groups[1].Value; if (-not $bver) { $bver = '0.0.0' }
$tx = Join-Path $out 'tally-daybook-20261001.xml'
$dbx = Post 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20261001</SVFROMDATE><SVTODATE>20261001</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
$cox = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCV8</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCV8" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>*, ALLLEDGERENTRIES.*, LEDGERENTRIES.*, ALLINVENTORYENTRIES.*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
Write-Host "Tally's own export: Day Book 1-10-2026 $("$dbx".Length) chars, voucher collection $("$cox".Length) chars"
Set-Content $tx ("$dbx`n<!-- voucher collection -->`n$cox") -Encoding UTF8
$in8 = @(foreach ($kind in $inv8.Keys) { $d = $inv8[$kind]
  [pscustomobject]@{ label = "$kind ($($d.type), $($d.how))"; guid = $d.guid; tally = $tx; lines = @((StubLines 0) | Where-Object { $_.guid -eq $d.guid -and $_.ev -in 'created', 'altered', 'imported' } | ForEach-Object { [pscustomobject]@{ ev = $_.ev; at = $_.at; xml = $_.xml } }) } })
$p8i = Join-Path $out 'check8-in.json'; $p8o = Join-Path $out 'check8.json'
ConvertTo-Json -InputObject $in8 -Depth 6 | Set-Content $p8i -Encoding UTF8
& node (Join-Path $PSScriptRoot 'check8.mjs') $parseJs $p8i $p8o 2>&1 | ForEach-Object { Write-Host "  $_" }
$c8 = @(); try { $c8 = @(Get-Content $p8o -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { Write-Host "check 8 output: $_" }
function Tot($l) { (@($l) | ForEach-Object { "$($_.ledger) $($_.amount)" }) -join ', ' }
$expectedOnly = $true; $missing = @(); $nolines = @()
foreach ($o in $c8) {
  if ($o.guid -eq '(none)') { $missing += $o.label }
  $tl = if ($o.tally) { "Tally {0} no {1} date {2}, {3} item(s): {4} (sum {5}; from {6}, the other view agrees: {7})" -f $o.tally.type, $o.tally.no, $o.tally.date, $o.tally.items, (Tot $o.tally.totals), $o.tally.sum, $o.tally.view, $o.tally.viewsAgree } else { "Tally: voucher $($o.guid) not found in the harness's own export" }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO CHECK8 $($o.label) guid $($o.guid): $tl"; Write-Host "  CHECK8 $($o.label): $tl"
  if (-not @($o.lines).Count) { $nolines += $o.label; $expectedOnly = $false; Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO CHECK8 $($o.label): no created/altered line with this GUID reached the stub"; continue }
  foreach ($l in @($o.lines)) {
    $pl = "{0} {1} line at {2}: parse.js voucher(s) {3}, type={4} no={5} date={6} party={7}; lines: {8} (sum {9}){10}; differences from Tally: {11}{12}" -f $(if ($l.ok) { 'ok' } else { 'NO' }), $l.ev, $l.at, $l.match, $l.type, $l.no, $l.date, $l.party, $(if (@($l.totals).Count) { Tot $l.totals } else { 'none' }), $l.sum, $(if ($l.guardHeld) { '; the cloud''s balance guard would HOLD this body' } else { '' }), $(if (@($l.diffs).Count) { (@($l.diffs) | ForEach-Object { "$($_.ledger): Tally $(if ($null -eq $_.tally) { (none) } else { $_.tally }), parse.js $(if ($null -eq $_.parsed) { (none) } else { $_.parsed })" }) -join '; ' } else { 'none' }), $(if ($l.error) { " error $($l.error)" } else { '' })
    Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO CHECK8 $($o.label): $pl"; Write-Host "  CHECK8 $($o.label): $pl"
    # what bridge 2.3.0 is expected to do: the body without the items' accounting allocations (the sales or purchase ledger
    # missing on the parse.js side only), so its lines do not add up and the balance guard holds it
    if (-not $l.ok -and -not ($l.guardHeld -and @($l.diffs).Count -gt 0 -and @(@($l.diffs) | Where-Object { $null -ne $_.parsed }).Count -eq 0)) { $expectedOnly = $false }
  }
}
$ok8 = $c8.Count -eq 3 -and @($c8 | Where-Object { -not $_.ok }).Count -eq 0
$how8 = ($inv8.Keys | ForEach-Object { "$_ $($inv8[$_].how)" }) -join ', '
$ev8 = "3 item invoices ($how8), each line read with parse.js at the bridge ref against Tally's own export: {0} matching ledger by ledger and adding to 0; bridge {1}" -f @($c8 | Where-Object ok).Count, $bver
# an entry Tally saved as another voucher type than asked (run 37404597467: Ctrl+F8 left a Sales) is the harness's
$ki = @($inv8.Keys); for ($i = 0; $i -lt $c8.Count; $i++) { if ($c8[$i].tally -and $c8[$i].tally.type -ne $inv8[$ki[$i]].type) { $missing += "$($ki[$i]) (saved as $($c8[$i].tally.type), not $($inv8[$ki[$i]].type))" } }
if ($missing.Count) { Result '8 item invoices against Tally' $false "$ev8; not entered in Tally: $($missing -join ', ') (the harness)" $true }
elseif ($ok8) { Result '8 item invoices against Tally' $true $ev8 }
elseif ([version]$bver -lt [version]'2.3.1' -and $expectedOnly) { $l8 = "EXPECTED 8 item invoices against Tally: $ev8 - as expected before bridge 2.3.1: the body comes without the items' accounting allocations (sales/purchase ledger), so its lines do not add up and the cloud's balance guard holds it; PASS needs bridge 2.3.1+"; Write-Host "######## $l8"; Add-Content -Path $resultsFile -Value $l8 -Encoding UTF8 }
else { Result '8 item invoices against Tally' $false "$ev8$(if ($nolines.Count) { "; no line for: $($nolines -join ', ')" })" }

# ---- step 6 as one line
Say '---- step 6 as one line'
$r6 = @(Get-Content $resultsFile | Where-Object { $_ -match '^(PASS|FAIL|HARNESS) 6[a-e] ' })
$r6h = @($r6 | Where-Object { $_ -like 'HARNESS*' }).Count -gt 0 -and @($r6 | Where-Object { $_ -like 'FAIL*' }).Count -eq 0
Result '6 two Windows users' (@($r6 | Where-Object { $_ -notlike 'PASS*' }).Count -eq 0 -and $r6.Count -eq 5) (($r6 | ForEach-Object { ($_ -split ':')[0] }) -join '; ') $r6h
if ($script:harness) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "HARNESS: user 2's task did not run ($($script:harness) time(s) in this run; see round4.log '[harness]' lines)" }

# ---- what is kept: the bridges' logs, install logs, settings without their keys
Say '---- what is kept: the bridges'' logs, install logs, settings without their keys'
foreach ($n in 1, 2) {
  $hh = if ($n -eq 1) { $h1 } else { $h2 }; $ib = if ($n -eq 1) { "$env:LOCALAPPDATA\FinCom Bridge" } else { "$prof2\AppData\Local\FinCom Bridge" }
  Copy-Item $B[$n].log (Join-Path $out "bridge$n-full.log") -ErrorAction SilentlyContinue
  Copy-Item "$ib\install.log" (Join-Path $out "bridge$n-install.log") -ErrorAction SilentlyContinue
  $cf = Get-Content "$hh\tds-bridge.config.json" -Raw | ConvertFrom-Json; $cf.Key = '(kept out)'; if ($cf.CloudKey) { $cf.CloudKey = '(kept out)' }
  $cf | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out "bridge$n-settings.json")
}
Vouchers 9000 $co1 | Out-Null
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
Write-Host '== results'; Get-Content $resultsFile | Write-Host
Get-ChildItem "$fc\shots" -Filter *.png -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $env:SHOTS "r4u2-$($_.Name)") }
Write-Host '== round 4 end'
