# Mode paym (bridge 2.4.4, MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally). Dot-sourced by
# flowv.ps1 after c2; no bridge is installed. The 2.4.4 requests exactly as the ref's source builds them (bridge-dist\ledreq,
# written by a go test at the ref: employeeChunkRequest, ledgerChunkRequest with the pay-head fields, ledgerChangesRequest,
# ledgerByNameRequest; requests/entry-object.xml: voucherObjectRequest):
#   p1 payroll made by XML: payroll on, eight pay heads (PAYTYPE, PAYSTATTYPE, ITCOMPONENT), an employee group, 2,000
#      employees (PAN, date of joining, designation), 20 cost centres that are not payroll's, a payroll entry of 500
#      employees (Tally's PaySlip form)
#   p2 the ref's FinComLedgers and FinComLedgerByName give each pay head's PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL
#   p3 FinComEmployees, chunked as the bridge reads it (2,000 MasterIDs a request up to the company's highest master number,
#      then the open end), finds every cost centre Tally's own CostCentre collection lists, the payroll ones marked so
#   p4 the 500-employee payroll entry: the ref's FinComVoucherObject, asked 5 times: every answer under 3 s (the owner's
#      decision of 12-Oct-2026), Tally responding after each
#   p5 times at 20,000 ledgers with the 2,000 employees: every FinComLedgers chunk (2.4.4 fields) beside the same chunk with
#      2.4.3's fields, FinComLedgerChanges in every window of 200 AlterIDs, FinComLedgerByName, FinComEmployees (every
#      chunk); after each the company list timed and Tally's window asked whether it responds. PASS when every one is under
#      2 s, Tally responds after each, and no request fails
# MEASURE lines carry the numbers (summary).
$P1 = 'p1 payroll made by XML (pay heads, 2,000 employees, 20 other cost centres, a payroll of 500)'
$P2 = 'p2 the ledger requests give the pay-head fields'
$P3 = 'p3 FinComEmployees, chunked, finds every cost centre, the payroll ones marked'
$P4 = 'p4 the 500-employee payroll entry (FinComVoucherObject) under 3 s, Tally responding'
$P5 = 'p5 times at 20,000 ledgers and 2,000 employees (every 2.4.4 master request under 2 s, Tally responding)'
$pDone = @{}
function PRes($c, $st, $ev) { if (-not $pDone[$c]) { Result $c $st $ev; $pDone[$c] = $true } }
function XSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function LE([string]$s) { [Security.SecurityElement]::Escape($s) }
function TPost([string]$x, [int]$sec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content; $ok = $true }
  catch { $c = "failed: $($_.Exception.Message)"; $ok = $false }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ok = $ok; ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
