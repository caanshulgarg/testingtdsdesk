# bankv.ps1 - mode "bank" (the owner's decision of 08-Oct-2026: "bank date: probe first, then fallback as agreed"), and
# mode "bankb" (next-bankdate: the fallback with the bridge built from the ref; its part is "---- bankb" below).
# MEASUREMENT ONLY, nothing here ships. Dot-sourced by flowv.ps1 after c1-c2 (Tally started with the ref's
# FinComRecorder.tdl, the company open; no bridge). The question: when a bank date is set on Tally's screen, does any
# event an add-on can hook fire, what does it carry, and what does it cost on the save?
#   BK0  the ref's add-on only (what a customer has): a bank date set in Bank Reconciliation (Share Bank) and a voucher
#        altered through its Bank Allocations sub-screen (Zprobe Bank); each save timed (Ctrl+A to a still screen)
#   BK1  the PROBE VARIANT: the same add-on file plus small probe files (written here, in the harness only, each its own
#        file so a name a release does not know drops only that file), each hooking one candidate:
#          sys-*   [System: Events] After Alter Object / Before Alter Object / On Alter / Before Save Object /
#                  After Save Object
#          brs-*   [#Form: <name>] On : Form Accept for the Bank Reconciliation form, for each name Tally answers as a
#                  report (asked by XML first; the names it does not know are not loaded)
#          alloc-* [#Form: <name>] On : Form Accept for the Bank Allocations sub-form, likewise
#        each file also defines a collection FCRPAlive<k>: Tally answering it by XML = that file loaded
#        Every probe hook calls FCRPWrite (probe-common), one line to C:\ProgramData\FinCom\recorder\probe.txt:
#          FCRP|ev=<k>_<pre|post|sys>|t=|guid=|mid=|aid=|vtype=|vno=|vdate=|name=|parent=|ledger=|bdate=|idate=
#        BRS twice (two samples), the allocation path once
#   BK3  the ref's add-on only again, BRS once more (the second sample without the probe)
# For each step: the contra Tally bank-dated (by its own export: ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE), its
# AlterID before / after, the company's AltVchId / AltMstId before / after (nothing else done between), the add-on's
# FCR1 lines and the probe lines written during the step, Ctrl+A to a still screen in ms.
# Every Tally request capped at 30 s; a request that times out restarts Tally (fresh) before the next step.
# Lists are taken whole first and searched with foreach (never piped from a function's return into Where-Object).
Say '---- bank: does any event fire when a bank date is set (probe), and what it costs'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$bkIni = @($tdl)   # the TDL files Tally is started with (the phase sets it)
function BkIni {
  $l = @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $($folder.Name)")
  foreach ($f in $script:bkIni) { $l += "TDL = $f" }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  Info "tally.ini TDL lines: $(($script:bkIni | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')"
}
$script:TdsRestart = {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; $null = TdsScreen 'bk-start-1'; KeysTo 'a' 4; KeysTo 't' 10
  # (run 37770857500: after an Internal Error Tally came up on its Startup Report, a TDL-error warning ("Press any key")
  # or its License screen, and 'a' went to "Activate New License": each read and answered)
  for ($s = 0; $s -lt 6; $s++) {
    $t = TdsScreen "bk-start-$($s + 2)"
    if ($t -match 'ignore the TDLs') { Add-Content -Path $resultsFile -Value 'INFO at start Tally said: TallyPrime will ignore the TDLs that have errors' -Encoding UTF8 }
    if ($t -match 'Internal Error') { Add-Content -Path $resultsFile -Value 'INFO at start Tally showed an Internal Error' -Encoding UTF8 }
    if ($t -match 'Press any key') { KeysTo '{ENTER}' 3; continue }
    if ($t -match 'Activate License|Serial Number') { KeysTo '{ESC}' 3; continue }
    if ($t -match 'Try It For Free|Welcome to TallyPrime') { KeysTo 't' 8; continue }
    if ($t -match 'Startup Report|Application Startup') { KeysTo '^a' 5; continue }
    if ($t -match 'Internal Error') { KeysTo '{ENTER}' 3; continue }
    break
  }
}
$script:bkStuck = $false
function BkPost($x) { $a = Post $x '' 30; if (-not $a -and ($script:lastMs -ge 29000 -or -not (Get-Process -Id $script:tpid -ErrorAction SilentlyContinue))) { $script:bkStuck = $true; Write-Host '::warning::a Tally request took 30 s (or Tally is gone): Tally will be started afresh'; Add-Content -Path $resultsFile -Value "INFO a Tally request took $($script:lastMs) ms with no answer: Tally started afresh before the next step" -Encoding UTF8 }; return $a }
function BkFresh($why) { Info "Tally started afresh ($why)"; & $script:TdsRestart; $script:bkStuck = $false; $null = TdsGateway "fresh $why" }

