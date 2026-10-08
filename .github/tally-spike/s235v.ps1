# Mode s235 (FinCom Bridge 2.3.5: branches next-heldfix, next-notify, release-235; the bridge built from the ref's source).
# Dot-sourced by flowv.ps1 after the bridge's setup, with stub235.py as FinCom's cloud (its heartbeat answer carries
# FinCom's read stop) and proxy235.py between the bridge and Tally (TallyHost 127.0.0.2: every request the bridge sends
# Tally is logged in proxy.jsonl). Receipts are made, altered and deleted on Tally's own screens (keys, each screen read
# by OCR, every step 30 s at most, a fresh Tally when the Gateway cannot be reached). Checks:
#   s1 stop: FinCom's stop set by the beat answer; a receipt created, another altered, a third deleted on the screen:
#      the stub has the 3 lines within 10 s of each save, each held with "reading from Tally is stopped from FinCom",
#      no voucher request reached Tally (proxy log), no try counted (the held list: tries, freshTries, asked 0)
#   s2 lift: the created and altered lines resolved with their bodies (Tally's GUIDs), the delete sent WITH its GUID and
#      proven deleted in Tally (asked by MasterID: no voucher), exactly one ":resolved" per line, no Day Book words
#   s3 restart: stop, a delete on the screen, the bridge restarted (the tray's Restart), lift: the delete still sent with
#      its GUID (the held list kept keepGuid over the restart)
#   s4 a real failure still counts: the stop lifted, a receipt saved and Tally suspended by the proxy on the bridge's
#      first voucher request for it (Tally takes the request and does not answer for 20 s): the line is not held with the
#      stop's words, and the try is counted (the held list's tries / the 2.3.4 rule: ended with the Day Book words or one
#      more ask)
#   s5 Tally not open: Tally closed 3+ minutes (office hours): one "Tally not open" notification (the log's "Notification
#      shown", notifications-cleared.json); opened and closed again the same day: no second one
# A step the harness could not do (keys that made no entry, no stop seen, no tray) is HARNESS, never PASS.
Say '---- s235: FinCom''s read stop and the held lines, a real failure, the Tally-not-open notification'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$script:freshTally = 0
$S1, $S2, $S3, $S4, $S5 = $s235Checks
$stopWords = 'reading from Tally is stopped from FinCom'
$vchRe = 'FinComVoucher|ByMaster|VchHeads|ByNumber'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class S235Nt { [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h); }
'@
function ResumeTally { $h = [S235Nt]::OpenProcess(0x0800, $false, [int]$script:tpid); if ($h -ne [IntPtr]::Zero) { $r = [S235Nt]::NtResumeProcess($h); [S235Nt]::CloseHandle($h) | Out-Null; Write-Host "resume Tally (pid $($script:tpid)): $r" } }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Ms0([datetime]$t) { ([DateTimeOffset]$t).ToUnixTimeMilliseconds() }
function Cut([string]$s, [int]$n = 300) { if ($s.Length -gt $n) { $s.Substring(0, $n) + '...' } else { $s } }

