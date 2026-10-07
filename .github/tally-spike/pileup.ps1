# The busy-Tally measurements for the next release (input only=pileup), dot-sourced by flow4.ps1 (KeysTo, Post, Vouchers,
# DayBook, StubLines, Mark, Say, Result, Shot, $B, $co1, $rec, $out, $resultsFile, $script:tallyPids).
#   A  Tally 9000 held busy 5 minutes (its process suspended) with 10 entries waiting (recorder lines in the add-on's own
#      format for 10 imported receipts, written while Tally is held: a frozen Tally cannot save); every connection to port
#      9000 with its time and process (tcplog.ps1, the TCP table every 20 ms; the bridge opens one connection per request);
#      the pause the user sees when Tally is free: from the resume to Tally's window answering a message, and to a key
#      (F2 in the Day Book: the Change Date box) changing the screen.
#   B  does Tally finish a request the client gave up on (the 2 s stop closes the connection), and the one queued behind it:
#      a large ledger import (about 30 s by a timed 500-ledger import first) dropped at 2 s, a one-ledger import queued
#      behind it (also dropped at 2 s), then a small request timed; Tally's CPU time; then the ledgers counted. The same with
#      a slow export.
#   B3 (next-inflight, 07-Oct-2026): the same large import given up at 2 s with the connection KEPT open, as the bridge on
#      next-inflight does (it waits up to 20 s more for Tally to finish, then backs off, and never sends anything else
#      before the answer): when Tally answers it on that connection (after the stop), what it made, and how fast the next
#      request is answered after it.
$PU = @{ dir = Join-Path $out 'pileup' }
New-Item -ItemType Directory -Force $PU.dir | Out-Null
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class PuW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, IntPtr l, uint f, uint ms, out UIntPtr r);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  public static bool Responds(IntPtr h, uint ms) { UIntPtr r; return SendMessageTimeout(h, 0, UIntPtr.Zero, IntPtr.Zero, 0, ms, out r) != IntPtr.Zero; }
  public static void PostKey(IntPtr h, int vk) { PostMessage(h, 0x100, (IntPtr)vk, (IntPtr)1); PostMessage(h, 0x101, (IntPtr)vk, unchecked((IntPtr)(int)0xC0000001)); }
  public static void Key(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); keybd_event((byte)vk, 0, 2, UIntPtr.Zero); }
  // the share of pixels that differ (sum of the three colour differences over 30), every second pixel
  public static double Diff(byte[] a, byte[] b) {
    if (a == null || b == null || a.Length != b.Length) return 1.0;
    long n = 0, d = 0;
    for (int i = 0; i + 3 < a.Length; i += 8) { n++; int s = Math.Abs(a[i] - b[i]) + Math.Abs(a[i + 1] - b[i + 1]) + Math.Abs(a[i + 2] - b[i + 2]); if (s > 30) d++; }
    return n == 0 ? 0 : (double)d / n;
  }
}
'@
Add-Type -AssemblyName System.Drawing
function PuMs($t0) { [int]((Get-Date) - $t0).TotalMilliseconds }
function PuMeasure($m) { Write-Host "######## MEASURE $m"; Add-Content -Path $resultsFile -Encoding UTF8 -Value "MEASURE $m" }
# the Tally window's pixels (and the bitmap, to keep as a picture when asked)
function PuCap([IntPtr]$h, [string]$save = '') {
  $r = New-Object PuW+RECT; $null = [PuW]::GetWindowRect($h, [ref]$r)
  $w = [Math]::Max(1, $r.R - $r.L); $hh = [Math]::Max(1, $r.B - $r.T)
  $bmp = New-Object System.Drawing.Bitmap $w, $hh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size); $g.Dispose()
  $bd = $bmp.LockBits([System.Drawing.Rectangle]::new(0, 0, $w, $hh), 'ReadOnly', $bmp.PixelFormat)
  $bytes = New-Object byte[] ($bd.Stride * $hh); [Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length); $bmp.UnlockBits($bd)
  if ($save) { $bmp.Save((Join-Path $env:SHOTS "pu-$save.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose(); return , $bytes
}
function PuLogStart($name) {
  $f = Join-Path $PU.dir "$name-tcp.txt"; $s = "$f.stop"; Remove-Item $s -ErrorAction SilentlyContinue
  $p = Start-Process pwsh -ArgumentList '-NoProfile', '-File', "`"$PSScriptRoot\tcplog.ps1`"", '9000', "`"$f`"", "`"$s`"" -PassThru -WindowStyle Hidden
  Start-Sleep 2; return [pscustomobject]@{ file = $f; stop = $s; p = $p }
}
function PuLogStop($o) {
  New-Item -ItemType File -Force $o.stop | Out-Null
  if (-not $o.p.WaitForExit(5000)) { Stop-Process -Id $o.p.Id -Force -ErrorAction SilentlyContinue }
}
# the connections first seen between two times: [time, client port, process]
function PuConns($o, [datetime]$from, [datetime]$to) {
  @(Get-Content $o.file -ErrorAction SilentlyContinue | ForEach-Object {
      $m = [regex]::Match($_, '^(\d\d:\d\d:\d\d\.\d{3}) NEW (\S+) pid=(\d+) (\S*)')
      if ($m.Success) { $t = [datetime]::ParseExact($m.Groups[1].Value, 'HH:mm:ss.fff', $null); $t = (Get-Date).Date.Add($t.TimeOfDay)
        if ($t -ge $from -and $t -le $to) { [pscustomobject]@{ at = $m.Groups[1].Value; key = $m.Groups[2].Value; pid = [int]$m.Groups[3].Value; proc = $m.Groups[4].Value } } } })
}
function PuByProc($l) { (@($l) | Group-Object proc | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', ' }
function PuBridgeLog([datetime]$from) {
  @(Get-Content $B[1].log -ErrorAction SilentlyContinue | Where-Object { $_ -match '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)' -and [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null) -ge $from.AddSeconds(-1) })
}

function PileA {
  Say '---- A: Tally 9000 busy 5 minutes with 10 entries waiting'
  $null = Post 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="R1 Income" ACTION="Create"><NAME.LIST><NAME>R1 Income</NAME></NAME.LIST><PARENT>Indirect Incomes</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'PU ledger'
  $pre = Vouchers 9000 $co1
  $msg = (1..10 | ForEach-Object { '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260901</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><NARRATION>PU entry ' + $_ + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>R1 Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + (100 + $_) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + (100 + $_) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' }) -join ''
  $null = Post 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 'PU 10 receipts'
  $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) } | Sort-Object mid)
  if ($nv.Count -lt 10) { Result 'A pile-up' $false "only $($nv.Count) of the 10 receipts made in Tally" $true; return }
  $cg = ([regex]::Match((ListCo 9000), '(?s)NAME="' + [regex]::Escape($co1) + '".*?<GUID[^>]*>([^<]+)<').Groups[1].Value).Trim()
  $rf = Get-ChildItem $rec -Filter "$cg-*.txt" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $rfile = if ($rf) { $rf.FullName } else { Join-Path $rec ("$cg-" + (Get-Date).ToString('d-MMM-yy', [Globalization.CultureInfo]::InvariantCulture) + '.txt') }
  Write-Host "PU: company GUID $cg; the add-on's file $rfile"
  # the screen: the Day Book of 1-9-2026 (the 10 receipts), Tally in front; its normal answer to F2 timed first
  $tp = Get-Process -Id $script:tallyPids[9000]; $h = $tp.MainWindowHandle
  DayBook 'pu' '1-9-2026'
  $base = PuCap $h 'a-0-before'; $noise = 0.0
  for ($i = 0; $i -lt 4; $i++) { Start-Sleep -Milliseconds 300; $noise = [Math]::Max($noise, [PuW]::Diff($base, (PuCap $h))) }
  $thr = [Math]::Max(0.004, 3 * $noise)
  $how = 'PostMessage'
  $t = Get-Date; [PuW]::PostKey($h, 0x71); $norm = -1
  while ((PuMs $t) -lt 4000) { $d = [PuW]::Diff($base, (PuCap $h)); if ($d -gt $thr -and $d -lt 0.6) { $norm = PuMs $t; break } }
  if ($norm -lt 0) {
    $how = 'keybd_event'; [PuW]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 500
    $t = Get-Date; [PuW]::Key(0x71)
    while ((PuMs $t) -lt 4000) { $d = [PuW]::Diff($base, (PuCap $h)); if ($d -gt $thr -and $d -lt 0.6) { $norm = PuMs $t; break } }
  }
  $null = PuCap $h 'a-1-f2-normal'
  KeysTo 9000 '{ESC}' 2; $base = PuCap $h 'a-2-baseline'
  Write-Host "PU: noise $noise, threshold $thr; F2 by $how answered on the screen in $norm ms (Tally not busy)"
  $log = PuLogStart 'a'; $m0 = Mark
  # held: the process suspended (as a long report or import holds Tally's one thread: nothing answered, the window frozen)
  $null = [PuW]::NtSuspendProcess($tp.Handle); $tHold = Get-Date
  Write-Host "PU: Tally 9000 (pid $($tp.Id)) held at $($tHold.ToString('HH:mm:ss.fff'))"
  Start-Sleep 1
  $now = (Get-Date).ToString('d-MMM-yy HH:mm', [Globalization.CultureInfo]::InvariantCulture)
  $txt = ($nv | ForEach-Object { $v = $_; foreach ($ev in 'voucher_accept_pre', 'voucher_accept_post') { "FCR1|ev=$ev|t0=$now|tw=$now|cguid=$cg|cname=$co1|user=TALLY User|obj=Voucher|guid=$($v.guid)|mid=$($v.mid)|aid=$($v.aid)|vtype=Receipt|vno=$($v.vno)|vdate=1-Sep-26|name=|parent=|narr=|t1=$now|src=live`r`n" } }) -join ''
  $enc = [Text.UnicodeEncoding]::new($false, $false)
  if (-not (Test-Path $rfile)) { [IO.File]::WriteAllBytes($rfile, [byte[]](0xFF, 0xFE)) }
  [IO.File]::AppendAllText($rfile, $txt, $enc); $tLines = Get-Date
  Write-Host "PU: 20 lines (10 entries, pre and post) added to the add-on's file at $($tLines.ToString('HH:mm:ss.fff'))"
  while ((Get-Date) -lt $tHold.AddSeconds(300)) { Start-Sleep 5 }
  # free: resumed; the key at once; the window's first answer to a message and the screen's change timed from here
  $null = [PuW]::NtResumeProcess($tp.Handle); $tFree = Get-Date
  if ($how -eq 'PostMessage') { [PuW]::PostKey($h, 0x71) } else { [PuW]::Key(0x71) }
  $tMsg = -1; $tScr = -1; $first = $true; $maxD = 0; $hung0 = [PuW]::IsHungAppWindow($h)
  while ((PuMs $tFree) -lt 120000 -and $tScr -lt 0) {
    if ($tMsg -lt 0 -and [PuW]::Responds($h, 50)) { $tMsg = PuMs $tFree }
    $c = PuCap $h $(if ($first) { 'a-3-first-after-free' } else { '' }); $first = $false
    $d = [PuW]::Diff($base, $c); $maxD = [Math]::Max($maxD, $d)
    if ($d -gt $thr -and $d -lt 0.6) { $tScr = PuMs $tFree; $null = PuCap $h 'a-4-screen-answered' }
  }
  if ($tScr -lt 0 -and $how -eq 'PostMessage') {
    # the posted key lost (a ghost window while Tally was held): the same key pressed for real once Tally answers
    [PuW]::SetForegroundWindow($h) | Out-Null; $t2 = Get-Date; [PuW]::Key(0x71)
    while ((PuMs $t2) -lt 20000) { $d = [PuW]::Diff($base, (PuCap $h)); if ($d -gt $thr -and $d -lt 0.6) { $tScr = PuMs $tFree; $how += ' (lost; then keybd_event)'; break } }
  }
  Write-Host "PU: freed $($tFree.ToString('HH:mm:ss.fff')); hung flag at free $hung0; message answered after $tMsg ms; screen answered the key after $tScr ms (max diff $maxD)"
  KeysTo 9000 '{ESC}' 2 'pu-a-after'
  # the 10 entries at the stub
  $want = @{}; foreach ($v in $nv) { $want[$v.guid] = $null }
  $until = $tFree.AddMinutes(10)
  while ((Get-Date) -lt $until -and @($want.Values | Where-Object { -not $_ }).Count) {
    foreach ($l in (StubLines $m0)) { if ($l.xml -and $want.ContainsKey($l.guid) -and -not $want[$l.guid]) { $want[$l.guid] = $l.at } }
    Start-Sleep 5
  }
  $tEnd = Get-Date; Start-Sleep 20; PuLogStop $log
  Copy-Item $log.file (Join-Path $out 'pileup-a-tcp.txt') -ErrorAction SilentlyContinue
  $held = PuConns $log $tHold $tFree; $after = PuConns $log $tFree $tEnd.AddSeconds(20)
  $bl = PuBridgeLog $tHold; Set-Content (Join-Path $PU.dir 'a-bridge1-log.txt') $bl -Encoding UTF8
  $arr = @($nv | ForEach-Object { "$($_.mid)@$(if ($want[$_.guid]) { $want[$_.guid] } else { 'NOT' })" })
  PuMeasure ("A requests to Tally 9000 while held {0}..{1} (300 s, 10 entries waiting): {2} connection(s) ({3}): {4}" -f $tHold.ToString('HH:mm:ss.fff'), $tFree.ToString('HH:mm:ss.fff'), $held.Count, (PuByProc $held), (($held | ForEach-Object { "$($_.at) $($_.proc)" }) -join ', '))
  PuMeasure ("A requests after Tally was free, until the 10 entries were in (to {0}): {1} ({2}): {3}" -f $tEnd.ToString('HH:mm:ss'), $after.Count, (PuByProc $after), (($after | ForEach-Object { "$($_.at) $($_.proc)" }) -join ', '))
  PuMeasure ("A the pause the user sees: Tally's window answered a message {0} ms after it was free; the screen answered the key (F2, {1}) {2} ms after it was free (the same key when Tally was not busy: {3} ms); window hung flag at the moment it was freed: {4}; pictures pu-a-*" -f $tMsg, $how, $tScr, $norm, $hung0)
  PuMeasure ("A the 10 entries at the stub (MasterID@time): {0}" -f ($arr -join ', '))
  PuMeasure ("A bridge 1's log while held and after: {0}" -f ((@($bl | Where-Object { $_ -match 'Tally 9000|busy|small check|did not answer|answers again|Recorder' } | Select-Object -First 25 | ForEach-Object { $_.Substring(11) })) -join ' | '))
}

# a request given up on after $ms (the connection closed by the client), as the bridge's 2 s stop does
function PuAbandon([string]$body, [int]$ms) {
  $hd = [System.Net.Http.HttpClientHandler]::new(); $hd.UseProxy = $false
  $hc = [System.Net.Http.HttpClient]::new($hd); $hc.Timeout = [TimeSpan]::FromMilliseconds($ms)
  $sw = [Diagnostics.Stopwatch]::StartNew(); $sent = Get-Date
  try { $r = $hc.PostAsync('http://127.0.0.1:9000/', [System.Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'text/xml')).GetAwaiter().GetResult(); $a = "answered $([int]$r.StatusCode)" } catch { $a = "given up ($($_.Exception.GetType().Name))" }
  $sw.Stop(); $hc.Dispose()
  [pscustomobject]@{ sent = $sent; ms = $sw.ElapsedMilliseconds; result = $a }
}
# a request the client stops waiting for but keeps open (next-inflight): sent now, its answer read later
function PuKeep([string]$body) {
  $hd = [System.Net.Http.HttpClientHandler]::new(); $hd.UseProxy = $false
  $hc = [System.Net.Http.HttpClient]::new($hd); $hc.Timeout = [TimeSpan]::FromSeconds(900)
  $sent = Get-Date; $sw = [Diagnostics.Stopwatch]::StartNew()
  $task = $hc.PostAsync('http://127.0.0.1:9000/', [System.Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'text/xml'))
  [pscustomobject]@{ hc = $hc; task = $task; sent = $sent; sw = $sw }
}
function PuKeepEnd($k) {
  try { $r = $k.task.GetAwaiter().GetResult(); $txt = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult(); $a = "answered $([int]$r.StatusCode)" } catch { $txt = ''; $a = "failed ($($_.Exception.GetType().Name))" }
  $k.sw.Stop(); $k.hc.Dispose()
  [pscustomobject]@{ ms = $k.sw.ElapsedMilliseconds; result = $a; created = [regex]::Match($txt, '<CREATED>(\d+)</CREATED>').Groups[1].Value }
}
function PuTimed([string]$body, [int]$sec = 900) {
  $sw = [Diagnostics.Stopwatch]::StartNew(); $sent = Get-Date
  try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content; $ok = $true } catch { $c = ''; $ok = $false }
  $sw.Stop(); [pscustomobject]@{ sent = $sent; ms = $sw.ElapsedMilliseconds; ok = $ok; text = "$c" }
}
function PuImpLedgers([string]$prefix, [int]$n) {
  $l = New-Object System.Text.StringBuilder
  for ($i = 1; $i -le $n; $i++) { $nm = '{0} {1:d5}' -f $prefix, $i; $null = $l.Append("<LEDGER NAME=`"$nm`" ACTION=`"Create`"><NAME.LIST><NAME>$nm</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>No</ISBILLWISEON></LEDGER>") }
  '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $l.ToString() + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
}
function PuCount([string]$prefix) {
  $x = (PuTimed ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PUC</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PUC" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name</FETCH><FILTERS>PUCF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="PUCF">$Name Starting With "' + $prefix + '"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 600).text
  [pscustomobject]@{ numbered = ([regex]::Matches($x, 'NAME="' + [regex]::Escape($prefix) + ' \d{5}"')).Count; queued = ($x -match ('NAME="' + [regex]::Escape($prefix) + ' queued"')) }
}
$puSmall = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PUS</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PUS" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function PuQueued([string]$prefix) { '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="' + $prefix + ' queued" ACTION="Create"><NAME.LIST><NAME>' + $prefix + ' queued</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>' }
# Tally's CPU time, sampled each second on its own thread until $sec
function PuCpuStart([int]$tpid, [int]$sec) {
  Start-ThreadJob -ArgumentList $tpid, $sec -ScriptBlock { param($p, $s)
    $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $s) { $q = Get-Process -Id $p -ErrorAction SilentlyContinue; if ($q) { [pscustomobject]@{ at = (Get-Date).ToString('HH:mm:ss.fff'); cpu = $q.TotalProcessorTime.TotalMilliseconds } }; Start-Sleep -Milliseconds 1000 } }
}
function PuCpuText($samples, [datetime]$from, [datetime]$to) {
  $s = @($samples | Where-Object { $t = (Get-Date).Date.Add([datetime]::ParseExact($_.at, 'HH:mm:ss.fff', $null).TimeOfDay); $t -ge $from -and $t -le $to })
  if ($s.Count -lt 2) { return 'no samples' }
  $busy = [int]($s[-1].cpu - $s[0].cpu); $wall = [int]((Get-Date).Date.Add([datetime]::ParseExact($s[-1].at, 'HH:mm:ss.fff', $null).TimeOfDay) - (Get-Date).Date.Add([datetime]::ParseExact($s[0].at, 'HH:mm:ss.fff', $null).TimeOfDay)).TotalMilliseconds
  "Tally used $busy ms of CPU in $wall ms ($($s[0].at)..$($s[-1].at))"
}

function PileB {
  Say '---- B: does Tally finish a request the client gave up on, and the one queued behind it'
  $tp = Get-Process -Id $script:tallyPids[9000]
  $c0 = PuTimed (PuImpLedgers 'PUB0' 500) 600
  $per = [Math]::Max(1, $c0.ms) / 500.0
  $n = [int][Math]::Min(40000, [Math]::Max(1000, [Math]::Round(30000 / $per)))
  PuMeasure ("B the timing import: 500 ledgers in one request took {0} ms when waited for ({1:n1} ms a ledger); the large import: {2} ledgers, about {3:n0} s expected" -f $c0.ms, $per, $n, ($n * $per / 1000))
  $log = PuLogStart 'b'
  # B1: the large import given up on at 2 s, a one-ledger import queued behind it (also given up at 2 s), a small request
  $body = PuImpLedgers 'PUB1' $n
  $cpu = PuCpuStart $tp.Id 900
  $a1 = PuAbandon $body 2000; $tAb = Get-Date
  $q1 = PuAbandon (PuQueued 'PUB1') 2000
  $p1 = PuTimed $puSmall 900; $tAns = Get-Date
  $cnt = PuCount 'PUB1'
  Start-Sleep 2; Stop-Job $cpu -ErrorAction SilentlyContinue; $smp = @(Receive-Job $cpu -ErrorAction SilentlyContinue); Remove-Job $cpu -Force -ErrorAction SilentlyContinue
  PuMeasure ("B1 large import ({0} ledgers, {1:n0} KB): sent {2}, the client gave up after {3} ms ({4}); a one-ledger import queued behind it: {5} after {6} ms; a small request sent {7} answered after {8} ms (at {9}); {10}; afterwards Tally holds {11} of the {0} ledgers of the given-up import and the queued ledger: {12}" -f `
    $n, ($body.Length / 1KB), $a1.sent.ToString('HH:mm:ss.fff'), $a1.ms, $a1.result, $q1.result, $q1.ms, $p1.sent.ToString('HH:mm:ss.fff'), $p1.ms, $tAns.ToString('HH:mm:ss.fff'), (PuCpuText $smp $a1.sent $tAns), $cnt.numbered, $cnt.queued)
  # B2: a slow export (every ledger, FETCH *), its time waited for first; then given up at 2 s, an import queued, a small request
  $exp = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PUE</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PUE" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $d2 = PuTimed $exp 900
  $cpu = PuCpuStart $tp.Id 900
  $a2 = PuAbandon $exp 2000
  $q2 = PuAbandon (PuQueued 'PUB2') 2000
  $p2 = PuTimed $puSmall 900; $tAns2 = Get-Date
  $cnt2 = PuCount 'PUB2'
  Start-Sleep 2; Stop-Job $cpu -ErrorAction SilentlyContinue; $smp2 = @(Receive-Job $cpu -ErrorAction SilentlyContinue); Remove-Job $cpu -Force -ErrorAction SilentlyContinue
  PuMeasure ("B2 slow export (every ledger, FETCH *): {0} ms and {1:n0} KB when waited for; given up after {2} ms ({3}); a one-ledger import queued behind it: {4}; a small request sent {5} answered after {6} ms; {7}; the queued ledger in Tally afterwards: {8}" -f `
    $d2.ms, ($d2.text.Length / 1KB), $a2.ms, $a2.result, $q2.result, $p2.sent.ToString('HH:mm:ss.fff'), $p2.ms, (PuCpuText $smp2 $a2.sent $tAns2), $cnt2.queued)
  # B3: kept open (next-inflight): the client stops waiting at 2 s but keeps the connection; nothing else is sent until
  # Tally answers it; then the next request
  $body3 = PuImpLedgers 'PUB3' $n
  $cpu = PuCpuStart $tp.Id 900
  $k3 = PuKeep $body3
  Start-Sleep -Milliseconds 2000; $tStop3 = Get-Date
  $e3 = PuKeepEnd $k3; $tDone3 = Get-Date
  $p3 = PuTimed $puSmall 900; $tAns3 = Get-Date
  $cnt3 = PuCount 'PUB3'
  Start-Sleep 2; Stop-Job $cpu -ErrorAction SilentlyContinue; $smp3 = @(Receive-Job $cpu -ErrorAction SilentlyContinue); Remove-Job $cpu -Force -ErrorAction SilentlyContinue
  $after3 = [int]($tDone3 - $tStop3).TotalMilliseconds
  PuMeasure ("B3 kept open (next-inflight): large import ({0} ledgers) sent {1}; the client stopped waiting at 2 s ({2}) and kept the connection; Tally answered it on that connection after {3} ms ({4}, CREATED {5}), {6} ms after the stop ({7} the bridge's 20 s wait); the next request (small) sent right after was answered in {8} ms (at {9}); {10}; Tally holds {11} of the {0} ledgers" -f `
    $n, $k3.sent.ToString('HH:mm:ss.fff'), $tStop3.ToString('HH:mm:ss.fff'), $e3.ms, $e3.result, $e3.created, $after3, $(if ($after3 -le 20000) { 'within' } else { 'after' }), $p3.ms, $tAns3.ToString('HH:mm:ss.fff'), (PuCpuText $smp3 $k3.sent $tAns3), $cnt3.numbered)
  Start-Sleep 5; PuLogStop $log
  Copy-Item $log.file (Join-Path $out 'pileup-b-tcp.txt') -ErrorAction SilentlyContinue
  $bc = PuConns $log $a1.sent.AddSeconds(-1) (Get-Date)
  PuMeasure ("B connections to Tally 9000 during B: {0} ({1})" -f $bc.Count, (PuByProc $bc))
}
function PileUp {
  try { PileA } catch { Write-Host "PileA: $_ $($_.ScriptStackTrace)"; Result 'A pile-up' $false "the harness stopped: $_" $true }
  try { PileB } catch { Write-Host "PileB: $_ $($_.ScriptStackTrace)"; Result 'B abandoned request' $false "the harness stopped: $_" $true }
}
