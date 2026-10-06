# A probe of TallyPrime 7.1 EDU for S5 (TDS) by its own screens, with a screen check between keys (tdslib.ps1: every
# step a screenshot read by Windows' OCR). Run instead of round 4 when the workflow is dispatched with probe=yes. No
# bridge: Tally's own exports go to $env:RES\probe, screenshots tds-* to the shots. What it finds is written to
# $env:RES\probe\tds-findings.txt.
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'probe'; New-Item -ItemType Directory -Force $out | Out-Null
$find = Join-Path $out 'tds-findings.txt'
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function Find($m) { Write-Host "FINDING $m"; Add-Content -Path $find -Value $m -Encoding UTF8 }
function Post($body) { try { (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60).Content } catch { "failed: $($_.Exception.Message)" } }
function Keep($file, $text) { Set-Content (Join-Path $out $file) "$text" -Encoding UTF8 }
function StartTally {
  Get-Process tally -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }; Start-Sleep 3
  $script:tp = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; & "$PSScriptRoot\keys.ps1" '^tally$' 'a'; Start-Sleep 4; & "$PSScriptRoot\keys.ps1" '^tally$' 't'; Start-Sleep 10
}
$folder = Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Set-Content (Join-Path $dir 'tally.ini') -Encoding ASCII -Value @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $($folder.Name)")
StartTally

$script:TdsSend = { param([string]$k) & "$PSScriptRoot\keys.ps1" '^tally$' $k | Out-Null }
$script:TdsPost = { param([string]$x) Post $x }
$script:TdsRestart = { StartTally }
$script:TdsCo = $co
. "$PSScriptRoot\tdslib.ps1"

Say '---- OCR self-test at the Gateway'
$t = TdsScreen 'selftest'
Find "OCR at the Gateway: $(if ($t -match 'Gateway of Tally') { 'reads the screen' } else { "did not read 'Gateway of Tally': $($t.Substring(0, [Math]::Min(200, $t.Length)))" })"

Say '---- the company: TDS on and its deductor details by XML (TANUMBER, TANREGNO, TDSDEDUCTORTYPE), read back'
$r = TdsImport 'All Masters' ('<COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME><ISTDSON>Yes</ISTDSON><TANUMBER>DELF01234E</TANUMBER><TANREGNO>DELF01234E</TANREGNO><TDSDEDUCTORTYPE>Company</TDSDEDUCTORTYPE></COMPANY>')
$c = TdsExport 'Company' 'Name, IsTDSOn, TANumber, TANRegNo, TDSDeductorType'; Keep 'company-after-xml.xml' $c
Find "company by XML: import $(($r -replace '\s+', '').Substring(0, [Math]::Min(160, ($r -replace '\s+', '').Length))); read back: $(([regex]::Matches("$c", '<(TANUMBER|TANREGNO|TDSDEDUCTORTYPE|ISTDSON)[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" }) -join ' ')"
if ("$c" -notmatch 'DELF01234E') { $ok = TdsDeductorScreen 'DELF01234E' 'DELF01234E'; Find "deductor details by the screen: $ok" }

Say '---- the nature of payment: by XML (PX) and by the screen (PK); both read back'
$r = TdsImport 'All Masters' '<TAXCLASSIFICATION NAME="PX 194C Contract" ACTION="Create"><NAME.LIST><NAME>PX 194C Contract</NAME></NAME.LIST><TAXTYPE>TDS</TAXTYPE><SECTIONNUMBER>194C</SECTIONNUMBER><PAYMENTCODE>94C</PAYMENTCODE><TDSRATEDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><DEDUCTEETYPE>Company - Resident</DEDUCTEETYPE><TDSRATE>2</TDSRATE></TDSRATEDETAILS.LIST></TAXCLASSIFICATION>'
Find "nature by XML: $(($r -replace '\s+', '').Substring(0, [Math]::Min(160, ($r -replace '\s+', '').Length)))"
$ok = TdsNatureScreen 'PK 194C Contractors' '194C' '94C' '1' '2'
Find "nature by the screen: $ok"
$tc = TdsExport 'TaxClassification' '*'; Keep 'taxclassification-all.xml' $tc
foreach ($n in 'PX 194C Contract', 'PK 194C Contractors') {
  $m = [regex]::Match("$tc", '(?s)<TAXCLASSIFICATION NAME="' + [regex]::Escape($n) + '".*?</TAXCLASSIFICATION>')
  Find "nature '$n' in Tally's export: $(if ($m.Success) { (([regex]::Matches($m.Value, '<([A-Z.]+)[^>]*>([^<\s][^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" }) -join ' ') } else { 'NOT THERE' })"
}

