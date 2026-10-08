# fast234.ps1 - branch next-fastfetch (input only=fast234, bridge_ref next-fastfetch, built from source): the owner's
# approval of 07-Oct-2026 and decision of 08-Oct-2026 ("Allow, strip in bridge"): the entry request is the object export
# "ID:<MasterID>" (FinComVoucherObject), FinComVoucherByMaster gone. Dot-sourced by flow4.ps1 after slow232.ps1 (it reuses
# Slow232Setup: a large company beside the small one in Tally 9000, and the timing proxy slow232proxy.py on 127.0.0.2:9000
# that logs every request of bridge 1 with its id, company, MasterID and the times it reached Tally and its answer came).
#   setup (before the bridges start): the large company ($F234.vch entries, default 40,000); then Tally 9000 started again
#     with BOTH companies loaded from an SMB share of its data folder (\\localhost\fast234share: an SMB share on this one
#     runner, the client and the server on the same machine, no network); bridge 1's sync folder seeded with $F234.nEnd
#     line ids 2.3.3 ENDED with the Day Book words (*.ended.txt and their ":resolved" in the sent file, as 2.3.3 leaves them)
#   run (after the bridges start): $F234.nHeld + $F234.nEnd entries imported into the large company once its starting point
#     is recorded (no recorder line: FinCom holds them), listed to the bridge as FinCom's held lines (the stub's heldLines);
#     new saves in both companies (their add-on lines written). Pass means:
#     (1) each new save in the stub with Tally's body, each of its entry requests answered by Tally in under 2 s;
#     (2) every seeded held line (the ended ones too) resolved with its body, each asked ONCE, by FinComVoucherObject;
#     (3) no FinComVoucherByMaster seen at the proxy;
#     (4) no request sent while a previous one was unanswered at Tally;
#     (5) no company marked slow (the bridge's log and its recorder-slow.json);
#     (6) the last entry of the small company's day deleted on the screen (Day Book, End, Alt+D, as flow4 step 5): its line
#         in the stub with the GUID Tally deleted, NOT held (Tally's bare 'Could not find Voucher:ID:n' read as gone), its
#         MasterID asked by FinComVoucherObject at the proxy, and Tally's answer to it its bare 'Could not find Voucher'.
#   2.4.0's gate adds: option B (a sales invoice of 1000+ items in the small company, its size calibrated so the request
#     takes Tally over 2 s: asked, held with "FinCom asks once more at", asked ONE more time 5 minutes later, ended, never a
#     third ask in the 7 minutes after) and one request in flight over the WHOLE run (the proxy counts the requests open
#     when each arrives: never another); backlog233's old held lines include refetch ones (20 tries / final / refetch).
$F234 = @{ dir = (Join-Path $out 'fast234'); vch = [int]$(if ($env:F234_VCH) { $env:F234_VCH } else { 40000 }); nHeld = 10; nEnd = 10; date = '20260401'
  shareName = 'fast234share'; share = '\\localhost\fast234share'; ok = $false; bigCo = 'FinCom Big Co'; endIds = @(); heldIds = @() }
New-Item -ItemType Directory -Force $F234.dir | Out-Null
function F234Entry($r) { $r.id -in 'FinComVoucherObject', 'FinComVoucherByMaster', 'FinComVoucherByNumber' }

