# Mode dbbig (bridge 2.4.5, MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally; never the
# owner's computer; no bridge). Dot-sourced by flowv.ps1 after c2. The dbm forms again, on a BIG company (about 30,000
# entries, 20,000 then 50,000 ledgers), plus what 2.4.5 also needs the owner's OK for:
#   i1-i4 tally.ini: the add-on added to Tally's own load list as the 2.4.5 installer would (add only, backup, idempotent,
#         other TDLs kept), Tally started with it, the add-on and another TDL each proven loaded
#   b1 test data (ZZ BIG TEST, dbm/redate.py with DBM_PROFILE=big: 01-Jun 100, 02-Jul 300, 31-Aug 800, 31-May none, the
#      other 13 days of Apr-Oct 2026 about 2,215 each; 01-Aug is the heavy day)
#   b2 one day of the Day Book: D1 (today's plain form) and D5 (D1 + SVCURRENTDATE); does D5 move Tally's current date
#   b3 one day by the collection date forms 3, 4, 5, 7 (heads only; CMPINFO's own <VOUCHER> count not taken as an entry)
#   b4 the split by type: S2 (Voucher Register + VOUCHERTYPENAME), S3-5 (collection 5 + type), FinComVoucherObject
#   b5 the voucher count of a period (month, quarter, half-year, year): V1 heads by period (rows counted), V1 chunked by
#      2,000 MasterIDs, V2 $$NumItems of a period collection (computed: for comparison)
#   b6 the ledger count at 20,000 and 50,000 ledgers: L1, L2, L3, L3 chunked, L4 chunked; FinComLedgers chunks
#   b7 the rule: one request at a time, 2 s stop, overruns kept; Tally's window blocked time during every request
# Every measured request: TStopW (the 2 s stop, the late answer awaited, nothing else sent) and, beside it, a probe of
# Tally's window every 100 ms (SendMessageTimeout WM_NULL, 250 ms): blockedMs = the longest time the window did not answer.
. (Join-Path $PSScriptRoot 'dblib.ps1')
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DbFrz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res); }
'@
$KI1 = 'i1 tally.ini as TallyPrime installs it (captured before the harness wrote its own)'
$KI2 = 'i2 the add-on added to tally.ini (add only, backup, other TDL kept): loaded at Tally start, the other TDL too'
$KI3 = 'i3 tally.ini with User TDL = No: what Tally does with an added User TDL = Yes'
$KI4 = 'i4 idempotent and untouched by Tally: a second run changes nothing, Tally keeps the lines and their order'
$KB1 = 'b1 big company made (about 30,000 entries, 20,000 ledgers)'
$KB2 = 'b2 one day of the Day Book on the big company (D1, D5), and whether D5 moves Tally''s current date'
$KB3 = 'b3 one day by the collection date forms on the big company'
$KB4 = 'b4 a day split by voucher type on the big company'
$KB5 = 'b5 the voucher count of a period (month, quarter, half-year, year)'
$KB6 = 'b6 the ledger count at 20,000 and 50,000 ledgers'
$KB7 = 'b7 one request at a time, 2 s stop, Tally''s window blocked time kept'
$bDone = @{}
function BRes($c, $st, $ev) { if (-not $bDone[$c]) { Result $c $st $ev; $bDone[$c] = $true } }
function MLine([string]$s) { Add-Content -Path $resultsFile -Value "MEASURE $s" -Encoding UTF8 }

