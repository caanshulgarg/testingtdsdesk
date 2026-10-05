# Round 2: Receipts 212/213 by XML, the fetch requests A-H, then on-screen create/alter/duplicate/cancel/delete with the
# recorder TDL loaded, saving every recorder line after each step. Runs after flow.ps1 (company 100000 exists).
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE; $ini = Join-Path $dir 'tally.ini'
$data = "$env:RUNNER_TEMP\TallyData"
$tdl = Join-Path $env:GITHUB_WORKSPACE 'bridge-go\addon\FinComRecorder.tdl'
$rec = 'C:\ProgramData\FinCom\recorder'
$co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'round2'; New-Item -ItemType Directory -Force $out | Out-Null
function Shot($n) { & "$PSScriptRoot\shot.ps1" "r2-$n" }
function Keys($k, $wait = 3, $n = '') { & "$PSScriptRoot\keys.ps1" '^tally$' $k; Start-Sleep $wait; if ($n) { Shot $n } }
function Post($label, $body, $save = '') {
  try {
    $r = Invoke-WebRequest -Uri http://localhost:9000 -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60
    if ($save) { Set-Content -Path (Join-Path $out $save) -Value $r.Content -Encoding UTF8 }
    $c = $r.Content -replace '\s*\r?\n\s*', ''; if ($c.Length -gt 600) { $c = $c.Substring(0, 600) + '...' }
    Write-Host "[$label] -> $($r.StatusCode): $c"; return $r.Content
  } catch { Write-Host "[$label] failed: $($_.Exception.Message)" }
}
$seen = @{}
function Rec($step) {
  Write-Host "== recorder after step '$step'"
  $all = @()
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object {
    $lines = Get-Content $_.FullName -Encoding Unicode
    $k = $_.Name; $had = if ($seen.ContainsKey($k)) { $seen[$k] } else { 0 }
    $new = @($lines | Select-Object -Skip $had); $seen[$k] = $lines.Count
    Write-Host "  file $k : $($lines.Count) lines, $($new.Count) new"
    foreach ($l in $new) { Write-Host "    $l"; $all += "$k :: $l" }
  }
  Set-Content -Path (Join-Path $out "rec-$step.txt") -Value $all -Encoding UTF8
}
$vlistXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, NARRATION, AMOUNT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function VList($step) {
  $x = Post "vouchers-$step" $vlistXml "vouchers-$step.xml"
  if (-not $x) { Write-Host "   (no answer: is Tally still running? $([bool](Get-Process tally -ErrorAction SilentlyContinue)))"; return }
  [regex]::Matches($x, '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | ForEach-Object {
    $v = $_.Value
    $f = 'MASTERID', 'ALTERID', 'VOUCHERNUMBER', 'DATE', 'VOUCHERTYPENAME', 'ISCANCELLED', 'GUID' | ForEach-Object { $m = [regex]::Match($v, "<$_[^>]*>([^<]*)</$_>"); "$_=$($m.Groups[1].Value)" }
    Write-Host "   voucher: $($f -join ' ')"
  }
}
# ---- restart with the recorder TDL and the company
Set-Content -Path $ini -Encoding ASCII -Value @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'User TDL = Yes', 'Default Companies = Yes', 'Load = 100000', "TDL = $tdl")
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
Start-Process -FilePath $exe -WorkingDirectory $dir | Out-Null
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest http://localhost:9000 -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
Start-Sleep 5; Keys 'a' 4; Keys 't' 10 '00-gateway'
Rec 'start'

# ---- 1. ledgers and Receipts 212 / 213 by XML (EDU: dates 1, 2, 31 only)
function Master($name, $parent) {
  Post "ledger $name" ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="' + $name + '" ACTION="Create"><NAME.LIST><NAME>' + $name + '</NAME></NAME.LIST><PARENT>' + $parent + '</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') | Out-Null
}
Master 'Spike Cash' 'Cash-in-Hand'
Master 'Spike Customer' 'Sundry Debtors'
Master 'Spike Income' 'Indirect Incomes'
function Receipt($no, $amt) {
  $x = Post "receipt $no" ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PARTYLEDGERNAME>Spike Customer</PARTYLEDGERNAME><NARRATION>spike receipt ' + $no + '</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Customer</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') "import-receipt-$no.xml"
  $id = [regex]::Match($x, '<LASTVCHID>(\d+)</LASTVCHID>').Groups[1].Value
  Write-Host "Receipt $no -> LASTVCHID $id"; return [int]$id
}
# Receipt numbering is Automatic by default, and the import then ignores VOUCHERNUMBER (round 2 got 1 and 2):
# let the number through with "Automatic (Manual Override)"
function VTNum($method) {
  if ($method) {
    Post "vouchertype Receipt -> $method" ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHERTYPE NAME="Receipt" ACTION="Alter"><NAME.LIST><NAME>Receipt</NAME></NAME.LIST><NUMBERINGMETHOD>' + $method + '</NUMBERINGMETHOD></VOUCHERTYPE></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') | Out-Null
  }
  $x = Post 'vouchertype Receipt now' ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCVT</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCVT" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>Name, NumberingMethod</FETCH><FILTERS>FCVTR</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FCVTR">$Name = "Receipt"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  Write-Host ("   Receipt numbering now: " + [regex]::Match($x, '<NUMBERINGMETHOD[^>]*>([^<]*)<').Groups[1].Value)
}
VTNum ''
VTNum 'Manual'
$mid212 = Receipt 212 '500.00'
$mid213 = Receipt 213 '600.00'
# the import kept Tally's own numbers (1, 2) although Receipt numbering is Manual: try altering the number by MasterID
foreach ($pair in @(@($mid212, '212', '500.00'), @($mid213, '213', '600.00'))) {
  $m, $no, $amt = $pair
  Post "alter number of MasterID $m to $no" ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER DATE="20261002" TAGNAME="MasterID" TAGVALUE="' + $m + '" VCHTYPE="Receipt" ACTION="Alter"><DATE>20261002</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PARTYLEDGERNAME>Spike Customer</PARTYLEDGERNAME><NARRATION>spike receipt ' + $no + '</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Customer</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') "alter-number-$no.xml" | Out-Null
}
VTNum 'Automatic'
VList 'after-import'
Rec 'xml-import'

