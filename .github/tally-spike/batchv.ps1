# Mode batch (bridge 2.4.9 phase 1, "10x faster old-entries import": DESIGN + MEASURE ONLY; TEST DATA ONLY: a throwaway
# company in this runner's own Tally; never the owner's computer; no bridge installed, nothing shipped). Dot-sourced by
# flowv.ps1 after c2, on dblib.ps1 as dbbig. Every candidate request is the harness's, sent here only, one at a time,
# with the 2 s stop (the late answer awaited, nothing else sent) and the window probe beside it (dbbigv.ps1's); the
# owner approves the exact XML before any bridge sends it.
#
# Today (2.4.5-2.4.8) the period fetch reads a day's heads (FinComDayHeads) then every entry by MasterID with
# FinComVoucherObject, ONE entry a request. The candidates ask up to N entries of ONE day in one request (built by the
# ref's own code: batch\zz_fcbatch_req_test.go in the build job, bridge-dist\batchreq):
#   B1  a Voucher collection of that day (FinComDayHeads' own date form: SVFROMDATE = SVTODATE, yyyymmdd TYPE="Date"),
#       FETCH = the fields FinComVoucherObject keeps today, by name; filter $MasterID >= a AND $MasterID <= b, a and b
#       taken from that day's heads (so the range holds exactly the N asked: only that day's entries are looked at)
#   B2  the same with every kept list fetched whole ("LIST.*"); the bridge's strip keeps only the approved fields
#   B3  B1 with the filter $MasterID = m1 OR ... OR $MasterID = mN (any N MasterIDs of that day, not a run of them)
#   B4  B1 with every ledger-line field also under LEDGERENTRIES (7.1 run 40741546645: a collection's ALLLEDGERENTRIES of
#       an item invoice also holds the items' sales ledger; its LEDGERENTRIES are the invoice's own lines); B5 = B3 so
#   (B2 was measured on 7.1 in run 40741546645 only: the same kept fields as B1, 3x the size, slower; dropped)
#   C0  control: B1 with no date (the whole company looked at; FinComByMaster's lesson, proof72 run 40362606548: 3 s at
#       ~30,000 entries) - expected over 2 s, measured to show why the day is in the request
# Steps:
#   1 ZZ BIG TEST, ~30,000 entries (dbm\redate.py DBM_PROFILE=big100: 01-Jun 100, 02-Jul 300, 31-Aug 800, the other
#     background days ~2,215), plus on 31-Aug: ten Sales invoices of 50 items and payroll entries of 100 and 500
#     employees (paymv.ps1's payroll)
#   2 FinComVoucherObject for every entry of the diff windows (raw kept: the reference) and timed
#   3 the sweep, day by day: FinComDayHeads, then B1, B4, B3, B5 with N = 5, 10, 25, 50, 100, 200; 6 windows each spread
#     over the day (the last ends at the 500-employee payroll on 31-Aug); exact set checked; times, window hold, size
#   4 the diff windows (31-Aug: four of 25 from the start, the last 25 with the invoices and payrolls; 01-Aug: the
#     first 25) for B1, B4, B3, B5: raw kept; the job then compares every kept field with FinComVoucherObject's (v8)
#   5 C0 (control)
#   6 ~70,000 more entries (dbm2-vouchers-NN.xml, round robin over the background days: ~1,00,000 in all; 01-Aug then
#     holds ~7,600), then 2, 3 and 5 again
. (Join-Path $PSScriptRoot 'dblib.ps1')
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class BtFrz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res); }
'@
Add-Type -AssemblyName System.IO.Compression.FileSystem
$V1 = 'v1 test data made (~30,000 entries; 50-item invoices and payroll entries of 100 and 500 employees on 31-Aug)'
$V2 = 'v2 one by one: FinComVoucherObject for every entry compared (the reference)'
$V3 = 'v3 the batch forms at ~30,000 entries: exactly the entries asked, every time'
$V4 = 'v4 the largest batch within 2 s (no window hold of 2 s) at ~30,000 entries'
$V5 = 'v5 the batch forms at ~1,00,000 entries: exactly the entries asked, every time'
$V6 = 'v6 the largest batch within 2 s (no window hold of 2 s) at ~1,00,000 entries'
$V7 = 'v7 the control (no date: the whole company looked at) and the rule: one request at a time, 2 s stop, Tally responding'
$vDone = @{}
function VRes($c, $st, $ev) { if (-not $vDone[$c]) { Result $c $st $ev; $vDone[$c] = $true } }
function MLine([string]$s) { Add-Content -Path $resultsFile -Value "MEASURE $s" -Encoding UTF8; Write-Host "MEASURE $s" }
$bt = Join-Path $cap 'batch'; $raw = Join-Path $bt 'raw'; New-Item -ItemType Directory -Force $raw | Out-Null
function RawSave([string]$n, $t) { [IO.File]::WriteAllText((Join-Path $raw $n), "$t", [Text.UTF8Encoding]::new($false)) }
function BtJson([string]$n, $o) { [IO.File]::WriteAllText((Join-Path $bt $n), ($o | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false)) }

