# Mode g253 (2.5.3's gate, 03-Nov-2026; TEST DATA ONLY, the runner's own Tally): the user's own Tally always found, and
# TallyPrime's connection switched on in tally.ini. The PUBLISHED 2.5.2 runs first (flowv.ps1 installs it); stubg.py is
# FinCom's cloud (every beat logged with its body); proxy235.py stands between the bridge and Tally (every request with its
# time). Dot-sourced by flowv.ps1 with $g253Phase = 'run':
#   n1 the committed setup installed over the published 2.5.2: its own version, the settings carried
#   n2 tally.ini with "Client Server = None" (Tally closed): the setup switches it to Both, ServerPort and every other line
#      unchanged; the bridge says "enabled; Tally needs one restart" and FinCom's words while no Tally answers
#   n3 Tally restarted once: it serves on its port, and FinCom's Connect (/status?fresh=1) finds the company within
#      15 s of Tally answering, without waiting for the 30 s heartbeat
#   n4 the heartbeat: the port with reason "open", no tallyWhy, the tally.ini state in the beat
#   n5 each request the bridge sent Tally 2 s or less in the background; one request in flight
# A step the harness could not do is HARNESS, never PASS.
if (-not (Get-Command TStop -ErrorAction SilentlyContinue)) { . (Join-Path $PSScriptRoot 'dblib.ps1') }
$N1 = 'n1 the committed setup installed over the published 2.5.2: its own version, the settings carried'
$N2 = 'n2 tally.ini Client Server = None: switched to Both by the setup, ServerPort and every other line unchanged'
$N3 = 'n3 Tally restarted once: it serves, and Connect finds the company within 15 s'
$N4 = 'n4 the heartbeat: the port open with its reason, no tallyWhy, the tally.ini state'
$N5 = 'n5 each background request 2 s or less; one request in flight'
Say '---- g253: the own Tally always found; Tally''s connection switched on'
$nDone = @{}
function NRes($c, $s, $ev) { if (-not $nDone[$c]) { Result $c $s $ev; $nDone[$c] = $true } }
function NProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Beats { if (Test-Path $stubLog) { return , @(Get-Content $stubLog -Encoding UTF8 | Where-Object { $_.Contains('"kind": "beat"') } | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }) }; return , @() }
$ini = Join-Path $dir 'tally.ini'
function IniLines { if (Test-Path $ini) { return , @([IO.File]::ReadAllText($ini) -split "`r?`n") }; return , @() }
$tStart = NowMs
try {
  # ---- n1 and n2: Tally closed, its connection off in tally.ini, the gate's setup over the published 2.5.2
  $st0 = Bridge GET '/status' $null 10
  $cfg0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  DbClose
  $before = IniLines
  $off = @($before | ForEach-Object { if ($_ -match '^\s*Client\s*Server\s*=') { 'Client Server = None' } else { $_ } })
  if (-not ($off -match '^\s*Client\s*Server\s*=')) { $off = @($off[0]) + @('Client Server = None') + @($off | Select-Object -Skip 1) }
  Set-Content -Path $ini -Value ($off | Where-Object { $_ -ne $null }) -Encoding ASCII
  $offTxt = [IO.File]::ReadAllText($ini); DbSave 'g253-ini-off.txt' $offTxt
  $origin = "$(Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue)"
  $vWant = [regex]::Match($origin, 'FinComBridge-Setup-([0-9.]+)\.exe').Groups[1].Value
  $setupNew = Get-ChildItem $env:BRIDGE_DIST -Filter "FinComBridge-Setup-$vWant.exe" | Select-Object -First 1
  $p = Start-Process -FilePath $setupNew.FullName -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the gate setup did not end' }
  Start-Sleep 20
  $cfg1n = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg1n.Port; $bkey = "$($cfg1n.Key)"
  $st1 = $null; for ($i = 0; $i -lt 30 -and -not $st1; $i++) { $st1 = Bridge GET '/status' $null 10; if (-not $st1) { Start-Sleep 3 } }
  Snap 'g253-upgraded'
  NRes $N1 $(if ($st0 -and "$($st0.version)" -eq '2.5.2' -and $st1 -and $vWant -and "$($st1.version)" -eq $vWant -and $origin -match '^setup origin: COMMITTED ' -and $cfg1n.Port -eq $cfg0.Port -and "$($cfg1n.Key)" -eq "$($cfg0.Key)" -and "$($cfg1n.TallyHost)" -eq "$($cfg0.TallyHost)" -and "$($cfg1n.CloudBeatSec)" -eq "$($cfg0.CloudBeatSec)") { 'PASS' } else { 'FAIL' }) ("before: {0}; the setup {1} ended {2}; after: {3}; port {4} -> {5}; key carried {6}; TallyHost {7} -> {8}; {9}" -f $(if ($st0) { "version $($st0.version)" } else { 'no answer' }), $setupNew.Name, $p.ExitCode, $(if ($st1) { "version $($st1.version)" } else { 'no answer' }), $cfg0.Port, $cfg1n.Port, ("$($cfg1n.Key)" -eq "$($cfg0.Key)"), $cfg0.TallyHost, $cfg1n.TallyHost, $origin)
  $after = IniLines; DbSave 'g253-ini-after.txt' ([IO.File]::ReadAllText($ini))
  $offL = @($offTxt -split "`r?`n")
  $changed = @(); for ($i = 0; $i -lt [math]::Max($offL.Count, $after.Count); $i++) { if ("$($offL[$i])" -ne "$($after[$i])") { $changed += "[$i] '$($offL[$i])' -> '$($after[$i])'" } }
  $csAfter = @($after | Where-Object { $_ -match '^\s*Client\s*Server\s*=' }) -join ' | '
  $portBefore = @($offL | Where-Object { $_ -match '^\s*Server\s*Port\s*=' }) -join ' | '
  $portAfter = @($after | Where-Object { $_ -match '^\s*Server\s*Port\s*=' }) -join ' | '
  $st2 = Bridge GET '/status?fresh=1' $null 30
  $iniBeat = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt 40 -and -not $iniBeat) { $b = (Beats) | Select-Object -Last 1; if ($b -and $b.body.tallyIni) { $iniBeat = @($b.body.tallyIni | Where-Object { "$($_.path)" -like '*\tally.ini' -and $_.connect }) | Select-Object -First 1 }; if (-not $iniBeat) { Start-Sleep 2 } }
  $ok2 = ($changed.Count -eq 1) -and ($csAfter -match '=\s*Both\s*$') -and ($portBefore -eq $portAfter) -and $iniBeat -and ("$($iniBeat.connect)" -eq 'enabled; Tally needs one restart') -and $st2 -and ("$($st2.tallyConnectSay)" -eq 'FinCom switched on Tally''s connection. Close and reopen Tally once.')
  NRes $N2 $(if ($ok2) { 'PASS' } elseif (-not $after.Count) { 'HARNESS' } else { 'FAIL' }) ("lines changed by the setup: {0} ({1}); Client Server after: '{2}'; ServerPort before '{3}', after '{4}'; the beat's tally.ini: {5}; /status tallyWhy '{6}', tallyConnectSay '{7}'" -f $changed.Count, ($changed -join '; '), $csAfter, $portBefore, $portAfter, $(if ($iniBeat) { "$($iniBeat.path): state $($iniBeat.state), connect '$($iniBeat.connect)', serverPort $($iniBeat.serverPort)" } else { 'not in the beat' }), $(if ($st2) { $st2.tallyWhy } else { '-' }), $(if ($st2) { $st2.tallyConnectSay } else { '-' }))
  # ---- n3: Tally started once on that file; Connect polled every second
  DbStartNoWait
  $tUp = $null; for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; if (DbPortOpen) { $tUp = Get-Date; break } }
  Start-Sleep 5; DbStartKeys 'g253'
  $coUp = $null; for ($i = 0; $i -lt 30 -and -not $coUp; $i++) { if (DbCompanyUp) { $coUp = Get-Date } else { Start-Sleep 2 } }
  $found = $null; $polls = 0
  if ($coUp) {
    while (((Get-Date) - $coUp).TotalSeconds -lt 60 -and -not $found) {
      $polls++; $s = Bridge GET '/status?fresh=1' $null 20
      if ($s) { foreach ($e in @($s.sessions)) { if ($e.ok -and -not $e.skipped -and (@($e.companies) | Where-Object { $_.name -eq $co1 })) { $found = Get-Date; $script:n3s = $s; break } } }
      if (-not $found) { Start-Sleep 1 }
    }
  }
  $sec = if ($found) { [math]::Round(($found - $coUp).TotalSeconds, 1) } else { -1 }
  Snap 'g253-restarted'
  NRes $N3 $(if (-not $tUp -or -not $coUp) { 'FAIL' } elseif ($found -and $sec -le 15) { 'PASS' } else { 'FAIL' }) ("Tally's port 9000 {0}; the company up in Tally {1}; Connect found it {2} s after ({3} polls); its port entry: {4}" -f $(if ($tUp) { 'listening after the restart' } else { 'NOT listening in 2 minutes' }), $(if ($coUp) { $coUp.ToString('HH:mm:ss') } else { 'never' }), $sec, $polls, $(if ($script:n3s) { (@($script:n3s.sessions) | ForEach-Object { "port $($_.port) ok $($_.ok) reason $($_.reason) owner '$($_.owner)'" }) -join '; ' } else { '-' }))
  # ---- n4: the heartbeat after it
  Start-Sleep 12
  $b4 = (Beats) | Select-Object -Last 1
  $op = if ($b4) { @($b4.body.ports | Where-Object { $_.ok -and -not $_.skipped }) } else { @() }
  $ok4 = $b4 -and $op.Count -ge 1 -and (@($op | Where-Object { "$($_.reason)" -eq 'open' }).Count -ge 1) -and -not "$($b4.body.tallyWhy)" -and $b4.body.tallyState -eq 'open' -and (@($b4.body.tallyIni | Where-Object { $_.connect }).Count -ge 1)
  NRes $N4 $(if (-not $b4) { 'HARNESS' } elseif ($ok4) { 'PASS' } else { 'FAIL' }) ("the last beat: tallyState {0}, tallyWhy '{1}', tallyConnectSay '{2}', ports {3}; tally.ini {4}" -f $b4.body.tallyState, $b4.body.tallyWhy, $b4.body.tallyConnectSay, ((@($b4.body.ports) | ForEach-Object { "$($_.port) ok=$($_.ok) reason=$($_.reason) n=$($_.n)" }) -join '; '), ((@($b4.body.tallyIni) | ForEach-Object { "$($_.path): $($_.state) / $($_.connect)" }) -join '; '))
  # ---- n5: the requests at Tally through the proxy since the gate's setup
  $px = @((NProxy) | Where-Object { [int64]$_.t0 -ge $tStart } | Sort-Object { [int64]$_.t0 })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $px) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  $worst = ($px | Measure-Object -Property ms -Maximum).Maximum
  $byId = ($px | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count) worst $((($_.Group | Measure-Object -Property ms -Maximum).Maximum)) ms" }) -join '; '
  NRes $N5 $(if (-not $px.Count) { 'HARNESS' } elseif ($overlap -eq 0 -and $worst -le 2000) { 'PASS' } else { 'FAIL' }) ("{0} requests at Tally since the gate's setup, worst {1} ms; started while another was at Tally: {2}; {3}" -f $px.Count, $worst, $overlap, $byId)
} catch {
  Info "g253: $_ (line $($_.InvocationInfo.ScriptLineNumber))"
  foreach ($c in $N1, $N2, $N3, $N4, $N5) { NRes $c 'HARNESS' "not done: $_" }
}
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
