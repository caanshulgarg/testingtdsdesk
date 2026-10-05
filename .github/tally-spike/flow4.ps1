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
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function Result($step, [bool]$ok, $evidence) {
  $l = '{0} {1}: {2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $step, $evidence
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
    @{ script = $script; argv = $argv } | ConvertTo-Json | Set-Content "$fc\task-in.json" -Encoding UTF8
    try { Start-ScheduledTask -TaskName fcu2 -ErrorAction Stop } catch { Write-Host "  task start: $_" }
    $until = (Get-Date).AddSeconds($sec); while (-not (Test-Path "$fc\task-done.txt") -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Path "$fc\task-done.txt")) { $ti = Get-ScheduledTaskInfo -TaskName fcu2 -ErrorAction SilentlyContinue; Write-Host "  task fcu2 did not finish $script in $sec s: last run $($ti.LastRunTime) result 0x$('{0:x}' -f $ti.LastTaskResult), state $((Get-ScheduledTask fcu2).State)" }
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
        ev = $x.event; guid = "$($x.object_guid)"; mid = $x.master_id; aid = $x.alter_id; xml = "$($x.xml)"; lineGuid = $x.lineGuid; ids = $x.idsMismatch; vch = "$($x.vch_type)/$($x.vch_no)/$($x.vch_date)" }
    }
  }
  return , $l
}
function Ev($x) { if (-not $x) { return '(no line)' }; 'stub {0} recorder_lines event={1} guid={2} mid={3} aid={4} vch={5} user={6} bridge={7} port={8} company={9} body={10}{11}' -f $x.at, $x.ev, $(if ($x.guid) { $x.guid } else { "''" }), $x.mid, $x.aid, $x.vch, $x.buser, $x.bid, $x.bport, $x.company, $(if ($x.xml) { "yes($($x.xml.Length) chars)" } else { 'none' }), $(if ($x.ids) { " idsMismatch lineGuid=$($x.lineGuid)" } else { '' }) }
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
$lis = Get-NetTCPConnection -State Listen -LocalPort (9100..9119) -ErrorAction SilentlyContinue | ForEach-Object { $pp = $_.OwningProcess; [pscustomobject]@{ port = $_.LocalPort; pid = $pp; user = ($procs | Where-Object pid -eq $pp).user } }
$lis | ForEach-Object { Write-Host "  listening 127.0.0.1:$($_.port) pid $($_.pid) user $($_.user)" }
Get-Process tally -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  Tally pid $($_.Id) session $($_.SessionId) owner $((Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)") -MethodName GetOwner).User)" }
$l1 = $lis | Where-Object { $_.port -eq $B[1].port -and $_.user -eq 'runneradmin' }; $l2 = $lis | Where-Object { $_.port -eq $B[2].port -and $_.user -eq $u2 }
$s1 = ($procs | Where-Object pid -eq $l1.pid).session; $s2 = ($procs | Where-Object pid -eq $l2.pid).session
Result '6a two bridges at once' ([bool]$l1 -and [bool]$l2 -and $B[1].port -ne $B[2].port -and $B[1].id -ne $B[2].id) ("bridge 1 runneradmin on 127.0.0.1:{0} (pid {1}, session {7}, {2}); bridge 2 {3} on 127.0.0.1:{4} (pid {5}, session {8}, {6}); both listening at {9}" -f $B[1].port, $l1.pid, $B[1].id, $u2, $B[2].port, $l2.pid, $B[2].id, $s1, $s2, (Get-Date -Format HH:mm:ss))