# ---- the window probe (dbbigv.ps1's): the longest time Tally's window did not answer WM_NULL within 250 ms
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; beats = 0; err = '' })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null
    while (-not $f.stop) {
      if ($f.on -and $f.h -ne [IntPtr]::Zero) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [BtFrz]::SendMessageTimeout($f.h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $t0 }; $cur = $sw.Elapsed.TotalMilliseconds - $since; if ($cur -gt $f.max) { $f.max = $cur } } else { $since = $null }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
  Info "batch: window probe running $($script:frzOk) (beats $($script:frz.beats))"
} catch { Info "batch: the window probe could not start ($_): blockedMs is -1" }
function TStopW([string]$x, [int]$stopMs = 2000, [int]$maxMs = 60000) {
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.max = 0.0; $script:frz.on = $true
  try { $r = TStop $x $stopMs $maxMs } finally { Start-Sleep -Milliseconds 150; $script:frz.on = $false }
  if ($script:frz.err) { Info "batch: window probe error: $($script:frz.err)"; $script:frz.err = ''; $script:frzOk = $false }
  $r | Add-Member -NotePropertyName blockedMs -NotePropertyValue $(if ($script:frzOk) { [math]::Round($script:frz.max, 0) } else { -1 }) -Force
  return $r
}
$script:hungN = 0
function TS([string]$x, [int]$a = 2000, [int]$b = 60000) { $r = TStopW $x $a $b; if ($r.hung) { $script:hungN++; $null = DbRestart "hung$($script:hungN)" }; return $r }
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
# the MasterIDs of the entries in an answer (each <VOUCHER>'s own; CMPINFO's count is not an entry)
function MidsOf([string]$b) {
  $l = [Collections.Generic.List[int64]]::new()
  foreach ($m in [regex]::Matches((NoInfo $b), '(?s)<VOUCHER[ >].*?</VOUCHER>')) { $v = [regex]::Match($m.Value, '<MASTERID[^>]*>\s*(\d+)'); if ($v.Success) { $l.Add([int64]$v.Groups[1].Value) } }
  return , $l.ToArray()
}

