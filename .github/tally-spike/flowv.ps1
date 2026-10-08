# Versions harness: the same checks on each TallyPrime release ($env:TALLY_REL), one Windows user, a local stub cloud.
# Reuses flow.ps1 (run before this: Tally started, Educational mode, company "FinCom Spike Co" made) and flow4.ps1's steps.
#   quick ($env:VMODE = quick): c1 install and open the company, c2 the port and the company list, Tally's own release
#   full: also c3 a posting from the bridge (/import of one voucher), c4 create / alter / cancel / delete by keys with the
#         add-on loaded (each a recorder line at the stub), c5 Alt+2, c6 the entry request for one entry (the tray's fetch
#         test, A..F, its answers captured), c7 the Tally version string the bridge reads (the read test's "Tally program")
# One line per check in versions\results.txt: PASS / FAIL / HARNESS (the harness, not the bridge or Tally) with the times.
$ErrorActionPreference = 'Continue'
$rel = $env:TALLY_REL; $full = ($env:VMODE -eq 'full'); $share = ($env:VMODE -eq 'share'); $big = ($env:VMODE -eq 'big'); $hang = ($env:VMODE -eq 'hang'); $hang2 = ($env:VMODE -eq 'hang2'); $hang3 = ($env:VMODE -eq 'hang3'); $hang4 = ($env:VMODE -eq 'hang4'); $bank = ($env:VMODE -eq 'bank'); $bankb = ($env:VMODE -eq 'bankb'); $renum = ($env:VMODE -eq 'renum'); $s235 = ($env:VMODE -eq 's235'); $mhook = ($env:VMODE -eq 'mhook'); $ledlist = ($env:VMODE -eq 'ledlist')   # bankb: bankv.ps1's bridge part after the bridge's setup (next-bankdate; stubr.py as the cloud, the contras made before the bridge starts); s235: s235v.ps1 after the bridge's setup (bridge 2.3.5: FinCom's read stop and held lines, a real failure, the Tally-not-open notification; stub235.py as the cloud, proxy235.py between the bridge and Tally); renum: renumv.ps1 after the bridge's setup (stubr.py as the cloud; branch next-renumber); bank: bankv.ps1 (the bank-date probe); share / big / hang / hang2..4: sharev.ps1 / bigv.ps1 / hangv.ps1 / hang2v..hang4v.ps1 after c2 (no bridge)
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $rec = 'C:\ProgramData\FinCom\recorder'
$co1 = 'FinCom Spike Co'
$out = Join-Path $env:RES 'versions'; New-Item -ItemType Directory -Force $out | Out-Null
$cap = Join-Path $out 'captures'; New-Item -ItemType Directory -Force $cap | Out-Null
$fc = 'C:\fcspike'; New-Item -ItemType Directory -Force $fc, $rec | Out-Null
& icacls.exe $rec /grant '*S-1-5-32-545:(OI)(CI)M' /Q | Out-Null
$resultsFile = Join-Path $out 'results.txt'; Set-Content $resultsFile -Value @("INFO TallyPrime $rel, mode $env:VMODE, runner $env:RUNNER_NAME, $(Get-Date -Format s)") -Encoding UTF8
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
# state: PASS, FAIL (Tally or the bridge), HARNESS (the harness could not do the step: never a pass)
function Result($check, $state, $evidence) { $l = '{0} {1}: {2}' -f $state, $check, $evidence; Write-Host "######## $l"; Add-Content -Path $resultsFile -Value $l -Encoding UTF8 }
function Info($m) { Write-Host "  INFO $m"; Add-Content -Path $resultsFile -Value "INFO $m" -Encoding UTF8 }
function Shot($n) { & "$PSScriptRoot\shot.ps1" "v-$n" }
function Ms($sw) { [int]$sw.Elapsed.TotalMilliseconds }

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W32V { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }
'@
$script:tpid = 0; $script:noWindow = 0
function KeysTo([string]$k, $wait = 3, $n = '') {
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { $script:noWindow++; Write-Host "[keys] Tally (pid $($script:tpid)) has no window"; return }
  [W32V]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [W32V]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 700
  [System.Windows.Forms.SendKeys]::SendWait($k)
  Write-Host "[keys] '$k' -> Tally '$($p.MainWindowTitle)'"
  Start-Sleep $wait; if ($n) { Shot $n }
}
$script:lastMs = 0
function Post($body, $label = '', $timeout = 60) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $timeout).Content; $script:lastMs = Ms $sw
    if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 600) { $s = $s.Substring(0, 600) + '...' }; Write-Host "[$label] $($script:lastMs) ms: $s" }
    return $c } catch { $script:lastMs = Ms $sw; Write-Host "[$label] failed after $($script:lastMs) ms: $($_.Exception.Message)"; return '' }
}
$listCoXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function Imp($report, $msg, $label) { Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $label }
function Val($n) { "$($n.'#text')$(if ($n -is [string]) { $n })".Trim() }
function Vouchers {
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, NARRATION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $l = @()
  try {
    $d = [xml]($x -replace '&#4;', '')
    foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) {
      $l += [pscustomobject]@{ guid = Val $v.GUID; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); cancelled = ((Val $v.ISCANCELLED) -eq 'Yes'); vno = Val $v.VOUCHERNUMBER; type = Val $v.VOUCHERTYPENAME; date = Val $v.DATE; narr = Val $v.NARRATION }
    }
  } catch { Write-Host "vouchers parse: $_"; Set-Content (Join-Path $out 'vouchers-unparsed.xml') $x }
  $l | ForEach-Object { Write-Host ("  voucher mid={0} aid={1} {2}/{3}/{4} guid={5} cancelled={6}" -f $_.mid, $_.aid, $_.type, $_.vno, $_.date, $_.guid, $_.cancelled) }
  return , $l
}
function Write-TallyIni($tdl, $load) {
  $l = @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($load) { $l += @('Default Companies = Yes', "Load = $load") } else { $l += 'Default Companies = No' }
  if ($tdl) { $l += "TDL = $tdl" }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
}

