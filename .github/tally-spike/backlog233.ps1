# Bridge 2.3.3 (the owner's gate of 07-Oct-2026), input only=backlog233: the owner's own state on real TallyPrime.
# Dot-sourced by flow4.ps1 after slow232.ps1 (it reuses Slow232Setup: the large company "FinCom Slow Co" beside the small
# one in the same Tally 9000, and the timing proxy slow232proxy.py on 127.0.0.2:9000 that logs every request of bridge 1
# with its id, company, MasterID and the times it reached Tally and Tally's answer came back).
#   setup (before the bridges start): bridge 1's held list (sync\recorder-held.json) seeded with $B233.n (50) old held
#     lines of the large company, as the real file looks after a day of Tally being slow: saved yesterday, last asked 2 h
#     ago, held "the entry was not read from Tally". Every entry request of the large company takes Tally itself over 2 s
#     (the lookup of one entry in 30,000; measured in the MEASURE lines), so the bridge stops each at 2 s.
#   run (after the bridges start): a NEW save in the large company while the backlog is being asked, and small-company
#     saves. Pass means:
#     (1) the new save shows in the stub within 10 s, at least as held;
#     (2) Tally receives no more than ONE request per old held line (counted at the proxy);
#     (3) no request is sent while a previous one is still unanswered at Tally (the proxy's timestamps);
#     (4) the slow company is marked, then no requests for it;
#     (5) a small fast company's entry still arrives with its body.
$B233 = @{ n = [int]$(if ($env:B233_N) { $env:B233_N } else { 50 }); mid0 = 900001; date = '20260401'; ok = $false; dir = (Join-Path $out 'backlog233') }
New-Item -ItemType Directory -Force $B233.dir | Out-Null

function B233Setup {
  # the owner's large company answers one entry in about 2.2 s: 20,000 entries here (30,000 gave 2.6-2.9 s to the harness's
  # own request and 3.5-4.1 s at the proxy in run 37615287108); B233_VCH overrides
  $Slow232St.vch = [int]$(if ($env:B233_VCH) { $env:B233_VCH } else { 20000 })
  Slow232Setup
  if (-not $Slow232St.ok) { return }
  # the large company's GUID as Tally gives it (the held lines carry it, as the real file does); none: left empty
  $x = ListCo 9000
  $g = ''
  foreach ($m in [regex]::Matches("$x", '<COMPANY[^>]*>([\s\S]*?)</COMPANY>')) {
    $nm = [regex]::Match($m.Groups[1].Value, '<NAME[^>]*>([^<]*)</NAME>').Groups[1].Value
    if ($nm -eq $Slow232St.co) { $g = [regex]::Match($m.Groups[1].Value, '<GUID[^>]*>([^<]*)</GUID>').Groups[1].Value.Trim() }
  }
  $B233.cguid = $g
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO backlog233: the large company's GUID from Tally: '$g'"
  $B233.ok = $true
}