function XImp([string]$report, [string]$msg, [string]$label, [int]$tmo = 600) {
  $r = TPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $tmo
  $m = [regex]::Match($r.body, '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>')
  $k = [pscustomobject]@{ c = [int]('0' + $m.Groups[1].Value); a = [int]('0' + $m.Groups[2].Value); e = [int]('0' + $m.Groups[3].Value); ms = $r.ms
    line = (([regex]::Matches($r.body, '<LINEERROR>([^<]*)</LINEERROR>') | Select-Object -First 3 | ForEach-Object { $_.Groups[1].Value }) -join ' | ') }
  Write-Host ("[paym] {0}: created {1}, altered {2}, errors {3}, {4} ms{5}" -f $label, $k.c, $k.a, $k.e, $r.ms, $(if ($k.line) { "; Tally said: $($k.line)" } else { '' }))
  return $k
}
$lightX = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PMLight</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PMLight" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function AltM {
  $r = TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PMCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PMCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ALTMSTID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  return [int64]('0' + [regex]::Match($r.body, '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value)
}
# the ref's requests
$lq = Join-Path $env:BRIDGE_DIST 'ledreq'
$need = 'ledlist-chunk.xml', 'ledlist-tail.xml', 'ledlist-chunk-243.xml', 'ledchanges.xml', 'ledbyname.xml', 'employees-chunk.xml', 'employees-tail.xml'
$miss = @($need | Where-Object { -not (Test-Path (Join-Path $lq $_)) })
$tmplF = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
if ($miss.Count -or -not (Test-Path $tmplF)) { foreach ($c in $P1, $P2, $P3, $P4, $P5) { PRes $c 'HARNESS' "the ref's requests are not in bridge-dist: $($miss -join ', ') $(if (-not (Test-Path $tmplF)) { 'requests\entry-object.xml' })" }; return }
$RQ = @{}; foreach ($n in $need) { $RQ[$n] = (Get-Content (Join-Path $lq $n) -Raw).Trim() }
Info "paym: the ref's requests from $lq ($(Get-Content (Join-Path $lq 'SOURCE.txt') -TotalCount 1 -ErrorAction SilentlyContinue))"
function Req([string]$tpl, [int64]$a, [int64]$u) { $tpl.Replace('@@CO@@', (LE $co1)).Replace('111111', "$a").Replace('222222', "$u") }
function ByName([string]$name) { $RQ['ledbyname.xml'].Replace('@@CO@@', (LE $co1)).Replace('@@NAME@@', (LE $name)) }
$CAT = 'Primary Cost Category'; $GRP = 'PM Staff'; $PAY = 'PM Salary Payable'
$PH = [ordered]@{
  basic = @('PM Basic', 'Indirect Expenses', 'Earnings for Employees', '', 'Basic Salary', 'Yes')
  hra = @('PM HRA', 'Indirect Expenses', 'Earnings for Employees', '', 'House Rent Allowance', 'Yes')
  spl = @('PM Special Allowance', 'Indirect Expenses', 'Earnings for Employees', '', '', 'Yes')
  pfe = @('PM PF Employee', 'Current Liabilities', "Employees' Statutory Deductions", 'PF Account (A/c No. 1)', '', 'No')
  esi = @('PM ESI Employee', 'Current Liabilities', "Employees' Statutory Deductions", 'Employee State Insurance', '', 'No')
  pt = @('PM Professional Tax', 'Current Liabilities', "Employees' Statutory Deductions", 'Professional Tax', '', 'No')
  it = @('PM Income Tax', 'Current Liabilities', "Employees' Statutory Deductions", 'Income Tax', '', 'No')
  pfr = @('PM PF Employer', 'Indirect Expenses', "Employer's Statutory Contributions", 'PF Account (A/c No. 1)', '', 'Yes')
}
$NEMP = 2000; $NOTH = 20; $NPAY = 500
try {
  Say '---- paym: payroll by XML'
  $null = XImp 'All Masters' ('<COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><ISPAYROLLON>Yes</ISPAYROLLON><ISPAYROLLSTATON>Yes</ISPAYROLLSTATON><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY>') 'company payroll on'
  $null = XImp 'All Masters' ('<LEDGER NAME="' + $PAY + '" ACTION="Create"><NAME.LIST><NAME>' + $PAY + '</NAME></NAME.LIST><PARENT>Current Liabilities</PARENT></LEDGER>') 'salary payable'
  $phOk = 0
  foreach ($k in $PH.Keys) {
    $h = $PH[$k]
    $x = '<LEDGER NAME="' + $h[0] + '" ACTION="Create"><NAME.LIST><NAME>' + $h[0] + '</NAME></NAME.LIST><PARENT>' + (LE $h[1]) + '</PARENT><PAYTYPE>' + (LE $h[2]) + '</PAYTYPE><FORPAYROLL>Yes</FORPAYROLL><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>' +
      $(if ($h[3]) { '<PAYSTATTYPE>' + (LE $h[3]) + '</PAYSTATTYPE>' }) + $(if ($h[4]) { '<ITCOMPONENT>' + (LE $h[4]) + '</ITCOMPONENT>' }) + '</LEDGER>'
    $r = XImp 'All Masters' $x "pay head $($h[0])"
    if ($r.c -eq 1) { $phOk++ }
  }
  $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $GRP + '" ACTION="Create"><NAME.LIST><NAME>' + $GRP + '</NAME></NAME.LIST><PARENT/><CATEGORY>' + $CAT + '</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>') 'employee group'
  $empOk = 0
  for ($b = 0; $b -lt ($NEMP / 250); $b++) {
    $m = ''
    for ($j = 1; $j -le 250; $j++) {
      $n = $b * 250 + $j; $nm = 'PM Emp {0:d4}' -f $n
      $m += '<COSTCENTRE NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>' + $GRP + '</PARENT><CATEGORY>' + $CAT + '</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20250401</DATEOFJOIN><PANNUMBER>' + ('ABCPM{0:d4}Z' -f $n) + '</PANNUMBER><DESIGNATION>' + @('Accountant', 'Manager', 'Operator')[$n % 3] + '</DESIGNATION></COSTCENTRE>'
    }
    $k = XImp 'All Masters' $m "employees, batch $($b + 1)"; $empOk += $k.c
  }
  $m = ''; for ($n = 1; $n -le $NOTH; $n++) { $nm = 'PM Branch {0:d2}' -f $n; $m += '<COSTCENTRE NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT/><CATEGORY>' + $CAT + '</CATEGORY><FORPAYROLL>No</FORPAYROLL></COSTCENTRE>' }
  $k = XImp 'All Masters' $m 'cost centres not for payroll'; $othOk = $k.c
  # the payroll entry of 500 employees (Tally's PaySlip form, as run 38253610530 made it)
  $earn = @('basic', 'hra', 'spl', 'pfr')
  $ce = ''; $tot = 0.0
  for ($i = 1; $i -le $NPAY; $i++) {
    $rows = @(@('basic', 30000 + $i), @('hra', 12000), @('spl', 8000), @('pfe', 1800), @('esi', 141), @('pt', 200), @('it', 2500))
    $ea = 0.0; $pa = ''; $so = 0
    foreach ($r in $rows) { $so++; $isE = $earn -contains $r[0]; $a = if ($isE) { - [double]$r[1] } else { [double]$r[1] }; $ea += $a
      $pa += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>' + $PH[$r[0]][0] + '</PAYHEADNAME><ISDEEMEDPOSITIVE>' + $(if ($isE) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>' + $so + '</PAYHEADSORTORDER><AMOUNT>' + ('{0:0.00}' -f $a) + '</AMOUNT></PAYHEADALLOCATIONS.LIST>' }
    $tot += $ea
    $ce += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + ('PM Emp {0:d4}' -f $i) + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + $i + '</EMPLOYEESORTORDER><AMOUNT>' + ('{0:0.00}' -f $ea) + '</AMOUNT>' + $pa + '</EMPLOYEEENTRIES.LIST>'
  }
  $px = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>20261031</DATE><EFFECTIVEDATE>20261031</EFFECTIVEDATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>PM-PAY-500</VOUCHERNUMBER><PARTYLEDGERNAME>' + $PAY + '</PARTYLEDGERNAME><PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW><ASPAYSLIP>Yes</ASPAYSLIP><VCHENTRYMODE>Payslip</VCHENTRYMODE><NARRATION>PM-PAY-500 payroll of 500 employees by XML</NARRATION>' +
    '<LEDGERENTRIES.LIST><LEDGERNAME>' + $PAY + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ('{0:0.00}' -f (- $tot)) + '</AMOUNT></LEDGERENTRIES.LIST>' +
    '<CATEGORYENTRY.LIST><CATEGORY>' + $CAT + '</CATEGORY>' + $ce + '</CATEGORYENTRY.LIST></VOUCHER>'
  $k = XImp 'Vouchers' $px 'payroll of 500 employees (PaySlip form)'; $payOk = $k.c
  $vs = Vouchers
  $payMid = "$(@($vs | Where-Object { $_.vno -eq 'PM-PAY-500' -or $_.narr -like 'PM-PAY-500 *' })[0].mid)"
  Info "paym: pay heads $phOk/8, employees $empOk/$NEMP, other cost centres $othOk/$NOTH, payroll of 500 created $payOk (MasterID '$payMid')"
  PRes $P1 $(if ($phOk -eq 8 -and $empOk -eq $NEMP -and $othOk -eq $NOTH -and $payOk -eq 1 -and $payMid) { 'PASS' } else { 'HARNESS' }) ("pay heads {0}/8, employees {1}/{2}, other cost centres {3}/{4}, the payroll of 500 {5} (MasterID {6})" -f $phOk, $empOk, $NEMP, $othOk, $NOTH, $payOk, $payMid)

  Say '---- paym: the ledger requests give the pay-head fields'
  $ch = TPost (Req $RQ['ledlist-tail.xml'] 0 0) 60; XSave 'ledlist-244.xml' $ch.body
  $bn = TPost (ByName 'PM Income Tax'); XSave 'ledbyname-it.xml' $bn.body
  $v = { param($t, $tag) ([regex]::Match($t, "<$tag(?:\s[^>]*)?>([^<]*)</$tag>").Groups[1].Value -replace '&#4;', '' -replace '&apos;', "'").Trim() }
  $blk = { param($t, $name) [regex]::Match($t, '(?s)<LEDGER NAME="' + [regex]::Escape((LE $name)) + '"[^>]*>.*?</LEDGER>').Value }
  $bad = @(); $ev = @()
  foreach ($key in $PH.Keys) {
    $h = $PH[$key]; $b = & $blk $ch.body $h[0]
    $got = "$(& $v $b 'PAYTYPE')|$(& $v $b 'PAYSTATTYPE')|$(& $v $b 'ITCOMPONENT')|$(& $v $b 'FORPAYROLL')"
    $wantS = if ($h[3]) { $h[3] } else { 'Not Applicable' }
    if ((& $v $b 'PAYTYPE') -ne $h[2] -or (& $v $b 'PAYSTATTYPE') -ne $wantS -or ($h[4] -and (& $v $b 'ITCOMPONENT') -ne $h[4]) -or (& $v $b 'FORPAYROLL') -ne 'Yes') { $bad += "$($h[0]): $got" }
    $ev += "$($h[0])=$got"
  }
  $bIt = & $blk $bn.body 'PM Income Tax'
  if ((& $v $bIt 'PAYSTATTYPE') -ne 'Income Tax') { $bad += "FinComLedgerByName PM Income Tax: $(& $v $bIt 'PAYSTATTYPE')" }
  PRes $P2 $(if (-not $ch.ok -or -not $bn.ok) { 'FAIL' } elseif ($bad.Count) { 'FAIL' } else { 'PASS' }) ("{0}{1}" -f ($ev -join '; '), $(if ($bad.Count) { "; wrong: $($bad -join ', ')" } else { '' }))

  Say '---- paym: FinComEmployees, chunked'
  function EmpRead {
    $bound = AltM; $after = [int64]0; $all = ''; $times = @(); $ok = $true
    while ($true) {
      $tail = ($after -ge $bound)
      $r = TPost (Req $(if ($tail) { $RQ['employees-tail.xml'] } else { $RQ['employees-chunk.xml'] }) $after $(if ($tail) { 0 } else { $after + 2000 })) 60
      $times += $r.ms; if (-not $r.ok) { $ok = $false; break }
      $all += $r.body
      if ($tail) { break }; $after += 2000
    }
    return [pscustomobject]@{ body = $all; times = $times; ok = $ok; n = $times.Count }
  }
  $er = EmpRead; XSave 'employees-244.xml' $er.body
  $ccAll = TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PMCc</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PMCc" ISMODIFY="No"><TYPE>CostCentre</TYPE><FETCH>NAME, FORPAYROLL</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 120
  $names = { param($t) @([regex]::Matches($t, '<COSTCENTRE NAME="([^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) }
  $nB = & $names $er.body; $nT = & $names $ccAll.body
  $missE = @($nT | Where-Object { $nB -notcontains $_ })
  $payY = @([regex]::Matches($er.body, '(?s)<COSTCENTRE NAME="(PM Emp \d+)"[^>]*>(?:(?!</COSTCENTRE>).)*<FORPAYROLL[^>]*>Yes<') ).Count
  $othN = @([regex]::Matches($er.body, '(?s)<COSTCENTRE NAME="(PM Branch \d+)"[^>]*>(?:(?!</COSTCENTRE>).)*<FORPAYROLL[^>]*>No<') ).Count
  $e1 = [regex]::Match($er.body, '(?s)<COSTCENTRE NAME="PM Emp 0001"[^>]*>.*?</COSTCENTRE>').Value
  $okE1 = (& $v $e1 'PANNUMBER') -eq 'ABCPM0001Z' -and (& $v $e1 'DATEOFJOIN') -eq '20250401' -and (& $v $e1 'PARENT') -eq $GRP
  # the answer carries no field the request did not name (a personal field never asked)
  $extra = @([regex]::Matches($er.body, '<(DATEOFBIRTH|AADHARNUMBER|BANKACCOUNTNUMBER|IFSCODE|UANNUMBER|GENDER|FATHERNAME|EMAILID|MOBILENUMBER)[ >]') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  Info "paym: FinComEmployees chunks $($er.n) ($(($er.times | ForEach-Object { "$_ ms" }) -join ', ')); cost centres found $($nB.Count), Tally lists $($nT.Count); missed $($missE.Count); payroll employees marked $payY, others marked No $othN"
  PRes $P3 $(if (-not $er.ok) { 'FAIL' } elseif ($missE.Count -eq 0 -and $nT.Count -ge ($NEMP + $NOTH) -and $payY -eq $NEMP -and $othN -eq $NOTH -and $okE1 -and -not $extra.Count) { 'PASS' } else { 'FAIL' }) `
    ("chunks {0}, {1} cost centres of Tally's {2}, none missed: {3}; FORPAYROLL Yes on {4} employees, No on {5} others; PM Emp 0001 PAN/joining/group as made: {6}; fields not asked in the answer: {7}" -f $er.n, $nB.Count, $nT.Count, ($missE.Count -eq 0), $payY, $othN, $okE1, $(if ($extra.Count) { $extra -join ',' } else { 'none' }))

  Say '---- paym: the payroll entry of 500 (FinComVoucherObject)'
  $ox = (Get-Content $tmplF -Raw).Replace('FinCom Spike Co', (LE $co1)).Replace('ID:99999<', "ID:$payMid<")
  $pt = @(); $presp = $true; $plen = 0
  for ($i = 0; $i -lt 5; $i++) {
    $r = TPost $ox 60; $pt += $r.ms; $plen = $r.body.Length
    if ($i -eq 0) { XSave 'obj-PM-PAY-500.xml' $r.body }
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $l = TPost $lightX 10
    if (-not ($r.ok -and $p -and $p.Responding -and $l.ok)) { $presp = $false }
    if ($r.body -notmatch 'PM-PAY-500') { $presp = $false }
  }
  $ps = @($pt | Sort-Object)
  Add-Content -Path $resultsFile -Value ("MEASURE payroll 500 FinComVoucherObject: 5 request(s), worst {0} ms, median {1} ms, {2} characters" -f $ps[-1], $ps[2], $plen) -Encoding UTF8
  PRes $P4 $(if (-not $payMid) { 'HARNESS' } elseif ($presp -and $ps[-1] -lt 3000) { 'PASS' } else { 'FAIL' }) ("MasterID {0}: {1} ms (worst {2} ms, median {3} ms), {4} characters, Tally responding after each: {5}" -f $payMid, ($pt -join '/'), $ps[-1], $ps[2], $plen, $presp)

  Say '---- paym: 20,000 ledgers and the times'
  $have = [int]('0' + [regex]::Match((TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>')).body, '<RESULT[^>]*>\s*(\d+)').Groups[1].Value)
  $i = 0
  while ($have + $i -lt 20000) {
    $objs = @()
    for ($j = 0; $j -lt 1000 -and ($have + $i) -lt 20000; $j++) {
      $i++; $n = 'PM Ledger {0:d5}' -f $i
      $objs += '<LEDGER NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><INCOMETAXNUMBER>AAAPL' + ('{0:d4}' -f ($i % 10000)) + 'K</INCOMETAXNUMBER></LEDGER>'
    }
    $null = TPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + ($objs -join '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 600
  }
  Info "paym: $i ledgers added to the $have there were"
  $rows = @(); $fails = 0
  function Timed([string]$label, [string]$req, [string]$x) {
    $r = TPost $x 30
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $resp = [bool]($p -and $p.Responding)
    $l = TPost $lightX 10
    $script:rows += [pscustomobject]@{ req = $req; span = $label; ms = $r.ms; bytes = $r.body.Length; light = $l.ms; responding = ($resp -and $l.ok); ok = $r.ok }
    if (-not $r.ok) { $script:fails++ }
    Write-Host ("[paym] {0} {1}: {2} ms, {3} bytes; light {4} ms, responding {5}" -f $req, $label, $r.ms, $r.body.Length, $l.ms, ($resp -and $l.ok))
    return $r
  }
  $bound = AltM; $after = [int64]0
  while ($true) {
    $tail = ($after -ge $bound); $u = if ($tail) { 0 } else { $after + 2000 }
    $null = Timed $(if ($tail) { "from $($after + 1)" } else { "$($after + 1)-$u" }) 'FinComLedgers' (Req $(if ($tail) { $RQ['ledlist-tail.xml'] } else { $RQ['ledlist-chunk.xml'] }) $after $u)
    if (-not $tail) { $null = Timed "$($after + 1)-$u" 'FinComLedgers 2.4.3' (Req $RQ['ledlist-chunk-243.xml'] $after $u) }
    $null = Timed $(if ($tail) { "from $($after + 1)" } else { "$($after + 1)-$u" }) 'FinComEmployees' (Req $(if ($tail) { $RQ['employees-tail.xml'] } else { $RQ['employees-chunk.xml'] }) $after $u)
    if ($tail) { break }; $after = $u
  }
  foreach ($n in 'PM Basic', 'PM Income Tax', 'PM Ledger 00007', 'PM Ledger 19999') { $null = Timed $n 'FinComLedgerByName' (ByName $n) }
  $after = [int64]0
  while ($after -lt $bound) { $null = Timed "$($after + 1)-$($after + 200)" 'FinComLedgerChanges' (Req $RQ['ledchanges.xml'] $after ($after + 200)); $after += 200 }
  $rows | Export-Csv (Join-Path $out 'paym-times.csv') -NoTypeInformation
  foreach ($g in ($rows | Group-Object req)) { $s = @($g.Group | Sort-Object ms); Add-Content -Path $resultsFile -Value ("MEASURE 20,000 ledgers {0}: {1} request(s), worst {2} ms, median {3} ms, worst light {4} ms, biggest answer {5} characters" -f $g.Name, $s.Count, $s[-1].ms, $s[[int][math]::Floor(($s.Count - 1) / 2)].ms, (@($g.Group | Sort-Object light))[-1].light, (@($g.Group | Sort-Object bytes))[-1].bytes) -Encoding UTF8 }
  $over = @($rows | Where-Object { $_.req -ne 'FinComLedgers 2.4.3' -and $_.ms -ge 2000 })
  $nr2 = @($rows | Where-Object { -not $_.responding })
  $w = { param($req) $x = @($rows | Where-Object { $_.req -eq $req } | Sort-Object ms); if ($x.Count) { $x[-1].ms } else { -1 } }
  PRes $P5 $(if ($fails -or $over.Count -or $nr2.Count) { 'FAIL' } else { 'PASS' }) ("worst FinComLedgers (2.4.4) {0} ms, the same chunk with 2.4.3's fields {1} ms, FinComEmployees {2} ms, FinComLedgerChanges {3} ms, FinComLedgerByName {4} ms; failed {5}, not responding {6}, a 2.4.4 request over 2 s {7}" -f (& $w 'FinComLedgers'), (& $w 'FinComLedgers 2.4.3'), (& $w 'FinComEmployees'), (& $w 'FinComLedgerChanges'), (& $w 'FinComLedgerByName'), $fails, $nr2.Count, $over.Count)
} catch {
  Write-Host "paym stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in $P1, $P2, $P3, $P4, $P5) { PRes $c 'HARNESS' "the harness stopped: $_" }
}
