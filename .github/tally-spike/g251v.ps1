# Mode g251 (the stock release's gate (2.5.2), the owner's decision of 30-Oct-2026, "1": the stock from Tally ONLY when a person clicks; TEST
# DATA ONLY, a throwaway company in this runner's own Tally). The committed setup at the ref (2.5.1) is installed; stubg.py
# is FinCom's cloud (its beat answer carries a person's click, "stock": {company: {from, to, at, again}}, only when this
# script writes the click file, as tally-ingest does for a click in FinCom); proxy235.py stands between the bridge and Tally
# (every request logged with its time and its body kept). A thread sends Tally's window WM_NULL every 100 ms (250 ms limit)
# for the whole run: every hold with its time. Dot-sourced by flowv.ps1:
#   $g251Phase = 'masters' (before the bridge starts): the company's inventory on, stockp/gen.py's company at a smaller scale
#     (400 items, godowns, batches; 3,000 entries in year 1, 300 in year 2)
#   $g251Phase = 'run' (the gate's setup running): then
#   s1 the committed setup installed: the version 2.5.1
#   s2 click only: Update now and the bridge's own rounds for 4 minutes send no FinComStockInHand
#   s3 a click: the stock answer equals Tally's stock summary (every item's own opening and closing, summed: the harness's
#      request on Tally's own port); two periods (year 1 to 31-Oct, year 2 Apr-Jun); the request exactly the owner's C1
#   s4 each stock request 2 s or less; no window hold of 2 s anywhere, none beyond the click's request
#   s5 once per company and period: the same period clicked again is answered from the kept answer (nothing at Tally);
#      Ask Tally again asks once more
#   s6 one request in flight; postings first: a posting made with a click reaches Tally at once
# A step the harness could not do is HARNESS, never PASS.
if (-not (Get-Command TStop -ErrorAction SilentlyContinue)) { . (Join-Path $PSScriptRoot 'dblib.ps1') }
$S1 = 's1 the committed setup installed over the published 2.5.1: its own version, the settings carried'
$S2 = 's2 click only: nothing asks Tally for the stock by itself'
$S3 = 's3 a click: the stock equals Tally''s stock summary, the request exactly C1'
$S4 = 's4 each stock request 2 s or less; no window hold beyond the click''s request'
$S5 = 's5 once per period: the kept answer; Ask Tally again asks once more'
$S6 = 's6 one request in flight; postings first'
function Num([string]$s) { $s = ($s -replace '[^\d.\-]', ''); if ($s -and $s -ne '-' -and $s -ne '.') { return [decimal]$s } else { return [decimal]0 } }
$RQ1 = (Get-Content (Join-Path $PSScriptRoot 'stockp\req\c1-stockinhand.xml') -Raw).Trim()
$RR1 = (Get-Content (Join-Path $PSScriptRoot 'stockp\req\r1-itemclosing-all.xml') -Raw).Trim()
function C1For([string]$from, [string]$to) { $RQ1.Replace('@@CO@@', (LE $co1)).Replace('20991201', $from).Replace('20991231', $to) }
if ($g251Phase -eq 'masters') {
  Say '---- g251 masters (before the bridge): the stock company'
  $script:g251Made = [ordered]@{}
  try {
    $gen = Join-Path $env:RUNNER_TEMP 'g251gen'
    $env:STOCKP_SCALE = '400,3000,300'
    $o = & python -I (Join-Path $PSScriptRoot 'stockp\gen.py') $gen 2>&1; Info "g251: gen.py: $o"
    $env:STOCKP_SCALE = ''
    $plan = Get-Content (Join-Path $gen 'plan.json') -Raw | ConvertFrom-Json
    foreach ($f in 'ISINTEGRATED', 'ISINVENTORYON', 'ISBATCHWISEON') {
      $k = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><' + $f + '>Yes</' + $f + '></COMPANY></TALLYMESSAGE>') "company $f Yes"
      $script:g251Made["company $f"] = "altered $($k.a), errors $($k.e)"
    }
    $k = DbImp 'All Masters' (Get-Content (Join-Path $gen 'masters.xml') -Raw -Encoding UTF8) 'masters'; $script:g251Made['masters'] = "$($k.c) created, $($k.e) errors"
    foreach ($y in 'y1', 'y2') {
      $c = 0; $e = 0
      foreach ($f in $plan.$y.files) { $k = DbImp 'Vouchers' (Get-Content (Join-Path $gen $f[0]) -Raw -Encoding UTF8) "$y $($f[0])"; $c += $k.c; $e += $k.e }
      $script:g251Made["entries $y"] = "$c created, $e errors"
    }
    Remove-Item $gen -Recurse -Force -ErrorAction SilentlyContinue
  } catch { Info "g251: the data stopped: $($_.Exception.Message)" }
  Info ("g251 masters: " + (($script:g251Made.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join '; '))
  return
}

# ---------------------------------------------------------------- run
Say '---- g251: the stock from Tally, on a click only'
$gDone = @{}
function GRes($c, $s, $ev) { if (-not $gDone[$c]) { Result $c $s $ev; $gDone[$c] = $true } }
function GProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function GBody($q) { if ($q.dump -and $env:P72_DUMP) { $f = Join-Path $env:P72_DUMP "$($q.dump)-req.xml"; if (Test-Path $f) { return [IO.File]::ReadAllText($f) } }; return '' }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function StockAsks { @((GProxy) | Where-Object { $_.id -eq 'FinComStockInHand' }) }
$clickFile = "$stubLog.stock.json"
# a person's click in FinCom, as tally-ingest hands it to the bridge (the beat's answer); the stub's answer carries it
function Click([string]$from, [string]$to, [bool]$again = $false) {
  $at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ')
  $o = @{}; $o[$co1] = @{ from = $from; to = $to; at = $at; again = $again }
  [IO.File]::WriteAllText($clickFile, ($o | ConvertTo-Json -Compress -Depth 4), [Text.UTF8Encoding]::new($false))
  return $at
}
function NoClick { Remove-Item $clickFile -Force -ErrorAction SilentlyContinue }
# the stub's lines as written (ConvertFrom-Json turns an ISO time into a DateTime: a click's time is matched in the raw text)
function StubRaw([string]$kind, [string]$at) {
  if (-not (Test-Path $stubLog)) { return }
  Get-Content $stubLog -Encoding UTF8 | Where-Object { $_.Contains('"kind": "' + $kind + '"') -and $_.Contains('"' + $at + '"') }
}
function WaitAnswer([string]$at, [int]$sec = 120) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $sec) {
    $l = @(StubRaw 'stock' $at | Where-Object { $_.Contains('"at": "' + $at + '"') }) | Select-Object -First 1
    if ($l) { NoClick; return ($l | ConvertFrom-Json).body }
    Start-Sleep 1
  }
  NoClick; return $null
}
# Tally's stock summary: every item's own opening and closing value for the period, summed (asked on Tally's own port by
# the harness; the bridge's request is not used for the truth)
function Truth([string]$from, [string]$to) {
  $r = TSetup ($RR1.Replace('@@CO@@', (LE $co1)).Replace('20991201', $from).Replace('20991231', $to)) 120
  $o = [decimal]0; $c = [decimal]0; $n = 0
  foreach ($m in [regex]::Matches($r.body, '(?s)<STOCKITEM NAME="[^"]*"[^>]*>(.*?)</STOCKITEM>')) {
    $n++; $v = $m.Groups[1].Value
    $o += Num ([regex]::Match($v, '<OPENINGVALUE[^>]*>([^<]*)<').Groups[1].Value); $c += Num ([regex]::Match($v, '<CLOSINGVALUE[^>]*>([^<]*)<').Groups[1].Value)
  }
  return [pscustomobject]@{ open = [math]::Abs($o); close = [math]::Abs($c); items = $n }
}
# ---- the window probe for the whole run (as stockpv.ps1), each hold of 250 ms or more kept with its time (unix ms)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class G251Frz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); }
'@
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; beats = 0; holds = [Collections.ArrayList]::Synchronized([Collections.ArrayList]::new()) })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $since = $null
    while (-not $f.stop) {
      $h = $f.h; $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if ($f.on -and $h -ne [IntPtr]::Zero -and [G251Frz]::IsWindow($h)) {
        $r = [IntPtr]::Zero
        $ok = [G251Frz]::SendMessageTimeout($h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r)
        $end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $now } }
        elseif ($null -ne $since) { $null = $f.holds.Add(@($since, $end)); $since = $null }
      } elseif ($null -ne $since) { $null = $f.holds.Add(@($since, $now)); $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.on = $true
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
} catch { Info "g251: the window probe could not start ($_)" }
Info "g251: window probe running $($script:frzOk) (beats $($script:frz.beats)), Tally pid $($script:tpid)"
$tStart = NowMs
try {
  NoClick
  # ---- s1: the published 2.5.1 runs (flowv.ps1 installed it); the gate's setup goes over it
  $st0 = Bridge GET '/status' $null 10
  $cfg0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  $origin = "$(Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue)"
  $vWant = [regex]::Match($origin, 'FinComBridge-Setup-([0-9.]+)\.exe').Groups[1].Value
  $setupNew = Get-ChildItem $env:BRIDGE_DIST -Filter "FinComBridge-Setup-$vWant.exe" | Select-Object -First 1
  $p = Start-Process -FilePath $setupNew.FullName -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the gate setup did not end' }
  Start-Sleep 20
  $cfg1n = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg1n.Port; $bkey = "$($cfg1n.Key)"
  $st1 = $null; for ($i = 0; $i -lt 30 -and -not $st1; $i++) { $st1 = Bridge GET '/status' $null 10; if (-not $st1) { Start-Sleep 3 } }
  Snap 'g251-upgraded'
  GRes $S1 $(if ($st0 -and "$($st0.version)" -eq '2.5.1' -and $st1 -and $vWant -and "$($st1.version)" -eq $vWant -and $origin -match '^setup origin: COMMITTED ' -and $cfg1n.Port -eq $cfg0.Port -and "$($cfg1n.Key)" -eq "$($cfg0.Key)" -and "$($cfg1n.TallyHost)" -eq "$($cfg0.TallyHost)" -and "$($cfg1n.CloudBeatSec)" -eq "$($cfg0.CloudBeatSec)") { 'PASS' } else { 'FAIL' }) ("before: {0}; the setup {1} ended {2}; after: {3}; port {4} -> {5}; key carried {6}; TallyHost {7} -> {8}; {9}" -f $(if ($st0) { "version $($st0.version)" } else { 'no answer' }), $setupNew.Name, $p.ExitCode, $(if ($st1) { "version $($st1.version)" } else { 'no answer' }), $cfg0.Port, $cfg1n.Port, ("$($cfg1n.Key)" -eq "$($cfg0.Key)"), $cfg0.TallyHost, $cfg1n.TallyHost, $origin)
  Start-Sleep 30
  # ---- s2: nothing by itself (the bridge's first rounds, Update now, 4 minutes of beats)
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  Start-Sleep 240
  Snap 'g251-noclick'
  $n2 = (StockAsks).Count; $logN = if (Test-Path $blog) { @(Get-Content $blog | Where-Object { $_ -match 'Stock of ' }).Count } else { -1 }
  $reqs = @((GProxy) | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join '; '
  GRes $S2 $(if ($n2 -eq 0 -and $logN -eq 0 -and (GProxy).Count -gt 0) { 'PASS' } elseif ((GProxy).Count -eq 0) { 'HARNESS' } else { 'FAIL' }) ("4 minutes with Update now and the bridge's own rounds: FinComStockInHand at Tally {0} time(s); 'Stock of' lines in the bridge's log {1}; the requests Tally had: {2}" -f $n2, $logN, $reqs)
  # ---- s3: two periods, each clicked once
  $pers = @(@('20260401', '20261031'), @('20270401', '20270630'))
  $ans = @{}; $ev3 = [Collections.Generic.List[string]]::new(); $ok3 = $true
  foreach ($p in $pers) {
    $before = (StockAsks).Count
    $at = Click $p[0] $p[1]
    $a = WaitAnswer $at
    $k = "$($p[0])-$($p[1])"; $ans[$k] = $a
    if (-not $a) { $ok3 = $false; $ev3.Add("$k no answer at the stub in 2 minutes"); continue }
    $t = Truth $p[0] $p[1]
    $same = $a.status -eq 'ok' -and [math]::Abs([decimal]$a.opening - $t.open) -lt 0.02 -and [math]::Abs([decimal]$a.closing - $t.close) -lt 0.02
    $new = @(StockAsks | Select-Object -Skip $before)
    $body = if ($new.Count) { GBody $new[0] } else { '' }
    $exact = $body -and ($body.Trim() -eq (C1For $p[0] $p[1]))
    if (-not $same -or $new.Count -ne 1 -or -not $exact) { $ok3 = $false }
    $ev3.Add(("{0}: the bridge {1} opening {2} closing {3} in {4} ms; Tally's stock summary ({5} items) opening {6} closing {7} {8}; requests at Tally {9}; the request {10}" -f $k, $a.status, $a.opening, $a.closing, $a.ms, $t.items, $t.open, $t.close, $(if ($same) { 'SAME' } else { 'DIFFER' }), $new.Count, $(if (-not $body) { 'body not kept' } elseif ($exact) { 'exactly C1' } else { 'NOT C1' })))
  }
  Snap 'g251-clicks'
  GRes $S3 $(if ($ok3) { 'PASS' } else { 'FAIL' }) ($ev3 -join '; ')
  # ---- s5: once per period; Ask Tally again
  $k = '20260401-20261031'; $before = (StockAsks).Count
  $a2 = WaitAnswer (Click '20260401' '20261031')
  $mid = (StockAsks).Count
  $a3 = WaitAnswer (Click '20260401' '20261031' $true)
  $after = (StockAsks).Count
  $ok5 = $a2 -and $a2.cached -eq $true -and $a2.status -eq 'ok' -and $mid -eq $before -and $a3 -and $a3.status -eq 'ok' -and $a3.cached -ne $true -and ($after - $mid) -eq 1
  GRes $S5 $(if ($ok5) { 'PASS' } elseif (-not $a2 -or -not $a3) { 'FAIL' } else { 'FAIL' }) ("the same period clicked again: {0}, requests at Tally +{1}; Ask Tally again: {2}, requests at Tally +{3}" -f $(if ($a2) { "status $($a2.status), cached $($a2.cached), readAt $($a2.readAt) (first $($ans[$k].readAt))" } else { 'no answer' }), ($mid - $before), $(if ($a3) { "status $($a3.status), cached $($a3.cached), $($a3.ms) ms" } else { 'no answer' }), ($after - $mid))
  # ---- s6: a click and a posting together
  $tR = NowMs
  $at6 = Click '20261001' '20261031'
  $imp = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt 90 -and -not $imp) {
    # the moment the bridge is handed the click (a beat answered with it): the posting from FinCom at once
    if (@(StubRaw 'beat' $at6).Count) {
      $vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g251 posting with a stock click</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
      $iS = NowMs; $ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "g251-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"; xml = $vx }) } 120; $iE = NowMs
      $imp = [pscustomobject]@{ s = $iS; e = $iE; ok = ($ir -and @($ir.results)[0].ok -eq $true) }
    } else { Start-Sleep -Milliseconds 200 }
  }
  $a6 = WaitAnswer $at6
  Start-Sleep 5
  $pxS = @((GProxy) | Where-Object { [int64]$_.t0 -ge $tStart } | Sort-Object { [int64]$_.t0 })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $pxS) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  $impReq = if ($imp) { @($pxS | Where-Object { $_.id -eq 'Import' -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -le $imp.e }) | Select-Object -First 1 } else { $null }
  $wait = if ($impReq) { [int64]$impReq.t0 - $imp.s } else { -1 }
  GRes $S6 $(if (-not $imp) { 'HARNESS' } elseif ($impReq -and $imp.ok -and $overlap -eq 0 -and $wait -lt 2500 -and $a6 -and $a6.status -eq 'ok') { 'PASS' } else { 'FAIL' }) ("requests started while another was at Tally: {0} of {1}; the posting: ok {2}, its request reached Tally {3} ms after FinCom asked; the click's answer: {4}" -f $overlap, $pxS.Count, $(if ($imp) { $imp.ok } else { '-' }), $wait, $(if ($a6) { "$($a6.status) $($a6.opening)/$($a6.closing) in $($a6.ms) ms" } else { 'none' }))
  # ---- s4: times and the window
  $script:frz.stop = $true; Start-Sleep 1
  $sa = @(StockAsks)
  $worst = ($sa | Measure-Object -Property ms -Maximum).Maximum
  $holds = @($script:frz.holds | ForEach-Object { [pscustomobject]@{ a = [int64]$_[0]; z = [int64]$_[1]; ms = [int64]$_[1] - [int64]$_[0] } })
  $long = @($holds | Where-Object { $_.ms -ge 2000 })
  # a hold that overlaps a stock request must end within 500 ms of its answer (no hold beyond the click's request)
  $beyond = @(); $inStock = @()
  foreach ($q in $sa) { foreach ($h in $holds) { if ($h.z -ge [int64]$q.t0 -and $h.a -le [int64]$q.t1) { $inStock += $h; if ($h.z -gt [int64]$q.t1 + 500) { $beyond += $h } } } }
  $holdStock = ($inStock | Measure-Object -Property ms -Maximum).Maximum
  GRes $S4 $(if (-not $script:frzOk -or -not $sa.Count) { 'HARNESS' } elseif ($worst -le 2000 -and -not $long.Count -and -not $beyond.Count) { 'PASS' } else { 'FAIL' }) ("{0} stock requests at Tally, worst {1} ms ({2}); Tally's window: {3} holds of 250 ms or more in the run, the longest {4} ms; during the stock requests the longest {5} ms; holds of 2 s or more: {6}; holds lasting beyond a stock request's answer: {7}" -f $sa.Count, $worst, (($sa | ForEach-Object { "$($_.ms)" }) -join ', '), $holds.Count, ($holds | Measure-Object -Property ms -Maximum).Maximum, $(if ($holdStock) { $holdStock } else { 0 }), $long.Count, $beyond.Count)
} catch {
  Info "g251: $_ (line $($_.InvocationInfo.ScriptLineNumber))"
  foreach ($c in $S1, $S2, $S3, $S4, $S5, $S6) { GRes $c 'HARNESS' "not done: $_" }
}
$script:frz.stop = $true
NoClick
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