# ---- timing: a key, then the screen watched until it stays still 600 ms (masterhook233.ps1's method)
Add-Type -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class BKT {
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
  // mod: 0 none, 0x11 Ctrl; vk: the key. Returns "first;last" ms (screen first changed; last changed before 600 ms still)
  public static string Press(byte mod, byte vk, int stableMs, int maxMs) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr), bits;
    BMIH bi = new BMIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0), old = SelectObject(mem, dib);
    try {
      long prev = Hash(mem, scr, bits, w, h);
      Stopwatch sw = Stopwatch.StartNew();
      if (mod != 0) keybd_event(mod, 0, 0, UIntPtr.Zero);
      keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero);
      if (mod != 0) keybd_event(mod, 0, 2, UIntPtr.Zero);
      double first = -1, last = -1;
      while (sw.ElapsedMilliseconds < maxMs) {
        long x = Hash(mem, scr, bits, w, h); double t = sw.Elapsed.TotalMilliseconds;
        if (x != prev) { if (first < 0) first = t; last = t; prev = x; }
        else if (first >= 0 && t - last >= stableMs) break;
        Thread.Sleep(5);
      }
      return string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0.0};{1:0.0}", first, last);
    } finally { SelectObject(mem, old); DeleteObject(dib); DeleteDC(mem); ReleaseDC(IntPtr.Zero, scr); }
  }
}
'@ -ErrorAction SilentlyContinue
# Ctrl+A timed (Tally in front first); "Yes or No" after it answered y, also timed; returns total ms of the save
function BkSave($tag) {
  KeysTo '' 0
  $a = [BKT]::Press(0x11, 0x41, 600, 15000); $ms = [double](($a -split ';')[1])
  $t = TdsScreen "$tag-saved"
  if ($t -match 'Accept \?|Yes or No') { KeysTo '' 0; $b = [BKT]::Press(0, 0x59, 600, 15000); $ms += [double](($b -split ';')[1]); $a += " + y $b"; $null = TdsScreen "$tag-saved-y" }
  Say "$tag save: $a"
  return [pscustomobject]@{ ms = [int]$ms; raw = $a }
}