# ---- c1: install and open the company
Say "---- c1 install and open the company (TallyPrime $rel)"
$fv = (Get-Item $exe -ErrorAction SilentlyContinue).VersionInfo
$exeInfo = if ($fv) { "tally.exe $((Get-Item $exe).Length) bytes, $((Get-Item $exe).LastWriteTime.ToString('yyyy-MM-dd')), FileVersion $($fv.FileVersion), ProductVersion $($fv.ProductVersion), ProductName $($fv.ProductName)" } else { 'tally.exe not found' }
Info "installed: $exe; $exeInfo"
$folder = Get-ChildItem $data1 -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Info "company folder made by flow.ps1: $(if ($folder) { $folder.FullName } else { 'none' })"
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
$tdlSrc = if ($env:BRIDGE_DIST -and (Test-Path (Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl'))) { Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl' } else { Join-Path $env:GITHUB_WORKSPACE 'bridge-go\addon\FinComRecorder.tdl' }
$tdl = "$fc\FinComRecorder.tdl"; Copy-Item $tdlSrc $tdl -Force
Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue
Write-TallyIni $(if ($ledlist -or $mhook -or $full -or $renum -or $bankb -or $s235 -or $share -or $big -or $hang -or $hang2 -or $hang3 -or $hang4 -or $bank) { $tdl } else { $null }) $(if ($folder) { $folder.Name } else { $null })
$swStart = [Diagnostics.Stopwatch]::StartNew()
$t1 = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t1.Id
$portMs = -1; $getAns = ''
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep 3
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $getAns = (Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5).Content; $portMs = Ms $sw; break } catch {}
  if ($t1.HasExited) { break }
}
$upSec = [math]::Round($swStart.Elapsed.TotalSeconds, 1)
Start-Sleep 5
KeysTo 'a' 4; KeysTo 't' 10 '00-started'
$coAns = Post $listCoXml 'companies'; $coMs = $script:lastMs
$hasCo = $coAns -match [regex]::Escape($co1)
# Tally's own release, as Tally gives it in an answer's header ($$NumItems, as flow.ps1 asks)
$fx = Post '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>' 'header'
$hdr = [regex]::Match($fx, '<PRODMAJORVER>(\d*)</PRODMAJORVER>\s*<PRODMINORVER>(\d*)</PRODMINORVER>\s*<PRODMAJORREL>(\d*)</PRODMAJORREL>\s*<PRODMINORREL>(\d*)</PRODMINORREL>\s*(?:<PRODTYPE>(\d*)</PRODTYPE>)?')
$tallyRel = if ($hdr.Success) { "PRODMAJORREL $($hdr.Groups[3].Value) PRODMINORREL $($hdr.Groups[4].Value) (PRODMAJORVER $($hdr.Groups[1].Value) PRODMINORVER $($hdr.Groups[2].Value) PRODTYPE $($hdr.Groups[5].Value))" } else { 'no version in the answer header' }
Info "Tally's own release in its answer header: $tallyRel"
Set-Content (Join-Path $cap 'tally-header.xml') $fx -Encoding UTF8
Set-Content (Join-Path $cap 'companies.xml') $coAns -Encoding UTF8
if ($t1.HasExited) { Result 'c1 install and open the company' 'FAIL' "Tally exited (code $($t1.ExitCode)) after start; $exeInfo" }
elseif (-not $folder) { Result 'c1 install and open the company' 'HARNESS' "installed ($exeInfo) but flow.ps1 made no company folder: see C-* screenshots" }
else { Result 'c1 install and open the company' $(if ($hasCo) { 'PASS' } else { 'FAIL' }) "installed $exeInfo; company folder $($folder.Name) loaded at start: $hasCo; window '$((Get-Process -Id $t1.Id -ErrorAction SilentlyContinue).MainWindowTitle)'" }
$c2ok = ($portMs -ge 0) -and $hasCo
Result 'c2 port and company list' $(if ($c2ok) { 'PASS' } elseif ($portMs -lt 0 -and -not $t1.HasExited) { 'FAIL' } else { 'FAIL' }) ("port 9000 answered {0} s after start, GET {1} ms ('{2}'); company list {3} ms, '{4}' in it: {5}" -f $upSec, $portMs, ($getAns -replace '\s+', ' ').Trim(), $coMs, $co1, $hasCo)