Say '---- the ledgers by XML for the PK nature (party, TDS ledger, expense), read back with FETCH *'
$led = { param($n, $p, $x) "<LEDGER NAME=`"$n`" ACTION=`"Create`"><NAME.LIST><NAME>$n</NAME></NAME.LIST><PARENT>$p</PARENT>$x</LEDGER>" }
$nat = 'PK 194C Contractors'
$r = TdsImport 'All Masters' ((& $led 'PK Contractor' 'Sundry Creditors' '<ISBILLWISEON>No</ISBILLWISEON><ISCOSTCENTRESON>No</ISCOSTCENTRESON><INCOMETAXNUMBER>AAACS2310K</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><ISTDSDEDUCTEDINSAMEVCH>Yes</ISTDSDEDUCTEDINSAMEVCH>') +
  (& $led 'PK TDS 194C' 'Duties &amp; Taxes' "<TAXTYPE>TDS</TAXTYPE><TDSCATEGORYNAME>$nat</TDSCATEGORYNAME><TAXCLASSIFICATIONNAME>$nat</TAXCLASSIFICATIONNAME>") +
  (& $led 'PK Contract Work' 'Indirect Expenses' "<ISCOSTCENTRESON>No</ISCOSTCENTRESON><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>$nat</TDSAPPLICABLE><TDSCATEGORYNAME>$nat</TDSCATEGORYNAME>"))
Find "ledgers by XML: $(($r -replace '\s+', '').Substring(0, [Math]::Min(200, ($r -replace '\s+', '').Length)))"

Say '---- the party and the TDS ledger by the screen too (PKS), each key screenshotted'
$ok1 = TdsLedgerScreen 'PKS Contractor' 'Sundry Creditors' @(@('n', ''), @('y', 'Deductee'), @('Company - Resident{ENTER}', ''), @('y', ''), @('{ENTER}', ''), @('{ENTER}', ''))
$ok2 = TdsLedgerScreen 'PKS TDS 194C' 'Duties & Taxes' @(@('TDS{ENTER}', 'Nature'), @("$nat{ENTER}", ''), @('{ENTER}', ''), @('{ENTER}', ''))
Find "ledgers by the screen: party $ok1, TDS ledger $ok2"
$lx = TdsExport 'Ledger' '*' '$Name Starting With "PK"'; Keep 'ledgers-pk.xml' $lx
foreach ($n in 'PK Contractor', 'PK TDS 194C', 'PK Contract Work', 'PKS Contractor', 'PKS TDS 194C') {
  $m = [regex]::Match("$lx", '(?s)<LEDGER NAME="' + [regex]::Escape($n) + '".*?</LEDGER>')
  Find "ledger '$n': $(if ($m.Success) { (([regex]::Matches($m.Value, '<([A-Z.]*(TDS|TAX|DEDUCT|NATURE|CATEGORY|INCOMETAX|PAN)[A-Z.]*)[^>]*>([^<\s][^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[3].Value)" }) -join ' ') } else { 'NOT THERE' })"
}

Say '---- entries: by XML with the TDS allocation, then a journal and a payment by the screen'
$x = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260802</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>PKX journal by XML</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PK Contract Work</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100000.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PK TDS 194C</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>2000.00</AMOUNT><TAXOBJECTALLOCATIONS.LIST><CATEGORY>' + $nat + '</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>PK Contractor</PARTYLEDGER><REFTYPE>New Ref</REFTYPE><ISPANVALID>Yes</ISPANVALID><SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>PK TDS 194C</DUTYLEDGER><TAXRATE>2</TAXRATE><ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT><TAX>2000.00</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PK Contractor</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>98000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
$r = TdsImport 'Vouchers' $x
$v = TdsVoucherExport 'PKX journal by XML'; Keep 'voucher-pkx.xml' $v; $a = TdsTaxAlloc "$v"
Find "journal by XML: import $(($r -replace '\s+', '').Substring(0, [Math]::Min(160, ($r -replace '\s+', '').Length))); TDS allocation kept: $($a.any) nature '$($a.nature)' rate '$($a.rate)' base '$($a.base)' tax '$($a.tax)' party '$($a.party)'"

$null = TdsEntryScreen '{F7}' 'Journal' '2-8-2026' @(@('PK Contract Work', '100000'), @('PK TDS 194C', ''), @('PK Contractor', '')) 'PKJ journal on the screen'
$v = TdsVoucherExport 'PKJ journal on the screen'; Keep 'voucher-pkj.xml' $v; $a = TdsTaxAlloc "$v"
Find "journal by the screen: saved $([bool]("$v" -match 'PKJ journal')); TDS allocation: $($a.any) nature '$($a.nature)' rate '$($a.rate)' base '$($a.base)' tax '$($a.tax)' party '$($a.party)'; amounts $((([regex]::Matches("$v", '(?s)<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>([^<]*)</AMOUNT>') | ForEach-Object { "$($_.Groups[1].Value) $($_.Groups[2].Value)" }) -join ', '))"

$null = TdsEntryScreen '{F5}' 'Payment' '2-8-2026' @(@('PK Contract Work', '100000'), @('PK TDS 194C', ''), @('Cash', '')) 'PKP payment on the screen'
$v = TdsVoucherExport 'PKP payment on the screen'; Keep 'voucher-pkp.xml' $v; $a = TdsTaxAlloc "$v"
Find "payment by the screen: saved $([bool]("$v" -match 'PKP payment')); TDS allocation: $($a.any) nature '$($a.nature)' rate '$($a.rate)' base '$($a.base)' tax '$($a.tax)' party '$($a.party)'; amounts $((([regex]::Matches("$v", '(?s)<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>([^<]*)</AMOUNT>') | ForEach-Object { "$($_.Groups[1].Value) $($_.Groups[2].Value)" }) -join ', '))"

Set-Content (Join-Path $out 'tds-screen-log.txt') $script:tdsLog -Encoding UTF8
Get-Process tally -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }
Say '== probe end'
