# ledv.ps1 - mode "ledlist" (next-masterhook; the coordinator's ask of 08-Oct-2026). MEASUREMENT ONLY.
# Dot-sourced by flowv.ps1 after c1-c2 (Tally started with the ref's FinComRecorder.tdl, the company open; no bridge).
# The bridge's own ledger requests, exactly as the ref's source builds them (ledreq/*.xml, written by a go test at the ref
# from ledgerChunkRequest / groupListRequest / ledgerChangesRequest; only the company name and the numbers are put in):
#   L1 the full ledger list as keep's round reads it (ledgers.go ledgerList): the group list, then FinComLedgers chunks of
#      2,000 MasterIDs (after, after+2000] up to the company's ALTMSTID, then one last request with no upper end; the
#      bridge's rest between chunks (max(200 ms, half the chunk's time)). Per chunk: ms, ledgers; after each chunk a light
#      request (the company list) timed and Tally's window asked whether it responds (Process.Responding)
#   L2 FinComLedgerChanges as ledchanges.go asks it (200 AlterIDs a request, 10 at most) after 1 and after 50 ledgers
#      altered (by XML: the PAN changed), the span (old ALTMSTID, new ALTMSTID]
# at about 2,000, 5,000 and 20,000 ledgers (the ledgers made by XML import first, 1,000 an import). Each request capped
# at 30 s (a timeout is reported, Tally started afresh). Lists are walked with foreach.
Say '---- ledlist: the bridge''s ledger list and ledger changes requests on 2,000 / 5,000 / 20,000 ledgers'
$lq = Join-Path $PSScriptRoot 'ledreq'
$tplChunk = Get-Content (Join-Path $lq 'ledlist-chunk.xml') -Raw; $tplTail = Get-Content (Join-Path $lq 'ledlist-tail.xml') -Raw
$tplGroups = Get-Content (Join-Path $lq 'ledgroups.xml') -Raw; $tplCh = Get-Content (Join-Path $lq 'ledchanges.xml') -Raw
function LE([string]$s) { [Security.SecurityElement]::Escape($s) }
function LReq([string]$tpl, [int64]$after, [int64]$upto) { $tpl.Replace('@@CO@@', (LE $co1)).Replace('111111', "$after").Replace('222222', "$upto").Trim() }
function LPost([string]$x) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 30).Content; $ok = $true }
  catch { $c = "failed: $($_.Exception.Message)"; $ok = $false }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ok = $ok; ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