# ---- the window probe (a thread beside the requests)
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; beats = 0; err = '' })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null
    while (-not $f.stop) {
      if ($f.on -and $f.h -ne [IntPtr]::Zero) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [DbFrz]::SendMessageTimeout($f.h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $t0 }; $cur = $sw.Elapsed.TotalMilliseconds - $since; if ($cur -gt $f.max) { $f.max = $cur } } else { $since = $null }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
  Info "dbbig: window probe running $($script:frzOk) (beats $($script:frz.beats))"
} catch { Info "dbbig: the window probe could not start ($_): blockedMs is -1" }
function TStopW([string]$x, [int]$stopMs = 2000, [int]$maxMs = 60000) {
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.max = 0.0; $script:frz.on = $true
  try { $r = TStop $x $stopMs $maxMs } finally { Start-Sleep -Milliseconds 150; $script:frz.on = $false }
  if ($script:frz.err) { Info "dbbig: window probe error: $($script:frz.err)"; $script:frz.err = ''; $script:frzOk = $false }
  $r | Add-Member -NotePropertyName blockedMs -NotePropertyValue $(if ($script:frzOk) { [math]::Round($script:frz.max, 0) } else { -1 }) -Force
  return $r
}
$script:hungN = 0
function TS([string]$x, [int]$a = 2000, [int]$b = 60000) { $r = TStopW $x $a $b; if ($r.hung) { $script:hungN++; $null = DbRestart "hung$($script:hungN)" }; return $r }
# CMPINFO (Tally's own header of counts) carries <VOUCHER>n</VOUCHER> and <LEDGER>n</LEDGER>: never an entry or a ledger
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
function Rows([string]$b, [string]$tag) { return @([regex]::Matches((NoInfo $b), "<$tag[ >]")).Count }
# Entries (dblib) without its O(n^2) array growth: about 30,000 entries here
function Ents([string]$b) {
  $l = [Collections.Generic.List[object]]::new()
  foreach ($m in [regex]::Matches((NoInfo $b), '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $t = [regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)<').Groups[1].Value; if (-not $t) { $t = [regex]::Match($v, 'VCHTYPE="([^"]*)"').Groups[1].Value }
    $l.Add([pscustomobject]@{ date = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value; type = $t; mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value })
  }
  return , $l.ToArray()
}
function TruthV {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DBTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DBTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE, VOUCHERTYPENAME, MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  return , (Ents $r.body)
}
$rows = [Collections.Generic.List[object]]::new()
function Row([string]$what, [string]$form, [string]$day, $r, $extra) {
  if ($r.hung) { Info "dbbig: $what $form $day hung ($($r.err)): Tally restarted" }
  $l = DbLight
  $o = [pscustomobject]@{ what = $what; form = $form; day = $day; ms = $r.ms; inTime = $r.inTime; overrun = $r.overrun; hung = $r.hung; ok = $r.ok; err = $r.err; chars = $r.body.Length; blockedMs = $r.blockedMs; lightMs = $l.ms; lightOk = $l.ok; responding = $l.responding }
  if ($extra) { foreach ($k in $extra.Keys) { $o | Add-Member -NotePropertyName $k -NotePropertyValue $extra[$k] } }
  $rows.Add($o)
  Write-Host ("[dbbig] {0} {1} {2}: {3} ms{4}, blocked {5} ms, {6} chars; responding {7} {8}" -f $what, $form, $day, $r.ms, $(if ($r.overrun) { ' OVERRUN' } else { '' }), $r.blockedMs, $r.body.Length, $l.responding, $(if ($extra) { ($extra.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ' }))
  return $o
}
function Stat($list) {
  $s = @($list | Where-Object { $_ } | Sort-Object { [double]$_.ms }); if (-not $s.Count) { return 'none' }
  $b = @($list | ForEach-Object { [double]$_.blockedMs } | Sort-Object)
  return ("median {0} ms, worst {1} ms, overruns {2}/{3}, window blocked worst {4} ms, hung {5}" -f $s[[int][math]::Floor(($s.Count - 1) / 2)].ms, $s[-1].ms, @($s | Where-Object { $_.overrun }).Count, $s.Count, $b[-1], @($s | Where-Object { $_.hung }).Count)
}

# ================================================================ i1-i4: tally.ini
function IniBase { @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'Default Companies = Yes', "Load = $($folder.Name)") }
$fcAddon = 'C:\ProgramData\FinCom\addon\FinComRecorder.tdl'
$otherTdl = 'C:\fcother\FinComOtherTest.tdl'
# the 2.4.5 installer's rule, as proposed (the Go code will do exactly this): add only; never remove, change or reorder a
# line; "User TDL = Yes" added only when no User TDL line exists; the add-on's TDL line added once, right after the last
# TDL line (else at the end of the [Tally] section); backup <ini>.fincom-bak written before the first change, never
# overwritten; the file's own line ending and encoding kept. Returns what it did.
function FcIniAdd([string]$path, [string]$addon, [switch]$forceUserTdl) {
  $raw = [IO.File]::ReadAllBytes($path)
  $enc = if ($raw.Length -ge 2 -and $raw[0] -eq 0xFF -and $raw[1] -eq 0xFE) { [Text.Encoding]::Unicode } elseif ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { [Text.UTF8Encoding]::new($true) } else { [Text.UTF8Encoding]::new($false) }
  $text = $enc.GetString($raw); if ($text.Length -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
  $lines = [Collections.Generic.List[string]]::new(); foreach ($l in ($text -split "`r?`n")) { $lines.Add($l) }
  if ($lines.Count -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1); $endNl = $true } else { $endNl = $false }
  $norm = { param($p) $p.Trim().Trim('"').Replace('/', '\').ToLowerInvariant() }
  $haveAddon = $false; $lastTdl = -1; $userTdl = @(); $secEnd = $lines.Count; $inTally = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]
    if ($l -match '^\s*\[(.+)\]\s*$') { if ($inTally) { $secEnd = $i; $inTally = $false }; if ($Matches[1].Trim() -ieq 'Tally') { $inTally = $true }; continue }
    if ($l -match '^\s*TDL\s*=\s*(.*)$') { $lastTdl = $i; if ((& $norm $Matches[1]) -eq (& $norm $addon)) { $haveAddon = $true } }
    elseif ($l -match '^\s*User\s+TDL\s*=\s*(\S*)') { $userTdl += $Matches[1] }
  }
  $add = @()
  $needUser = ($userTdl.Count -eq 0) -or ($forceUserTdl -and $userTdl[-1] -inotmatch '^(yes|y)$')
  if ($needUser) { $add += 'User TDL = Yes' }
  if (-not $haveAddon) { $add += "TDL = $addon" }
  if (-not $add.Count) { return [pscustomobject]@{ changed = $false; added = @(); userTdl = ($userTdl -join ',') } }
  $at = if ($lastTdl -ge 0) { $lastTdl + 1 } else { $secEnd }
  $lines.InsertRange($at, [string[]]$add)
  $bak = "$path.fincom-bak"; if (-not (Test-Path $bak)) { [IO.File]::WriteAllBytes($bak, $raw) }
  $outText = ($lines -join $nl) + $(if ($endNl) { $nl } else { '' })
  $pre = if ($enc -is [Text.UnicodeEncoding] -or ($enc -is [Text.UTF8Encoding] -and $enc.GetPreamble().Length)) { $enc.GetPreamble() } else { @() }
  [IO.File]::WriteAllBytes($path, [byte[]]($pre + $enc.GetBytes($outText)))
  return [pscustomobject]@{ changed = $true; added = $add; userTdl = ($userTdl -join ',') }
}
# a harness-only probe: does Tally know the add-on's formula FCRFolder, and the other TDL's FCOtherMark
function FormulaProbe([string]$name) {
  $x = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCIniProbe</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCIniProbe" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCPROBE:@@' + $name + '</COMPUTE></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $r = TStop $x 2000 20000; if ($r.hung) { $null = DbRestart 'probe-hung' }
  return [regex]::Match($r.body, '<FCPROBE[^>]*>([^<]*)<').Groups[1].Value
}
function RecBytes { $s = 0L; foreach ($f in Get-ChildItem $rec -File -ErrorAction SilentlyContinue) { $s += $f.Length }; return $s }
# an import (fires the add-on's Import events: a recorder line when the add-on is loaded)
function ImportProbe([string]$tag) {
  $nm = "FC Ini Probe $tag"
  $null = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT></LEDGER></TALLYMESSAGE>') "ini probe $tag"
}
function IniCase([string]$tag, [string[]]$before, [switch]$forceUserTdl) {
  $ini = Join-Path $dir 'tally.ini'
  Remove-Item "$ini.fincom-bak" -Force -ErrorAction SilentlyContinue
  DbClose
  Set-Content -Path $ini -Value $before -Encoding ASCII
  $a1 = FcIniAdd $ini $fcAddon -forceUserTdl:$forceUserTdl
  $after = Get-Content $ini
  $h1 = (Get-FileHash $ini).Hash
  $a2 = FcIniAdd $ini $fcAddon -forceUserTdl:$forceUserTdl
  $h2 = (Get-FileHash $ini).Hash
  $bakSame = (Test-Path "$ini.fincom-bak") -and ((Get-Content "$ini.fincom-bak") -join "`n") -eq ($before -join "`n")
  # kept: every line before is still there, in the same order
  $j = 0; foreach ($l in $after) { if ($j -lt $before.Count -and $l -eq $before[$j]) { $j++ } }; $kept = ($j -eq $before.Count)
  Set-Content (Join-Path $cap "ini-$tag-before.txt") $before -Encoding ASCII; Set-Content (Join-Path $cap "ini-$tag-after.txt") $after -Encoding ASCII
  $up = DbRestart "ini-$tag"
  $b0 = RecBytes; ImportProbe $tag; Start-Sleep 3; $b1 = RecBytes
  $mine = FormulaProbe 'FCRFolder'; $oth = FormulaProbe 'FCOtherMark'
  DbClose; Start-Sleep 2
  $afterTally = Get-Content $ini; Set-Content (Join-Path $cap "ini-$tag-after-tally-closed.txt") $afterTally -Encoding ASCII
  $untouched = (($afterTally -join "`n") -eq ($after -join "`n"))
  $o = [pscustomobject]@{ tag = $tag; up = $up; added = ($a1.added -join ' | '); changed = $a1.changed; secondChanged = $a2.changed; sameHash = ($h1 -eq $h2); bakSame = $bakSame; kept = $kept
    addonLoaded = ($mine -eq 'C:\ProgramData\FinCom\recorder\'); recorderGrew = ($b1 -gt $b0); otherLoaded = ($oth -eq 'other-loaded'); untouchedByTally = $untouched; mine = $mine; other = $oth }
  Info ("dbbig ini {0}: up {1}; added [{2}]; second run changed {3}; backup = original {4}; others kept in order {5}; add-on formula '{6}' recorder grew {7}; other TDL formula '{8}'; Tally left the file as written {9}" -f $tag, $up, $o.added, $a2.changed, $bakSame, $kept, $mine, $o.recorderGrew, $oth, $untouched)
  return $o
}

try {
  Say '---- dbbig: tally.ini (the add-on loaded by Tally itself)'
  $inst = Join-Path $env:RUNNER_TEMP 'tally-ini-installed.txt'
  if (Test-Path $inst) {
    $il = Get-Content $inst; Copy-Item $inst (Join-Path $cap 'tally-ini-as-installed.txt') -Force
    BRes $KI1 'PASS' ("{0} lines: {1}" -f $il.Count, (($il | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ' / '))
  } else { BRes $KI1 'HARNESS' 'TallyPrime''s installer left no tally.ini before flow.ps1 wrote its own (or flow.ps1 did not copy it)' }
  New-Item -ItemType Directory -Force (Split-Path $fcAddon), (Split-Path $otherTdl) | Out-Null
  Copy-Item $tdl $fcAddon -Force
  Set-Content $otherTdl @('; a harmless TDL standing for a client''s own add-on (harness only)', '[System: Formula]', '    FCOtherMark : "other-loaded"') -Encoding ASCII
  $harnessIni = Get-Content (Join-Path $dir 'tally.ini')
  $cA = IniCase 'A-other-tdl' ((IniBase) + @('User TDL = Yes', "TDL = $otherTdl"))
  $cB = IniCase 'B-no-tdl-lines' (IniBase)
  $cC = IniCase 'C-usertdl-no' ((IniBase) + @('User TDL = No', "TDL = $otherTdl")) -forceUserTdl
  $cD = IniCase 'D-already-there' ((IniBase) + @('User TDL = Yes', "TDL = $otherTdl", "TDL = $fcAddon"))
  $okA = $cA.up -and $cA.addonLoaded -and $cA.otherLoaded -and $cA.kept -and $cA.bakSame
  $okB = $cB.up -and $cB.addonLoaded -and $cB.kept
  BRes $KI2 $(if ($okA -and $okB) { 'PASS' } elseif (-not ($cA.up -and $cB.up)) { 'HARNESS' } else { 'FAIL' }) ("A (User TDL = Yes and another TDL): added [{0}], add-on loaded {1} (recorder line on an import {2}), other TDL loaded {3}, others kept in order {4}, backup = original {5}; B (no TDL lines): added [{6}], add-on loaded {7} (recorder line {8})" -f $cA.added, $cA.addonLoaded, $cA.recorderGrew, $cA.otherLoaded, $cA.kept, $cA.bakSame, $cB.added, $cB.addonLoaded, $cB.recorderGrew)
  BRes $KI3 $(if ($cC.up) { 'PASS' } else { 'HARNESS' }) ("User TDL = No then an added User TDL = Yes: add-on loaded {0}, the client's other TDL loaded {1} (Tally takes {2})" -f $cC.addonLoaded, $cC.otherLoaded, $(if ($cC.addonLoaded) { 'the last User TDL line' } else { 'the first User TDL line' }))
  $okD = (-not $cA.secondChanged) -and $cA.sameHash -and (-not $cD.changed) -and $cA.untouchedByTally -and $cB.untouchedByTally -and $cD.addonLoaded
  BRes $KI4 $(if ($okD) { 'PASS' } elseif (-not $cD.up) { 'HARNESS' } else { 'FAIL' }) ("second run changed nothing: A {0} (same bytes {1}), D (already there) changed {2}; Tally left the file as written after start and close: A {3}, B {4}, C {5}, D {6}" -f (-not $cA.secondChanged), $cA.sameHash, $cD.changed, $cA.untouchedByTally, $cB.untouchedByTally, $cC.untouchedByTally, $cD.untouchedByTally)
  DbClose; Set-Content -Path (Join-Path $dir 'tally.ini') -Value $harnessIni -Encoding ASCII
  if (-not (DbRestart 'measure')) { throw 'Tally did not come back with the harness tally.ini' }

  # ================================================================ b1: the big company
  Say '---- dbbig: test data (about 30,000 entries)'
  $made = DbMakeData
  $nLed = DbLedgersTo 20000
  $tv = @(TruthV | Where-Object { $_.date })
  $DAYS = @('20260601', '20260702', '20260831', '20260801', '20260531')
  $truth = @{}; foreach ($d in $DAYS) { $truth[$d] = @($tv | Where-Object { $_.date -eq $d }) }
  $tByType = { param($d) $h = [ordered]@{}; foreach ($g in ($truth[$d] | Group-Object type | Sort-Object Name)) { $h[$g.Name] = $g.Count }; $h }
  $ev = ($DAYS | ForEach-Object { "$_=$($truth[$_].Count)" }) -join ', '
  Info "dbbig: $made; ledgers $nLed; entries in Tally $($tv.Count); per test day $ev"
  BRes $KB1 $(if ($tv.Count -ge 25000 -and $nLed -ge 19000 -and $truth['20260831'].Count -ge 600) { 'PASS' } else { 'HARNESS' }) "$made; ledgers $nLed; entries in Tally $($tv.Count); per test day (Tally's own list): $ev"

  # ================================================================ b2: one day of the Day Book
  Say '---- dbbig: the Day Book for one day'
  foreach ($d in $DAYS) {
    foreach ($f in 'D1', 'D5') {
      $n = if ($f -eq 'D5') { 3 } else { 1 }
      for ($i = 1; $i -le $n; $i++) {
        $r = TS (DayReq $f $d) 2000 240000
        $e = Ents $r.body; $on = @($e | Where-Object { $_.date -eq $d }).Count
        $null = Row 'daybook' $f $d $r @{ got = $e.Count; onDay = $on; want = $truth[$d].Count; applied = ($r.ok -and $on -eq $e.Count -and $e.Count -eq $truth[$d].Count); dates = ((@($e | ForEach-Object { $_.date } | Sort-Object -Unique) | Select-Object -First 3) -join '/') }
      }
    }
  }
  # does D5 move Tally's current date? D5 for 31-Aug, then D1 (no current date) for 01-Jun: which day comes back
  $null = TS (DayReq 'D5' '20260831') 2000 240000
  $r = TS (DayReq 'D1' '20260601') 2000 240000; $e = Ents $r.body; $ds = @($e | ForEach-Object { $_.date } | Sort-Object -Unique)
  $moved = ($ds.Count -eq 1 -and $ds[0] -eq '20260831')
  $null = Row 'sticky' 'D1-after-D5' '20260601' $r @{ got = $e.Count; dates = ($ds -join '/'); moved = $moved }
  foreach ($f in 'D1', 'D5') {
    $fr = @($rows | Where-Object { $_.what -eq 'daybook' -and $_.form -eq $f })
    MLine ("big daybook {0}: applied on every day {1}; {2}" -f $f, (@($fr | Where-Object { -not $_.applied }).Count -eq 0), (($DAYS | ForEach-Object { $dd = $_; $x = @($fr | Where-Object { $_.day -eq $dd }); "$dd got $($x[0].got)/$($x[0].want) on-day $($x[0].onDay): $(Stat $x)" }) -join '; '))
  }
  MLine ("big daybook D5 moves Tally's current date: {0} (D1 for 01-Jun after D5 for 31-Aug gave {1} entries dated {2})" -f $moved, $e.Count, ($ds -join '/'))
  $d5 = @($rows | Where-Object { $_.what -eq 'daybook' -and $_.form -eq 'D5' })
  BRes $KB2 'PASS' ("D5 applied every day {0}; D5 {1}; D5 moves the current date {2}" -f (@($d5 | Where-Object { -not $_.applied }).Count -eq 0), (Stat $d5), $moved)

  # ================================================================ b3: collection date forms
  Say '---- dbbig: the collection date forms for one day'
  $cOk = @{}
  foreach ($n in 3, 4, 5, 7) {
    $cOk["C$n"] = $true
    foreach ($d in $DAYS) {
      for ($i = 1; $i -le 3; $i++) {
        $r = TS (WithDay $script:RQ["datesprobe-$n"] $d) 2000 120000
        $e = Ents $r.body; $on = @($e | Where-Object { $_.date -eq $d }).Count
        $ap = $r.ok -and ($on -eq $e.Count) -and ($e.Count -eq $truth[$d].Count); if (-not $ap) { $cOk["C$n"] = $false }
        $null = Row 'collection' "C$n" $d $r @{ got = $e.Count; onDay = $on; want = $truth[$d].Count; applied = $ap }
      }
    }
    $fr = @($rows | Where-Object { $_.what -eq 'collection' -and $_.form -eq "C$n" })
    MLine ("big collection C{0}: applied on every day {1}; {2}" -f $n, $cOk["C$n"], (($DAYS | ForEach-Object { $dd = $_; $x = @($fr | Where-Object { $_.day -eq $dd }); "$dd $($x[0].got)/$($x[0].want): $(Stat $x)" }) -join '; '))
  }
  BRes $KB3 $(if (@($cOk.Values | Where-Object { $_ }).Count) { 'PASS' } else { 'FAIL' }) ("exact on every day: {0}" -f ((@($cOk.Keys | Where-Object { $cOk[$_] } | Sort-Object)) -join ', '))

  # ================================================================ b4: split by type
  Say '---- dbbig: a day split by voucher type'
  $sOk = @{}
  foreach ($key in 'S2-D1', 'S3-5') {
    $sOk[$key] = $true
    foreach ($d in '20260831', '20260801') {
      $tt = & $tByType $d
      foreach ($type in $tt.Keys) {
        for ($i = 1; $i -le 2; $i++) {
          $r = if ($key -eq 'S2-D1') { TS (SplitReq 'S2' 'D1' $d $type) 2000 120000 } else { TS (SplitReq 'S3' '5' $d $type) 2000 120000 }
          $e = Ents $r.body; $mine = @($e | Where-Object { $_.date -eq $d -and ($_.type -eq $type -or -not $_.type) }).Count
          $ex = $r.ok -and $e.Count -eq $tt[$type] -and $mine -eq $e.Count; if (-not $ex -or -not $r.inTime) { $sOk[$key] = $false }
          $null = Row 'split' $key "$d $type" $r @{ got = $e.Count; want = $tt[$type]; exact = $ex }
        }
      }
      $fr = @($rows | Where-Object { $_.what -eq 'split' -and $_.form -eq $key -and $_.day -like "$d *" })
      MLine ("big split {0} on {1} ({2} entries): {3}; per type {4}" -f $key, $d, $truth[$d].Count, (Stat $fr), (($fr | Group-Object day | ForEach-Object { $w = @($_.Group | Sort-Object { [double]$_.ms })[-1]; "$($_.Name.Split(' ')[1]) $($w.got)/$($w.want) worst $($w.ms) ms" }) -join ', '))
    }
  }
  $mids = @($truth['20260831'] | ForEach-Object { $_.mid } | Where-Object { $_ } | Select-Object -First 100)
  foreach ($mid in $mids) { $r = TS ($script:RQ['entry-object'].Replace('@@CO@@', (LE $co1)).Replace('ID:99999<', "ID:$mid<")) 2000 60000; $rows.Add([pscustomobject]@{ what = 'object'; form = 'FinComVoucherObject'; day = '20260831'; ms = $r.ms; inTime = $r.inTime; overrun = $r.overrun; hung = $r.hung; ok = ($r.ok -and $r.body -match '<VOUCHER'); err = $r.err; chars = $r.body.Length; blockedMs = $r.blockedMs; lightMs = 0; lightOk = $true; responding = $true }) }
  MLine ("big object FinComVoucherObject, 100 entries of 31-Aug at about 30,000 entries: {0}" -f (Stat @($rows | Where-Object { $_.what -eq 'object' })))
  BRes $KB4 $(if (@($sOk.Values | Where-Object { $_ }).Count) { 'PASS' } else { 'FAIL' }) ("exact and under 2 s for every type on 31-Aug and the heavy 01-Aug: {0}" -f $(if (@($sOk.Keys | Where-Object { $sOk[$_] }).Count) { (@($sOk.Keys | Where-Object { $sOk[$_] } | Sort-Object)) -join ', ' } else { 'NONE' }))

  # ================================================================ b5: the voucher count of a period
  Say '---- dbbig: the voucher count of a period'
  $PER = [ordered]@{ month = @('20260401', '20260430'); quarter = @('20260401', '20260630'); half = @('20260401', '20260930'); year = @('20260401', '20270331') }
  $maxMid = [int64](@($tv | ForEach-Object { [int64]('0' + $_.mid) } | Sort-Object)[-1])
  $vCount = @{}
  function VReq([string]$a, [string]$u, [string]$flt) {
    $f = if ($flt) { '<FILTERS>FinComVoucherIdsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComVoucherIdsOnly">' + $flt + '</SYSTEM>' } else { '</COLLECTION>' }
    return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComVoucherIds</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">' + $a + '</SVFROMDATE><SVTODATE TYPE="Date">' + $u + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComVoucherIds" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>MASTERID</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  }
  function V2Req([string]$a, [string]$u) {
    return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComVoucherCount</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">' + $a + '</SVFROMDATE><SVTODATE TYPE="Date">' + $u + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComVoucherCount" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCVCOUNT:$$NumItems:FinComVchPeriod</COMPUTE><FILTERS>FinComVoucherCountOnly</FILTERS></COLLECTION><COLLECTION NAME="FinComVchPeriod" ISMODIFY="No"><TYPE>Voucher</TYPE></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComVoucherCountOnly">$Name = &#34;' + (LE $co1) + '&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  }
  foreach ($p in $PER.Keys) {
    $a, $u = $PER[$p]
    $want = @($tv | Where-Object { $_.date -ge $a -and $_.date -le $u }).Count
    $wantT = (($tv | Where-Object { $_.date -ge $a -and $_.date -le $u } | Group-Object type | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', ')
    for ($i = 1; $i -le 3; $i++) {
      $r = TS (VReq $a $u '') 2000 180000
      $e = Ents $r.body; $byT = (($e | Group-Object type | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', ')
      if ($i -eq 1 -and $p -eq 'month') { DbSave "vcount-V1-$p.xml" $r.body }
      $null = Row 'vcount' 'V1' $p $r @{ got = $e.Count; want = $want; exact = ($e.Count -eq $want -and $byT -eq $wantT); byType = $byT }
    }
    for ($i = 1; $i -le 2; $i++) {
      $n = 0; $lo = 0L; $parts = 0; $tot = 0.0; $over = $false; $blk = 0; $worst = 0.0; $hung = $false
      while ($lo -lt $maxMid) {
        $r = TS (VReq $a $u ('$MasterID &gt; ' + $lo + ' AND $MasterID &lt;= ' + ($lo + 2000))) 2000 120000
        $parts++; $tot += $r.ms; if ($r.ms -gt $worst) { $worst = $r.ms }; if ($r.overrun) { $over = $true }; if ($r.hung) { $hung = $true }; if ($r.blockedMs -gt $blk) { $blk = $r.blockedMs }
        $n += (Ents $r.body).Count; $lo += 2000
      }
      $rr = [pscustomobject]@{ ms = [math]::Round($worst, 1); inTime = -not $over; overrun = $over; hung = $hung; ok = $true; err = ''; body = ''; blockedMs = $blk }
      $null = Row 'vcount' 'V1 chunked' $p $rr @{ got = $n; want = $want; exact = ($n -eq $want); requests = $parts; totalMs = [math]::Round($tot) }
    }
    for ($i = 1; $i -le 3; $i++) {
      $r = TS (V2Req $a $u) 2000 180000
      $v = [regex]::Match($r.body, '<FCVCOUNT[^>]*>\s*(\d+)'); $n = if ($v.Success) { [int64]$v.Groups[1].Value } else { -1 }
      if ($i -eq 1 -and $p -eq 'month') { DbSave "vcount-V2-$p.xml" $r.body }
      $null = Row 'vcount' 'V2' $p $r @{ got = $n; want = $want; exact = ($n -eq $want) }
    }
    foreach ($f in 'V1', 'V1 chunked', 'V2') {
      $x = @($rows | Where-Object { $_.what -eq 'vcount' -and $_.form -eq $f -and $_.day -eq $p })
      $extra = if ($f -eq 'V1 chunked') { "; $($x[0].requests) requests of at most 2,000 MasterIDs, all of them $($x[0].totalMs) ms" } else { '' }
      MLine ("vcount {0} {1} ({2} to {3}, Tally holds {4}; by type {5}): exact every time {6} (got {7}); {8}{9}" -f $f, $p, $a, $u, $want, $wantT, (@($x | Where-Object { -not $_.exact }).Count -eq 0), (($x | ForEach-Object { $_.got } | Sort-Object -Unique) -join '/'), (Stat $x), $extra)
    }
  }
  $vr = @($rows | Where-Object { $_.what -eq 'vcount' })
  BRes $KB5 'PASS' (($PER.Keys | ForEach-Object { $pp = $_; ($('V1', 'V1 chunked', 'V2') | ForEach-Object { $ff = $_; $x = @($vr | Where-Object { $_.form -eq $ff -and $_.day -eq $pp }); "$pp $ff exact $(@($x | Where-Object { -not $_.exact }).Count -eq 0) worst $((@($x | Sort-Object { [double]$_.ms }))[-1].ms) ms" }) -join ', ' }) -join '; ')

  # ================================================================ b6: the ledger count
  Say '---- dbbig: the ledger count'
  $l6 = @()
  foreach ($size in 20000, 50000) {
    $want = DbLedgersTo $size
    $am = AltMst
    foreach ($f in 'L1', 'L2', 'L3', 'L3 chunked', 'L4 chunked') {
      for ($i = 1; $i -le 3; $i++) {
        $n = -1; $r = $null; $parts = 1; $worst = 0.0; $tot = 0.0; $over = $false; $blk = 0; $hung = $false
        switch ($f) {
          'L1' { $r = TS (LedCountReq 'L1') 2000 120000; $n = [int64]('0' + [regex]::Match($r.body, '<RESULT[^>]*>\s*(\d+)').Groups[1].Value) }
          'L2' { $r = TS (LedCountReq 'L2') 2000 120000; $v = [regex]::Match($r.body, '<FCLEDGERCOUNT[^>]*>\s*(\d+)'); $n = if ($v.Success) { [int64]$v.Groups[1].Value } else { -1 } }
          'L3' { $r = TS (WithRange $script:RQ['ledids-tail'] 0 0) 2000 120000; $n = Rows $r.body 'LEDGER' }
          default {
            $tpl = if ($f -like 'L3*') { 'ledids' } else { 'names' }; $n = 0; $a = 0L; $parts = 0
            while ($true) {
              $tail = ($a -ge $am.v); $r = TS $(if ($tail) { WithRange $script:RQ["$tpl-tail"] $a 0 } else { WithRange $script:RQ["$tpl-chunk"] $a ($a + 2000) }) 2000 120000
              $parts++; $tot += $r.ms; if ($r.ms -gt $worst) { $worst = $r.ms }; if ($r.overrun) { $over = $true }; if ($r.hung) { $hung = $true }; if ($r.blockedMs -gt $blk) { $blk = $r.blockedMs }
              $n += Rows $r.body 'LEDGER'; if ($tail -or -not $r.ok) { break }; $a += 2000
            }
          }
        }
        $rr = if ($parts -gt 1 -or $f -like '*chunked') { [pscustomobject]@{ ms = [math]::Round($worst, 1); inTime = -not $over; overrun = $over; hung = $hung; ok = $true; err = ''; body = ''; blockedMs = $blk } } else { $r }
        $null = Row 'ledcount' $f "$size" $rr @{ got = $n; want = $want; exact = ($n -eq $want); requests = $parts; totalMs = [math]::Round($(if ($tot) { $tot } else { $r.ms })) }
      }
      $x = @($rows | Where-Object { $_.what -eq 'ledcount' -and $_.form -eq $f -and $_.day -eq "$size" })
      $ex = @($x | Where-Object { -not $_.exact }).Count -eq 0
      MLine ("big ledcount {0} at {1} ledgers: exact every time {2} (got {3}); {4}; requests {5}, all of them {6} ms" -f $f, $want, $ex, (($x | ForEach-Object { $_.got } | Sort-Object -Unique) -join '/'), (Stat $x), $x[0].requests, $x[0].totalMs)
      if ($ex -and @($x | Where-Object { $_.overrun }).Count -eq 0) { $l6 += "$f@$size" }
    }
    $a = 0L; $read = 0
    while ($true) {
      $tail = ($a -ge $am.v); $r = TS $(if ($tail) { WithRange $script:RQ['ledlist-tail'] $a 0 } else { WithRange $script:RQ['ledlist-chunk'] $a ($a + 2000) }) 2000 120000
      $c = Rows $r.body 'LEDGER'; $read += $c
      $null = Row 'ledread' 'FinComLedgers' "$size" $r @{ rows = $c; soFar = $read; want = $want }
      if ($tail -or -not $r.ok) { break }; $a += 2000
    }
    $lr = @($rows | Where-Object { $_.what -eq 'ledread' -and $_.day -eq "$size" })
    MLine ("big ledread FinComLedgers at {0} ledgers: {1} chunk(s), rows read {2}; {3}; all of them {4} ms" -f $want, $lr.Count, $read, (Stat $lr), [math]::Round(($lr | Measure-Object ms -Sum).Sum))
  }
  BRes $KB6 $(if ($l6.Count) { 'PASS' } else { 'FAIL' }) ("exact and under 2 s: {0}" -f $(if ($l6.Count) { $l6 -join ', ' } else { 'NONE' }))

  $rows | Export-Csv (Join-Path $out 'dbbig-times.csv') -NoTypeInformation
  $over = @($rows | Where-Object { $_.overrun }); $nr = @($rows | Where-Object { -not $_.responding }); $hg = @($rows | Where-Object { $_.hung }); $bl = @($rows | Where-Object { [double]$_.blockedMs -ge 2000 })
  BRes $KB7 $(if ($script:dbMaxInFlight -le 1 -and $hg.Count -eq 0 -and $nr.Count -eq 0) { 'PASS' } else { 'FAIL' }) ("{0} requests, at most {1} at Tally; {2} overran 2 s; {3} hung; window blocked 2 s or more during {4} ({5}); Tally not responding after {6}" -f $script:dbSent, $script:dbMaxInFlight, $over.Count, $hg.Count, $bl.Count, ((($bl | Group-Object { "$($_.what) $($_.form)" } | ForEach-Object { "$($_.Name) x$($_.Count)" })) -join ', '), $nr.Count)
} catch {
  Write-Host "dbbig stopped: $_ $($_.ScriptStackTrace)"
  try { $rows | Export-Csv (Join-Path $out 'dbbig-times.csv') -NoTypeInformation } catch {}
  foreach ($c in $KI1, $KI2, $KI3, $KI4, $KB1, $KB2, $KB3, $KB4, $KB5, $KB6, $KB7) { BRes $c 'HARNESS' "the harness stopped: $_" }
} finally {
  $script:frz.stop = $true
}
