# Mode upg (2.4.0's gate, part C: the upgrade path). Dot-sourced by flowv.ps1 twice:
#   $upgPhase = 'seed' (before any bridge is installed): ten Journals made by XML (Tally's own entries no add-on line
#     told of), then the bridge's sync folder seeded as NWS144's looked under 2.3.3 (backlog233's state): recorder-held.json
#     with 50 old held lines of the company (MasterIDs 900001.. Tally does not have; saved yesterday, last asked 2 h ago;
#     as an older bridge left them: plain, at 20 tries, final, refetch) and the ten Journals held "the entry was not read
#     from Tally"; recorder-sent/<day>.ended.txt with 10 line ids 2.3.3 ended (their ":resolved" in <day>.txt).
#     flowv.ps1 then installs the PUBLISHED 2.3.3 (bridge-dist\old233, SHA-256 checked by the build) with 2.3.3's add-on in
#     Tally, TallyHost 127.0.0.2 (proxy235.py logs every request the bridge sends Tally).
#   $upgPhase = 'run' (after 2.3.3 started): S0 a Receipt by keys under 2.3.3 (its line with its body); the state copied;
#     S1 a Receipt by keys just before the upgrade; the gate's setup (bridge-dist, the committed 2.4.0) run over the running
#     2.3.3 as a person would (/S /CURRENTUSER /MODE=sole: the setup closes the old bridge itself); Tally started again with
#     2.4.0's add-on (the test sheet's check 1); S2 a Receipt by keys after the upgrade. Checks:
#   u1 the bridge answers as the gate's version; its settings carried (port, key, cloud, Tally ports and host)
#   u2 the recorder state carried: the starting point the same (start-point.json), S0 not sent again by 2.4.0, the ids
#      2.3.3 ended not sent again, S1 in FinCom exactly once with its body (nothing lost across the upgrade)
#   u3 the held lines from 2.3.3: each line still held at the upgrade asked ONCE by 2.4.0 (FinComVoucherObject at the
#      proxy) and ended (its ":resolved" line: with Tally's entry for the ten Journals); none asked twice; none lost
#   u4 S2 (after the upgrade, 2.4.0's add-on) in FinCom with its body
. (Join-Path $PSScriptRoot 'tdslib.ps1')
if ($upgPhase -eq 'seed') {
  Say '---- upg seed: ten Journals by XML, the sync folder as 2.3.3 left it on NWS144'
  $script:upgJ = @()
  $v0 = Vouchers
  foreach ($i in 1..10) {
    $null = Imp 'Vouchers' ('<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261004</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>upg held ' + $i + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + (30 + $i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + (30 + $i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') "upg journal $i"
  }
  $v1 = Vouchers
  $script:upgJ = @(foreach ($v in $v1) { if ($v.narr -like 'upg held *') { $null = TdsMid $v.mid; $v } })
  $cl = Post $listCoXml 'companies'
  $script:upgCg = ''
  foreach ($m in [regex]::Matches("$cl", '<COMPANY[^>]*>([\s\S]*?)</COMPANY>')) { if ([regex]::Match($m.Groups[1].Value, '<NAME[^>]*>([^<]*)</NAME>').Groups[1].Value -eq $co1) { $script:upgCg = [regex]::Match($m.Groups[1].Value, '<GUID[^>]*>([^<]*)</GUID>').Groups[1].Value.Trim() } }
  $sync = Join-Path $h1 'sync'; New-Item -ItemType Directory -Force $sync, (Join-Path $sync 'recorder-sent') | Out-Null
  $yest = (Get-Date).AddHours(-20).ToString('yyyy-MM-ddTHH:mm:sszzz'); $last = (Get-Date).AddHours(-2).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $items = [ordered]@{}; $script:upgOdd = @{}
  for ($i = 0; $i -lt 50; $i++) {
    $id = 'upgold{0:d3}' -f $i; $kind = @('plain', 'tries20', 'final', 'refetch', 'plain')[$i % 5]; $script:upgOdd[$id] = $kind
    $items[$id] = [ordered]@{ company = $co1; companyGuid = $script:upgCg; type = 'Journal'; no = ('OLD-{0:d3}' -f $i); date = '20261001'; masterId = "$(900001 + $i)"
      savedAt = $yest; added = $yest; last = $last; tries = $(if ($kind -eq 'tries20') { 20 } else { 0 }); event = 'created'
      why = $(if ($kind -eq 'tries20') { 'Tally did not give this entry after 20 tries' } elseif ($kind -eq 'refetch') { 'FinCom asked for this entry again' } elseif ($kind -eq 'final') { "Tally's voucher with that MasterID is not this line's entry" } else { "the entry was not read from Tally: Tally took longer than the recorder's limit; the bridge stopped waiting (2 s)" })
      lineGuid = ''; lineFid = ''; idsMismatch = $false; final = ($kind -eq 'final'); lineAlter = 0; fromFinCom = $false; keepGuid = ''; keepAlter = ''; refetch = ($kind -eq 'refetch'); triesVersion = '2.3.2'; again = $false; ledgerAgain = $false; slow = 1 }
  }
  $k = 0
  foreach ($j in $script:upgJ) {
    $k++; $id = 'upgreal{0:d2}' -f $k; $script:upgOdd[$id] = 'real'
    $items[$id] = [ordered]@{ company = $co1; companyGuid = $script:upgCg; type = 'Journal'; no = "$($j.vno)"; date = '20261004'; masterId = "$($j.mid)"
      savedAt = $yest; added = $yest; last = $last; tries = 1; event = 'created'; why = "the entry was not read from Tally: Tally took longer than the recorder's limit; the bridge stopped waiting (2 s)"
      lineGuid = ''; lineFid = ''; idsMismatch = $false; final = $false; lineAlter = 0; fromFinCom = $false; keepGuid = ''; keepAlter = ''; refetch = $false; triesVersion = '2.3.2'; again = $false; ledgerAgain = $false; slow = 1 }
  }
  [IO.File]::WriteAllText((Join-Path $sync 'recorder-held.json'), (@{ items = $items } | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
  $day = (Get-Date).ToString('yyyyMMdd')
  $script:upgEnded = @(1..10 | ForEach-Object { 'upgend{0:d2}' -f $_ })
  Add-Content (Join-Path $sync "recorder-sent\$day.ended.txt") $script:upgEnded -Encoding UTF8
  Add-Content (Join-Path $sync "recorder-sent\$day.txt") ($script:upgEnded | ForEach-Object { "${_}:resolved" }) -Encoding UTF8
  Info ("upg: seeded {0} held lines (50 old: plain / 20 tries / final / refetch, MasterIDs 900001..900050; 10 of Tally's own Journals by XML, MasterIDs {1}) and 10 ids 2.3.3 ended, company GUID '{2}'" -f $items.Count, (($script:upgJ | ForEach-Object { $_.mid }) -join ','), $script:upgCg)
  return
}

# ---------------------------------------------------------------- run
Say '---- upg: 2.4.0 over a running 2.3.3'
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$script:TdsRestart = { UpgTally $tdl 'fresh' | Out-Null }
$CU1 = 'u1 2.4.0 installed over 2.3.3: the version and the settings carried'; $CU2 = 'u2 the recorder state carried: nothing sent twice, nothing lost'
$CU3 = 'u3 held lines from 2.3.3: each asked once and ended'; $CU4 = 'u4 a new save after the upgrade arrives with its body'
$upDone = @{}
function URes($c, $st, $ev) { if (-not $upDone[$c]) { Result $c $st $ev; $upDone[$c] = $true } }
function ULog { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }
function UProxy { if (Test-Path $proxyLog) { $o = @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }); return , $o }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
# Tally started again with an add-on (by its process id; the proxy stopped first and started after, as s235)
function UpgTally([string]$tdlFile, [string]$tag) {
  Stop-S235Proxy
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  Write-TallyIni $tdlFile $folder.Name
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  $up = $false; for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; $up = $true; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 "upg-$tag-started"
  $ok = Start-S235Proxy
  Say "Tally started again ($tag, add-on $tdlFile): pid $($script:tpid), port up $up, proxy $ok"
  return ($up -and $ok)
}
# a Receipt by keys (flowv c4a's keys), its voucher in Tally
function UpgReceipt([string]$tag, [int]$amt) {
  $null = TdsGateway "before $tag"
  $b = Vouchers
  KeysTo 'v' 4 "upg-$tag-vouchers"; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo '2-10-2026{ENTER}' 3
  KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3; KeysTo "$amt{ENTER}" 3; KeysTo '^a' 5 "upg-$tag-saved"
  $null = TdsGateway "after $tag"
  $a = Vouchers
  $n = @(foreach ($v in $a) { if ("$($v.mid)" -notin @($b | ForEach-Object { "$($_.mid)" })) { $v } })
  if ($n.Count) { $null = TdsMid $n[0].mid; return $n[0] }
  return $null
}
function UStub($guid) { $l = StubLines 0; $o = @(foreach ($x in $l) { if ($x.guid -eq $guid) { $x } }); return , $o }
try {
  $ver0 = "$($st.version)"
  $cfg0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  Info "upg: the bridge before the upgrade: version $ver0 (expected 2.3.3), port $($cfg0.Port)"
  if ($ver0 -ne '2.3.3') { throw "the bridge installed first answers version '$ver0', not 2.3.3" }
  $t = Get-Date; $sp = $false
  while (((Get-Date) - $t).TotalMinutes -lt 5) { $l = ULog; if (@($l | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { $sp = $true; break }; Start-Sleep 5 }
  Info "upg: 2.3.3 recorded the starting point: $sp"
  # S0 under 2.3.3
  $s0 = UpgReceipt 's0' 701
  if (-not $s0) { throw 'the keys made no Receipt S0 under 2.3.3' }
  $g0 = $s0.guid; $w0 = WaitLine 0 { $_.guid -eq $g0 -and $_.xml } (Get-Date) 150
  Info "upg: S0 (mid $($s0.mid), $g0) under 2.3.3: $(if ($w0.Count) { "in the stub with its body at $($w0[0].at)" } else { 'NOT in the stub with its body in 150 s' })"
  # 2.3.3's state just before the upgrade
  $sync = Join-Path $h1 'sync'
  $stDir = Join-Path $out 'state-233'; New-Item -ItemType Directory -Force $stDir | Out-Null
  Copy-Item (Join-Path $sync '*') $stDir -Recurse -Force -ErrorAction SilentlyContinue
  $sp0 = Get-Content (Join-Path $sync 'start-point.json') -Raw -ErrorAction SilentlyContinue
  $held0 = try { (Get-Content (Join-Path $sync 'recorder-held.json') -Raw | ConvertFrom-Json).items } catch { $null }
  $held0Ids = if ($held0) { @($held0.PSObject.Properties.Name) } else { @() }
  # S1, then the upgrade at once
  $s1 = UpgReceipt 's1' 702
  if (-not $s1) { throw 'the keys made no Receipt S1 before the upgrade' }
  $mUp = Mark; $tUp = NowMs; $lnUp = (ULog).Count
  $setupNew = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-*.exe' | Select-Object -First 1
  $verNew = [regex]::Match($setupNew.Name, 'Setup-([0-9.]+)\.exe').Groups[1].Value
  Info "upg: $($held0Ids.Count) lines held by 2.3.3 at the upgrade; running $($setupNew.Name) ($(Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue)) over it"
  Copy-Item $setupNew.FullName "$fc\FinComBridge-Setup-new.exe" -Force
  $p = Start-Process -FilePath "$fc\FinComBridge-Setup-new.exe" -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the new setup did not end in 5 minutes' }
  Info "upg: the new setup ended with $($p.ExitCode)"
  Start-Sleep 15
  $cfg1 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  $bport = [int]$cfg1.Port; $bkey = "$($cfg1.Key)"; $blog = "$h1\tds-bridge.log"
  $st1 = $null; for ($i = 0; $i -lt 30 -and -not $st1; $i++) { $st1 = Bridge GET '/status' $null 10; if (-not $st1) { Start-Sleep 3 } }
  $keep = @('Port', 'Key', 'CloudUrl', 'CloudKey', 'TallyHost')
  $diff = @(foreach ($kname in $keep) { if ("$($cfg0.$kname)" -ne "$($cfg1.$kname)") { "$kname '$($cfg0.$kname)' -> '$($cfg1.$kname)'" } })
  if ((@($cfg0.TallyPorts) -join ',') -ne (@($cfg1.TallyPorts) -join ',')) { $diff += "TallyPorts $(@($cfg0.TallyPorts) -join ',') -> $(@($cfg1.TallyPorts) -join ',')" }
  URes $CU1 $(if ($st1 -and "$($st1.version)" -eq $verNew -and -not $diff.Count) { 'PASS' } else { 'FAIL' }) ("before: 2.3.3 on port {0}; the setup {1} ended {2}; after: {3}; settings changed: {4}" -f $cfg0.Port, $setupNew.Name, $p.ExitCode, $(if ($st1) { "version $($st1.version) on port $bport" } else { 'the bridge did not answer' }), $(if ($diff.Count) { $diff -join ', ' } else { 'none (port, key, cloud, Tally ports and host kept)' }))
  if (-not $st1) { throw 'the bridge did not answer after the upgrade' }
  # Tally with 2.4.0's add-on (test sheet check 1: the add-on loaded again)
  $null = UpgTally $tdl 'addon240'
  $s2 = UpgReceipt 's2' 703
  # the held lines asked by 2.4.0 (each once), then quiet: 8 minutes at most, 90 s with no new ask of them
  $heldMids = @{}; foreach ($n in $held0Ids) { $heldMids["$($held0.$n.masterId)"] = $n }
  $t = Get-Date; $lastN = -1; $quiet = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt 8) {
    $px = UProxy; $n = @($px | Where-Object { [int64]$_.t0 -ge $tUp -and $_.id -match 'FinComVoucher' -and $heldMids.ContainsKey("$($_.mid)") }).Count
    if ($n -ne $lastN) { $lastN = $n; $quiet = Get-Date } elseif (((Get-Date) - $quiet).TotalSeconds -ge 90 -and $n -gt 0) { break }
    Start-Sleep 10
  }
  Start-Sleep 20
  $lines = StubLines 0
  $after = @($lines | Where-Object { $_.i -ge $mUp })
  $px = UProxy; $pxA = @($px | Where-Object { [int64]$_.t0 -ge $tUp })
  # u2
  $sp1 = Get-Content (Join-Path $sync 'start-point.json') -Raw -ErrorAction SilentlyContinue
  $spSame = ("$sp0" -replace '\s', '') -eq ("$sp1" -replace '\s', '')
  $s0Again = @($after | Where-Object { $_.guid -eq $g0 })
  $endAgain = @($after | Where-Object { ($_.lid -replace ':resolved$', '') -in $script:upgEnded })
  $g1 = $s1.guid; $s1All = @($lines | Where-Object { $_.guid -eq $g1 -and $_.ev -eq 'created' })
  $s1Body = @($s1All | Where-Object { $_.xml })
  $ok2 = $spSame -and -not $s0Again.Count -and -not $endAgain.Count -and $s1Body.Count -eq 1
  URes $CU2 $(if ($ok2) { 'PASS' } else { 'FAIL' }) ("start-point.json the same after the upgrade: {0}{1}; S0 (2.3.3's, mid {2}) sent again by 2.4.0: {3}; the ids 2.3.3 ended sent again: {4}; S1 (saved just before the upgrade, mid {5}): lines {6}, with its body {7} ({8})" -f `
      $spSame, $(if (-not $spSame) { " (before '$(("$sp0" -replace '\s+', ' ').Substring(0, [math]::Min(200, "$sp0".Length)))' after '$(("$sp1" -replace '\s+', ' ').Substring(0, [math]::Min(200, "$sp1".Length)))')" }), $s0.mid, $s0Again.Count, $endAgain.Count, $s1.mid, $s1All.Count, $s1Body.Count, (($s1All | ForEach-Object { Ev $_ }) -join ' | '))
  # u3: each line still held at the upgrade asked once by 2.4.0 and ended; the real Journals with Tally's entry
  $res = foreach ($n in $held0Ids) {
    $h = $held0.$n; $m = "$($h.masterId)"
    $asks = @($pxA | Where-Object { $_.id -match 'FinComVoucher' -and "$($_.mid)" -eq $m })
    $end = @($lines | Where-Object { $_.lid -eq "${n}:resolved" })
    [pscustomobject]@{ id = $n; kind = $script:upgOdd[$n]; mid = $m; asks = $asks.Count; obj = @($asks | Where-Object { $_.id -eq 'FinComVoucherObject' }).Count; ended = $end.Count; body = @($end | Where-Object { $_.xml }).Count; words = "$(@($end | ForEach-Object { $_.held }) | Select-Object -First 1)" }
  }
  $res = @($res)
  $bad = @($res | Where-Object { $_.asks -ne 1 -or $_.obj -ne 1 -or $_.ended -lt 1 -or ($_.kind -eq 'real' -and $_.body -lt 1) })
  $seededIds = @($script:upgOdd.Keys)
  $lost = @($seededIds | Where-Object { $_ -notin $held0Ids -and -not @($lines | Where-Object { $_.lid -eq "${_}:resolved" }).Count -and $_ -notin $script:upgEnded })
  $byKind = ($res | Group-Object kind | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', '
  URes $CU3 $(if ($res.Count -and -not $bad.Count -and -not $lost.Count) { 'PASS' } elseif (-not $res.Count) { 'HARNESS' } else { 'FAIL' }) ("{0} lines held at the upgrade ({1}); asked once by 2.4.0 and ended: {2}; not so: {3}; seeded lines neither held at the upgrade nor ended (lost): {4}; e.g. {5}" -f `
      $res.Count, $byKind, ($res.Count - $bad.Count), $(if ($bad.Count) { ($bad | Select-Object -First 8 | ForEach-Object { "$($_.id) ($($_.kind), mid $($_.mid)) asks $($_.asks) object $($_.obj) ended $($_.ended) body $($_.body)" }) -join '; ' } else { 'none' }), $(if ($lost.Count) { $lost -join ', ' } else { 'none' }), (($res | Select-Object -First 2 | ForEach-Object { "$($_.id): $(if ($_.body) { 'with its body' } else { $_.words })" }) -join ' | '))
  # u4
  if (-not $s2) { URes $CU4 'HARNESS' 'the keys made no Receipt S2 after the upgrade' }
  else {
    $g2 = $s2.guid; $w2 = WaitLine 0 { $_.guid -eq $g2 -and $_.xml } (Get-Date) 150
    $recW = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge [DateTimeOffset]::FromUnixTimeMilliseconds($tUp).LocalDateTime } | ForEach-Object { $_.Name })
    URes $CU4 $(if ($w2.Count) { 'PASS' } else { 'FAIL' }) ("S2 mid {0} guid {1}: {2}; the add-on's files written after the upgrade: {3}" -f $s2.mid, $g2, $(if ($w2.Count) { Ev $w2[0] } else { 'no line with its body in 150 s' }), ($recW -join ', '))
  }
  Copy-Item (Join-Path $sync '*') (New-Item -ItemType Directory -Force (Join-Path $out 'state-240')).FullName -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Write-Host "upg stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($CU1, $CU2, $CU3, $CU4)) { URes $c 'HARNESS' "the harness stopped: $_" }
}
Snap 'upg-end'