# ledlist (next-masterhook): ledv.ps1 after c2 (no bridge): the bridge's ledger list / changes requests on 2,000-20,000 ledgers
if ($ledlist) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'ledv.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS ledlist: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
# mhook (next-masterhook): mhookv.ps1 after c2 (no bridge): the master hooks on the screen, add-on on and off
if ($mhook) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'mhookv.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS mhook: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($bank) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'bankv.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS bank: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($big) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'bigv.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS big: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($hang4) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'hang4v.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS hang4: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($hang3) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'hang3v.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS hang3: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($hang2) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'hang2v.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS hang2: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($hang) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'hangv.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS hang: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if ($share) {
  if ($c2ok) { . (Join-Path $PSScriptRoot 'sharev.ps1') } else { Add-Content -Path $resultsFile -Value 'HARNESS share: not run (c2: Tally or the company not up)' -Encoding UTF8 }
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return
}
if (-not $full -and -not $renum -and -not $bankb -and -not $s235) { Say 'quick mode: done'; Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; return }
$s235Checks = @('s1 stop: three lines held, nothing asked', 's2 lift: bodies and the delete with its GUID', 's3 restart: the held delete keeps its GUID', 's4 a real failure still counts', 's5 Tally not open: one notification a day')
if (-not $c2ok -and $s235) { foreach ($c in $s235Checks) { Result $c 'HARNESS' 'not run: Tally did not come up with the company (c1/c2)' }; return }
if (-not $c2ok -and $bankb) { Result 'b1 bank dates set in Bank Reconciliation reach FinCom' 'HARNESS' 'not run: Tally did not come up with the company (c1/c2)'; return }
if (-not $c2ok -and $renum) { foreach ($c in 'r1 insert with renumbering on', 'r2 delete with renumbering on') { Result $c 'HARNESS' 'not run: Tally did not come up with the company (c1/c2)' }; return }
if (-not $c2ok) {
  foreach ($c in 'c3 posting from the bridge', 'c4a create by keys', 'c4b alter by keys', 'c6 entry request', 'c5 Alt+2 duplicate', 'c4c cancel by keys', 'c4d delete by keys', 'c7 version string the bridge reads') { Result $c 'HARNESS' 'not run: Tally did not come up with the company (c1/c2)' }
  return
}

