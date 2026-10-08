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
#     (5) no company marked slow (the bridge's log and its recorder-slow.json).
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
      $q = (Get-Content $req -Raw) -replace 'FinCom Spike Co', (S2Esc $F234.bigCo) -replace 'ID:99999<', "ID:$mid<"
      $t1 = Get-Date; $a = Post 9000 $q ''; $ms = [int]((Get-Date) - $t1).TotalMilliseconds
      Add-Content -Path $resultsFile -Encoding UTF8 -Value "MEASURE fast234: the bridge's entry request for MasterID $mid of the large company ($($Slow232St.made) entries, on the share) took $ms ms ($("$a".Length) bytes before the bridge's strip)"
    }
  } else { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO fast234: no requests\entry-object.xml from the build: the direct timing is skipped' }
  $F234.ok = $true
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
  $slowReq = @($obj | Where-Object { [double]$_.ms -ge 2000 })
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
  Set-Content (Join-Path $F234.dir 'bridge1-log-fast234.txt') ($bl | Where-Object { $_ -match 'Recorder: |did not answer in time|answered in time again|entry fetch|FinComVoucher' }) -Encoding UTF8
}
