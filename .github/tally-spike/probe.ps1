# A probe of TallyPrime 7.1 EDU's TDS screens (the owner's S5 by keys, bridge 2.3.1): run instead of round 4
# when the workflow is dispatched with probe=yes. Nothing is checked: screenshots (r5-*) and Tally's own exports go to
# $env:RES\probe so the keys for each scenario can be written from what Tally shows.
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'probe'; New-Item -ItemType Directory -Force $out | Out-Null
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function Shot($n) { & "$PSScriptRoot\shot.ps1" "r5-$n" }
function K($k, $wait = 2, $n = '') { & "$PSScriptRoot\keys.ps1" '^tally$' $k; Start-Sleep $wait; if ($n) { Shot $n } }
function Post($body, $label = '', $file = '') {
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60).Content } catch { $c = "failed: $($_.Exception.Message)" }
  if ($file) { Set-Content (Join-Path $out $file) $c -Encoding UTF8 }
  if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 1500) { $s = $s.Substring(0, 1500) + '...' }; Write-Host "[$label] $s" }
  return $c
}
function Imp($report, $msg, $label) { Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $label }
function Coll($type, $fetch, $file, $filter = '') {
  $f = if ($filter) { "<FILTERS>FCF</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"FCF`">$filter</SYSTEM>" } else { '</COLLECTION>' }
  Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCP</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCP" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "export $type" $file | Out-Null
}
# a GSTIN with its check character (the GSTN mod-36 rule)
function Gstin($first14) {
  $cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; $f = 2; $sum = 0
  for ($i = $first14.Length - 1; $i -ge 0; $i--) { $d = $f * $cs.IndexOf($first14[$i]); $f = if ($f -eq 2) { 1 } else { 2 }; $sum += [math]::Floor($d / 36) + ($d % 36) }
  $first14 + $cs[(36 - ($sum % 36)) % 36]
}

# ---- Tally with the company (as round 4 starts it)
$folder = Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Set-Content (Join-Path $dir 'tally.ini') -Encoding ASCII -Value @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $($folder.Name)")
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
$t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
Start-Sleep 5; K 'a' 4; K 't' 10 '00-gateway'

# ---- TDS by Tally's own screens (the owner's S5): what Educational mode shows. Nothing is saved here: every form is
# walked field by field (Enter, a screenshot each) and left with Esc. Tally's modal messages stop its XML server (probe
# 37406443289): only imports known to work are sent.
Say '---- TDS on (the import that worked in run 37425863775), then F11 as Tally shows it'
Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME><ISTDSON>Yes</ISTDSON></COMPANY></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'TDS on' | Out-Null
K '{F11}' 3 '10-f11'
for ($i = 1; $i -le 30; $i++) { K '{ENTER}' 1 ("11-f11-{0:d2}" -f $i) }
K '{ESC}' 2 '12-f11-esc'; K 'y' 2 '12b-f11-y'; Shot '12d-where'
# after F11 (Esc, y) Tally stands in Master Creation with its search box (probe 37442505835): every walk starts there,
# clears the box, types the master's kind and Enter; a walk ends with Esc, y (quit without saving) back in that list
function Walk($tag, $kind, $name, $group, [int]$n = 22) {
  Say "---- $kind form: $name $group"
  K '{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}' 1 "$tag-0-list"
  K "$kind{ENTER}" 3 "$tag-1-form"; K "$name{ENTER}" 2 "$tag-2-name"
  if ($group) { K '{ENTER}' 2 "$tag-3-under"; K "$group{ENTER}" 3 "$tag-4-group" }
  for ($i = 1; $i -le $n; $i++) { K '{ENTER}' 1 ("$tag-5-{0:d2}" -f $i) }
  K '{ESC}' 2 "$tag-6-esc"; K 'y' 2 "$tag-7-y"; Shot "$tag-9-where"
}
# probe 3 (from probe 37443895060's screens): the nature of payment is a master of the user's own (no predefined list:
# Alter showed only the one the probe made); its form is Name, Section, Payment code, Remittance code, rate for
# individuals/HUF with PAN, rate for other deductee types with PAN, Is zero rated, Threshold
function Clear { K '{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}' 1 '' }
Say '---- probe 9: the company TDS Details form (Create -> TDS Details), then the expense ledger and Stat Adjustment again'
Clear; K 'TDS Details' 2 '20-typed'; K '{ENTER}' 3 '21-tds-details'
for ($i = 1; $i -le 14; $i++) { K '{ENTER}' 1 ("22-td-{0:d2}" -f $i) }
K '^a' 3 '23-accept'; K '{ESC}' 3 '24-esc'; K 'y' 3 '25-y'
Clear; K 'Ledger' 2; K '{ENTER}' 3 '30-exp-form'; K 'Probe Contract Work{ENTER}' 1; K '{ENTER}' 1; K 'Indirect Expenses{ENTER}' 2 '31-group'
for ($i = 1; $i -le 6; $i++) { K '{ENTER}' 1 ("32-exp-{0:d2}" -f $i) }
K '{ESC}' 3 '33-esc'; K 'y' 3 '34-y'; K '{ESC}' 3 '35-gateway'
K 'v' 3 '40-vouchers'; K '{F7}' 3 '41-journal'; K '%j' 3 '42-stat-adj'; K '{ESC}' 2 '43-esc'; K '{ESC}' 2; K 'y' 2 '44-y'
Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCC2</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCC2" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'company *' 'company-all.xml' | Out-Null
Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCC</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCC" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name, IsTDSOn</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'company TDS' 'company.xml' | Out-Null
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Say '== probe end'
