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
$B233 = @{ odd = @(); n = [int]$(if ($env:B233_N) { $env:B233_N } else { 50 }); mid0 = 900001; date = '20260401'; ok = $false; dir = (Join-Path $out 'backlog233') }
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
    # 2.3.4 (a live finding on NWS144, 08-Oct-2026): some lines as an older bridge left them: at 20 tries (never asked
    # again by 2.3.3) or final (not asked again); 2.3.4 asks each once with the fast request. 2.4.0's gate: also lines FinCom
    # listed again (refetch, after 2.3.0), each asked once and ended like the others
    $kind = if ($env:ONLY -eq 'fast234') { @('plain', 'tries20', 'final', 'refetch', 'plain')[$i % 5] } else { 'plain' }
    $items[$id] = [ordered]@{ company = $Slow232St.co; companyGuid = $B233.cguid; type = 'Journal'; no = ('OLD-{0:d3}' -f $i); date = $B233.date; masterId = "$mid"
      savedAt = $yest; added = $yest; last = $last; tries = $(if ($kind -eq 'tries20') { 20 } else { 0 }); event = 'created'
      why = $(if ($kind -eq 'tries20') { 'Tally did not give this entry after 20 tries' } elseif ($kind -eq 'refetch') { 'FinCom asked for this entry again' } elseif ($kind -eq 'final') { "Tally's voucher with that MasterID is not this line's entry" } else { "the entry was not read from Tally: Tally took longer than the recorder's limit; the bridge stopped waiting (2 s)" })
      lineGuid = ''; lineFid = ''; idsMismatch = $false; final = ($kind -eq 'final'); lineAlter = 0; fromFinCom = $false; keepGuid = ''; keepAlter = ''; refetch = ($kind -eq 'refetch'); triesVersion = '2.3.2'; again = $false; ledgerAgain = $false; slow = 1 }
    if ($kind -ne 'plain') { $B233.odd += $id }
  }
  $f = Join-Path $sync 'recorder-held.json'
  [IO.File]::WriteAllText($f, (@{ items = $items } | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
  $B233.ids = @($items.Keys)
  if ($B233.odd.Count) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO backlog233: of them, as an older bridge left them: $($B233.odd.Count) at 20 tries, final or refetch ($($B233.odd -join ', '))" }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO backlog233: $($B233.n) old held lines of '$($Slow232St.co)' seeded into $f before bridge 1 starts (MasterIDs $($B233.mid0)..$($B233.mid0 + $B233.n - 1), dated $($B233.date), saved yesterday, last asked 2 h ago)"
}

# review M1 and M2 of 2.3.3 (07-Oct-2026): a company Tally answers in time but slowly. The timing proxy holds each entry
# request of the SMALL company before forwarding it (1.5 s, then 1.8 s; Tally itself is not busy then: the delay is the
# proxy's). (6) 10 held lines of it from FinCom (the stub's beat answers heldLines), asked one after another; a new save
# made while they are asked is in the stub within 10 s. (7) 8 saves together: each in the stub within 10 s, and each with its
# body in the end
function B233Delay([int]$ms) { $f = "$($Slow232St.proxyLog).delay.json"; if ($ms -gt 0) { Set-Content $f (@{ $co1 = $ms } | ConvertTo-Json -Compress) -Encoding UTF8 } else { Remove-Item $f -ErrorAction SilentlyContinue } }
function B233Wait($mid, $sec, [switch]$body) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $sec) {
    $h = @((StubLines 0) | Where-Object { "$($_.mid)" -eq "$mid" -and $_.company -eq $co1 -and (-not $body -or $_.xml) })
    if ($h.Count) { return $h[0] }
    Start-Sleep -Milliseconds 250
  }
  return $null
}
function B233Healthy {
  Say '---- backlog233 (6)-(7): the small company answering in 1.5-1.8 s (a proxy delay): held lines asked while a new save comes; a burst of 8 saves'
  $cg = S2Guid $co1
  B233Delay 1500
  $rows = @(); $hm = @()
  for ($i = 1; $i -le 10; $i++) { $m = 800000 + $i; $hm += "$m"; $rows += @{ line_id = ('b233hl{0:d2}' -f $i); company = $co1; company_guid = $cg; event = 'created'; master_id = "$m"; vch_type = 'Journal'; vch_no = ''; vch_date = '20260401' } }
  $null = Invoke-RestMethod 'http://127.0.0.1:8787/' -Method Post -Body (@{ kind = '_seed_held'; rows = $rows } | ConvertTo-Json -Compress -Depth 4) -ContentType 'application/json'
  # the held lines are taken at the next beat and asked one after another: the new save goes once two of them are asked
  $t0 = Get-Date; $n0 = 0
  while (((Get-Date) - $t0).TotalSeconds -lt 180) { $n0 = @(S2Proxy | Where-Object { (S2Entry $_) -and $_.mid -in $hm }).Count; if ($n0 -ge 2) { break }; Start-Sleep 1 }
  $mid6 = (S2Import $co1 (S2Journal '20260401' 'B233-HEALTHY-1' 'Spike Party' 'backlog233 healthy 1' 71) 'healthy 1').mid
  $tw = Get-Date
  $l6 = B233Wait $mid6 20
  $dt6 = if ($l6) { ((Get-Date) - $tw).TotalSeconds } else { 99 }
  Start-Sleep 20
  $px = @(S2Proxy | Where-Object { (S2Entry $_) -and $_.mid -in $hm })
  $after = @($px | Where-Object { [int64]$_.t0 -gt [int64]([DateTimeOffset]$tw).ToUnixTimeMilliseconds() }).Count
  Result 'backlog233 (6) a save while held lines are asked at 1.5 s each: in the stub within 10 s' ($l6 -and $dt6 -le 10 -and $n0 -ge 2) ("after {0:0.0} s: {1}; held lines asked before the save {2}, after it {3} (proxy ms: {4}; the delay is the proxy's, Tally answered at once)" -f $dt6, $(if ($l6) { Ev $l6 } else { 'none in 20 s' }), $n0, $after, (($px | ForEach-Object { $_.ms }) -join ', '))
  # (7) a burst of 8 saves at 1.8 s each
  B233Delay 1800
  $burst = @()
  for ($k = 1; $k -le 8; $k++) { $r = S2Import $co1 (S2Journal '20260401' "B233-BURST-$k" 'Spike Party' "backlog233 burst $k" (80 + $k)) "burst $k"; $burst += [pscustomobject]@{ mid = $r.mid; at = Get-Date } }
  $res = @()
  foreach ($b in $burst) {
    $left = 15 - ((Get-Date) - $b.at).TotalSeconds
    $l = $null
    while ($left -gt 0 -and -not $l) { $l = @((StubLines 0) | Where-Object { "$($_.mid)" -eq "$($b.mid)" -and $_.company -eq $co1 })[0]; if (-not $l) { Start-Sleep -Milliseconds 250; $left = 15 - ((Get-Date) - $b.at).TotalSeconds } }
    $first = @((StubReqs) | Where-Object { $_.kind -eq 'recorder_lines' -and @($_.body.lines | Where-Object { "$($_.master_id)" -eq "$($b.mid)" }).Count } | Select-Object -First 1)
    $res += [pscustomobject]@{ mid = $b.mid; ok = [bool]$l; line = $l }
  }
  # when each first reached the stub: the stub's own time of the request (HH:mm:ss) against the save's time
  $late = @(); $bodies = 0
  foreach ($b in $burst) {
    $l = @((StubLines 0) | Where-Object { "$($_.mid)" -eq "$($b.mid)" -and $_.company -eq $co1 } | Select-Object -First 1)
    if (-not $l.Count) { $late += "$($b.mid) none"; continue }
    $sa = [DateTime]::ParseExact(("{0} {1}" -f $b.at.ToString('yyyy-MM-dd'), "$($l[0].at)".Substring([Math]::Max(0, "$($l[0].at)".Length - 8))), 'yyyy-MM-dd HH:mm:ss', $null)
    $d = ($sa - $b.at).TotalSeconds
    if ($d -gt 10) { $late += ("{0} after {1:0.0} s" -f $b.mid, $d) }
  }
  Start-Sleep 60
  foreach ($b in $burst) { if (B233Wait $b.mid 1 -body) { $bodies++ } }
  B233Delay 0
  Result 'backlog233 (7) a burst of 8 saves at 1.8 s each: each in the stub within 10 s, each with its body in the end' ($late.Count -eq 0 -and $bodies -eq 8) ("late or missing: {0}; with their body: {1} of 8; the first lines: {2}" -f $(if ($late.Count) { $late -join ', ' } else { 'none' }), $bodies, (($burst | ForEach-Object { $m = $_.mid; $x = @((StubLines 0) | Where-Object { "$($_.mid)" -eq "$m" -and $_.company -eq $co1 } | Select-Object -First 1); if ($x.Count) { "$m at $($x[0].at)" } else { "$m none" } }) -join '; '))
}

