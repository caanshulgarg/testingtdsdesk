# Mode proof72 (26-Oct-2026): TallyPrime 7.2 proof for the owner's "simple, stable connector". TEST DATA ONLY: the
# harness's own throwaway company in this runner's own Tally; never the owner's computer, never staging. Dot-sourced by
# flowv.ps1 after the PUBLISHED bridge 2.4.7's committed setup is installed (stubv.py as the cloud, proxy235.py between
# the bridge and Tally with P72_DUMP: every bridge request and Tally's answer kept for the comparison of 7.1 and 7.2).
# The bridge is not changed: every request it sends is its own. The harness's own requests (marked PROBE below, listed in
# p72\probes.txt with their exact XML) are measurement only and are sent one at a time with the 2 s hard stop (dblib's
# TStop: the late answer awaited, nothing else sent), with the bridge stopped.
#   a  (p1-p3) the bridge finds Tally, the company list, the ledger list, a save on the screen through the add-on, a
#      Payment posted with CREATED / LASTVCHID
#   d  (p8)    the FinCom ID: V1 with the narration tag (the bridge's own stamp), V2 also with REMOTEID; both altered on
#              the screen (amount and narration), V2's narration then retyped; read back by FinComVoucherObject
#   e  (p10)   a batch of 3 with one missing ledger, by the bridge and once directly (Tally's raw reply)
#   c  (p7)    the company GUID before / after a rename (XML, else keys) and in a copy of the data folder
#   b  (p4-p6) TallyPrime's own port screen (keys) and the tally.ini lines it writes; a port written with Tally closed;
#              the same install started twice; a copy of the install on port 9001 on the copied data
#   d' (p9)    lookups by FinCom ID (FinComTag), MasterID (FinComVoucherObject, FinComByMaster) and GUID (PROBE) on the
#              small company and again on ZZ BIG TEST (~30,000 entries)
#   f  (p11)   a window probe all along (WM_NULL every 100 ms, a hold of 1 s or more kept), and the bridge's requests at
#              the proxy (any over 2 s)
. (Join-Path $PSScriptRoot 'dblib.ps1')
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) (TStop $x 2000 30000).body }
$script:TdsRestart = { $null = DbRestart 'gw' }
$script:TdsCo = $co1
$coOrig = $co1
$p72 = Join-Path $cap 'p72'; New-Item -ItemType Directory -Force $p72 | Out-Null
function PSave([string]$n, $t) { [IO.File]::WriteAllText((Join-Path $p72 $n), "$t", [Text.UTF8Encoding]::new($false)) }
function PJson([string]$n, $o) { PSave $n ($o | ConvertTo-Json -Depth 12) }
function MLine([string]$s) { Add-Content -Path $resultsFile -Value "MEASURE $s" -Encoding UTF8; Write-Host "MEASURE $s" }
$pDone = @{}
function PRes($c, $st, $ev) { if (-not $pDone[$c]) { Result $c $st $ev; $pDone[$c] = $true } }
$P1 = 'p1 bridge 2.4.7 installed and connected: finds Tally, the company list, the ledger list'
$P2 = 'p2 a save on the screen reaches FinCom through the add-on'
$P3 = 'p3 a Payment posted by the bridge: CREATED and LASTVCHID'
$P4 = 'p4 tally.ini keys TallyPrime writes from its own port screen (port, acts as, ODBC)'
$P5 = 'p5 a port written into tally.ini with Tally closed is used at the next start'
$P6 = 'p6 two Tallys on one computer (the same install twice; a copy of the install on another port)'
$P7 = 'p7 company GUID after a rename and after a copy of the data folder'
$P8 = 'p8 the FinCom ID on a voucher after an edit on the screen (narration tag, REMOTEID)'
$P9 = 'p9 lookups by FinCom ID, GUID and MasterID: times (2 s stop) on the small and the ~30,000-entry company'
$P10 = 'p10 a batch of 3 with one missing ledger: Tally''s exact reply'
$P12 = 'p12 Tally on port 4125 (below 9000): does bridge 2.4.7 connect (auto / config), what Test connection and the diagnosis say'
$P11 = 'p11 Tally''s window and requests during the run (window probe, the bridge''s requests at the proxy)'
$probeFile = Join-Path $p72 'probes.txt'
function ProbeNote([string]$name, [string]$why, [string]$x) { Add-Content -Path $probeFile -Encoding UTF8 -Value "== PROBE $name ($why)`r`n$x`r`n" }

# ---- f: the window probe, all along (a thread: WM_NULL with a 250 ms limit every 100 ms; a hold of 1 s or more kept)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class P72Frz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); }
'@
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; gmax = 0.0; gtag = ''; tag = ''; beats = 0; err = ''; spans = [Collections.ArrayList]::Synchronized([Collections.ArrayList]::new()) })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null; $sinceAt = $null; $stag = ''
    while (-not $f.stop) {
      $h = $f.h
      if ($f.on -and $h -ne [IntPtr]::Zero -and [P72Frz]::IsWindow($h)) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [P72Frz]::SendMessageTimeout($h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) {
          if ($null -eq $since) { $since = $t0; $sinceAt = Get-Date; $stag = $f.tag }
          $cur = $sw.Elapsed.TotalMilliseconds - $since
          if ($cur -gt $f.max) { $f.max = $cur }
          if ($cur -gt $f.gmax) { $f.gmax = $cur; $f.gtag = $stag }
        } elseif ($null -ne $since) {
          $d = $sw.Elapsed.TotalMilliseconds - $since
          if ($d -ge 1000) { $null = $f.spans.Add(('{0} {1} ms during {2}' -f $sinceAt.ToString('HH:mm:ss'), [int]$d, $stag)) }
          $since = $null
        }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
} catch { Info "proof72: the window probe could not start ($_)" }
function FrzH([string]$tag) {
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }
  if ($tag) { $script:frz.tag = $tag }
  $script:frz.on = $true
}
FrzH 'start'
Info "proof72: window probe running $($script:frzOk) (beats $($script:frz.beats)), Tally pid $($script:tpid)"

