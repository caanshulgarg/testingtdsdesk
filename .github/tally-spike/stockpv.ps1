# Mode stockp (30-Oct-2026; the owner, 29-Oct: "we keep stock figure in Tally also, why don't we bring from there").
# MEASURE + DESIGN ONLY, TEST DATA ONLY: a throwaway company in this runner's own Tally; never a customer's computer; no
# bridge installed, nothing shipped. Dot-sourced by flowv.ps1 after c2, on dblib.ps1 (one request at Tally at a time; the
# 2 s stop, then the late answer awaited with nothing else sent).
#
# The lightest request for the Financial statements' stock panel (opening and closing stock), in the bridge's own
# fcCollection form, with the period stated (SVFROMDATE / SVTODATE TYPE="Date"; run 41004704755: an undated request
# answers at the Gateway's CURRENT period):
#   C1  FinComStockInHand: the Stock-in-Hand group (by its reserved name): OPENINGBALANCE at From, CLOSINGBALANCE at To
#   C2  FinComStockGroupValues: every stock group's OPENINGVALUE / CLOSINGVALUE (items under Primary are in no group)
#   R1  FinComStockClosing: every item's opening / closing (the reference: Tally's own per-item figures, summed)
#   R2  FinComStockItems: stored master fields, undated (the books-beginning opening, godown / batch allocations)
# Data (stockp/gen.py): 4,000 items (1,000 batch-wise, three godowns, 40 under Primary), 30,000 entries in FY 2026-27 and
# 2,000 in Apr-Jun 2027.
# Two Gateway states: G1 as Tally opens the company; G2 the Gateway's period and date moved into year 2 by keys (Alt+F2,
# F2, Ctrl+A, as openp o7). Per state and candidate: Tally closed and started (cold), then each period asked for the first
# time and once more. A thread sends Tally's window WM_NULL every 100 ms (250 ms limit): the longest hold per request.
. (Join-Path $PSScriptRoot 'dblib.ps1')
Say '---- stockp: stock figures from Tally, the lightest request'
$P1 = 'p1 the stock test data made (items, godowns, batches, two years of inventory entries)'
$P2 = 'p2 stored opening (undated item masters) as made'
$P3 = 'p3 C1 Stock-in-Hand group, dated: equals Tally''s per-item total, each request 2 s or less, window not held'
$P4 = 'p4 dated answers the same whatever the Gateway''s period'
$P5 = 'p5 C2 stock groups, dated: times and totals'
$P6 = 'p6 one request at a time, Tally responding after each'
function MLine([string]$s) { Add-Content -Path $resultsFile -Value "MEASURE $s" -Encoding UTF8; Write-Host "MEASURE $s" }
$st = Join-Path $cap 'stock'; New-Item -ItemType Directory -Force $st | Out-Null
function SSave([string]$n, $t) { [IO.File]::WriteAllText((Join-Path $st $n), "$t", [Text.UTF8Encoding]::new($false)) }
$RS = @{}; foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'stockp\req') -Filter '*.xml') { $RS[$f.BaseName] = (Get-Content $f.FullName -Raw).Trim(); SSave "request-$($f.Name)" $RS[$f.BaseName] }
Info "stockp: requests $(($RS.Keys | Sort-Object) -join ', ')"
function Q([string]$k, [string]$from = '', [string]$to = '') {
  $x = $RS[$k].Replace('@@CO@@', (LE $co1)); if ($from) { $x = $x.Replace('20991201', $from).Replace('20991231', $to) }; return $x
}
function Num([string]$s) { $s = ($s -replace '[^\d.\-]', ''); if ($s -and $s -ne '-' -and $s -ne '.') { return [decimal]$s } else { return [decimal]0 } }

# ---- the window probe (as p72v.ps1)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SPFrz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); }
'@
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; beats = 0; err = '' })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null
    while (-not $f.stop) {
      $h = $f.h
      if ($f.on -and $h -ne [IntPtr]::Zero -and [SPFrz]::IsWindow($h)) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [SPFrz]::SendMessageTimeout($h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $t0 }; $cur = $sw.Elapsed.TotalMilliseconds - $since; if ($cur -gt $f.max) { $f.max = $cur } }
        else { $since = $null }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
} catch { Info "stockp: the window probe could not start ($_)" }
function FrzH { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.on = $true }
FrzH
Info "stockp: window probe running $($script:frzOk) (beats $($script:frz.beats)), Tally pid $($script:tpid)"