function F234Setup {
  Say "---- fast234 setup: the large company '$($F234.bigCo)' ($($F234.vch) entries) beside '$co1' in Tally 9000, then both from the SMB share $($F234.share)"
  $Slow232St.co = $F234.bigCo; $Slow232St.vch = $F234.vch; $Slow232St.budget = [int]$(if ($env:F234_MIN) { $env:F234_MIN } else { 90 })
  $Slow232St.proxyLog = Join-Path $F234.dir 'proxy.jsonl'
  Slow232Setup
  if (-not $Slow232St.ok) { return }
  # the data folder shared over SMB (on this runner only), Tally started again on the share with both companies
  & icacls.exe $data1 /grant 'Everyone:(OI)(CI)F' /T /Q | Out-Null
  & net.exe share "$($F234.shareName)=$data1" '/GRANT:Everyone,FULL' 2>&1 | ForEach-Object { Write-Host "  net share: $_" }
  $folders = @(Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object Name)
  $seen = @(Get-ChildItem $F234.share -Directory -ErrorAction SilentlyContinue).Count
  $ini = @('[Tally]', "Data = $($F234.share)", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes')
  $ini += @($folders | ForEach-Object { "Load = $_" }); $ini += "TDL = $tdl"
  $null = S2StartTally $ini
  $both = (S2Has $co1) -and (S2Has $F234.bigCo)
  if (-not $both) { foreach ($name in @($co1, $F234.bigCo)) { if (-not (S2Has $name)) { KeysTo 9000 '{F3}' 4 ''; KeysTo 9000 $name 2 ''; KeysTo 9000 '{ENTER}' 8 "f234-open-$name" } }; $both = (S2Has $co1) -and (S2Has $F234.bigCo) }
  Shot 'f234-both-on-share'
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO fast234: Tally 9000's data folder is {0} (an SMB share of {1} on this runner: SMB only, the client and the server on one machine, no network between them); {2} company folders seen through it; loaded: {3}; both companies open: {4}" -f $F234.share, $data1, $seen, ($folders -join ', '), $both)
  if (-not $both) { Result 'fast234 setup: both companies open from the SMB share' $false "Tally lists: $(ListCo 9000)" $true; return }
  # the bridge's own entry request (next-fastfetch, as built at the ref) on entries of the large company
  $req = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  if (Test-Path $req) {
    foreach ($mid in @(100, [int]($Slow232St.made / 2), [math]::Max(1, $Slow232St.made - 10))) {
      $q = (Get-Content $req -Raw) -replace 'FinCom Spike Co', (S2Esc $F234.bigCo) -replace 'ID:99999<', "ID:$(P3Mid $mid)<"
      $t1 = Get-Date; $a = Post 9000 $q ''; $ms = [int]((Get-Date) - $t1).TotalMilliseconds
      Add-Content -Path $resultsFile -Encoding UTF8 -Value "MEASURE fast234: the bridge's entry request for MasterID $mid of the large company ($($Slow232St.made) entries, on the share) took $ms ms ($("$a".Length) bytes before the bridge's strip)"
    }
  } else { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO fast234: no requests\entry-object.xml from the build: the direct timing is skipped' }
  $F234.ok = $true
  # 2.4.0's gate, option B: the invoice size that takes Tally over 2 s (calibrated before the bridges start)
  F234ObSetup
  # 2.3.4's gate (the coordinator, 08-Oct-2026): the backlog233 checks (1)-(8) in the same run, on the same two companies
  $B233.cguid = [regex]::Match((ListCo 9000), '(?s)NAME="' + [regex]::Escape($F234.bigCo) + '".*?<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value.Trim()
  if (-not $B233.cguid) {
    foreach ($m in [regex]::Matches("$(ListCo 9000)", '<COMPANY[^>]*>([\s\S]*?)</COMPANY>')) { if ([regex]::Match($m.Groups[1].Value, '<NAME[^>]*>([^<]*)</NAME>').Groups[1].Value -eq $F234.bigCo) { $B233.cguid = [regex]::Match($m.Groups[1].Value, '<GUID[^>]*>([^<]*)</GUID>').Groups[1].Value.Trim() } }
  }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO fast234: the backlog233 checks run too (the large company's GUID '$($B233.cguid)')"
  $B233.ok = $true
}

# bridge 1's sync folder before it starts: the ids 2.3.3 ENDED (their ":resolved" held line sent with the Day Book words)
function F234Seed($h1) {
  if (-not $F234.ok) { return }
  $sd = Join-Path $h1 'sync\recorder-sent'; New-Item -ItemType Directory -Force $sd | Out-Null
  $day = (Get-Date).ToString('yyyyMMdd')
  $F234.endIds = @(1..$F234.nEnd | ForEach-Object { 'f234end{0:d2}' -f $_ })
  $F234.heldIds = @(1..$F234.nHeld | ForEach-Object { 'f234held{0:d2}' -f $_ })
  Add-Content (Join-Path $sd "$day.ended.txt") $F234.endIds -Encoding UTF8
  Add-Content (Join-Path $sd "$day.txt") ($F234.endIds | ForEach-Object { "${_}:resolved" }) -Encoding UTF8
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO fast234: $($F234.nEnd) line ids seeded as ended by 2.3.3 in $sd ($day.ended.txt, their :resolved in $day.txt)"
}

function F234Proxy { if (Test-Path $Slow232St.proxyLog) { @(Get-Content $Slow232St.proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }) } else { @() } }
function F234WaitBody($co, $mid, $sec) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $sec) {
    $h = @((StubLines 0) | Where-Object { "$($_.mid)" -eq "$mid" -and $_.company -eq $co -and $_.xml })
    if ($h.Count) { return [pscustomobject]@{ line = $h[0]; s = ((Get-Date) - $t).TotalSeconds } }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Fast234 {
  if (-not $F234.ok) { Result 'fast234' $false 'the setup did not finish (see the HARNESS line above)' $true; return }
  Say '---- fast234: the fast entry request on real Tally, two companies from an SMB share, a held backlog'
  # the bridge's first looks: both companies' starting points recorded (6 minutes at most)
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalMinutes -lt 6) {
    $l = S2BridgeLog
    if (@($l | Where-Object { $_ -match ('Company ' + [regex]::Escape($F234.bigCo) + ': its starting point is recorded') }).Count -and @($l | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { break }
    Start-Sleep 5
  }
  $cgBig = S2Guid $F234.bigCo
  # 2.4.0's gate, option B: the large invoice saved first (its two asks are judged at the end, F234OptionB)
  try { F234ObStart } catch { Write-Host "F234ObStart: $_ $($_.ScriptStackTrace)" }
  # (1) new saves in both companies, their lines written: each with its body, each entry request under 2 s at Tally
  $saves = @()
  for ($k = 1; $k -le 3; $k++) {
    $saves += [pscustomobject]@{ co = $co1; mid = (S2Import $co1 (S2Journal $F234.date "F234-SMALL-$k" 'Spike Party' "fast234 small $k" (20 + $k)) "small $k").mid }
    $saves += [pscustomobject]@{ co = $F234.bigCo; mid = (S2Import $F234.bigCo (S2Journal $F234.date "F234-BIG-$k" 'HExpense 0003' "fast234 big $k" (40 + $k)) "big $k").mid }
  }
  $res1 = foreach ($s in $saves) { $w = F234WaitBody $s.co $s.mid 30; [pscustomobject]@{ co = $s.co; mid = $s.mid; ok = [bool]$w; s = $(if ($w) { [math]::Round($w.s, 1) } else { $null }) } }
  # (2) the held backlog: entries made in the large company with no recorder line (FinCom holds them), then listed by FinCom
  $rows = @(); $heldMids = @{}
  foreach ($id in @($F234.heldIds) + @($F234.endIds)) {
    $r = S2Imp $F234.bigCo 'Vouchers' @(S2Journal $F234.date ($id.ToUpper()) 'HExpense 0005' "fast234 held $id" 33) "held $id"
    $mid = [regex]::Match($r.raw, '<LASTVCHID>(\d+)</LASTVCHID>').Groups[1].Value
    $heldMids[$id] = $mid
    $rows += @{ line_id = $id; company = $F234.bigCo; company_guid = $cgBig; event = 'created'; master_id = "$mid"; vch_type = 'Journal'; vch_no = ''; vch_date = $F234.date }
  }
  $null = Invoke-RestMethod 'http://127.0.0.1:8787/' -Method Post -Body (@{ kind = '_seed_held'; rows = $rows } | ConvertTo-Json -Compress -Depth 4) -ContentType 'application/json'
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO fast234: {0} held lines listed to the bridge as FinCom's (the stub's heldLines), MasterIDs {1}" -f $rows.Count, (($rows | ForEach-Object { "$($_.line_id)=$($_.master_id)" }) -join ' '))
  $t2 = Get-Date; $done = @{}
  while (((Get-Date) - $t2).TotalMinutes -lt 20 -and $done.Count -lt $rows.Count) {
    foreach ($l in (StubLines 0)) { if ($l.lid -like 'f234*:resolved' -and $l.xml) { $done[$l.lid -replace ':resolved$', ''] = $l } }
    Start-Sleep 10
  }
  Start-Sleep 30
  $px = @(F234Proxy)
  Copy-Item $Slow232St.proxyLog (Join-Path $F234.dir 'proxy-copy.jsonl') -ErrorAction SilentlyContinue
  if (-not @($px | Where-Object { $_.id }).Count) { Result 'fast234 the bridge through the timing proxy' $false 'no request of the bridge reached the proxy: the counts would prove nothing' $true; return }
  $ent = @($px | Where-Object { F234Entry $_ })
  $obj = @($ent | Where-Object { $_.id -eq 'FinComVoucherObject' })
  # (the option B invoice is over 2 s on purpose: judged by F234OptionB, not here)
  $slowReq = @($obj | Where-Object { [double]$_.ms -ge 2000 -and -not ($F234.obMid -and "$($_.mid)" -eq "$($F234.obMid)" -and $_.company -eq $co1) })
  $saveMids = @($saves | ForEach-Object { "$($_.mid)" })
  $late = @($res1 | Where-Object { -not $_.ok })
  Result 'fast234 (1) each new save in both companies in the stub with its body; each entry request answered in under 2 s' ($late.Count -eq 0 -and $slowReq.Count -eq 0 -and $obj.Count -gt 0) ("saves: {0}; FinComVoucherObject requests at the proxy: {1}, ms {2}; 2 s or more: {3}" -f (($res1 | ForEach-Object { "$($_.co)/$($_.mid) $(if ($_.ok) { "body after $($_.s) s" } else { 'NO BODY in 30 s' })" }) -join '; '), $obj.Count, (($obj | ForEach-Object { [int]$_.ms }) -join ','), $slowReq.Count)
  $per = @{}; foreach ($r in $obj) { $per["$($r.mid)"] = 1 + [int]$per["$($r.mid)"] }
  $miss = @(@($F234.heldIds) + @($F234.endIds) | Where-Object { -not $done.ContainsKey($_) })
  $twice = @($heldMids.Keys | Where-Object { $per["$($heldMids[$_])"] -gt 1 } | ForEach-Object { "$_ x$($per["$($heldMids[$_])"])" })
  $never = @($heldMids.Keys | Where-Object { -not $per["$($heldMids[$_])"] })
  Result 'fast234 (2) every seeded held line resolved with its body, asked once by FinComVoucherObject (the ended ones once more)' ($miss.Count -eq 0 -and $twice.Count -eq 0 -and $never.Count -eq 0) ("{0} held + {1} ended by 2.3.3; resolved with body: {2}; missing: {3}; asked more than once: {4}; never asked by the new request: {5}" -f $F234.nHeld, $F234.nEnd, $done.Count, $(if ($miss.Count) { $miss -join ', ' } else { 'none' }), $(if ($twice.Count) { $twice -join ', ' } else { 'none' }), $(if ($never.Count) { $never -join ', ' } else { 'none' }))
  $old = @($px | Where-Object { $_.id -eq 'FinComVoucherByMaster' })
  $byNo = @($px | Where-Object { $_.id -eq 'FinComVoucherByNumber' })
  Result 'fast234 (3) no FinComVoucherByMaster seen at the proxy' ($old.Count -eq 0) ("{0} FinComVoucherByMaster; {1} FinComVoucherByNumber (lines with no MasterID only); {2} FinComVoucherObject; {3} requests of bridge 1 in all" -f $old.Count, $byNo.Count, $obj.Count, $px.Count)
  $s = @($px | Where-Object { $_.t0 } | Sort-Object { [int64]$_.t0 })
  $ov = @()
  for ($i = 1; $i -lt $s.Count; $i++) { if ([int64]$s[$i].t0 -lt [int64]$s[$i - 1].t1) { $ov += ('{0} {1}(mid {2}) sent while {3}(mid {4}) was at Tally' -f $s[$i].at, $s[$i].id, $s[$i].mid, $s[$i - 1].id, $s[$i - 1].mid) } }
  Result 'fast234 (4) no request while a previous one is unanswered at Tally' ($ov.Count -eq 0 -and $s.Count -gt 0) ("{0} requests of bridge 1 at the proxy; overlaps: {1}" -f $s.Count, $(if ($ov.Count) { ($ov | Select-Object -First 5) -join ' | ' } else { 'none' }))
  $bl = S2BridgeLog
  $marked = @($bl | Where-Object { $_ -match 'entry fetch stopped: over 2 s|entry fetch of .*: over 2 s' })
  $sj = Join-Path $h1 'sync\recorder-slow.json'
  $marks = if (Test-Path $sj) { try { @((Get-Content $sj -Raw | ConvertFrom-Json).marks.PSObject.Properties).Count } catch { -1 } } else { 0 }
  Result 'fast234 (5) no company marked slow' ($marked.Count -eq 0 -and $marks -eq 0) ("the bridge's log lines on a stopped entry fetch: {0}; marks in recorder-slow.json: {1}" -f $(if ($marked.Count) { ($marked | Select-Object -First 3) -join ' | ' } else { 'none' }), $marks)
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE fast234: FinComVoucherObject at Tally (proxy ms): median {0}, worst {1}, n {2}; the small company {3}; the large company ({4} entries) {5}" -f `
      $(if ($obj.Count) { ($obj | ForEach-Object { [double]$_.ms } | Sort-Object)[[int][math]::Floor(($obj.Count - 1) / 2)] } else { '-' }), $(if ($obj.Count) { ($obj | ForEach-Object { [double]$_.ms } | Measure-Object -Maximum).Maximum } else { '-' }), $obj.Count,
      (($obj | Where-Object { $_.company -eq $co1 } | ForEach-Object { [int]$_.ms }) -join ','), $Slow232St.made, (($obj | Where-Object { $_.company -eq $F234.bigCo } | ForEach-Object { [int]$_.ms }) -join ','))
  # (6) the coordinator, 08-Oct-2026 (the renumbering helper's finding: Tally answers a MasterID it no longer has with a bare
  # <ERRORMSG>Could not find Voucher:ID:n!</ERRORMSG>): an entry deleted on the screen is settled as before, its line proven
  # deleted on this Tally (no held words) with the GUID of the entry Tally deleted, asked by FinComVoucherObject
  try { F234Delete } catch { Write-Host "F234Delete: $_ $($_.ScriptStackTrace)"; Result 'fast234 (6) an entry deleted on the screen: its line proven deleted here' $false "the harness stopped: $_" $true }
  Copy-Item $Slow232St.proxyLog (Join-Path $F234.dir 'proxy-copy.jsonl') -ErrorAction SilentlyContinue
  $bl = S2BridgeLog
  Set-Content (Join-Path $F234.dir 'bridge1-log-fast234.txt') ($bl | Where-Object { $_ -match 'Recorder: |did not answer in time|answered in time again|entry fetch|FinComVoucher' }) -Encoding UTF8
}

# (6) a delete on the screen (flow4 step 5's keys) in the small company, made the current one first (F3, its name)
function F234Delete {
  $before = Vouchers 9000 $co1
  $m = Mark; $p0 = @(F234Proxy).Count
  KeysTo 9000 '{ESC}' 1; KeysTo 9000 '{ESC}' 1; KeysTo 9000 '{F3}' 4; KeysTo 9000 $co1 2; KeysTo 9000 '{ENTER}' 6 'f234-6-company'
  DayBook 'f234-6' '1-4-2026'; KeysTo 9000 '{END}' 2; KeysTo 9000 '%d' 3; KeysTo 9000 'y' 4 'f234-6-deleted'
  KeysTo 9000 '{ESC}' 1; KeysTo 9000 '{ESC}' 1
  $after = Vouchers 9000 $co1
  $del = @($before | Where-Object { $_.mid -notin @($after | ForEach-Object mid) })[0]
  if ($del) { $null = P3Mid $del.mid }
  if (-not $del) { Result 'fast234 (6) an entry deleted on the screen: its line proven deleted here' $false ("the keys deleted nothing in '{0}' ({1} entries before, {2} after; see the f234-6 screens)" -f $co1, @($before).Count, @($after).Count) $true; return }
  $hit = WaitLine $m { $_.ev -eq 'deleted' -and $_.company -eq $co1 -and "$($_.mid)" -eq "$($del.mid)" } 180
  $x = @($hit | Where-Object bid -eq $B[1].id)[0]
  Start-Sleep 5
  $asked = @(@(F234Proxy) | Select-Object -Skip $p0 | Where-Object { $_.id -eq 'FinComVoucherObject' -and "$($_.mid)" -eq "$($del.mid)" })
  $said = @(S2BridgeLog | Where-Object { $_ -match ('delete of mid ' + $del.mid + ':') } | Select-Object -Last 3)
  # 2.4.0's gate: proven by Tally's own answer to that ask: its bare 'Could not find Voucher' (the proxy reads the answer)
  $nf = @($asked | Where-Object { $_.nf })
  Result 'fast234 (6) an entry deleted on the screen: its line proven deleted here (Tally answered "Could not find Voucher")' ([bool]$x -and $x.guid -eq $del.guid -and -not $x.held -and $asked.Count -gt 0 -and $nf.Count -gt 0) `
    ("Tally deleted mid {0} guid {1} no {2}; {3}; FinComVoucherObject for mid {0} at the proxy: {4} ({5} ms); Tally's answer 'Could not find Voucher': {6} ('{7}'); bridge log: {8}" -f $del.mid, $del.guid, $del.vno, (Ev $x), $asked.Count, (($asked | ForEach-Object { [int]$_.ms }) -join ','), $nf.Count, $(@($asked | ForEach-Object { $_.ans })[0]), $(if ($said.Count) { $said -join ' | ' } else { 'none' }))
}

# ---- 2.4.0's gate, option B (the owner's answer B of 08-Oct-2026, in 2.3.4/2.3.5): an entry whose fast request takes over
# 2 s at Tally is held with "FinCom asks once more at HH:MM", asked ONE more time 5 minutes (RecorderStopRetrySec) later,
# then ended; never a third ask. The entry: a sales invoice of $F234.obItems items (600 or more; Tally's object export
# takes about 3 ms an item, by the voucher's own size, not the company's) in the SMALL company, so the stop cannot be
# confused with the large company. The size is calibrated in the setup (before the bridges start) by timing the bridge's
# own request (requests\entry-object.xml) on a calibration invoice: the first size from 1000 whose answer takes 2.6 s or
# more at Tally directly (1000, 1600, 2400, 3000 items)
$F234.obItems = 0; $F234.obMid = ''; $F234.obT0 = $null; $F234.obDate = '20260402'
function F234ObMasters {
  $m = @('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
  $m += S2Led 'Sales' 'Sales Accounts'; $m += S2Led 'Output CGST' 'Duties & Taxes'; $m += S2Led 'Output SGST' 'Duties & Taxes'
  $m += S2Led 'OB Party' 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>'
  for ($i = 1; $i -le 3000; $i++) { $m += S2Item ('OBItem {0:d4}' -f $i) }
  for ($i = 0; $i -lt $m.Count; $i += 1000) { $null = S2Imp $co1 'All Masters' $m[$i..([math]::Min($i + 999, $m.Count - 1))] "option B masters $i" }
}
function F234ObInvoice([int]$n, [string]$no, [string]$narr) {
  $its = @(1..$n | ForEach-Object { 'OBItem {0:d4}' -f $_ })
  S2Sales $F234.obDate $no 'OB Party' $its $narr
}
function F234ObTime($mid) {
  $req = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  if (-not (Test-Path $req)) { return -1 }
  $q = (Get-Content $req -Raw) -replace 'ID:99999<', "ID:$(P3Mid $mid)<"
  $t1 = Get-Date
  try { $a = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $q -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 120).RawContentLength } catch { $a = -1 }
  $ms = [int]((Get-Date) - $t1).TotalMilliseconds
  Write-Host "[optB] the bridge's entry request for MasterID $mid of '$co1': $ms ms, $a bytes"
  return $ms
}
function F234ObSetup {
  try {
    F234ObMasters
    foreach ($n in 1000, 1600, 2400, 3000) {
      $r = S2Imp $co1 'Vouchers' @(F234ObInvoice $n ("OBCAL-$n") "option B calibration $n items") "option B calibration $n"
      $mid = [regex]::Match($r.raw, '<LASTVCHID>(\d+)</LASTVCHID>').Groups[1].Value
      if (-not $mid -or $r.created -lt 1) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO fast234 option B: the $n-item calibration invoice was not made ($(("$($r.raw)" -replace '\s+', ' ').Substring(0, [math]::Min(300, "$($r.raw)".Length))))"; continue }
      $ms = @(F234ObTime $mid; F234ObTime $mid)
      Add-Content -Path $resultsFile -Encoding UTF8 -Value "MEASURE fast234 option B: the bridge's entry request for a $n-item invoice of '$co1' (MasterID $mid) took $($ms -join ', ') ms at Tally directly"
      if (($ms | Measure-Object -Minimum).Minimum -ge 2600) { $F234.obItems = $n; break }
    }
  } catch { Write-Host "F234ObSetup: $_ $($_.ScriptStackTrace)" }
  if (-not $F234.obItems) { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO fast234 option B: no invoice size up to 3000 items took 2.6 s at Tally: option B cannot be shown here' }
  else { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO fast234 option B: a $($F234.obItems)-item invoice will be saved in '$co1' after the bridges start" }
}
# after the bridges' first looks: the invoice saved (its add-on lines written), the clock started
function F234ObStart {
  if (-not $F234.obItems) { return }
  $F234.obT0 = Get-Date
  $s = S2Import $co1 (F234ObInvoice $F234.obItems 'OB-GATE-1' "option B gate $($F234.obItems) items") 'option B gate'
  $F234.obMid = "$($s.mid)"
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO fast234 option B: the $($F234.obItems)-item invoice saved in '$co1' at $($F234.obT0.ToString('HH:mm:ss')), MasterID $($F234.obMid)"
}
function F234OptionB {
  $nm = "fast234 option B: an entry over 2 s at Tally is asked once more after 5 min, then ended; never a third ask"
  if (-not $F234.obItems) { Result $nm $false 'no invoice of up to 3000 items took 2.6 s at Tally in the calibration: not shown (see the MEASURE lines)' $true; return }
  if ($F234.obMid -notmatch '^\d+$' -or $F234.obMid -eq '0') { Result $nm $false "the invoice was not saved (MasterID '$($F234.obMid)')" $true; return }
  $mid = P3Mid $F234.obMid
  $ask = { @(F234Proxy | Where-Object { $_.id -eq 'FinComVoucherObject' -and "$($_.mid)" -eq $mid -and $_.company -eq $co1 } | Sort-Object { [int64]$_.t0 }) }
  # the second ask: due 5 minutes after the first (RecorderStopRetrySec), or later with the retry schedule; 15 min at most
  $until = $F234.obT0.AddMinutes(15)
  while ((Get-Date) -lt $until -and @(& $ask).Count -lt 2) { Start-Sleep 10 }
  $a = @(& $ask)
  # never a third: watched 7 more minutes after the second ask (more than one more 5-minute wait)
  if ($a.Count -ge 2) { $end = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$a[1].t0).LocalDateTime.AddMinutes(7); while ((Get-Date) -lt $end) { Start-Sleep 15 } }
  else { Start-Sleep 60 }
  $a = @(& $ask)
  $l = @((StubLines 0) | Where-Object { "$($_.mid)" -eq $mid -and $_.company -eq $co1 })
  $held1 = @($l | Where-Object { $_.held -match 'asks once more at' })
  $ends = @($l | Where-Object { $_.lid -like '*:resolved' })
  $gap = if ($a.Count -ge 2) { [math]::Round(([int64]$a[1].t0 - [int64]$a[0].t0) / 1000.0, 1) } else { -1 }
  $slow1 = $a.Count -ge 1 -and [double]$a[0].ms -ge 2000
  $ok = $slow1 -and $a.Count -eq 2 -and $gap -ge 290 -and $held1.Count -ge 1 -and $ends.Count -ge 1
  Result $nm $ok ("invoice of {0} items, MasterID {1}, saved {2}; FinComVoucherObject asks at the proxy: {3} ({4}); between the first and the second {5} s; held with the once-more words: {6}; ended (a :resolved line): {7}" -f `
      $F234.obItems, $mid, $F234.obT0.ToString('HH:mm:ss'), $a.Count, (($a | ForEach-Object { "$($_.at) $([int]$_.ms) ms" }) -join ', '), $gap,
      $(if ($held1.Count) { "'$($held1[0].held)' at $($held1[0].at)" } else { "no ($(@($l | ForEach-Object { "$($_.at) $($_.ev) lid $($_.lid) held '$($_.held)' body $([bool]$_.xml)" }) -join ' | '))" }),
      $(if ($ends.Count) { ($ends | ForEach-Object { "$($_.at) $(if ($_.xml) { 'with its body' } else { "'$($_.held)'" })" }) -join ' | ' } else { 'none' }))
}

# ---- 2.4.0's gate: one request in flight over the WHOLE run: the proxy never had two of bridge 1's requests open at once
# (each proxy line says how many others were open when it arrived; and by the times: none arrived before every earlier
# one had its answer back)
function F234Concurrency {
  $px = @(F234Proxy | Where-Object { $_.t0 } | Sort-Object { [int64]$_.t0 })
  if (-not $px.Count) { Result 'fast234 one request in flight over the whole run' $false 'no request of the bridge at the proxy' $true; return }
  $byOpen = @($px | Where-Object { [int]$_.open -gt 0 })
  $ov = @(); $maxT1 = [int64]0; $prev = $null
  foreach ($r in $px) { if ($prev -and [int64]$r.t0 -lt $maxT1) { $ov += ('{0} {1}(mid {2}) arrived while {3}(mid {4}) was open' -f $r.at, $r.id, $r.mid, $prev.id, $prev.mid) }; if ([int64]$r.t1 -gt $maxT1) { $maxT1 = [int64]$r.t1; $prev = $r } }
  $mo = ($px | ForEach-Object { [int]$_.maxOpen } | Measure-Object -Maximum).Maximum
  $span = '{0}..{1}' -f $px[0].at, $px[-1].at
  Result 'fast234 one request in flight over the whole run (the proxy never saw two of the bridge''s requests at once)' ($byOpen.Count -eq 0 -and $ov.Count -eq 0 -and [int]$mo -eq 0) `
    ("{0} requests of bridge 1 at the proxy, {1}; arrived while another was open (the proxy's count): {2}; by the times: {3}; most others open at once: {4}" -f $px.Count, $span, $byOpen.Count, $(if ($ov.Count) { "$($ov.Count): " + (($ov | Select-Object -First 5) -join ' | ') } else { 'none' }), $mo)
}
