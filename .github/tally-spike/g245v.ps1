# Mode g245 (bridge 2.4.5's gate; TEST DATA ONLY: a throwaway company in this runner's own Tally, never the owner's
# computer). The gate's setup (the committed FinComBridge-Setup-2.4.5.exe, from_source=no) as a person installs it, with
# stub245.py as FinCom's cloud (migration 98 and tally-ingest of next-245, modelled) and proxy235.py between the bridge and
# Tally (every request the bridge sends Tally logged with its time). Dot-sourced by flowv.ps1 twice:
#   $g5Phase = 'masters' (before the bridge is installed): ZZ BIG TEST (about 30,000 entries in FY 2026-27, 20,000 ledgers;
#     dbm/redate.py with DBM_PROFILE=big) made by XML, Tally's own truth taken (entries per day, ledgers); tally.ini written
#     as a client's may be (User TDL = Yes, another add-on of the client's own); nothing of FinCom's in it
#   $g5Phase = 'run' (after the setup ran):
#   g1 the installer added FinCom's add-on to tally.ini (add only, after the other TDL, backup = the file as it was, User
#      TDL not added again); Tally started again from that tally.ini loads FinCom's add-on AND the client's other TDL; the
#      beat reports "added"; the per-user first-start marker written
#   g2 the year counted day by day (FinComDayHeads, one day at a time, only days FinCom listed): every day's count exactly
#      Tally's own; the year above 20,000 vouchers (the half-years offered)
#   g3 the chosen part (Apr-Sep) fetched: FinCom ends holding every entry Tally lists for every day of it; only what
#      FinCom lacked asked (FinComVoucherObject once each); nothing asked for a day outside the part; no day to upload;
#      the progress line ends "N of N vouchers (100%)"
#   g4 no request over 2 s, one request at Tally at a time, Tally's window never blocked 2 s or more during the count and
#      the fetch (a probe of the window every 100 ms), Tally responding at the end
#   g5 postings first during the fetch: a posting from FinCom (/import) taken at once; no read of an older day reached
#      Tally after the posting's own request until the posting was done; the fetch went on after it
#   g6 the ledger count (Connect Tally step 5, the "ledgers" wake): FinComLedgerIds; the progress sent to FinCom never
#      going back and ending "N of N" with N Tally's own ledger count; every request under 2 s
#   g7 a tally.ini with User TDL = No: the setup run again leaves it byte for byte; the beat reports usertdl-no
#   g8 job files under load: a posting job of 300 entries (POST /jobs) while the job is read without pause (GET /jobs?id=
#      and progress.json opened directly): never "no such job", never unreadable, the count never going back, done with
#      every entry
# A step the harness could not do is HARNESS, never PASS. Results: versions\results.txt; captures: stub-state.json,
# proxy.jsonl, the tally.ini files, the bridge log.
. (Join-Path $PSScriptRoot 'dblib.ps1')
$G1 = 'g1 the installer added the add-on to tally.ini; Tally loads it and the client''s other TDL at start'
$G2 = 'g2 the year counted day by day, every day exactly Tally''s count'
$G3 = 'g3 the chosen part fetched: FinCom holds every entry Tally lists, only what it lacked asked'
$G4 = 'g4 no request over 2 s, one at a time, Tally''s window never blocked 2 s, Tally responding'
$G5 = 'g5 postings first during the fetch'
$G6 = 'g6 the exact ledger count and its progress'
$G7 = 'g7 User TDL = No left untouched and reported'
$G8 = 'g8 job files read while written: nothing lost, never missing'
$fcAddon = 'C:\ProgramData\FinCom\addon\FinComRecorder.tdl'
$otherTdl = 'C:\fcother\FinComOtherTest.tdl'
$iniPath = Join-Path $dir 'tally.ini'
$g5Ctl = Join-Path $out 'stub245-ctl.json'; $g5State = Join-Path $out 'stub-state.json'
function G5Ini { @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'Default Companies = Yes', "Load = $($folder.Name)") }
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
function Ents([string]$b) {
  $l = [Collections.Generic.List[object]]::new()
  foreach ($m in [regex]::Matches((NoInfo $b), '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $l.Add([pscustomobject]@{ date = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value; mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value })
  }
  return , $l.ToArray()
}
function TruthV {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DBTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DBTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE, MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  return (Ents $r.body)
}
function FormulaProbe([string]$name) {
  $x = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCIniProbe</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCIniProbe" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCPROBE:@@' + $name + '</COMPUTE></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $r = TStop $x 2000 20000; if ($r.hung) { DbClose }
  return [regex]::Match($r.body, '<FCPROBE[^>]*>([^<]*)<').Groups[1].Value
}
function G5Ctl($o) { [IO.File]::WriteAllText($g5Ctl, ($o | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false)) }

if ($g5Phase -eq 'masters') {
  Say '---- g245 masters (before the bridge): ZZ BIG TEST, Tally''s truth, tally.ini as a client''s'
  G5Ctl @{ company = $co1; phase = 'off' }
  $script:g5Made = DbMakeData
  $script:g5Led = DbLedgersTo 20000
  $tv = @(TruthV | Where-Object { $_.date })
  $script:g5Truth = @{}; foreach ($g in ($tv | Group-Object date)) { $script:g5Truth[$g.Name] = $g.Count }
  $script:g5TruthMid = @{}; foreach ($e in $tv) { $script:g5TruthMid[$e.mid] = $e.date }
  Info ("g245: {0}; ledgers {1}; entries in Tally {2} on {3} days" -f $script:g5Made, $script:g5Led, $tv.Count, $script:g5Truth.Count)
  New-Item -ItemType Directory -Force (Split-Path $otherTdl) | Out-Null
  Set-Content $otherTdl @('; a harmless TDL standing for a client''s own add-on (harness only)', '[System: Formula]', '    FCOtherMark : "other-loaded"') -Encoding ASCII
  $script:g5IniA = (G5Ini) + @('User TDL = Yes', "TDL = $otherTdl")
  Remove-Item "$iniPath.fincom-bak" -Force -ErrorAction SilentlyContinue
  Set-Content -Path $iniPath -Value $script:g5IniA -Encoding ASCII
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-A-before-setup.txt') -Force
  return
}

# ---------------------------------------------------------------- run
Say '---- g245: the gate'
$gDone = @{}
function GRes($c, $s, $ev) { if (-not $gDone[$c]) { Result $c $s $ev; $gDone[$c] = $true } }
function GState { try { return (Get-Content $g5State -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null } }
function GProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function GLog { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Nf($n) { ([int64]$n).ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('en-IN')) }
function Prop($o, [string]$k) { if ($null -eq $o) { return $null }; $p = $o.PSObject.Properties[$k]; if ($p) { return $p.Value }; return $null }
# Tally started again from tally.ini as it is (the harness does not write it), by its own process id; the proxy after it
function G5Restart([string]$tag) {
  Stop-S235Proxy; DbClose; DbStartNoWait
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; if (DbPortOpen) { break } }
  Start-Sleep 5; DbStartKeys $tag
  $up = $false; for ($i = 0; $i -lt 20; $i++) { if (DbCompanyUp) { $up = $true; break }; Start-Sleep 3 }
  $ok = Start-S235Proxy
  Say "g245: Tally started again ($tag): pid $($script:tpid), company up $up, proxy $ok"
  return ($up -and $ok)
}
# ---- the window probe (dbbigv.ps1's): the longest time Tally's window did not answer WM_NULL within 250 ms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class G5Frz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res); }
'@
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; maxAt = ''; beats = 0; err = ''; over = 0 })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null
    while (-not $f.stop) {
      if ($f.on -and $f.h -ne [IntPtr]::Zero) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [G5Frz]::SendMessageTimeout($f.h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $t0 }; $cur = $sw.Elapsed.TotalMilliseconds - $since; if ($cur -gt $f.max) { $f.max = $cur; $f.maxAt = (Get-Date).ToString('HH:mm:ss') } }
        else { if ($null -ne $since -and ($sw.Elapsed.TotalMilliseconds - $since) -ge 2000) { $f.over++ }; $since = $null }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
} catch { Info "g245: the window probe could not start ($_)" }
function FrzOn { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.on = $true }