# ---- 6b: the /ping proof: HMAC-SHA256(bridge key, nonce || bridge id || port), only to the bridge's own Windows user
Say '---- 6b: the /ping proof: HMAC-SHA256(bridge key, nonce || bridge id || port), only to the bridge''s own Windows user'
function Hmac($key, $msg) { $h = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key)); (($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg)) | ForEach-Object { $_.ToString('x2') }) -join '') }
function Expect($n, $nonce) { Hmac $B[$n].key ($nonce + $B[$n].id + $B[$n].port) }
function Ping($port, $nonce) { try { Invoke-RestMethod "http://127.0.0.1:$port/ping?n=$nonce" -TimeoutSec 10 } catch { $null } }
function Code($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10).StatusCode } catch { [int]$_.Exception.Response.StatusCode } }
$n1 = ([guid]::NewGuid().ToString('N')); $n2 = ([guid]::NewGuid().ToString('N'))
$pa = Ping $B[1].port $n1    # runneradmin asks its own bridge
$pb = Ping $B[2].port $n1    # runneradmin asks user 2's bridge
$sa = Code "http://127.0.0.1:$($B[1].port)/status"; $sb = Code "http://127.0.0.1:$($B[2].port)/status"
Write-Host "runneradmin -> own bridge: $($pa | ConvertTo-Json -Compress)"
Write-Host "runneradmin -> user 2's bridge: $($pb | ConvertTo-Json -Compress)"
# the same asked by user 2 (a script run as fcuser2)
Set-Content "$fc\ping2.ps1" -Encoding UTF8 -Value @'
param($p1, $p2, $nonce)
function Ping($port) { try { Invoke-RestMethod "http://127.0.0.1:$port/ping?n=$nonce" -TimeoutSec 10 } catch { @{ error = "$_" } } }
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
function DayBook($n) { KeysTo 9000 '%g' 3; KeysTo 9000 'Day Book' 2; KeysTo 9000 '{ENTER}' 4; KeysTo 9000 '{F2}' 3; KeysTo 9000 '2-10-2026{ENTER}' 4 "$n-daybook" }
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

$m = Mark
DayBook '13'; KeysTo 9000 '{END}' 2; KeysTo 9000 '{ENTER}' 4 '14-open'
KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2 '15-at-amount'; KeysTo 9000 '800{ENTER}' 2; KeysTo 9000 '^a' 5 '16-altered'
$after2 = Vouchers 9000 $co1
$srcNow = @($after2 | Where-Object mid -eq $src.mid)[0]
$hit = WaitLine 0 { $_.ev -eq 'altered' -and $_.company -eq $co1 }
Snap '2-alter'; PrintNew $m
$x = @($hit | Where-Object bid -eq $B[1].id)[0]
Result '2 alter' ([bool]$x -and $x.guid -eq $src.guid -and [int]$x.aid -eq $srcNow.aid -and $srcNow.aid -gt $src.aid -and [bool]$x.xml) ("Tally: mid {0} AlterID {1} -> {2}; {3}" -f $src.mid, $src.aid, $srcNow.aid, (Ev $x))

$m = Mark
DayBook '17'; KeysTo 9000 '{END}' 2; KeysTo 9000 '%2' 4 '18-duplicate'
KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '{ENTER}' 2 '19-dup-at-amount'; KeysTo 9000 '900{ENTER}' 2; KeysTo 9000 '^a' 5 '20-dup-saved'
$after3 = Vouchers 9000 $co1
$dup = @($after3 | Where-Object { $_.mid -notin @($after2 | ForEach-Object mid) })[0]
$srcThen = @($after3 | Where-Object mid -eq $src.mid)[0]
$hit = WaitLine 0 { $_.ev -eq 'created' -and $_.company -eq $co1 -and $_.guid -ne $src.guid }
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
  $b2 = Vouchers 9001 $co2
  Keys2 'v' 4 '30-u2-vouchers'; Keys2 '{F6}' 3; Keys2 '{F2}' 3; Keys2 '2-10-2026{ENTER}' 3
  Keys2 'Cash{ENTER}' 3; Keys2 'Spike Income{ENTER}' 3 '31-u2-particular'; Keys2 '450{ENTER}' 3; Keys2 '^a' 5 '32-u2-created'
  $a2 = Vouchers 9001 $co2
  $new2 = @($a2 | Where-Object { $_.mid -notin @($b2 | ForEach-Object mid) })[0]
  $hit = WaitLine 0 { $_.ev -eq 'created' -and $_.company -eq $co2 }
  Snap '6-user2'
  $x = @($hit | Where-Object bid -eq $B[2].id)[0]
  Result '6d user 2 own Tally event' ([bool]$new2 -and [bool]$x -and $x.guid -eq $new2.guid -and [bool]$x.xml -and $x.buser -match "$u2$") ("Tally :9001 (as $u2) made mid {0} guid {1}; {2}" -f $new2.mid, $new2.guid, (Ev $x))
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

# ---- step 6 as one line
Say '---- step 6 as one line'
$r6 = @(Get-Content $resultsFile | Where-Object { $_ -match '^(PASS|FAIL) 6[a-e] ' })
Result '6 two Windows users' (@($r6 | Where-Object { $_ -like 'FAIL*' }).Count -eq 0 -and $r6.Count -eq 5) (($r6 | ForEach-Object { ($_ -split ':')[0] }) -join '; ')

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
