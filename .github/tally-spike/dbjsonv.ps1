# Mode dbjson (MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally; TallyPrime 7.1 by default).
# Dot-sourced by flowv.ps1 after c2; no bridge. The owner's ask of 28-Oct-2026: anyone uploads the Day Book as XML or JSON.
# What Tally itself writes for the SAME period's Day Book as XML and as JSON, and the List of Accounts as JSON:
#   1. test data: tdsgst/masters.json (GST, TDS, bill-wise), payg/masters.xml (payroll, cost centres), a stock item, a cost
#      centre ledger; tdsgst/vouchers-p1.json (39 GST / TDS / bill-wise entries), payg/vouchers.xml (36 payroll entries), an
#      item invoice, a journal with a cost centre, an optional journal, a cancelled journal (all by XML)
#   2. Tally's own screens (keys, each screen read by OCR): Day Book, Alt+F2 the period, Alt+E Export, the file format set to
#      XML (Data Interchange) and then each JSON format the list offers; List of Accounts the same as JSON. The files Tally
#      wrote are found on disk and kept as Tally wrote them (bytes, encoding untouched): captures/ui-*.
#   3. the same by Tally's HTTP port (bytes kept): Day Book and List of Accounts with SVEXPORTFORMAT XML, JSON, JSONEx, and
#      the JSON request form (headers version / tallyrequest / type / id, body static_variables); a Voucher collection with
#      every stored field, as XML and as JSONEx: captures/http-*
# Result lines: j1 test data made; j2 Day Book exported by the screens (XML and JSON); j3 List of Accounts exported by the
# screens as JSON; j4 the same by the HTTP port; j5 captures kept. A step the harness could not do is HARNESS, never PASS.
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 60 }
$script:TdsCo = $co1
$script:TdsRestart = {
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'dbjson-restarted'
}
$J1 = 'j1 test data made (GST, TDS, bill-wise, cost centres, payroll, inventory, optional, cancelled)'
$J2 = 'j2 Day Book exported by the screens as XML and as JSON'
$J3 = 'j3 List of Accounts exported by the screens as JSON'
$J4 = 'j4 Day Book and masters exported by the HTTP port (XML, JSON, JSONEx, the JSON request)'
$J5 = 'j5 captures kept'
$jDone = @{}
function JRes($c, $st, $ev) { if (-not $jDone[$c]) { Result $c $st $ev; $jDone[$c] = $true } }
function JCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | Select-Object -First 3 | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; $f = ("$r" -replace '\s+', ' '); return [pscustomobject]@{ c = 0; a = 0; e = -1; line = $f.Substring(0, [Math]::Min(300, $f.Length)) } }
function JImp($report, $msg, $label) { $r = Imp $report $msg $label; $k = JCount $r; Info ("dbjson {0}: created {1}, altered {2}, errors {3}{4}" -f $label, $k.c, $k.a, $k.e, $(if ($k.line) { "; Tally said: $($k.line)" } else { '' })); return $k }
function JE([string]$s) { [Security.SecurityElement]::Escape($s) }
# the text of bytes as Tally wrote them: BOM first, else UTF-16 by its zero bytes, else UTF-8
function JText([byte[]]$b) {
  if (-not $b -or $b.Length -eq 0) { return '' }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { return [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { return [Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2) }
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { return [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) }
  if ($b.Length -ge 4 -and $b[1] -eq 0 -and $b[3] -eq 0) { return [Text.Encoding]::Unicode.GetString($b) }
  return [Text.Encoding]::UTF8.GetString($b)
}
function JEnc([byte[]]$b) {
  if (-not $b -or $b.Length -lt 2) { return 'empty' }
  if ($b[0] -eq 0xFF -and $b[1] -eq 0xFE) { return 'UTF-16LE with BOM' }
  if ($b[0] -eq 0xFE -and $b[1] -eq 0xFF) { return 'UTF-16BE with BOM' }
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { return 'UTF-8 with BOM' }
  if ($b.Length -ge 4 -and $b[1] -eq 0 -and $b[3] -eq 0) { return 'UTF-16LE no BOM' }
  return 'UTF-8 (or ASCII) no BOM'
}
# a request whose answer is kept as bytes (the encoding Tally answers in is part of the finding)
function JPost([string]$name, [string]$body, [string]$ctype = 'text/xml;charset=utf-8', [hashtable]$headers = @{}, [int]$sec = 300) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType $ctype -Headers $headers -UseBasicParsing -TimeoutSec $sec
    $b = $r.RawContentStream.ToArray(); $ms = Ms $sw
    [IO.File]::WriteAllBytes((Join-Path $cap $name), $b)
    $t = JText $b; $s = ($t -replace '\s+', ' '); if ($s.Length -gt 300) { $s = $s.Substring(0, 300) + '...' }
    Info ("dbjson http {0}: {1} bytes, {2}, answer Content-Type '{3}', {4} ms: {5}" -f $name, $b.Length, (JEnc $b), $r.Headers['Content-Type'], $ms, $s)
    return $t
  } catch { Info "dbjson http ${name}: failed after $(Ms $sw) ms: $($_.Exception.Message)"; return '' }
}
function JVchCount([string]$t) { ([regex]::Matches($t, '<VOUCHER[ >]')).Count }
function JJsonCount([string]$t) { ([regex]::Matches($t, '"(?i:vouchertypename)"\s*:')).Count }