# a measured request (the harness's, the bridge stopped): the 2 s stop, Tally's full time, the window's longest hold
$script:reqRows = [Collections.Generic.List[object]]::new()
function TW([string]$x, [string]$label, [int]$stopMs = 2000, [int]$maxMs = 60000) {
  FrzH $label; $script:frz.max = 0.0
  $r = TStop $x $stopMs $maxMs
  Start-Sleep -Milliseconds 150
  $bl = if ($script:frzOk) { [math]::Round($script:frz.max, 0) } else { -1 }
  $r | Add-Member -NotePropertyName blockedMs -NotePropertyValue $bl -Force
  $row = [pscustomobject]@{ label = $label; ms = $r.ms; inTime = $r.inTime; overrun = $r.overrun; hung = $r.hung; blockedMs = $bl; bytes = "$($r.body)".Length; err = $r.err }
  $script:reqRows.Add($row)
  Write-Host ("[p72] {0}: {1} ms, in time {2}, overrun {3}, hung {4}, window held {5} ms, {6} chars {7}" -f $label, $r.ms, $r.inTime, $r.overrun, $r.hung, $bl, $row.bytes, $r.err)
  if ($r.hung) { $null = DbRestart "hung-$label" }
  return $r
}
function TWSave([string]$x, [string]$label) { $r = TW $x $label; PSave "$label.xml" $r.body; return $r }
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
function CoList {
  $r = TStop $script:dbListCo 2000 20000
  $l = @(); foreach ($m in [regex]::Matches($r.body, '(?s)<COMPANY[ >].*?</COMPANY>')) {
    $l += [pscustomobject]@{ name = [regex]::Match($m.Value, 'NAME="([^"]*)"').Groups[1].Value; nm = [regex]::Match($m.Value, '<NAME[^>]*>([^<]*)<').Groups[1].Value; guid = [regex]::Match($m.Value, '<GUID[^>]*>([^<]*)<').Groups[1].Value } }
  return , $l
}
function CoListAt([int]$port) {
  try { $b = (Invoke-WebRequest "http://127.0.0.1:$port" -Method Post -Body $script:dbListCo -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 20).Content } catch { return "no answer on ${port}: $($_.Exception.Message)" }
  return (@([regex]::Matches($b, '(?s)<COMPANY[ >].*?</COMPANY>') | ForEach-Object { '{0} GUID {1}' -f [regex]::Match($_.Value, 'NAME="([^"]*)"').Groups[1].Value, [regex]::Match($_.Value, '<GUID[^>]*>([^<]*)<').Groups[1].Value }) -join '; ')
}
function PortOpen([int]$port) { $tc = [Net.Sockets.TcpClient]::new(); try { $ar = $tc.BeginConnect('127.0.0.1', $port, $null, $null); return ($ar.AsyncWaitHandle.WaitOne(700) -and $tc.Connected) } catch { return $false } finally { $tc.Close() } }
function PortOwner([int]$port) { (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress) pid $($_.OwningProcess)" }) -join ', ') }
function IniText { $f = Join-Path $dir 'tally.ini'; if (Test-Path $f) { return [IO.File]::ReadAllText($f) }; return '' }
function IniDiff([string]$a, [string]$b) {
  $la = @($a -split "`r?`n" | Where-Object { $_ -ne '' }); $lb = @($b -split "`r?`n" | Where-Object { $_ -ne '' })
  $gone = @($la | Where-Object { $_ -notin $lb }); $new = @($lb | Where-Object { $_ -notin $la })
  return "removed [$($gone -join ' | ')] added [$($new -join ' | ')]"
}
function IniKeys([string]$t) { (@($t -split "`r?`n" | Where-Object { $_ -match '^\s*(Client Server|ServerPort|Enable ODBC Server|ODBC|Port|Server)\b' -or $_ -match '(?i)port|odbc|client ?server' } | Where-Object { $_ -notmatch '^\s*;' }) -join ' | ') }
# the voucher as FinComVoucherObject answers it (the bridge's own entry request, from the ref)
function ObjReq([string]$mid) { (WithDay $script:RQ['entry-object'] '20991231').Replace('ID:99999', "ID:$mid") }
function ObjRead([string]$mid, [string]$label) {
  $r = TWSave (ObjReq $mid) $label
  $b = $r.body
  return [pscustomobject]@{ r = $r; remoteid = [regex]::Match($b, '<VOUCHER[^>]*\sREMOTEID="([^"]*)"').Groups[1].Value; guid = [regex]::Match($b, '<GUID[^>]*>([^<]*)<').Groups[1].Value
    narr = [Net.WebUtility]::HtmlDecode([regex]::Match($b, '(?s)<NARRATION[^>]*>(.*?)</NARRATION>').Groups[1].Value); aid = [regex]::Match($b, '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value
    amt = (@([regex]::Matches($b, '<AMOUNT[^>]*>([^<]*)<') | ForEach-Object { $_.Groups[1].Value.Trim() }) -join ',') }
}
function Ok2([object]$r) { return [bool]($r.ok -and $r.inTime) }

# ===================================================================== a: the published bridge on this release
Say '---- proof72 a: the published bridge 2.4.7, unchanged, on this release'
FrzH 'a-bridge'
$stA = Bridge GET '/status?fresh=1'; $msS = $script:lastMs; PJson 'a-status.json' $stA
$coA = Bridge GET '/companies'; $msC = $script:lastMs; PJson 'a-companies.json' $coA
$coHas = @($coA.companies | Where-Object { $_.name -eq $co1 }).Count -gt 0
$ledA = Bridge GET ('/ledgers?company=' + [uri]::EscapeDataString($co1)) $null 180; $msL = $script:lastMs; PJson 'a-ledgers.json' $ledA
$ledN = @($ledA.ledgers).Count
$kinds = (@(StubReqs | Group-Object kind | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', ')
$sessTxt = (($stA.sessions | ConvertTo-Json -Depth 5 -Compress) -replace '\s+', ' ')
if ($sessTxt.Length -gt 500) { $sessTxt = $sessTxt.Substring(0, 500) + '...' }
PRes $P1 $(if ($stA -and $coHas -and $ledN -gt 0) { 'PASS' } else { 'FAIL' }) ("bridge {0} (setup {1}); /status?fresh=1 {2} ms: tally '{3}', sessions {4}; /companies {5} ms: '{6}' listed {7} ({8}); /ledgers {9} ms: {10} ledgers{11}; cloud calls at the stub: {12}" -f `
    $stA.version, ((Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue) -join ' '), $msS, (($stA.tally | ConvertTo-Json -Compress -Depth 4) -replace '\s+', ' '), $sessTxt, $msC, $co1, $coHas, ((@($coA.companies | ForEach-Object { "$($_.name) port $($_.port) from $($_.from)" })) -join '; '), $msL, $ledN, $(if (-not $ledA) { ' (no answer: see the bridge log)' } else { '' }), $kinds)

# a save on the screen (a Receipt by keys, as flowv's c4a) reaches the stub through the add-on
FrzH 'a-receipt-keys'
$m = Mark
$null = TdsGateway 'a-receipt'
KeysTo 'v' 4 'p72-a-vouchers'; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo '2-10-2026{ENTER}' 3
KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3 'p72-a-particular'; KeysTo '700{ENTER}' 3; KeysTo '^a' 0; $t0 = Get-Date; Start-Sleep 5; Shot 'p72-a-saved'
$hit = WaitLine $m { $_.ev -eq 'created' -and $_.company -eq $co1 -and $_.vch -like 'Receipt/*' } $t0 120
$x = @($hit)[0]
Snap 'p72-a-receipt'
if ($x) { PJson 'a-recorder-line.json' $x.raw; PSave 'a-recorder-body.xml' $x.xml }
$recMid = if ($x) { "$($x.mid)" } else { '' }
PRes $P2 $(if ($x -and $x.xml) { 'PASS' } elseif ($script:noWindow) { 'HARNESS' } else { 'FAIL' }) ("Receipt by keys (2-10-2026, Cash, Spike Income 700): line after {0} s; {1}" -f $script:lineSec, (Ev $x))

# the Payment posted by the bridge, carrying the FinCom ID in its narration (V1); V2 also with REMOTEID (the bridge
# passes the voucher's XML as FinCom writes it; it stamps the narration tag on every voucher itself)
$sfx = [guid]::NewGuid().ToString('N').Substring(0, 6).ToUpper()
$tag1 = "TDSDesk:P72V1$sfx"; $tag2 = "TDSDesk:P72V2$sfx"; $rid2 = "FinCom-P72V2-$sfx"
function PayXml([string]$date, [string]$narr, [string]$amt, [string]$head = '<VOUCHER VCHTYPE="Payment" ACTION="Create">') {
  $head + '<DATE>' + $date + '</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><NARRATION>' + (LE $narr) + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$v1x = PayXml '20260901' "$tag1 | proof72 payment V1" '500.00'
$v2x = PayXml '20260902' "$tag2 | proof72 payment V2 with REMOTEID" '600.00' ('<VOUCHER REMOTEID="' + $rid2 + '" VCHTYPE="Payment" ACTION="Create">')
FrzH 'a-bridge-posting'
$i1 = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "P72V1$sfx"; xml = $v1x }) } 120; $ms1 = $script:lastMs
PJson 'a-import-v1.json' $i1
$r1 = @($i1.results)[0]
$v1mid = "$($r1.lastVchId)"
PRes $P3 $(if ($r1.ok -eq $true -and [int]$r1.created -eq 1 -and $v1mid -match '^\d+$') { 'PASS' } else { 'FAIL' }) ("/import of one Payment (1-9-2026, Spike Party 500 / Cash, narration '$tag1 | ...') {0} ms: ok {1}, created {2}, altered {3}, errors {4}, exceptions {5}, LASTVCHID {6}, message '{7}', byReply {8}" -f $ms1, $r1.ok, $r1.created, $r1.altered, $r1.errors, $r1.exceptions, $r1.lastVchId, $r1.message, $r1.byReply)
$i2 = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "P72V2$sfx"; xml = $v2x }) } 120; $ms2 = $script:lastMs
PJson 'a-import-v2.json' $i2
$r2 = @($i2.results)[0]; $v2mid = "$($r2.lastVchId)"
MLine ("d V2 (REMOTEID=""$rid2"") posted by the bridge's /import {0} ms: ok {1}, created {2}, altered {3}, LASTVCHID {4}, message '{5}'" -f $ms2, $r2.ok, $r2.created, $r2.altered, $r2.lastVchId, $r2.message)

# ===================================================================== e: a batch of 3, one names a missing ledger
Say '---- proof72 e: a batch of 3 with one missing ledger (the bridge)'
function JrnXml([string]$date, [string]$narr, [string]$cr, [string]$amt) {
  '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>' + (LE $narr) + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (LE $cr) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$bx = @(
  @{ id = "P72E1$sfx"; xml = (JrnXml '20260831' "TDSDesk:P72E1$sfx | batch 1 of 3" 'Spike Income' '101.00') },
  @{ id = "P72E2$sfx"; xml = (JrnXml '20260831' "TDSDesk:P72E2$sfx | batch 2 of 3 (missing ledger)" 'P72 Missing Ledger' '102.00') },
  @{ id = "P72E3$sfx"; xml = (JrnXml '20260831' "TDSDesk:P72E3$sfx | batch 3 of 3" 'Spike Income' '103.00') })
$ib = Bridge POST '/import' @{ company = $co1; vouchers = $bx } 120; $msB = $script:lastMs
PJson 'e-import-batch.json' $ib
Start-Sleep 3; Snap 'p72-e-batch'
$bLog = @(Get-Content (Join-Path $out 'bridge-log-p72-e-batch.txt') -ErrorAction SilentlyContinue | Where-Object { $_ -match "Tally's reply|request \d+ of \d+" }) -join ' / '
$bItems = (@($ib.results) | ForEach-Object { "{0}: ok {1}, accepted {2}, needsReview {3}, created {4}, errors {5}, lastVchId {6}, message '{7}', lineError '{8}'" -f $_.id, $_.ok, $_.accepted, $_.needsReview, $_.created, $_.errors, $_.lastVchId, $_.message, ((@($_.lineError)) -join ' | ') }) -join '; '
$batchBridge = "bridge /import of 3 Journals in one request {0} ms; per entry: {1}; bridge log: {2}" -f $msB, $bItems, $bLog

# ===================================================================== d: the FinCom ID through an edit on the screen
Say '---- proof72 d: V1 and V2 altered on the screen'
function DayBookOn([string]$d, [string]$n) { $null = TdsGateway "db-$n"; KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 4; KeysTo '{F2}' 3; KeysTo "$d{ENTER}" 4 "p72-$n-daybook" }
# amount 777 / 888 and " edited on screen" added at the end of the narration (as c4b: three ENTERs reach the amount)
function AlterAmtNarr([string]$d, [string]$amt, [string]$n) {
  $m = Mark
  DayBookOn $d $n; KeysTo '{END}' 2; KeysTo '{ENTER}' 4 "p72-$n-open"
  KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2 "p72-$n-at-amount"; KeysTo "$amt{ENTER}" 2
  KeysTo '{ENTER}' 2 "p72-$n-after-lines"
  $t = TdsScreen "p72-$n-narration"
  KeysTo '{END}' 1; KeysTo ' edited on screen' 1 "p72-$n-narr-typed"
  KeysTo '^a' 0; Start-Sleep 5; Shot "p72-$n-saved"
  $t2 = TdsScreen "p72-$n-after"
  if ($t2 -match 'Yes or No|Accept') { KeysTo 'y' 3 "p72-$n-yes" }
  return $m
}
function RetypeNarr([string]$d, [string]$text, [string]$n) {
  $m = Mark
  DayBookOn $d $n; KeysTo '{END}' 2; KeysTo '{ENTER}' 4 "p72-$n-open"
  KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2 "p72-$n-at-amount"; KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2 "p72-$n-after-lines"
  KeysTo '{END}' 1; KeysTo '{BACKSPACE 250}' 1; KeysTo $text 1 "p72-$n-narr-typed"
  KeysTo '^a' 0; Start-Sleep 5; Shot "p72-$n-saved"
  $t2 = TdsScreen "p72-$n-after"
  if ($t2 -match 'Yes or No|Accept') { KeysTo 'y' 3 "p72-$n-yes" }
  return $m
}
FrzH 'd-alter-keys'
$mA1 = AlterAmtNarr '1-9-2026' '777' 'd-v1'
$lA1 = WaitLine $mA1 { $_.ev -eq 'altered' -and $_.company -eq $co1 -and "$($_.mid)" -eq $v1mid } (Get-Date) 60
$mA2 = AlterAmtNarr '2-9-2026' '888' 'd-v2'
$lA2 = WaitLine $mA2 { $_.ev -eq 'altered' -and $_.company -eq $co1 -and "$($_.mid)" -eq $v2mid } (Get-Date) 60
$mA3 = RetypeNarr '2-9-2026' 'narration rewritten by the accountant' 'd-v2b'
$lA3 = WaitLine $mA3 { $_.ev -eq 'altered' -and $_.company -eq $co1 -and "$($_.mid)" -eq $v2mid } (Get-Date) 60
Snap 'p72-d-alter'
foreach ($p in @(@('d-line-v1-alter', $lA1), @('d-line-v2-alter', $lA2), @('d-line-v2-retype', $lA3))) { $l = @($p[1])[-1]; if ($l) { PJson "$($p[0]).json" $l.raw; PSave "$($p[0])-body.xml" $l.xml } }
function LineNarr($l) { $l = @($l)[-1]; if (-not $l) { return '(no line)' }; return [Net.WebUtility]::HtmlDecode([regex]::Match("$($l.xml)", '(?s)<NARRATION[^>]*>(.*?)</NARRATION>').Groups[1].Value) }
$addonTxt = "the add-on's lines: V1 altered '{0}'; V2 altered '{1}'; V2 retyped '{2}'" -f (LineNarr $lA1), (LineNarr $lA2), (LineNarr $lA3)

# ===================================================================== c: the company GUID through a rename
Say '---- proof72 c: rename (the bridge still running: its answer kept)'
FrzH 'c-rename'
$g0 = CoList; PJson 'c-companies-before.json' $g0
$guid0 = @($g0 | Where-Object { $_.name -eq $co1 -or $_.nm -eq $co1 })[0].guid
$coNew = "$coOrig R72"
function RenXml([string]$from, [string]$to) { '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $from) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + (LE $from) + '" ACTION="Alter"><NAME>' + (LE $to) + '</NAME><BASICCOMPANYFORMALNAME>' + (LE $to) + '</BASICCOMPANYFORMALNAME></COMPANY></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>' }
ProbeNote 'rename-company-xml' 'test data: the harness renames its own company' (RenXml $coOrig $coNew)
# the company renamed: by XML first, else by keys (Alt+K, Alter, the company, the name typed over, Ctrl+A); its list after
function RenameTo([string]$from, [string]$to, [string]$tag) {
  $rr = TStop (RenXml $from $to) 30000 30000; PSave "c-rename-$tag-xml-reply.xml" $rr.body
  Start-Sleep 3; $g = CoList; $script:renHow = 'XML import (COMPANY ACTION="Alter" with a new NAME)'
  if (-not @($g | Where-Object { $_.name -eq $to -or $_.nm -eq $to }).Count) {
    $script:renHow = 'keys (Alt+K, Alter, the name typed over, Ctrl+A)'
    $null = TdsGateway "c-$tag"
    KeysTo '%k' 3 "p72-c-$tag-altk"; $t = TdsScreen "p72-c-$tag-menu"
    KeysTo 'Alter' 2; KeysTo '{ENTER}' 3 "p72-c-$tag-alter"; $t = TdsScreen "p72-c-$tag-list"
    if ($t -match 'List of Companies|Select Company') { KeysTo '{ENTER}' 3 }
    $t = TdsScreen "p72-c-$tag-form"
    KeysTo '{END}' 1; KeysTo '{BACKSPACE 80}' 1; KeysTo (SK $to) 1 "p72-c-$tag-typed"; KeysTo '^a' 3; $t = TdsScreen "p72-c-$tag-after"
    if ($t -match 'Yes or No|Accept') { KeysTo 'y' 4 }
    Start-Sleep 3; $g = CoList
  }
  return , $g
}
$g1 = RenameTo $coOrig $coNew 'r1'; $how = $script:renHow
PJson 'c-companies-after-rename.json' $g1
$cRen = @($g1 | Where-Object { $_.name -eq $coNew -or $_.nm -eq $coNew })[0]
$renamed = [bool]$cRen
$bridgeRen = ''
if ($renamed) {
  $co1 = $coNew; $script:TdsCo = $co1
  $cb = Bridge GET '/companies'; PJson 'c-bridge-companies-after-rename.json' $cb
  $ji = Bridge POST '/import' @{ company = $coNew; vouchers = @(@{ id = "P72R$sfx"; xml = (JrnXml '20261001' "TDSDesk:P72R$sfx | after the rename" 'Spike Income' '55.00') }) } 120
  PJson 'c-bridge-import-after-rename.json' $ji
  $jr = @($ji.results)[0]
  $bridgeRen = "the bridge after the rename: /companies [{0}]; /import to '{1}': ok {2}, created {3}, message '{4}'{5}" -f ((@($cb.companies | ForEach-Object { $_.name })) -join ', '), $coNew, $jr.ok, $jr.created, $jr.message, $(if (-not $ji) { ' (no answer: see the bridge log)' } else { '' })
}

# ===================================================================== the bridge stopped: from here only the harness asks
Say '---- proof72: the bridge stopped (the harness''s own measurements follow, one request at a time)'
Snap 'p72-before-stop'
Copy-Item $blog (Join-Path $p72 'bridge-full.log') -ErrorAction SilentlyContinue
# the bridge's program and command line, to start it again for q (port 4125)
$bProcs = @(Get-CimInstance Win32_Process -Filter "Name='FinComBridge.exe'" -ErrorAction SilentlyContinue)
PSave 'bridge-processes.txt' (($bProcs | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath) :: $($_.CommandLine)" }) -join "`r`n")
Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-S235Proxy
$px = @(); if (Test-Path $proxyLog) { $px = @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }
Copy-Item $proxyLog (Join-Path $p72 'proxy.jsonl') -ErrorAction SilentlyContinue
$pxOver = @($px | Where-Object { [int]$_.ms -gt 2000 })
$pxMax = ($px | Sort-Object { [int]$_.ms } -Descending | Select-Object -First 1)
$pxIds = (@($px | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count) (max $(($_.Group | Measure-Object ms -Maximum).Maximum) ms)" }) -join ', ')
# overlap: two bridge requests at Tally at once
$ov = 0; $sorted = @($px | Sort-Object { [int64]$_.t0 }); for ($i = 1; $i -lt $sorted.Count; $i++) { if ([int64]$sorted[$i].t0 -lt [int64]$sorted[$i - 1].t1) { $ov++ } }

# d: read back V1 / V2 (FinComVoucherObject, the bridge's own entry request) and the rename back
$o1 = if ($v1mid) { ObjRead $v1mid 'd-v1-object' } else { $null }
$o2 = if ($v2mid) { ObjRead $v2mid 'd-v2-object' } else { $null }
$v1TagKept = $o1 -and $o1.narr -match [regex]::Escape($tag1)
$v2TagKept = $o2 -and $o2.narr -match [regex]::Escape($tag2)
$v2Rid = if ($o2) { $o2.remoteid } else { '' }
$d8 = ("V1 (tag only) after amount 777 and narration added: narration '{0}', AlterID {1}, amounts {2}, GUID {3}, REMOTEID attr '{4}': tag kept {5}. V2 (REMOTEID=""{6}"" posted): GUID {7}, REMOTEID attr '{8}' after the edits (amount 888, then the narration retyped entirely): narration '{9}', tag kept {10}, AlterID {11}, amounts {12}. {13}" -f `
    $o1.narr, $o1.aid, $o1.amt, $o1.guid, $o1.remoteid, $v1TagKept, $rid2, $o2.guid, $o2.remoteid, $o2.narr, $v2TagKept, $o2.aid, $o2.amt, $addonTxt)
$v1Amt = $o1 -and $o1.amt -match '777'
$v2Amt = $o2 -and $o2.amt -match '888'
PRes $P8 $(if (-not $o1 -or -not $o2) { 'HARNESS' } elseif (-not $v1Amt -or -not $v2Amt) { 'HARNESS' } else { 'PASS' }) ("{0}{1}" -f $d8, $(if (-not $v1Amt -or -not $v2Amt) { ' (the keys did not make the amount edit: see the p72-d-* screens)' } else { '' }))

# c: the rename back (so the rest runs on the company the data was made for)
if ($renamed) {
  $g2 = RenameTo $coNew $coOrig 'back'
  if (@($g2 | Where-Object { $_.name -eq $coOrig -or $_.nm -eq $coOrig }).Count) { $co1 = $coOrig; $script:TdsCo = $co1 }
  Info "proof72 c: renamed back to '$coOrig': $($co1 -eq $coOrig) (companies now: $((@($g2 | ForEach-Object { "$($_.name) $($_.guid)" })) -join '; '))"
}
$renTxt = "rename by {0}: '{1}' GUID {2} -> {3}" -f $how, $coOrig, $guid0, $(if ($cRen) { "'$($cRen.name)' GUID $($cRen.guid) (same GUID: $($cRen.guid -eq $guid0))" } else { "not renamed (companies: $((@($g1 | ForEach-Object { "$($_.name) $($_.guid)" })) -join '; '))" })

# e: the same batch shape sent directly once (31-Oct-2026), Tally's raw reply kept
$bx2 = (JrnXml '20261031' "TDSDesk:P72F1$sfx | direct 1 of 3" 'Spike Income' '111.00') + (JrnXml '20261031' "TDSDesk:P72F2$sfx | direct 2 of 3 (missing ledger)" 'P72 Missing Ledger' '112.00') + (JrnXml '20261031' "TDSDesk:P72F3$sfx | direct 3 of 3" 'Spike Income' '113.00')
$bxe = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $bx2 + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
$rbx = TW $bxe 'e-direct-batch' 2000 60000; PSave 'e-direct-batch-reply.xml' $rbx.body; PSave 'e-direct-batch-request.xml' $bxe
$rawOne = ($rbx.body -replace '\s*\r?\n\s*', '')
$rawOne = [regex]::Replace($rawOne, '(?s)<CMPINFO>.*?</CMPINFO>', '<CMPINFO>...</CMPINFO>')
if ($rawOne.Length -gt 1500) { $rawOne = $rawOne.Substring(0, 1500) + '...' }
$e2 = [regex]::Match($rbx.body, '(?s)<CREATED>(\d+)</CREATED>.*?<ERRORS>(\d+)</ERRORS>')
PRes $P10 $(if ($ib -and $rbx.ok) { 'PASS' } else { 'FAIL' }) ("{0}. Directly ({1} ms): Tally's raw reply: {2}" -f $batchBridge, $rbx.ms, $rawOne)

# ===================================================================== d': lookups on the small company
Say '---- proof72 lookups (small company)'
$tagReq = { param([string]$d) WithDay $script:RQ['tagcheck'] $d }
$byMasterReq = { param([string]$d, [string]$mid) (WithDay $script:RQ['bymaster'] $d).Replace('$MasterID = 99999', "`$MasterID = $mid") }
# PROBE (harness only, not on the allow-list): the read-back shape with the filter on GUID, one date / no date; and the
# object export addressed by GUID
$byGuidDayReq = { param([string]$d, [string]$g) (WithDay $script:RQ['bymaster'] $d).Replace('FinComByMaster', 'P72ByGuid').Replace('$MasterID = 99999', '$GUID = &#34;' + (LE $g) + '&#34;') }
$byGuidAllReq = { param([string]$g) [regex]::Replace((& $byGuidDayReq '20991231' $g), '<SVFROMDATE[^>]*>[^<]*</SVFROMDATE>\s*<SVTODATE[^>]*>[^<]*</SVTODATE>', '') }
$objGuidReq = { param([string]$g) (ObjReq '99999').Replace('<ID TYPE="Name">ID:99999</ID>', '<ID TYPE="GUID">' + (LE $g) + '</ID>') }
function Lookups([string]$tag, [string]$where) {
  $o = @()
  foreach ($v in @(@{ n = 'V1'; d = '20260901'; mid = $v1mid; tag = $tag1; g = $(if ($o1 -and $o1.guid) { $o1.guid } elseif ($o1) { $o1.remoteid } else { '' }) }, @{ n = 'V2'; d = '20260902'; mid = $v2mid; tag = $tag2; g = $(if ($o2 -and $o2.guid) { $o2.guid } elseif ($o2) { $o2.remoteid } else { '' }) })) {
    if (-not $v.mid) { continue }
    for ($k = 1; $k -le 3; $k++) {
      $a = TW (& $tagReq $v.d) "$where-$($v.n)-tag-$k"; $hitT = [bool]($a.body -match [regex]::Escape($v.tag)); $nT = @([regex]::Matches((NoInfo $a.body), '<VOUCHER[ >]')).Count
      $b = TW (ObjReq $v.mid) "$where-$($v.n)-object-$k"; $hitO = [bool]($b.body -match "<MASTERID[^>]*>\s*$($v.mid)\s*<")
      $c = TW (& $byMasterReq $v.d $v.mid) "$where-$($v.n)-bymaster-$k"; $hitM = [bool]($c.body -match "<MASTERID[^>]*>\s*$($v.mid)\s*<")
      $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'FinComTag (one date, tag found in the narration)'; ms = $a.ms; inTime = $a.inTime; blocked = $a.blockedMs; found = $hitT; rows = $nT }
      $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'FinComVoucherObject (by MasterID)'; ms = $b.ms; inTime = $b.inTime; blocked = $b.blockedMs; found = $hitO; rows = 1 }
      $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'FinComByMaster (one date, $MasterID)'; ms = $c.ms; inTime = $c.inTime; blocked = $c.blockedMs; found = $hitM; rows = @([regex]::Matches((NoInfo $c.body), '<VOUCHER[ >]')).Count }
      if ($v.g) {
        $e = TW (& $byGuidDayReq $v.d $v.g) "$where-$($v.n)-PROBE-guid-day-$k"; $f = TW (& $byGuidAllReq $v.g) "$where-$($v.n)-PROBE-guid-all-$k"; $h = TW (& $objGuidReq $v.g) "$where-$($v.n)-PROBE-object-guid-$k"
        $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'PROBE by GUID, one date'; ms = $e.ms; inTime = $e.inTime; blocked = $e.blockedMs; found = [bool]($e.body -match [regex]::Escape($v.g)); rows = @([regex]::Matches((NoInfo $e.body), '<VOUCHER[ >]')).Count }
        $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'PROBE by GUID, no date'; ms = $f.ms; inTime = $f.inTime; blocked = $f.blockedMs; found = [bool]($f.body -match [regex]::Escape($v.g)); rows = @([regex]::Matches((NoInfo $f.body), '<VOUCHER[ >]')).Count }
        $o += [pscustomobject]@{ v = $v.n; k = $k; form = 'PROBE object export by GUID'; ms = $h.ms; inTime = $h.inTime; blocked = $h.blockedMs; found = [bool]($h.body -match "<MASTERID[^>]*>\s*$($v.mid)\s*<"); rows = 1 }
        if ($k -eq 1) { PSave "$where-$($v.n)-PROBE-guid-day.xml" $e.body; PSave "$where-$($v.n)-PROBE-guid-all.xml" $f.body; PSave "$where-$($v.n)-PROBE-object-guid.xml" $h.body }
      }
      if ($k -eq 1) { PSave "$where-$($v.n)-tag.xml" $a.body; PSave "$where-$($v.n)-bymaster.xml" $c.body }
    }
  }
  return , $o
}
function LookSum($rows) {
  (@($rows | Group-Object v, form | ForEach-Object { $g = $_.Group; '{0}: found {1}/{2}, worst {3} ms (all in 2 s: {4}), window held {5} ms worst, rows {6}' -f $_.Name, @($g | Where-Object found).Count, $g.Count, ($g | Measure-Object ms -Maximum).Maximum, (@($g | Where-Object { -not $_.inTime }).Count -eq 0), ($g | Measure-Object blocked -Maximum).Maximum, ($g | Measure-Object rows -Maximum).Maximum })) -join '; '
}
ProbeNote 'guid-one-date' 'harness only: FinComByMaster''s shape with the filter $GUID = "<guid>" (the id renamed P72ByGuid)' (& $byGuidDayReq '20260901' '<guid>')
ProbeNote 'guid-no-date' 'harness only: the same with no SVFROMDATE / SVTODATE' (& $byGuidAllReq '<guid>')
ProbeNote 'object-by-guid' 'harness only: FinComVoucherObject''s shape addressed <ID TYPE="GUID">' (& $objGuidReq '<guid>')
ProbeNote 'FinComTag (allowed, as built at the ref)' 'the bridge''s own FinCom id check' (& $tagReq '20260901')
ProbeNote 'FinComVoucherObject (allowed, as built at the ref)' 'the bridge''s own entry request' (ObjReq '12345')
ProbeNote 'FinComByMaster (allowed, as built at the ref)' 'the bridge''s own read-back by MasterID' (& $byMasterReq '20260901' '12345')
$lkSmall = Lookups $tag1 'small'
PJson 'lookups-small.json' $lkSmall
$vchSmall = @([regex]::Matches((NoInfo (TStop ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P72N</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="P72N" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60000 60000).body), '<VOUCHER[ >]')).Count
MLine ("lookups on the small company ({0} entries): {1}" -f $vchSmall, (LookSum $lkSmall))