# ---- Tally: a fresh one (the Gateway not reached, or check s5), the proxy beside it
function S235StartTally([string]$tag) {
  Stop-S235Proxy
  if ($script:tpid) { ResumeTally; Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  $up = $false
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; $up = $true; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 "s235-$tag-started"
  $ok = Start-S235Proxy
  Say "Tally started again ($tag): pid $($script:tpid), port up $up, proxy $ok"
  return ($up -and $ok)
}
$script:TdsRestart = { $script:freshTally++; $null = S235StartTally "fresh$($script:freshTally)" }
function S235StopTally { Stop-S235Proxy; if ($script:tpid) { ResumeTally; Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Start-Sleep 2 }

# ---- what Tally has (the harness asks Tally directly on 127.0.0.1, never through the proxy)
$tgx = { param($x, $t) [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", "<$t(?:\s[^>]*)?>([^<]*)</$t>").Groups[1].Value).Trim() }
function VList {
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>S235V</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="S235V" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 30
  if ("$x" -notmatch '<ENVELOPE') { return , $null }
  $o = @(foreach ($m in [regex]::Matches("$x", '(?s)<VOUCHER[ >].*?</VOUCHER>')) { $v = $m.Value
      [pscustomobject]@{ guid = (& $tgx $v 'GUID'); mid = (& $tgx $v 'MASTERID'); aid = [int64]('0' + (& $tgx $v 'ALTERID')); day = (& $tgx $v 'DATE'); type = (& $tgx $v 'VOUCHERTYPENAME'); vno = (& $tgx $v 'VOUCHERNUMBER') } })
  return , $o
}
function ByMid($list, [string]$mid) { foreach ($v in $list) { if ("$($v.mid)" -eq $mid) { return $v } }; return $null }
function NewOnes($before, $after) { $bm = @{}; foreach ($v in $before) { $bm["$($v.mid)"] = 1 }; $n = @(foreach ($v in $after) { if (-not $bm.ContainsKey("$($v.mid)")) { $v } }); return , $n }
function VDesc($v) { if (-not $v) { return '(none)' }; "$($v.type) no $($v.vno) of $($v.day) mid $($v.mid) AlterID $($v.aid) guid $($v.guid)" }
# a voucher still in Tally by its MasterID (the request built only through TdsMid)
function InTally([string]$mid) {
  $x = TdsExport 'Voucher' 'GUID, MASTERID' ('$MasterID = ' + (TdsMid $mid))
  if ("$x" -notmatch '<ENVELOPE') { return $null }
  return ("$x" -match '<VOUCHER[ >]')
}

# ---- the stub cloud: its lines (with the time each reached it), its control
function S235Lines {
  $r = @(StubReqs); $o = @()
  for ($i = 0; $i -lt $r.Count; $i++) {
    $q = $r[$i]; if ($q.kind -ne 'recorder_lines') { continue }
    foreach ($x in @($q.body.lines)) { if ($x) { $id = "$($x.line_id)"
      $o += [pscustomobject]@{ i = $i; ms = [int64]$q.ms; at = $q.at; id = $id; ev = "$($x.event)"; guid = "$($x.object_guid)"; mid = "$($x.master_id)"; aid = "$($x.alter_id)"; xml = "$($x.xml)"; held = "$($x.heldWhy)"; gh = [bool]$x.guidHeld; vch = "$($x.vch_type)/$($x.vch_no)/$($x.vch_date)"; res = $id.EndsWith(':resolved'); raw = $x } } }
  }
  return , $o
}
function LDesc($x) { if (-not $x) { return '(no line)' }; "[{0} {1} id={2} mid={3} aid={4} guid={5} body={6} guidHeld={7} held='{8}']" -f $x.at, $x.ev, $x.id, $x.mid, $x.aid, $(if ($x.guid) { $x.guid } else { "''" }), $(if ($x.xml) { "yes($($x.xml.Length) chars)" } else { 'none' }), $x.gh, (Cut $x.held 220) }
function StubCtl($stop) {
  $b = @{ kind = '_ctl'; readStop = $stop } | ConvertTo-Json -Depth 5 -Compress
  try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/' -Method Post -Body $b -ContentType 'application/json' -TimeoutSec 10 | Out-Null; return $true } catch { Write-Host "stub ctl: $_"; return $false }
}

# ---- the bridge's log, its held list
function LogLines { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }
function LogFrom([int]$n) { $l = LogLines; return , @($l | Select-Object -Skip $n) }
function WaitLog([int]$from, [string]$re, [int]$sec) {
  $until = (Get-Date).AddSeconds($sec)
  do { $l = LogFrom $from; foreach ($x in $l) { if ($x -match $re) { return $x } }; Start-Sleep 1 } while ((Get-Date) -lt $until)
  return ''
}
function KeyLog([int]$from, [string]$re, [int]$max = 8) { $l = LogFrom $from; $m = @($l | Where-Object { $_ -match $re } | Select-Object -Last $max | ForEach-Object { Cut $_ 260 }); if ($m.Count) { $m -join ' | ' } else { '(none)' } }
$script:heldPath = ''
function HeldFile {
  if ($script:heldPath -and (Test-Path $script:heldPath)) { return $script:heldPath }
  $f = @(Get-ChildItem -Path $h1, (Join-Path $env:LOCALAPPDATA 'FinCom Bridge') -Recurse -Filter 'recorder-held.json' -File -ErrorAction SilentlyContinue)
  if ($f.Count) { $script:heldPath = $f[0].FullName; Info "s235: the bridge's held list: $($script:heldPath)" }
  return $script:heldPath
}
function HeldItems { $f = HeldFile; if (-not $f) { return @{} }; try { $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable; if ($j.items) { return $j.items } } catch { Write-Host "held list unreadable: $_" }; return @{} }
function HDesc($h) { if (-not $h) { return '(not in the held list)' }; "tries={0} freshTries={1} asked={2} allow={3} fresh={4} slow={5} freshSlow={6} final={7} keepGuid={8} why='{9}'" -f $h.tries, $h.freshTries, $h.asked, $h.allow, $h.fresh, $h.slow, $h.freshSlow, $h.final, $h.keepGuid, (Cut "$($h.why)" 160) }

# ---- the proxy's log: the bridge's requests to Tally
function ProxyAll { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }) }; return , @() }
function ProxyIn([int64]$from, [int64]$to) { $a = ProxyAll; return , @(foreach ($p in $a) { if ($p.t0 -and [int64]$p.t0 -ge $from -and [int64]$p.t0 -le $to) { $p } }) }
function ProxyIds($ps) { $g = @($ps | Group-Object { "$($_.id)" } | ForEach-Object { "$($_.Name) x$($_.Count)" }); if ($g.Count) { $g -join ', ' } else { 'none' } }

# ---- the stop and the lift, by the stub's beat answer (the bridge's log and its tray status say it was taken)
function SetStop([string]$tag) {
  $n = (LogLines).Count
  $ok = StubCtl @{ by = 'fincom'; reason = "Stopped by the owner from FinCom (harness $tag)"; at = (Get-Date -Format s) }
  $l = WaitLog $n 'Reading from Tally stopped on this computer from FinCom' 30
  $ts = Bridge GET '/tray/status'
  Info "s235 $tag stop: stub $ok; bridge log: '$(Cut $l 200)'; tray status readStopped: $($ts.readStopped | ConvertTo-Json -Compress)"
  return [bool]$l
}
function Lift([string]$tag) {
  $n = (LogLines).Count
  $was = Bridge GET '/tray/status' $null 10
  $ok = StubCtl $null
  if ($was -and $null -eq $was.readStopped) { return $true }   # not stopped: nothing to wait for
  $l = WaitLog $n 'Reading from Tally resumed from FinCom' 30
  Info "s235 $tag lift: stub $ok; bridge log: '$(Cut $l 200)'"
  return [bool]$l
}

# ---- Tally's screens (tdslib's TK: keys, a screenshot read by OCR, 10 s at most a step)
function S235DayBook([string]$date, [string]$tag) {
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Day Book' 1.5; $null = TK '{ENTER}' 3 "$tag-daybook" 'Day Book'
  $null = TK '{F2}' 1.5 "$tag-db-date"; $null = TK ((SK $date) + '{ENTER}') 3 "$tag-db-dated"
  $null = TK '{HOME}' 1.5 "$tag-db-first"
}
# a Receipt (Cash, Spike Income, the amount) on the date, saved with Ctrl+A (flowv.ps1 c4a's keys); the time of the save
function ScreenCreate([string]$date, [string]$amt, [string]$tag) {
  $null = TdsGateway "before $tag"
  $null = TK 'v' 2.5 "$tag-vouchers" 'Voucher|Accounting'
  $null = TK '{F6}' 2.5 "$tag-receipt" 'Receipt'
  $null = TK '{F2}' 1.5 "$tag-datebox"
  $null = TK ((SK $date) + '{ENTER}') 2 "$tag-dated"
  $null = TK 'Cash{ENTER}' 2 "$tag-account"
  $null = TK 'Spike Income{ENTER}' 2 "$tag-particular"
  $null = TK ((SK $amt) + '{ENTER}') 2 "$tag-amount"
  & $script:TdsSend '^a'; return (Get-Date)
}
# the only entry of that date opened from the Day Book, its amount changed (flowv.ps1 c4b's keys), saved
function ScreenAlter([string]$date, [string]$amt, [string]$tag) {
  S235DayBook $date $tag
  $null = TK '{ENTER}' 3 "$tag-open" 'Alteration|Receipt'
  $null = TK '{ENTER}' 2; $null = TK '{ENTER}' 2; $null = TK '{ENTER}' 2 "$tag-at-amount"
  $null = TK ((SK $amt) + '{ENTER}') 2 "$tag-amount"
  & $script:TdsSend '^a'; return (Get-Date)
}
# the only entry of that date deleted from the Day Book (Alt+D, y: flowv.ps1 c4d's keys)
function ScreenDelete([string]$date, [string]$tag) {
  S235DayBook $date $tag
  $null = TK '%d' 2.5 "$tag-delete-q"
  & $script:TdsSend 'y'; return (Get-Date)
}
# after a save: Tally's change ($did over Tally's list) and the stub's line ($pred over a line and Tally's change), each
# polled until both are seen or $sec from the save; a Tally "Accept? Yes or No" is answered once
function S235Wait([scriptblock]$did, [scriptblock]$pred, [int64]$fromMs, [datetime]$t0, [int]$sec, [string]$tag) {
  $r = [pscustomobject]@{ did = $null; line = $null; sec = -1 }
  $t0ms = Ms0 $t0; $until = $t0.AddSeconds($sec); $asked = $false
  while ($true) {
    if (-not $r.did) { $vs = VList; if ($null -ne $vs) { $d = & $did $vs; if ($d) { $r.did = $d } } }
    if ($r.did -and -not $r.line) { $ls = S235Lines; foreach ($l in $ls) { if ($l.ms -ge $fromMs -and (& $pred $l $r.did)) { $r.line = $l; $r.sec = [math]::Round(($l.ms - $t0ms) / 1000.0, 1); break } } }
    if ($r.did -and $r.line) { break }
    if ((Get-Date) -gt $until) { break }
    if (-not $r.did -and -not $asked -and ((Get-Date) - $t0).TotalSeconds -gt 4) { $asked = $true; $t = TdsScreen "$tag-saved"; if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y' } }
    Start-Sleep -Milliseconds 600
  }
  Write-Host "[s235 $tag] Tally: $(if ($r.did -is [bool]) { $r.did } else { VDesc $r.did }); line after $($r.sec) s: $(LDesc $r.line)"
  return $r
}
$isCreated = { param($l, $d) $l.ev -eq 'created' -and -not $l.res -and $l.mid -eq "$($d.mid)" }
$isAltered = { param($l, $d) $l.ev -eq 'altered' -and -not $l.res -and $l.mid -eq "$($script:altMid)" }
$isDeleted = { param($l, $d) $l.ev -eq 'deleted' -and -not $l.res -and $l.mid -eq "$($script:delMid)" }

# ---- the lines of one entry after the lift: its ":resolved" lines, Day Book words
function Settled($line, [string]$wantGuid, [bool]$wantBody) {
  $ls = S235Lines
  $res = @($ls | Where-Object { $_.id -eq "$($line.id):resolved" })
  $all = @($ls | Where-Object { $_.id -eq $line.id -or $_.id -eq "$($line.id):resolved" })
  $r0 = if ($res.Count) { $res[0] } else { $null }
  $ok = $res.Count -eq 1 -and $r0.guid -eq $wantGuid -and -not $r0.held -and -not $r0.gh -and ((-not $wantBody) -or [bool]$r0.xml)
  [pscustomobject]@{ n = $res.Count; first = $r0; ok = $ok; dayBook = @($all | Where-Object { $_.held -match 'Day Book' }).Count }
}
function WaitSettled($items, [int]$sec) {
  $until = (Get-Date).AddSeconds($sec); $t0 = Get-Date
  do {
    $s = @(foreach ($it in $items) { Settled $it.line $it.guid $it.body })
    if (@($s | Where-Object { $_.n -ge 1 }).Count -eq $s.Count) { break }
    Start-Sleep 5
  } while ((Get-Date) -lt $until)
  Start-Sleep 8   # a second ":resolved" of any of them would come right after the first
  $s = @(foreach ($it in $items) { Settled $it.line $it.guid $it.body })
  Write-Host "[s235] settled after $([math]::Round(((Get-Date) - $t0).TotalSeconds)) s"
  return , $s
}
function SDesc($s) { "{0} ':resolved' line(s){1}; Day Book words in {2} line(s)" -f $s.n, $(if ($s.first) { ': ' + (LDesc $s.first) } else { '' }), $s.dayBook }

# ======================================================================================== the run
$done = @{}
function SRes($c, $st, $ev) { Result $c $st $ev; $done[$c] = $true }
try {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" -ErrorAction SilentlyContinue | ForEach-Object { "pid $($_.ProcessId): $($_.CommandLine)" })
  Info "s235: bridge processes: $($procs -join ' | ')"
  Info "s235: proxy beside Tally: $($script:proxyOk); bridge config TallyHost '$($cfg1.TallyHost)', CloudBeatSec '$($cfg1.CloudBeatSec)', KeepOfficeFrom '$($cfg1.KeepOfficeFrom)', KeepOfficeTo '$($cfg1.KeepOfficeTo)'"
  if (-not $script:proxyOk -or "$($cfg1.TallyHost)" -ne '127.0.0.2') { throw "the proxy is not between the bridge and Tally (proxy $($script:proxyOk), TallyHost '$($cfg1.TallyHost)')" }
  # the bridge's starting point first (its first light check): lines of entries above it may be sent
  $spSeen = [bool](WaitLog 0 'starting point (is )?recorded' 120)
  Info "s235: the bridge's starting point recorded: $spSeen"

  # ---- prep: three receipts by keys before any stop (the one to alter, two to delete), each line in with its body
  Say '---- s235 prep: three receipts by keys'
  $prep = @{}
  foreach ($p in @(@('A', '31-10-2026', '700'), @('D1', '1-11-2026', '300'), @('D2', '2-11-2026', '400'))) {
    $before = VList; $m0 = NowMs
    $t0 = ScreenCreate $p[1] $p[2] "prep-$($p[0])"
    $w = S235Wait { param($vs) $n = NewOnes $before $vs; if ($n.Count -eq 1) { $n[0] } } $isCreated $m0 $t0 60 "prep-$($p[0])"
    if ($w.did) { $null = TdsMid $w.did.mid }
    $prep[$p[0]] = $w.did
    Info "s235 prep $($p[0]) ($($p[1])): Tally $(VDesc $w.did); line after $($w.sec) s $(LDesc $w.line)"
  }
  $null = TdsGateway 'after prep'
  Snap 's235-prep'
  $A = $prep['A']; $D1 = $prep['D1']; $D2 = $prep['D2']
  if (-not $A -or -not $D1 -or -not $D2) { throw "prep: the keys did not make the three receipts (A $([bool]$A), D1 $([bool]$D1), D2 $([bool]$D2))" }

  # ================================================================ s1: the stop; create, alter, delete on the screen
  Say "---- $S1"
  $script:altMid = TdsMid $A.mid; $script:delMid = TdsMid $D1.mid
  $ln1 = (LogLines).Count
  if (-not (SetStop 's1')) { throw 'stop: the bridge did not take FinCom''s stop from the beat answer within 30 s' }
  $p1 = NowMs
  $before = VList; $m0 = NowMs
  $t0 = ScreenCreate '2-10-2026' '500' 's1-create'
  $wc = S235Wait { param($vs) $n = NewOnes $before $vs; if ($n.Count -eq 1) { $n[0] } } $isCreated $m0 $t0 10 's1-create'
  $m0 = NowMs
  $t0 = ScreenAlter '31-10-2026' '800' 's1-alter'
  $wa = S235Wait { param($vs) $v = ByMid $vs $script:altMid; if ($v -and $v.aid -gt $A.aid) { $v } } $isAltered $m0 $t0 10 's1-alter'
  $m0 = NowMs
  $t0 = ScreenDelete '1-11-2026' 's1-delete'
  $wd = S235Wait { param($vs) if (-not (ByMid $vs $script:delMid)) { $true } } $isDeleted $m0 $t0 10 's1-delete'
  $null = TdsGateway 'after s1'
  Start-Sleep 3
  $p1e = NowMs
  $C = $wc.did; $A2 = $wa.did
  # a line that came after the 10 s, for the evidence
  $lsAll = S235Lines
  $late = @{}
  foreach ($k in @(@('c', $wc, $isCreated), @('a', $wa, $isAltered), @('d', $wd, $isDeleted))) { if ($k[1].did -and -not $k[1].line) { $late[$k[0]] = @($lsAll | Where-Object { $_.ms -ge $p1 -and (& $k[2] $_ $k[1].did) })[0] } }
  $lines1 = @($wc.line, $wa.line, $wd.line)
  $heldOk = @($lines1 | Where-Object { $_ -and $_.held -match [regex]::Escape($stopWords) -and -not $_.xml }).Count -eq 3
  $delNoGuid = $wd.line -and -not $wd.line.guid -and $wd.line.gh
  $pv = ProxyIn $p1 $p1e; $pvV = @($pv | Where-Object { "$($_.id)" -match $vchRe })
  $hi = HeldItems
  $hd = @($null, $null, $null); for ($i = 0; $i -lt 3; $i++) { if ($lines1[$i]) { $hd[$i] = $hi[$lines1[$i].id] } }
  $noTry = @($hd | Where-Object { $_ -and [int]$_.tries -eq 0 -and [int]$_.freshTries -eq 0 -and [int]$_.asked -eq 0 }).Count -eq 3
  $keep1 = $hd[2] -and "$($hd[2].keepGuid)" -eq $D1.guid
  Snap 's235-s1'
  $didAll = $C -and $A2 -and ($wd.did -eq $true)
  $st1 = if (-not $didAll) { 'HARNESS' } elseif (@($lines1 | Where-Object { $_ }).Count -eq 3 -and $heldOk -and $pvV.Count -eq 0 -and $noTry) { 'PASS' } else { 'FAIL' }
  SRes $S1 $st1 ("Tally: created {0}; altered mid {1} AlterID {2} -> {3}; deleted {4}. Stub lines (seconds from each save, 10 s at most): created {5} s {6}; altered {7} s {8}; deleted {9} s {10}{11}. Held with the stop's words, no body: {12}; the delete held for its proof with no GUID: {13}. Voucher requests that reached Tally during the stop (proxy): {14}; every request the bridge sent Tally then: {15}. Held list (no try counted: {16}; the delete's keepGuid is its GUID: {17}): created {18}; altered {19}; deleted {20}. Bridge log: {21}" -f `
      (VDesc $C), $A.mid, $A.aid, $(if ($A2) { $A2.aid } else { '(unchanged: the keys)' }), $(if ($wd.did -eq $true) { VDesc $D1 } else { 'nothing (the keys)' }),
      $wc.sec, (LDesc $wc.line), $wa.sec, (LDesc $wa.line), $wd.sec, (LDesc $wd.line),
      $(if ($late.Count) { '; LATE (after 10 s): ' + (($late.GetEnumerator() | ForEach-Object { "$($_.Key) $(LDesc $_.Value)" }) -join '; ') } else { '' }),
      $heldOk, [bool]$delNoGuid, $(if ($pvV.Count) { ($pvV | ForEach-Object { "$($_.id) mid $($_.mid) at $($_.t0)" }) -join ', ' } else { 'none' }), (ProxyIds $pv),
      $noTry, $keep1, (HDesc $hd[0]), (HDesc $hd[1]), (HDesc $hd[2]), (KeyLog $ln1 'stopped|held at once|reading from Tally|of mid'))

  # ================================================================ s2: the lift
  Say "---- $S2"
  $ln2 = (LogLines).Count
  if (-not $didAll -or -not $wc.line -or -not $wa.line -or -not $wd.line) { SRes $S2 'HARNESS' "not run: s1 did not give the three held lines (keys or lines missing)"; $null = Lift 's2'; throw 'skip-s2' }
  if (-not (Lift 's2')) { throw 'lift: the bridge did not take the lift from the beat answer within 30 s' }
  $p2 = NowMs
  $s = WaitSettled @(@{ line = $wc.line; guid = $C.guid; body = $true }, @{ line = $wa.line; guid = $A.guid; body = $true }, @{ line = $wd.line; guid = $D1.guid; body = $false }) 780
  $p2e = NowMs
  $gone = InTally $script:delMid
  $sc, $sa, $sd = $s
  $aidOk = $sa.first -and "$($sa.first.aid)" -eq "$($A2.aid)"
  $pv2 = ProxyIn $p2 $p2e
  Snap 's235-s2'
  $ok2 = $sc.ok -and $sa.ok -and $aidOk -and $sd.ok -and $sd.first.ev -eq 'deleted' -and $gone -eq $false -and ($sc.dayBook + $sa.dayBook + $sd.dayBook) -eq 0
  $st2 = if ($null -eq $gone) { 'HARNESS' } elseif ($ok2) { 'PASS' } else { 'FAIL' }
  SRes $S2 $st2 ("created (Tally guid {0}): {1}. altered (Tally guid {2}, AlterID {3}; the line's AlterID is Tally's: {4}): {5}. deleted (its GUID {6}; still in Tally by MasterID {7}: {8}): {9}. Requests the bridge sent Tally after the lift: {10}. Bridge log: {11}" -f `
      $C.guid, (SDesc $sc), $A.guid, $A2.aid, [bool]$aidOk, (SDesc $sa), $D1.guid, $script:delMid, $(if ($null -eq $gone) { '(Tally did not answer)' } else { $gone }), (SDesc $sd), (ProxyIds $pv2), (KeyLog $ln2 'resumed|resolved|GUID|of mid|proven|gone'))
} catch { if ("$_" -ne 'skip-s2') { Write-Host "s235 stopped: $_ $($_.ScriptStackTrace)"; foreach ($c in @($S1, $S2)) { if (-not $done[$c]) { SRes $c 'HARNESS' "the harness stopped: $_" } } } }

# ================================================================ s3: the restart variant
try {
  Say "---- $S3"
  if (-not $D2) { throw 'prep did not make D2' }
  $script:delMid = TdsMid $D2.mid
  $null = Lift 's3-pre'
  $ln3 = (LogLines).Count
  if (-not (SetStop 's3')) { throw 'stop: the bridge did not take FinCom''s stop within 30 s' }
  $p3 = NowMs
  $t0 = ScreenDelete '2-11-2026' 's3-delete'
  $w3 = S235Wait { param($vs) if (-not (ByMid $vs $script:delMid)) { $true } } $isDeleted $p3 $t0 10 's3-delete'
  $null = TdsGateway 'after s3 delete'
  if ($w3.did -ne $true) { throw 'the keys did not delete D2' }
  if (-not $w3.line) { Start-Sleep 20; $ls = S235Lines; $w3.line = @($ls | Where-Object { $_.ms -ge $p3 -and (& $isDeleted $_ $true) })[0] }
  if (-not $w3.line) { throw 'no delete line reached the stub' }
  Start-Sleep 3
  $hb = (HeldItems)[$w3.line.id]
  # the bridge restarted (the tray's Restart: the supervisor starts the worker again)
  $wk0 = @(Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '\bworker\b' } | ForEach-Object { $_.ProcessId })
  $rr = Bridge POST '/tray/restart' @{}
  Start-Sleep 10
  $back = $null; for ($i = 0; $i -lt 30 -and -not $back; $i++) { $back = Bridge GET '/status' $null 10; if (-not $back) { Start-Sleep 3 } }
  $wk1 = @(Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '\bworker\b' } | ForEach-Object { $_.ProcessId })
  $restarted = [bool](WaitLog $ln3 'Restarting: asked from the tray icon' 5) -and [bool]$back -and (-not $wk0.Count -or (@($wk1 | Where-Object { $_ -notin $wk0 }).Count -gt 0))
  Info "s235 s3: restart asked ($($rr | ConvertTo-Json -Compress)); worker pids $($wk0 -join ',') -> $($wk1 -join ','); bridge back: $([bool]$back) version $($back.version)"
  if (-not $restarted) { throw "the bridge did not restart (worker $($wk0 -join ',') -> $($wk1 -join ','), answered $([bool]$back))" }
  Start-Sleep 15
  $ha = (HeldItems)[$w3.line.id]
  $stillStopped = Bridge GET '/tray/status'
  if (-not (Lift 's3')) { throw 'lift: the bridge did not take the lift within 30 s' }
  $s3 = WaitSettled @(@{ line = $w3.line; guid = $D2.guid; body = $false }) 780
  $g3 = InTally $script:delMid
  Snap 's235-s3'
  $x3 = $s3[0]
  $st3 = if ($null -eq $g3) { 'HARNESS' } elseif ($w3.line.held -match [regex]::Escape($stopWords) -and $ha -and "$($ha.keepGuid)" -eq $D2.guid -and $x3.ok -and $x3.first.ev -eq 'deleted' -and $g3 -eq $false -and $x3.dayBook -eq 0) { 'PASS' } else { 'FAIL' }
  SRes $S3 $st3 ("Tally deleted {0}; the held line after {1} s {2}; held list before the restart: {3}; after it: {4}; the stop after the restart: {5}; after the lift: {6}; still in Tally by MasterID: {7}. Bridge log: {8}" -f `
      (VDesc $D2), $w3.sec, (LDesc $w3.line), (HDesc $hb), (HDesc $ha), ($stillStopped.readStopped | ConvertTo-Json -Compress), (SDesc $x3), $(if ($null -eq $g3) { '(Tally did not answer)' } else { $g3 }), (KeyLog $ln3 'Restarting|stopped|resumed|of mid|GUID|resolved'))
} catch { Write-Host "s3 stopped: $_ $($_.ScriptStackTrace)"; if (-not $done[$S3]) { SRes $S3 'HARNESS' "the harness stopped: $_" }; $null = Lift 's3-after' }

# ================================================================ s4: a real failure still counts
try {
  Say "---- $S4"
  $null = Lift 's4-pre'
  $ln4 = (LogLines).Count
  $p4 = NowMs
  Set-Content $proxyCtl (@{ suspendOn = 'FinComVoucherObject|FinComVoucherByNumber|FinComVoucherByMaster|FinComByMaster'; pid = [int]$script:tpid; sec = 20 } | ConvertTo-Json -Compress) -Encoding UTF8
  $before = VList
  $t0 = ScreenCreate '1-12-2026' '600' 's4-create'
  # Tally may be suspended by the proxy any moment from here: the stub only, 30 s, then Tally resumed (also by the proxy)
  Start-Sleep 30
  ResumeTally
  $ctlLeft = Test-Path $proxyCtl; Remove-Item $proxyCtl -Force -ErrorAction SilentlyContinue
  $after = VList
  $n4 = if ($null -ne $after) { NewOnes $before $after } else { @() }
  $E = if ($n4.Count -eq 1) { $n4[0] } else { $null }
  if (-not $E) { $null = TdsGateway 's4 after'; throw "the keys did not make the receipt of 1-12-2026 (new vouchers: $($n4.Count); proxy control left unused: $ctlLeft)" }
  $eMid = TdsMid $E.mid
  # the outcome: the line ended with the Day Book words, or its try counted in the held list, or settled after one more ask
  $until = (Get-Date).AddSeconds(150); $first = $null; $hE = $null; $resE = @()
  do {
    $ls = S235Lines
    $mine = @($ls | Where-Object { $_.ms -ge $p4 -and $_.ev -eq 'created' -and $_.mid -eq $eMid })
    $first = @($mine | Where-Object { -not $_.res })[0]; $resE = @($mine | Where-Object { $_.res })
    if ($first) { $hE = (HeldItems)[$first.id] }
    $endedDB = @($mine | Where-Object { $_.held -match 'Day Book' }).Count -gt 0
    $counted = $endedDB -or ($hE -and ([int]$hE.freshTries -ge 1 -or [int]$hE.asked -ge 1 -or [int]$hE.tries -ge 1 -or [int]$hE.slow -ge 1 -or [bool]$hE.freshSlow))
    if ($first -and ($counted -or $resE.Count)) { break }
    Start-Sleep 5
  } while ((Get-Date) -lt $until)
  $null = TdsGateway 'after s4'
  $pv4 = ProxyIn $p4 (NowMs)
  $pa = ProxyAll
  $sus = @($pa | Where-Object { $_.event -in 'suspend', 'resume', 'suspend-failed' -and [int64]$_.t -ge $p4 })
  $susReq = @($pv4 | Where-Object { $_.suspended })
  $reached = @($sus | Where-Object { $_.event -eq 'suspend' }).Count -ge 1 -and @($susReq | Where-Object { "$($_.mid)" -eq $eMid -or -not $_.mid }).Count -ge 1
  $vAsks = @($pv4 | Where-Object { "$($_.id)" -match $vchRe -and "$($_.mid)" -eq $eMid })
  $stopWrong = $first -and $first.held -match [regex]::Escape($stopWords)
  $oneMore = $resE.Count -ge 1 -and $vAsks.Count -ge 2
  Snap 's235-s4'
  $st4 = if (-not $reached -or -not $first) { 'HARNESS' } elseif (-not $stopWrong -and ($counted -or $oneMore)) { 'PASS' } else { 'FAIL' }
  SRes $S4 $st4 ("Tally made {0}; the proxy: {1}; the suspended request: {2}; voucher requests for mid {3}: {4}. The line {5}; its ':resolved' line(s): {6}; ended with the Day Book words: {7}; held list: {8}; one more ask that settled it: {9}; held with the stop's words (wrong): {10}. Bridge log: {11}" -f `
      (VDesc $E), $(if ($sus.Count) { ($sus | ForEach-Object { "$($_.event) $($_.id) pid $($_.pid) status $($_.status) at $($_.t)" }) -join ', ' } else { 'no suspend (the bridge sent no voucher request)' }),
      $(if ($susReq.Count) { ($susReq | ForEach-Object { "$($_.id) mid $($_.mid) $($_.ms) ms status $($_.status) err '$($_.err)'" }) -join ', ' } else { 'none' }), $eMid,
      $(if ($vAsks.Count) { ($vAsks | ForEach-Object { "$($_.id) at $($_.t0) $($_.ms) ms" }) -join ', ' } else { 'none' }),
      (LDesc $first), $(if ($resE.Count) { ($resE | ForEach-Object { LDesc $_ }) -join '; ' } else { 'none' }), [bool]$endedDB, (HDesc $hE), [bool]$oneMore, [bool]$stopWrong, (KeyLog $ln4 'of mid|held at once|stopped at|2 s|Day Book|asking Tally|resolved'))
} catch { Write-Host "s4 stopped: $_ $($_.ScriptStackTrace)"; ResumeTally; if (-not $done[$S4]) { SRes $S4 'HARNESS' "the harness stopped: $_" } }

