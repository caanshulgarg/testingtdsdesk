# Item 5 of the owner's list of 08-Oct-2026 (moved here from tally-real: the fast request's proof has that queue first): the
# add-on's own share of a save on a large company, on each release. Dot-sourced by flowv.ps1 in mode "big" after c1-c2
# (Tally started with the ref's FinComRecorder.tdl, the company open). MEASUREMENT ONLY.
#   1. the company made large by XML: slow232's generator (tally-real-spike .github/tally-spike/slow232.ps1, copied below:
#      3,000 parties and expenses, 3,000 items, sales / receipts / journals on the 1st, 2nd and 31st of Apr-Sep 2026, as
#      Educational mode takes), $env:BIG_VCH entries (default 100,000), in imports of 1,000 (an import fires no Form Accept:
#      the add-on writes nothing for them)
#   2. 5 saves with the add-on: Day Book of 1-4-2026, the last entry, Alt+2, Ctrl+A; timed from Ctrl+A to the add-on's full
#      line in the user's recorder file (the method of tally-real's P10)
#   3. Tally started again with a stamp-only TDL (one line right after Tally's own Form Accept, nothing else) and 5 saves
#      timed from Ctrl+A to the stamp line: Tally's own save, by the same method. The add-on's share: the difference
Say '---- big: the add-on''s own share of a save on a large company'
function S2Esc([string]$s) { [Security.SecurityElement]::Escape($s) }
function S2Led($name, $parent, $extra = '') { '<LEDGER NAME="' + (S2Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (S2Esc $name) + '</NAME></NAME.LIST><PARENT>' + (S2Esc $parent) + '</PARENT>' + $extra + '</LEDGER>' }
function S2Item($name) { '<STOCKITEM NAME="' + (S2Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (S2Esc $name) + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>' }
# the push-design large company (data.ps1 on tally-versions: HeavyDates, HeavyMasters, HeavyVoucher, plain forms)
function S2Dates { $d = @(); $m = [DateTime]::new(2026, 4, 1); while ($m -lt [DateTime]::new(2026, 10, 1)) { $d += $m.ToString('yyyyMM') + '01'; $d += $m.ToString('yyyyMM') + '02'; if ([DateTime]::DaysInMonth($m.Year, $m.Month) -eq 31) { $d += $m.ToString('yyyyMM') + '31' }; $m = $m.AddMonths(1) }; return $d }
function S2Masters {
  $m = @('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
  $m += S2Led 'Sales' 'Sales Accounts'; $m += S2Led 'Output CGST' 'Duties & Taxes'; $m += S2Led 'Output SGST' 'Duties & Taxes'
  $m += S2Led 'HDFC Bank' 'Bank Accounts'; $m += S2Led 'Spike Income' 'Indirect Incomes'; $m += S2Led 'Spike Party' 'Sundry Debtors'
  for ($i = 1; $i -le 2700; $i++) { $m += S2Led ('HParty {0:d5}' -f $i) 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>' }
  for ($i = 1; $i -le 300; $i++) { $m += S2Led ('HExpense {0:d4}' -f $i) 'Indirect Expenses' }
  for ($i = 1; $i -le 3000; $i++) { $m += S2Item ('HItem {0:d5}' -f $i) }
  return $m
}
function S2Sales($date, $no, $party, [string[]]$items, $narr) {
  $sub = 200 * $items.Count; $tax = [math]::Round($sub * 0.09, 2); $tot = $sub + 2 * $tax; $f = '{0:0.00}'
  $x = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>'
  $x += '<PARTYLEDGERNAME>' + (S2Esc $party) + '</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>' + (S2Esc $narr) + '</NARRATION>'
  $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-' + ($f -f $tot) + '</AMOUNT>'
  $x += '<BILLALLOCATIONS.LIST><NAME>' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-' + ($f -f $tot) + '</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
  foreach ($t in 'Output CGST', 'Output SGST') { $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f $tax) + '</AMOUNT></LEDGERENTRIES.LIST>' }
  foreach ($it in $items) { $x += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + (S2Esc $it) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' }
  $x + '</VOUCHER>'
}
function S2Receipt($date, $no, $party, $amt, $narr) {
  $f = '{0:0.00}'
  '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + (S2Esc $narr) + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ($f -f $amt) + '</AMOUNT><BILLALLOCATIONS.LIST><NAME>ADV-' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>' + ($f -f $amt) + '</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ($f -f $amt) + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
function S2Journal($date, $no, $exp, $narr, $amt = 75) {
  '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + (S2Esc $narr) + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $exp) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
function S2Voucher($k, $dates) {
  $date = $dates[$k % $dates.Count]; $party = 'HParty {0:d5}' -f (($k % 2700) + 1)
  switch ($k % 5) {
    { $_ -in 0, 1 } { $its = @(); for ($j = 0; $j -lt 3; $j++) { $its += ('HItem {0:d5}' -f ((($k * 3 + $j) % 3000) + 1)) }; return S2Sales $date ('HS-{0:d6}' -f $k) $party $its "heavy sales $k" }
    { $_ -in 2, 3 } { return S2Receipt $date ('HR-{0:d6}' -f $k) $party 500 "heavy receipt $k" }
    default { return S2Journal $date ('HJ-{0:d6}' -f $k) ('HExpense {0:d4}' -f (($k % 300) + 1)) "heavy journal $k" }
  }
}
# one XML import of many objects into a company, with a long timeout; created / errors counted
function BigImp($report, [string[]]$objs, $label) {
  $body = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (S2Esc $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + ($objs -join '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 900).Content } catch { $c = "failed: $($_.Exception.Message)" }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  $cr = [int]('0' + [regex]::Match("$c", '<CREATED>(\d+)</CREATED>').Groups[1].Value)
  if (-not $cr) { Write-Host "[big import] ${label}: $(("$c" -replace '\s+', ' ').Substring(0, [Math]::Min(300, "$c".Length)))" }
  return $cr
}
$bigN = if ($env:BIG_VCH) { [int]$env:BIG_VCH } else { 100000 }
$t0 = Get-Date
$m = S2Masters; $mm = 0
for ($i = 0; $i -lt $m.Count; $i += 1000) { $mm += BigImp 'All Masters' $m[$i..([math]::Min($i + 999, $m.Count - 1))] "masters $i" }
$dates = S2Dates; $made = 0
for ($k = 0; $k -lt $bigN; $k += 1000) {
  if (((Get-Date) - $t0).TotalMinutes -gt 60) { Say "big: the import stopped at its time budget (60 min) after $made entries"; break }
  $batch = @(); for ($j = $k; $j -lt [math]::Min($k + 1000, $bigN); $j++) { $batch += S2Voucher $j $dates }
  $made += BigImp 'Vouchers' $batch "entries $k"
}
Info ("big: {0} masters and {1} entries made by XML in {2:0.0} min" -f $mm, $made, ((Get-Date) - $t0).TotalMinutes)
# payroll for 200 employees (the owner's ask, 08-Oct-2026: the heavy company and payroll 200): push-design data.ps1's
# form 5 (the pay heads as ledger lines allocated to each employee, the payable credited), alone on 31-10-2026
$pm = '<COMPANY NAME="' + (S2Esc $co1) + '" ACTION="Alter"><NAME>' + (S2Esc $co1) + '</NAME><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY>'
$null = BigImp 'All Masters' @($pm) 'big cost centres on'
$pm = @('<COSTCENTRE NAME="Big Staff" ACTION="Create"><NAME.LIST><NAME>Big Staff</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>')
for ($i = 1; $i -le 200; $i++) { $pm += '<COSTCENTRE NAME="Big Emp ' + $i + '" ACTION="Create"><NAME.LIST><NAME>Big Emp ' + $i + '</NAME></NAME.LIST><PARENT>Big Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20260401</DATEOFJOIN></COSTCENTRE>' }
foreach ($ph in 'Big Basic', 'Big HRA') { $pm += S2Led $ph 'Indirect Expenses' '<PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><FORPAYROLL>Yes</FORPAYROLL>' }
$pm += S2Led 'Big Salary Payable' 'Current Liabilities' '<PAYTYPE>Not Applicable</PAYTYPE>'
$pmc = BigImp 'All Masters' $pm 'big payroll masters'
$px = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261031</DATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>BIG-PR200</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>big payroll 200</NARRATION>'
foreach ($ph in @(@('Big Basic', 1000), @('Big HRA', 500))) {
  $px += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $ph[0] + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ('{0:0.00}' -f ($ph[1] * 200)) + '</AMOUNT><CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>'
  for ($i = 1; $i -le 200; $i++) { $px += '<COSTCENTREALLOCATIONS.LIST><NAME>Big Emp ' + $i + '</NAME><AMOUNT>-' + ('{0:0.00}' -f $ph[1]) + '</AMOUNT></COSTCENTREALLOCATIONS.LIST>' }
  $px += '</CATEGORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>'
}
$px += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Big Salary Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>300000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
$prc = BigImp 'Vouchers' @($px) 'big payroll 200'
Info ("big payroll 200: {0} masters, {1} entry (31-10-2026)" -f $pmc, $prc)

$recAll = { @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' }) }
function BigSave($label, $stampFile, $day = '1-4-2026') {
  KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 6; KeysTo '{F2}' 3; KeysTo "$day{ENTER}" 8 "big-$label-daybook"
  KeysTo '{END}' 3; KeysTo '%2' 6 "big-$label-dup"
  $c0 = if ($stampFile) { @(Get-Content $stampFile -Encoding Unicode -ErrorAction SilentlyContinue).Count } else { @(& $recAll).Count }
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { return -1 }
  [W32V]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W32V]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500
  $sw = [Diagnostics.Stopwatch]::StartNew(); [System.Windows.Forms.SendKeys]::SendWait('^a'); $ms = -1
  while ($sw.Elapsed.TotalSeconds -lt 60) {
    if ($stampFile) { if (@(Get-Content $stampFile -Encoding Unicode -ErrorAction SilentlyContinue).Count -gt $c0) { $ms = [int]$sw.Elapsed.TotalMilliseconds; break } }
    elseif (@(& $recAll | Select-Object -Skip $c0 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -like '*|end=1|t1=*' }).Count) { $ms = [int]$sw.Elapsed.TotalMilliseconds; break }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep 2; Shot "big-$label-saved"; KeysTo '{ESC}' 2
  return $ms
}
function BigWarmPayroll($label) {
  KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 6; KeysTo '{F2}' 3; KeysTo '31-10-2026{ENTER}' 8 "big-$label-daybook"
  KeysTo '{END}' 3; KeysTo '%2' 6 "big-$label-dup"; KeysTo '^a' 5 "big-$label-answer"; KeysTo '^a' 8 "big-$label-saved"; KeysTo '{ESC}' 2   # one Esc: the Day Book closed (run 37795537503: a second Esc at the Gateway quit Tally, and the restarted Tally stopped at Activate License)
}
$tAdd = @(); for ($i = 1; $i -le 5; $i++) { $tAdd += BigSave "addon$i" '' }
$tAddP = @(); if ($prc) { BigWarmPayroll 'addon-pr-warm'; for ($i = 1; $i -le 5; $i++) { $tAddP += BigSave "addon-pr$i" '' '31-10-2026' } }
$stampFile = "$fc\big-stamp.txt"; Remove-Item $stampFile -Force -ErrorAction SilentlyContinue
$stampTdl = "$fc\BigStamp.tdl"
Set-Content $stampTdl -Encoding ASCII -Value @(
  ';; BigStamp.tdl - MEASUREMENT ONLY (tally-versions mode big): one line right after Tally''s own Form Accept',
  '[#Form: Voucher]', '    On : Form Accept : Yes : Form Accept', '    On : Form Accept : Yes : Call : BigStamp', '',
  '[Function: BigStamp]', ('    01 : OPEN FILE : "' + $stampFile + '" : Text : Write : Unicode'), '    02 : IF : NOT $$LastResult',
  '    03 :    RETURN', '    04 : END IF', '    05 : WRITE FILE LINE : "d"', '    06 : CLOSE TARGET FILE')
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
Write-TallyIni $stampTdl $folder.Name
$t2 = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t2.Id
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 15 'big-stamp-started'
$tStamp = @(); for ($i = 1; $i -le 5; $i++) { $tStamp += BigSave "stamp$i" $stampFile }
$tStampP = @(); if ($prc) { for ($i = 1; $i -le 5; $i++) { $tStampP += BigSave "stamp-pr$i" $stampFile '31-10-2026' } }
$med = { param($a) $s = @($a | Where-Object { $_ -ge 0 } | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { -1 } }
$mA = & $med $tAdd; $mS = & $med $tStamp
$state = if ($made -lt $bigN -or $mA -lt 0 -or $mS -lt 0) { 'HARNESS' } else { 'MEASURE' }
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} big: {1} entries; Ctrl+A to a new line in a file: with the add-on (its full line) {2} ms, median {3}; without it (a stamp-only TDL right after Tally's own Form Accept) {4} ms, median {5}; the add-on's own share: {6} ms" -f `
    $state, $made, ($tAdd -join ', '), $mA, ($tStamp -join ', '), $mS, $(if ($mA -ge 0 -and $mS -ge 0) { $mA - $mS } else { '-' }))
# payroll 200 (each copy saved with every employee; the add-on's full line in parts)
$mAP = & $med $tAddP; $mSP = & $med $tStampP
$stP = if (-not $prc -or $mAP -lt 0 -or $mSP -lt 0) { 'HARNESS' } else { 'MEASURE' }
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} big payroll 200: {1} entries; Ctrl+A to a new line in a file: with the add-on (its full line) {2} ms, median {3}; without it (a stamp-only TDL right after Tally's own Form Accept) {4} ms, median {5}; the add-on's own share: {6} ms" -f `
    $stP, $made, ($tAddP -join ', '), $mAP, ($tStampP -join ', '), $mSP, $(if ($mAP -ge 0 -and $mSP -ge 0) { $mAP - $mSP } else { '-' }))