# the 2.3.3 re-review (M2 for ledger lines): a burst of 8 changed ledgers (a masters import) and a voucher saved together in
# the small company, the proxy holding each entry and ledger request 1.8 s: every line in the stub within 10 s
function B233LedgerBurst {
  Say '---- backlog233 (8): a burst of 8 changed ledgers and a voucher, each request 1.8 s (a proxy delay)'
  $cg = S2Guid $co1
  $names = @(1..8 | ForEach-Object { 'B233 Burst Ledger {0}' -f $_ })
  $null = S2Imp $co1 'All Masters' @($names | ForEach-Object { S2Led $_ 'Sundry Creditors' }) 'ledger burst'
  $x = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCLB</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (S2Esc $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCLB" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, GUID, MASTERID, ALTERID, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $leds = @()
  foreach ($m in [regex]::Matches("$x", '<LEDGER NAME="([^"]*)"[^>]*>([\s\S]*?)</LEDGER>')) {
    $n = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
    if ($n -notin $names) { continue }
    $b = $m.Groups[2].Value
    $leds += [pscustomobject]@{ name = $n; guid = [regex]::Match($b, '<GUID[^>]*>([^<]*)</GUID>').Groups[1].Value.Trim(); mid = [regex]::Match($b, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; aid = [regex]::Match($b, '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value }
  }
  if ($leds.Count -ne 8 -or -not $cg) { Result 'backlog233 (8) a ledger burst with a voucher' $false "the harness could not read the 8 ledgers back from Tally ($($leds.Count) found; company GUID '$cg')" $true; return }
  B233Delay 1800
  # the voucher: imported, its lines written by S2Import; the ledgers' lines written at once after it (one save each)
  $rv = S2Import $co1 (S2Journal '20260401' 'B233-LEDBURST-V' 'Spike Party' 'backlog233 ledger burst voucher' 91) 'ledger burst voucher'
  $now = (Get-Date).ToString('d-MMM-yy HH:mm', [Globalization.CultureInfo]::InvariantCulture)
  $rfile = Join-Path $rec ("$cg-" + (Get-Date).ToString('d-MMM-yy', [Globalization.CultureInfo]::InvariantCulture) + '.txt')
  $txt = ($leds | ForEach-Object { "FCR1|ev=ledger_accept_post|t0=$now|tw=$now|cguid=$cg|cname=$co1|user=TALLY User|obj=Master|guid=$($_.guid)|mid=$($_.mid)|aid=$($_.aid)|vtype=|vno=|vdate=|name=$($_.name)|parent=Sundry Creditors|narr=|t1=$now|src=live`r`n" }) -join ''
  if (-not (Test-Path $rfile)) { [IO.File]::WriteAllBytes($rfile, [byte[]](0xFF, 0xFE)) }
  [IO.File]::AppendAllText($rfile, $txt, [Text.UnicodeEncoding]::new($false, $false))
  $tw = Get-Date
  $want = @($leds | ForEach-Object { "$($_.mid)" }) + @("$($rv.mid)")
  $seen = @{}
  while (((Get-Date) - $tw).TotalSeconds -lt 20 -and $seen.Count -lt $want.Count) {
    foreach ($l in (StubLines 0)) { if ($l.company -eq $co1 -and "$($l.mid)" -in $want -and -not $seen.ContainsKey("$($l.mid)")) { $seen["$($l.mid)"] = ((Get-Date) - $tw).TotalSeconds } }
    Start-Sleep -Milliseconds 250
  }
  B233Delay 0
  $late = @($want | Where-Object { -not $seen.ContainsKey($_) -or $seen[$_] -gt 10 } | ForEach-Object { "$_ $(if ($seen.ContainsKey($_)) { '{0:0.0} s' -f $seen[$_] } else { 'none' })" })
  $lr = @(S2Proxy | Where-Object { $_.id -eq 'FinComLedgers' -and $_.delay })
  Result 'backlog233 (8) a burst of 8 changed ledgers and a voucher at 1.8 s each: every line in the stub within 10 s' ($late.Count -eq 0) ("late or missing: {0}; arrivals (s after the lines were written): {1}; ledger requests held 1.8 s by the proxy: {2}" -f $(if ($late.Count) { $late -join ', ' } else { 'none' }), (($want | ForEach-Object { "$_=$(if ($seen.ContainsKey($_)) { '{0:0.0}' -f $seen[$_] } else { '-' })" }) -join ' '), $lr.Count)
  # (8b) the owner's question (07-Oct-2026, after 2.3.3 was published): the ledgers that went up without their details get
  # them afterwards with no action from anyone. Each burst ledger must reach the stub with its details: a ledger_* line
  # with its body, or its row (GUID, name, group) in a "ledger_changes" call (the master counter, at the company's next
  # light check, every 10 minutes); 15 minutes at most, nothing done meanwhile
  $noBody = @($leds | Where-Object { $m = "$($_.mid)"; -not @((StubLines 0) | Where-Object { $_.company -eq $co1 -and "$($_.mid)" -eq $m -and $_.xml }).Count })
  $t8 = Get-Date; $got = @{}
  while (((Get-Date) - $t8).TotalMinutes -lt 15 -and $got.Count -lt $leds.Count) {
    foreach ($q in (StubReqs)) {
      if ($q.kind -eq 'ledger_changes' -and $q.body.company -eq $co1) {
        foreach ($row in @($q.body.ledgers)) {
          $r = @($row)
          if ($r.Count -ge 5 -and "$($r[3])" -in $names -and "$($r[0])" -and -not $got.ContainsKey("$($r[3])")) { $got["$($r[3])"] = "ledger_changes at $($q.at) (GUID $($r[0]), MasterID $($r[1]), AlterID $($r[2]), group '$($r[4])', why $($q.body.why))" }
        }
      }
    }
    foreach ($l in $leds) {
      if (-not $got.ContainsKey($l.name)) {
        $x = @((StubLines 0) | Where-Object { $_.company -eq $co1 -and "$($_.mid)" -eq "$($l.mid)" -and $_.xml } | Select-Object -First 1)
        if ($x.Count) { $got[$l.name] = "a $($x[0].ev) line with its body at $($x[0].at)" }
      }
    }
    if ($got.Count -lt $leds.Count) { Start-Sleep 15 }
  }
  $missing = @($leds | Where-Object { -not $got.ContainsKey($_.name) } | ForEach-Object { $_.name })
  if (-not $noBody.Count) { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO backlog233 (8b): every burst ledger went up with its body this time: the follow-up was not exercised' }
  $bl = @(S2BridgeLog | Where-Object { $_ -match 'Ledger changes for ' + [regex]::Escape($co1) } | Select-Object -Last 3)
  Result 'backlog233 (8b) the ledgers sent without their details get them afterwards, with no action' ($missing.Count -eq 0) ("{0} of 8 went up without their body ({1}); each with its details {2:0.0} min after (8) at most: {3}; missing: {4}; the bridge's log: {5}" -f $noBody.Count, (($noBody | ForEach-Object { $_.name }) -join ', '), ((Get-Date) - $t8).TotalMinutes, (($leds | ForEach-Object { "$($_.name): $(if ($got.ContainsKey($_.name)) { $got[$_.name] } else { 'none' })" }) -join ' || '), $(if ($missing.Count) { $missing -join ', ' } else { 'none' }), ($bl -join ' | '))
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
    if ($env:ONLY -eq 'fast234' -and (B233OldDone) -ge $B233.n) { break }   # 2.3.4: the fast request marks no company
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
  if ($env:ONLY -eq 'fast234' -and $B233.odd.Count) {
    # 2.3.4 (the live finding): the lines an older bridge left at 20 tries or final: each asked once by the fast request and
    # each ended (its :resolved line in the stub: with the body when Tally gives it; these MasterIDs are none of Tally's
    # vouchers, so held with the Day Book words), none left unasked
    $l0 = StubLines 0
    $oddRes = foreach ($id in $B233.odd) {
      $m = "$($B233.mid0 + [int]($id -replace '^b233old', ''))"
      $rl = @($l0 | Where-Object { $_.lid -eq "${id}:resolved" })
      $obj = @($px | Where-Object { $_.id -eq 'FinComVoucherObject' -and "$($_.mid)" -eq $m }).Count
      [pscustomobject]@{ id = $id; asks = [int]$per[$m]; obj = $obj; ended = $rl.Count; words = "$(@($rl | ForEach-Object { if ($_.xml) { 'body' } else { $_.held } }) -join ' / ')" }
    }
    $bad = @($oddRes | Where-Object { $_.asks -ne 1 -or $_.obj -ne 1 -or $_.ended -lt 1 })
    Result 'backlog233 fast234: the old held lines (20 tries / final / refetch) each asked once by FinComVoucherObject and ended' ($bad.Count -eq 0) ("{0} such lines; their ends: {1}; not so: {2}" -f $oddRes.Count, (($oddRes | Select-Object -First 3 | ForEach-Object { "$($_.id): $($_.words)" }) -join ' | '), $(if ($bad.Count) { ($bad | ForEach-Object { "$($_.id) asks $($_.asks) object $($_.obj) ended $($_.ended)" }) -join ', ' } else { 'none' }))
  }
  Result 'backlog233 (2) no more than one request per old held line' ($over.Count -eq 0) ("{0} old lines; {1} asked once, {2} never asked; asked more than once: {3}; {4} of them ended (their :resolved line in the stub)" -f $B233.n, $per.Count, ($B233.n - $per.Count), $(if ($over.Count) { $over -join ', ' } else { 'none' }), $done)
  # (3) nothing sent while a previous request was still at Tally: each request reached the proxy after the one before it
  # had Tally's answer back (bridge 1's requests, all through the proxy)
  $s = @($px | Where-Object { $_.t0 } | Sort-Object { [int64]$_.t0 })
  $ov = @()
  for ($i = 1; $i -lt $s.Count; $i++) { if ([int64]$s[$i].t0 -lt [int64]$s[$i - 1].t1) { $ov += ('{0} {1}(mid {2}) sent at +{3} ms while {4}(mid {5}) was at Tally until +{6} ms' -f $s[$i].at, $s[$i].id, $s[$i].mid, ([int64]$s[$i].t0 - [int64]$s[0].t0), $s[$i - 1].id, $s[$i - 1].mid, ([int64]$s[$i - 1].t1 - [int64]$s[0].t0)) } }
  Result 'backlog233 (3) no request while a previous one is unanswered at Tally' ($ov.Count -eq 0 -and $s.Count -gt 0) ("{0} requests of bridge 1 at the proxy; overlaps: {1}" -f $s.Count, $(if ($ov.Count) { ($ov | Select-Object -First 5) -join ' | ' } else { 'none' }))
  # (4) the slow company marked, then no requests for it. 2.3.4 (the owner's goal: no company should need marking slow; only
  # the fast request's stops count): the large company is NOT marked, and its new save comes with its body by
  # FinComVoucherObject
  if ($env:ONLY -eq 'fast234') {
    $mk = Mark
    $ra = S2Import $Slow232St.co (S2Journal '20260401' 'B233-AFTER-1' 'HExpense 0004' 'backlog233 after 1' 61) 'after 1'
    $la = $null; for ($w = 0; $w -lt 30 -and -not $la; $w++) { Start-Sleep 1; $la = @((StubLines $mk) | Where-Object { "$($_.mid)" -eq "$($ra.mid)" -and $_.xml })[0] }
    $objAfter = @(S2Proxy | Where-Object { $_.id -eq 'FinComVoucherObject' -and $_.company -eq $Slow232St.co -and "$($_.mid)" -eq "$($ra.mid)" })
    Result 'backlog233 (4) 2.3.4: the large company is not marked; its new save comes with its body by FinComVoucherObject' (-not $marked -and $la -and $objAfter.Count -ge 1) ("marked: {0}; the save after the backlog: {1}; FinComVoucherObject for it at the proxy: {2} ({3} ms)" -f $(if ($marked) { "$marked" } else { 'no' }), $(if ($la) { Ev $la } else { 'no line with a body in 30 s' }), $objAfter.Count, (($objAfter | ForEach-Object { [int]$_.ms }) -join ','))
  } else {
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
  }
  # (5) a small company's entries arrive with their bodies: the one saved during the backlog, and one saved now (after the
  # backlog and the mark), waited for 3 minutes at most (run 37615287108: the backlog and the mark were over before a
  # second small save was made)
  $midS2 = (S2Import $co1 (S2Journal '20260401' 'B233-SMALL-END' 'Spike Party' 'backlog233 small at the end' 29) 'small end').mid
  $s2 = @()
  for ($w = 0; $w -lt 36 -and -not $s2.Count; $w++) { Start-Sleep 5; $s2 = @((StubLines $m0) | Where-Object { "$($_.mid)" -eq "$midS2" -and $_.company -eq $co1 -and $_.xml }) }
  $s1 = @((StubLines $m0) | Where-Object { "$($_.mid)" -eq "$midS1" -and $_.company -eq $co1 -and $_.xml })
  Result 'backlog233 (5) a small fast company''s entry arrives with its body' ($s1.Count -ge 1 -and $s2.Count -ge 1) ("during the backlog: {0}; at the end: {1}" -f $(if ($s1.Count) { Ev $s1[0] } else { "MasterID $midS1 : no line with a body" }), $(if ($s2.Count) { Ev $s2[0] } else { "MasterID $midS2 : no line with a body in 180 s" }))
  try { B233Healthy } catch { Write-Host "B233Healthy: $_ $($_.ScriptStackTrace)"; Result 'backlog233 (6)-(7)' $false "the harness stopped: $_" $true }
  try { B233LedgerBurst } catch { Write-Host "B233LedgerBurst: $_ $($_.ScriptStackTrace)"; Result 'backlog233 (8)' $false "the harness stopped: $_" $true }
  $bl = S2BridgeLog
  Set-Content (Join-Path $B233.dir 'bridge1-log-backlog233.txt') ($bl | Where-Object { $_ -match 'Recorder: |did not answer in time|answered in time again|entry fetch|earlier request|finished the request' }) -Encoding UTF8
}