# bridge 1's held list, before it starts (h1: its home folder)
function B233Seed($h1) {
  if (-not $B233.ok) { return }
  $sync = Join-Path $h1 'sync'; New-Item -ItemType Directory -Force $sync | Out-Null
  $yest = (Get-Date).AddHours(-20).ToString('yyyy-MM-ddTHH:mm:sszzz'); $last = (Get-Date).AddHours(-2).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $items = [ordered]@{}
  for ($i = 0; $i -lt $B233.n; $i++) {
    $mid = $B233.mid0 + $i; $id = 'b233old{0:d3}' -f $i
    $items[$id] = [ordered]@{ company = $Slow232St.co; companyGuid = $B233.cguid; type = 'Journal'; no = ('OLD-{0:d3}' -f $i); date = $B233.date; masterId = "$mid"
      savedAt = $yest; added = $yest; last = $last; tries = 0; event = 'created'; why = "the entry was not read from Tally: Tally took longer than the recorder's limit; the bridge stopped waiting (2 s)"
      lineGuid = ''; lineFid = ''; idsMismatch = $false; final = $false; lineAlter = 0; fromFinCom = $false; keepGuid = ''; keepAlter = ''; refetch = $false; triesVersion = '2.3.2'; again = $false; ledgerAgain = $false; slow = 1 }
  }
  $f = Join-Path $sync 'recorder-held.json'
  [IO.File]::WriteAllText($f, (@{ items = $items } | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
  $B233.ids = @($items.Keys)
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO backlog233: $($B233.n) old held lines of '$($Slow232St.co)' seeded into $f before bridge 1 starts (MasterIDs $($B233.mid0)..$($B233.mid0 + $B233.n - 1), dated $($B233.date), saved yesterday, last asked 2 h ago)"
}

function B233OldDone { $l = StubLines 0; @($B233.ids | Where-Object { $id = $_; @($l | Where-Object { $_.lid -eq "${id}:resolved" }).Count -gt 0 }).Count }

function Backlog233 {
  if (-not $B233.ok) { Result 'backlog233' $false 'the setup did not finish (see the HARNESS line above)' $true; return }
  Say "---- backlog233: $($B233.n) old held lines, a large company over 2 s and a small one in the same Tally, then new saves"
  $m0 = Mark
  # the backlog is asked once the large company's starting point is recorded (the bridge's first looks): until the proxy
  # has seen 5 of the old lines' requests (6 min at most)
  $oldMids = @($B233.ids | ForEach-Object { "$($B233.mid0 + [int]($_ -replace '^b233old', ''))" })
  for ($w = 0; $w -lt 72; $w++) {
    $seen = @(S2Proxy | Where-Object { (S2Entry $_) -and $_.mid -in $oldMids }).Count
    if ($seen -ge 5) { break }
    Start-Sleep 5
  }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO backlog233: the old lines' requests seen at the proxy before the new save: $seen"
  # (5, before) a small-company entry arrives with its body
  $midS1 = (S2Import $co1 (S2Journal '20260401' 'B233-SMALL-1' 'Spike Party' 'backlog233 small 1' 13) 'small 1').mid
  # (1) a NEW save in the large company while the backlog is asked: in the stub within 10 s, at least held
  $tNew = Get-Date
  $midN = (S2Import $Slow232St.co (S2Journal '20260401' 'B233-NEW-1' 'HExpense 0003' 'backlog233 new 1' 51) 'new 1').mid
  $tLine = Get-Date   # the save's lines are written now (the add-on writes at save)
  $hit = @(); $dt = $null
  while (((Get-Date) - $tLine).TotalSeconds -lt 30 -and -not $hit.Count) {
    $hit = @((StubLines $m0) | Where-Object { "$($_.mid)" -eq "$midN" -and $_.company -eq $Slow232St.co })
    if ($hit.Count) { $dt = ((Get-Date) - $tLine).TotalSeconds } else { Start-Sleep -Milliseconds 500 }
  }
  Result 'backlog233 (1) the new save in the stub within 10 s, at least held' ($hit.Count -ge 1 -and $dt -le 10 -and ($hit[0].xml -or $hit[0].held)) $(if ($hit.Count) { "after {0:0.0} s (its import took {1:0.0} s before its lines were written): {2}" -f $dt, ($tLine - $tNew).TotalSeconds, (Ev $hit[0]) } else { 'no line for it in 30 s' })
  # the small company again, every 2 minutes, while the backlog is asked and until the large company is marked (the
  # bridge's other requests answered in time around its stops); 30 minutes at most
  $t0 = Get-Date; $marked = $null; $k = 1
  while (((Get-Date) - $t0).TotalMinutes -lt 30) {
    $marked = @(S2BridgeLog | Where-Object { $_ -match [regex]::Escape($Slow232St.co) + ': entry fetch stopped: over 2 s' })[0]
    if ($marked -and (B233OldDone) -ge $B233.n) { break }
    $k++; $null = S2Import $co1 (S2Journal '20260401' "B233-SMALL-$k" 'Spike Party' "backlog233 small $k" (13 + $k)) "small $k"
    Start-Sleep 120
  }
  $markAt = Get-Date
  $px = @(S2Proxy)
  Copy-Item $Slow232St.proxyLog (Join-Path $B233.dir 'proxy-copy.jsonl') -ErrorAction SilentlyContinue
  if (-not @($px | Where-Object { $_.id }).Count) { Result 'backlog233 the bridge through the timing proxy' $false 'no request of the bridge reached the proxy: the counts would prove nothing' $true; return }
  $bigReq = @($px | Where-Object { (S2Entry $_) -and $_.company -eq $Slow232St.co })
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE backlog233: the large company's entry requests at Tally (proxy ms, Tally's whole time): {0}" -f (($bigReq | ForEach-Object { $_.ms }) -join ', '))
  # (2) one request per old held line at most
  $per = @{}; foreach ($r in $px) { if ((S2Entry $r) -and $r.mid -in $oldMids) { $per[$r.mid] = 1 + [int]$per[$r.mid] } }
  $over = @($per.Keys | Where-Object { $per[$_] -gt 1 } | ForEach-Object { "$_ x$($per[$_])" })
  $done = B233OldDone
  Result 'backlog233 (2) no more than one request per old held line' ($over.Count -eq 0) ("{0} old lines; {1} asked once, {2} never asked; asked more than once: {3}; {4} of them ended (their :resolved line in the stub)" -f $B233.n, $per.Count, ($B233.n - $per.Count), $(if ($over.Count) { $over -join ', ' } else { 'none' }), $done)
  # (3) nothing sent while a previous request was still at Tally: each request reached the proxy after the one before it
  # had Tally's answer back (bridge 1's requests, all through the proxy)
  $s = @($px | Where-Object { $_.t0 } | Sort-Object { [int64]$_.t0 })
  $ov = @()
  for ($i = 1; $i -lt $s.Count; $i++) { if ([int64]$s[$i].t0 -lt [int64]$s[$i - 1].t1) { $ov += ('{0} {1}(mid {2}) sent at +{3} ms while {4}(mid {5}) was at Tally until +{6} ms' -f $s[$i].at, $s[$i].id, $s[$i].mid, ([int64]$s[$i].t0 - [int64]$s[0].t0), $s[$i - 1].id, $s[$i - 1].mid, ([int64]$s[$i - 1].t1 - [int64]$s[0].t0)) } }
  Result 'backlog233 (3) no request while a previous one is unanswered at Tally' ($ov.Count -eq 0 -and $s.Count -gt 0) ("{0} requests of bridge 1 at the proxy; overlaps: {1}" -f $s.Count, $(if ($ov.Count) { ($ov | Select-Object -First 5) -join ' | ' } else { 'none' }))
  # (4) the slow company marked, then no requests for it
  Result 'backlog233 (4a) the slow company is marked' ([bool]$marked) $(if ($marked) { "$marked" } else { "no mark in the bridge's log in $([int]((Get-Date) - $t0).TotalMinutes) min" })
  if ($marked) {
    $mt = [regex]::Match("$marked", '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})').Groups[1].Value
    $markMs = if ($mt) { [int64]([DateTimeOffset][DateTime]::ParseExact($mt, 'yyyy-MM-dd HH:mm:ss', $null)).ToUnixTimeMilliseconds() + 1000 } else { 0 }
    $mk = Mark
    $null = S2Import $Slow232St.co (S2Journal '20260401' 'B233-AFTER-1' 'HExpense 0004' 'backlog233 after 1' 61) 'after 1'
    Start-Sleep 60
    $after = @(S2Proxy | Where-Object { [int64]$_.t0 -gt $markMs -and (S2Entry $_) -and $_.company -eq $Slow232St.co })
    $la = @((StubLines $mk) | Where-Object { $_.vch -like '*B233-AFTER-1*' })
    Result 'backlog233 (4b) no requests for it after the mark' ($markMs -gt 0 -and $after.Count -eq 0 -and $la.Count -ge 1 -and -not $la[0].xml) ("{0} entry request(s) for it after the mark ({1}); its new save after the mark: {2}" -f $after.Count, $mt, (($la | ForEach-Object { Ev $_ }) -join ' || '))
  }
  # (5) a small company's entries arrive with their bodies: the one saved during the backlog, and one saved now (after the
  # backlog and the mark), waited for 3 minutes at most (run 37615287108: the backlog and the mark were over before a
  # second small save was made)
  $midS2 = (S2Import $co1 (S2Journal '20260401' 'B233-SMALL-END' 'Spike Party' 'backlog233 small at the end' 29) 'small end').mid
  $s2 = @()
  for ($w = 0; $w -lt 36 -and -not $s2.Count; $w++) { Start-Sleep 5; $s2 = @((StubLines $m0) | Where-Object { "$($_.mid)" -eq "$midS2" -and $_.company -eq $co1 -and $_.xml }) }
  $s1 = @((StubLines $m0) | Where-Object { "$($_.mid)" -eq "$midS1" -and $_.company -eq $co1 -and $_.xml })
  Result 'backlog233 (5) a small fast company''s entry arrives with its body' ($s1.Count -ge 1 -and $s2.Count -ge 1) ("during the backlog: {0}; at the end: {1}" -f $(if ($s1.Count) { Ev $s1[0] } else { "MasterID $midS1 : no line with a body" }), $(if ($s2.Count) { Ev $s2[0] } else { "MasterID $midS2 : no line with a body in 180 s" }))
  $bl = S2BridgeLog
  Set-Content (Join-Path $B233.dir 'bridge1-log-backlog233.txt') ($bl | Where-Object { $_ -match 'Recorder: |did not answer in time|answered in time again|entry fetch|earlier request|finished the request' }) -Encoding UTF8
}