# ---- the stub cloud and the bridge (the real setup, just for me, settings seeded as flow4.ps1 does with one user)
Say '---- the stub cloud and the bridge'
$stubLog = Join-Path $out 'stub-requests.jsonl'
$py = (Get-Command python).Source
$stubPy = if ($renum -or $bankb) { 'stubr.py' } elseif ($s235) { 'stub235.py' } else { 'stubv.py' }   # s235: the stub whose beat answer carries FinCom's read stop   # renum: the stub that keeps FinCom's copy and answers renumber_list
$stub = Start-Process -FilePath $py -ArgumentList "`"$PSScriptRoot\$stubPy`" 8787 `"$stubLog`"" -PassThru -WindowStyle Hidden
Start-Sleep 3
# masters the steps need (as flow4.ps1): Spike Income for the Receipt by keys
Imp 'All Masters' '<LEDGER NAME="Spike Income" ACTION="Create"><NAME.LIST><NAME>Spike Income</NAME></NAME.LIST><PARENT>Indirect Incomes</PARENT></LEDGER>' 'ledger Spike Income' | Out-Null
# renum: one entry before the bridge starts, so its starting point is recorded at its first look (ALTVCHID 0 is never one)
if ($renum -or $s235 -or $bankb) { Imp 'Vouchers' '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>renum before the bridge</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' 'renum journal' | Out-Null }
# bankb (next-bankdate): the bank ledger and four contras with bank allocations (2-10-2026, Share Bank) made by XML before
# the bridge starts, so its starting point and the bank route's first number are above them (no add-on line for an import)
if ($bankb) {
  $null = Imp 'All Masters' '<LEDGER NAME="Share Bank" ACTION="Create"><NAME.LIST><NAME>Share Bank</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>' 'bankb ledger Share Bank'
  $bx = ''; foreach ($i in 1..4) { $a = '{0:0.00}' -f (100 + $i)
    $bx += '<VOUCHER VCHTYPE="Contra" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Contra</VOUCHERTYPENAME><NARRATION>bank probe C' + $i + '</NARRATION>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $a + '</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261002</DATE><INSTRUMENTDATE>20261002</INSTRUMENTDATE><TRANSACTIONTYPE>Cash</TRANSACTIONTYPE><PAYMENTFAVOURING>Share Bank</PAYMENTFAVOURING><AMOUNT>-' + $a + '</AMOUNT></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' }
  $bxr = Imp 'Vouchers' $bx 'bankb contras'
  Info "bankb: four contras with bank allocations (2-10-2026, Share Bank): $(([regex]::Match("$bxr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
}
$setupSrc = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-*.exe' | Select-Object -First 1
Info "$(Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue); $(Get-Content (Join-Path $env:BRIDGE_DIST 'bridge-source.txt') -ErrorAction SilentlyContinue)"
$setup = "$fc\FinComBridge-Setup.exe"; Copy-Item $setupSrc.FullName $setup -Force
$h1 = Join-Path $env:LOCALAPPDATA 'TDS Desk Bridge'; New-Item -ItemType Directory -Force $h1 | Out-Null
$seed = @{ CloudUrl = 'http://127.0.0.1:8787/'; CloudKey = 'plain:spike-computer-key-versions'; TallyPorts = @(9000) }
if ($s235) {
  # s235: every request the bridge sends Tally goes through proxy235.py (127.0.0.2:9000, logged); the heartbeat every 5 s
  # (FinCom's stop and lift reach the bridge within seconds); the bridge's office hours said (KeepOfficeFrom/To) only when
  # the runner's clock is outside 9-17 or on a Sunday, so the Tally-not-open notification's office-hours condition holds
  . (Join-Path $PSScriptRoot 's235proxy.ps1')
  $script:proxyOk = Start-S235Proxy
  $seed.TallyHost = '127.0.0.2'; $seed.CloudBeatSec = 5
  $nowL = Get-Date
  if ($nowL.DayOfWeek -eq 'Sunday' -or $nowL.Hour -lt 9 -or $nowL.Hour -ge 17) { $seed.KeepOfficeFrom = 0; $seed.KeepOfficeTo = 24; Info "s235: the runner's clock $($nowL.ToString('ddd HH:mm')) ($([TimeZoneInfo]::Local.Id)) is outside office hours: KeepOfficeFrom 0, KeepOfficeTo 24 set" }
  else { Info "s235: the runner's clock $($nowL.ToString('ddd HH:mm')) ($([TimeZoneInfo]::Local.Id)): office hours (9-19) by the bridge's own setting" }
}
Set-Content "$h1\tds-bridge.config.json" ($seed | ConvertTo-Json -Compress) -Encoding UTF8
$p = Start-Process -FilePath $setup -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
if (-not $p.WaitForExit(300000)) { Write-Host 'setup did not end' }
Write-Host "bridge setup ended with $($p.ExitCode)"
Start-Sleep 15
$cfg1 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
$bport = [int]$cfg1.Port; $bkey = "$($cfg1.Key)"; $blog = "$h1\tds-bridge.log"
$bid = ''
function Bridge($method, $path, $body = $null, $timeout = 120) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $a = @{ Uri = "http://127.0.0.1:$bport$path"; Method = $method; Headers = @{ 'X-Bridge-Key' = $bkey }; TimeoutSec = $timeout }
  if ($null -ne $body) { $a.Body = ($body | ConvertTo-Json -Depth 8 -Compress); $a.ContentType = 'application/json' }
  try { $r = Invoke-RestMethod @a; $script:lastMs = Ms $sw; return $r } catch { $script:lastMs = Ms $sw; Write-Host "[bridge $path] $($_.Exception.Message) $($_.ErrorDetails.Message)"; return $null }
}
$st = $null; for ($i = 0; $i -lt 20 -and -not $st; $i++) { $st = Bridge GET '/status'; if (-not $st) { Start-Sleep 3 } }
Info "bridge on 127.0.0.1:$bport, version $($st.version), allowImport $($st.allowImport), readOnly '$($st.readOnly)', testMode $($st.testMode)"
function StubReqs { if (Test-Path $stubLog) { @(Get-Content $stubLog -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json }) } else { @() } }
function StubLines([int]$from = 0) {
  $r = StubReqs; $l = @()
  for ($i = $from; $i -lt $r.Count; $i++) {
    $o = $r[$i]; if ($o.kind -ne 'recorder_lines') { continue }
    foreach ($x in @($o.body.lines)) { if ($x) { $l += [pscustomobject]@{ i = $i; at = $o.at; company = $o.body.company; ev = $x.event; guid = "$($x.object_guid)"; mid = $x.master_id; aid = $x.alter_id; xml = "$($x.xml)"; vch = "$($x.vch_type)/$($x.vch_no)/$($x.vch_date)"; raw = $x } } }
  }
  return , $l
}
function Ev($x) { if (-not $x) { return '(no line)' }; 'stub {0} recorder line event={1} guid={2} mid={3} aid={4} vch={5} body={6}' -f $x.at, $x.ev, $(if ($x.guid) { $x.guid } else { "''" }), $x.mid, $x.aid, $x.vch, $(if ($x.xml) { "yes($($x.xml.Length) chars)" } else { 'none' }) }
# waits for the line; its delay from $t0 (when the keys saved the entry) measured by this poll (every 2 s)
function WaitLine([int]$from, [scriptblock]$pred, $t0, $sec = 150) {
  $until = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $until) { $m = @((StubLines $from) | Where-Object $pred); if ($m.Count) { $script:lineSec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1); return , $m }; Start-Sleep 2 }
  $script:lineSec = -1; return , @()
}
function Mark { (StubReqs).Count }
$logSeen = 0
function Snap($step) {
  if (Test-Path $blog) { $l = @(Get-Content $blog); $new = @($l | Select-Object -Skip $script:logSeen); $script:logSeen = $l.Count
    Set-Content (Join-Path $out "bridge-log-$step.txt") $new -Encoding UTF8; $new | ForEach-Object { Write-Host "  bridge log: $_" } }
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "rec-$step-$($_.Name)") }
}
Start-Sleep 30; Snap 'start'
$recFiles = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue)
Info "add-on: recorder files after start: $(if ($recFiles.Count) { ($recFiles | ForEach-Object { "$($_.Name) $($_.Length)" }) -join ', ' } else { 'none' })"
$tdlErr = Get-ChildItem $dir, $data1 -Recurse -File -Include *tdl*.log, *err*.log, tdlerr* -ErrorAction SilentlyContinue | Select-Object -First 3
foreach ($f in $tdlErr) { Info "Tally file $($f.FullName): $((Get-Content $f.FullName -Tail 5) -join ' | ')" }
if ($s235) {
  . (Join-Path $PSScriptRoot 's235v.ps1')
  Stop-S235Proxy; if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue; return
}
if ($bankb) {
  . (Join-Path $PSScriptRoot 'bankv.ps1')
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue; return
}
if ($renum) {
  . (Join-Path $PSScriptRoot 'renumv.ps1')
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue; return
}