# ---------------------------------------------------------------- 1. test data
$made = @(); $bad = @()
try {
  Say '---- dbjson: masters'
  $M = Get-Content (Join-Path $PSScriptRoot 'tdsgst\masters.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in $M.steps) { $null = JImp 'All Masters' $s[1] "tdsgst masters $($s[0])" }
  $pdir = Join-Path $PSScriptRoot 'payg'
  $PS = Get-Content (Join-Path $pdir 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $mx = (Get-Content (Join-Path $pdir 'masters.xml') -Raw -Encoding UTF8).Replace('"' + (JE $PS.company) + '"', '"' + (JE $co1) + '"').Replace('<NAME>' + (JE $PS.company) + '</NAME>', '<NAME>' + (JE $co1) + '</NAME>')
  $null = JImp 'All Masters' $mx 'payg masters (payroll, employees as cost centres)'
  $null = JImp 'All Masters' ('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>' +
    '<STOCKITEM NAME="Laptop" ACTION="Create"><NAME.LIST><NAME>Laptop</NAME></NAME.LIST><PARENT/><BASEUNITS>Nos</BASEUNITS><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY><GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>8471</HSNCODE><TAXABILITY>Taxable</TAXABILITY><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></STOCKITEM>' +
    '<LEDGER NAME="Sales Items" ACTION="Create"><NAME.LIST><NAME>Sales Items</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><AFFECTSSTOCK>Yes</AFFECTSSTOCK></LEDGER>' +
    '<COSTCENTRE NAME="DJ Project A" ACTION="Create"><NAME.LIST><NAME>DJ Project A</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY></COSTCENTRE>' +
    '<LEDGER NAME="DJ Travel" ACTION="Create"><NAME.LIST><NAME>DJ Travel</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></LEDGER>' +
    '<VOUCHERTYPE NAME="DJ Item Sales" ACTION="Create"><NAME.LIST><NAME>DJ Item Sales</NAME></NAME.LIST><PARENT>Sales</PARENT><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AFFECTSSTOCK>Yes</AFFECTSSTOCK></VOUCHERTYPE>') 'stock item, cost centre, travel ledger, item voucher type'

  Say '---- dbjson: entries'
  $V1 = Get-Content (Join-Path $PSScriptRoot 'tdsgst\vouchers-p1.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($v in $V1.vouchers) {
    $k = JImp 'Vouchers' $v.xml "tdsgst $($v.id)"
    if ($k.c -ne 1 -and $v.xml -match 'TAXOBJECTALLOCATIONS') { $k = JImp 'Vouchers' ($v.xml -replace '(?s)<TAXOBJECTALLOCATIONS\.LIST>.*?</TAXOBJECTALLOCATIONS\.LIST>', '') "tdsgst $($v.id) (no TDS allocation)" }
    if ($k.c -eq 1) { $made += $v.id } else { $bad += "$($v.id) ($($k.line))" }
  }
  $vxRaw = Get-Content (Join-Path $pdir 'vouchers.xml') -Raw -Encoding UTF8
  foreach ($v in @([regex]::Matches($vxRaw, '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | ForEach-Object { $_.Value })) {
    $no = [regex]::Match($v, '<VOUCHERNUMBER>([^<]*)<').Groups[1].Value
    $k = JImp 'Vouchers' $v "payg $no"; if ($k.c -eq 1) { $made += "payg $no" } else { $bad += "payg $no ($($k.line))" }
  }
  # an item invoice (2-May-2026: Educational mode takes days 1, 2 and 31 only: run 38105667572's 3-May was refused)
  $party = 'Alpha Traders Delhi'
  $iv = '<VOUCHER VCHTYPE="DJ Item Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>20260502</DATE><EFFECTIVEDATE>20260502</EFFECTIVEDATE><VOUCHERTYPENAME>DJ Item Sales</VOUCHERTYPENAME><VOUCHERNUMBER>DJ/I01</VOUCHERNUMBER>' +
    '<PARTYLEDGERNAME>' + $party + '</PARTYLEDGERNAME><PARTYNAME>' + $party + '</PARTYNAME><BASICBUYERNAME>' + $party + '</BASICBUYERNAME><PLACEOFSUPPLY>Delhi</PLACEOFSUPPLY><STATENAME>Delhi</STATENAME><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>' +
    '<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>DJ1 item invoice, dbjson test data</NARRATION>' +
    '<LEDGERENTRIES.LIST><LEDGERNAME>' + $party + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-472.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>DJ/I01</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-472.00</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>' +
    '<LEDGERENTRIES.LIST><LEDGERNAME>Output CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>36.00</AMOUNT></LEDGERENTRIES.LIST>' +
    '<LEDGERENTRIES.LIST><LEDGERNAME>Output SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>36.00</AMOUNT></LEDGERENTRIES.LIST>' +
    '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Laptop</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>200.00/Nos</RATE><AMOUNT>400.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>' +
    '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales Items</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>'
  $k = JImp 'Vouchers' $iv 'DJ1 item invoice'; if ($k.c -eq 1) { $made += 'DJ1' } else { $bad += "DJ1 ($($k.line))" }
  function JJv($no, $date, $narr, $extra, $cc) {
    $dr = '<ALLLEDGERENTRIES.LIST><LEDGERNAME>DJ Travel</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1000.00</AMOUNT>'
    if ($cc) { $dr += '<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><COSTCENTREALLOCATIONS.LIST><NAME>DJ Project A</NAME><AMOUNT>-1000.00</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>' }
    return '<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>' + $date + '</DATE><EFFECTIVEDATE>' + $date + '</EFFECTIVEDATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>' + $extra + '<NARRATION>' + $narr + '</NARRATION>' +
      $dr + '</ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  }
  $k = JImp 'Vouchers' (JJv 'DJ/C02' '20260601' 'DJ2 travel with a cost centre, dbjson test data' '' $true) 'DJ2 cost centre'; if ($k.c -eq 1) { $made += 'DJ2' } else { $bad += "DJ2 ($($k.line))" }
  $k = JImp 'Vouchers' (JJv 'DJ/O03' '20260602' 'DJ3 optional journal, dbjson test data' '<ISOPTIONAL>Yes</ISOPTIONAL>' $false) 'DJ3 optional'; if ($k.c -eq 1) { $made += 'DJ3' } else { $bad += "DJ3 ($($k.line))" }
  $k = JImp 'Vouchers' (JJv 'DJ/X04' '20260701' 'DJ4 journal then cancelled, dbjson test data' '' $false) 'DJ4 to cancel'; if ($k.c -eq 1) { $made += 'DJ4' } else { $bad += "DJ4 ($($k.line))" }
  $cx = $null
  foreach ($form in @('<VOUCHER DATE="01-Jul-2026" TAGNAME="Voucher Number" TAGVALUE="DJ/X04" VCHTYPE="Journal" ACTION="Cancel"><NARRATION>DJ4 journal then cancelled, dbjson test data</NARRATION></VOUCHER>',
                      '<VOUCHER DATE="20260701" TAGNAME="VoucherNumber" TAGVALUE="DJ/X04" VCHTYPE="Journal" ACTION="Cancel"></VOUCHER>')) {
    $cx = JImp 'Vouchers' $form 'DJ4 cancel'
    if (($cx.c + $cx.a) -ge 1 -or "$($cx.line)" -eq '') { break }
  }
  $chk = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DjChk</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DjChk" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>VOUCHERNUMBER, ISCANCELLED, ISOPTIONAL, DATE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'dbjson check' 120
  $nAll = JVchCount $chk
  $canc = [regex]::Matches("$chk", '(?s)<VOUCHER[ >].*?</VOUCHER>') | Where-Object { $_.Value -match '<ISCANCELLED[^>]*>Yes' } | ForEach-Object { [regex]::Match($_.Value, '<VOUCHERNUMBER[^>]*>([^<]*)<').Groups[1].Value }
  $opt = [regex]::Matches("$chk", '(?s)<VOUCHER[ >].*?</VOUCHER>') | Where-Object { $_.Value -match '<ISOPTIONAL[^>]*>Yes' } | ForEach-Object { [regex]::Match($_.Value, '<VOUCHERNUMBER[^>]*>([^<]*)<').Groups[1].Value }
  $dates = @([regex]::Matches("$chk", '<DATE[^>]*>(\d{8})<') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  Info "dbjson: entries in Tally: $nAll; cancelled: $(@($canc) -join ', '); optional: $(@($opt) -join ', '); dates: $($dates -join ' ')"
  $script:djFrom = if ($dates.Count) { $dates[0] } else { '20260401' }; $script:djTo = if ($dates.Count) { $dates[-1] } else { '20270331' }
  JRes $J1 $(if ($made.Count -ge 70 -and $nAll -ge 70) { 'PASS' } else { 'HARNESS' }) ("{0} entries made by XML ({1} in Tally, {2} to {3}); cancelled: {4}; optional: {5}; refused: {6}" -f $made.Count, $nAll, $script:djFrom, $script:djTo, (@($canc) -join ', '), (@($opt) -join ', '), $(if ($bad.Count) { $bad -join ' | ' } else { 'none' }))
} catch { Write-Host "dbjson data: $_"; JRes $J1 'HARNESS' "the test data step stopped: $_" }

# ---------------------------------------------------------------- 2. Tally's own screens
$fromD = '1-4-2026'; $toD = '31-3-2027'
$script:uiFiles = @()
function JNewFiles([datetime]$since) {
  $roots = @($dir, $data1, "$env:USERPROFILE\Documents", "$env:PUBLIC\Documents", $env:USERPROFILE, 'C:\TallyPrime', 'C:\', $fc) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
  $f = @()
  foreach ($r in $roots) {
    $depth = if ($r -eq 'C:\' -or $r -eq $env:USERPROFILE) { 1 } else { 3 }
    $f += @(Get-ChildItem $r -File -Recurse -Depth $depth -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since -and $_.Extension -match '^\.(xml|json|txt|xls|xlsx)$' -and $_.FullName -notmatch '\\(spike-results|bridge-dist|_work)\\' -and $_.Name -notmatch '^tally\.ini$' })
  }
  return , @($f | Sort-Object FullName -Unique)
}
# the export screen: Alt+E, the first choice (the current report), then the configuration and the format; the format list's
# words are kept (which JSON forms Tally offers). $pick: words typed in the format list, $down: Down keys after typing
function JExportUi([string]$tag, [string]$pick, [int]$down = 0) {
  $t0 = (Get-Date).AddSeconds(-2)
  $null = TK '%e' 2.5 "$tag-alt-e"
  $s = TdsScreen "$tag-export-menu"
  if ($s -match 'Current|Others|Export') { $null = TK '{ENTER}' 2.5 "$tag-current" }
  $s = TdsScreen "$tag-export-screen"
  # the configuration (C) when the screen has it; the format field is found by Enter until the format list shows
  $null = TK 'c' 2 "$tag-configure"
  $list = ''
  for ($i = 0; $i -lt 12; $i++) {
    $s = TdsScreen "$tag-field$i"
    if ($s -match 'Data Interchange|Spreadsheet|Web-Publishing|\(Image\)|List of (File )?Formats') { $list = $s; break }
    $null = TK '{ENTER}' 1.5 ''
  }
  if (-not $list) { TdsSay "$tag : the format list was not seen"; $null = TK '{ESC}' 1.5 ''; $null = TK '{ESC}' 1.5 ''; return $null }
  $script:djFormats = $list
  Info "dbjson ui ${tag}: the format list as Tally shows it: $list"
  $null = TK (SK $pick) 1.5 "$tag-typed"
  for ($d = 0; $d -lt $down; $d++) { $null = TK '{DOWN}' 1 '' }
  $null = TK '{ENTER}' 2 "$tag-format-chosen"
  # the rest of the configuration accepted as it is; then the export itself (E: Send / Export, else Ctrl+A)
  $null = TK '^a' 2.5 "$tag-config-accepted"
  $s = TdsScreen "$tag-before-send"
  if ($s -match 'Yes or No|Accept') { $null = TK 'y' 2 "$tag-yes" }
  $null = TK 'e' 4 "$tag-send"
  $s = TdsScreen "$tag-after-send"
  if ($s -match 'Yes or No|Accept|Export\?') { $null = TK 'y' 4 "$tag-yes2" }
  if ($s -match 'Export') { $null = TK '^a' 4 "$tag-send-ctrl-a" }
  Start-Sleep 8
  $s = TdsScreen "$tag-done"
  $new = JNewFiles $t0
  Info "dbjson ui ${tag}: files written since the export began: $(($new | ForEach-Object { "$($_.FullName) ($($_.Length) bytes)" }) -join '; ')"
  $kept = @()
  foreach ($f in $new) {
    $dst = "ui-$tag-$($f.Name)"; Copy-Item $f.FullName (Join-Path $cap $dst) -Force
    $b = [IO.File]::ReadAllBytes($f.FullName); $kept += "$dst ($($b.Length) bytes, $(JEnc $b))"
    $script:uiFiles += $f.FullName
  }
  # back to the report (the export screen closes itself; an Esc too many is caught by the next Gateway)
  for ($i = 0; $i -lt 2; $i++) { $s = TdsScreen "$tag-back$i"; if ($s -match 'Day Book|List of Accounts') { break }; $null = TK '{ESC}' 1.5 '' }
  return , $kept
}
function JOpenReport([string]$goto, [string]$words, [bool]$period) {
  $null = TdsGateway "before $goto"
  $null = TK '%g' 2 "goto-$($goto -replace ' ', '')"
  $null = TK (SK $goto) 2 ''
  $null = TK '{ENTER}' 3 "open-$($goto -replace ' ', '')" $words 15
  if ($period) {
    $null = TK '%{F2}' 2 'period' 'Period|From|To' 8
    $null = TK ($fromD + '{ENTER}') 1.5 'period-from'
    $null = TK ($toD + '{ENTER}') 3 'period-to'
    $s = TdsScreen 'daybook-period'
    Info "dbjson ui: the Day Book after Alt+F2 ($fromD to $toD): $(if ($s.Length -gt 400) { $s.Substring(0, 400) } else { $s })"
  }
}
$uiDb = @{}; $uiMs = @()
try {
  Say '---- dbjson: the Day Book exported by the screens'
  JOpenReport 'Day Book' 'Day Book' $true
  $uiDb['xml'] = JExportUi 'daybook-xml' 'XML'
  JOpenReport 'Day Book' 'Day Book' $true
  $uiDb['json'] = JExportUi 'daybook-json' 'JSON'
  # a second JSON form when the list offers two (e.g. "JSON (Data Interchange)" beside a plain JSON)
  if (([regex]::Matches("$script:djFormats", 'JSON')).Count -ge 2) {
    JOpenReport 'Day Book' 'Day Book' $true
    $uiDb['json2'] = JExportUi 'daybook-json2' 'JSON' 1
  }
  $xOk = @($uiDb['xml']).Count -gt 0; $jOk = @($uiDb['json']).Count -gt 0
  JRes $J2 $(if ($xOk -and $jOk) { 'PASS' } else { 'HARNESS' }) ("XML: {0}; JSON: {1}; second JSON: {2}; the format list: {3}" -f $(if ($xOk) { $uiDb['xml'] -join ', ' } else { 'no file found' }), $(if ($jOk) { $uiDb['json'] -join ', ' } else { 'no file found' }), $(if ($uiDb['json2']) { $uiDb['json2'] -join ', ' } else { 'not offered / none' }), $script:djFormats)
  Say '---- dbjson: List of Accounts exported by the screens'
  JOpenReport 'List of Accounts' 'List of Accounts|Accounts' $false
  $uiMs = JExportUi 'masters-json' 'JSON'
  JRes $J3 $(if (@($uiMs).Count) { 'PASS' } else { 'HARNESS' }) $(if (@($uiMs).Count) { $uiMs -join ', ' } else { 'no file found (see the tds-* screens)' })
} catch { Write-Host "dbjson ui: $_"; JRes $J2 'HARNESS' "the screens step stopped: $_"; JRes $J3 'HARNESS' "the screens step stopped: $_" }

# ---------------------------------------------------------------- 3. the HTTP port
try {
  Say '---- dbjson: the HTTP port'
  $null = TdsGateway 'before the HTTP exports'
  $sv = '<SVCURRENTCOMPANY>' + (JE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE>'
  $hx = @{}
  foreach ($fm in @(@('xml', '$$SysName:XML'), @('json', '$$SysName:JSON'), @('jsonex', '$$SysName:JSONEx'))) {
    $t = JPost "http-daybook-$($fm[0]).$(if ($fm[0] -eq 'xml') { 'xml' } else { 'json' })" ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES>' + $sv + '<EXPLODEFLAG>Yes</EXPLODEFLAG><SVEXPORTFORMAT>' + $fm[1] + '</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
    $hx["db-$($fm[0])"] = "$(JVchCount $t) XML vouchers / $(JJsonCount $t) JSON vouchertypename keys"
    $t = JPost "http-masters-$($fm[0]).$(if ($fm[0] -eq 'xml') { 'xml' } else { 'json' })" ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (JE $co1) + '</SVCURRENTCOMPANY><ACCOUNTTYPE>All Masters</ACCOUNTTYPE><SVEXPORTFORMAT>' + $fm[1] + '</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
    $hx["ms-$($fm[0])"] = "$("$t".Length) characters"
  }
  # the JSON request form (TallyPrime 7.0+): headers name the request, the body carries the variables
  $i = 0
  foreach ($id in @('Day Book', 'DayBook')) {
    foreach ($fv in @('jsonex', '$$SysName:JSONEx', 'json')) {
      $i++
      $body = '{"static_variables":[{"name":"svExportFormat","value":"' + $fv + '"},{"name":"svCurrentCompany","value":"' + $co1 + '"},{"name":"svFromDate","value":"20260401"},{"name":"svToDate","value":"20270331"},{"name":"explodeflag","value":"Yes"}]}'
      $t = JPost "http-jsonreq-daybook-$i.json" $body 'application/json' @{ version = '1'; tallyrequest = 'Export'; type = 'Data'; id = $id; detailed = 'Yes' }
      Info "dbjson http jsonreq-daybook-$i (id '$id', svExportFormat '$fv'): $(JJsonCount $t) vouchertypename keys"
      $hx["jsonreq-$i"] = "id=$id fmt=$fv $(JJsonCount $t)"
    }
  }
  $body = '{"static_variables":[{"name":"svExportFormat","value":"jsonex"},{"name":"svCurrentCompany","value":"' + $co1 + '"},{"name":"accounttype","value":"All Masters"}]}'
  $null = JPost 'http-jsonreq-masters.json' $body 'application/json' @{ version = '1'; tallyrequest = 'Export'; type = 'Data'; id = 'List of Accounts' }
  # every stored field of every entry (the bridge's view), as XML and as JSONEx: the reference for the field comparison
  $fl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*, ALLLEDGERENTRIES.RATEDETAILS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.*, LEDGERENTRIES.*, LEDGERENTRIES.BILLALLOCATIONS.*, ALLINVENTORYENTRIES.*, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.*, ALLINVENTORYENTRIES.BATCHALLOCATIONS.*'
  foreach ($fm in @(@('xml', '$$SysName:XML'), @('jsonex', '$$SysName:JSONEx'))) {
    $t = JPost "http-vouchers-$($fm[0]).$(if ($fm[0] -eq 'xml') { 'xml' } else { 'json' })" ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DjAll</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>' + $fm[1] + '</SVEXPORTFORMAT>' + $sv + '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DjAll" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fl + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
    $hx["vch-$($fm[0])"] = "$(JVchCount $t) / $(JJsonCount $t)"
  }
  $ok = ($hx['db-xml'] -notmatch '^0 ') -or ($hx['vch-xml'] -notmatch '^0 ')
  JRes $J4 $(if ($ok) { 'PASS' } else { 'HARNESS' }) (($hx.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name): $($_.Value)" }) -join '; ')
} catch { Write-Host "dbjson http: $_"; JRes $J4 'HARNESS' "the HTTP step stopped: $_" }

$all = @(Get-ChildItem $cap -File -ErrorAction SilentlyContinue)
JRes $J5 $(if ($all.Count) { 'PASS' } else { 'HARNESS' }) (($all | ForEach-Object { "$($_.Name) ($($_.Length) bytes)" }) -join ', ')
$script:tdsLog | Set-Content (Join-Path $out 'dbjson-screens.log') -Encoding UTF8
