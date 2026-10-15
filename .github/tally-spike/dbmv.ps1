# Mode dbm (bridge 2.4.5, MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally; no bridge).
# Dot-sourced by flowv.ps1 after c2. Every request one at a time, the harness stopping at 2 s and then awaiting Tally's
# late answer (dblib.ps1 TStop), so each row has: in time / overrun, Tally's full time, Tally responding after.
#   k1 test data: ZZ BIG TEST's masters and its vouchers re-dated (dbm\redate.py) onto Educational-mode days: 31-Jan-2026
#      300 entries (the year before), 01-Jun-2026 50, 02-Jul-2026 300, 31-Aug-2026 800, 01-Dec-2025 none, 8 on each other
#      1st / 2nd / 31st; ~1,240 ledgers. Tally's own counts per day and type (an undated list, no time limit) are the truth
#   k2 the Day Book for ONE day, forms D1-D4 (the 2.4.4 source's four date forms) and D5 (D1 + SVCURRENTDATE): does the
#      date apply (every entry returned dated that day, as many as Tally holds), time, overrun; 2 tries each
#   k3 the same day by the collection date forms FinComDatesProbe 1-7 (heads only)
#   k4 a day split by voucher type: S1 (Day Book + VOUCHERTYPENAME, D1 and D4), S2 (Voucher Register + VOUCHERTYPENAME, D1
#      and D4), S3 (FinComDatesProbe 5 / 7 + the type, then each entry by FinComVoucherObject): exact per type, under 2 s
#   k5 the ledger count, forms L1-L5 at ~1,240 and ~5,000 ledgers: exact against Tally's own list, time, overrun; and the
#      FinComLedgers chunks (the read the bar shows) timed, so the progress cadence is known
#   k6 the rule itself: never two requests at Tally, every overrun kept, Tally responding after each
# MEASURE lines carry the numbers; dbm-times.csv every request.
. (Join-Path $PSScriptRoot 'dblib.ps1')
$K1 = 'k1 test data made in Tally (ledgers, entries on the test days as Tally holds them)'
$K2 = 'k2 the Day Book for one day: the date forms that give exactly that day'
$K3 = 'k3 the collection date forms (FinComDatesProbe) for one day'
$K4 = 'k4 a day split by voucher type: exact per type, each under 2 s'
$K5 = 'k5 the ledger count: candidate forms exact at ~1,240 and ~5,000 ledgers, under 2 s'
$K6 = 'k6 one request at a time, 2 s hard stop: overruns kept, Tally responding after each'
$kDone = @{}
function KRes($c, $st, $ev) { if (-not $kDone[$c]) { Result $c $st $ev; $kDone[$c] = $true } }
$rows = [Collections.Generic.List[object]]::new()
# every measured request: a hung one (no answer in 60 s) is followed by a restart of this Tally before anything else is sent
function TS([string]$x, [int]$a = 2000, [int]$b = 60000) { $r = TStop $x $a $b; if ($r.hung) { $script:hungN++; $null = DbRestart "hung$($script:hungN)" }; return $r }
$script:hungN = 0
function Row([string]$what, [string]$form, [string]$day, $r, $extra) {
  if ($r.hung) { Info "dbm: $what $form $day hung ($($r.err)): Tally restarted" }
  $l = DbLight
  $o = [pscustomobject]@{ what = $what; form = $form; day = $day; ms = $r.ms; inTime = $r.inTime; overrun = $r.overrun; hung = $r.hung; ok = $r.ok; err = $r.err; chars = $r.body.Length; lightMs = $l.ms; lightOk = $l.ok; responding = $l.responding }
  if ($extra) { foreach ($k in $extra.Keys) { $o | Add-Member -NotePropertyName $k -NotePropertyValue $extra[$k] } }
  $rows.Add($o)
  Write-Host ("[dbm] {0} {1} {2}: {3} ms{4}{5}, {6} chars; light {7} ms, responding {8} {9}" -f $what, $form, $day, $r.ms, $(if ($r.overrun) { ' OVERRUN' } else { '' }), $(if ($r.err) { " ($($r.err))" } else { '' }), $r.body.Length, $l.ms, $l.responding, $(if ($extra) { ($extra.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ' }))
  return $o
}
$DAYS = @('20260601', '20260702', '20260831', '20260131', '20251201')
try {
  Say '---- dbm: test data'
  $made = DbMakeData
  $nLed = DbLedgersTo 1240
  $tv = TruthVouchers
  $truth = @{}; foreach ($d in $DAYS) { $truth[$d] = @($tv | Where-Object { $_.date -eq $d }) }
  $tByType = { param($d) $h = [ordered]@{}; foreach ($g in ($truth[$d] | Group-Object type | Sort-Object Name)) { $h[$g.Name] = $g.Count }; $h }
  $ev = ($DAYS | ForEach-Object { "$_=$($truth[$_].Count)" }) -join ', '
  Info "dbm: $made; ledgers $nLed; entries in Tally $($tv.Count); per test day $ev"
  foreach ($d in $DAYS) { Info ("dbm: truth {0}: {1}" -f $d, ((& $tByType $d).GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join ', ') }
  $ok1 = $truth['20260831'].Count -ge 600 -and $truth['20260702'].Count -ge 200 -and $truth['20260601'].Count -ge 30 -and $truth['20251201'].Count -eq 0
  KRes $K1 $(if ($ok1 -and $nLed -ge 1200) { 'PASS' } else { 'HARNESS' }) "$made; ledgers $nLed; per test day (Tally's own list): $ev"

  Say '---- dbm: the Day Book for one day, each date form'
  foreach ($d in $DAYS) {
    foreach ($f in 'D1', 'D2', 'D3', 'D4', 'D5') {
      for ($i = 1; $i -le 2; $i++) {
        $r = TS (DayReq $f $d) 2000 60000
        $e = Entries $r.body; $on = @($e | Where-Object { $_.date -eq $d }).Count; $dates = @($e | ForEach-Object { $_.date } | Sort-Object -Unique)
        $applied = $r.ok -and ($on -eq $e.Count) -and ($e.Count -eq $truth[$d].Count)
        if ($i -eq 1 -and $d -eq '20260702') { DbSave "daybook-$f-$d.xml" $r.body }
        $null = Row 'daybook' $f $d $r @{ got = $e.Count; onDay = $on; want = $truth[$d].Count; applied = $applied; dates = (($dates | Select-Object -First 4) -join '/') + $(if ($dates.Count -gt 4) { "/+$($dates.Count - 4)" }) }
      }
    }
  }
  $dbRows = @($rows | Where-Object { $_.what -eq 'daybook' })
  $formOk = @{}
  foreach ($f in 'D1', 'D2', 'D3', 'D4', 'D5') {
    $fr = @($dbRows | Where-Object { $_.form -eq $f }); $s = @($fr | Sort-Object ms)
    $formOk[$f] = (@($fr | Where-Object { -not $_.applied }).Count -eq 0)
    $byDay = ($DAYS | ForEach-Object { $dd = $_; $x = @($fr | Where-Object { $_.day -eq $dd }); "$dd got $($x[0].got)/$($x[0].want) on-day $($x[0].onDay) worst $((@($x | Sort-Object ms))[-1].ms) ms" }) -join '; '
    Add-Content -Path $resultsFile -Value ("MEASURE daybook {0}: applied on every day {1}; overruns {2}/{3}; worst {4} ms; {5}" -f $f, $formOk[$f], @($fr | Where-Object { $_.overrun }).Count, $fr.Count, $s[-1].ms, $byDay) -Encoding UTF8
  }
  $good = @($formOk.Keys | Where-Object { $formOk[$_] } | Sort-Object)
  KRes $K2 $(if ($good.Count) { 'PASS' } else { 'FAIL' }) ("forms that give exactly the day on all five days: {0}; the others: {1}" -f $(if ($good.Count) { $good -join ', ' } else { 'NONE' }), ((@('D1', 'D2', 'D3', 'D4', 'D5') | Where-Object { -not $formOk[$_] }) -join ', '))

  Say '---- dbm: the collection date forms for one day'
  $cOk = @{}
  foreach ($n in 1..7) {
    $bad = 0
    foreach ($d in $DAYS) {
      $r = TS (WithDay $script:RQ["datesprobe-$n"] $d) 2000 60000
      $e = Entries $r.body; $on = @($e | Where-Object { $_.date -eq $d }).Count
      $applied = $r.ok -and ($on -eq $e.Count) -and ($e.Count -eq $truth[$d].Count)
      if (-not $applied) { $bad++ }
      $null = Row 'collection' "C$n" $d $r @{ got = $e.Count; onDay = $on; want = $truth[$d].Count; applied = $applied }
    }
    $cOk["C$n"] = ($bad -eq 0)
    $fr = @($rows | Where-Object { $_.what -eq 'collection' -and $_.form -eq "C$n" })
    Add-Content -Path $resultsFile -Value ("MEASURE collection C{0} (FinComDatesProbe form {0}): applied on every day {1}; overruns {2}/{3}; worst {4} ms; got {5}" -f $n, $cOk["C$n"], @($fr | Where-Object { $_.overrun }).Count, $fr.Count, (@($fr | Sort-Object ms))[-1].ms, (($fr | ForEach-Object { "$($_.day) $($_.got)/$($_.want)" }) -join ', ')) -Encoding UTF8
  }
  $cgood = @($cOk.Keys | Where-Object { $cOk[$_] } | Sort-Object)
  KRes $K3 $(if ($cgood.Count) { 'PASS' } else { 'FAIL' }) ("collection forms that give exactly the day on all five days: {0}" -f $(if ($cgood.Count) { $cgood -join ', ' } else { 'NONE' }))

  Say '---- dbm: a day split by voucher type'
  $splitDays = @('20260831', '20260702', '20260131')
  $sOk = @{}
  foreach ($kind in 'S1', 'S2', 'S3') {
    $forms = if ($kind -eq 'S3') { @('5', '7') } else { @('D1', 'D4') }
    foreach ($f in $forms) {
      $key = "$kind-$f"; $sOk[$key] = $true
      foreach ($d in $splitDays) {
        $tt = & $tByType $d
        foreach ($type in $tt.Keys) {
          $r = TS (SplitReq $kind $f $d $type) 2000 60000
          $e = Entries $r.body; $mine = @($e | Where-Object { $_.date -eq $d -and ($_.type -eq $type -or -not $_.type) }).Count
          $exact = $r.ok -and $e.Count -eq $tt[$type] -and $mine -eq $e.Count
          if (-not $exact -or -not $r.inTime) { $sOk[$key] = $false }
          if ($d -eq '20260831' -and $type -eq 'Sales') { DbSave "split-$key-$d-Sales.xml" $r.body }
          $null = Row 'split' $key "$d $type" $r @{ got = $e.Count; want = $tt[$type]; exact = $exact }
        }
      }
      $fr = @($rows | Where-Object { $_.what -eq 'split' -and $_.form -eq $key })
      Add-Content -Path $resultsFile -Value ("MEASURE split {0}: exact and under 2 s for every type on 31-Aug / 02-Jul / 31-Jan {1}; overruns {2}/{3}; worst {4} ms; {5}" -f $key, $sOk[$key], @($fr | Where-Object { $_.overrun }).Count, $fr.Count, (@($fr | Sort-Object ms))[-1].ms, (($fr | ForEach-Object { "$($_.day) $($_.got)/$($_.want) $($_.ms)ms" }) -join '; ')) -Encoding UTF8
    }
  }
  # S3's second half: each entry of the 50-entry and 300-entry days (and 100 of the 800-entry day) by FinComVoucherObject
  foreach ($d in '20260601', '20260702', '20260831') {
    $mids = @($truth[$d] | ForEach-Object { $_.mid } | Where-Object { $_ }); if ($d -eq '20260831') { $mids = @($mids | Select-Object -First 100) }
    $times = @(); $ov = 0; $fail = 0
    foreach ($mid in $mids) {
      $r = TS ($script:RQ['entry-object'].Replace('@@CO@@', (LE $co1)).Replace('ID:99999<', "ID:$mid<")) 2000 60000
      $times += $r.ms; if ($r.overrun) { $ov++ }; if (-not $r.ok -or $r.body -notmatch '<VOUCHER') { $fail++ }
    }
    $s = @($times | Sort-Object); $l = DbLight
    $rows.Add([pscustomobject]@{ what = 'object'; form = 'FinComVoucherObject'; day = $d; ms = $s[-1]; inTime = ($ov -eq 0); overrun = ($ov -gt 0); hung = $false; ok = ($fail -eq 0); err = ''; chars = 0; lightMs = $l.ms; lightOk = $l.ok; responding = $l.responding })
    Add-Content -Path $resultsFile -Value ("MEASURE split S3 entries {0}: {1} entries by FinComVoucherObject, total {2} ms, worst {3} ms, median {4} ms, overruns {5}, not answered {6}" -f $d, $mids.Count, [math]::Round(($times | Measure-Object -Sum).Sum), $s[-1], $s[[int][math]::Floor(($s.Count - 1) / 2)], $ov, $fail) -Encoding UTF8
  }
  $sgood = @($sOk.Keys | Where-Object { $sOk[$_] } | Sort-Object)
  KRes $K4 $(if ($sgood.Count) { 'PASS' } else { 'FAIL' }) ("split forms exact and under 2 s for every type on the 800 / 300 / 300 days: {0}" -f $(if ($sgood.Count) { $sgood -join ', ' } else { 'NONE' }))

  Say '---- dbm: the ledger count'
  $k5 = @()
  foreach ($size in 1240, 5000) {
    $want = DbLedgersTo $size
    $am = AltMst
    foreach ($f in 'L1', 'L2', 'L3', 'L4', 'L5') {
      for ($i = 1; $i -le 3; $i++) {
        $n = -1; $r = $null; $parts = 0; $tot = 0.0; $anyOver = $false
        switch ($f) {
          'L1' { $r = TS (LedCountReq 'L1') 2000 60000; $n = [int64]('0' + [regex]::Match($r.body, '<RESULT[^>]*>\s*(\d+)').Groups[1].Value); $tot = $r.ms; $anyOver = $r.overrun }
          'L2' { $r = TS (LedCountReq 'L2') 2000 60000; $v = [regex]::Match($r.body, '<FCLEDGERCOUNT[^>]*>\s*(\d+)'); $n = if ($v.Success) { [int64]$v.Groups[1].Value } else { -1 }; $tot = $r.ms; $anyOver = $r.overrun }
          'L5' { $r = (AltMst).r; $n = [int64]('0' + [regex]::Match($r.body, '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value); $tot = $r.ms; $anyOver = $r.overrun }
          default {
            # L3 / L4: one request for all (i = 1), then chunked by 2,000 MasterIDs up to AltMstId and the open end (i = 2, 3)
            $tpl = if ($f -eq 'L3') { 'ledids' } else { 'names' }
            if ($i -eq 1) { $r = TS (WithRange $script:RQ["$tpl-tail"] 0 0) 2000 60000; $n = CountRows $r.body 'LEDGER'; $tot = $r.ms; $anyOver = $r.overrun; $parts = 1 }
            else {
              $n = 0; $a = 0L
              while ($true) {
                $tail = ($a -ge $am.v); $r = TS $(if ($tail) { WithRange $script:RQ["$tpl-tail"] $a 0 } else { WithRange $script:RQ["$tpl-chunk"] $a ($a + 2000) }) 2000 60000
                $parts++; $tot += $r.ms; if ($r.overrun) { $anyOver = $true }; $n += CountRows $r.body 'LEDGER'
                if ($tail -or -not $r.ok) { break }; $a += 2000
              }
            }
          }
        }
        $form = if (($f -eq 'L3' -or $f -eq 'L4') -and $i -gt 1) { "$f chunked" } else { $f }
        if ($i -eq 1) { DbSave "ledcount-$f-$size.xml" $(if ($r) { $r.body } else { '' }) }
        $rr = [pscustomobject]@{ ok = [bool]($r -and $r.ok); inTime = -not $anyOver; overrun = $anyOver; hung = [bool]($r -and $r.hung); ms = [math]::Round($tot, 1); body = $(if ($r) { $r.body } else { '' }); err = $(if ($r) { $r.err } else { '' }) }
        $null = Row 'ledcount' $form "$size" $rr @{ got = $n; want = $want; exact = ($n -eq $want); requests = [Math]::Max(1, $parts) }
      }
    }
    # the read the bar shows: FinComLedgers chunks of 2,000 MasterIDs (2.4.4 as it reads today), each chunk's time and rows
    $a = 0L; $read = 0
    while ($true) {
      $tail = ($a -ge $am.v); $r = TS $(if ($tail) { WithRange $script:RQ['ledlist-tail'] $a 0 } else { WithRange $script:RQ['ledlist-chunk'] $a ($a + 2000) }) 2000 60000
      $c = CountRows $r.body 'LEDGER'; $read += $c
      $null = Row 'ledread' 'FinComLedgers' "$size" $r @{ chunk = "$($a + 1)-$(if ($tail) { 'end' } else { $a + 2000 })"; rows = $c; soFar = $read; want = $want }
      if ($tail -or -not $r.ok) { break }; $a += 2000
    }
    foreach ($g in ($rows | Where-Object { $_.what -eq 'ledcount' -and $_.day -eq "$size" } | Group-Object form)) {
      $s = @($g.Group | Sort-Object ms); $ex = @($g.Group | Where-Object { -not $_.exact }).Count -eq 0; $ov = @($g.Group | Where-Object { $_.overrun }).Count
      Add-Content -Path $resultsFile -Value ("MEASURE ledcount {0} at {1} ledgers: exact every time {2} (got {3}, Tally's list {4}); worst {5} ms, median {6} ms; requests {7}; overruns {8}/{9}" -f $g.Name, $want, $ex, (($g.Group | ForEach-Object { $_.got } | Sort-Object -Unique) -join '/'), $want, $s[-1].ms, $s[[int][math]::Floor(($s.Count - 1) / 2)].ms, $s[-1].requests, $ov, $s.Count) -Encoding UTF8
      if ($ex -and $ov -eq 0) { $k5 += "$($g.Name)@$size" }
    }
    $lr = @($rows | Where-Object { $_.what -eq 'ledread' -and $_.day -eq "$size" })
    Add-Content -Path $resultsFile -Value ("MEASURE ledread FinComLedgers at {0} ledgers: {1} chunk(s), worst {2} ms, total {3} ms, rows read {4} of {5}, overruns {6}" -f $want, $lr.Count, (@($lr | Sort-Object ms))[-1].ms, [math]::Round(($lr | Measure-Object ms -Sum).Sum), $read, $want, @($lr | Where-Object { $_.overrun }).Count) -Encoding UTF8
  }
  $both = @('L1', 'L2', 'L3', 'L3 chunked', 'L4', 'L4 chunked', 'L5' | Where-Object { $k5 -contains "$_@1240" -and $k5 -contains "$_@5000" })
  KRes $K5 $(if ($both.Count) { 'PASS' } else { 'FAIL' }) ("forms exact and under 2 s at both sizes: {0}" -f $(if ($both.Count) { $both -join ', ' } else { 'NONE' }))

  $rows | Export-Csv (Join-Path $out 'dbm-times.csv') -NoTypeInformation
  $over = @($rows | Where-Object { $_.overrun }); $nr = @($rows | Where-Object { -not $_.responding }); $hung = @($rows | Where-Object { $_.hung })
  Add-Content -Path $resultsFile -Value ("MEASURE dbm rule: {0} requests sent, never more than {1} at Tally; overruns {2}; hung {3}; Tally not responding after {4}" -f $script:dbSent, $script:dbMaxInFlight, $over.Count, $hung.Count, $nr.Count) -Encoding UTF8
  KRes $K6 $(if ($script:dbMaxInFlight -le 1 -and $nr.Count -eq 0 -and $hung.Count -eq 0) { 'PASS' } else { 'FAIL' }) ("{0} requests, at most {1} at Tally at once; {2} overran 2 s (kept in dbm-times.csv); {3} hung; Tally not responding after {4}" -f $script:dbSent, $script:dbMaxInFlight, $over.Count, $hung.Count, $nr.Count)
} catch {
  Write-Host "dbm stopped: $_ $($_.ScriptStackTrace)"
  try { $rows | Export-Csv (Join-Path $out 'dbm-times.csv') -NoTypeInformation } catch {}
  foreach ($c in $K1, $K2, $K3, $K4, $K5, $K6) { KRes $c 'HARNESS' "the harness stopped: $_" }
}