# ---- what Tally holds
$tg = { param($x, $t) [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", "<$t(?:\s[^>]*)?>([^<]*)</$t>").Groups[1].Value).Trim() }
function BkContras {
  $x = BkPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BkC</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="BkC" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, VOUCHERNUMBER, DATE, NARRATION, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE</FETCH><FILTERS>BkCF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="BkCF">$VoucherTypeName = "Contra"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $l = @()
  foreach ($v in [regex]::Matches("$x", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) {
    $bd = [regex]::Match($v.Value, '<BANKERSDATE[^>]*>\s*(\d+)\s*<').Groups[1].Value
    $l += [pscustomobject]@{ guid = (& $tg $v.Value 'GUID'); mid = [int64]('0' + (& $tg $v.Value 'MASTERID')); aid = [int64]('0' + (& $tg $v.Value 'ALTERID')); vno = (& $tg $v.Value 'VOUCHERNUMBER'); narr = (& $tg $v.Value 'NARRATION'); bdate = $bd }
  }
  return , $l
}
function BkCo {
  $x = BkPost '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BkCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="BkCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>AltVchId</NATIVEMETHOD><NATIVEMETHOD>AltMstId</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  [pscustomobject]@{ vch = (& $tg $x 'ALTVCHID'); mst = (& $tg $x 'ALTMSTID') }
}
function BkFind($list, $narr) { foreach ($v in $list) { if ($v.narr -eq $narr) { return $v } }; return $null }
function BkFindMid($list, $mid) { foreach ($v in $list) { if ($v.mid -eq $mid) { return $v } }; return $null }
function BkRec { $o = @(); foreach ($f in @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Sort-Object Name)) { if ($f.Name -ne 'probe.txt') { foreach ($l in @(Get-Content $f.FullName -Encoding Unicode)) { if ($l -like 'FCR1|*') { $o += $l } } } }; return , $o }
function BkProbe { $p = Join-Path $rec 'probe.txt'; if (Test-Path $p) { return , @(Get-Content $p -Encoding Unicode) }; return , @() }
function BkEvs($lines) { $h = [ordered]@{}; foreach ($l in $lines) { $e = [regex]::Match($l, '^FCR[1P]\|ev=([^|]+)').Groups[1].Value; if ($h.Contains($e)) { $h[$e]++ } else { $h[$e] = 1 } }; return (($h.Keys | ForEach-Object { "$_ x$($h[$_])" }) -join ', ') }

# ---- masters and the contras by XML (no add-on event fires for an import: the lines start after)
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }
if (-not $bankb) {
$ms = '<LEDGER NAME="Share Bank" ACTION="Create"><NAME.LIST><NAME>Share Bank</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>' +
      '<LEDGER NAME="Zprobe Bank" ACTION="Create"><NAME.LIST><NAME>Zprobe Bank</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>'
$mr = Imp 'All Masters' $ms 'bank masters'
Info "bank masters: $(([regex]::Match("$mr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
function BkContra($narr, $date, $bank, $amt, [switch]$noAlloc) {
  $a = '{0:0.00}' -f $amt
  $al = if ($noAlloc) { '' } else { '<BANKALLOCATIONS.LIST><DATE>' + $date + '</DATE><INSTRUMENTDATE>' + $date + '</INSTRUMENTDATE><TRANSACTIONTYPE>Cash</TRANSACTIONTYPE><PAYMENTFAVOURING>' + $bank + '</PAYMENTFAVOURING><AMOUNT>-' + $a + '</AMOUNT></BANKALLOCATIONS.LIST>' }
  '<VOUCHER VCHTYPE="Contra" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Contra</VOUCHERTYPENAME><NARRATION>' + $narr + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $bank + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $a + '</AMOUNT>' + $al + '</ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$cx = ''; foreach ($i in 1..6) { $cx += BkContra "bank probe C$i" '20261002' 'Share Bank' (100 + $i) }
foreach ($i in 1..2) { $cx += BkContra "bank probe A$i" '20261001' 'Zprobe Bank' (200 + $i) }
$vr = Imp 'Vouchers' $cx 'bank contras'
$made = [int]('0' + [regex]::Match("$vr", '<CREATED>(\d+)</CREATED>').Groups[1].Value)
Info "bank contras with bank allocations (C1-C6 2-10-2026 Share Bank, A1-A2 1-10-2026 Zprobe Bank): created $made of 8; $(([regex]::Match("$vr", '<ERRORS>\d+</ERRORS>').Value)) $(([regex]::Match("$vr", '<LINEERROR>[^<]*').Value))"
if ($made -lt 8) {
  $cx = ''; foreach ($i in 1..6) { $cx += BkContra "bank probe C$i" '20261002' 'Share Bank' (100 + $i) -noAlloc }; foreach ($i in 1..2) { $cx += BkContra "bank probe A$i" '20261001' 'Zprobe Bank' (200 + $i) -noAlloc }
  $vr = Imp 'Vouchers' $cx 'bank contras (no allocations)'
  Info "bank contras again with no bank allocations: $(([regex]::Match("$vr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
}
$c0 = BkContras
Set-Content (Join-Path $cap 'bank-contras-start.json') ($c0 | ConvertTo-Json -Depth 3) -Encoding UTF8
foreach ($v in $c0) { Info ("contra '{0}' mid {1} aid {2} no {3} bank date '{4}'" -f $v.narr, $v.mid, $v.aid, $v.vno, $v.bdate) }

# ---- discovery: which report names this release knows (an Export of TYPE Data by name; the answer for a name that is
# surely not there is the yardstick). Only names Tally knows get a probe file (a name it does not know would drop the file)
$ask = { param($n) BkPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>' + (SE $n) + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY><LEDGERNAME>Share Bank</LEDGERNAME></STATICVARIABLES></DESC></BODY></ENVELOPE>') }
$neg = "$(& $ask 'FCR No Such Report 77')"; $negS = ($neg -replace 'FCR No Such Report 77', '<N>' -replace '\s+', ' ')
Info "discovery yardstick (a report that is not there): $(if ($negS.Length -gt 200) { $negS.Substring(0, 200) } else { $negS })"
$pos = "$(& $ask 'Day Book')"; Info "discovery control 'Day Book': $($pos.Length) chars, known: $(($pos -replace 'Day Book', '<N>' -replace '\s+', ' ') -ne $negS)"
$brsNames = @('Bank Recon', 'Bank Reconciliation', 'BankRecon', 'Bank Recon Summary', 'Bank Reconciliation Summary', 'Manual Bank Recon', 'Bank Recon Manual', 'BRS')
$allocNames = @('Bank Allocations', 'VCH BankAllocations', 'Bank Allocation', 'VCH Bank Allocations', 'BankAllocations', 'VCH BankAllocation', 'Voucher Bank Allocations')
$known = @{}
foreach ($n in $brsNames + $allocNames) {
  if ($script:bkStuck) { BkFresh 'discovery' }
  $a = "$(& $ask $n)"; $s = ($a -replace [regex]::Escape($n), '<N>' -replace '\s+', ' ')
  $known[$n] = ($a -ne '') -and ($s -ne $negS)
  Info ("discovery '{0}': known {1} ({2} ms; {3})" -f $n, $known[$n], $script:lastMs, $(if ($s.Length -gt 160) { $s.Substring(0, 160) } else { $s }))
}
$brsUse = @($brsNames | Where-Object { $known[$_] }); if (-not $brsUse.Count) { $brsUse = @('Bank Recon', 'Bank Reconciliation') }
$allocUse = @($allocNames | Where-Object { $known[$_] }); if (-not $allocUse.Count) { $allocUse = @('Bank Allocations', 'VCH BankAllocations') }
Info "BRS form names probed: $($brsUse -join ' / '); Bank Allocations form names probed: $($allocUse -join ' / ')"
if ($script:bkStuck) { BkFresh 'after discovery' }
}   # (bankb: the contras are made by flowv.ps1 before the bridge starts; no discovery)

# ---- the steps
$script:bkRows = @()
$script:bkMarks = [ordered]@{}   # probe file -> the button title its [#Form] adds (seen on the screen = the hook attached to that form)
# Bank Reconciliation (Share Bank): the first unreconciled row's Bank Date typed; 6.x / 7.x open a summary first, whose
# "Manual Recon" button (Ctrl+R or Alt+R: both tried, the screen read) opens the screen with the Bank Date column
function BkBrs($tag) {
  if ($script:bkStuck) { BkFresh "before $tag" }
  $pre = BkContras; $co0 = BkCo; $r0 = (BkRec).Count; $p0 = (BkProbe).Count
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Bank Reconciliation' 1.5 "$tag-typed"; $null = TK '{ENTER}' 3 "$tag-select"
  $null = TK 'Share Bank{ENTER}' 3 "$tag-bank"
  $t = TdsScreen "$tag-screen"; $how = 'direct'; $tFirst = $t
  if ($t -notmatch 'Bank Date') {
    $how = 'none'
    foreach ($k in @('%r', '^r')) {
      $null = TK $k 5 "$tag-manual"; $t = TdsScreen "$tag-manual-screen"
      # (run 37763910797, 7.1: Manual Recon opens under a "Want to save your time? ... K: Know More / D: Don't Show
      # Again" box; D closes it)
      for ($q = 0; $q -lt 3 -and $t -match 'save your time|Know More|Show Again'; $q++) { $null = TK $(if ($q -lt 2) { 'd' } else { '{ESC}' }) 2.5 "$tag-popup"; $t = TdsScreen "$tag-popup-closed" }
      if ($t -match 'Bank Date') { $how = $(if ($k -eq '^r') { 'Ctrl+R Manual Recon' } else { 'Alt+R Manual Recon' }); break }
    }
  }
  $mk = @(foreach ($m in $script:bkMarks.Keys) { if ("$tFirst $t" -match $script:bkMarks[$m]) { $m } }); if ($script:bkMarks.Count) { $how += "; probe markers on the screen: $(if ($mk.Count) { $mk -join ', ' } else { 'none' })" }
  $sv = $null
  if ($t -match 'Bank Date') {
    $null = TK '2-10-2026{ENTER}' 2 "$tag-date"
    $sv = BkSave $tag
  }
  $null = TdsGateway "after $tag"
  Start-Sleep 2
  $post = BkContras; $co1n = BkCo
  $dated = $null; foreach ($v in $post) { $p = BkFindMid $pre $v.mid; if ($v.bdate -and $p -and -not $p.bdate) { $dated = $v; break } }
  # (run 37766812255, 7.1: the screen showed the bank date and the contra's AlterID moved, but ALLLEDGERENTRIES.BANKALLOCATIONS
  # .BANKERSDATE stayed empty: the contra whose AlterID moved is taken, and its whole stored form kept to see where 7.1 keeps it)
  $byAid = $false
  if (-not $dated) { foreach ($v in $post) { $p = BkFindMid $pre $v.mid; if ($p -and $v.aid -ne $p.aid -and $v.narr -like 'bank probe C*') { $dated = $v; $byAid = $true; break } } }
  if ($dated) {
    $full = BkPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BkW</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="BkW" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*</FETCH><FILTERS>BkWF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="BkWF">$MasterID = ' + (TdsMid $dated.mid) + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
    Set-Content (Join-Path $cap "$tag.dated-voucher.xml") $full -Encoding UTF8
    $dt = @([regex]::Matches("$full", '<([A-Z.]*DATE[A-Z]*)[^>]*>\s*(2026\d{4})\s*<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" } | Select-Object -Unique)
    Info "$tag the dated contra stored whole: every date field: $($dt -join ', ')"
  }
  $p = if ($dated) { BkFindMid $pre $dated.mid } else { $null }
  $allR = BkRec; $allP = BkProbe; $nr = @($allR | Select-Object -Skip $r0); $np = @($allP | Select-Object -Skip $p0)
  $mine = if ($dated) { @($nr | Where-Object { $_ -match "\|mid=$($dated.mid)\|" }).Count } else { 0 }
  Set-Content (Join-Path $cap "$tag.fcr1.txt") $nr -Encoding UTF8; Set-Content (Join-Path $cap "$tag.probe.txt") $np -Encoding UTF8
  $state = if (-not $dated) { 'HARNESS' } else { 'INFO' }
  $row = [pscustomobject]@{ tag = $tag; path = 'brs'; how = $how; dated = $(if ($dated) { $dated.narr } else { '' }); mid = $(if ($dated) { $dated.mid } else { 0 }); aid0 = $(if ($p) { $p.aid } else { '' }); aid1 = $(if ($dated) { $dated.aid } else { '' }); vch0 = $co0.vch; vch1 = $co1n.vch; mst0 = $co0.mst; mst1 = $co1n.mst; ms = $(if ($sv) { $sv.ms } else { -1 }); raw = $(if ($sv) { $sv.raw } else { '' }); fcr1 = (BkEvs $nr); fcr1mid = $mine; probe = (BkEvs $np) }
  $script:bkRows += $row
  Result "$tag bank date in Bank Reconciliation" $state ("{0}: {1}; AlterID {2} -> {3}; company AltVchId {4} -> {5}, AltMstId {6} -> {7}; Ctrl+A to a still screen {8} ms ({9}); add-on FCR1 lines: {10} (for its MasterID: {11}); probe lines: {12}" -f $how, $(if ($dated) { "Tally bank-dated '$($dated.narr)' (mid $($dated.mid), bank date '$($dated.bdate)'$(if ($byAid) { ', found by its AlterID: no BANKERSDATE in the export' }))" } else { 'no contra got a bank date (see tds-*-' + $tag + '-* screenshots)' }), $row.aid0, $row.aid1, $row.vch0, $row.vch1, $row.mst0, $row.mst1, $row.ms, $row.raw, $(if ($row.fcr1) { $row.fcr1 } else { 'none' }), $mine, $(if ($row.probe) { $row.probe } else { 'none' }))
}
# a contra of 1-10-2026 (Zprobe Bank) opened from the Day Book ({END}, then $ups x {UP}), Enter through it to its Bank
# Allocations sub-screen (read: is there a Bank Date field?), the sub-screen accepted, the entry saved (timed)
function BkAlloc($tag, [int]$ups) {
  if ($script:bkStuck) { BkFresh "before $tag" }
  $pre = BkContras; $co0 = BkCo; $r0 = (BkRec).Count; $p0 = (BkProbe).Count
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Day Book' 1.5; $null = TK '{ENTER}' 3 "$tag-daybook" 'Day Book'
  $null = TK '{F2}' 1.5 "$tag-db-date"; $null = TK '1-10-2026{ENTER}' 3 "$tag-db-dated"
  $null = TK '{END}' 1.5 "$tag-db-last"; for ($i = 0; $i -lt $ups; $i++) { $null = TK '{UP}' 1 }
  $null = TK '{ENTER}' 3 "$tag-open" 'Alterati|Contra'
  $seen = $false; $hasBD = $false; $atxt = ''
  for ($j = 1; $j -le 10; $j++) {
    $t = TdsScreen "$tag-walk$j"
    if ($t -match 'Kiwi Mark') { $script:kiwi = $true }
    if ($t -match 'Bank Allocation|Bank Details') { $seen = $true; $hasBD = $t -match 'Bank Date'; $atxt = $t; break }
    if ($t -match 'Accept \?|Yes or No') { break }
    KeysTo '{ENTER}' 1.5
  }
  $sv = $null
  if ($seen) {
    $null = TK '^a' 2.5 "$tag-alloc-accepted"
    for ($j = 1; $j -le 3; $j++) { $t = TdsScreen "$tag-after-alloc$j"; if ($t -match 'Bank Allocation|Bank Details') { $null = TK '^a' 2 } else { break } }
    $sv = BkSave $tag
    $t = TdsScreen "$tag-after-save"
    if ($t -match 'Alterati') { $null = TK '^a' 3 "$tag-again"; $t = TdsScreen "$tag-again2"; if ($t -match 'Yes or No') { KeysTo 'y' 2 } }
  }
  $null = TdsGateway "after $tag"
  Start-Sleep 2
  $post = BkContras; $co1n = BkCo
  $tgt = $null; foreach ($v in $post) { $p = BkFindMid $pre $v.mid; if ($p -and $v.aid -ne $p.aid) { $tgt = $v; break } }
  $p = if ($tgt) { BkFindMid $pre $tgt.mid } else { $null }
  $allR = BkRec; $allP = BkProbe; $nr = @($allR | Select-Object -Skip $r0); $np = @($allP | Select-Object -Skip $p0)
  $mine = if ($tgt) { @($nr | Where-Object { $_ -match "\|mid=$($tgt.mid)\|" }).Count } else { 0 }
  Set-Content (Join-Path $cap "$tag.fcr1.txt") $nr -Encoding UTF8; Set-Content (Join-Path $cap "$tag.probe.txt") $np -Encoding UTF8
  $row = [pscustomobject]@{ tag = $tag; path = 'alloc'; how = "Bank Allocations seen $seen, a Bank Date field on it $hasBD$(if ($script:bkMarks.Count) { "; the control button (Kiwi Mark) on the voucher screen: $([bool]$script:kiwi)" })"; dated = $(if ($tgt) { $tgt.narr } else { '' }); mid = $(if ($tgt) { $tgt.mid } else { 0 }); aid0 = $(if ($p) { $p.aid } else { '' }); aid1 = $(if ($tgt) { $tgt.aid } else { '' }); vch0 = $co0.vch; vch1 = $co1n.vch; mst0 = $co0.mst; mst1 = $co1n.mst; ms = $(if ($sv) { $sv.ms } else { -1 }); raw = $(if ($sv) { $sv.raw } else { '' }); fcr1 = (BkEvs $nr); fcr1mid = $mine; probe = (BkEvs $np) }
  $script:bkRows += $row
  Result "$tag voucher altered through its Bank Allocations" $(if ($tgt) { 'INFO' } else { 'HARNESS' }) ("{0}; {1}; AlterID {2} -> {3}; company AltVchId {4} -> {5}; Ctrl+A to a still screen {6} ms ({7}); add-on FCR1 lines: {8} (for its MasterID: {9}); probe lines: {10}; the sub-screen read: {11}" -f $row.how, $(if ($tgt) { "saved '$($tgt.narr)' (mid $($tgt.mid), bank date now '$($tgt.bdate)')" } else { 'no contra saved (see tds-*-' + $tag + '-* screenshots)' }), $row.aid0, $row.aid1, $row.vch0, $row.vch1, $row.ms, $row.raw, $(if ($row.fcr1) { $row.fcr1 } else { 'none' }), $mine, $(if ($row.probe) { $row.probe } else { 'none' }), $(if ($atxt.Length -gt 300) { $atxt.Substring(0, 300) } else { $atxt }))
}

# ---- bankb (branch next-bankdate, the owner's agreed fallback; the bridge built from the ref, stubr.py as FinCom's cloud,
# flowv.ps1 made the contras C1-C4 of 2-10-2026 before the bridge started). Two bank dates set in Bank Reconciliation (no
# add-on line is written for them); within 14 minutes (the bridge's light check comes every 10 minutes a company) FinCom's
# copy must hold, for every contra, Tally's bank date (as Tally's own object export of the voucher gives it) at Tally's
# AlterID. Evidence: the bridge's "Bank dates:" log lines, its altered lines with source "bankdate" (one per bank-dated
# contra), the stub's copy before and after. A contra Tally did not bank-date (keys that did not reach the screen): HARNESS.
if ($bankb) {
  Say '---- bankb: bank dates set in Bank Reconciliation reach FinCom (the bridge from the ref, stubr.py as the cloud)'
  $check = 'b1 bank dates set in Bank Reconciliation reach FinCom'
  function StubCopy { try { $j = (Invoke-WebRequest 'http://127.0.0.1:8787/copy' -UseBasicParsing -TimeoutSec 20).Content; return , @(($j | ConvertFrom-Json) | ForEach-Object { $_ }) } catch { return , @() } }
  function StubPost($o) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/' -Method Post -Body ($o | ConvertTo-Json -Depth 6 -Compress) -ContentType 'application/json' -TimeoutSec 20 } catch { Write-Host "stub: $_" } }
  # Tally's own whole voucher (the object export, as the bridge's FinComVoucherObject; a FETCHLIST always: without one Tally froze)
  function BkObj($mid) {
    $x = BkPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:' + $mid + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST><FETCH>GUID</FETCH><FETCH>MASTERID</FETCH><FETCH>ALTERID</FETCH><FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>')
    [pscustomobject]@{ mid = $mid; guid = (& $tg $x 'GUID'); aid = [int64]('0' + [regex]::Match("$x", '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value); bdate = [regex]::Match("$x", '<BANKERSDATE[^>]*>\s*(\d+)\s*<').Groups[1].Value }
  }
  # (run 37796385020: @(BkContras) wrapped the list BkContras returns whole into ONE item, so every contra read as one: the
  # list is taken whole into a variable first, as everywhere in this file)
  function BkTally { $o = @(); $cl = BkContras; foreach ($v in $cl) { $b = BkObj $v.mid; $o += [pscustomobject]@{ mid = $v.mid; guid = $v.guid; narr = $v.narr; vno = $v.vno; aid = $b.aid; bdate = $b.bdate } }; return , $o }
  function BkList($l) { ($l | Sort-Object mid | ForEach-Object { "mid $($_.mid) '$($_.narr)' AlterID $($_.aid) bank date '$($_.bdate)'" }) -join '; ' }
  try {
    # 0. the bridge's first light check: its starting point and the bank route's first number (the contras are below them)
    $bkSeen = $false
    for ($i = 0; $i -lt 80 -and -not $bkSeen; $i++) { if (Test-Path $blog) { $bkSeen = [bool](Select-String -Path $blog -Pattern 'Bank dates: .*following' -Quiet) }; if (-not $bkSeen) { Start-Sleep 3 } }
    Info "bankb: the bridge's bank route started (its first light check) before the bank dates: $bkSeen"
    $t0l = BkTally
    $null = StubPost @{ kind = '_seed'; entries = @($t0l | ForEach-Object { @{ mid = $_.mid; guid = $_.guid; day = '20261002'; no = $_.vno; alter = $_.aid; type = 'Contra'; bdate = $_.bdate } }) }
    Info "bankb: Tally's contras (FinCom's copy seeded with them, as from a Day Book upload): $(BkList $t0l)"
    Snap 'bankb-seeded'
    $m0 = Mark
    # 1. two bank dates on the screen (the first unreconciled row each time)
    BkBrs 'B1-brs'
    BkBrs 'B2-brs'
    $t0 = Get-Date
    $t1l = BkTally
    $dated = @($t1l | Where-Object { $o = $_; $p = @($t0l | Where-Object mid -eq $o.mid)[0]; $_.bdate -and $p -and -not $p.bdate })
    Info "bankb: Tally after the bank dates: $(BkList $t1l)"
    # 2. FinCom's copy until it holds Tally's bank date and AlterID for every contra (14 minutes at most)
    $cp = @(); $miss = @($t1l)
    $until = (Get-Date).AddMinutes(14)
    while ((Get-Date) -lt $until) {
      $cp = StubCopy
      $miss = @($t1l | Where-Object { $o = $_; $c = @($cp | Where-Object { $_.guid -eq $o.guid })[0]; -not $c -or "$($c.bdate)" -ne "$($o.bdate)" -or [int64]$c.alter -ne $o.aid })
      if ($dated.Count -and -not $miss.Count) { break }
      Start-Sleep 10
    }
    $sec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 0)
    Snap 'bankb-after'
    $reqs = @(StubReqs | Select-Object -Skip $m0)
    $bl = @($reqs | Where-Object kind -eq 'recorder_lines' | ForEach-Object { @($_.body.lines) } | Where-Object { $_.source -eq 'bankdate' })
    $per = @($bl | Group-Object master_id | ForEach-Object { "mid $($_.Name) x$($_.Count)" })
    $twice = @($bl | Group-Object master_id | Where-Object Count -gt 1)
    $logl = @(Get-Content $blog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Bank dates:' })
    $st = if (-not $dated.Count) { 'HARNESS' } elseif ($miss.Count -or $twice.Count) { 'FAIL' } else { 'PASS' }
    Result $check $st ("Tally bank-dated {0} contra(s): {1}; FinCom's copy {2} after {3} s; {4} altered line(s) from the bridge (source bankdate): {5}; bridge log: {6}" -f
      $dated.Count, $(if ($dated.Count) { BkList $dated } else { '-' }),
      $(if ($miss.Count) { "differs from Tally for $($miss.Count) contra(s): Tally $(BkList $miss); FinCom $((@($cp) | ForEach-Object { "mid $($_.mid) AlterID $($_.alter) bank date '$($_.bdate)'" }) -join '; ')" } else { "holds Tally's bank date and AlterID for every contra ($($t1l.Count))" }),
      $sec, $bl.Count, $(if ($per.Count) { $per -join ', ' } else { '-' }), $(if ($logl.Count) { ($logl | ForEach-Object { ($_ -replace '^.*?Bank dates: ', '') }) -join ' | ' } else { '(no Bank dates line)' }))
    StubCopy | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'bankb-fincom-copy.json') -Encoding UTF8
    $t1l | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'bankb-tally.json') -Encoding UTF8
  } catch { Result $check 'HARNESS' "the harness stopped: $_" }
  Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue
  Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
  Set-Content (Join-Path $out 'tds-screens.log') $script:tdsLog -Encoding UTF8
  return
}

# ---- BK0: the ref's add-on only (Tally as flowv.ps1 started it)
Say '---- BK0 the add-on of the ref only'
BkAlloc 'BK0-alloc' 0
BkBrs 'BK0-brs'

# ---- BK1: the probe variant (the ref's add-on file plus the probe files), Tally started afresh
Say '---- BK1 the probe variant'
$pd = Join-Path $fc 'probe'; New-Item -ItemType Directory -Force $pd | Out-Null
$common = @'
;; probe-common.tdl (bank-date probe, harness only): the one writer of the probe files
[Function: FCRPWrite]
    Parameter : pEv : String
    Variable  : vL  : String
    Returns   : Logical
    01 : SET : vL : "FCRP|ev=" + ##pEv + "|t=" + ($$String:$$MachineTime) + "|guid=" + ($$String:$Guid) + "|mid=" + ($$String:$MasterID) + "|aid=" + ($$String:$AlterID)
    02 : SET : vL : ##vL + "|vtype=" + ($$String:$VoucherTypeName) + "|vno=" + ($$String:$VoucherNumber) + "|vdate=" + ($$String:$Date)
    03 : SET : vL : ##vL + "|name=" + ($$String:$Name) + "|parent=" + ($$String:$Parent)
    04 : SET : vL : ##vL + "|ledger=" + ($$String:$LedgerName)
    05 : SET : vL : ##vL + "|bdate=" + ($$String:$BankersDate)
    06 : SET : vL : ##vL + "|idate=" + ($$String:$InstrumentDate)
    07 : OPEN FILE : "C:\ProgramData\FinCom\recorder\probe.txt" : Text : Write : Unicode
    08 : IF : NOT $$LastResult
    09 :    RETURN : Yes
    10 : END IF
    11 : WRITE FILE LINE : ##vL
    12 : CLOSE TARGET FILE
    13 : RETURN : Yes

[Collection: FCRPAliveCommon]
    Type : Company
'@
Set-Content (Join-Path $pd 'probe-common.tdl') $common -Encoding ASCII
$probes = [ordered]@{}
$sysEv = [ordered]@{ 'sys-afteralter' = 'After Alter Object'; 'sys-beforealter' = 'Before Alter Object'; 'sys-onalter' = 'On Alter'; 'sys-beforesave' = 'Before Save Object'; 'sys-aftersave' = 'After Save Object' }
foreach ($k in $sysEv.Keys) { $probes[$k] = "[System: Events]`r`n    FCRP$($k -replace '\W', '') : $($sysEv[$k]) : Yes : Call : FCRPWrite : `"$k`"`r`n" }
$markWords = @('Zebra Mark', 'Lotus Mark', 'Tiger Mark', 'Maple Mark', 'Coral Mark', 'Amber Mark', 'Cedar Mark', 'Delta Mark')
# (runs 37763910797 / 37766812255: Tally knows the REPORTS Bank Recon and BankRecon on every release, but a button added
# to [#Form: Bank Recon] / [#Form: BankRecon] never showed on the reconciliation screen: more form names, each its own file)
# (run 37770857500: six form names Tally does not know brought "TallyPrime will ignore the TDLs that have errors" and then an
# Internal Error c0000005 on every release: only the two names that loaded with no warning in runs 37763910797 /
# 37766812255; and each REPORT Tally answers to (XML) gets its window title replaced, so the title read on the screen shows
# whether the reconciliation screen is that report)
$brsUse = @('Bank Recon', 'BankRecon')
$markWords = @('Zebra Mark', 'Lotus Mark', 'Tiger Mark', 'Maple Mark', 'Coral Mark', 'Amber Mark', 'Cedar Mark', 'Delta Mark')
# the control: a button on the Voucher form (no Form Accept line: the add-on's own hook stays the only one), seen on the
# voucher alteration screen of the allocation step = the button mechanism works on this release
$script:bkMarks['control-voucher'] = 'Kiwi Mark'
$probes['control-voucher'] = "[#Form: Voucher]`r`n    Add : Button : FCRPBV`r`n`r`n[Button: FCRPBV]`r`n    Key    : Ctrl+Alt+F11`r`n    Title  : `"Kiwi Mark`"`r`n    Action : Display : Day Book`r`n"
$i = 0; foreach ($n in $brsUse) { $i++; $w = $markWords[($i - 1) % $markWords.Count]; $script:bkMarks["brs$i"] = $w
  $probes["brs$i"] = "[#Form: $n]`r`n    Add : Button : FCRPB$i`r`n    On : Form Accept : Yes : Call : FCRPWrite : `"brs${i}_pre`"`r`n    On : Form Accept : Yes : Form Accept`r`n    On : Form Accept : Yes : Call : FCRPWrite : `"brs${i}_post`"`r`n`r`n[Button: FCRPB$i]`r`n    Key    : Ctrl+Alt+F$(2 + $i)`r`n    Title  : `"$w`"`r`n    Action : Display : Day Book`r`n"
  Info "probe brs$i = [#Form: $n] (its button '$w' on the screen = attached)" }
$i = 0; foreach ($n in @($brsNames | Where-Object { $known[$_] })) { $i++; $w = @('Tiger Mark', 'Maple Mark', 'Coral Mark', 'Amber Mark')[($i - 1) % 4]; $script:bkMarks["rep$i"] = $w
  $probes["rep$i"] = "[#Report: $n]`r`n    Title : `"$w`"`r`n"; Info "probe rep$i = [#Report: $n] (its title '$w' on the screen = this report)" }
$i = 0; foreach ($n in $allocUse) { $i++; $probes["alloc$i"] = "[#Form: $n]`r`n    On : Form Accept : Yes : Call : FCRPWrite : `"alloc${i}_pre`"`r`n    On : Form Accept : Yes : Form Accept`r`n    On : Form Accept : Yes : Call : FCRPWrite : `"alloc${i}_post`"`r`n"; Info "probe alloc$i = [#Form: $n]" }
$files = @($tdl, (Join-Path $pd 'probe-common.tdl'))
foreach ($k in $probes.Keys) {
  $f = Join-Path $pd "probe-$k.tdl"
  Set-Content $f (";; probe-$k.tdl (bank-date probe, harness only)`r`n" + $probes[$k] + "`r`n[Collection: FCRPAlive$($k -replace '\W', '')]`r`n    Type : Company`r`n") -Encoding ASCII
  $files += $f
  Copy-Item $f (Join-Path $cap "probe-$k.tdl")
}
Copy-Item (Join-Path $pd 'probe-common.tdl') (Join-Path $cap 'probe-common.tdl')
$script:bkIni = $files; BkIni
BkFresh 'BK1: the probe variant loaded'
# which probe files attached: each form probe adds a button whose title is read on the screen (run 37766812255: asking
# Tally for a collection that is not defined, with the company set, got no answer in 30 s on every release, so files are
# no longer checked by a collection; run 37763910797: without the company every such ask got the same answer)
$alive = $script:bkMarks
$err = @(Get-ChildItem $dir, $data1 -Recurse -File -Include *tdl*.log, tdlerr*, *error*.log -ErrorAction SilentlyContinue)
foreach ($f in $err) { Info "Tally file $($f.FullName): $((Get-Content $f.FullName -Tail 12) -join ' | ')"; Copy-Item $f.FullName (Join-Path $cap "tally-$($f.Name)") -ErrorAction SilentlyContinue }
BkAlloc 'BK1-alloc' 1
BkBrs 'BK1-brs'
BkBrs 'BK1-brs2'

# ---- BK3: the ref's add-on only again (a second sample without the probe)
Say '---- BK3 the add-on of the ref only, again'
$script:bkIni = @($tdl); BkIni
BkFresh 'BK3: the add-on of the ref only'
BkBrs 'BK3-brs'

# ---- what is kept
$script:bkRows | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'bank-steps.json') -Encoding UTF8
[pscustomobject]@{ discovery = $known; brsProbed = $brsUse; allocProbed = $allocUse; loaded = $alive } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'bank-probe-files.json') -Encoding UTF8
Copy-Item (Join-Path $rec 'probe.txt') (Join-Path $cap 'probe-all.txt') -ErrorAction SilentlyContinue
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
$cE = BkContras; Set-Content (Join-Path $cap 'bank-contras-end.json') ($cE | ConvertTo-Json -Depth 3) -Encoding UTF8
Set-Content (Join-Path $out 'tds-screens.log') $script:tdsLog -Encoding UTF8
Info "bank: probe files loaded: $((($alive.Keys | ForEach-Object { "$_=$($alive[$_])" }) -join ', '))"