# ---- c3: a posting from the bridge (/import, one Journal dated 1-10-2026, as FinCom's page posts)
Say '---- c3 posting from the bridge'
$pre = Vouchers
$vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>FinCom versions posting</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-250.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>250.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
$pid1 = "fcv-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$m = Mark
$ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = $pid1; xml = $vx }) } 180; $impMs = $script:lastMs
$irs = $ir | ConvertTo-Json -Depth 8 -Compress
Set-Content (Join-Path $cap 'post-import-answer.json') ($ir | ConvertTo-Json -Depth 8) -Encoding UTF8
$post = Vouchers
$pv = @($post | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0]
Start-Sleep 10; Snap 'c3-post'
$reqLine = @(Get-Content (Join-Path $out 'bridge-log-c3-post.txt') -ErrorAction SilentlyContinue | Where-Object { $_ -match 'request \d+ of \d+' }) -join ' / '
$r0 = @($ir.results)[0]
$c3 = [bool]$ir -and [bool]$r0 -and $r0.ok -eq $true -and [bool]$pv -and $pv.narr -like '*FinCom versions posting*'
Result 'c3 posting from the bridge' $(if ($c3) { 'PASS' } elseif (-not $ir -and $script:lastMs -ge 179000) { 'HARNESS' } else { 'FAIL' }) ("/import {0} ms; item ok={1} message '{2}'; Tally {3}; bridge: {4}" -f $impMs, $r0.ok, $r0.message, $(if ($pv) { "made $($pv.type) no $($pv.vno) mid $($pv.mid) narration '$($pv.narr)'" } else { 'made no voucher' }), $(if ($reqLine) { $reqLine } else { "answer $($irs.Substring(0, [math]::Min(400, $irs.Length)))" }))

# ---- c4a create by keys (flow4.ps1 step 1: a Receipt, Cash, Spike Income 700, dated 2-10-2026)
Say '---- c4a create by keys'
function DayBook($n, $d = '2-10-2026') { KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 4; KeysTo '{F2}' 3; KeysTo "$d{ENTER}" 4 "$n-daybook" }
$nw0 = $script:noWindow
$before = Vouchers; $m = Mark
KeysTo 'v' 4 '10-vouchers'; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo '2-10-2026{ENTER}' 3
KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3 '11-particular'; KeysTo '700{ENTER}' 3; KeysTo '^a' 0; $t0 = Get-Date; Start-Sleep 5; Shot '12-created'
$after = Vouchers
$new = @($after | Where-Object { $_.mid -notin @($before | ForEach-Object mid) })[0]
$hit = WaitLine $m { $_.ev -eq 'created' -and $_.company -eq $co1 -and $_.vch -like 'Receipt/*' } $t0
Snap 'c4a-create'
$x = @($hit)[0]
function KeysVerdict($tallyDid, $lineOk, $what) {
  if ($script:noWindow -gt $nw0) { return 'HARNESS' }   # no Tally window to send the keys to
  if (-not $tallyDid) { return 'HARNESS' }              # the keys did not make the change in Tally (screens: the harness's keys)
  if ($lineOk) { return 'PASS' }; return 'FAIL'
}
$okA = [bool]$x -and [bool]$new -and $x.guid -eq $new.guid -and [bool]$x.xml
Result 'c4a create by keys' (KeysVerdict ([bool]$new) $okA) ("Tally {0}; line after {1} s; {2}" -f $(if ($new) { "made Receipt no $($new.vno) mid $($new.mid) guid $($new.guid)" } else { 'made no entry (the keys)' }), $script:lineSec, (Ev $x))
if ($x -and $x.xml) { Set-Content (Join-Path $cap 'recorder-created-body.xml') $x.xml -Encoding UTF8; $x.raw | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $cap 'recorder-created-line.json') -Encoding UTF8 }
$src = $new