# raw answers for the comparison of releases (the harness's, the same on every release)
$null = TWSave $script:dbListCo 'raw-company-list'
$null = TWSave (WithDay $script:RQ['company-check'] '20991231') 'raw-company-check'
$null = TWSave (WithRange $script:RQ['ledlist-tail'] 0 0) 'raw-ledger-list'
if ($recMid) { $null = TWSave (ObjReq $recMid) 'raw-receipt-object' }

# ===================================================================== b: the port, tally.ini, two Tallys
Say '---- proof72 b: TallyPrime''s own port screen'
$num = $folder.Name
function IniStd([string]$cs = 'Both', [int]$port = 9000, [string]$odbc = 'Yes', [string]$data = $data1, [string]$cfg = $dir) {
  $l = @('[Tally]', "Data = $data", "Config = $cfg", "LangPath = $cfg\lang", "Client Server = $cs", "ServerPort = $port", "Enable ODBC Server = $odbc", 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $num", "TDL = $tdl")
  Set-Content -Path (Join-Path $cfg 'tally.ini') -Value $l -Encoding ASCII
}
function StartTallyOn([int]$port, [string]$tag, [string]$exePath = $exe, [string]$wd = $dir) {
  $t = Start-Process -FilePath $exePath -WorkingDirectory $wd -PassThru
  $up = $false; for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; if (PortOpen $port) { $up = $true; break }; if ($t.HasExited) { break } }
  $keep = $script:tpid; $script:tpid = $t.Id
  if (-not $t.HasExited) { Start-Sleep 4; KeysTo 'a' 4; KeysTo 't' 10 "p72-$tag-started" }
  if ($port -ne 9000 -or $exePath -ne $exe) { $script:tpid = $keep }
  return [pscustomobject]@{ p = $t; up = $up }
}
DbClose
IniStd 'Server' 9000 'No'
$iniB0 = IniText; PSave 'b-ini-before-keys.txt' $iniB0
$s0 = StartTallyOn 9000 'b-keys'
FrzH 'b-port-screen'
$null = TdsGateway 'b-port'
# TallyPrime: Help (F1) > Settings > Connectivity > Client/Server configuration. Tried in turn until the screen shows the
# port field: the names typed (the menus' search), the first letters, Go To (Alt+G)
$reached = $false; $tried = @()
$ways = @(
  @{ n = 'F1, names typed'; k = @('{F1}', 'Settings{ENTER}', 'Connectivity{ENTER}', 'Client/Server{ENTER}') },
  @{ n = 'F1, letters'; k = @('{F1}', 's', 'c', 'c') },
  @{ n = 'Go To, Client/Server configuration'; k = @('%g', 'Client/Server{ENTER}') },
  @{ n = 'Go To, Connectivity'; k = @('%g', 'Connectivity{ENTER}', 'Client/Server{ENTER}') })
