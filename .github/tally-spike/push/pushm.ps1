# push-design measurements (MEASUREMENT ONLY; branch tally-versions). Run after flow.ps1 (Tally installed, Educational
# mode, company "FinCom Spike Co" made in $RUNNER_TEMP\TallyData). For one TallyPrime release ($env:TALLY_REL):
#   setup   the light company's masters and templates by XML; a copy of it becomes the heavy company, which gets
#           thousands of ledgers and items and tens of thousands of vouchers by XML (no add-on loaded)
#   a       save time: a Receipt, a Sales invoice with 5 items and one with 50 (Alt+2 on the template, then Ctrl+A),
#           and the 50-item invoice altered (Enter, Ctrl+A); each under: no add-on / stamps only / today's heads-only
#           add-on (FCPHeads.tdl) / the full-entry add-on (FCPFull.tdl); light and heavy company.
#           Timed two ways: the add-on's own stamps (files whose NTFS write times are read; the timer at 1 ms) and the
#           screen (Ctrl+A sent, the screen hashed every ~15 ms: first change and last change before it settles)
#   b       FinCom's posting of one voucher through bridge 2.3.0 (/jobs as FinCom's page does, and /import), add-on
#           none / heads / full; every request the bridge sends Tally is timed by proxy.py (TallyHost 127.0.0.2)
#   c       the full-entry lines (captures), Tally's own GUID / MasterID / AlterID and the 2.3.1 body for the same
#           vouchers; candidate events (FCPEv_*.tdl); the Windows user as TDL can see it
# Outputs in $env:RES\push: a.csv, b.csv, proxy.jsonl, stub.jsonl, bridge logs, captures\, summary.txt.
$ErrorActionPreference = 'Continue'
$rel = $env:TALLY_REL; $dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$reps = [int]$(if ($env:PD_REPS) { $env:PD_REPS } else { 5 })
$hvVch = [int]$(if ($env:PD_HEAVY_VCH) { $env:PD_HEAVY_VCH } else { 30000 })
$hvLed = [int]$(if ($env:PD_HEAVY_LED) { $env:PD_HEAVY_LED } else { 3000 })
$hvItem = [int]$(if ($env:PD_HEAVY_ITEM) { $env:PD_HEAVY_ITEM } else { 3000 })
$hvBudget = [int]$(if ($env:PD_HEAVY_MIN) { $env:PD_HEAVY_MIN } else { 35 })
$posts = [int]$(if ($env:PD_POSTS) { $env:PD_POSTS } else { 5 })
$co = 'FinCom Spike Co'
$here = $PSScriptRoot; . "$here\data.ps1"
$out = Join-Path $env:RES 'push'; $cap = Join-Path $out 'captures'; New-Item -ItemType Directory -Force $out, $cap | Out-Null
$light = "$env:RUNNER_TEMP\TallyData"; $heavy = "$env:RUNNER_TEMP\TallyHeavy"
$pd = 'C:\fcspike\push'; $fc = 'C:\fcspike'; $rec = 'C:\ProgramData\FinCom\recorder'
New-Item -ItemType Directory -Force $pd, $rec | Out-Null
& icacls.exe $rec /grant '*S-1-5-32-545:(OI)(CI)M' /Q | Out-Null
$summary = Join-Path $out 'summary.txt'
function Say($m) { $l = "[$(Get-Date -Format HH:mm:ss.fff)] $m"; Write-Host $l; Add-Content $summary $l -Encoding UTF8 }
function Ms($sw) { [math]::Round($sw.Elapsed.TotalMilliseconds, 1) }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
Say "push-design on TallyPrime ${rel}: reps $reps, heavy $hvLed ledgers / $hvItem items / up to $hvVch vouchers ($hvBudget min), postings $posts"

Add-Type -AssemblyName System.Windows.Forms
# the screen timer on plain Win32 calls (GDI BitBlt into a DIB section, keybd_event for Ctrl+A): runs 37443094212 and
# 37450532756 showed that System.Drawing does not compile under PowerShell 7 here (its types are spread over
# System.Drawing.Common / Primitives / System.Private.Windows.*), so nothing below needs more than System
Add-Type -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class PdUi {
  [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
  [StructLayout(LayoutKind.Sequential)] struct BMIH { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BMIH bmi, uint usage, out IntPtr bits, IntPtr sec, uint off);
  static long Hash(IntPtr mem, IntPtr scr, IntPtr bits, int w, int h) {
    BitBlt(mem, 0, 0, w, h, scr, 0, 0, 0x00CC0020);
    long s = 1469598103934665603L;
    for (int y = 0; y < h; y += 5) for (int x = 0; x < w; x += 5) { int v = Marshal.ReadInt32(bits, (y * w + x) * 4); s = (s ^ v) * 1099511628211L; }
    return s;
  }
  // keys: "^a" (Ctrl+A) sent by keybd_event. Returns ms until the keys were sent; first change of the screen; last change
  // before the screen stayed the same for stableMs; frames
  // v3: one key (virtual-key code vk, with Ctrl when ctrl) sent; ms until the screen first changes (-1: no change in maxMs)
  public static double KeyLatency(byte vk, bool ctrl, int maxMs) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr), bits;
    BMIH bi = new BMIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0), old = SelectObject(mem, dib);
    try {
      long prev = Hash(mem, scr, bits, w, h);
      Stopwatch sw = Stopwatch.StartNew();
      if (ctrl) keybd_event(0x11, 0, 0, UIntPtr.Zero);
      keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero);
      if (ctrl) keybd_event(0x11, 0, 2, UIntPtr.Zero);
      while (sw.ElapsedMilliseconds < maxMs) { if (Hash(mem, scr, bits, w, h) != prev) return sw.Elapsed.TotalMilliseconds; Thread.Sleep(5); }
      return -1;
    } finally { SelectObject(mem, old); DeleteObject(dib); DeleteDC(mem); ReleaseDC(IntPtr.Zero, scr); }
  }
  public static void SendCtrl(byte vk) { keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero); }
  public static string Measure(string keys, int stableMs, int maxMs) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr), bits;
    BMIH bi = new BMIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0), old = SelectObject(mem, dib);
    try {
      long prev = Hash(mem, scr, bits, w, h);
      Stopwatch sw = Stopwatch.StartNew();
      keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event((byte)char.ToUpperInvariant(keys[keys.Length - 1]), 0, 0, UIntPtr.Zero);
      keybd_event((byte)char.ToUpperInvariant(keys[keys.Length - 1]), 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
      double sent = sw.Elapsed.TotalMilliseconds, first = -1, last = -1; int frames = 0;
      while (sw.ElapsedMilliseconds < maxMs) {
        long x = Hash(mem, scr, bits, w, h); double t = sw.Elapsed.TotalMilliseconds; frames++;
        if (x != prev) { if (first < 0) first = t; last = t; prev = x; }
        else if (first >= 0 && t - last >= stableMs) break;
        Thread.Sleep(5);
      }
      return string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0.0};{1:0.0};{2:0.0};{3}", sent, first, last, frames);
    } finally { SelectObject(mem, old); DeleteObject(dib); DeleteDC(mem); ReleaseDC(IntPtr.Zero, scr); }
  }
}
'@
$script:noUiTimer = -not ('PdUi' -as [type])
if ($script:noUiTimer) { Say 'HARNESS: the screen timer did not compile' }
[PdUi]::timeBeginPeriod(1) | Out-Null
# the clock's step as this process sees it (the NTFS times the stamps use come from the same system time)
$steps = @(); $t = [DateTime]::UtcNow.Ticks; for ($i = 0; $i -lt 2000000 -and $steps.Count -lt 20; $i++) { $n = [DateTime]::UtcNow.Ticks; if ($n -ne $t) { $steps += ($n - $t) / 10000.0; $t = $n } }
Say "system clock step after timeBeginPeriod(1): $([math]::Round((($steps | Measure-Object -Average).Average), 3)) ms (min $(($steps | Measure-Object -Minimum).Minimum), max $(($steps | Measure-Object -Maximum).Maximum))"
# a file's write time resolution: two closes 2 ms apart
$f1 = "$pd\clk-1.txt"; $f2 = "$pd\clk-2.txt"; Set-Content $f1 'x'; Start-Sleep -Milliseconds 2; Set-Content $f2 'x'
Say "two files written 2 ms apart: NTFS write times $(((Get-Item $f2).LastWriteTimeUtc - (Get-Item $f1).LastWriteTimeUtc).TotalMilliseconds) ms apart"