function LFresh($why) {
  Info "ledlist: Tally started afresh ($why)"
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10
}
function LAltM {
  $r = LPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LLCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="LLCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ALTMSTID, ALTVCHID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  foreach ($m in [regex]::Matches($r.body, '<COMPANY NAME="([^"]*)"[^>]*>(?s:.*?)<ALTMSTID[^>]*>\s*(\d+)')) { if ([Security.SecurityElement]::Escape($co1) -eq $m.Groups[1].Value -or $co1 -eq $m.Groups[1].Value) { return [int64]$m.Groups[2].Value } }
  return [int64]('0' + [regex]::Match($r.body, '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value)
}
function LCount {
  $r = LPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>')
  return [int]('0' + [regex]::Match($r.body, '<RESULT[^>]*>\s*(\d+)').Groups[1].Value)
}
function LLed([int]$i, [string]$pan) {
  $n = 'LL Ledger {0:d5}' -f $i
  $grp = @('Sundry Debtors', 'Sundry Creditors', 'Indirect Expenses', 'Indirect Incomes')[$i % 4]
  $x = '<LEDGER NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><PARENT>' + $grp + '</PARENT><LEDSTATENAME>Delhi</LEDSTATENAME>'
  if ($i % 4 -lt 2) { $x += '<INCOMETAXNUMBER>' + $pan + '</INCOMETAXNUMBER><OPENINGBALANCE>' + $(if ($i % 2) { '' } else { '-' }) + (100 + $i % 900) + '.00</OPENINGBALANCE>' }
  return $x + '</LEDGER>'
}
function LPan([int]$i, [string]$l = 'P') { 'AAA' + $l + 'L' + ('{0:d4}' -f ($i % 10000)) + 'K' }
function LImport([string[]]$objs) {
  $r = LPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + ($objs -join '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
  return [pscustomobject]@{ created = [int]('0' + [regex]::Match($r.body, '<CREATED>(\d+)').Groups[1].Value); altered = [int]('0' + [regex]::Match($r.body, '<ALTERED>(\d+)').Groups[1].Value); ms = $r.ms; ok = $r.ok }
}
$lightX = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LLLight</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="LLLight" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
$med = { param($a) $s = @($a | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { -1 } }
$ledCsv = Join-Path $out 'ledlist.csv'
# the full list, as keep's round reads it
function LList([string]$label) {
  $bound = LAltM; $count = LCount
  $g = LPost (LReq $tplGroups 0 0)
  $rows = @(); $after = [int64]0; $total = [Diagnostics.Stopwatch]::StartNew(); $guids = @{}; $timeouts = 0
  $rows += [pscustomobject]@{ size = $label; req = 'FinComGroups'; span = '-'; ms = $g.ms; n = ([regex]::Matches($g.body, '<GROUP NAME=')).Count; light = -1; responding = $true; bytes = $g.body.Length }
  while ($true) {
    $tail = ($after -ge $bound); $upto = if ($tail) { 0 } else { $after + 2000 }
    $r = LPost (LReq $(if ($tail) { $tplTail } else { $tplChunk }) $after $upto)
    $n = 0; foreach ($m in [regex]::Matches($r.body, '<GUID[^>]*>([^<]+)</GUID>')) { $guids[$m.Groups[1].Value] = 1; $n++ }
    if (-not $r.ok) { $timeouts++ }
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
    $resp = [bool]($p -and $p.Responding)
    $l = LPost $lightX
    $rows += [pscustomobject]@{ size = $label; req = 'FinComLedgers'; span = $(if ($tail) { "from $($after + 1)" } else { "$($after + 1)-$upto" }); ms = $r.ms; n = $n; light = $l.ms; responding = ($resp -and $l.ok); bytes = $r.body.Length; ok = $r.ok }
    Write-Host ("[ledlist] {0} FinComLedgers {1}: {2} ms, {3} ledgers, {4} bytes; then the company list {5} ms, window responding {6}" -f $label, $rows[-1].span, $r.ms, $n, $r.body.Length, $l.ms, $resp)
    if (-not $r.ok) { LFresh "a ledger chunk did not answer in 30 s ($label)"; break }
    if ($tail) { break }
    $after = $upto
    Start-Sleep -Milliseconds ([math]::Max(200, [int]($r.ms * 0.5)))
  }
  $total.Stop()
  $rows | Export-Csv $ledCsv -Append -NoTypeInformation -Encoding UTF8
  $ch = @($rows | Where-Object { $_.req -eq 'FinComLedgers' })
  $ms = @($ch | ForEach-Object { $_.ms }); $worst = ($ms | Measure-Object -Maximum).Maximum; $sum = ($ms | Measure-Object -Sum).Sum
  $over = @($ch | Where-Object { $_.ms -ge 2000 }).Count; $unresp = @($rows | Where-Object { -not $_.responding }).Count
  $lights = @($ch | ForEach-Object { $_.light }); $lw = ($lights | Measure-Object -Maximum).Maximum
  $state = if ($timeouts) { 'FAIL' } elseif ($over -or $unresp -or $guids.Count -ne $count) { 'FAIL' } else { 'PASS' }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} ledlist L1 {1}: Tally's ledgers {2}, ALTMSTID {3}; {4} FinComLedgers requests (2,000 MasterIDs each, the last with no upper end): median {5} ms, worst {6} ms, sum {7} ms; the whole round (groups {8} ms, the bridge's rests included) {9} ms; ledgers read {10} (distinct GUIDs); requests at or over 2 s: {11}; timeouts {12}; between chunks the company list answered in median {13} ms, worst {14} ms, Tally's window not responding {15} times" -f `
    $state, $label, $count, $bound, $ch.Count, (& $med $ms), $worst, [math]::Round($sum), $g.ms, [math]::Round($total.Elapsed.TotalMilliseconds), $guids.Count, $over, $timeouts, (& $med $lights), $lw, $unresp)
}
# FinComLedgerChanges for the span (a, m], 200 AlterIDs a request, 10 requests at most, as ledAskChanges
function LChanges([string]$label, [int]$k, [int]$base) {
  $m0 = LAltM
  $objs = @(); for ($i = $base; $i -lt $base + $k; $i++) { $n = 'LL Ledger {0:d5}' -f $i; $objs += '<LEDGER NAME="' + $n + '" ACTION="Alter"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><INCOMETAXNUMBER>' + (LPan $i 'C') + '</INCOMETAXNUMBER></LEDGER>' }
  $imp = LImport $objs
  $m = LAltM
  $a = $m0; $reqs = 0; $rows = 0; $ms = @(); $names = @{}
  while ($reqs -lt 10 -and $a -lt $m) {
    $upto = [math]::Min($a + 200, $m)
    $r = LPost (LReq $tplCh $a $upto); $reqs++; $ms += $r.ms
    foreach ($x in [regex]::Matches($r.body, '<LEDGER NAME="([^"]+)"')) { $names[$x.Groups[1].Value] = 1; $rows++ }
    Write-Host "[ledlist] $label FinComLedgerChanges AlterID $($a + 1)-${upto}: $($r.ms) ms, $([regex]::Matches($r.body, '<LEDGER NAME=').Count) ledgers"
    if (-not $r.ok) { LFresh "ledger changes did not answer in 30 s ($label)"; break }
    $a = $upto
  }
  $want = 0; for ($i = $base; $i -lt $base + $k; $i++) { if ($names.ContainsKey(('LL Ledger {0:d5}' -f $i))) { $want++ } }
  $worst = ($ms | Measure-Object -Maximum).Maximum
  $state = if ($want -eq $k -and $worst -lt 2000) { 'PASS' } else { 'FAIL' }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} ledlist L2 {1} after {2} ledger(s) altered (XML, {3} altered): ALTMSTID {4} -> {5}; {6} FinComLedgerChanges request(s): {7} ms (worst {8}); ledgers answered {9}, of the altered ones {10} of {2}" -f $state, $label, $k, $imp.altered, $m0, $m, $reqs, ($ms -join ', '), $worst, $rows, $want)
}
Info "ledlist: request templates from the ref's source: $((Get-ChildItem $lq -Filter *.xml | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash.Substring(0, 12))" }) -join ', ')"
$made = 0; $start = LCount
Info "ledlist: Tally's ledgers before: $start"
foreach ($target in 2000, 5000, 20000) {
  $need = $target - (LCount)
  for ($i = $made; $i -lt $made + $need; $i += 1000) {
    $objs = @(); for ($j = $i; $j -lt [math]::Min($i + 1000, $made + $need); $j++) { $objs += LLed ($j + 1) (LPan ($j + 1)) }
    $r = LImport $objs; Write-Host "[ledlist] import of $($objs.Count) ledgers: created $($r.created) in $($r.ms) ms"
  }
  $made += [math]::Max(0, $need)
  $label = "$target"
  Info "ledlist: company at ~$target ledgers: Tally has $(LCount), ALTMSTID $(LAltM)"
  LList $label
  LChanges $label 1 (1 + ($target % 997))
  LChanges $label 50 (1000)
  LList "$target-again"
}