# ================================================================ s5: Tally not open: one notification a day
try {
  Say "---- $S5"
  $nf = Join-Path $env:LOCALAPPDATA 'FinCom Bridge\notifications-cleared.json'
  $trays = @(Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '\btray\b' })
  Info "s235 s5: tray icon process(es): $(($trays | ForEach-Object { "pid $($_.ProcessId) $($_.CommandLine)" }) -join ' | ')"
  if (-not $trays.Count) { throw 'no tray icon process (FinComBridge.exe tray) runs on the runner: no notification can be shown' }
  $shownRe = 'Notification shown: Tally not open'
  # every log the bridge and the icon write
  function NotifLines { $f = @(Get-ChildItem -Path $h1, (Join-Path $env:LOCALAPPDATA 'FinCom Bridge') -Recurse -Filter '*.log' -File -ErrorAction SilentlyContinue)
    return , @($f | ForEach-Object { $p = $_.FullName; Get-Content $p -Encoding UTF8 | Where-Object { $_ -match 'Notification shown' } | ForEach-Object { "$_" } } | Select-Object -Unique) }
  function NotifFile { if (Test-Path $nf) { try { return (Get-Content $nf -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable) } catch { return @{ '(unreadable)' = "$_" } } }; return @{} }
  $nl = NotifLines; $n0 = @($nl | Where-Object { $_ -match $shownRe }).Count
  $ts0 = Bridge GET '/tray/status'
  Info "s235 s5: before: '$shownRe' lines $n0; tray status tallyOpen $($ts0.tallyOpen), paused $($ts0.paused), readStopped $($ts0.readStopped | ConvertTo-Json -Compress); clock $(Get-Date -Format 'ddd HH:mm')"
  # 1st close: 3+ minutes
  S235StopTally; $c1 = Get-Date
  $first5 = $null; $closedSeen = $null
  do {
    Start-Sleep 10
    if (-not $closedSeen) { $ts = Bridge GET '/tray/status' $null 10; if ($ts -and -not $ts.tallyOpen) { $closedSeen = [math]::Round(((Get-Date) - $c1).TotalSeconds) } }
    $nl = NotifLines; $sh = @($nl | Where-Object { $_ -match $shownRe })
    if ($sh.Count -gt $n0) { $first5 = [math]::Round(((Get-Date) - $c1).TotalSeconds); Shot 's235-s5-toast'; break }
  } while (((Get-Date) - $c1).TotalSeconds -lt 360)
  Snap 's235-s5a'
  $file1 = NotifFile
  $tallyIds1 = @($file1.Keys | Where-Object { "$_" -like 'tally:*' })
  # reopened: the icon sees Tally open, then closed again the same day for 4.5 minutes
  $up = S235StartTally 's5-reopen'
  $seenOpen = $false; for ($i = 0; $i -lt 30; $i++) { $ts = Bridge GET '/tray/status' $null 10; if ($ts.tallyOpen) { $seenOpen = $true; break }; Start-Sleep 5 }
  Start-Sleep 20
  S235StopTally; $c2 = Get-Date
  $wait2 = [math]::Max(270, 180 + [int]$closedSeen + 60); Start-Sleep $wait2
  Snap 's235-s5b'
  $nl = NotifLines; $sh2 = @($nl | Where-Object { $_ -match $shownRe })
  $file2 = NotifFile
  $tallyIds2 = @($file2.Keys | Where-Object { "$_" -like 'tally:*' })
  $nShown = $sh2.Count - $n0
  Shot 's235-s5-end'
  $st5 = if (-not $closedSeen -or -not $up -or -not $seenOpen) { 'HARNESS' } elseif ($first5 -and $first5 -ge 170 -and $nShown -eq 1 -and $tallyIds2.Count -eq 1) { 'PASS' } else { 'FAIL' }
  SRes $S5 $st5 ("1st close: the bridge saw Tally closed after {0} s; the notification after {1} s; notifications-cleared.json: {2}. Reopened (Tally up {3}, the bridge saw it open {4}), closed again {10} s: '{5}' lines in all since the start of s5: {6}; the file's tally entries: {7} ({8}). Log: {9}" -f `
      $closedSeen, $(if ($first5) { $first5 } else { 'none in 360 s' }), (($file1 | ConvertTo-Json -Compress -Depth 4)), $up, $seenOpen, $shownRe, $nShown, $tallyIds2.Count, (($file2 | ConvertTo-Json -Compress -Depth 4)), $(if ($sh2.Count) { ($sh2 | ForEach-Object { Cut $_ 240 }) -join ' | ' } else { '(none)' }), $wait2)
} catch { Write-Host "s5 stopped: $_ $($_.ScriptStackTrace)"; if (-not $done[$S5]) { SRes $S5 'HARNESS' "the harness stopped: $_" } }

# ---- what is kept
foreach ($c in $s235Checks) { if (-not $done[$c]) { SRes $c 'HARNESS' 'not run: the harness stopped before it' } }
$lsEnd = S235Lines
$dup = @($lsEnd | Where-Object { $_.res } | Group-Object id | Where-Object { $_.Count -gt 1 } | ForEach-Object { "$($_.Name) x$($_.Count)" })
Info "s235 end: ':resolved' ids sent more than once over the whole run: $(if ($dup.Count) { $dup -join ', ' } else { 'none' }); fresh Tallys started by the harness: $($script:freshTally)"
Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
if (HeldFile) { Copy-Item (HeldFile) (Join-Path $cap 'recorder-held.json') -ErrorAction SilentlyContinue }
Copy-Item (Join-Path $env:LOCALAPPDATA 'FinCom Bridge\notifications-cleared.json') (Join-Path $cap 'notifications-cleared.json') -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'FinCom Bridge') -Filter '*.log' -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "fincom-bridge-$($_.Name)") -ErrorAction SilentlyContinue }
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
$tdsLog | Set-Content (Join-Path $out 'screens.txt') -Encoding UTF8
Write-Host '== results'; Get-Content $resultsFile | Write-Host