# ---------------------------------------------------------------- Tally
$script:tpid = 0; $script:noWindow = 0
function TallyWin { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; if (-not $p -or $p.MainWindowHandle -eq 0) { return $null }; return $p }
function Focus { $p = TallyWin; if (-not $p) { $script:noWindow++; return $false }; [PdUi]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [PdUi]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 400; return $true }
function Shot($n) { & "$here\..\shot.ps1" "p-$n" }
function KeysTo([string]$k, $wait = 2, $n = '') {
  if (-not (Focus)) { Write-Host "[keys] Tally has no window"; return }
  [System.Windows.Forms.SendKeys]::SendWait($k); Write-Host "[keys] '$k'"
  Start-Sleep $wait; if ($n) { Shot $n }
}
$script:lastMs = 0
function Post($body, $label = '', $timeout = 120) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $timeout).Content; $script:lastMs = Ms $sw
    if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 500) { $s = $s.Substring(0, 500) + '...' }; Write-Host "[$label] $($script:lastMs) ms: $s" }
    return $c } catch { $script:lastMs = Ms $sw; Write-Host "[$label] failed after $($script:lastMs) ms: $($_.Exception.Message)"; return '' }
}
function Imp($report, [string[]]$msgs, $label, $timeout = 900) {
  $b = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>'
  $b += ($msgs | ForEach-Object { '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $_ + '</TALLYMESSAGE>' }) -join ''
  $b += '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  $r = Post $b '' $timeout
  $o = [pscustomobject]@{ created = [int]([regex]::Match($r, '<CREATED>(\d+)').Groups[1].Value + '0') / 10; errors = [int]([regex]::Match($r, '<ERRORS>(\d+)').Groups[1].Value + '0') / 10; ms = $script:lastMs; raw = $r }
  $le = ([regex]::Matches($r, '<LINEERROR>([^<]*)') | Select-Object -First 3 | ForEach-Object { $_.Groups[1].Value }) -join ' / '
  Say ("import {0}: {1} sent, created {2}, errors {3}, {4} ms{5}" -f $label, $msgs.Count, $o.created, $o.errors, $o.ms, $(if ($le) { "; Tally: $le" }))
  return $o
}
function Coll($id, $type, $fetch, $filter = '', $extra = '') {
  $f = if ($filter) { "<FILTER>FCPF</FILTER></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"FCPF`">$([Security.SecurityElement]::Escape($filter))</SYSTEM>" } else { '</COLLECTION>' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $extra + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
function Val($n) { "$($n.'#text')$(if ($n -is [string]) { $n })".Trim() }
# the measurement vouchers (dated October / November 2026: no heavy voucher lives there)
function OctVouchers {
  $x = Post (Coll 'FCPOct' 'Voucher' 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED' '$Date >= $$Date:"01-10-2026"')
  $l = @()
  try { $d = [xml]($x -replace '&#4;', ''); foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $l += [pscustomobject]@{ guid = Val $v.GUID; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); date = Val $v.DATE; type = Val $v.VOUCHERTYPENAME; vno = Val $v.VOUCHERNUMBER } } } catch { Write-Host "OctVouchers parse: $_" }
  return , $l
}
function Count($type) {
  $x = Post (Coll "FCPCount$type" $type 'MASTERID') '' 600
  return ([regex]::Matches($x, '<MASTERID')).Count
}
function Write-Ini($data, [string[]]$tdls) {
  $l = @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $script:folder")
  foreach ($t in $tdls) { if ($t) { $l += "TDL = $t" } }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  Say "tally.ini: Data $data; TDL: $(if ($tdls) { $tdls -join ', ' } else { 'none' })"
}
function Stop-T { Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3 }
# the timing proxy: started after Tally holds its port (it binds 127.0.0.2:9000 beside Tally's own listener), stopped
# before Tally starts again
$script:proxy = $null; $script:useProxy = $false
$py = (Get-Command python).Source
$proxyLog = Join-Path $out 'proxy.jsonl'
function Stop-Proxy { if ($script:proxy) { Stop-Process -Id $script:proxy.Id -Force -ErrorAction SilentlyContinue; $script:proxy = $null; Start-Sleep 1 } }
function Start-Proxy {
  Stop-Proxy
  $script:proxy = Start-Process -FilePath $py -ArgumentList "`"$here\proxy.py`" 9000 `"$proxyLog`"" -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $out "proxy-stderr-$(Get-Date -Format HHmmss).txt")
  Start-Sleep 2
  try { $g = (Invoke-WebRequest 'http://127.0.0.2:9000' -UseBasicParsing -TimeoutSec 10).Content } catch { $g = "failed: $($_.Exception.Message)" }
  $ok = (-not $script:proxy.HasExited) -and ($g -match 'Running|RESPONSE')
  Say "proxy 127.0.0.2:9000 -> Tally: $ok ($($g -replace '\s+', ' '))"
  return $ok
}
function Start-T($data, [string[]]$tdls, $tag) {
  Stop-Proxy; Stop-T; Write-Ini $data $tdls
  $script:lastStamp = if (@($tdls | Where-Object { $_ -like '*FCPFull*' }).Count) { 'e' } elseif (@($tdls | Where-Object { $_ -like '*FCPStamp*' -or $_ -like '*FCPHeads*' }).Count) { 'd' } else { '' }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $p.Id
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {}; if ($p.HasExited) { break } }
  Start-Sleep 5
  KeysTo 'a' 4; KeysTo 't' 8 "$tag-started"
  $x = Post (Coll 'FCPCo' 'Company' 'NAME, GUID')
  $ok = $x -match [regex]::Escape($co)
  # probe 4: a TDL with errors makes Tally say "TallyPrime will ignore the TDLs that have errors ... Press any key" and
  # wait; the key is sent, the company opens after it
  $script:tdlWarned = $false
  for ($w = 1; -not $ok -and $w -le 2; $w++) {
    KeysTo '{ENTER}' 8 "$tag-key-$w"
    $x = Post (Coll 'FCPCo' 'Company' 'NAME, GUID'); $ok = $x -match [regex]::Escape($co)
    if ($ok) { $script:tdlWarned = $true; Say "Tally ($tag): a TDL had errors (Tally's warning answered); see the screenshot $tag-started" }
  }
  Say "Tally started ($tag) in $([math]::Round($sw.Elapsed.TotalSeconds,1)) s; company open: $ok"
  if ($script:useProxy) { Start-Proxy | Out-Null }
  return $ok
}
function DMY($d) { '{0}-{1}-{2}' -f [int]$d.Substring(6, 2), [int]$d.Substring(4, 2), $d.Substring(0, 4) }
function DayBook($date, $n) { KeysTo '%g' 2; KeysTo 'Day Book' 1; KeysTo '{ENTER}' 3; KeysTo '{F2}' 2; KeysTo "$date{ENTER}" 3 $n }

# ---------------------------------------------------------------- setup: light, then heavy (a copy + bulk)
$script:folder = (Get-ChildItem $light -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1).Name
Say "light company folder: $light\$script:folder"
$setupOk = Start-T $light @() 'setup-light'
if (-not $setupOk) { Say 'HARNESS: the light company did not open'; return }
$cguid = [regex]::Match((Post (Coll 'FCPCo' 'Company' 'NAME, GUID')), '<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value
Say "company GUID $cguid"
# can the proxy sit beside Tally's port? (decides the bridge's TallyHost)
$script:useProxy = Start-Proxy
Stop-Proxy
Imp 'All Masters' (LightMasters) 'light masters' | Out-Null
$t5 = @(1..5 | ForEach-Object { 'Item T{0:d2}' -f $_ }); $t50 = @(1..50 | ForEach-Object { 'Item T{0:d2}' -f $_ })
$tpl = [ordered]@{
  s5  = @{ rich = (SalesXml '20261002' 'TS5-1' 'Template Party' $t5 'template sales 5 items'); plain = (SalesXml '20261002' 'TS5-1' 'Template Party' $t5 'template sales 5 items' $false) }
  s50 = @{ rich = (SalesXml '20261031' 'TS50-1' 'Template Party' $t50 'template sales 50 items'); plain = (SalesXml '20261031' 'TS50-1' 'Template Party' $t50 'template sales 50 items' $false) }
  rc  = @{ rich = (ReceiptXml '20261001' 'TR-1' 'Template Party' 'TS5-1' 1180 'template receipt'); plain = (ReceiptXml '20261001' 'TR-1' 'Template Party' 'TS5-1' 1180 'template receipt' $false) }
}
$tplKind = @{}
foreach ($k in $tpl.Keys) {
  $r = Imp 'Vouchers' @($tpl[$k].rich) "template $k (all fields)"
  $tplKind[$k] = 'all fields'
  if ($r.created -lt 1) { $r = Imp 'Vouchers' @($tpl[$k].plain) "template $k (plain)"; $tplKind[$k] = if ($r.created -ge 1) { 'plain (Tally refused a rich field)' } else { 'NONE' } }
}
Say "templates: $(($tplKind.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join '; ')"
$tv = OctVouchers; $tv | ForEach-Object { Say "  template $($_.type) $($_.vno) $($_.date) mid $($_.mid) aid $($_.aid) $($_.guid)" }
# the templates as the 2.3.1 entry request reads them (items-231 liveFetchField): the reference for part c
$fetch231 = 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, ISCANCELLED, ISOPTIONAL, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE, REFERENCE, REFERENCEDATE, PARTYGSTIN, PLACEOFSUPPLY, CMPGSTIN, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.GSTHSNNAME, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, ALLLEDGERENTRIES.RATEDETAILS.GSTRATE, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX, ALLINVENTORYENTRIES.STOCKITEMNAME, ALLINVENTORYENTRIES.BILLEDQTY, ALLINVENTORYENTRIES.RATE, ALLINVENTORYENTRIES.AMOUNT, ALLINVENTORYENTRIES.GSTHSNNAME, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER'
function Body231($mid, $file) { $x = Post (Coll 'FCPBody231' 'Voucher' $fetch231 "`$MasterID = $mid"); Set-Content (Join-Path $cap $file) $x -Encoding UTF8; return $x }
foreach ($v in $tv) { Body231 $v.mid "tally-body231-template-$($v.type)-$($v.vno).xml" | Out-Null }
# ---------------------------------------------------------------- the owner's second ask: every voucher type
# features (payroll, batches, godowns, orders, tracking numbers) asked by XML first: the company's own fields are read
# (NATIVEMETHOD *), every Yes/No field whose name speaks of them is set to Yes by an Alter, and read again; F11 by keys
# after that if any is still No (its screens are kept); then the voucher types made active, a manufacturing journal type,
# the masters and one template per voucher type
function Natives($id, $type, $filter = '') { Post (Coll $id $type 'NAME' $filter '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 120 }
function YesNoFields($xml, $tag, $re) {
  $o = [ordered]@{}
  foreach ($m in [regex]::Matches($xml, '<(?<n>' + $re + ')(?: [^>]*)?>(?<v>Yes|No)</\k<n>>')) { if (-not $o.Contains($m.Groups['n'].Value)) { $o[$m.Groups['n'].Value] = $m.Groups['v'].Value } }
  return $o
}
$featRe = '[A-Z]*(PAYROLL|BATCH|GODOWN|ORDER|TRACK|EXPIRY|MFG|ATTEND|ACTUALANDBILLED|SEPARATEACTUAL|JOBORDER|COSTTRACK)[A-Z]*'
$co0 = Natives 'FCPCoAll' 'Company'; Set-Content (Join-Path $cap 'company-natives-before.xml') $co0 -Encoding UTF8
$f0 = YesNoFields $co0 'COMPANY' $featRe
Say "company feature fields (by name): $(($f0.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
# probe 4 (run 37479202675): the Alter works on 3.0 and 7.1; only these are set (it set every matching field, excise and
# payroll statutory among them)
$featOn = @('ISPAYROLLON', 'ISBATCHWISEON', 'PREVISMULTIGODOWNON', 'PREVISTRACKINGON', 'PREVISSALESORDERSON', 'PREVISPURCORDERSON', 'ISCOSTCENTRESON', 'PREVISCOSTCATEGORYON') | Where-Object { $co0 -match "<$_>" }
$alter = '<COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME>' + (($featOn | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</COMPANY>'
$r = Imp 'All Masters' @($alter) 'company features by XML'
Set-Content (Join-Path $cap 'company-alter-answer.xml') $r.raw -Encoding UTF8
$co1 = Natives 'FCPCoAll' 'Company'; Set-Content (Join-Path $cap 'company-natives-after-xml.xml') $co1 -Encoding UTF8
$f1 = YesNoFields $co1 'COMPANY' $featRe
Say "after the XML alter: $(($f1.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
$featStillNo = @($f1.GetEnumerator() | Where-Object { $_.Value -eq 'No' -and $_.Key -match 'PAYROLL|BATCH' }).Count
# F11 by keys: Show more features, then every field down the form is shown on a screenshot; each Yes/No field whose label
# the harness knows is answered y (payroll, batches) - the screens say what the release calls them
if ($featStillNo) {
  KeysTo '{F11}' 3 'f11-0'
  for ($i = 1; $i -le 3; $i++) { KeysTo '{UP}' 1 }
  Shot 'f11-1-top'; KeysTo 'y' 2 'f11-2-show-more'
  for ($i = 1; $i -le 48; $i++) { KeysTo '{DOWN}' 1 $("f11-d{0:d2}" -f $i) }
  KeysTo '^a' 3 'f11-accepted'
  $co2 = Natives 'FCPCoAll' 'Company'; Set-Content (Join-Path $cap 'company-natives-after-f11.xml') $co2 -Encoding UTF8
  Say "after F11 (show more features only): $(((YesNoFields $co2 'COMPANY' $featRe).GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
}
$vt = Natives 'FCPVtAll' 'VoucherType'; Set-Content (Join-Path $cap 'vouchertypes-natives.xml') $vt -Encoding UTF8
$vtNames = @([regex]::Matches($vt, '<VOUCHERTYPE NAME="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
Say "voucher types: $($vtNames -join ', ')"
$actField = @([regex]::Matches($vt, '<(ISACTIVE|[A-Z]*ACTIVE[A-Z]*)(?: [^>]*)?>(Yes|No)<') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
$mfgField = @([regex]::Matches($vt, '<([A-Z]*(?:MFG|MANUF)[A-Z]*)(?: [^>]*)?>(Yes|No)<') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Say "voucher type fields: active $($actField -join ','); manufacturing $($mfgField -join ',')"
$vtMsgs = @()
foreach ($t in 'Payroll', 'Attendance', 'Stock Journal', 'Delivery Note', 'Receipt Note', 'Sales Order', 'Purchase Order', 'Physical Stock') {
  # manual numbering: the order and note numbers in the templates are kept (probe 4: "Bad Order Number in Voucher!")
  if ($t -in $vtNames) { $vtMsgs += '<VOUCHERTYPE NAME="' + $t + '" ACTION="Alter"><NAME>' + $t + '</NAME><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>' + (($actField | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</VOUCHERTYPE>' }
}
$vtMsgs += '<VOUCHERTYPE NAME="PD Manufacturing Journal" ACTION="Create"><NAME.LIST><NAME>PD Manufacturing Journal</NAME></NAME.LIST><PARENT>Stock Journal</PARENT><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>' + (($actField | ForEach-Object { "<$_>Yes</$_>" }) -join '') + (($mfgField | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</VOUCHERTYPE>'
Imp 'All Masters' $vtMsgs 'voucher types active, manufacturing journal' | Out-Null
$tm = TypeMasters
Imp 'All Masters' @($tm | Where-Object { $_ -notlike '<ATTENDANCETYPE*' }) 'type masters (godowns, batch items, employees, pay heads, supplier)' | Out-Null
$attOk = $false
foreach ($a in (AttendanceTypeForms)) { $r = Imp 'All Masters' @($a) 'attendance type'; if ($r.created -ge 1) { $attOk = $true; Say "   attendance type made by: $a"; break } }
$typeTpl = TypeTemplates; $typeOk = [ordered]@{}
foreach ($k in $typeTpl.Keys) {
  $vs = @($typeTpl[$k]); $errs = @()
  for ($v = 0; $v -lt $vs.Count; $v++) {
    $r = Imp 'Vouchers' @($vs[$v]) "template $k (form $($v + 1) of $($vs.Count))"
    $e = ([regex]::Matches($r.raw, '<LINEERROR>([^<]*)') | Select-Object -First 2 | ForEach-Object { $_.Groups[1].Value }) -join ' / '
    $x = [regex]::Match($r.raw, '<EXCEPTIONS>(\d+)').Groups[1].Value
    $errs += "form $($v + 1): created $($r.created), exceptions $x $e"
    if ($r.created -ge 1) { break }
  }
  $typeOk[$k] = [pscustomobject]@{ created = $r.created; form = $v + 1; ms = $r.ms; err = ($errs -join ' | ') }
}
$typeOk | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'type-templates.json') -Encoding UTF8
foreach ($k in $typeTpl.Keys) {
  $d = $TypeDates[$k]
  Post (Coll "FCPTyp$k" 'Voucher' 'NAME' "`$Date = `$`$Date:`"$($d.Substring(6,2))-$($d.Substring(4,2))-$($d.Substring(0,4))`"" '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 120 | Set-Content (Join-Path $cap "tally-type-$k-template.xml") -Encoding UTF8
}

# the Windows user, as TDL sees it (each candidate asked on its own: a name Tally does not know only fails that request)
$who = @()
foreach ($c in @('$$MachineName', '$$CmpUserName', '$$SysInfo:WindowsUser', '$$SysInfo:WindowsUserName', '$$SysInfo:UserName', '$$SysInfo:LoginUser', '$$SysInfo:SystemName', '$$SysInfo:ComputerName', '$$SysInfo:MachineName', '$$SysInfo:IPAddress', '$$SysInfo:ApplicationPath', '$$SysInfo:TempPath')) {
  $x = Post (Coll 'FCPWho' 'Company' 'NAME' '' ("<COMPUTE>FCPW:$([Security.SecurityElement]::Escape($c))</COMPUTE><FETCH>FCPW</FETCH>")) '' 30
  $v = [regex]::Match($x, '<FCPW[^>]*>([^<]*)</FCPW>').Groups[1].Value; $e = [regex]::Match($x, '<LINEERROR>([^<]*)|<ERRORMSG>([^<]*)').Value
  $who += "$c => '$v' $e"; Say "TDL $c => '$v' $e"
}
Set-Content (Join-Path $cap 'windows-user-candidates.txt') (@("Windows user of this runner: $env:USERNAME ($env:USERDOMAIN), computer $env:COMPUTERNAME") + $who) -Encoding UTF8
# v3 (07-Oct-2026): the owner's TDS masters on the light company before it is copied (v3.ps1)
if ($env:PD_MODE -in 'v3', 'v3b') { . "$here\v3.ps1"; try { V3TdsMasters } catch { Say "HARNESS: TDS masters: $_" } }
Stop-T
# heavy: the light company's folder copied (same company, same templates), then the bulk by XML
if (Test-Path $heavy) { Remove-Item $heavy -Recurse -Force }
Copy-Item $light $heavy -Recurse
$swH = [Diagnostics.Stopwatch]::StartNew()
$heavyOk = Start-T $heavy @() 'setup-heavy'
$hv = [ordered]@{ ledgers = 0; items = 0; vouchers = 0; importMin = 0 }
if ($heavyOk) {
  $hm = HeavyMasters $hvLed $hvItem
  for ($i = 0; $i -lt $hm.Count; $i += 1000) { Imp 'All Masters' $hm[$i..([math]::Min($i + 999, $hm.Count - 1))] "heavy masters $i" | Out-Null }
  $dates = HeavyDates; $nParty = [int]($hvLed * 0.9); $nExp = $hvLed - $nParty
  $sent = 0; $made = 0
  for ($k = 0; $k -lt $hvVch; $k += 1000) {
    if ($swH.Elapsed.TotalMinutes -gt $hvBudget) { Say "heavy import stopped at the time budget ($hvBudget min) after $sent vouchers sent"; break }
    $batch = @(); for ($j = $k; $j -lt [math]::Min($k + 1000, $hvVch); $j++) { $batch += HeavyVoucher $j $dates $nParty $nExp $hvItem }
    $r = Imp 'Vouchers' $batch "heavy vouchers $k"; $sent += $batch.Count; $made += $r.created
  }
  $hv.ledgers = Count 'Ledger'; $hv.items = Count 'StockItem'; $hv.vouchers = Count 'Voucher'; $hv.importMin = [math]::Round($swH.Elapsed.TotalMinutes, 1)
  $lc = Count 'Ledger'
  Say "heavy company: $($hv.ledgers) ledgers, $($hv.items) stock items, $($hv.vouchers) vouchers in Tally (import took $($hv.importMin) min)"
}
Stop-T
Start-T $light @() 'count-light' | Out-Null
$lt = [ordered]@{ ledgers = (Count 'Ledger'); items = (Count 'StockItem'); vouchers = (Count 'Voucher') }
Say "light company: $($lt.ledgers) ledgers, $($lt.items) stock items, $($lt.vouchers) vouchers"
Set-Content (Join-Path $out 'sizes.json') (@{ light = $lt; heavy = $hv; templates = $tplKind; cguid = $cguid } | ConvertTo-Json -Depth 4) -Encoding UTF8
Stop-T
if ($env:PD_MODE -eq 'v3') { try { V3Pre } catch { Say "HARNESS: v3 fetch stage stopped: $_" } }

# ---------------------------------------------------------------- the bridge (2.3.0 setup), the stub cloud, the proxy
$stubLog = Join-Path $out 'stub.jsonl'
$stub = Start-Process -FilePath $py -ArgumentList "`"$here\stubp.py`" 8787 `"$stubLog`"" -PassThru -WindowStyle Hidden
Start-Sleep 3
$h1 = Join-Path $env:LOCALAPPDATA 'TDS Desk Bridge'; New-Item -ItemType Directory -Force $h1 | Out-Null
Say "bridge's TallyHost: $(if ($script:useProxy) { '127.0.0.2 (through the timing proxy)' } else { '127.0.0.1 (the proxy could not sit beside Tally: no per-request times)' })"
Set-Content "$h1\tds-bridge.config.json" (@{ CloudUrl = 'http://127.0.0.1:8787/'; CloudKey = 'plain:spike-computer-key-push'; TallyPorts = @(9000); TallyHost = $(if ($script:useProxy) { '127.0.0.2' } else { '127.0.0.1' }) } | ConvertTo-Json -Compress) -Encoding UTF8
$setupSrc = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-*.exe' | Select-Object -First 1
Say "bridge: $(Get-Content (Join-Path $env:BRIDGE_DIST 'setup-origin.txt') -ErrorAction SilentlyContinue)"
$setup = "$fc\FinComBridge-Setup.exe"; Copy-Item $setupSrc.FullName $setup -Force
$p = Start-Process -FilePath $setup -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
if (-not $p.WaitForExit(300000)) { Say 'bridge setup did not end' }
Start-Sleep 15
$cfg1 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
$bport = [int]$cfg1.Port; $bkey = "$($cfg1.Key)"; $blog = "$h1\tds-bridge.log"
Say "bridge config after setup: TallyHost '$($cfg1.TallyHost)', TallyPorts $($cfg1.TallyPorts -join ','), port $bport"
function Bridge($method, $path, $body = $null, $timeout = 120) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $a = @{ Uri = "http://127.0.0.1:$bport$path"; Method = $method; Headers = @{ 'X-Bridge-Key' = $bkey }; TimeoutSec = $timeout }
  if ($null -ne $body) { $a.Body = ($body | ConvertTo-Json -Depth 8 -Compress); $a.ContentType = 'application/json' }
  try { $r = Invoke-RestMethod @a; $script:lastMs = Ms $sw; return $r } catch { $script:lastMs = Ms $sw; Write-Host "[bridge $path] $($_.Exception.Message) $($_.ErrorDetails.Message)"; return $null }
}
$st = $null; for ($i = 0; $i -lt 20 -and -not $st; $i++) { $st = Bridge GET '/status'; if (-not $st) { Start-Sleep 3 } }
Say "bridge on 127.0.0.1:$bport, version $($st.version)"
$script:logSeen = 0
function BridgeLog($tag) {
  if (Test-Path $blog) { $l = @(Get-Content $blog); $new = @($l | Select-Object -Skip $script:logSeen); $script:logSeen = $l.Count; Add-Content (Join-Path $out "bridge-log-$tag.txt") $new -Encoding UTF8 }
}

# ---------------------------------------------------------------- the measurements
$aRows = [Collections.Generic.List[object]]::new(); $bRows = [Collections.Generic.List[object]]::new()
$aCsv = Join-Path $out 'a.csv'; $bCsv = Join-Path $out 'b.csv'
function Stamps {
  $h = @{}; Get-ChildItem $pd -Filter 'stamp-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { $h[$_.BaseName.Substring(6)] = $_.LastWriteTimeUtc }
  Get-ChildItem $pd -Filter 'stamp-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  return $h
}
function D($h, $x, $y) { if ($h.ContainsKey($x) -and $h.ContainsKey($y)) { return [math]::Round(($h[$y] - $h[$x]).TotalMilliseconds, 1) }; return '' }
function FullFile { Get-ChildItem $pd -Filter 'full-*.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
$script:fullSeen = @{}; $script:recSeen = @{}
function NewFullLines {
  $o = @()
  foreach ($f in (Get-ChildItem $pd -Filter 'full-*.txt' -ErrorAction SilentlyContinue)) {
    $b = [IO.File]::ReadAllBytes($f.FullName); $from = [int]$script:fullSeen[$f.FullName]; $script:fullSeen[$f.FullName] = $b.Length
    if ($b.Length -le $from) { continue }
    $s = [Text.Encoding]::Unicode.GetString($b, $from, $b.Length - $from).TrimStart([char]0xFEFF)
    $o += @($s -split "`r?`n" | Where-Object { $_ })
  }
  return , $o
}
$script:recSeen = @{}
function NewRecLines {
  $o = @()
  foreach ($f in (Get-ChildItem $rec -File -ErrorAction SilentlyContinue)) {
    $b = [IO.File]::ReadAllBytes($f.FullName); $from = [int]$script:recSeen[$f.FullName]; $script:recSeen[$f.FullName] = $b.Length
    if ($b.Length -le $from) { continue }
    $s = [Text.Encoding]::Unicode.GetString($b, $from, $b.Length - $from).TrimStart([char]0xFEFF)
    $o += @($s -split "`r?`n" | Where-Object { $_ -like 'FCR1|*' })
  }
  return , $o
}
function SaveBlock($cfg, $coTag, $kind, $date, $n, $mode) {
  Say "-- a: $coTag / $cfg / $kind ($mode) x $n"
  $before = OctVouchers
  Get-ChildItem $pd -Filter 'stamp-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  NewFullLines | Out-Null; NewRecLines | Out-Null
  for ($r = 1; $r -le $n; $r++) {
    DayBook $date $(if ($r -eq 1) { "$coTag-$cfg-$kind-daybook" })
    if ($mode -eq 'dup') { KeysTo '{END}' 1; KeysTo '%2' 4 $(if ($r -eq 1) { "$coTag-$cfg-$kind-dup" }) }
    else { KeysTo '{HOME}' 1; KeysTo '{ENTER}' 4 $(if ($r -eq 1) { "$coTag-$cfg-$kind-open" }) }
    if (-not (Focus)) { continue }
    if ($script:noUiTimer) { [System.Windows.Forms.SendKeys]::SendWait('^a'); $m = @('-1', '-1', '-1', '0') } else { $m = ([PdUi]::Measure('^a', 400, 15000)) -split ';' }
    # wait for the add-on's last stamp (run 37464758500: on the heavy company the full add-on's read-back outlasted the
    # fixed 2 s and its stamp was read with the next save)
    $sw2 = [Diagnostics.Stopwatch]::StartNew(); Start-Sleep 2
    if ($script:lastStamp) { while (-not (Test-Path "$pd\stamp-$($script:lastStamp).txt") -and $sw2.Elapsed.TotalSeconds -lt 180) { Start-Sleep -Milliseconds 250 }; Start-Sleep -Milliseconds 300 }
    $h = Stamps; $lines = NewFullLines; $rl = NewRecLines
    $saved = @($lines | Where-Object { $_ -like 'FCF1|ev=voucher_saved*' })[0]; $final = @($lines | Where-Object { $_ -like 'FCF1|ev=voucher_final*' })[0]
    $row = [pscustomobject]@{ rel = $rel; company = $coTag; cfg = $cfg; kind = $kind; mode = $mode; rep = $r
      ui_sendwait_ms = $m[0]; ui_first_ms = $m[1]; ui_settled_ms = $m[2]; frames = $m[3]
      pre_ms = (D $h 'a' 'b'); save_ms = (D $h 'b' 'c'); post_ms = (D $h 'c' 'd'); final_ms = (D $h 'd' 'e'); total_ms = $(if ($h.ContainsKey('e')) { D $h 'a' 'e' } else { D $h 'a' 'd' })
      stamps = (($h.Keys | Sort-Object) -join ''); line_bytes_utf16 = $(if ($saved) { 2 * $saved.Length } else { '' }); line_bytes_utf8 = $(if ($saved) { [Text.Encoding]::UTF8.GetByteCount($saved) } else { '' })
      final = $(if ($final) { $final } else { '' }); rec_lines = $rl.Count; rec_events = (($rl | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) -join ' ') }
    $aRows.Add($row); $row | Export-Csv $aCsv -Append -NoTypeInformation -Encoding UTF8
    Write-Host ("   rep {0}: ui sendwait {1} first {2} settled {3}; stamps pre {4} save {5} post {6} final {7}; line {8} B" -f $r, $m[0], $m[1], $m[2], $row.pre_ms, $row.save_ms, $row.post_ms, $row.final_ms, $row.line_bytes_utf8)
    if ($saved -and $r -eq 1) { Set-Content (Join-Path $cap "line-$coTag-$cfg-$kind-$mode.txt") (@($saved) + @($final) | Where-Object { $_ }) -Encoding UTF8 }
    if ($rl.Count -and $r -eq 1) { Set-Content (Join-Path $cap "recline-$coTag-$cfg-$kind-$mode.txt") $rl -Encoding UTF8 }
    if ($r -eq 1) { Shot "$coTag-$cfg-$kind-saved" }
  }
  $after = OctVouchers
  $newV = @($after | Where-Object { $_.mid -notin @($before | ForEach-Object mid) })
  $altered = @($after | Where-Object { $a = $_; $b0 = @($before | Where-Object mid -eq $a.mid)[0]; $b0 -and $a.aid -gt $b0.aid })
  $ok = if ($mode -eq 'dup') { $newV.Count } else { $altered.Count }
  Say ("   Tally: {0} new, {1} altered (wanted {2})" -f $newV.Count, $altered.Count, $n)
  foreach ($x in $aRows | Where-Object { $_.company -eq $coTag -and $_.cfg -eq $cfg -and $_.kind -eq $kind -and $_.mode -eq $mode }) { $x | Add-Member -NotePropertyName tally_did -NotePropertyValue $ok -Force }
  return , $newV
}
function Posting($cfg, $coTag, $route, $i) {
  $id = "pd-$($rel -replace '\D', '')-$coTag-$cfg-$route-$i-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
  $vx = PostingXml "push-design posting $id"
  $t0 = NowMs; $sw = [Diagnostics.Stopwatch]::StartNew(); $st = ''; $ok = $false; $handed = 0
  if ($route -like 'jobs*') {
    $j = Bridge POST '/jobs' @{ jobId = $id; company = $co; port = 9000; vouchers = @(@{ id = $id; xml = $vx }) } 30; $handed = Ms $sw
    while ($sw.Elapsed.TotalSeconds -lt 90) { $j = Bridge GET "/jobs?id=$id" $null 15; if ($j.status -in 'done', 'failed') { break }; Start-Sleep -Milliseconds 50 }
    $st = "$($j.status)"; $ok = (@($j.results)[0].ok -eq $true)
  } else {
    $r = Bridge POST '/import' @{ company = $co; port = 9000; vouchers = @(@{ id = $id; xml = $vx }) } 120; $ok = (@($r.results)[0].ok -eq $true); $st = if ($r) { 'answered' } else { 'no answer' }
  }
  $ms = Ms $sw; $t1 = NowMs
  Start-Sleep 12   # what the bridge does right after (the recorder's line, a body fetch)
  $row = [pscustomobject]@{ rel = $rel; company = $coTag; cfg = $cfg; route = $route; rep = $i; ms = $ms; handed_ms = $handed; status = $st; ok = $ok; t0 = $t0; t1 = $t1; id = $id }
  $bRows.Add($row); $row | Export-Csv $bCsv -Append -NoTypeInformation -Encoding UTF8
  Say ("-- b: {0} / {1} / {2} #{3}: {4} ms ({5}, ok {6})" -f $coTag, $cfg, $route, $i, $ms, $st, $ok)
}

# the body fetch on again: the stub cloud answers one heartbeat with recorderSource "both", then one with "addon" (the
# bridge's liveOnAgain: a source other than the one in force when a method stopped turns it on again)
$srcFile = Join-Path $out 'stub-source.txt'
function Beats { @(Get-Content $stubLog -ErrorAction SilentlyContinue | Where-Object { $_ -match '"kind": "beat"' }).Count }
function BodyFetchOn {
  foreach ($v in 'both', 'addon') {
    Set-Content $srcFile $v -Encoding ASCII; $n0 = Beats; $sw = [Diagnostics.Stopwatch]::StartNew()
    while ((Beats) -le $n0 -and $sw.Elapsed.TotalSeconds -lt 75) { Start-Sleep 1 }
  }
  Remove-Item $srcFile -ErrorAction SilentlyContinue
  $off = @(Get-Content $blog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'on again for' } | Select-Object -Last 1)
  Say "body fetch: recorderSource both -> addon sent by the stub cloud ($(if ($off) { $off[0].Trim() } else { 'nothing was off' }))"
}
function PostSet($cfg, $coTag) {
  if ($cfg -ne 'none') { BodyFetchOn }
  for ($i = 1; $i -le $posts; $i++) { Posting $cfg $coTag 'jobs' $i }
  for ($i = 1; $i -le [math]::Max(2, [int]($posts / 2)); $i++) { Posting $cfg $coTag 'import' $i }
  # the owner's pattern: an entry saved by hand in Tally, FinCom's posting a moment later (with the add-on the bridge
  # reads the saved entry back from Tally by MasterID: does the posting wait behind that read?)
  if ($cfg -notlike '*gentle0') {
    for ($i = 1; $i -le [math]::Max(2, [int]($posts / 2)); $i++) {
      DayBook '2-10-2026' $(if ($i -eq 1) { "$coTag-$cfg-aftersave-daybook" }); KeysTo '{END}' 1; KeysTo '%2' 3
      if (Focus) { [System.Windows.Forms.SendKeys]::SendWait('^a') }
      Start-Sleep -Milliseconds 300
      Posting $cfg $coTag 'jobs-aftersave' $i
    }
  }
}

$tdlFull = "$fc\FCPFull.tdl"; $tdlHeads = "$fc\FCPHeads.tdl"; $tdlStamp = "$fc\FCPStamp.tdl"
Copy-Item "$here\FCPFull.tdl" $tdlFull -Force; Copy-Item "$here\FCPHeads.tdl" $tdlHeads -Force; Copy-Item "$here\FCPStamp.tdl" $tdlStamp -Force
$evs = @(Get-ChildItem $here -Filter 'FCPEv_*.tdl' | ForEach-Object { $d = "$fc\$($_.Name)"; Copy-Item $_.FullName $d -Force; $d })
$cfgs = [ordered]@{ none = @(); stamp = @($tdlStamp); heads = @($tdlHeads); full = @($tdlFull) }

# ---------------------------------------------------------------- the owner's second ask: does the hook fire, what is written
# light company; today's heads-only add-on (FCPHeads.tdl: [#Form: Voucher], [#Form: Ledger], the events) and the full-entry
# add-on (FCPFull.tdl with the FCPM_*.tdl master-form files beside it). Each voucher type: its template duplicated
# (Alt+2, Ctrl+A) and altered (Enter, Ctrl+A); each master form: one master altered (Gateway > Alter, Ctrl+A); a payroll
# voucher cancelled and a stock journal deleted. Tally's own copy of every voucher of those days is kept beside the lines.
$mfs = @(Get-ChildItem $here -Filter 'FCPM_*.tdl' | ForEach-Object { $d = "$fc\$($_.Name)"; Copy-Item $_.FullName $d -Force; $d })
$mCsv = Join-Path $out 'm.csv'
$masters = [ordered]@{ 'Ledger' = 'Template Party'; 'Pay Head' = 'PD Basic'; 'Stock Item' = 'PD Bat 01'; 'Unit' = 'Nos'; 'Godown' = 'PD Godown A'; 'Employee' = 'PD Emp 001' }
# the object type each master form saves, and the master-form files loaded beside FCPFull.tdl for it (one start each, so a
# file with an error shows as Tally's warning on that start only)
$mType = @{ 'Ledger' = 'Ledger'; 'Pay Head' = 'Ledger'; 'Stock Item' = 'StockItem'; 'Unit' = 'Unit'; 'Godown' = 'Godown'; 'Employee' = 'CostCentre' }
$mFiles = @{ 'Ledger' = @(); 'Pay Head' = @('FCPM_PayHead'); 'Stock Item' = @('FCPM_StockItem'); 'Unit' = @('FCPM_Unit'); 'Godown' = @('FCPM_Godown', 'FCPM_Location'); 'Employee' = @('FCPM_Employee', 'FCPM_CostCentre') }
function MasterAid($form, $name) { $x = Post (Coll 'FCPMa' $mType[$form] 'NAME, ALTERID' "`$Name = `"$name`""); return [int]('0' + [regex]::Match($x, '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value) }
function MasterAlter($cfg, $tdls, $form, $name) {
  $extra = @($mFiles[$form] | ForEach-Object { "$fc\$_.tdl" })
  $all = if ($cfg -eq 'full') { @($tdls) + $extra } else { @($tdls) }
  if (-not (Start-T $light $all "types-$cfg-m-$($form -replace ' ', '')")) { return }
  $warned = $script:tdlWarned
  Get-ChildItem $pd -Filter 'stamp-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  NewFullLines | Out-Null; NewRecLines | Out-Null
  $t = $form -replace ' ', ''; $aid0 = MasterAid $form $name; $saved = $false; $how = ''
  # Gateway > Alter ('a'), then the master's type and its name (3.0: Ledger, Stock Item ...; 7.1 calls godowns
  # "Location", whose masters are listed by name in the same list); Ctrl+A; 'y' answers 3.0's GST question
  foreach ($path in @(@($form, $name), @($name))) {
    KeysTo 'a' 3 "types-$cfg-m-$t-0"
    foreach ($k in $path) { KeysTo $k 2; KeysTo '{ENTER}' 3 }
    Shot "types-$cfg-m-$t-form"
    if (Focus) { if ($script:noUiTimer) { [System.Windows.Forms.SendKeys]::SendWait('^a') } else { [PdUi]::Measure('^a', 400, 15000) | Out-Null } }
    Start-Sleep 2; Shot "types-$cfg-m-$t-after"; KeysTo 'y' 3
    $aid1 = MasterAid $form $name
    if ($aid1 -gt $aid0) { $saved = $true; $how = $path -join ' > '; break }
    foreach ($i in 1..3) { KeysTo '{ESC}' 1 }; Shot "types-$cfg-m-$t-back"
    if (-not (Start-T $light $all "types-$cfg-m-$t-again")) { return }
  }
  $h = Stamps; $fl = NewFullLines; $rl = NewRecLines
  $row = [pscustomobject]@{ rel = $rel; cfg = $cfg; form = $form; master = $name; saved = $saved; via = $how; aid0 = $aid0; aid1 = $aid1; tdl_warning = $warned; files = ($mFiles[$form] -join ','); stamps = (($h.Keys | Sort-Object) -join ','); full_lines = $fl.Count; rec_lines = $rl.Count
    full_events = (($fl | ForEach-Object { [regex]::Match($_, '^FCF1\|ev=([^|]+)').Groups[1].Value }) -join ' '); rec_events = (($rl | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) -join ' ') }
  $row | Export-Csv $mCsv -Append -NoTypeInformation -Encoding UTF8
  if ($fl.Count -or $rl.Count) { Set-Content (Join-Path $cap "master-$cfg-$t.txt") (@($fl) + @($rl)) -Encoding UTF8 }
  Say "   master $form '$name' ($cfg): saved $saved (AlterID $aid0 -> $aid1, $how); TDL warning $warned; stamps $($row.stamps); full lines $($fl.Count) ($($row.full_events)); recorder lines $($rl.Count) ($($row.rec_events))"
}
function TypesStage {
  foreach ($cfg in 'heads', 'full') {
    Remove-Item "$pd\full-*.txt", "$pd\stamp-*.txt", "$rec\*" -Force -ErrorAction SilentlyContinue; $script:fullSeen = @{}; $script:recSeen = @{}
    $tdls = if ($cfg -eq 'full') { @($tdlFull) } else { @($tdlHeads) }
    if (-not (Start-T $light $tdls "types-$cfg")) { Say "HARNESS: types-$cfg did not open the company"; continue }
    foreach ($k in $typeTpl.Keys) {
      if ($typeOk[$k].created -lt 1) { Say "types: $k has no template in Tally ($($typeOk[$k].err)): skipped"; continue }
      SaveBlock "types-$cfg" 'light' $k (DMY $TypeDates[$k]) 1 'dup' | Out-Null
      SaveBlock "types-$cfg" 'light' $k (DMY $TypeDates[$k]) 1 'alter' | Out-Null
      $d = $TypeDates[$k]
      Post (Coll "FCPTyp$k" 'Voucher' 'NAME' "`$Date = `$`$Date:`"$(DMY $d)`"" '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 120 | Set-Content (Join-Path $cap "tally-type-$k-after-$cfg.xml") -Encoding UTF8
    }
    # a payroll voucher cancelled, a stock journal deleted (the events of today's add-on and of FCPFull)
    NewFullLines | Out-Null; NewRecLines | Out-Null
    if ($typeOk['payroll50'].created -ge 1) { DayBook (DMY $TypeDates.payroll50) "types-$cfg-cancel-daybook"; KeysTo '{END}' 1; KeysTo '%x' 3; KeysTo 'y' 4 "types-$cfg-cancelled" }
    if ($typeOk['stockjournal'].created -ge 1) { DayBook (DMY $TypeDates.stockjournal) "types-$cfg-delete-daybook"; KeysTo '{END}' 1; KeysTo '%d' 3; KeysTo 'y' 4 "types-$cfg-deleted" }
    Start-Sleep 2; $fl = NewFullLines; $rl = NewRecLines
    Set-Content (Join-Path $cap "types-$cfg-cancel-delete-lines.txt") (@($fl) + @($rl)) -Encoding UTF8
    Say "   cancel / delete ($cfg): full lines $(($fl | ForEach-Object { [regex]::Match($_, '^FCF1\|ev=([^|]+)').Groups[1].Value }) -join ' '); recorder lines $(($rl | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) -join ' ')"
    foreach ($f in $masters.Keys) { MasterAlter $cfg $tdls $f $masters[$f] }
    Get-ChildItem $pd -Filter 'full-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "fullfile-types-$cfg-$($_.Name)") }
    Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recfile-types-$cfg-$($_.Name)") }
  }
  Stop-T
}
function KeepTallyLogs { Get-ChildItem $dir, $light -Recurse -File -Include *.log, tdlerr*, *.err -ErrorAction SilentlyContinue | Select-Object -First 20 | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "tally-$($_.Directory.Name)-$($_.Name)") -ErrorAction SilentlyContinue } }
if ($env:PD_MODE -in 'v3', 'v3b') { try { if ($env:PD_MODE -eq 'v3b') { V3B } else { V3Main } } catch { Say "HARNESS: v3 stopped: $_ $($_.ScriptStackTrace)" }; Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue; KeepTallyLogs; Stop-T; Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force; Stop-Proxy; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue; Say 'done (v3)'; return }
if ($env:PD_MODE -eq 'explore') { TypesStage; KeepTallyLogs; Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue; Say 'done (explore: the voucher-type probe only)'; return }
foreach ($coTag in 'light', 'heavy') {
  $data = if ($coTag -eq 'light') { $light } else { $heavy }
  if ($coTag -eq 'heavy' -and -not $heavyOk) { Say 'heavy company not made: skipped'; continue }
  foreach ($cfg in $cfgs.Keys) {
    Remove-Item "$pd\full-*.txt", "$pd\stamp-*.txt", "$rec\*" -Force -ErrorAction SilentlyContinue; $script:fullSeen = @{}; $script:recSeen = @{}
    if (-not (Start-T $data $cfgs[$cfg] "$coTag-$cfg")) { Say "HARNESS: Tally did not open the company ($coTag / $cfg)"; continue }
    Start-Sleep 5; BridgeLog "$coTag-$cfg-start"
    # part b first, while nobody works in Tally's screens (run 37450532756: a body fetch timed while a voucher form was
    # open took 2.2 s, the bridge's 2 s rule switched the body fetch off for the rest of the run, so the add-on's
    # postings were timed without it); the stub cloud turns it on again before each set (BodyFetchOn)
    if ($cfg -ne 'stamp') { PostSet $cfg $coTag }
    $nv = @()
    $nv += SaveBlock $cfg $coTag 'receipt' '1-10-2026' $reps 'dup'
    $nv += SaveBlock $cfg $coTag 'sales5' '2-10-2026' $reps 'dup'
    $nv += SaveBlock $cfg $coTag 'sales50' '31-10-2026' $reps 'dup'
    SaveBlock $cfg $coTag 'sales50' '31-10-2026' ([math]::Max(2, [int]($reps / 2))) 'alter' | Out-Null
    # the owner's second ask: payroll for 50 and 200 employees, a stock journal with 50 items, a sales invoice with 50
    # items across batches and godowns
    foreach ($k in 'payroll50', 'payroll200', 'stockjournal', 'salesbatch') {
      if ($typeOk[$k].created -ge 1) { $nv += SaveBlock $cfg $coTag $k (DMY $TypeDates[$k]) $reps 'dup' } else { Say "   $k skipped: its template is not in Tally" }
    }
    # part c: Tally's own ids and the 2.3.1 body of the vouchers the full add-on wrote, beside its lines
    if ($cfg -eq 'full') {
      $tvx = OctVouchers; $tvx | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap "tally-ids-$coTag-full.json") -Encoding UTF8
      foreach ($v in $nv | Group-Object type | ForEach-Object { $_.Group | Select-Object -Last 1 }) { Body231 $v.mid "tally-body231-$coTag-$($v.type)-$($v.vno).xml" | Out-Null }
      if ($coTag -eq 'light') {
        # a ledger created by keys, then a voucher cancelled and one deleted (the lines carry the GUID?)
        # Tally started again (it opens at the Gateway), then Create > Ledger as flow.ps1 does
        Start-T $data $cfgs[$cfg] "$coTag-full-again" | Out-Null
        KeysTo 'c' 3; KeysTo 'Ledger{ENTER}' 3 "$coTag-full-ledger-form"
        KeysTo 'PD Keys Party{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo 'Sundry Debtors{ENTER}' 2; KeysTo '^a' 4 "$coTag-full-ledger-saved"
        DayBook '1-10-2026' "$coTag-full-cd-daybook"; KeysTo '{END}' 1; KeysTo '{UP}' 1; KeysTo '%x' 3; KeysTo 'y' 4 "$coTag-full-cancelled"
        DayBook '1-10-2026' "$coTag-full-cd-daybook2"; KeysTo '{END}' 1; KeysTo '%d' 3; KeysTo 'y' 4 "$coTag-full-deleted"; KeysTo '{ESC}' 1
        Post (Coll 'FCPLed' 'Ledger' 'NAME, GUID, MASTERID, ALTERID' '$Name = "PD Keys Party"') | Set-Content (Join-Path $cap 'tally-ledger-keys.xml') -Encoding UTF8
        OctVouchers | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap "tally-ids-$coTag-after-cancel-delete.json") -Encoding UTF8
      }
    }
    BridgeLog "$coTag-$cfg"
    # every file kept under its own name (run 37450532756: a second file, e.g. one written with no company GUID during an
    # import, overwrote the first)
    Get-ChildItem $pd -Filter 'full-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "fullfile-$coTag-$cfg-$($_.Name)") }
    Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recfile-$coTag-$cfg-$($_.Name)") }
  }
  # the candidate events: FCPFull plus each FCPEv_*.tdl (light only; a create, an alter, an import)
  if ($coTag -eq 'light') {
    Remove-Item "$pd\full-*.txt", "$pd\ev-*.txt" -Force -ErrorAction SilentlyContinue; $script:fullSeen = @{}; $script:recSeen = @{}
    if (Start-T $data (@($tdlFull) + $evs) 'light-evprobe') {
      SaveBlock 'evprobe' $coTag 'sales5' '2-10-2026' 1 'dup' | Out-Null
      SaveBlock 'evprobe' $coTag 'sales5' '2-10-2026' 1 'alter' | Out-Null
      Posting 'evprobe' $coTag 'import' 1
      Get-ChildItem $pd -Filter 'ev-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "event-$($_.Name)") }
      Say "candidate event files written: $((Get-ChildItem $pd -Filter 'ev-*.txt' -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"
      Get-ChildItem $pd -Filter 'full-*.txt' | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "fullfile-light-evprobe-$($_.Name)") }
    }
  }
}

TypesStage

# ---------------------------------------------------------------- b again with the bridge's GentleMs at 0
# (config.go: GentleMs 150 by default, tally.go tallyRaw waits that long before EVERY request it sends Tally, a
# posting's too). The same postings with the setting at 0: the difference is what the pause costs. The bridge is not
# changed: only its config file, then the bridge started again.
& {
  $bp = (Get-Process FinComBridge -ErrorAction SilentlyContinue | Select-Object -First 1).Path
  $c0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  $c0 | Add-Member -NotePropertyName GentleMs -NotePropertyValue 0 -Force
  Set-Content "$h1\tds-bridge.config.json" ($c0 | ConvertTo-Json -Depth 8 -Compress) -Encoding UTF8
  Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  if ($bp) { Start-Process -FilePath $bp | Out-Null }
  $st = $null; for ($i = 0; $i -lt 20 -and -not $st; $i++) { Start-Sleep 3; $st = Bridge GET '/status' }
  Say "bridge started again with GentleMs 0 ($bp): version $($st.version)"
  foreach ($cfg in 'none', 'heads') {
    if (Start-T $light $cfgs[$cfg] "light-$cfg-gentle0") { Start-Sleep 5; PostSet "$cfg-gentle0" 'light'; BridgeLog "light-$cfg-gentle0" }
  }
}

# ---------------------------------------------------------------- kept
Stop-T
Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue
KeepTallyLogs
Get-Process FinComBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-Proxy; Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
Say 'done'
