# Steps 3-5: start TallyPrime (EDU), accept the startup dialog, test port 9000, create a company
# (XML import first, then keyboard), then restart with the FinCom recorder TDL loaded and test again.
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE; $ini = Join-Path $dir 'tally.ini'
$data = "$env:RUNNER_TEMP\TallyData"; New-Item -ItemType Directory -Force $data | Out-Null
$tdl = Join-Path $env:GITHUB_WORKSPACE 'bridge-go\addon\FinComRecorder.tdl'
$rec = 'C:\ProgramData\FinCom\recorder'; New-Item -ItemType Directory -Force $rec | Out-Null
$co = 'FinCom Spike Co'
function Shot($n) { & "$PSScriptRoot\shot.ps1" $n }
function Keys($k, $wait = 3, $n = '') { & "$PSScriptRoot\keys.ps1" '^tally$' $k; Start-Sleep $wait; if ($n) { Shot $n } }
function Post($label, $body) {
  try {
    $r = Invoke-WebRequest -Uri http://localhost:9000 -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60
    $c = $r.Content -replace '\s*\r?\n\s*', ''; if ($c.Length -gt 2500) { $c = $c.Substring(0, 2500) + '...' }
    Write-Host "[$label] -> $($r.StatusCode): $c"; return $r.Content
  } catch { Write-Host "[$label] failed: $($_.Exception.Message)" }
}
$listCo = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID,StartingFrom</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function ListCo($label) { $x = Post "list-companies $label" $listCo; return ($x -match [regex]::Escape($co)) }
function Write-Ini($withTdl, $load) {
  $l = @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($load) { $l += @('Default Companies = Yes', "Load = $load") } else { $l += 'Default Companies = No' }
  if ($withTdl) { $l += "TDL = $tdl" }
  Set-Content -Path $ini -Value $l -Encoding ASCII; Write-Host "== tally.ini"; Get-Content $ini | Write-Host
}
function Start-Tally($phase) {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
  $script:p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt 90) {
    Start-Sleep 3
    try { $g = Invoke-WebRequest http://localhost:9000 -UseBasicParsing -TimeoutSec 5; Write-Host "[$phase] port 9000 answers after $([int]((Get-Date)-$t0).TotalSeconds)s: $($g.Content)"; break } catch {}
    if ($script:p.HasExited) { Write-Host "[$phase] TALLY EXITED code $($script:p.ExitCode)"; return }
  }
  Start-Sleep 5
  Get-Process tally | ForEach-Object { Write-Host "[$phase] window title: '$($_.MainWindowTitle)'" }
  Shot "$phase-1-started"
}

# ---- A: plain start
Write-Ini $false $null
Start-Tally 'A'
Keys 'a' 4 'A-2-after-a'
Keys 't' 10 'A-3-after-t-educational'
ListCo 'A' | Out-Null

# ---- B: company by XML import
$coXml = @"
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="$co" ACTION="Create"><NAME>$co</NAME><BASICCOMPANYFORMALNAME>$co</BASICCOMPANYFORMALNAME><STARTINGFROM>20250401</STARTINGFROM><BOOKSFROM>20250401</BOOKSFROM><COUNTRYNAME>India</COUNTRYNAME><STATENAME>Delhi</STATENAME><CURRENCYNAME>Rs.</CURRENCYNAME></COMPANY></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
"@
Post 'B-import-company' $coXml | Out-Null
Start-Sleep 3; Shot 'B-1-after-xml'
$have = ListCo 'B'

# ---- C: company by keyboard
if (-not $have) {
  # EDU mode opens "Select Company" with "Create Company" highlighted
  Keys '{ENTER}' 5 'C-1-enter-create-company'
  Keys $co 2 'C-2-name'
  Keys '^a' 8 'C-3-ctrl-a'
  $have = ListCo 'C'
  $n = 4
  foreach ($k in @('y', '^a', '{ENTER}', 'y', '{ESC}', 'y')) {
    if ($have) { break }
    Keys $k 6 ("C-{0}-{1}" -f $n, ($k -replace '[^a-zA-Z]', '')); $have = ListCo "C$n"; $n++
  }
  Keys '^a' 5 'C-9-features-accepted'
}
Write-Host "== data folder"; Get-ChildItem $data -Recurse -Depth 1 | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$folder = Get-ChildItem $data -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Write-Host "company created: $have; company folder: $($folder.Name)"

# ---- D: restart with the FinCom recorder TDL, company loaded
Write-Ini $true $folder.Name
Start-Tally 'D'
Keys 'a' 4 'D-2-after-a'
Keys 't' 10 'D-2b-after-t'
ListCo 'D' | Out-Null
$tdlQ = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>'
Post 'D-func' $tdlQ | Out-Null
$led = @"
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>$co</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Spike Party" ACTION="Create"><NAME.LIST><NAME>Spike Party</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
"@
Post 'D-import-ledger' $led | Out-Null
Start-Sleep 3; Shot 'D-3-after-ledger'
function Rec($label) { Write-Host "== recorder folder $rec ($label)"; Get-ChildItem $rec -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name) $($_.Length)"; Get-Content $_.FullName -Encoding Unicode | Select-Object -Last 6 | ForEach-Object { Write-Host "    $_" } } }
Rec 'after XML ledger import'
# the TDL's own function, called through the XML port
foreach ($fid in @('FCRLiveLog', '$$FCRLiveLog')) {
  Post "D-call-$fid" ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>' + $fid + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>xml_probe</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>') | Out-Null
}
Rec 'after calling FCRLiveLog by XML'
# a voucher by XML import (EDU mode allows only the 1st, 2nd and 31st of a month)
$vch = @"
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>$co</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260401</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>spike TDSDesk:test-1</NARRATION>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party 2</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
"@
Post 'D-import-ledger2' ($led -replace 'Spike Party', 'Spike Party 2') | Out-Null
Post 'D-import-voucher' $vch | Out-Null
Rec 'after XML voucher import'
# a ledger made on screen (Form Accept path): Gateway -> Create -> Ledger
Keys 'c' 3 'D-7-create'
Keys 'Ledger{ENTER}' 3 'D-8-ledger-form'
Keys 'UI Party{ENTER}' 2 ''
Keys '{ENTER}' 2 'D-9-under'
Keys 'Sundry Debtors{ENTER}' 2 'D-10-group'
Keys '^a' 4 'D-11-saved'
Rec 'after ledger on screen'
Post 'D-ledgers' '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCLed</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name,Parent,MasterID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>' | Out-Null
Write-Host "== files changed in the last 40 minutes (Tally dir, data, temp)"
Get-ChildItem $dir, $data, $env:TEMP, 'C:\ProgramData\FinCom' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-40) -and $_.Extension -notmatch '1800|tsf' } | Select-Object -First 40 | ForEach-Object { Write-Host "  $($_.FullName) $($_.Length)" }
Get-ChildItem $dir, $data -Recurse -File -Include *tdl*, *err* -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "== $($_.FullName)"; Get-Content $_.FullName -Tail 30 | Write-Host }
Write-Host "== end"
Get-ChildItem $rec -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name) $($_.Length)"; Get-Content $_.FullName -Encoding Unicode | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" } }
Get-ChildItem "$dir\logs", $data -Filter *.log -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Write-Host "== $($_.FullName)"; Get-Content $_.FullName -Tail 20 | Write-Host }
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