foreach ($w in $ways) {
  $null = TdsGateway "b-way"
  $j = 0; foreach ($k in $w.k) { $j++; KeysTo $k 3; $null = TdsScreen ("p72-b-{0}-{1}" -f ($w.n -replace '[^A-Za-z]', ''), $j) }
  $t = TdsScreen 'p72-b-form?'
  $tried += "$($w.n): '$(if ($t.Length -gt 200) { $t.Substring(0, 200) } else { $t })'"
  if ($t -match '(?i)acting as|Client/Server Config|Enable ODBC' -and $t -match '(?i)port') { $reached = $true; $wayUsed = $w.n; break }
}
$formTxt = ''; $iniB1 = ''; $iniB2 = ''; $up9100 = $false; $restartTxt = ''
if ($reached) {
  $formTxt = TdsScreen 'p72-b-form'
  PSave 'b-form-ocr.txt' $formTxt
  # acts as Both, ODBC Yes, port 9100 (each field: typed, Enter); the screen read after each
  KeysTo 'Both{ENTER}' 2; $null = TdsScreen 'p72-b-f1'
  KeysTo 'Yes{ENTER}' 2; $null = TdsScreen 'p72-b-f2'
  $t = TdsScreen 'p72-b-f3pre'
  KeysTo '9100{ENTER}' 2; $null = TdsScreen 'p72-b-f3'
  KeysTo '^a' 4; $t = TdsScreen 'p72-b-accepted'
  $restartTxt = $t
  if ($t -match '(?i)restart') { KeysTo 'y' 15; $restartTxt += ' -> y' }
  Start-Sleep 5
  $iniB1 = IniText; PSave 'b-ini-after-keys.txt' $iniB1
}
$owner9100 = PortOwner 9100; $up9100 = PortOpen 9100
# Tally closed and started again with the file as Tally left it: does it answer on 9100
$newT = @(Get-Process tally -ErrorAction SilentlyContinue)
foreach ($t in $newT) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
$iniB2 = IniText; PSave 'b-ini-after-close.txt' $iniB2
$s1 = StartTallyOn 9100 'b-9100'; $script:tpid = $s1.p.Id
$ans9100 = CoListAt 9100; $ans9000 = PortOpen 9000
$p4txt = "tally.ini before (harness): [{0}]; reached the screen: {1} ({2}); tally.ini changed by TallyPrime's screen: {3}; keys after: [{4}]; after Tally closed: [{5}]; port 9100 listening right after the save: {6} ({7}); restarted on that file: 9100 answers '{8}', 9000 open {9}; tried: {10}" -f `
  (IniKeys $iniB0), $reached, $wayUsed, $(if ($iniB1) { IniDiff $iniB0 $iniB1 } else { '(not reached)' }), (IniKeys $iniB1), (IniKeys $iniB2), $up9100, $owner9100, $ans9100, $ans9000, ($tried -join ' || ')
PRes $P4 $(if ($reached -and $iniB1 -and $iniB1 -ne $iniB0) { 'PASS' } else { 'HARNESS' }) $p4txt

# p5: the bridge's way (if the owner allows it): the port written with Tally closed
Say '---- proof72 b: a port written into tally.ini with Tally closed'
foreach ($t in @(Get-Process tally -ErrorAction SilentlyContinue)) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
IniStd 'Both' 9102 'Yes'; $iniW = IniText
$s2 = StartTallyOn 9102 'b-9102'; $script:tpid = $s2.p.Id
$ans9102 = CoListAt 9102; $o9000 = PortOpen 9000
Start-Sleep 3; $iniW2 = IniText
foreach ($t in @(Get-Process tally -ErrorAction SilentlyContinue)) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
$iniW3 = IniText
# Client Server = None with the port: does the port answer at all
IniStd 'None' 9103 'Yes'
$s3 = StartTallyOn 9103 'b-none'; $script:tpid = $s3.p.Id
$none9103 = PortOpen 9103; $noneAns = if ($none9103) { CoListAt 9103 } else { 'port closed' }
foreach ($t in @(Get-Process tally -ErrorAction SilentlyContinue)) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
PRes $P5 $(if ($s2.up -and $ans9102 -match [regex]::Escape($coOrig)) { 'PASS' } else { 'FAIL' }) ("written with Tally closed: Client Server = Both, ServerPort = 9102, Enable ODBC Server = Yes; at start 9102 answered '{0}', 9000 open {1}; the file unchanged by Tally while it ran: {2}, after it closed: {3}. With Client Server = None (port 9103): port open {4}, '{5}'" -f $ans9102, $o9000, ($iniW2 -eq $iniW), ($iniW3 -eq $iniW), $none9103, $noneAns)

# p6: the same install started twice (one tally.ini: both want port 9000); then a copy of the install on port 9001 over
# a copy of the data folder (c: the copy's GUID)
Say '---- proof72 b: two Tallys on one computer'
IniStd 'Both' 9000 'Yes'
$sA = StartTallyOn 9000 'b-twoA'; $script:tpid = $sA.p.Id
$coA1 = CoListAt 9000
$tB = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
Start-Sleep 25; $bAlive = -not $tB.HasExited; $bWin = if ($bAlive) { (Get-Process -Id $tB.Id -ErrorAction SilentlyContinue).MainWindowTitle } else { '' }
$sc = TdsScreen 'p72-b-same-install-twice'
$own = PortOwner 9000; $coA2 = CoListAt 9000
$sameTwice = "the second start of the same install (pid {0}): alive after 25 s {1}, window '{2}', exit code {3}; port 9000 listener(s): {4} (first Tally pid {5}); 9000 answers '{6}'; screen: '{7}'" -f $tB.Id, $bAlive, $bWin, $(if ($tB.HasExited) { $tB.ExitCode } else { '-' }), $own, $sA.p.Id, $coA2, $(if ($sc.Length -gt 200) { $sc.Substring(0, 200) } else { $sc })
if ($bAlive) { Stop-Process -Id $tB.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep 3
Stop-Process -Id $sA.p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 3
# the copy of the data folder (Tally closed) and a copy of the install on 9001
$data2 = "$env:RUNNER_TEMP\TallyData2"; New-Item -ItemType Directory -Force $data2 | Out-Null
Copy-Item -Path (Join-Path $data1 $num) -Destination $data2 -Recurse -Force
$dir2 = 'C:\fcspike\tally2'
if (-not (Test-Path (Join-Path $dir2 (Split-Path $exe -Leaf)))) { & robocopy.exe $dir $dir2 /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null }
IniStd 'Both' 9000 'Yes'
IniStd 'Both' 9001 'Yes' $data2 $dir2
$sA = StartTallyOn 9000 'b-copyA'; $script:tpid = $sA.p.Id
$sB = StartTallyOn 9001 'b-copyB' (Join-Path $dir2 (Split-Path $exe -Leaf)) $dir2
$ansA = CoListAt 9000; $ansB = CoListAt 9001
$gA = [regex]::Match($ansA, 'GUID (\S+)').Groups[1].Value; $gB = [regex]::Match($ansB, 'GUID (\S+)').Groups[1].Value
$copyTxt = "a copy of the data folder ({0}) opened by a second Tally (a copy of the install, port 9001) beside the first (9000): 9000 '{1}', 9001 '{2}'; same GUID: {3}" -f (Join-Path $data2 $num), $ansA, $ansB, ($gA -and $gA -eq $gB)
PRes $P6 $(if ($sB.up -and $ansB -match 'GUID') { 'PASS' } else { 'FAIL' }) ("{0}. Copy of the install on 9001: started {1}, answers '{2}'; the first on 9000 '{3}'" -f $sameTwice, $sB.up, $ansB, $ansA)
PRes $P7 $(if ($cRen -and $gA) { 'PASS' } else { 'HARNESS' }) ("{0}; {1}; {2}" -f $renTxt, $bridgeRen, $copyTxt)
Stop-Process -Id $sB.p.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $sA.p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 3

# ===================================================================== q: Tally on port 4125 (the owner's report, 26-Oct)
Say '---- proof72 q: Tally on port 4125, the published bridge 2.4.7 with TallyPorts auto / 9000 / 4125'
IniStd 'Both' 4125 'Yes'; $iniQ = IniText; PSave 'q-tally-ini.txt' $iniQ
$sQ = StartTallyOn 4125 'q-4125'; $script:tpid = $sQ.p.Id
$qAns = CoListAt 4125; $qOwner = PortOwner 4125
$cfgPath = "$h1\tds-bridge.config.json"
$bMain = @($bProcs | Where-Object { $_.CommandLine -notmatch '(?i)\btray\b' } | Select-Object -First 1)[0]; if (-not $bMain) { $bMain = @($bProcs)[0] }
function BridgeStart {
  if (-not $bMain) { return $false }
  $cl = "$($bMain.CommandLine)"; $exeQ = "$($bMain.ExecutablePath)"
  $argsQ = if ($cl.StartsWith('"')) { $cl.Substring($cl.IndexOf('"', 1) + 1).Trim() } else { ($cl -split '\s+', 2)[1] }
  if ($argsQ) { Start-Process -FilePath $exeQ -ArgumentList $argsQ -WorkingDirectory (Split-Path $exeQ) | Out-Null } else { Start-Process -FilePath $exeQ -WorkingDirectory (Split-Path $exeQ) | Out-Null }
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep 2; if (Bridge GET '/status' $null 10) { return $true } }
  return $false
}
$qRows = @()
foreach ($qc in @(@{ n = 'auto'; v = 'auto' }, @{ n = '9000'; v = @(9000) }, @{ n = '4125'; v = @(4125) })) {
  Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  try { $cj = Get-Content $cfgPath -Raw | ConvertFrom-Json; $cj | Add-Member -NotePropertyName TallyPorts -NotePropertyValue $qc.v -Force; $null = $cj.PSObject.Properties.Remove('TallyHost')
    [IO.File]::WriteAllText($cfgPath, ($cj | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false)) } catch { Info "q: settings not written: $_" }
  $upQ = BridgeStart
  Start-Sleep 5
  $qs = Bridge GET '/status?fresh=1' $null 60; $qco = Bridge GET '/companies' $null 60; $qk = Bridge POST '/tray/check' @{} 90; $qd = Bridge GET '/diagnose' $null 60
  PJson "q-$($qc.n)-status.json" $qs; PJson "q-$($qc.n)-companies.json" $qco; PJson "q-$($qc.n)-traycheck.json" $qk; PJson "q-$($qc.n)-diagnose.json" $qd
  $qt = $qk.tally
  $qRows += ("TallyPorts {0}: bridge up {1}; port plan '{2}'; /companies [{3}]; Test connection (/tray/check): tally ok {4}, ports [{5}], companies [{6}], error '{7}'; diagnosis: {8}; Tally seen by Windows: {9}" -f `
    $qc.n, $upQ, $qs.mode, ((@($qco.companies | ForEach-Object { "$($_.name) port $($_.port)" })) -join '; '), $qt.ok, ((@($qt.ports)) -join ','), ((@($qt.companies)) -join ','), $qt.error,
    ((@($qd.findings | ForEach-Object { "[$($_.level)] $($_.text) FIX: $($_.fix)" })) -join ' / '), ((@($qd.tallies | ForEach-Object { "pid $($_.pid) ports [$((@($_.ports)) -join ',')] ini port $($_.ini.port) mode $($_.ini.mode)" })) -join '; '))
}
Copy-Item $blog (Join-Path $p72 'bridge-q.log') -ErrorAction SilentlyContinue
Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force
$qConn = @($qRows | Where-Object { $_ -match 'port 4125' })
PRes $P12 $(if (-not $sQ.up) { 'HARNESS' } elseif (@($qRows | Select-Object -First 1)[0] -match '/companies \[[^\]]*port 4125') { 'PASS' } else { 'FAIL' }) ("Tally on 4125 (tally.ini [{0}]): 4125 answers '{1}' (listener {2}); {3}" -f (IniKeys $iniQ), $qAns, $qOwner, ($qRows -join ' || '))
foreach ($t in @(Get-Process tally -ErrorAction SilentlyContinue)) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep 3

