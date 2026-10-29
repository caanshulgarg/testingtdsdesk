# Mode stockm (stock figures from Tally: MEASURE + DESIGN ONLY; TEST DATA ONLY: a throwaway company in this runner's own
# Tally; never the owner's computer; no bridge installed, nothing shipped). Dot-sourced by flowv.ps1 after c2, on
# dblib.ps1 (one request at Tally at a time; the 2 s stop, then the late answer awaited with nothing else sent).
#
# The candidate requests are in stockm\req, written by a throwaway go test with the bridge's own builders (fcCollection,
# masterRange, dateVars) at next-fs-period 96bd08836; the owner approves the exact XML before any bridge sends one:
#   (a) A1 FinComStockItems: StockItem masters, stored fields only (opening quantity, rate and value at books-beginning,
#          the costing method), 2,000 MasterIDs a request; A2 the same with each opening's godown / batch allocation;
#          A3 FinComStockGroups
#   (b) B1 FinComStockLedger: one Stock-in-Hand ledger by name, its stored opening and the closing values typed in its
#          master (LEDGERCLOSINGVALUES: date and amount; accounts not integrated with inventory); B2 the same list whole
#   (d) D1 the Stock Summary report for a period (EXPLODEFLAG No: the groups; D1X Yes: every item); D2 FinComStockClosing:
#          every StockItem's opening, closing quantity, rate and value for a period (computed by Tally); D3 the same for
#          one item. Computed figures: measured only to say how heavy they are
# Two sizes: S (600 items, 3,000 entries) and L (3,000 items, 20,000 entries, ~84,000 item lines), FY 2026-27.
# Each request 3 times; after each the company list under 2 s and Tally's window responding (DbLight).
# Answers kept in captures\stock for the offline check of option (c) (FinCom's own valuation from opening + entries).
. (Join-Path $PSScriptRoot 'dblib.ps1')
$S1 = 's1 the stock test data made (items with opening, a year of inventory entries)'
$S2 = 's2 (a) stock item masters: the stored opening read back exactly as made'
$S3 = 's3 (b) the Stock-in-Hand ledger: stored opening and closing values read back'
$S4 = 's4 (d) Tally''s computed stock closing: times'
$S5 = 's5 one request at a time, Tally responding after each'
$sDone = @{}
function SRes($c, $st, $ev) { if (-not $sDone[$c]) { Result $c $st $ev; $sDone[$c] = $true } }
function MLine([string]$s) { Add-Content -Path $resultsFile -Value "MEASURE $s" -Encoding UTF8; Write-Host "MEASURE $s" }
function TM([string]$x) { '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $x + '</TALLYMESSAGE>' }
$st = Join-Path $cap 'stock'; New-Item -ItemType Directory -Force $st | Out-Null
function SSave([string]$n, $t) { [IO.File]::WriteAllText((Join-Path $st $n), "$t", [Text.UTF8Encoding]::new($false)) }
$RS = @{}; foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'stockm\req') -Filter '*.xml') { $RS[$f.BaseName] = (Get-Content $f.FullName -Raw).Trim() }
Info "stockm: candidate requests $(($RS.Keys | Sort-Object) -join ', ')"
function Q([string]$k, [string]$from = '', [string]$to = '', [int64]$a = 0, [int64]$u = 0, [string]$name = '') {
  $x = $RS[$k].Replace('@@CO@@', (LE $co1)).Replace('111111', "$a").Replace('222222', "$u").Replace('@@NAME@@', (LE $name))
  if ($from) { $x = $x.Replace('20991201', $from).Replace('20991231', $to) }
  return $x
}
function Rows([string]$b) {
  $n = @([regex]::Matches($b, '<STOCKITEM[ >]')).Count; if ($n) { return "$n items" }
  $n = @([regex]::Matches($b, '<DSPACCNAME>')).Count; if ($n) { return "$n rows" }
  $n = @([regex]::Matches($b, '<STOCKGROUP[ >]')).Count; if ($n) { return "$n groups" }
  return "$(@([regex]::Matches($b, '<LEDGER[ >]')).Count) ledgers"
}
$script:allIn = $true; $script:allResp = $true; $script:over = [Collections.Generic.List[string]]::new()
$script:times = [ordered]@{}
# one candidate, 3 times; worst kept; the first answer saved when asked
function Ask([string]$id, [string]$x, [string]$save = '', [int]$maxMs = 180000, [int]$reps = 3) {
  $ms = @(); $bytes = 0; $rows = ''; $okAll = $true; $hung = $false; $err = ''
  for ($i = 0; $i -lt $reps; $i++) {
    $r = TStop $x 2000 $maxMs
    if ($r.hung) { $hung = $true; $okAll = $false; $err = $r.err; $null = DbRestart "stockm-$id-hung"; break }
    if (-not $r.ok) { $okAll = $false; $err = $r.err }
    $ms += $r.ms
    if ($i -eq 0) { $bytes = [Text.Encoding]::UTF8.GetByteCount($r.body); $rows = Rows $r.body; if ($save) { SSave $save $r.body } ; $script:lastBody = $r.body }
    if (-not $r.inTime) { $script:allIn = $false }
    $l = DbLight; if (-not $l.responding -or -not $l.ok) { $script:allResp = $false }
  }
  $worst = if ($ms.Count) { ($ms | Measure-Object -Maximum).Maximum } else { -1 }
  if ($worst -gt 2000 -or $hung) { $script:over.Add("$id $worst ms") }
  $script:times[$id] = $worst
  $err2 = $(if ($err) { "; error: $err" } else { '' }); $hung2 = $(if ($hung) { '; HUNG (no answer by ' + $maxMs + ' ms, Tally restarted)' } else { '' })
  MLine ("{0}: worst {1} ms (each {2}), {3} bytes, {4}, ok {5}{6}{7}" -f $id, $worst, ($ms -join ' / '), $bytes, $rows, $okAll, $err2, $hung2)
  return $worst
}
function Imp([string]$file, [string]$report, [string]$label) {
  $k = DbImp $report (Get-Content $file -Raw -Encoding UTF8) $label
  return $k
}
function VchCounts {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SMTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SMTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>VOUCHERNUMBER, VOUCHERTYPENAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  $nos = [Collections.Generic.List[string]]::new()
  foreach ($m in [regex]::Matches($r.body, '<VOUCHERNUMBER[^>]*>([^<]*)<')) { $nos.Add($m.Groups[1].Value) }
  $byT = @{}; foreach ($m in [regex]::Matches($r.body, '<VOUCHERTYPENAME[^>]*>([^<]*)<')) { $t = $m.Groups[1].Value; $byT[$t] = 1 + [int]$byT[$t] }
  return [pscustomobject]@{ nos = $nos; byType = (($byT.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Value)" }) -join ', ') }
}
# the stored opening of every item in an A1 answer against what was made
function OpenCheck([string]$body, $items) {
  $got = @{}
  foreach ($m in [regex]::Matches($body, '(?s)<STOCKITEM NAME="([^"]*)"[^>]*>(.*?)</STOCKITEM>')) {
    $b = $m.Groups[2].Value
    $q = [regex]::Match($b, '<OPENINGBALANCE[^>]*>\s*(-?[\d.,]+)').Groups[1].Value -replace ',', ''
    $v = [regex]::Match($b, '<OPENINGVALUE[^>]*>\s*(-?[\d.,]+)').Groups[1].Value -replace ',', ''
    $c = [regex]::Match($b, '<COSTINGMETHOD[^>]*>([^<]*)<').Groups[1].Value
    $got[[Net.WebUtility]::HtmlDecode($m.Groups[1].Value)] = @($q, $v, $c)
  }
  $bad = [Collections.Generic.List[string]]::new(); $n = 0; $sum = 0.0
  foreach ($it in $items) {
    $g = $got[$it[0]]; if (-not $g) { continue }; $n++
    $q = if ($g[0]) { [double]$g[0] } else { 0 }; $v = if ($g[1]) { [math]::Abs([double]$g[1]) } else { 0 }; $sum += $v
    if ($q -ne [double]$it[2] -or [math]::Abs($v - [double]$it[4]) -gt 0.005 -or $g[2] -ne $it[1]) { if ($bad.Count -lt 5) { $bad.Add("$($it[0]): Tally $($g -join '/') made $($it[2])/$($it[4])/$($it[1])") } else { $bad.Add('') } }
  }
  return [pscustomobject]@{ n = $n; bad = $bad; sum = [math]::Round($sum, 2) }
}

$gen = Join-Path $env:RUNNER_TEMP 'stockgen'
try {
  Say '---- stockm: test data generator'
  $o = & python -I (Join-Path $PSScriptRoot 'stockm\gen.py') $gen 2>&1; Info "stockm: gen.py: $o"
  $plan = Get-Content (Join-Path $gen 'plan.json') -Raw | ConvertFrom-Json
  $items = Get-Content (Join-Path $gen 'items.json') -Raw | ConvertFrom-Json
  # the company's inventory switches as Tally stores them (candidate field names; harness only)
  foreach ($f in 'ISINTEGRATED', 'ISINVENTORYON', 'USEINVENTORY', 'ISMAINTAININVENTORY') {
    $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SMCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SMCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ' + $f + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60
    Info ("stockm: company field {0}: {1}" -f $f, ([regex]::Match($r.body, "<$f[^>]*>([^<]*)<").Groups[1].Value))
  }
} catch { Info "stockm: setup stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }

$made = [ordered]@{}
foreach ($part in 'S', 'L') {
  try {
    Say "---- stockm: part $part data"
    $k = Imp (Join-Path $gen "masters-$part.xml") 'All Masters' "masters $part"; $made["masters $part"] = "$($k.c) created, $($k.e) errors$(if ($k.line) { ': ' + $k.line })"
    $sw = [Diagnostics.Stopwatch]::StartNew(); $byKind = @{}; $errs = @{}
    foreach ($f in $plan.$part.files) {
      $k = Imp (Join-Path $gen $f[0]) 'Vouchers' "$part $($f[0])"
      $byKind[$f[1]] = [int]$byKind[$f[1]] + $k.c
      if ($k.e -and -not $errs[$f[1]]) { $errs[$f[1]] = "$($k.e) errors: $($k.line)" }
    }
    $made["entries $part"] = (($byKind.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Value)$(if ($errs[$_.Name]) { ' (' + $errs[$_.Name] + ')' })" }) -join ', ') + " in $([math]::Round($sw.Elapsed.TotalMinutes, 1)) min"
    $vc = VchCounts
    SSave "vouchers-$part.txt" ($vc.nos -join "`n")
    $made["in Tally after $part"] = "$($vc.nos.Count) entries ($($vc.byType))"
    Info "stockm: $part made: $(($made.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join '; ')"

    Say "---- stockm: part $part measured"
    $n = if ($part -eq 'S') { 600 } else { 3000 }
    MLine "---- part $part ($n items, $($vc.nos.Count) entries in Tally)"
    # (a)
    $null = Ask "$part A1 FinComStockItems all (MasterID > 0)" (Q 'a1-items-tail') "a1-$part.xml"
    $a1 = $script:lastBody
    $top = MaxMid $a1
    for ($a = 0; $a -lt $top; $a += 2000) { $null = Ask "$part A1 FinComStockItems chunk ($a, $($a + 2000)]" (Q 'a1-items-chunk' -a $a -u ($a + 2000)) '' 30000 1 }
    $null = Ask "$part A2 FinComStockItemsGodown all" (Q 'a2-itembat-tail') "a2-$part.xml"
    $null = Ask "$part A3 FinComStockGroups" (Q 'a3-stockgroups')
    $oc = OpenCheck $a1 @($items | Select-Object -First $n)
    MLine ("{0} A1 stored opening: {1} items read, {2} differ from what was made{3}; opening stock (sum of OPENINGVALUE) {4}" -f $part, $oc.n, $oc.bad.Count, $(if ($oc.bad.Count) { ' (' + (($oc.bad | Where-Object { $_ }) -join '; ') + ')' }), $oc.sum)
    if ($part -eq 'L') { SRes $S2 $(if ($oc.n -eq 3000 -and $oc.bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) ("3,000 items: {0} read, {1} differ; A1 worst {2} ms at 3,000 items (S: {3} ms at 600)" -f $oc.n, $oc.bad.Count, $script:times["L A1 FinComStockItems all (MasterID > 0)"], $script:times["S A1 FinComStockItems all (MasterID > 0)"]) }
    # (d) at three dates from the year's start, and a month
    foreach ($p in @(@('20260401', '20260402'), @('20260401', '20261031'), @('20260401', '20270331'), @('20261001', '20261031'))) {
      $tag = "$($p[0])-$($p[1])"
      $null = Ask "$part D1 Stock Summary (groups) $tag" (Q 'd1-stocksummary' $p[0] $p[1]) "d1-$part-$tag.xml"
      $null = Ask "$part D1X Stock Summary (every item) $tag" (Q 'd1x-stocksummary-items' $p[0] $p[1]) $(if ($p[1] -eq '20270331') { "d1x-$part-$tag.xml" } else { '' }) 180000 2
      $null = Ask "$part D2 FinComStockClosing all items $tag" (Q 'd2-itemclosing-all' $p[0] $p[1]) "d2-$part-$tag.xml" 180000 2
    }
    $null = Ask "$part D2 FinComStockClosing chunk (0, 2000] 20260401-20270331" (Q 'd2-itemclosing-chunk' '20260401' '20270331' 0 2000)
    $null = Ask "$part D3 FinComStockClosing one item (SM Item 0010, FIFO) 20260401-20270331" (Q 'd3-itemclosing-one' '20260401' '20270331' -name 'SM Item 0010') 'd3-one.xml'
    $null = Ask "$part D3 FinComStockClosing one item (SM Item 0001, Avg. Cost) 20260401-20270331" (Q 'd3-itemclosing-one' '20260401' '20270331' -name 'SM Item 0001')
    if ($part -eq 'S') {
      # harness only (untimed in the result): Tally's full master export of the items, to see every stored tag
      $r = TSetup ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>Stock Items</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 300
      SSave 'full-stockitems-S.xml' $r.body; Info "stockm: full stock item export (harness): $($r.ms) ms, $([Text.Encoding]::UTF8.GetByteCount($r.body)) bytes"
    }
  } catch { Info "stockm: part $part stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
}
$sOk = ($made['in Tally after S'] -match '^(\d+)') -and ($made['in Tally after L'] -match '^(\d+)') -and ([int]([regex]::Match("$($made['in Tally after L'])", '^\d+').Value) -ge 19000)
SRes $S1 $(if ($sOk) { 'PASS' } else { 'HARNESS' }) (($made.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join '; ')

# (b): a Stock-in-Hand ledger with an opening and closing values typed in its master, integrated (as made) and not
$bEv = [Collections.Generic.List[string]]::new()
try {
  Say '---- stockm: (b) Stock-in-Hand ledger'
  $CL = 'SM Closing Stock'
  $lx = { param($act) '<LEDGER NAME="' + $CL + '" ACTION="' + $act + '"><NAME.LIST><NAME>' + $CL + '</NAME></NAME.LIST><PARENT>Stock-in-Hand</PARENT><OPENINGBALANCE>-250000.00</OPENINGBALANCE>' +
      '<LEDGERCLOSINGVALUES.LIST><DATE>20260430</DATE><AMOUNT>-260000.00</AMOUNT></LEDGERCLOSINGVALUES.LIST><LEDGERCLOSINGVALUES.LIST><DATE>20261031</DATE><AMOUNT>-275000.00</AMOUNT></LEDGERCLOSINGVALUES.LIST>' +
      '<LEDGERCLOSINGVALUES.LIST><DATE>20270331</DATE><AMOUNT>-300000.00</AMOUNT></LEDGERCLOSINGVALUES.LIST></LEDGER>' }
  $k = DbImp 'All Masters' (TM (& $lx 'Create')) 'stock ledger (integrated)'; $bEv.Add("made integrated: created $($k.c), errors $($k.e)$(if ($k.line) { ' (' + $k.line + ')' })")
  $null = Ask 'B1 FinComStockLedger (integrated)' (Q 'b1-stockledger' -name $CL) 'b1-integrated.xml'
  $b = $script:lastBody
  $bEv.Add("integrated: opening '$([regex]::Match($b, '<OPENINGBALANCE[^>]*>([^<]*)<').Groups[1].Value)', closing values $(@([regex]::Matches($b, '<LEDGERCLOSINGVALUES\.LIST')).Count)")
  $null = Ask 'B2 FinComStockLedgerL whole list (integrated)' (Q 'b2-stockledger-list' -name $CL) 'b2-integrated.xml'
  $r = TStop (WithRange $script:RQ['ledlist-tail'] 0 0) 2000 60000; SSave 'ledlist-integrated.xml' $r.body
  $blk = [regex]::Match($r.body, '(?s)<LEDGER NAME="' + $CL + '"[^>]*>.*?</LEDGER>').Value
  $bEv.Add("FinComLedgers today (integrated): '$CL' opening '$([regex]::Match($blk, '<OPENINGBALANCE[^>]*>([^<]*)<').Groups[1].Value)'")
  # not integrated: the company switch, then the ledger again
  foreach ($f in 'ISINTEGRATED') {
    $k = DbImp 'All Masters' (TM ('<COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><' + $f + '>No</' + $f + '></COMPANY>')) "company $f No"
    $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SMCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SMCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ' + $f + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60
    $bEv.Add("company $f No: altered $($k.a), errors $($k.e); read back '$([regex]::Match($r.body, "<$f[^>]*>([^<]*)<").Groups[1].Value)'")
  }
  $k = DbImp 'All Masters' (TM (& $lx 'Alter')) 'stock ledger (not integrated)'; $bEv.Add("altered not integrated: altered $($k.a), errors $($k.e)$(if ($k.line) { ' (' + $k.line + ')' })")
  $null = Ask 'B1 FinComStockLedger (not integrated)' (Q 'b1-stockledger' -name $CL) 'b1-notintegrated.xml'
  $b = $script:lastBody
  $cv = @([regex]::Matches($b, '(?s)<LEDGERCLOSINGVALUES\.LIST>.*?<DATE[^>]*>(\d+)<.*?<AMOUNT[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value) $($_.Groups[2].Value)" })
  $bEv.Add("not integrated: opening '$([regex]::Match($b, '<OPENINGBALANCE[^>]*>([^<]*)<').Groups[1].Value)', closing values: $($cv -join ', ')")
  $null = Ask 'B2 FinComStockLedgerL whole list (not integrated)' (Q 'b2-stockledger-list' -name $CL) 'b2-notintegrated.xml'
  $null = Ask 'D1 Stock Summary (groups) 20260401-20270331 (not integrated)' (Q 'd1-stocksummary' '20260401' '20270331') 'd1-notintegrated.xml'
  $r = TSetup ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>Ledgers</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 300
  SSave 'full-ledgers-notintegrated.xml' $r.body
  $ok = ($cv.Count -ge 3)
  SRes $S3 $(if ($ok) { 'PASS' } else { 'FAIL' }) (($bEv -join '; ') + "; B1 worst $($script:times['B1 FinComStockLedger (not integrated)']) ms")
} catch { Info "stockm: (b) stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"; SRes $S3 'HARNESS' (($bEv -join '; ') + "; stopped: $($_.Exception.Message)") }

$dk = @($script:times.Keys | Where-Object { $_ -like 'L D*' })
$dWorst = if ($dk.Count) { ($dk | ForEach-Object { $script:times[$_] } | Measure-Object -Maximum).Maximum } else { -1 }
$dEv = ($dk | ForEach-Object { "$($_ -replace '^L ', ''): $($script:times[$_]) ms" }) -join '; '
SRes $S4 'PASS' ("measured (a figure, not a pass mark): worst at 3,000 items / 20,000 entries {0} ms; {1}" -f $dWorst, $dEv)
SRes $S5 $(if ($script:dbMaxInFlight -le 1 -and $script:allResp) { 'PASS' } else { 'FAIL' }) ("{0} requests, at most {1} at Tally at once; Tally responding after each: {2}; over 2 s: {3}" -f $script:dbSent, $script:dbMaxInFlight, $script:allResp, $(if ($script:over.Count) { $script:over -join '; ' } else { 'none' }))
Remove-Item $gen -Recurse -Force -ErrorAction SilentlyContinue
