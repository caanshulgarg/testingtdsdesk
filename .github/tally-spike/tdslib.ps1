# S5 by Tally's own screens, with a screen check between keys: every step is a screenshot (tds-<n>.png) read by Windows'
# OCR (ocr.ps1); a step that expects a screen waits for its words before the next key. Dot-sourced by probe.ps1 and
# scen231.ps1; the caller sets:
#   $script:TdsSend    { param([string]$keys) ... }   keys to the right Tally window (SendKeys syntax)
#   $script:TdsPost    { param([string]$xml) ... }    a request to that Tally, returns its answer text
#   $script:TdsRestart { ... }                         Tally started again and standing at the Gateway (the last resort)
#   $script:TdsCo      the company's name
$script:tdsN = 0
$script:tdsLog = @()
function TdsSay($m) { $l = "[$(Get-Date -Format HH:mm:ss)] [tds] $m"; Write-Host $l; $script:tdsLog += $l }
# text for SendKeys: + ^ % ~ ( ) { } [ ] are special
function SK([string]$s) { ($s.ToCharArray() | ForEach-Object { if ('+^%~(){}[]'.Contains([string]$_)) { "{$_}" } else { [string]$_ } }) -join '' }
function TdsScreen([string]$name) {
  $script:tdsN++
  $n = 'tds-{0:d3}-{1}' -f $script:tdsN, ($name -replace '[^\w-]', '')
  & "$PSScriptRoot\shot.ps1" $n | Out-Null
  $png = Join-Path $env:SHOTS "$n.png"
  $t = if (Test-Path $png) { (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ocr.ps1" $png 2>&1 | Out-String) } else { 'NO-SHOT' }
  $one = ($t -replace '\s+', ' ').Trim()
  TdsSay "screen $n : $(if ($one.Length -gt 600) { $one.Substring(0, 600) + '...' } else { $one })"
  return $one
}
$script:ocrOk = $true
# keys, then wait for one of the expected screen words (regex); returns $true when seen (or when nothing is expected)
function TK([string]$keys, [double]$wait = 1.5, [string]$name = '', [string]$expect = '', [int]$sec = 10) {
  & $script:TdsSend $keys
  Start-Sleep -Milliseconds ([int]($wait * 1000))
  if (-not $name -and -not $expect) { return $true }
  $until = (Get-Date).AddSeconds($sec)
  do {
    $t = TdsScreen $(if ($name) { $name } else { 'step' })
    if ($t -match '^OCR-UNAVAILABLE') { $script:ocrOk = $false; return $true }
    if (-not $expect -or $t -match $expect) { return $true }
    Start-Sleep 2
  } while ((Get-Date) -lt $until)
  TdsSay "expected /$expect/ after '$keys' ($name): not seen"
  return $false
}
# the Gateway, by Esc (a "Quit? Yes or No" over a form is answered y: the form is left unsaved); Tally started again
# when the Gateway is not reached
function TdsGateway([string]$why = '') {
  for ($i = 0; $i -lt 7; $i++) {
    $t = TdsScreen "gw$i"
    if ($t -match '^OCR-UNAVAILABLE') { $script:ocrOk = $false; break }
    $form = $t -match 'Creation|Alteration|List of Masters|Select |Deductor Details|Accept \?|Yes or No|Change Date'
    if ($t -match 'Gateway of Tally' -and -not $form) { return $true }
    if ($t -match 'Yes or No' -and $t -match 'Creation|Alteration|Deductor') { & $script:TdsSend 'y'; Start-Sleep 2; continue }
    if ($t -match 'Yes or No') { & $script:TdsSend 'n'; Start-Sleep 2; continue }
    & $script:TdsSend '{ESC}'; Start-Sleep 2
  }
  TdsSay "the Gateway not reached ($why): Tally started again"
  & $script:TdsRestart
  return $true
}
function TdsExport([string]$type, [string]$fetch, [string]$filter = '') {
  $f = if ($filter) { "<FILTERS>TdsF</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"TdsF`">$filter</SYSTEM>" } else { '</COLLECTION>' }
  & $script:TdsPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TdsX</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $script:TdsCo + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TdsX" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
}
function TdsImport([string]$report, [string]$msg) {
  & $script:TdsPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $script:TdsCo + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
}
function TdsHas([string]$type, [string]$name) { "$(TdsExport $type 'Name')" -match ('NAME="' + [regex]::Escape([Security.SecurityElement]::Escape($name)) + '"') }
# Create -> <kind> from the Gateway: the Master Creation box, the kind typed, its form
function TdsOpenCreate([string]$kind, [string]$formWords) {
  $null = TdsGateway "before $kind"
  if (-not (TK 'c' 2 "create-$kind" 'Master Creation|List of Masters')) { return $false }
  $null = TK ('{BACKSPACE}' * 30) 0.5
  $null = TK (SK $kind) 1.5 "typed-$kind"
  return (TK '{ENTER}' 2.5 "form-$kind" $formWords)
}
# the nature of payment by its form (Name, Section, Payment code, Remittance code, rate individuals/HUF with PAN, rate
# others with PAN, Is zero rated, Threshold), accepted; checked by Tally's own export (TaxClassification)
function TdsNatureScreen([string]$name, [string]$section, [string]$pay, [string]$rInd, [string]$rOth) {
  if (TdsHas 'TaxClassification' $name) { TdsSay "nature '$name' is there already"; return $true }
  if (-not (TdsOpenCreate 'TDS Nature of Payments' 'Nature|Section')) { return $false }
  $null = TK ((SK $name) + '{ENTER}') 1.5 'nat-name' 'Section'
  $null = TK ((SK $section) + '{ENTER}') 1.5 'nat-section'
  $null = TK ((SK $pay) + '{ENTER}') 1.5 'nat-paycode'
  $null = TK '{ENTER}' 1.5 'nat-remit'
  $null = TK ($rInd + '{ENTER}') 1.5 'nat-rate-ind'
  $null = TK ($rOth + '{ENTER}') 1.5 'nat-rate-oth'
  $null = TK '{ENTER}' 1.5 'nat-zero'
  $null = TK '{ENTER}' 2 'nat-threshold'
  $null = TK '^a' 2.5 'nat-accept'
  $ok = TdsHas 'TaxClassification' $name
  TdsSay "nature '$name' in Tally's export: $ok"
  $null = TdsGateway 'after the nature'
  return $ok
}
# the company's TDS deductor details (Create -> TDS Details: TAN registration number, TAN, deductor type), accepted
function TdsDeductorScreen([string]$tanReg, [string]$tan) {
  if (-not (TdsOpenCreate 'TDS Details' 'Deductor|TAN')) { return $false }
  $null = TK ((SK $tanReg) + '{ENTER}') 1.5 'ded-tanreg'
  $null = TK ((SK $tan) + '{ENTER}') 1.5 'ded-tan'
  $null = TK '^a' 2.5 'ded-accept'
  $c = "$(TdsExport 'Company' 'Name, TANumber, TANRegNo, TDSDeductorType, IsTDSOn')"
  $ok = $c -match [regex]::Escape($tan)
  TdsSay "deductor details in Tally's export: $ok ($(([regex]::Matches($c, '<(TANUMBER|TANREGNO|TDSDEDUCTORTYPE|ISTDSON)[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" }) -join ' '))"
  $null = TdsGateway 'after the deductor details'
  return $ok
}
# a ledger by its form: Name, then Under (the group), then each further key with a screenshot; accepted
function TdsLedgerScreen([string]$name, [string]$group, [object[]]$keys) {
  if (TdsHas 'Ledger' $name) { TdsSay "ledger '$name' is there already"; return $true }
  if (-not (TdsOpenCreate 'Ledger' 'Ledger Creation|Under')) { return $false }
  $null = TK ((SK $name) + '{ENTER}') 1.5 "led-name"
  $null = TK '{ENTER}' 1.5 'led-alias'
  $null = TK ((SK $group) + '{ENTER}') 2 'led-under'
  $i = 0; foreach ($k in $keys) { $i++; $null = TK $k[0] 1.5 ("led-{0:d2}" -f $i) $k[1] 4 }
  $null = TK '^a' 2.5 'led-accept'
  $ok = TdsHas 'Ledger' $name
  TdsSay "ledger '$name' in Tally's export: $ok"
  $null = TdsGateway "after the ledger $name"
  return $ok
}
# an entry on Tally's screen: Gateway -> Vouchers, the voucher type key, the date (F2), then the rows; each row is a
# ledger name and an amount ('' = keep what Tally put there, Tally's own TDS amount); every sub-screen Tally opens
# after a row is screenshotted and accepted with Enter (up to $sub times) until the next row's ledger box is back
function TdsEntryScreen([string]$typeKey, [string]$typeWords, [string]$date, [object[]]$rows, [string]$narr, [int]$sub = 6) {
  $null = TdsGateway 'before the entry'
  if (-not (TK 'v' 2.5 'vouchers' 'Voucher')) { return $false }
  if (-not (TK $typeKey 2.5 'vtype' $typeWords)) { return $false }
  $null = TK '{F2}' 1.5 'date-box' 'Date'
  $null = TK ((SK $date) + '{ENTER}') 2 'date-set'
  $r = 0
  foreach ($row in $rows) {
    $r++
    $null = TK ((SK $row[0]) + '{ENTER}') 2 "row$r-ledger"
    for ($j = 1; $j -le $sub; $j++) {
      $t = TdsScreen "row$r-sub$j"
      if ($t -match 'TDS|Nature of Payment|Bill-wise|Bill-wise Details|Assessable|Party Details') { & $script:TdsSend '{ENTER}'; Start-Sleep 1.5; continue }
      break
    }
    if ($row[1]) { $null = TK ((SK $row[1]) + '{ENTER}') 2 "row$r-amount" } else { $null = TK '{ENTER}' 2 "row$r-amount-tally" }
    for ($j = 1; $j -le $sub; $j++) {
      $t = TdsScreen "row$r-after$j"
      if ($t -match 'Bill-wise|Cost Centre|TDS Details|Nature of Payment|Party Details|Assessable') { & $script:TdsSend '{ENTER}'; Start-Sleep 1.5; continue }
      break
    }
  }
  # the rows done: Enter on the empty next row, the narration, accept
  $null = TK '{ENTER}' 2 'rows-done'
  $null = TK ((SK $narr) + '{ENTER}') 2 'narration'
  $null = TK '^a' 3 'accept' 'Accept|Yes or No|Voucher'
  $t = TdsScreen 'after-accept'
  if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; $null = TdsScreen 'after-yes' }
  $null = TdsGateway 'after the entry'
  return $true
}
# the whole voucher as Tally keeps it (its TDS allocations included), by narration
function TdsVoucherExport([string]$narr) {
  $fl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, LEDGERENTRIES.*'
  TdsExport 'Voucher' $fl ('$Narration CONTAINS "' + $narr + '"')
}
function TdsTaxAlloc([string]$x) {
  $tx = [regex]::Match($x, '(?s)<TAXOBJECTALLOCATIONS\.LIST>(.*?)</TAXOBJECTALLOCATIONS\.LIST>').Groups[1].Value
  $v = { param($t) [regex]::Match($tx, "<$t[^>]*>([^<]+)<").Groups[1].Value.Trim() }
  [pscustomobject]@{ any = [bool]$tx.Trim(); nature = (& $v 'CATEGORY'); rate = (& $v 'TAXRATE'); base = (& $v 'ASSESSABLEAMOUNT'); tax = (& $v 'TAX'); party = (& $v 'PARTYLEDGER'); type = (& $v 'TAXTYPE') }
}