try {
  # ---- the bridge's start: its version, the starting point recorded (reading is prospective only)
  $t = Get-Date; $sp = $false
  while (((Get-Date) - $t).TotalMinutes -lt 6) { if (@((GLog) | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { $sp = $true; break }; Start-Sleep 5 }
  Info "g245: the bridge $($st.version) recorded the company's starting point: $sp"

  # ================================================================ g1 tally.ini (the installer)
  $after = @(Get-Content $iniPath); Copy-Item $iniPath (Join-Path $cap 'tally-ini-A-after-setup.txt') -Force
  $bak = "$iniPath.fincom-bak"; $bakSame = (Test-Path $bak) -and ((Get-Content $bak) -join "`n") -eq ($script:g5IniA -join "`n")
  $j = 0; foreach ($l in $after) { if ($j -lt $script:g5IniA.Count -and $l -eq $script:g5IniA[$j]) { $j++ } }; $kept = ($j -eq $script:g5IniA.Count)
  $added = @($after | Select-Object -Skip 0 | Where-Object { $_ -notin $script:g5IniA })
  $addOk = ($added.Count -eq 1 -and $added[0] -eq "TDL = $fcAddon")
  $iOther = [array]::IndexOf($after, "TDL = $otherTdl"); $iMine = [array]::IndexOf($after, "TDL = $fcAddon")
  $userN = @($after | Where-Object { $_ -match '^\s*User\s+TDL\s*=' }).Count
  $exeDir = ''; try { $bp = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -match 'FinCom' -and $_.Name -match '\.exe$' } | Select-Object -First 1; if ($bp) { $exeDir = Split-Path $bp.ExecutablePath } } catch {}
  $marker = if ($exeDir) { Get-Content (Join-Path $exeDir 'fincom-tallyini-version.txt') -ErrorAction SilentlyContinue } else { '' }
  $up = G5Restart 'ini-A'
  $mine = FormulaProbe 'FCRFolder'; $oth = FormulaProbe 'FCOtherMark'
  $afterTally = @(Get-Content $iniPath); $untouched = (($afterTally -join "`n") -eq ($after -join "`n"))
  Start-Sleep 20
  $gs = GState; $ini = @((Prop $gs 'tallyIni')); $iniMe = @($ini | Where-Object { "$($_.path)" -ieq $iniPath }) | Select-Object -First 1
  $blIni = @((GLog) | Where-Object { $_ -match 'tally\.ini' } | Select-Object -Last 3)
  GRes $G1 $(if (-not $up) { 'HARNESS' } elseif ($addOk -and $kept -and $bakSame -and $iMine -gt $iOther -and $userN -eq 1 -and $mine -eq 'C:\ProgramData\FinCom\recorder\' -and $oth -eq 'other-loaded' -and $untouched -and $iniMe -and "$($iniMe.state)" -in 'added', 'already') { 'PASS' } else { 'FAIL' }) ("added by the setup: [{0}]; the lines before kept in order {1}; after the client's TDL line {2}; User TDL lines {3}; backup = the file as it was {4}; Tally started again: FinCom's add-on formula '{5}', the client's TDL formula '{6}'; Tally left the file as it was {7}; the beat: {8}; the per-user marker '{9}' in '{10}'; the log: {11}" -f ($added -join ' | '), $kept, ($iMine -gt $iOther), $userN, $bakSame, $mine, $oth, $untouched, $(if ($iniMe) { "$($iniMe.path) $($iniMe.state)" } else { "no entry for $iniPath ($(($ini | ForEach-Object { "$($_.path) $($_.state)" }) -join '; '))" }), "$marker", $exeDir, ($blIni -join ' | '))

  # ================================================================ g2 the year counted
  $today = (Get-Date).ToString('yyyyMMdd')
  $days = @(); $d = [DateTime]::ParseExact('20260401', 'yyyyMMdd', $null)
  while ($d.ToString('yyyyMMdd') -le $today -and $d.ToString('yyyyMMdd') -le '20270331') { $days += $d.ToString('yyyyMMdd'); $d = $d.AddDays(1) }
  [array]::Reverse($days)
  Say "g245: counting FY 2026-27, $($days.Count) days (newest first)"
  Start-Sleep 70   # the person's 60 s (the keys of the restart) go by first
  FrzOn; $tCount = NowMs
  G5Ctl @{ company = $co1; phase = 'count'; count_days = $days }
  $t = Get-Date; $gs = $null
  while (((Get-Date) - $t).TotalMinutes -lt 75) {
    Start-Sleep 20; $gs = GState
    $c = Prop $gs 'counted'; $n = if ($c) { @($c.PSObject.Properties).Count } else { 0 }
    Write-Host "[g245] counted $n of $($days.Count) days"
    if ($n -ge $days.Count) { break }
    if ($n -eq 0 -and ((Get-Date) - $t).TotalMinutes -gt 10) { break }
  }
  $tCountEnd = NowMs
  $c = Prop $gs 'counted'
  $bad = @(); $sum = 0; $tsum = 0
  foreach ($dd in $days) { $got = Prop $c $dd; $want = [int]$script:g5Truth[$dd]; $tsum += $want; if ($null -eq $got) { $bad += "$dd not counted" } else { $sum += [int]$got; if ([int]$got -ne $want) { $bad += "$dd $got (Tally $want)" } } }
  $half = $sum -gt 20000
  $waits = @((GLog) | Where-Object { $_ -match 'Older entries of .* waits' } | Select-Object -Last 3)
  GRes $G2 $(if (-not $c) { 'FAIL' } elseif (-not $bad.Count -and $half) { 'PASS' } else { 'FAIL' }) ("{0} days counted in {1} min, {2} vouchers in all (Tally's own {3}); not as Tally: {4}; above 20,000 (the half-years offered): {5}; the bridge's waits: {6}" -f $(if ($c) { @($c.PSObject.Properties).Count } else { 0 }), [math]::Round(($tCountEnd - $tCount) / 60000, 1), (Nf $sum), (Nf $tsum), $(if ($bad.Count) { ($bad | Select-Object -First 8) -join '; ' } else { 'none' }), $half, ($waits -join ' | '))

  # ================================================================ g3 the part chosen (Apr-Sep), with g5 during it
  $part = @($days | Where-Object { $_ -le '20260930' }); [array]::Reverse($part)
  $missing = @('20260601', '20260702', '20260831') | Where-Object { $_ -in $part }
  $wantTotal = 0; foreach ($m in $missing) { $wantTotal += [int]$script:g5Truth[$m] }
  Say "g245: fetching Apr-Sep ($($part.Count) days); FinCom lacks $($missing -join ', ') ($wantTotal entries)"
  $tFetch = NowMs
  G5Ctl @{ company = $co1; phase = 'fetch'; count_days = $days; part_days = $part; missing = $missing }
  $posted = $false; $imp = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt 90) {
    Start-Sleep 10; $gs = GState
    if (-not $gs) { continue }
    $done = @((Prop $gs 'done')); $left = @($part | Where-Object { $_ -notin $done -and $_ -notin @((Prop $gs 'upload').PSObject.Properties.Name) })
    $px = GProxy; $objNow = @($px | Where-Object { $_.id -eq 'FinComVoucherObject' -and [int64]$_.t0 -ge $tFetch }).Count
    Write-Host "[g245] fetch: $($part.Count - $left.Count) of $($part.Count) days done; FinComVoucherObject asked $objNow"
    # g5: a posting from FinCom while the fetch is going (entries being asked)
    if (-not $posted -and $objNow -ge 50) {
      $posted = $true
      $vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g245 posting during the fetch</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-25.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>25.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
      $iS = NowMs
      $ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "g245-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"; xml = $vx }) } 120
      $iE = NowMs
      $imp = [pscustomobject]@{ s = $iS; e = $iE; ok = ($ir -and @($ir.results)[0].ok -eq $true); ans = ($ir | ConvertTo-Json -Depth 6 -Compress) }
      Info "g245: the posting during the fetch: $($iE - $iS) ms, ok $($imp.ok)"
    }
    if (-not $left.Count) { break }
  }
  $tFetchEnd = NowMs
  Start-Sleep 5
  $script:frz.on = $false
  $gs = GState; $gs | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $cap 'stub-state-after-fetch.json') -Encoding UTF8
  $counted = Prop $gs 'counted'; $held = Prop $gs 'held'; $up5 = @((Prop $gs 'upload').PSObject.Properties | ForEach-Object { "$($_.Name): $($_.Value.words)" })
  $notHeld = @(foreach ($dd in $part) { $h = [int](Prop $held $dd); $n = [int](Prop $counted $dd); $tw = [int]$script:g5Truth[$dd]; if ($h -lt $n -or $n -ne $tw) { "$dd held $h of $n (Tally $tw)" } })
  $y = 0; $x = 0; foreach ($dd in $part) { $y += [int](Prop $counted $dd); $x += [math]::Min([int](Prop $held $dd), [int](Prop $counted $dd)) }
  $pct = if ($y) { [math]::Round($x * 100 / $y) } else { 0 }; if ($x -lt $y -and $pct -ge 100) { $pct = 99 }
  $words = "{0} of {1} vouchers ({2}%) · {3}" -f (Nf $x), (Nf $y), $pct, $(if ($y - $x) { "$(Nf ($y - $x)) left" } else { 'all in FinCom' })
  $px = GProxy
  $pxF = @($px | Where-Object { [int64]$_.t0 -ge $tFetch -and [int64]$_.t0 -le $tFetchEnd })
  $objMids = @($pxF | Where-Object { $_.id -eq 'FinComVoucherObject' } | ForEach-Object { "$($_.mid)" })
  $wantAll = @(); $wantMap = Prop $gs 'want'; foreach ($p in @($wantMap.PSObject.Properties)) { $wantAll += @($p.Value | ForEach-Object { "$_" }) }
  $objTwice = @($objMids | Group-Object | Where-Object { $_.Count -gt 1 }).Count
  $objNotWanted = @($objMids | Where-Object { $_ -notin $wantAll }).Count
  $missOk = @($missing | Where-Object { [int](Prop (Prop $gs 'entries_sent') $_) -ge [int]$script:g5Truth[$_] }).Count -eq $missing.Count
  $listed = @((Prop $gs 'period_days_listed') | Where-Object { $_[2] -eq $true } | ForEach-Object { @($_[1]) })
  $outside = @($listed | Where-Object { $_ -notin $part } | Sort-Object -Unique)
  $badDates = @((Prop $gs 'bad_dates')).Count
  GRes $G3 $(if (-not $gs) { 'HARNESS' } elseif (-not $notHeld.Count -and $x -eq $y -and $missOk -and -not $up5.Count -and $objTwice -eq 0 -and $objNotWanted -eq 0 -and -not $outside.Count -and $badDates -eq 0 -and $objMids.Count -ge $wantTotal) { 'PASS' } else { 'FAIL' }) ("Apr-Sep, {0} days, in {1} min: the progress line ends '{2}'; days not held in full or not as Tally: {3}; FinCom lacked {4} entries on {5}: all sent {6}; FinComVoucherObject asked {7} times ({8} wanted by FinCom; asked twice {9}; not wanted {10}); days listed for the fetch outside the part {11}; entries with another date {12}; days to upload: {13}" -f $part.Count, [math]::Round(($tFetchEnd - $tFetch) / 60000, 1), $words, $(if ($notHeld.Count) { ($notHeld | Select-Object -First 6) -join '; ' } else { 'none' }), $wantTotal, ($missing -join ', '), $missOk, $objMids.Count, $wantAll.Count, $objTwice, $objNotWanted, $(if ($outside.Count) { $outside -join ',' } else { 'none' }), $badDates, $(if ($up5.Count) { $up5 -join ' | ' } else { 'none' }))

  # ================================================================ g4 the 2 s rule, one at a time, no freeze
  $pxC = @($px | Where-Object { [int64]$_.t0 -ge $tCount -and [int64]$_.t0 -le $tFetchEnd -and $_.method -eq 'POST' } | Sort-Object { [int64]$_.t0 })
  $over = @($pxC | Where-Object { [int]$_.ms -gt 2000 })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $pxC) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  $byId = ($pxC | Group-Object id | ForEach-Object { $w = ($_.Group | Measure-Object -Property ms -Maximum).Maximum; "$($_.Name) $($_.Count) (worst $w ms)" }) -join ', '
  $stops = @((GLog) | Where-Object { $_ -match 'longer than 2 s|stopped waiting \(2 s\)|over 2 s' } | Select-Object -Last 3)
  $resp = DbResponding
  $blocked = if ($script:frzOk) { [math]::Round($script:frz.max) } else { -1 }
  GRes $G4 $(if (-not $pxC.Count -or -not $script:frzOk) { 'HARNESS' } elseif (-not $over.Count -and $overlap -eq 0 -and $blocked -lt 2000 -and $resp) { 'PASS' } else { 'FAIL' }) ("{0} requests at Tally during the count and the fetch ({1}); over 2 s: {2}; started while another was at Tally: {3}; Tally's window longest not answering {4} ms (at {5}; spells of 2 s or more: {6}); Tally responding at the end {7}; the bridge's stops: {8}" -f $pxC.Count, $byId, $(if ($over.Count) { ($over | Select-Object -First 5 | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join ', ' } else { 'none' }), $overlap, $blocked, $script:frz.maxAt, $script:frz.over, $resp, $(if ($stops.Count) { $stops -join ' | ' } else { 'none' }))

  # ================================================================ g5 postings first
  if (-not $imp) { GRes $G5 'HARNESS' 'the fetch never reached 50 entries asked: no posting made during it' }
  else {
    $impReq = @($px | Where-Object { $_.id -eq 'Import' -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -le $imp.e }) | Select-Object -First 1
    $pullIds = 'FinComDayHeads', 'FinComVoucherObject'
    $inside = if ($impReq) { @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -gt [int64]$impReq.t0 -and [int64]$_.t0 -lt $imp.e }).Count } else { -1 }
    $before = if ($impReq) { @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -lt [int64]$impReq.t0 }).Count } else { -1 }
    $afterN = @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -ge $imp.e }).Count
    $wait = if ($impReq) { [int64]$impReq.t0 - $imp.s } else { -1 }
    GRes $G5 $(if (-not $impReq) { 'FAIL' } elseif ($imp.ok -and $inside -eq 0 -and $before -le 1 -and $wait -lt 2500 -and $afterN -gt 0 -and ($imp.e - $imp.s) -lt 15000) { 'PASS' } else { 'FAIL' }) ("the posting: {0} ms in all, ok {1}; its request reached Tally {2} ms after FinCom asked (older-day reads started before it in that time: {3}); older-day reads started after it until the posting was done: {4}; the fetch went on after it ({5} more reads); the answer {6}" -f ($imp.e - $imp.s), $imp.ok, $wait, $before, $inside, $afterN, $imp.ans.Substring(0, [math]::Min(300, $imp.ans.Length)))
  }

  # ================================================================ g6 the ledger count
  $nLed = TruthLedgers
  $tL = NowMs
  G5Ctl @{ company = $co1; phase = 'off'; ledgers_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
  $t = Get-Date; $lp = @()
  while (((Get-Date) - $t).TotalMinutes -lt 20) { Start-Sleep 15; $gs = GState; $lp = @((Prop $gs 'ledger_progress')); if (@($lp | Where-Object { $_.done -eq $true }).Count) { break } }
  G5Ctl @{ company = $co1; phase = 'off' }
  $px = GProxy; $pxL = @($px | Where-Object { [int64]$_.t0 -ge $tL })
  $ids = @($pxL | Where-Object { $_.id -eq 'FinComLedgerIds' }); $ledReq = @($pxL | Where-Object { $_.id -eq 'FinComLedgers' })
  $last = $lp | Select-Object -Last 1
  $back = 0; $prev = 0; foreach ($p in $lp) { if ([int]$p.read -lt $prev) { $back++ }; $prev = [int]$p.read }
  $ofSame = @($lp | Where-Object { [int]$_.of -ne $nLed }).Count
  $worstL = (@($pxL | Where-Object { $_.id -in 'FinComLedgerIds', 'FinComLedgers' }) | Measure-Object -Property ms -Maximum).Maximum
  GRes $G6 $(if (-not $lp.Count) { 'FAIL' } elseif ($last.done -eq $true -and [int]$last.read -eq $nLed -and [int]$last.of -eq $nLed -and $back -eq 0 -and $ofSame -eq 0 -and $ids.Count -ge 1 -and $worstL -le 2000) { 'PASS' } else { 'FAIL' }) ("Tally's ledgers {0}; FinComLedgerIds asked {1} time(s) ({2} ms), FinComLedgers {3} chunk(s), worst {4} ms; progress sent {5} time(s): {6}; the last '{7} of {8} ledgers' done {9}; going back {10}; 'of' not Tally's count {11}" -f (Nf $nLed), $ids.Count, (($ids | ForEach-Object { $_.ms }) -join '/'), $ledReq.Count, $worstL, $lp.Count, (($lp | Select-Object -First 6 | ForEach-Object { "$($_.read)/$($_.of)" }) -join ', '), (Nf $last.read), (Nf $last.of), $last.done, $back, $ofSame)

  # ================================================================ g7 User TDL = No (the setup run again)
  $iniC = (G5Ini) + @('User TDL = No', "TDL = $otherTdl")
  Set-Content -Path $iniPath -Value $iniC -Encoding ASCII
  $hC = (Get-FileHash $iniPath).Hash; $hBak = (Get-FileHash $bak -ErrorAction SilentlyContinue).Hash
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-C-before-setup.txt') -Force
  $m0 = (GLog).Count
  $p = Start-Process -FilePath $setup -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the setup did not end in 5 minutes' }
  Start-Sleep 15
  $cfg2 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg2.Port; $bkey = "$($cfg2.Key)"
  $st2 = $null; for ($i = 0; $i -lt 30 -and -not $st2; $i++) { $st2 = Bridge GET '/status' $null 10; if (-not $st2) { Start-Sleep 3 } }
  $t = Get-Date; $iniMe = $null
  while (((Get-Date) - $t).TotalMinutes -lt 4) { Start-Sleep 10; $gs = GState; $iniMe = @(@((Prop $gs 'tallyIni')) | Where-Object { "$($_.path)" -ieq $iniPath -and "$($_.state)" -eq 'usertdl-no' }) | Select-Object -First 1; if ($iniMe) { break } }
  $hC2 = (Get-FileHash $iniPath).Hash; $hBak2 = (Get-FileHash $bak -ErrorAction SilentlyContinue).Hash
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-C-after-setup.txt') -Force
  $lC = @((GLog) | Select-Object -Skip $m0 | Where-Object { $_ -match 'User TDL = No' } | Select-Object -Last 2)
  GRes $G7 $(if ($p.ExitCode -ne 0 -or -not $st2) { 'HARNESS' } elseif ($hC -eq $hC2 -and $hBak -eq $hBak2 -and $iniMe) { 'PASS' } else { 'FAIL' }) ("the setup run again (exit {0}, the bridge {1}); tally.ini byte for byte the same {2}; the backup untouched {3}; the beat: {4}; the log: {5}" -f $p.ExitCode, $(if ($st2) { $st2.version } else { 'not answering' }), ($hC -eq $hC2), ($hBak -eq $hBak2), $(if ($iniMe) { "$($iniMe.state): $($iniMe.why)" } else { 'no usertdl-no entry' }), ($lC -join ' | '))
  Set-Content -Path $iniPath -Value $script:g5IniA -Encoding ASCII   # back as it was (the client's own)

  # ================================================================ g8 job files read while written
  $jid = "g245stress-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
  $vs = @(foreach ($k in 1..300) { $a = '{0:0.00}' -f (1 + $k / 100); @{ id = "$jid-$k"; xml = ('<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g245 job ' + $k + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') } })
  $jr = Bridge POST '/jobs' @{ jobId = $jid; company = $co1; vouchers = $vs } 60
  $pf = Join-Path (Join-Path (Join-Path $h1 'jobs') $jid) 'progress.json'
  # the job's folder where the bridge keeps it (its Home\jobs; looked for once the job is there)
  for ($i = 0; $i -lt 20 -and -not (Test-Path $pf); $i++) { $f = Get-ChildItem $env:LOCALAPPDATA, $env:ProgramData -Recurse -Filter 'progress.json' -ErrorAction SilentlyContinue | Where-Object { (Split-Path $_.DirectoryName -Leaf) -eq $jid } | Select-Object -First 1; if ($f) { $pf = $f.FullName; break }; Start-Sleep -Milliseconds 500 }
  Info "g245: the job's progress file: $pf (there: $(Test-Path $pf))"
  $reads = 0; $noJob = 0; $unread = 0; $fileMiss = 0; $fileBad = 0; $backN = 0; $prevDone = -1; $status = ''; $view = $null
  $t = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt 20) {
    $reads++
    try { $view = Invoke-RestMethod -Uri "http://127.0.0.1:$bport/jobs?id=$jid" -Headers @{ 'X-Bridge-Key' = $bkey } -TimeoutSec 10
      if (-not $view -or ($view.PSObject.Properties['error'] -and "$($view.error)" -match 'No such job')) { $noJob++ } else { $dn = [int]$view.done; if ($dn -lt $prevDone) { $backN++ }; $prevDone = [math]::Max($prevDone, $dn); $status = "$($view.status)" }
    } catch { if ("$($_.ErrorDetails.Message)$($_.Exception.Message)" -match 'No such job') { $noJob++ } else { $unread++ } }
    try { $fs = [IO.File]::Open($pf, 'Open', 'Read', [IO.FileShare]'ReadWrite, Delete'); try { $sr = [IO.StreamReader]::new($fs); $txt = $sr.ReadToEnd() } finally { $fs.Dispose() }; try { $null = $txt | ConvertFrom-Json } catch { $fileBad++ } } catch [IO.FileNotFoundException] { $fileMiss++ } catch { $fileMiss++ }
    if ($status -in 'done', 'failed', 'cancelled') { break }
    Start-Sleep -Milliseconds 30
  }
  $res = @($view.results); $okN = @($res | Where-Object { $_.ok -eq $true }).Count
  GRes $G8 $(if (-not $jr) { 'HARNESS' } elseif ($status -eq 'done' -and $okN -eq 300 -and $noJob -eq 0 -and $unread -eq 0 -and $fileMiss -eq 0 -and $fileBad -eq 0 -and $backN -eq 0) { 'PASS' } else { 'FAIL' }) ("the job of 300 entries: {0}, {1} of 300 posted; read {2} times while written: 'no such job' {3}, not answered {4}; progress.json opened directly: missing or locked {5}, not whole {6}; the count going back {7}; {8} min" -f $status, $okN, $reads, $noJob, $unread, $fileMiss, $fileBad, $backN, [math]::Round(((Get-Date) - $t).TotalMinutes, 1))
} catch {
  Write-Host "g245 stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($G1, $G2, $G3, $G4, $G5, $G6, $G7, $G8)) { GRes $c 'HARNESS' "the harness stopped: $_" }
}
$script:frz.stop = $true
Snap 'g245-end'
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Copy-Item $g5State (Join-Path $cap 'stub-state.json') -ErrorAction SilentlyContinue
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
foreach ($f in @(Get-ChildItem (Split-Path $blog) -Filter 'tds-bridge*.log' -ErrorAction SilentlyContinue)) { Copy-Item $f.FullName (Join-Path $out "bridge-full-$($f.Name)") -ErrorAction SilentlyContinue }