# ===================================================================== d' on ZZ BIG TEST (~30,000 entries)
Say '---- proof72: ZZ BIG TEST (~30,000 entries) and the lookups again'
IniStd 'Both' 9000 'Yes'
$up = DbRestart 'big'
FrzH 'big-load'; $script:frz.on = $false   # the loading is the harness's, not measured
$mk = if ($up) { DbMakeData } else { 'Tally not up' }
Info "proof72 big: $mk"
$nBig = @([regex]::Matches((NoInfo (TStop ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P72N</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="P72N" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 600000 600000).body), '<VOUCHER[ >]')).Count
$lkBig = if ($up) { Lookups $tag1 'big' } else { @() }
PJson 'lookups-big.json' $lkBig
MLine ("lookups on ZZ BIG TEST ({0} entries in the company; {1}): {2}" -f $nBig, $mk, (LookSum $lkBig))
$allowedRows = @(@($lkSmall) + @($lkBig) | Where-Object { $_.form -notlike 'PROBE*' })
$slow = @($allowedRows | Where-Object { -not $_.inTime })
PRes $P9 $(if ($lkBig.Count -and $nBig -ge 25000 -and $slow.Count -eq 0 -and @($allowedRows | Where-Object { $_.form -like 'FinComVoucherObject*' -and -not $_.found }).Count -eq 0) { 'PASS' } elseif (-not $lkBig.Count -or $nBig -lt 25000) { 'HARNESS' } else { 'FAIL' }) `
  ("small company ({0} entries): {1} || ZZ BIG TEST ({2} entries): {3}" -f $vchSmall, (LookSum $lkSmall), $nBig, (LookSum $lkBig))

# ===================================================================== f: the window and the bridge's requests
$script:frz.stop = $true; Start-Sleep 1
$spans = @($script:frz.spans)
$reqOver = @($script:reqRows | Where-Object { $_.overrun -or $_.hung })
PJson 'harness-requests.json' $script:reqRows
PRes $P11 $(if (-not $script:frzOk) { 'HARNESS' } elseif ($spans.Count -eq 0 -and $pxOver.Count -eq 0) { 'PASS' } else { 'FAIL' }) `
  ("window probe {0} beats; holds of 1 s or more: {1}; longest hold {2} ms (during {3}); the bridge's requests at the proxy: {4} in all, over 2 s: {5}{6}, two at Tally at once: {7}; by id: {8}; the harness's measured requests over 2 s: {9}" -f `
    $script:frz.beats, $(if ($spans.Count) { $spans -join '; ' } else { 'none' }), [int]$script:frz.gmax, $script:frz.gtag, $px.Count, $pxOver.Count, $(if ($pxMax) { " (longest $($pxMax.id) $($pxMax.ms) ms)" } else { '' }), $ov, $pxIds,
    $(if ($reqOver.Count) { ($reqOver | ForEach-Object { "$($_.label) $($_.ms) ms" }) -join ', ' } else { 'none' }))
Copy-Item (Join-Path $dir 'tally.ini') (Join-Path $p72 'tally-ini-end.txt') -ErrorAction SilentlyContinue
if ($script:tdsLog) { $script:tdsLog | Set-Content (Join-Path $p72 'screens-ocr.txt') -Encoding UTF8 }