# ---- the requests, as the ref builds them
$bq = Join-Path $env:BRIDGE_DIST 'batchreq'
$RB = @{}
foreach ($f in @(Get-ChildItem $bq -Filter '*.xml' -ErrorAction SilentlyContinue)) { $RB[$f.BaseName] = (Get-Content $f.FullName -Raw).Trim() }
$needRB = 'dayheads', 'object', 'b1-range', 'b4-range', 'b4-list', 'b1-list', 'c0-range'
$missRB = @($needRB | Where-Object { -not $RB[$_] })
if ($missRB.Count) { foreach ($c in $V1, $V2, $V3, $V4, $V5, $V6, $V7) { VRes $c 'HARNESS' "the candidate requests are not in bridge-dist\batchreq: $($missRB -join ', ')" }; return }
Copy-Item (Join-Path $bq '*') $bt -ErrorAction SilentlyContinue   # the exact XML measured, beside the results
Info "batch: requests from $bq ($(Get-Content (Join-Path $bq 'SOURCE.txt') -TotalCount 1 -ErrorAction SilentlyContinue))"
function ObjReq([int64]$mid) { (WithDay $RB['object'] '20991231').Replace('ID:99999', "ID:$mid") }
function HeadsReq([string]$d) { WithDay $RB['dayheads'] $d }
function RangeReq([string]$form, [string]$d, [int64]$a, [int64]$b) {
  $t = switch ($form) { 'B1' { $RB['b1-range'] } 'B2' { $RB['b2-range'] } 'B4' { $RB['b4-range'] } 'C0' { $RB['c0-range'] } }
  return (WithDay $t $d).Replace('111111', "$a").Replace('222222', "$b")
}
function ListReq([string]$d, [int64[]]$mids, [string]$tpl = 'b1-list') { (WithDay $RB[$tpl] $d).Replace('@@MIDS@@', ((@($mids | ForEach-Object { "`$MasterID = $_" })) -join ' OR ')) }
function FormReq([string]$form, [string]$d, [int64[]]$w) { if ($form -eq 'B3') { return ListReq $d $w }; if ($form -eq 'B5') { return ListReq $d $w 'b4-list' }; return RangeReq $form $d $w[0] $w[-1] }
# (B2, every kept list whole, was measured on 7.1 in run 40741546645: the same kept fields as B1, answers 3x the size and
# slower; dropped. B4 / B5 = B1 / B3 with the ledger lines also under LEDGERENTRIES, for item invoices)
$FORMS = 'B1', 'B4', 'B3', 'B5'
$SIZES = 5, 10, 25, 50, 100, 200
$REPS = 6
# the harness's own truth for one day (no time limit; never a bridge request): every entry of that day with its type and
# number, in FinComDayHeads' own date form
function DayTruth([string]$d) {
  $x = (HeadsReq $d).Replace('<FETCH>GUID, MASTERID, ALTERID, DATE</FETCH>', '<FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION</FETCH>').Replace('FinComDayHeads', 'FCBTruth')
  $r = TSetup $x 600
  $l = [Collections.Generic.List[object]]::new()
  foreach ($m in [regex]::Matches((NoInfo $r.body), '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $l.Add([pscustomobject]@{ mid = [int64]('0' + [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value); date = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value
        type = [regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)<').Groups[1].Value; no = [regex]::Match($v, '<VOUCHERNUMBER[^>]*>([^<]*)<').Groups[1].Value
        narr = [regex]::Match($v, '<NARRATION[^>]*>([^<]*)<').Groups[1].Value })
  }
  $bad = @($l | Where-Object { $_.date -ne $d }).Count
  if ($bad) { Info "batch: the truth for $d holds $bad entries of other dates (kept out)" }
  return , @($l | Where-Object { $_.date -eq $d -and $_.mid -gt 0 } | Sort-Object mid)
}
function CountAll {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCBCount</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCBCount" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  return @([regex]::Matches((NoInfo $r.body), '<VOUCHER[ >]')).Count
}
# windows of N consecutive heads of a day, $REPS of them spread from the first to the last (the last ends at the day's end)
function Windows([int64[]]$h, [int]$n) {
  $o = [Collections.Generic.List[object]]::new()
  if ($h.Count -lt $n) { return , $o.ToArray() }
  if ($h.Count -eq $n) { $o.Add([pscustomobject]@{ k = 0; w = $h }); return , $o.ToArray() }
  $seen = @{}
  for ($k = 0; $k -lt $REPS; $k++) {
    $i = [int][math]::Round($k * ($h.Count - $n) / ($REPS - 1))
    if ($seen[$i]) { continue }; $seen[$i] = $true
    $o.Add([pscustomobject]@{ k = $k; w = $h[$i..($i + $n - 1)] })
  }
  return , $o.ToArray()
}
$rows = [Collections.Generic.List[object]]::new()
$script:special = @{}   # MasterID -> what it is (the 50-item invoices, the payrolls)
function Row([string]$phase, [string]$what, [string]$form, [string]$day, [int]$dayN, [int64[]]$asked, $r, [int]$k = -1) {
  $got = if ($r.ok) { MidsOf $r.body } else { @() }
  $as = @{}; foreach ($m in $asked) { $as[$m] = $true }
  $gs = @{}; foreach ($m in $got) { $gs[$m] = $true }
  $missing = @($asked | Where-Object { -not $gs[$_] }).Count; $extra = @($got | Where-Object { -not $as[$_] }).Count
  $sp = @($asked | Where-Object { $script:special.ContainsKey($_) } | ForEach-Object { $script:special[$_] }) -join '+'
  $l = DbLight
  $o = [pscustomobject]@{ phase = $phase; what = $what; form = $form; day = $day; dayN = $dayN; n = $asked.Count; k = $k; a = $(if ($asked.Count) { $asked[0] } else { 0 }); b = $(if ($asked.Count) { $asked[-1] } else { 0 })
    ms = $r.ms; inTime = $r.inTime; overrun = $r.overrun; hung = $r.hung; ok = $r.ok; err = $r.err; chars = "$($r.body)".Length; blockedMs = $r.blockedMs
    got = $got.Count; dup = $got.Count - $gs.Count; missing = $missing; extra = $extra; exact = [bool]($r.ok -and $missing -eq 0 -and $extra -eq 0 -and $got.Count -eq $gs.Count); special = $sp
    lightMs = $l.ms; responding = $l.responding }
  $rows.Add($o)
  Write-Host ("[batch] {0} {1} {2} {3} n={4} k={5}: {6} ms{7}, held {8} ms, {9} chars, got {10} exact {11}{12}" -f $phase, $what, $form, $day, $asked.Count, $k, $r.ms, $(if ($r.overrun) { ' OVER 2 s' } else { '' }), $r.blockedMs, $o.chars, $got.Count, $o.exact, $(if ($sp) { " [$sp]" } else { '' }))
  return $o
}
function Pct($s, [double]$p) { if (-not $s.Count) { return 0 }; return $s[[int][math]::Min($s.Count - 1, [math]::Ceiling($p * $s.Count) - 1)] }
function St($list) {
  $l = @($list); if (-not $l.Count) { return $null }
  $ms = @($l | ForEach-Object { [double]$_.ms } | Sort-Object); $bl = @($l | ForEach-Object { [double]$_.blockedMs } | Sort-Object); $ch = @($l | ForEach-Object { [double]$_.chars } | Sort-Object)
  return [pscustomobject]@{ n = $l.Count; med = Pct $ms 0.5; p95 = Pct $ms 0.95; worst = $ms[-1]; held = $bl[-1]; over = @($l | Where-Object { $_.overrun -or $_.hung }).Count; exact = @($l | Where-Object exact).Count
    chMed = Pct $ch 0.5; chMax = $ch[-1]; ok2 = (@($l | Where-Object { $_.overrun -or $_.hung -or [double]$_.blockedMs -ge 2000 -or -not $_.exact }).Count -eq 0) }
}
function StTxt($s) { if (-not $s) { return 'none' }; '{0} requests: median {1} ms, p95 {2} ms, worst {3} ms, window held worst {4} ms, over 2 s {5}, exact {6}/{0}, size median {7:N0} / max {8:N0} chars' -f $s.n, $s.med, $s.p95, $s.worst, $s.held, $s.over, $s.exact, $s.chMed, $s.chMax }