# the figures in an answer
function Figs([string]$k, [string]$b) {
  if ($k -like 'c1*') {
    $o = Num ([regex]::Match($b, '<OPENINGBALANCE[^>]*>([^<]*)<').Groups[1].Value); $c = Num ([regex]::Match($b, '<CLOSINGBALANCE[^>]*>([^<]*)<').Groups[1].Value)
    $n = @([regex]::Matches($b, '<GROUP[ >]')).Count
    return [pscustomobject]@{ open = $o; close = $c; rows = "$n group$(if ($n -ne 1) { 's' }) '$([regex]::Match($b, '<GROUP NAME="([^"]*)"').Groups[1].Value)'" }
  }
  $tag = if ($k -like 'c2*') { 'STOCKGROUP' } else { 'STOCKITEM' }
  $o = [decimal]0; $c = [decimal]0; $n = 0; $top = 0
  foreach ($m in [regex]::Matches($b, "(?s)<$tag NAME=`"[^`"]*`"[^>]*>(.*?)</$tag>")) {
    $n++; $v = $m.Groups[1].Value
    if ($tag -eq 'STOCKGROUP') { $p = [regex]::Match($v, '<PARENT[^>]*>([^<]*)<').Groups[1].Value.Trim(); if ($p -and $p -notmatch 'Primary$') { continue } }
    $top++
    $o += Num ([regex]::Match($v, '<OPENINGVALUE[^>]*>([^<]*)<').Groups[1].Value); $c += Num ([regex]::Match($v, '<CLOSINGVALUE[^>]*>([^<]*)<').Groups[1].Value)
  }
  return [pscustomobject]@{ open = $o; close = $c; rows = "$n $($tag.ToLower())s ($top summed)" }
}
$script:rows = [Collections.Generic.List[object]]::new()
$script:allResp = $true
function Ask([string]$state, [string]$k, [string]$from, [string]$to, [string]$note, [string]$save = '') {
  FrzH; $script:frz.max = 0.0
  $r = TStop (Q $k $from $to) 2000 180000
  Start-Sleep -Milliseconds 150
  $hold = if ($script:frzOk) { [math]::Round($script:frz.max, 0) } else { -1 }
  $f = if ($r.ok) { Figs $k $r.body } else { [pscustomobject]@{ open = 0; close = 0; rows = "no answer: $($r.err)" } }
  if ($save -and $r.ok) { SSave $save $r.body }
  if ($r.hung) { $null = DbRestart "stockp-$k-hung"; FrzH }
  $l = DbLight; if (-not $l.responding -or -not $l.ok) { $script:allResp = $false }
  $per = if ($from) { "$from-$to" } else { 'undated' }
  $row = [pscustomobject]@{ state = $state; k = $k; per = $per; note = $note; ms = $r.ms; hold = $hold; inTime = $r.inTime; hung = $r.hung; bytes = [Text.Encoding]::UTF8.GetByteCount("$($r.body)"); open = $f.open; close = $f.close; rows = $f.rows }
  $script:rows.Add($row)
  MLine ("{0} {1} {2} ({3}): {4} ms, window held {5} ms, {6} bytes, {7}; opening {8}, closing {9}{10}" -f $state, $k, $per, $note, $r.ms, $hold, $row.bytes, $f.rows, $f.open, $f.close, $(if ($r.hung) { '; HUNG' } elseif (-not $r.inTime) { '; OVER 2 s' } else { '' }))
  return $row
}
function CoPeriod {
  $r = TStop ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SPCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SPCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, BOOKSFROM, STARTINGFROM, ENDINGAT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 2000 30000
  return ((([regex]::Matches($r.body, '<(BOOKSFROM|STARTINGFROM|ENDINGAT)[^>]*>\s*([^<]*)<') | ForEach-Object { $_.Groups[1].Value + '=' + $_.Groups[2].Value.Trim() }) -join ', '))
}
# the Gateway's period and current date into year 2 (openp o7's keys)
function ToYear2 {
  KeysTo '{ESC}' 2; KeysTo '{ESC}' 2; KeysTo 'n' 2
  KeysTo '%{F2}' 3 'stockp-gw-altf2'
  KeysTo '1-4-2027{ENTER}' 2; KeysTo '31-3-2028{ENTER}' 2
  KeysTo '^a' 4 'stockp-gw-period'
  KeysTo '{F2}' 3 'stockp-f2-date'
  KeysTo '2-4-2027{ENTER}' 2
  KeysTo '^a' 4 'stockp-date-set'
}

# ---- data
$gen = Join-Path $env:RUNNER_TEMP 'stockpgen'
$made = [ordered]@{}
try {
  $o = & python -I (Join-Path $PSScriptRoot 'stockp\gen.py') $gen 2>&1; Info "stockp: gen.py: $o"
  $plan = Get-Content (Join-Path $gen 'plan.json') -Raw | ConvertFrom-Json
  $exp = Get-Content (Join-Path $gen 'expect.json') -Raw | ConvertFrom-Json
  # the company's inventory features: candidate field names, each tried alone and read back (harness only)
  foreach ($f in 'ISINTEGRATED', 'ISINVENTORYON', 'USEMULTIPLEGODOWNS', 'ISMULTIGODOWNON', 'ISMULTIGODOWN', 'USEBATCHES', 'ISBATCHWISEON', 'ISMAINTAINBATCHES') {
    $k = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><' + $f + '>Yes</' + $f + '></COMPANY></TALLYMESSAGE>') "company $f Yes"
    $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SPCoF</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SPCoF" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ' + $f + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60
    Info ("stockp: company {0}=Yes: altered {1}, errors {2}; read back '{3}'" -f $f, $k.a, $k.e, ([regex]::Match($r.body, "<$f[^>]*>([^<]*)<").Groups[1].Value))
  }
  $k = DbImp 'All Masters' (Get-Content (Join-Path $gen 'masters.xml') -Raw -Encoding UTF8) 'masters'; $made['masters'] = "$($k.c) created, $($k.e) errors$(if ($k.line) { ': ' + $k.line })"
  foreach ($y in 'y1', 'y2') {
    $sw = [Diagnostics.Stopwatch]::StartNew(); $c = 0; $e = 0; $el = ''
    foreach ($f in $plan.$y.files) { $k = DbImp 'Vouchers' (Get-Content (Join-Path $gen $f[0]) -Raw -Encoding UTF8) "$y $($f[0])"; $c += $k.c; $e += $k.e; if ($k.line -and -not $el) { $el = $k.line } }
    $made["entries $y"] = "$c created, $e errors$(if ($el) { ' (' + $el + ')' }) in $([math]::Round($sw.Elapsed.TotalMinutes, 1)) min"
  }
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SPTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SPTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  $nv = @([regex]::Matches($r.body, '<VOUCHER[ >]')).Count; $made['entries in Tally'] = "$nv"
} catch { Info "stockp: data stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
$p1ok = ([int]("0" + $made['entries in Tally']) -ge 30000) -and ($made['masters'] -match '^\d{4}')
Result $P1 $(if ($p1ok) { 'PASS' } else { 'HARNESS' }) ((($made.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join '; ') + "; expected opening at books-beginning $($exp.opening_total) ($($exp.items_with_opening) items, $($exp.opening_allocs) godown/batch allocations, $($exp.batched_items) batch-wise items)")

# ---- p2: the stored opening (undated, master fields)
try {
  $r = TStop (Q 'r2-items-stored') 2000 180000
  $sum = [decimal]0; $n = 0; $gd = @{}; $bt = @{}
  foreach ($m in [regex]::Matches($r.body, '(?s)<STOCKITEM NAME="[^"]*"[^>]*>(.*?)</STOCKITEM>')) {
    $n++; $v = $m.Groups[1].Value
    $sum += [math]::Abs((Num ([regex]::Match($v, '<OPENINGVALUE[^>]*>([^<]*)<').Groups[1].Value)))
    foreach ($g in [regex]::Matches($v, '<GODOWNNAME[^>]*>([^<]*)<')) { $gd[$g.Groups[1].Value] = 1 }
    foreach ($g in [regex]::Matches($v, '<BATCHNAME[^>]*>([^<]*)<')) { $bt[$g.Groups[1].Value] = 1 }
  }
  MLine ("G1 r2-items-stored undated: {0} ms, {1} bytes, {2} items, stored opening total {3}, godowns {4}, batch names {5}" -f $r.ms, [Text.Encoding]::UTF8.GetByteCount($r.body), $n, $sum, ($gd.Keys -join '/'), $bt.Count)
  Result $P2 $(if ($n -eq 4000 -and [math]::Abs($sum - [decimal]$exp.opening_total) -lt 1) { 'PASS' } else { 'FAIL' }) ("{0} items read, stored opening {1} (made {2}); godowns in the allocations: {3}; batch names {4}; {5} ms" -f $n, $sum, $exp.opening_total, ($gd.Keys -join ', '), $bt.Count, $r.ms)
} catch { Result $P2 'HARNESS' "stopped: $($_.Exception.Message)" }

# ---- the measurement
$pers = @(@('20260401', '20260401', 'books-beginning, one day'), @('20260401', '20261031', 'year 1 to 31-Oct'), @('20261001', '20261031', 'one month'), @('20260401', '20270331', 'year 1 whole'), @('20270401', '20270630', 'year 2 Apr-Jun'))
foreach ($state in 'G1', 'G2') {
  foreach ($k in 'c1-stockinhand', 'c2-stockgroups', 'r1-itemclosing-all') {
    try {
      $up = DbRestart "stockp-$state-$k"; FrzH
      if ($state -eq 'G2') { ToYear2; FrzH }
      Info ("stockp: {0} {1}: Tally started again (company up: {2}); the company's period now: {3}" -f $state, $k, $up, (CoPeriod))
      $first = $true
      foreach ($p in $pers) {
        $sv = if ($k -ne 'r1-itemclosing-all' -and $state -eq 'G1') { "$state-$k-$($p[0])-$($p[1]).xml" } else { '' }
        $null = Ask $state $k $p[0] $p[1] $(if ($first) { 'COLD: first request after Tally started' } else { 'first ask of this period' }) $sv
        $null = Ask $state $k $p[0] $p[1] 'again'
        $first = $false
      }
      if ($k -eq 'c1-stockinhand') { $null = Ask $state 'c1u-stockinhand-undated' '' '' 'undated' "$state-c1-undated.xml"; $null = Ask $state 'c1n-stockinhand-byname' '20260401' '20270331' 'filter by name' }
      if ($k -eq 'c2-stockgroups') { $null = Ask $state 'c2u-stockgroups-undated' '' '' 'undated' }
    } catch { Info "stockp: $state $k stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
  }
}
$script:frz.stop = $true

# ---- the reading
function RowsOf($k, $state) { @($script:rows | Where-Object { $_.k -eq $k -and $_.state -eq $state -and $_.per -ne 'undated' }) }
$ev3 = [Collections.Generic.List[string]]::new(); $ok3 = $true
foreach ($state in 'G1', 'G2') {
  foreach ($p in $pers) {
    $per = "$($p[0])-$($p[1])"
    $c1 = @($script:rows | Where-Object { $_.state -eq $state -and $_.k -eq 'c1-stockinhand' -and $_.per -eq $per })[0]
    $r1 = @($script:rows | Where-Object { $_.state -eq $state -and $_.k -eq 'r1-itemclosing-all' -and $_.per -eq $per })[0]
    if (-not $c1 -or -not $r1) { $ok3 = $false; $ev3.Add("$state $per missing"); continue }
    $same = ([math]::Abs([math]::Abs($c1.open) - [math]::Abs($r1.open)) -lt 1) -and ([math]::Abs([math]::Abs($c1.close) - [math]::Abs($r1.close)) -lt 1)
    if (-not $same) { $ok3 = $false }
    $ev3.Add("$state $per C1 $($c1.open)/$($c1.close) vs items $($r1.open)/$($r1.close) $(if ($same) { 'same' } else { 'DIFFER' })")
  }
}
$c1rows = @($script:rows | Where-Object { $_.k -like 'c1-*' })
$c1worst = ($c1rows | Measure-Object ms -Maximum).Maximum; $c1hold = ($c1rows | Measure-Object hold -Maximum).Maximum
if ($c1worst -gt 2000 -or $c1hold -ge 1000) { $ok3 = $false }
$b0 = @($script:rows | Where-Object { $_.state -eq 'G1' -and $_.k -eq 'c1-stockinhand' -and $_.per -eq '20260401-20260401' })[0]
Result $P3 $(if ($ok3) { 'PASS' } else { 'FAIL' }) ("worst {0} ms, longest window hold {1} ms; books-beginning opening {2} (made {3}); {4}" -f $c1worst, $c1hold, $(if ($b0) { $b0.open } else { '-' }), $exp.opening_total, ($ev3 -join '; '))
$ev4 = [Collections.Generic.List[string]]::new(); $ok4 = $true
foreach ($k in 'c1-stockinhand', 'c2-stockgroups', 'r1-itemclosing-all') {
  foreach ($p in $pers) {
    $per = "$($p[0])-$($p[1])"
    $a = @($script:rows | Where-Object { $_.state -eq 'G1' -and $_.k -eq $k -and $_.per -eq $per })[0]; $b = @($script:rows | Where-Object { $_.state -eq 'G2' -and $_.k -eq $k -and $_.per -eq $per })[0]
    if (-not $a -or -not $b) { $ok4 = $false; continue }
    if ($a.open -ne $b.open -or $a.close -ne $b.close) { $ok4 = $false; $ev4.Add("$k $per G1 $($a.open)/$($a.close) G2 $($b.open)/$($b.close)") }
  }
}
$u = @($script:rows | Where-Object { $_.k -like '*undated*' } | ForEach-Object { "$($_.state) $($_.k): $($_.open)/$($_.close)" })
Result $P4 $(if ($ok4) { 'PASS' } else { 'FAIL' }) ("dated: {0}; undated (for comparison, the Gateway's period): {1}" -f $(if ($ev4.Count) { $ev4 -join '; ' } else { 'all the same in G1 and G2' }), ($u -join '; '))
$c2rows = @($script:rows | Where-Object { $_.k -eq 'c2-stockgroups' })
$ev5 = @($pers | ForEach-Object { $per = "$($_[0])-$($_[1])"; $a = @($c2rows | Where-Object { $_.state -eq 'G1' -and $_.per -eq $per })[0]; if ($a) { "$per $($a.open)/$($a.close) ($($a.rows))" } })
Result $P5 'PASS' ("measured: worst {0} ms, longest window hold {1} ms; G1 totals of the top-level groups (items under Primary are in none): {2}" -f ($c2rows | Measure-Object ms -Maximum).Maximum, ($c2rows | Measure-Object hold -Maximum).Maximum, ($ev5 -join '; '))
$sum = @('c1-stockinhand', 'c2-stockgroups', 'r1-itemclosing-all') | ForEach-Object { $kk = $_; $rr = @($script:rows | Where-Object { $_.k -eq $kk }); "$kk worst $(($rr | Measure-Object ms -Maximum).Maximum) ms (cold worst $((@($rr | Where-Object { $_.note -like 'COLD*' }) | Measure-Object ms -Maximum).Maximum) ms), hold $(($rr | Measure-Object hold -Maximum).Maximum) ms, $(($rr | Measure-Object bytes -Maximum).Maximum) bytes" }
Result $P6 $(if ($script:dbMaxInFlight -le 1 -and $script:allResp) { 'PASS' } else { 'FAIL' }) ("{0} requests, at most {1} at Tally at once; Tally responding after each: {2}; {3}" -f $script:dbSent, $script:dbMaxInFlight, $script:allResp, ($sum -join '; '))
Remove-Item $gen -Recurse -Force -ErrorAction SilentlyContinue
