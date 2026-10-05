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
Keys 't' 6 'A-3-after-t-educational'
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
  Keys '%k' 3 'C-1-alt-k'
  Keys 'c' 4 'C-2-create'
  Keys $co 2 'C-3-name'
  Keys '^a' 6 'C-4-ctrl-a'
  $have = ListCo 'C'
  if (-not $have) { Keys '^a' 6 'C-5-ctrl-a-again'; $have = ListCo 'C1' }
  if (-not $have) { Keys 'y' 6 'C-6-y'; $have = ListCo 'C2' }
  if (-not $have) { Keys '{ENTER}' 6 'C-7-enter'; $have = ListCo 'C3' }
  Shot 'C-8-end'
}
Write-Host "== data folder"; Get-ChildItem $data -Recurse -Depth 1 | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$folder = Get-ChildItem $data -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Write-Host "company created: $have; company folder: $($folder.Name)"

# ---- D: restart with the FinCom recorder TDL, company loaded
Write-Ini $true $folder.Name
Start-Tally 'D'
Keys 'a' 4 'D-2-after-a'
Shot 'D-2b'
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
Write-Host "== recorder folder $rec"
Get-ChildItem $rec -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name) $($_.Length)"; Get-Content $_.FullName -Encoding Unicode | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" } }
Get-ChildItem "$dir\logs", $data -Filter *.log -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Write-Host "== $($_.FullName)"; Get-Content $_.FullName -Tail 20 | Write-Host }
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
