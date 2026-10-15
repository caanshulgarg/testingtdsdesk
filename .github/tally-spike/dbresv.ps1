# Mode dbres (bridge 2.4.5, TEST DATA ONLY: a throwaway company in this runner's own Tally; no bridge). Dot-sourced by
# flowv.ps1 after c2. The owner (15-Oct-2026): "I don't want any error because of Tally, it should work flawlessly."
# The two 2.4.5 reads are run here as docs/bridge-2.4.5-plan.md designs them (a reference model in the harness: the
# bridge's own code is built Monday and runs the same scenarios then), with Tally disturbed while they run:
#   missing days: the gaps FinCom knows (5 days: 50 / 300 / 800 entries, one in the year before, one empty), ONE day a
#     request, only while Tally is idle (process there, window responding, port open: checked without a request), 2 s hard
#     stop then the late answer awaited (nothing else sent), over 2 s -> the day split by voucher type, a type still over
#     2 s -> the day marked "upload" (one quiet line), a refused / failed request -> wait (5, 10, 20, 40, 60 s) and the SAME
#     day again (resume where it stopped)
#   ledger read: the count first (FinComLedgerIds, one request; L3 of dbm), then FinComLedgers in chunks of 500
#     MasterIDs (2,000 in the bridge; 500 here so there are many points to interrupt), a chunk over 2 s dropped and halved
#     (to 125 at least) and asked again, a failure -> wait and the same chunk again; progress "n of N" after each chunk
#   r1 Tally closed after the first day, started again 25 s later (the port before the company: Educational keys 25 s
#      after that, as a person would)
#   r2 a modal screen left open: the Day Book's date box (F2), then (a fresh run) an unsaved Receipt with its date box;
#      each closed by Esc 40 s later
#   r3 Tally not answering for 20 s (its process suspended; resumed after)
#   r4 the ledger read through each of the three
#   r5 after every scenario: the window responding and the company list answered under 2 s
# PASS needs: every day fetched or marked upload, none fetched twice, the run resumed at the day / chunk it stopped on,
# no request sent while Tally was not idle, the harness never had to restart Tally (no hung request), and the end state
# right (every ledger once, progress never back, the count equal to Tally's own list).
. (Join-Path $PSScriptRoot 'dblib.ps1')
$R1 = 'r1 missing days with Tally closed and reopened: resumed, every day fetched or marked upload, nothing twice'
$R2 = 'r2 missing days with a modal screen left open: no request held over 2 s unseen, finished after it closed'
$R3 = 'r3 missing days with Tally not answering: stopped at 2 s, waited, resumed'
$R4 = 'r4 the ledger read through close / modal / not answering: every ledger once, progress never back, count right'
$R5 = 'r5 Tally responsive at the end of every scenario'
$rDone = @{}
function RRes($c, $st, $ev) { if (-not $rDone[$c]) { Result $c $st $ev; $rDone[$c] = $true } }
$GAPS = @('20260601', '20260702', '20260831', '20260131', '20251201')
$TYPES = @('Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra')
$script:hungN = 0
$log = [Collections.Generic.List[object]]::new()
function Ev([string]$sc, [string]$what, [string]$detail) { $log.Add([pscustomobject]@{ at = (Get-Date -Format 'HH:mm:ss.fff'); scenario = $sc; what = $what; detail = $detail }); Write-Host "[dbres $sc] $what $detail" }
# the disturbances: in order, each after N days / chunks done ('n') or S seconds after the one before ('s')
function Fire($sc, $events, $done) {
  while ($script:evI -lt $events.Count) {
    $e = $events[$script:evI]
    $due = if ($e.n) { $done -ge $e.n } else { ((Get-Date) - $script:evLast).TotalSeconds -ge $e.s }
    if (-not $due) { return }
    Ev $sc 'disturb' $e.label; & $e.act; $script:evI++; $script:evLast = Get-Date
  }
}
function Wait-Back($sc, $events, $done, [ref]$k) {
  $w = [Math]::Min(60, 5 * [Math]::Pow(2, $k.Value)); $k.Value++
  Ev $sc 'wait' "$w s"
  $until = (Get-Date).AddSeconds($w)
  while ((Get-Date) -lt $until) { Fire $sc $events $done; Start-Sleep -Milliseconds 500 }
}
# an answer that is not a company's data (the company not loaded yet, Tally's own error text)
function NotReady([string]$b) { return (-not $b) -or ($b -notmatch '<ENVELOPE') -or ($b -match '(?i)could not find|company not|<LINEERROR>') }
function DayRun([string]$sc, $events, $truth) {
  $script:evI = 0; $script:evLast = Get-Date
  $st = [ordered]@{}; foreach ($d in $GAPS) { $st[$d] = [pscustomobject]@{ state = 'pending'; got = -1; via = ''; times = 0; fails = 0 } }
  $sentNotIdle = 0; $resumed = 0; $k = 0; $quiet = @(); $overruns = 0; $deadline = (Get-Date).AddMinutes(14); $wasFail = $null
  while (@($st.Values | Where-Object { $_.state -eq 'pending' }).Count -and (Get-Date) -lt $deadline) {
    $done = @($st.Values | Where-Object { $_.state -ne 'pending' }).Count
    Fire $sc $events $done
    if (-not (DbIdle)) { Ev $sc 'not idle' 'nothing sent'; Wait-Back $sc $events $done ([ref]$k); continue }
    $d = @($st.Keys | Where-Object { $st[$_].state -eq 'pending' })[0]
    if ($wasFail -and $wasFail -eq $d) { $resumed++ }
    $r = TStop (DayReq $script:dayForm $d) 2000 45000; $st[$d].times++
    if ($r.hung) { $script:hungN++; Ev $sc 'HUNG' "$d ($($r.err)): the harness restarts Tally"; $null = DbRestart "$sc-hung"; continue }
    if (-not $r.ok -or ($r.inTime -and (NotReady $r.body))) { $st[$d].fails++; $wasFail = $d; Ev $sc 'not answered' "$d $($r.ms) ms $($r.err)"; Wait-Back $sc $events $done ([ref]$k); continue }
    $k = 0
    if ($r.inTime) {
      $e = Entries $r.body; $st[$d].got = $e.Count; $st[$d].via = 'day'; $st[$d].state = 'done'; Ev $sc 'day' "$d $($e.Count) entries (Tally $($truth[$d])) $($r.ms) ms"
    } else {
      $overruns++; Ev $sc 'over 2 s' "$d $($r.ms) ms: split by type"
      $sum = 0; $bad = $false
      foreach ($t in $TYPES) {
        Fire $sc $events $done
        if (-not (DbIdle)) { $bad = $true; Ev $sc 'not idle' "split $d $t"; break }
        $rs = TStop (SplitReq 'S1' $script:dayForm $d $t) 2000 45000
        if ($rs.hung) { $script:hungN++; $null = DbRestart "$sc-hung"; $bad = $true; break }
        if (-not $rs.ok -or -not $rs.inTime -or (NotReady $rs.body)) { $bad = $true; Ev $sc 'split over 2 s or not answered' "$d $t $($rs.ms) ms"; break }
        $sum += @(Entries $rs.body | Where-Object { $_.date -eq $d }).Count
      }
      if (-not $bad -and $sum -eq $truth[$d]) { $st[$d].got = $sum; $st[$d].via = 'split'; $st[$d].state = 'done' }
      elseif (-not $bad) { $st[$d].state = 'upload'; $st[$d].via = "split gave $sum of $($truth[$d])"; $quiet += $d }
      else { $st[$d].state = 'upload'; $st[$d].via = 'split over 2 s'; $quiet += $d }
    }
    Start-Sleep 2   # a few days a round, a pause between
  }
  while ($script:evI -lt $events.Count) { Fire $sc $events 99; Start-Sleep 1 }   # the disturbance list always ends (Tally back, the screen closed)
  $twice = @($st.Keys | Where-Object { $st[$_].state -eq 'done' -and $st[$_].times -gt 1 -and $st[$_].fails -eq 0 }).Count
  $pending = @($st.Values | Where-Object { $_.state -eq 'pending' }).Count
  $wrong = @($st.Keys | Where-Object { $st[$_].state -eq 'done' -and $st[$_].got -ne $truth[$_] })
  foreach ($q in $quiet) { Info ("dbres {0}: the one line FinCom would show: ""Tally took too long to give {1}; please upload that day's Day Book."" " -f $sc, ([DateTime]::ParseExact($q, 'yyyyMMdd', $null).ToString('dd-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture))) }
  $l = DbLight
  return [pscustomobject]@{ pending = $pending; twice = $twice; wrong = $wrong; resumed = $resumed; overruns = $overruns; quiet = $quiet.Count; light = $l
    states = (($st.Keys | ForEach-Object { "$_ $($st[$_].state)/$($st[$_].via) $($st[$_].got) of $($truth[$_]) asked $($st[$_].times)" }) -join '; ') }
}
function LedRun([string]$sc, $events, [int]$want) {
  $script:evI = 0; $script:evLast = Get-Date
  $seen = @{}; $dupes = 0; $count = -1; $a = 0L; $size = 500; $k = 0; $back = 0; $last = 0; $prog = @(); $resumed = 0; $deadline = (Get-Date).AddMinutes(14); $failAt = $null
  $am = AltMst; $alt = $am.v
  while ((Get-Date) -lt $deadline) {
    Fire $sc $events $prog.Count
    if (-not (DbIdle)) { Ev $sc 'not idle' 'nothing sent'; Wait-Back $sc $events $prog.Count ([ref]$k); continue }
    if ($count -lt 0) {
      $r = TStop (WithRange $script:RQ['ledids-tail'] 0 0) 2000 45000
      if ($r.hung) { $script:hungN++; $null = DbRestart "$sc-hung"; continue }
      if ($r.ok -and $r.inTime -and -not (NotReady $r.body)) { $count = CountRows $r.body 'LEDGER'; Ev $sc 'count' "$count ledgers ($($r.ms) ms)"; if ($alt -le 0) { $alt = (AltMst).v } } else { Ev $sc 'count not answered' "$($r.ms) ms $($r.err)"; Wait-Back $sc $events $prog.Count ([ref]$k) }
      continue
    }
    $tail = ($a -ge $alt)
    if ($failAt -ne $null -and $failAt -eq $a) { $resumed++; $failAt = $null }
    $r = TStop $(if ($tail) { WithRange $script:RQ['ledlist-tail'] $a 0 } else { WithRange $script:RQ['ledlist-chunk'] $a ($a + $size) }) 2000 45000
    if ($r.hung) { $script:hungN++; $null = DbRestart "$sc-hung"; continue }
    if (-not $r.ok -or (NotReady $r.body)) { $failAt = $a; Ev $sc 'chunk not answered' "from $($a + 1): $($r.ms) ms $($r.err)"; Wait-Back $sc $events $prog.Count ([ref]$k); continue }
    if ($r.overrun) { $size = [Math]::Max(125, [int]($size / 2)); $failAt = $a; Ev $sc 'chunk over 2 s' "from $($a + 1): $($r.ms) ms, dropped; next $size"; continue }
    $k = 0
    foreach ($m in [regex]::Matches($r.body, '(?s)<LEDGER NAME="[^"]*"[^>]*>.*?</LEDGER>')) { $g = [regex]::Match($m.Value, '<GUID[^>]*>([^<]+)<').Groups[1].Value; if ($seen.ContainsKey($g)) { $dupes++ } else { $seen[$g] = 1 } }
    if ($seen.Count -lt $last) { $back++ }; $last = $seen.Count; $prog += $seen.Count
    Ev $sc 'progress' "$($seen.Count) of $count"
    if ($tail) { break }; $a += $size
  }
  while ($script:evI -lt $events.Count) { Fire $sc $events 9999; Start-Sleep 1 }
  $l = DbLight
  return [pscustomobject]@{ count = $count; read = $seen.Count; want = $want; dupes = $dupes; back = $back; resumed = $resumed; done = ($seen.Count -gt 0 -and $a -ge $alt); light = $l; steps = $prog.Count }
}
$closeEv = @(
  @{ n = 1; label = 'Tally closed'; act = { DbClose } },
  @{ s = 25; label = 'Tally started (port first, no company yet)'; act = { DbStartNoWait } },
  @{ s = 25; label = 'Educational keys (the company loads)'; act = { DbStartKeys 'dbres-reopen' } })
$modal1 = @(
  @{ n = 1; label = 'the Day Book''s date box (F2) left open'; act = { DbModalDayBookDate } },
  @{ s = 40; label = 'Esc: the date box closed'; act = { KeysTo '{ESC}' 3 'db-modal-closed' } })
$modal2 = @(
  @{ n = 1; label = 'an unsaved Receipt with its date box left open'; act = { DbModalEntry } },
  @{ s = 40; label = 'Esc: the date box closed (the entry screen stays)'; act = { KeysTo '{ESC}' 3 'db-modal2-closed' } })
$suspEv = @(
  @{ n = 1; label = 'Tally not answering (suspended)'; act = { DbSuspend } },
  @{ s = 20; label = 'Tally answering again (resumed)'; act = { DbResume; Say 'db: Tally resumed' } })
try {
  Say '---- dbres: test data'
  $made = DbMakeData
  $nLed = DbLedgersTo 5000
  $tv = TruthVouchers
  $truth = @{}; foreach ($d in $GAPS) { $truth[$d] = @($tv | Where-Object { $_.date -eq $d }).Count }
  Info "dbres: $made; ledgers $nLed; per gap day $(($GAPS | ForEach-Object { "$_=$($truth[$_])" }) -join ', ')"
  $r5 = @()
  # the Day Book form the loop uses: the first of D1-D4 that gives exactly each gap day on this Tally, undisturbed (dbm
  # measures them all); none: D1, and a day's count is then not judged (only that the run ends right)
  $script:dayForm = $null
  foreach ($f in 'D1', 'D2', 'D3', 'D4') {
    $all = $true
    foreach ($d in $GAPS) { $r = TStop (DayReq $f $d) 2000 60000; $e = Entries $r.body; if (-not $r.ok -or $e.Count -ne $truth[$d] -or @($e | Where-Object { $_.date -ne $d }).Count) { $all = $false; break } }
    if ($all) { $script:dayForm = $f; break }
  }
  $judgeCount = [bool]$script:dayForm; if (-not $script:dayForm) { $script:dayForm = 'D1' }
  Info "dbres: the loop's Day Book form $($script:dayForm) (gives exactly each day: $judgeCount)"
  $okDay = { param($x) $x.pending -eq 0 -and $x.twice -eq 0 -and (-not $judgeCount -or $x.wrong.Count -eq 0) }

  Say '---- dbres r1: Tally closed and reopened during the missing days'
  $null = DbRestart 'r1'; $h0 = $script:hungN
  $x1 = DayRun 'r1' $closeEv $truth; $r5 += "r1 light $($x1.light.ms) ms ok $($x1.light.ok) responding $($x1.light.responding)"
  RRes $R1 $(if ((& $okDay $x1) -and $script:hungN -eq $h0) { 'PASS' } else { 'FAIL' }) ("{0}; resumed at the same day {1} time(s); over 2 s {2}; upload lines {3}; harness restarts {4}" -f $x1.states, $x1.resumed, $x1.overruns, $x1.quiet, ($script:hungN - $h0))

  Say '---- dbres r2: a modal screen left open during the missing days'
  $null = DbRestart 'r2a'; $h0 = $script:hungN
  $x2a = DayRun 'r2a' $modal1 $truth; $r5 += "r2a light $($x2a.light.ms) ms ok $($x2a.light.ok) responding $($x2a.light.responding)"
  $null = DbRestart 'r2b'
  $x2b = DayRun 'r2b' $modal2 $truth; $r5 += "r2b light $($x2b.light.ms) ms ok $($x2b.light.ok) responding $($x2b.light.responding)"
  $mOpen = @($log | Where-Object { $_.scenario -like 'r2*' }) | ForEach-Object { "$($_.what) $($_.detail)" } | Select-Object -First 30
  Info "dbres r2 events: $($mOpen -join ' | ')"
  RRes $R2 $(if ((& $okDay $x2a) -and (& $okDay $x2b) -and $script:hungN -eq $h0) { 'PASS' } else { 'FAIL' }) ("Day Book date box: {0}; unsaved entry: {1}; harness restarts {2}" -f $x2a.states, $x2b.states, ($script:hungN - $h0))

  Say '---- dbres r3: Tally not answering during the missing days'
  $null = DbRestart 'r3'; $h0 = $script:hungN
  $x3 = DayRun 'r3' $suspEv $truth; $r5 += "r3 light $($x3.light.ms) ms ok $($x3.light.ok) responding $($x3.light.responding)"
  RRes $R3 $(if ((& $okDay $x3) -and $script:hungN -eq $h0) { 'PASS' } else { 'FAIL' }) ("{0}; resumed {1}; harness restarts {2}" -f $x3.states, $x3.resumed, ($script:hungN - $h0))

  Say '---- dbres r4: the ledger read through each'
  $lr = @(); $h0 = $script:hungN
  foreach ($p in @(@('r4close', $closeEv), @('r4modal', $modal1), @('r4susp', $suspEv))) {
    $null = DbRestart $p[0]
    $y = LedRun $p[0] $p[1] $nLed; $lr += $y; $r5 += "$($p[0]) light $($y.light.ms) ms ok $($y.light.ok) responding $($y.light.responding)"
    Info ("dbres {0}: count {1}, read {2} of Tally's {3}, twice {4}, progress back {5}, resumed {6}, steps {7}, finished {8}" -f $p[0], $y.count, $y.read, $y.want, $y.dupes, $y.back, $y.resumed, $y.steps, $y.done)
  }
  $ok4 = @($lr | Where-Object { -not ($_.done -and $_.read -eq $_.want -and $_.count -eq $_.want -and $_.dupes -eq 0 -and $_.back -eq 0) }).Count -eq 0
  RRes $R4 $(if ($ok4 -and $script:hungN -eq $h0) { 'PASS' } else { 'FAIL' }) (($lr | ForEach-Object { "count $($_.count) read $($_.read) of $($_.want) twice $($_.dupes) back $($_.back) resumed $($_.resumed)" }) -join '; ')

  $bad5 = @($r5 | Where-Object { $_ -match 'ok False|responding False' })
  RRes $R5 $(if ($bad5.Count -eq 0) { 'PASS' } else { 'FAIL' }) ($r5 -join '; ')
  $log | Export-Csv (Join-Path $out 'dbres-events.csv') -NoTypeInformation
  Add-Content -Path $resultsFile -Value ("MEASURE dbres: {0} requests, never more than {1} at Tally; harness restarts for a hung request {2}" -f $script:dbSent, $script:dbMaxInFlight, $script:hungN) -Encoding UTF8
} catch {
  Write-Host "dbres stopped: $_ $($_.ScriptStackTrace)"
  try { $log | Export-Csv (Join-Path $out 'dbres-events.csv') -NoTypeInformation } catch {}
  foreach ($c in $R1, $R2, $R3, $R4, $R5) { RRes $c 'HARNESS' "the harness stopped: $_" }
}