# ---- c8 (branch next-push, the owner's "full entry at save"): the add-on of the ref LOADS on this release and, for the
# receipt c4a saved on the screen, writes the heads lines AND one full-entry line (FCRLiveFull: $$StringLength and the
# "neg" formula are new to a real Tally). Only when the ref's add-on has FCRLiveFull; the add-on's own file is read
$tdlHasFull = (Get-Content $tdl -Raw -ErrorAction SilentlyContinue) -match 'FCRLiveFull'
if (-not $tdlHasFull) { Info 'c8 not run: the add-on of this ref has no full entry (FCRLiveFull)' }
else {
  $recL = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' })
  $mid8 = if ($new) { "$($new.mid)" } else { '' }
  $heads8 = @($recL | Where-Object { $_ -match '^FCR1\|ev=voucher_accept_(pre|post)\|' })
  $full8 = @($recL | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match '\|end=1\|t1=[^|]*\|src=live$' -and (-not $mid8 -or $_ -match "\|mid=$mid8\|") })
  # the line as the bridge checks it: the narration, the first ledger with its sign, no record repeated, and the part's
  # length (|len=<n>: the characters between "|part=1" and "|len=") right
  $len8 = $false; $rep8 = 0
  if ($full8.Count) {
    $f0 = $full8[0]; $i0 = $f0.IndexOf('|part=1') + 7; $mL = [regex]::Match($f0, '\|len=(\d+)\|end=1\|t1=')
    if ($i0 -ge 7 -and $mL.Success) { $len8 = ($f0.Substring($i0, $mL.Index - $i0)).Length -eq [int]$mL.Groups[1].Value }
    $rep8 = @([regex]::Matches($f0, '\|mid=') ).Count - 2   # the head's mid and the entry's own: anything more is a record repeated
  }
  $lp8 = $full8.Count -and $full8[0] -match '\|narr=' -and $full8[0] -match '\|L1=led=[^|~]+~amt=' -and $full8[0] -match '~neg=(Yes|No)' -and $len8 -and $rep8 -le 0
  $err8 = @(Get-ChildItem $dir, $data1 -Recurse -File -Include *tdl*.log, tdlerr* -ErrorAction SilentlyContinue)
  if ($full8.Count) { Set-Content (Join-Path $cap 'full-entry-line.txt') $full8 -Encoding UTF8 }
  $st8 = if (-not $new) { 'HARNESS' } elseif ($heads8.Count -ge 2 -and $full8.Count -ge 1 -and $lp8) { 'PASS' } else { 'FAIL' }
  # branch push-probe: the add-on's FCRProbe line (which string functions this release evaluates), said as it is
  foreach ($pl in @($recL | Where-Object { $_ -like 'FCR1|ev=probe|*' } | Select-Object -First 1)) { Info "c8 probe: $([regex]::Match($pl, '\|narr=(.*)\|t1=').Groups[1].Value)" }
  Result 'c8 the new add-on loads and writes the full entry' $st8 ("receipt by keys: {0}; heads lines {1}; full lines for it {2} (the narration, the first ledger, neg and the part's length read, no record repeated: {3}); every recorder line's event: {4}; Tally's TDL error files: {5}; first full line: {6}" -f `
      $(if ($new) { "mid $($new.mid)" } else { 'not made (the keys)' }), $heads8.Count, $full8.Count, [bool]$lp8, ((($recL | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) | Group-Object | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '),
      $(if ($err8.Count) { ($err8 | ForEach-Object { "$($_.Name): $((Get-Content $_.FullName -Tail 3) -join ' | ')" }) -join '; ' } else { 'none' }), $(if ($full8.Count) { $full8[0].Substring(0, [Math]::Min(700, $full8[0].Length)) } else { '-' }))
}

# ---- c4b alter by keys (flow4.ps1 step 2: Day Book, the last entry, the amount 800)
Say '---- c4b alter by keys'
$nw0 = $script:noWindow; $m = Mark
DayBook '13'; KeysTo '{END}' 2; KeysTo '{ENTER}' 4 '14-open'
KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2 '15-at-amount'; KeysTo '800{ENTER}' 2; KeysTo '^a' 0; $t0 = Get-Date; Start-Sleep 5; Shot '16-altered'
$after2 = Vouchers
$srcNow = if ($src) { @($after2 | Where-Object mid -eq $src.mid)[0] } else { $null }
$hit = WaitLine $m { $_.ev -eq 'altered' -and $_.company -eq $co1 -and $src -and $_.guid -eq $src.guid } $t0
Snap 'c4b-alter'
$x = @($hit)[0]
$did = [bool]$srcNow -and $srcNow.aid -gt $src.aid
Result 'c4b alter by keys' (KeysVerdict $did ([bool]$x -and [int]$x.aid -eq $srcNow.aid -and [bool]$x.xml)) ("Tally: mid {0} AlterID {1} -> {2}; line after {3} s; {4}" -f $src.mid, $src.aid, $srcNow.aid, $script:lineSec, (Ev $x))

# ---- c6 the entry request for one entry: the tray's "Test fetching an entry" (A: FinComVoucherByNumber as the bridge
# sends it, C: FinComVoucherByMaster as the bridge sends it; B, D, E, F its variants), each timed by the bridge
Say '---- c6 entry request (fetch test) for the Receipt'
$ft = $null; $ftStart = $null
if ($srcNow) {
  $d = [datetime]::ParseExact($srcNow.date, 'yyyyMMdd', $null).ToString('dd-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture)
  $ftStart = Bridge POST '/tray/fetchtest' @{ company = $co1; type = 'Receipt'; number = $srcNow.vno; date = $d }
  Write-Host "fetch test start: $($ftStart | ConvertTo-Json -Compress)"
  for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep 3; $ft = Bridge GET '/tray/fetchtest'
    if ($ft.state -eq 'needMaster') { Bridge POST '/tray/fetchtest' @{ masterId = "$($srcNow.mid)" } | Out-Null; continue }
    if ($ft.state -in 'done', 'failed', 'none') { break }
  }
}
Snap 'c6-fetch'
$ft | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $cap 'fetchtest-answer.json') -Encoding UTF8
Get-Content (Join-Path $out 'bridge-log-c6-fetch.txt') -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Test fetching an entry' } | Set-Content (Join-Path $cap 'fetchtest-log.txt') -Encoding UTF8
$fr = @($ft.results)
$fA = @($fr | Where-Object form -eq 'A')[0]; $fC = @($fr | Where-Object form -eq 'C')[0]
$forms = ($fr | ForEach-Object { "$($_.form) $($_.vouchers) voucher(s) $($_.ms) ms$(if ($_.error) { " ($($_.error))" })" }) -join '; '
if (-not $srcNow) { Result 'c6 entry request' 'HARNESS' 'not run: no entry was made by keys (c4a)' }
elseif (-not $ft -or $ft.state -ne 'done') { Result 'c6 entry request' $(if ($ftStart.ok -eq $false) { 'FAIL' } else { 'HARNESS' }) "fetch test did not finish: start $($ftStart | ConvertTo-Json -Compress); last $($ft | ConvertTo-Json -Compress -Depth 5)" }
elseif (-not $fA -and -not $fC) {
  # bridge 2.3.4 removed the trial forms A and C (the owner's decision): every form the bridge has must give the one entry
  $bad = @($fr | Where-Object { [int]$_.vouchers -ne 1 -or $_.error })
  Result 'c6 entry request' $(if ($fr.Count -gt 0 -and $bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) ("Receipt {0} of {1} (mid {2}): this bridge has no forms A and C (removed in 2.3.4); its {3} form(s): {4}; MasterID found {5}" -f $srcNow.vno, $d, $srcNow.mid, $fr.Count, $forms, $ft.masterId) }
else { Result 'c6 entry request' $(if ($fA.vouchers -eq 1 -and $fC.vouchers -eq 1) { 'PASS' } else { 'FAIL' }) ("Receipt {0} of {1} (mid {2}): by number (A) {3} voucher(s) in {4} ms, by MasterID (C) {5} in {6} ms; all forms: {7}; MasterID found {8}" -f $srcNow.vno, $d, $srcNow.mid, $fA.vouchers, $fA.ms, $fC.vouchers, $fC.ms, $forms, $ft.masterId) }

# ---- c5 Alt+2 duplicate (flow4.ps1 step 3: Day Book, the last entry, Alt+2, the amount 900)
Say '---- c5 Alt+2 duplicate'
$nw0 = $script:noWindow; $m = Mark
DayBook '17'; KeysTo '{END}' 2; KeysTo '%2' 4 '18-duplicate'
KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2 '19-dup-at-amount'; KeysTo '900{ENTER}' 2; KeysTo '^a' 0; $t0 = Get-Date; Start-Sleep 5; Shot '20-dup-saved'
$after3 = Vouchers
$dup = @($after3 | Where-Object { $_.mid -notin @($after2 | ForEach-Object mid) })[0]
$srcThen = if ($src) { @($after3 | Where-Object mid -eq $src.mid)[0] } else { $null }
$hit = WaitLine $m { $_.ev -eq 'created' -and $_.company -eq $co1 -and (-not $src -or $_.guid -ne $src.guid) -and $_.vch -like 'Receipt/*' } $t0
Start-Sleep 15
Snap 'c5-dup'
$x = @($hit)[0]
$srcLines = @((StubLines $m) | Where-Object { $src -and $_.company -eq $co1 -and ($_.guid -eq $src.guid) })
Result 'c5 Alt+2 duplicate' (KeysVerdict ([bool]$dup) ([bool]$x -and $x.guid -eq $dup.guid -and [bool]$x.xml -and $srcLines.Count -eq 0)) ("Tally made {0}; source AlterID {1} -> {2}, lines for the source {3}; line after {4} s; {5}" -f $(if ($dup) { "Receipt no $($dup.vno) mid $($dup.mid) guid $($dup.guid)" } else { 'no entry (the keys)' }), $srcNow.aid, $srcThen.aid, $srcLines.Count, $script:lineSec, (Ev $x))

# ---- c4c cancel by keys (flow4.ps1 step 4: Day Book, the first entry, Alt+X)
Say '---- c4c cancel by keys'
$nw0 = $script:noWindow; $m = Mark
DayBook '21'; KeysTo '{HOME}' 2; KeysTo '%x' 3; KeysTo 'y' 0; $t0 = Get-Date; Start-Sleep 4; Shot '22-cancelled'
$after4 = Vouchers
$canc = @($after4 | Where-Object { $_.cancelled -and $_.mid -notin @($after3 | Where-Object cancelled | ForEach-Object mid) })[0]
$hit = WaitLine $m { $_.ev -eq 'cancelled' -and $_.company -eq $co1 } $t0
Snap 'c4c-cancel'
$x = @($hit)[0]
Result 'c4c cancel by keys' (KeysVerdict ([bool]$canc) ([bool]$x -and $x.guid -and $x.guid -eq $canc.guid)) ("Tally cancelled {0}; line after {1} s; {2}" -f $(if ($canc) { "mid $($canc.mid) guid $($canc.guid)" } else { 'nothing (the keys)' }), $script:lineSec, (Ev $x))

# ---- c4d delete by keys (flow4.ps1 step 5: Day Book, the last entry, Alt+D)
Say '---- c4d delete by keys'
$nw0 = $script:noWindow; $m = Mark
DayBook '23'; KeysTo '{END}' 2; KeysTo '%d' 3; KeysTo 'y' 0; $t0 = Get-Date; Start-Sleep 4; Shot '24-deleted'
$after5 = Vouchers
$del = @($after4 | Where-Object { $_.mid -notin @($after5 | ForEach-Object mid) })[0]
$hit = WaitLine $m { $_.ev -eq 'deleted' -and $_.company -eq $co1 } $t0
Snap 'c4d-delete'
$x = @($hit)[0]
# the line proven deleted on this Tally (no held words): Tally answers a MasterID it no longer has with a bare
# <ERRORMSG>Could not find Voucher:ID:n!</ERRORMSG> (the renumbering helper's finding, 08-Oct-2026), which must read as gone
$heldW = if ($x) { "$($x.raw.heldWhy)" } else { '' }
$saidDel = @($(if (Test-Path $blog) { Get-Content $blog }) | Where-Object { $del -and $_ -match ('delete of mid ' + $del.mid + ':') } | Select-Object -Last 3)
Result 'c4d delete by keys' (KeysVerdict ([bool]$del) ([bool]$x -and $x.guid -and $x.guid -eq $del.guid -and -not $heldW)) ("Tally deleted {0}; line after {1} s; {2}; held words: {3}; bridge log: {4}" -f $(if ($del) { "$($del.type) no $($del.vno) mid $($del.mid) guid $($del.guid)" } else { 'nothing (the keys)' }), $script:lineSec, (Ev $x), $(if ($heldW) { $heldW } else { 'none' }), $(if ($saidDel.Count) { $saidDel -join ' | ' } else { 'none' }))

# ---- c7 the Tally version string the bridge reads: the read test's "Tally program: ..." line (recorder_probes.go
# tallyProgram: the running tally.exe's name, size and date; the bridge asks Tally for no release number)
Say '---- c7 version string the bridge reads (read test)'
$rt0 = Bridge POST '/tray/readtest' @{ company = $co1 }
Write-Host "read test start: $($rt0 | ConvertTo-Json -Compress)"
$rt = $null
for ($i = 0; $i -lt 100; $i++) { Start-Sleep 3; $rt = Bridge GET '/tray/readtest'; if ($rt.state -in 'done', 'failed', 'none') { break } }
Snap 'c7-readtest'
$rt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $cap 'readtest-answer.json') -Encoding UTF8
$progLine = @(Get-Content (Join-Path $out 'bridge-log-c7-readtest.txt') -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Tally program: ' })[0]
$prog = if ($progLine) { ($progLine -split 'Tally program: ', 2)[1] } else { '' }
$size = "$((Get-Item $exe).Length) bytes"
Result 'c7 version string the bridge reads' $(if ($prog -and $prog -match [regex]::Escape($size)) { 'PASS' } elseif ($rt.state -eq 'done' -or $rt.state -eq 'failed') { 'FAIL' } else { 'HARNESS' }) ("bridge: '{0}'; read test state {1}; Tally's header: {2}; file: {3}" -f $(if ($prog) { $prog } else { '(no Tally program line)' }), $rt.state, $tallyRel, $exeInfo)

# ---- what is kept
Say '---- what is kept'
Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue
Copy-Item "$env:LOCALAPPDATA\FinCom Bridge\install.log" (Join-Path $out 'bridge-install.log') -ErrorAction SilentlyContinue
$cf = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $cf.Key = '(kept out)'; if ($cf.CloudKey) { $cf.CloudKey = '(kept out)' }
$cf | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'bridge-settings.json')
# the stub's recorder lines (bodies included) as the captures
@(StubLines 0 | ForEach-Object { $_.raw }) | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $cap 'recorder-lines.json') -Encoding UTF8
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
Vouchers | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'tally-vouchers-end.json') -Encoding UTF8
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
Write-Host '== results'; Get-Content $resultsFile | Write-Host