# ================================================================ 1: the test data
function TM([string]$x) { '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $x + '</TALLYMESSAGE>' }
$P = [ordered]@{}   # phase -> @{ count; days = @{ day -> heads } }
$DAYS1 = '20260601', '20260702', '20260831', '20260801'
$DAYS2 = '20260601', '20260702', '20260831', '20260801', '20260402'
$mk = ''; $n1 = 0; $inv50 = 0; $payOk = 0
try {
  Say '---- batch: ZZ BIG TEST (~30,000 entries)'
  $mk = DbMakeData
  Info "batch: $mk"
  # ten Sales invoices of 50 items on 31-Aug (bigv.ps1's invoice shape, the harness's own names)
  $m = '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>'
  $m += '<LEDGER NAME="BI Sales" ACTION="Create"><NAME.LIST><NAME>BI Sales</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT></LEDGER>'
  foreach ($t in 'BI Output CGST', 'BI Output SGST') { $m += '<LEDGER NAME="' + $t + '" ACTION="Create"><NAME.LIST><NAME>' + $t + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT></LEDGER>' }
  $m += '<LEDGER NAME="BI Party" ACTION="Create"><NAME.LIST><NAME>BI Party</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON></LEDGER>'
  for ($i = 1; $i -le 50; $i++) { $nm = 'BI Item {0:d2}' -f $i; $m += '<STOCKITEM NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>' }
  $null = DbImp 'All Masters' (TM $m) 'batch: 50 items, sales, GST and party ledgers'
  $vx = ''
  for ($j = 1; $j -le 10; $j++) {
    $no = 'BI-50-{0:d2}' -f $j; $f = '{0:0.00}'; $sub = 200 * 50; $tax = [math]::Round($sub * 0.09, 2); $tot = $sub + 2 * $tax
    $x = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>20260831</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>'
    $x += '<PARTYLEDGERNAME>BI Party</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>' + $no + ' invoice of 50 items</NARRATION>'
    $x += '<LEDGERENTRIES.LIST><LEDGERNAME>BI Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-' + ($f -f $tot) + '</AMOUNT>'
    $x += '<BILLALLOCATIONS.LIST><NAME>' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-' + ($f -f $tot) + '</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
    foreach ($t in 'BI Output CGST', 'BI Output SGST') { $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f $tax) + '</AMOUNT></LEDGERENTRIES.LIST>' }
    for ($i = 1; $i -le 50; $i++) { $x += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + ('BI Item {0:d2}' -f $i) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>BI Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' }
    $vx += '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $x + '</VOUCHER></TALLYMESSAGE>'
  }
  $k = DbImp 'Vouchers' $vx 'batch: ten invoices of 50 items on 31-Aug'; $inv50 = $k.c
  # payroll (paymv.ps1's masters and PaySlip entry): 500 employees; entries of 100 and of 500 employees on 31-Aug
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
  $null = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><ISPAYROLLON>Yes</ISPAYROLLON><ISPAYROLLSTATON>Yes</ISPAYROLLSTATON><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY></TALLYMESSAGE>') 'batch: payroll on'
  $m = '<LEDGER NAME="' + $PAY + '" ACTION="Create"><NAME.LIST><NAME>' + $PAY + '</NAME></NAME.LIST><PARENT>Current Liabilities</PARENT></LEDGER>'
  foreach ($key in $PH.Keys) {
    $h = $PH[$key]
    $m += '<LEDGER NAME="' + $h[0] + '" ACTION="Create"><NAME.LIST><NAME>' + $h[0] + '</NAME></NAME.LIST><PARENT>' + (LE $h[1]) + '</PARENT><PAYTYPE>' + (LE $h[2]) + '</PAYTYPE><FORPAYROLL>Yes</FORPAYROLL><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>' +
      $(if ($h[3]) { '<PAYSTATTYPE>' + (LE $h[3]) + '</PAYSTATTYPE>' }) + $(if ($h[4]) { '<ITCOMPONENT>' + (LE $h[4]) + '</ITCOMPONENT>' }) + '</LEDGER>'
  }
  $m += '<COSTCENTRE NAME="' + $GRP + '" ACTION="Create"><NAME.LIST><NAME>' + $GRP + '</NAME></NAME.LIST><PARENT/><CATEGORY>' + $CAT + '</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>'
  $null = DbImp 'All Masters' (TM $m) 'batch: pay heads, salary payable, employee group'
  for ($b = 0; $b -lt 2; $b++) {
    $m = ''
    for ($j = 1; $j -le 250; $j++) {
      $n = $b * 250 + $j; $nm = 'PM Emp {0:d4}' -f $n
      $m += '<COSTCENTRE NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>' + $GRP + '</PARENT><CATEGORY>' + $CAT + '</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20250401</DATEOFJOIN><PANNUMBER>' + ('ABCPM{0:d4}Z' -f $n) + '</PANNUMBER></COSTCENTRE>'
    }
    $null = DbImp 'All Masters' (TM $m) "batch: employees, part $($b + 1)"
  }
  $earn = @('basic', 'hra', 'spl', 'pfr')
  foreach ($np in 100, 500) {
    $ce = ''; $tot = 0.0
    for ($i = 1; $i -le $np; $i++) {
      $rws = @(@('basic', 30000 + $i), @('hra', 12000), @('spl', 8000), @('pfe', 1800), @('esi', 141), @('pt', 200), @('it', 2500))
      $ea = 0.0; $pa = ''; $so = 0
      foreach ($r in $rws) { $so++; $isE = $earn -contains $r[0]; $a = if ($isE) { - [double]$r[1] } else { [double]$r[1] }; $ea += $a
        $pa += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>' + $PH[$r[0]][0] + '</PAYHEADNAME><ISDEEMEDPOSITIVE>' + $(if ($isE) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>' + $so + '</PAYHEADSORTORDER><AMOUNT>' + ('{0:0.00}' -f $a) + '</AMOUNT></PAYHEADALLOCATIONS.LIST>' }
      $tot += $ea
      $ce += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + ('PM Emp {0:d4}' -f $i) + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + $i + '</EMPLOYEESORTORDER><AMOUNT>' + ('{0:0.00}' -f $ea) + '</AMOUNT>' + $pa + '</EMPLOYEEENTRIES.LIST>'
    }
    $px = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>20260831</DATE><EFFECTIVEDATE>20260831</EFFECTIVEDATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>PM-PAY-' + $np + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + $PAY + '</PARTYLEDGERNAME><PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW><ASPAYSLIP>Yes</ASPAYSLIP><VCHENTRYMODE>Payslip</VCHENTRYMODE><NARRATION>PM-PAY-' + $np + ' payroll of ' + $np + ' employees by XML</NARRATION>' +
      '<LEDGERENTRIES.LIST><LEDGERNAME>' + $PAY + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ('{0:0.00}' -f (- $tot)) + '</AMOUNT></LEDGERENTRIES.LIST>' +
      '<CATEGORYENTRY.LIST><CATEGORY>' + $CAT + '</CATEGORY>' + $ce + '</CATEGORYENTRY.LIST></VOUCHER>'
    $k = DbImp 'Vouchers' ('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $px + '</TALLYMESSAGE>') "batch: payroll of $np employees on 31-Aug"; $payOk += $k.c
  }
  $n1 = CountAll
} catch { Info "batch: test data stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }

# ---- one phase: heads, the reference, the sweep, the diff windows, the control
$diffPlan = [Collections.Generic.List[object]]::new()
$objMs = [ordered]@{}
function Phase([string]$ph, [string[]]$days, [bool]$keepRaw) {
  $H = [ordered]@{}
  foreach ($d in $days) {
    $t = DayTruth $d
    $H[$d] = [int64[]]@($t | ForEach-Object { $_.mid })
    # by narration (Tally numbers imported entries itself: run 40741546645 gave the invoices 11453.. and the payrolls 1, 2)
    if ($d -eq '20260831') { foreach ($e in $t) { if ($e.narr -like 'BI-50-*') { $script:special[$e.mid] = 'inv50' } elseif ($e.narr -like 'PM-PAY-100 *') { $script:special[$e.mid] = 'pay100' } elseif ($e.narr -like 'PM-PAY-500 *') { $script:special[$e.mid] = 'pay500' } } }
    Info ("batch {0}: {1} holds {2} entries (MasterIDs {3}..{4})" -f $ph, $d, $H[$d].Count, $(if ($H[$d].Count) { $H[$d][0] } else { '-' }), $(if ($H[$d].Count) { $H[$d][-1] } else { '-' }))
  }
  # the diff windows: 31-Aug four of 25 from the start and the last 25 (the invoices and payrolls); 01-Aug the first 25
  $dw = [Collections.Generic.List[object]]::new()
  $a = $H['20260831']; if ($a.Count -ge 125) { for ($i = 0; $i -lt 4; $i++) { $dw.Add(@('20260831', $a[($i * 25)..($i * 25 + 24)])) }; $dw.Add(@('20260831', $a[($a.Count - 25)..($a.Count - 1)])) }
  $a = $H['20260801']; if ($a.Count -ge 25) { $dw.Add(@('20260801', $a[0..24])) }
  # the reference: FinComVoucherObject alone for every entry of the diff windows
  $ref = @(); foreach ($w in $dw) { $ref += $w[1] }
  foreach ($mid in ($ref | Sort-Object -Unique)) {
    $r = TS (ObjReq $mid)
    $o = Row $ph 'object' 'FinComVoucherObject' '' 0 @($mid) $r
    if ($keepRaw) { RawSave "obj-$mid.xml" $r.body }
  }
  # the sweep
  foreach ($d in $days) {
    # FinComDayHeads, timed, right before the day's batches (the bridge's order: the heads, then the entries)
    $r = TS (HeadsReq $d); $null = Row $ph 'heads' 'FinComDayHeads' $d $H[$d].Count $H[$d] $r
    $first = $true
    foreach ($n in $SIZES) {
      foreach ($w in (Windows $H[$d] $n)) {
        foreach ($f in $FORMS) { $r = TS (FormReq $f $d $w.w); $o = Row $ph 'sweep' $f $d $H[$d].Count $w.w $r $w.k; $o | Add-Member -NotePropertyName first -NotePropertyValue $first; $first = $false }
      }
    }
  }
  # the diff windows, raw kept
  $wi = 0
  foreach ($w in $dw) {
    $wi++
    foreach ($f in $FORMS) {
      $r = TS (FormReq $f $w[0] $w[1]); $null = Row $ph 'diff' $f $w[0] $H[$w[0]].Count $w[1] $r $wi
      if ($keepRaw) { $fn = "$ph-$f-$($w[0])-w$wi.xml"; RawSave $fn $r.body; $diffPlan.Add([pscustomobject]@{ phase = $ph; form = $f; file = $fn; mids = @($w[1] | ForEach-Object { "$_" }) }) }
    }
  }
  # the control: no date (the whole company looked at); 5 and 25 entries of 31-Aug
  $a = $H['20260831']
  foreach ($n in 5, 25) { if ($a.Count -ge $n) { $r = TS (RangeReq 'C0' '20991231' $a[0] $a[$n - 1]) 2000 120000; $null = Row $ph 'control' 'C0' '20260831' $a.Count $a[0..($n - 1)] $r } }
  return $H
}
function Report([string]$ph, [string]$vExact, [string]$vSize, [int]$count) {
  $sw = @($rows | Where-Object { $_.phase -eq $ph -and ($_.what -eq 'sweep' -or $_.what -eq 'diff') })
  $obj = @($rows | Where-Object { $_.phase -eq $ph -and $_.what -eq 'object' })
  $os = St $obj; $osNo = St @($obj | Where-Object { -not $_.special })
  MLine ("{0} one by one FinComVoucherObject ({1:N0} entries in the company): all {2}; without the invoices and payrolls {3}; the 500-employee payroll {4} ms, the 100 {5} ms, a 50-item invoice worst {6} ms" -f $ph, $count, (StTxt $os), (StTxt $osNo),
      (@($obj | Where-Object { $_.special -eq 'pay500' } | ForEach-Object ms) -join '/'), (@($obj | Where-Object { $_.special -eq 'pay100' } | ForEach-Object ms) -join '/'), (@($obj | Where-Object { $_.special -eq 'inv50' } | Measure-Object ms -Maximum).Maximum))
  foreach ($h in @($rows | Where-Object { $_.phase -eq $ph -and $_.what -eq 'heads' })) { MLine ("{0} FinComDayHeads {1} ({2} entries): {3} ms, window held {4} ms, {5:N0} chars" -f $ph, $h.day, $h.dayN, $h.ms, $h.blockedMs, $h.chars) }
  $best = @()
  foreach ($f in $FORMS) {
    $okN = 0; $okN1 = 0; $okS = 0; $parts = @()
    foreach ($n in $SIZES) {
      $l = @($sw | Where-Object { $_.form -eq $f -and $_.n -eq $n })
      if (-not $l.Count) { continue }
      $s = St $l; $sNo = St @($l | Where-Object { $_.special -notmatch 'pay500' })
      $perMin = if ($s.med -gt 0) { [int](60000 * $n / $s.med) } else { 0 }
      MLine ("{0} {1} N={2}: {3}; without the 500-employee payroll: worst {4} ms, held {5} ms; Tally's own pace at the median {6:N0} entries a minute; by day: {7}" -f $ph, $f, $n, (StTxt $s), $(if ($sNo) { $sNo.worst } else { '-' }), $(if ($sNo) { $sNo.held } else { '-' }), $perMin,
          ((@($l | Group-Object day | ForEach-Object { $g = St $_.Group; '{0} ({1}) worst {2} ms held {3} ms' -f $_.Name, $_.Group[0].dayN, $g.worst, $g.held })) -join '; '))
      if ($s.ok2) { $okN = $n }
      if ($s.ok2 -and $s.worst -le 1000) { $okN1 = $n }
      $sm = St @($l | Where-Object { [int]$_.dayN -le 3000 })
      if ($sm -and $sm.ok2) { $okS = $n }
      $parts += "N=$n worst $($s.worst) ms"
    }
    $best += "$f largest N within 2 s every time $okN (within 1 s $okN1; on days of at most 3,000 entries $okS)"
  }
  # the first batch of a day, right after its FinComDayHeads (Tally's first look at that day's entries since other days)
  foreach ($x in @($sw | Where-Object { $_.first })) { MLine ("{0} first batch of {1} ({2} entries) after its heads: {3} n={4} {5} ms, window held {6} ms" -f $ph, $x.day, $x.dayN, $x.form, $x.n, $x.ms, $x.blockedMs) }
  $bad = @($sw | Where-Object { $_.ok -and -not $_.exact })
  $noAns = @($sw | Where-Object { -not $_.ok })
  VRes $vExact $(if (-not $sw.Count) { 'HARNESS' } elseif ($bad.Count) { 'FAIL' } elseif ($noAns.Count) { 'HARNESS' } else { 'PASS' }) `
    ("{0} batch requests at {1:N0} entries, exact {2}; inexact: {3}; no answer: {4}" -f $sw.Count, $count, @($sw | Where-Object exact).Count,
      $(if ($bad.Count) { (@($bad | Select-Object -First 8 | ForEach-Object { "$($_.form) $($_.day) n=$($_.n) got $($_.got) missing $($_.missing) extra $($_.extra) dup $($_.dup)" })) -join ', ' } else { 'none' }),
      $(if ($noAns.Count) { (@($noAns | Select-Object -First 5 | ForEach-Object { "$($_.form) $($_.day) n=$($_.n) $($_.err)" })) -join ', ' } else { 'none' }))
  $any = @($best | Where-Object { $_ -notmatch 'within 2 s every time 0 ' })
  VRes $vSize $(if (-not $sw.Count) { 'HARNESS' } elseif ($any.Count) { 'PASS' } else { 'FAIL' }) (($best -join '; ') + " (worst over every day and window, the 500-employee payroll included; window held under 2 s; exact)")
}

$H1 = $null; $H2 = $null; $n2 = 0
try {
  if ($n1 -lt 25000) { throw "the company holds $n1 entries, not ~30,000 ($mk)" }
  VRes $V1 $(if ($inv50 -eq 10 -and $payOk -eq 2) { 'PASS' } else { 'HARNESS' }) ("{0:N0} entries in the company ({1}); invoices of 50 items {2}/10, payroll entries {3}/2 (100 and 500 employees) on 31-Aug" -f $n1, $mk, $inv50, $payOk)
  Say '---- batch: phase p1 (~30,000 entries)'
  $H1 = Phase 'p1' $DAYS1 $true
  $obj1 = @($rows | Where-Object { $_.phase -eq 'p1' -and $_.what -eq 'object' })
  VRes $V2 $(if ($obj1.Count -and @($obj1 | Where-Object { -not $_.exact }).Count -eq 0) { 'PASS' } elseif ($obj1.Count) { 'FAIL' } else { 'HARNESS' }) ("{0} entries asked one by one, each answered with its own MasterID {1}; {2}" -f $obj1.Count, @($obj1 | Where-Object exact).Count, (StTxt (St $obj1)))
  Report 'p1' $V3 $V4 $n1
} catch { Info "batch p1 stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"; $script:dbBusy = $false }
try {
  Say '---- batch: ~70,000 more entries (about 1,00,000)'
  $dd = Join-Path $env:BRIDGE_DIST 'dbm'; $vc = 0; $ve = 0; $sw0 = [Diagnostics.Stopwatch]::StartNew()
  foreach ($f in Get-ChildItem $dd -Filter 'dbm2-vouchers-*.xml' | Sort-Object Name) { $k = DbImp 'Vouchers' (Get-Content $f.FullName -Raw) $f.Name; $vc += $k.c; $ve += $k.e }
  $n2 = CountAll
  Info ("batch: phase 2 import: created {0}, errors {1}, {2:N1} min; the company holds {3:N0} entries" -f $vc, $ve, $sw0.Elapsed.TotalMinutes, $n2)
  if ($n2 -lt 90000) { throw "the company holds $n2 entries, not ~1,00,000" }
  Say '---- batch: phase p2 (~1,00,000 entries)'
  $H2 = Phase 'p2' $DAYS2 $false
  Report 'p2' $V5 $V6 $n2
} catch { Info "batch p2 stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"; $script:dbBusy = $false }

# ---- v7: the control and the rule
$ctl = @($rows | Where-Object { $_.what -eq 'control' })
foreach ($c in $ctl) { MLine ("{0} control C0 (no date) n={1}: {2} ms, window held {3} ms, got {4} exact {5}" -f $c.phase, $c.n, $c.ms, $c.blockedMs, $c.got, $c.exact) }
$endOk = DbLight
$notResp = @($rows | Where-Object { -not $_.responding }).Count
VRes $V7 $(if (-not $rows.Count) { 'HARNESS' } elseif ($script:dbMaxInFlight -le 1 -and $endOk.responding -and $endOk.ok) { 'PASS' } else { 'FAIL' }) `
  ("{0} measured requests, at most {1} at Tally at once, hung {2}, Tally not responding after {3}; at the end responding {4} (company list {5} ms); the control without a date: {6}" -f $rows.Count, $script:dbMaxInFlight, $script:hungN, $notResp, $endOk.responding, $endOk.ms,
    $(if ($ctl.Count) { (@($ctl | ForEach-Object { "$($_.phase) n=$($_.n) $($_.ms) ms held $($_.blockedMs) ms" })) -join ', ' } else { 'not run' }))
foreach ($c in $V1, $V2, $V3, $V4, $V5, $V6) { VRes $c 'HARNESS' 'not reached (see INFO lines and the log)' }

# ---- kept for the collect job (diff) and the doc
$script:frz.stop = $true
try { BtJson 'rows.json' $rows } catch { Info "batch: rows.json not written ($_)" }
$heads = [ordered]@{}; foreach ($p in @(@('p1', $H1), @('p2', $H2))) { if ($p[1]) { foreach ($d in $p[1].Keys) { $heads["$($p[0]) $d"] = @{ n = $p[1][$d].Count; first = $(if ($p[1][$d].Count) { $p[1][$d][0] }); last = $(if ($p[1][$d].Count) { $p[1][$d][-1] }) } } } }
try { BtJson 'days.json' $heads; BtJson 'special.json' $script:special } catch { }
try {
  [IO.File]::WriteAllText((Join-Path $raw 'diff-plan.json'), (ConvertTo-Json -InputObject @($diffPlan.ToArray()) -Depth 6), [Text.UTF8Encoding]::new($false))
  $z = Join-Path $bt 'raw.zip'; if (Test-Path $z) { Remove-Item $z -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($raw, $z, [IO.Compression.CompressionLevel]::Optimal, $true)
  Remove-Item $raw -Recurse -Force
  Info ("batch: raw answers zipped: {0:N1} MB" -f ((Get-Item $z).Length / 1MB))
} catch { Info "batch: raw answers not zipped ($_)" }