# ---- 2. the fetch requests A-H
. "$PSScriptRoot\fetchasks.ps1"
$vx = Post 'number check' $vlistXml 'vouchers-numbercheck.xml'
$num212 = [regex]::Match($vx, '(?s)<MASTERID[^>]*>\s*' + $mid212 + '\s*</MASTERID>').Success
$v2 = [regex]::Matches($vx, '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | Where-Object { $_.Value -match "<MASTERID[^>]*>\s*$mid212\s*<" } | Select-Object -First 1
$actual = [regex]::Match($v2.Value, '<VOUCHERNUMBER>([^<]*)<').Groups[1].Value
Write-Host "MasterID $mid212 now has VOUCHERNUMBER '$actual'"
$asks = @()
foreach ($a in $FetchAsks) { $asks += $a; if ($a.n -in 'A', 'B', 'F' -and $actual -ne '212') { $asks += @{ n = "$($a.n)n"; what = "$($a.what), asking the number Tally really gave ($actual)"; mid = 0; xml = ($a.xml -replace '212', $actual) } } }
foreach ($a in $asks) {
  $m = $mid212 + $a.mid
  $xml = $a.xml -replace '__MID__', "$m"
  $t = Post "fetch $($a.n)" $xml "fetch-$($a.n).xml"
  $raw = ([regex]::Matches($t, '<VOUCHER[ >]')).Count
  $n = ([regex]::Matches($t, '<VOUCHER [^>]*>')).Count
  $ids = ([regex]::Matches($t, '<(MASTERID|VOUCHERNUMBER|DATE|VOUCHERTYPENAME)[^>]*>[^<]*') | ForEach-Object { $_.Value }) -join ' '
  Write-Host "FETCH $($a.n). $($a.what) [MasterID asked: $m] -> vouchers: $n (the diagnostic script's own count: $raw, which also counts CMPINFO's <VOUCHER> tag)   $ids"
}

# ---- 3. on screen
# (a) create a Receipt dated 2-Oct-2026: Gateway V (Vouchers), F6 Receipt, F2 date
Keys 'v' 4 '01-vouchers'
Keys '{F6}' 3 '02-f6-receipt'
Keys '{F2}' 3 '03-f2'
Keys '2-10-2026{ENTER}' 3 '04-date'
Keys 'Spike Cash{ENTER}' 3 '05-account'
Keys 'Spike Income{ENTER}' 3 '06-particular'
Keys '700{ENTER}' 3 '07-amount'
Keys '^a' 5 '08-saved'
Rec 'a-create'
VList 'a'
# (b) alter it: Go To (Alt+G) Day Book, F2 date, last row, Enter, change the amount
function DayBook($n) {
  Keys '%g' 3 "$n-goto"
  Keys 'Day Book' 2 ''
  Keys '{ENTER}' 4 "$n-daybook"
  Keys '{F2}' 3 ''
  Keys '2-10-2026{ENTER}' 4 "$n-daybook-2oct"
}
DayBook '09'
Keys '{END}' 2 '12-last-row'
Keys '{ENTER}' 4 '13-open'
Keys '{ENTER}' 2 '14a-particular'
Keys '{ENTER}' 2 '14b-ledger-accepted'
Keys '{ENTER}' 2 '14-to-amount'
Keys '800{ENTER}' 2 '15-new-amount'
Keys '^a' 5 '16-altered'
Rec 'b-alter'
VList 'b'
# (c) duplicate (Alt+2) the last voucher of the day and save
Shot '17a-daybook'
Keys '{END}' 2 '17b-row'
Keys '%2' 4 '17-duplicate'
Keys '^a' 5 '18-dup-saved'
Rec 'c-duplicate'
VList 'c'
# (d) cancel the first voucher of the day (Alt+X)
Keys '{HOME}' 2 '19-first-row'
Keys '%x' 3 '20-cancel'
Keys 'y' 4 '21-cancel-yes'
Rec 'd-cancel'
VList 'd'
# (e) delete the last voucher of the day (Alt+D)
Keys '{END}' 2 '22a-last-row'
Keys '%d' 3 '22-delete'
Keys 'y' 4 '23-delete-yes'
Rec 'e-delete'
VList 'e'
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item "$rec\*" $out -ErrorAction SilentlyContinue
Write-Host "== round 2 end"
