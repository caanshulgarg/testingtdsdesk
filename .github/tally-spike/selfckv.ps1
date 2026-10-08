# Mode selfck (2.4.0's gate: the nightly self-check, next-selfcheck; migration 65). Dot-sourced by flowv.ps1 after the
# bridge's setup, with stubsc.py as FinCom's cloud (it keeps FinCom's copy: GUID -> AlterID from the entry lines it took;
# it answers kind "selfcheck" compare / record as tally_selfcheck_compare / _record do, the words by migration 65's own
# public.tally_selfcheck_words in the runner's PostgreSQL). The bridge's settings were seeded with a check window that is
# NOT now (so nothing runs early) and SelfCheckIdleSec 20. Then:
#   - a Receipt by keys (the add-on's line: FinCom's copy has it) and three Journals by XML (no add-on line; the stub is
#     told to forget them, so FinCom's copy lacks them, as a lost line would leave it)
#   - the night forced: SelfCheckFrom one minute ago, SelfCheckTo 3 h on, the bridge restarted from the tray; no key is
#     sent after that (the check waits for nobody using the computer)
#   n1 Tally's changes compared, the missing fetched: the compare step lists Tally's entries above the bridge's mark
#      (every voucher Tally has with a higher AlterID, by Tally's own list), the stub finds the three journals missing,
#      the bridge fetches each (its line with Tally's entry), the record says listed / missing / fetched / still right
#   n2 the words recorded: the record's words (tally_selfcheck_words at the ref) say "3 entries missing from FinCom; all 3
#      fetched from Tally" and the bridge logs them ("Nightly check of <company>: <words>")
#   n3 once a night: no second compare or record for the company in the next 4 minutes (light checks keep running)
# A step the harness could not do (no PostgreSQL, keys that made no entry, no record in 15 minutes) is HARNESS.
Say '---- selfck: the nightly self-check forced, FinCom''s copy missing three entries'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$script:TdsRestart = { Write-Host 'selfck: the Gateway not reached (no fresh Tally in this mode)' }
$CN1 = 'n1 nightly check: Tally''s changes compared, the missing fetched'; $CN2 = 'n2 nightly check: the words recorded'; $CN3 = 'n3 nightly check: once a night'
$scDone = @{}
function ScRes($c, $st, $ev) { if (-not $scDone[$c]) { Result $c $st $ev; $scDone[$c] = $true } }
function ScCtl($b) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/' -Method Post -Body ($b | ConvertTo-Json -Depth 5 -Compress) -ContentType 'application/json' -TimeoutSec 10 } catch { Write-Host "stub ctl: $_"; $null } }
function ScSteps([string]$step) { $r = StubReqs; $o = @(foreach ($q in $r) { if ($q.kind -eq 'selfcheck' -and $q.body.step -eq $step -and $q.body.company -eq $co1) { $q } }); return , $o }
function ScLog { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }
try {
  if (-not $script:scPgOk) { throw "PostgreSQL for migration 65's words is not up ($script:scPgWhy)" }
  # the bridge's first look: the company's starting point recorded (5 minutes at most)
  $t = Get-Date; $sp = $false
  while (((Get-Date) - $t).TotalMinutes -lt 5) { $l = ScLog; if (@($l | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { $sp = $true; break }; Start-Sleep 5 }
  Info "selfck: the starting point recorded: $sp"
  $v0 = Vouchers
  # a Receipt by keys (flowv c4a's keys): the add-on's line, FinCom's copy has it
  KeysTo 'v' 4 'sc-10-vouchers'; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo '2-10-2026{ENTER}' 3
  KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3 'sc-11-particular'; KeysTo '710{ENTER}' 3; KeysTo '^a' 5 'sc-12-saved'
  $null = TdsGateway 'after the Receipt'
  $v1 = Vouchers
  $kv = @(foreach ($v in $v1) { if ("$($v.mid)" -notin @($v0 | ForEach-Object { "$($_.mid)" })) { $v } })
  if (-not $kv.Count) { throw 'the keys made no Receipt (see the sc-1* screens)' }
  $k = $kv[0]; $null = TdsMid $k.mid
  # three Journals by XML: no add-on line
  foreach ($i in 1..3) {
    $null = Imp 'Vouchers' ('<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261003</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>selfck missing ' + $i + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + (20 + $i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + (20 + $i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') "selfck journal $i"
  }
  $v2 = Vouchers
  $xv = @(foreach ($v in $v2) { if ($v.narr -like 'selfck missing *') { $v } })
  if ($xv.Count -ne 3) { throw "the three journals by XML: $($xv.Count) made" }
  # the Receipt's line with its body in FinCom's copy (2 minutes at most), then the copy made to lack the journals
  $t = Get-Date; $kin = $false
  while (((Get-Date) - $t).TotalSeconds -lt 120) { $c = Invoke-RestMethod 'http://127.0.0.1:8787/copy' -TimeoutSec 10; if ($c.PSObject.Properties[$k.guid]) { $kin = $true; break }; Start-Sleep 3 }
  Start-Sleep 30
  $null = ScCtl @{ kind = '_ctl'; forget = @($xv | ForEach-Object { $_.guid }) }
  $copy0 = Invoke-RestMethod 'http://127.0.0.1:8787/copy' -TimeoutSec 10
  Info ("selfck: the Receipt by keys {0} (mid {1}, AlterID {2}) in FinCom's copy: {3}; the journals by XML {4}; FinCom's copy now holds {5} entries" -f $k.guid, $k.mid, $k.aid, $kin, (($xv | ForEach-Object { "mid $($_.mid) AlterID $($_.aid)" }) -join ', '), @($copy0.PSObject.Properties).Count)
  # the night forced: the window from a minute ago, the bridge restarted from the tray; no keys from here on
  $cf = "$h1\tds-bridge.config.json"; $cj = Get-Content $cf -Raw | ConvertFrom-Json
  $now = Get-Date
  $cj | Add-Member -NotePropertyName SelfCheckFrom -NotePropertyValue $now.AddMinutes(-1).ToString('HH:mm') -Force
  $cj | Add-Member -NotePropertyName SelfCheckTo -NotePropertyValue $now.AddHours(3).ToString('HH:mm') -Force
  [IO.File]::WriteAllText($cf, ($cj | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
  $ln0 = (ScLog).Count; $c0 = (ScSteps 'compare').Count
  $rr = Bridge POST '/tray/restart' @{}
  Start-Sleep 10
  $back = $null; for ($i = 0; $i -lt 30 -and -not $back; $i++) { $back = Bridge GET '/status' $null 10; if (-not $back) { Start-Sleep 3 } }
  Info "selfck: the window set $($cj.SelfCheckFrom)-$($cj.SelfCheckTo) (the runner's clock $($now.ToString('HH:mm')), $([TimeZoneInfo]::Local.Id)); restart asked ($($rr | ConvertTo-Json -Compress)); the bridge back: $([bool]$back) version $($back.version)"
  if (-not $back) { throw 'the bridge did not come back after the restart' }
  # the record (15 minutes at most)
  $t = Get-Date; $rec = @()
  while (((Get-Date) - $t).TotalMinutes -lt 15) { $rec = ScSteps 'record'; if ($rec.Count) { break }; Start-Sleep 10 }
  $cmp = ScSteps 'compare'
  $why = @((ScLog) | Select-Object -Skip $ln0 | Where-Object { $_ -match 'Nightly check' } | Select-Object -Last 6)
  if (-not $rec.Count) { throw "no record step in 15 minutes ($($cmp.Count) compare step(s)); the bridge log: $(if ($why.Count) { $why -join ' | ' } else { 'no Nightly check line' })" }
  Start-Sleep 20
  # n1: the compare's entries against Tally's own list above the mark; what FinCom lacked; fetched with Tally's entry
  $c1 = $cmp[-1].body; $r1 = $rec[-1].body; $ra = $rec[-1].answer
  $after = [int64]$c1.after
  $tv = Vouchers
  $want = @($tv | Where-Object { [int64]$_.aid -gt $after -and $_.guid } | ForEach-Object { $_.guid })
  $got = @(@($c1.entries) | ForEach-Object { "$($_[0])" })
  $gotMiss = @(@($cmp[-1].answer.missing) | ForEach-Object { "$($_.guid)" })
  $xg = @($xv | ForEach-Object { $_.guid })
  $notListed = @($want | Where-Object { $_ -notin $got }); $extra = @($got | Where-Object { $_ -notin $want })
  $copy1 = Invoke-RestMethod 'http://127.0.0.1:8787/copy' -TimeoutSec 10
  $fetched = @($xv | Where-Object { $copy1.PSObject.Properties[$_.guid] -and [int64]$copy1.($_.guid).alter -ge [int64]$_.aid })
  $lines = StubLines 0
  $scLines = @($lines | Where-Object { $_.guid -in $xg -and $_.xml })
  $ok1 = $notListed.Count -eq 0 -and $extra.Count -eq 0 -and @($xg | Where-Object { $_ -notin $gotMiss }).Count -eq 0 -and $k.guid -notin $gotMiss -and $fetched.Count -eq 3 -and
    [int]$r1.listed -eq $got.Count -and [int]$r1.missing -eq $gotMiss.Count -and [int]$r1.fetched -eq $gotMiss.Count -and [int]$r1.still -eq 0 -and -not "$($r1.stopped)"
  ScRes $CN1 $(if ($ok1) { 'PASS' } else { 'FAIL' }) ("mark (after) {0}, Tally's ALTVCHID {1}; Tally's entries above the mark {2}, listed by the bridge {3} (not listed: {4}; not Tally's: {5}); FinCom's copy lacked (the stub's compare) {6}: {7} (the Receipt by keys among them: {8}); fetched into the copy with Tally's AlterID: {9} of 3 (lines with Tally's entry: {10}); the record: listed {11}, missing {12}, fetched {13}, still {14}, deleted {15}, stopped '{16}'" -f `
      $after, $c1.altvchid, $want.Count, $got.Count, $(if ($notListed.Count) { $notListed -join ', ' } else { 'none' }), $(if ($extra.Count) { $extra -join ', ' } else { 'none' }), $gotMiss.Count, (@($cmp[-1].answer.missing) | ForEach-Object { "$($_.guid) $($_.why)" }) -join ', ', ($k.guid -in $gotMiss), $fetched.Count, $scLines.Count,
      $r1.listed, $r1.missing, $r1.fetched, $r1.still, $r1.deleted, $r1.stopped)
  # n2: the words (migration 65 at the ref), and the bridge's log line with them
  $w = "$($ra.words)"
  $n = [int]$r1.missing
  $re = '^Checked on the night of \d\d-[A-Z][a-z]{2}-\d{4} at \d\d:\d\d IST: ' + $n + ' entr(y|ies) missing from FinCom; ' + $(if ($n -eq 1) { 'fetched' } else { "all $n fetched" }) + ' from Tally\.'
  $logW = @((ScLog) | Select-Object -Skip $ln0 | Where-Object { $_ -like "*Nightly check of $($co1): *" })
  $logged = @($logW | Where-Object { $w -and $_.Contains($w) })
  if ($ra.harnessError) { ScRes $CN2 'HARNESS' "the stub could not get the words from PostgreSQL: $($ra.harnessError)" }
  else { ScRes $CN2 $(if ($w -match $re -and $n -eq 3 -and $logged.Count -ge 1) { 'PASS' } else { 'FAIL' }) ("result '{0}'; words '{1}' (expected to start: {2}); the bridge's log: {3}" -f $ra.result, $w, $re, $(if ($logW.Count) { $logW -join ' | ' } else { 'no line' })) }
  # n3: once a night
  Start-Sleep 240
  $cmp2 = ScSteps 'compare'; $rec2 = ScSteps 'record'
  $scj = Get-Content (Join-Path $h1 'selfcheck.json') -Raw -ErrorAction SilentlyContinue
  if (-not $scj) { $scj = (Get-ChildItem $h1 -Recurse -Filter 'selfcheck.json' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { Get-Content $_.FullName -Raw }) }
  ScRes $CN3 $(if ($rec2.Count -eq 1 -and $cmp2.Count -eq ($cmp.Count)) { 'PASS' } else { 'FAIL' }) ("records {0}, compares {1} (at the record {2}) after 4 more minutes; selfcheck.json: {3}; bridge log: {4}" -f $rec2.Count, $cmp2.Count, $cmp.Count, $(if ($scj) { ($scj -replace '\s+', ' ').Substring(0, [math]::Min(400, ($scj -replace '\s+', ' ').Length)) } else { 'not found' }), ((@((ScLog) | Select-Object -Skip $ln0 | Where-Object { $_ -match 'Nightly check' }) | Select-Object -Last 4) -join ' | '))
} catch {
  Write-Host "selfck stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($CN1, $CN2, $CN3)) { ScRes $c 'HARNESS' "the harness stopped: $_" }
}
Snap 'selfck-end'
