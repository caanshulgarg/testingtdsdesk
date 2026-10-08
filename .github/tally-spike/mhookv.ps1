# mhookv.ps1 - mode "mhook" (branch next-masterhook, 2.4.0's master hooks). MEASUREMENT ONLY, nothing here ships.
# Dot-sourced by flowv.ps1 after c1-c2 (Tally started with the ref's FinComRecorder.tdl, the company open; no bridge).
# The owner's rule: no hook ships unless that master saves normally with the hook on, proven on real Tally.
# For Stock Item, Godown and Pay Head, each case typed on Tally's own screens twice:
#   phase A  the add-on from the ref (On : Form Accept on Pay Head / Stock Item / Godown) loaded; names start "MA "
#   phase B  no TDL at all (Tally as a customer without FinCom); the same keys; names start "MB "
# Per case: Tally's stored master exported by name after the save (captures/mh-<A|B>-<case>.xml), every typed value
# looked for in it, the add-on's lines written during the case (captures/mh-A-<case>.lines.txt), Ctrl+A to a still
# screen (ms), any error Tally showed. The two phases' stored masters are compared field by field (names normalised).
# A case is
#   PASS     A stored every typed value, A = B, no error, the add-on's line(s) written
#   FAIL     A did not store what was typed (or refused / errored) while B did (the hook changed the save), or the line
#            is missing
#   HARNESS  the keys did not get there (B did not store it either): never a pass
# Keys move by Tally's current field: the field box Tally fills with (254,232,175) is found on the screenshot and its
# label read by OCR (ocrw.ps1); a rule types its value when the label matches, else Enter. Every Tally request is capped at
# 30 s; a request that times out, or a Gateway not reached, starts Tally afresh. Lists are walked with foreach.
Say '---- mhook: the master hooks (Pay Head, Stock Item, Godown) on the screen, add-on on and off'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$mhCap = Join-Path $out 'captures'; New-Item -ItemType Directory -Force $mhCap | Out-Null
$mhTmp = Join-Path $env:RUNNER_TEMP 'mhshots'; New-Item -ItemType Directory -Force $mhTmp | Out-Null
$mhOnly = if ($env:MH_ONLY) { $env:MH_ONLY } elseif (Test-Path (Join-Path $PSScriptRoot 'mhook-only.txt')) { "$(Get-Content (Join-Path $PSScriptRoot 'mhook-only.txt') -TotalCount 1)".Trim() } else { '' }
$script:mhTdl = @($tdl)
function MhIni {
  $l = @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $($folder.Name)")
  foreach ($f in $script:mhTdl) { $l += "TDL = $f" }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  Info "tally.ini TDL lines: $(if ($script:mhTdl.Count) { ($script:mhTdl | ForEach-Object { Split-Path $_ -Leaf }) -join ', ' } else { 'none' })"
}
$script:TdsRestart = {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10
  for ($s = 0; $s -lt 6; $s++) {
    $t = TdsScreen "mh-start-$s"
    if ($t -match 'ignore the TDLs') { Info 'at start Tally said: TallyPrime will ignore the TDLs that have errors' }
    if ($t -match 'Press any key') { KeysTo '{ENTER}' 3; continue }
    if ($t -match 'Activate License|Serial Number') { KeysTo '{ESC}' 3; continue }
    if ($t -match 'Try It For Free|Welcome to TallyPrime') { KeysTo 't' 8; continue }
    if ($t -match 'Startup Report|Application Startup') { KeysTo '^a' 5; continue }
    if ($t -match 'Internal Error') { Info 'Tally showed an Internal Error at start'; KeysTo '{ENTER}' 3; continue }
    break
  }
}
function MhFresh($why) { Info "Tally started afresh ($why)"; & $script:TdsRestart; $null = MhGateway "fresh $why" }
function MhPost($x) {
  $a = Post $x '' 30
  if (-not $a -and ($script:lastMs -ge 29000 -or -not (Get-Process -Id $script:tpid -ErrorAction SilentlyContinue))) {
    Write-Host '::warning::a Tally request took 30 s (or Tally is gone): Tally started afresh'; MhFresh 'a request took 30 s'; return ''
  }
  return $a
}
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }

# ---- the screen timer (bankv.ps1's / masterhook233.ps1's method): a key, then the screen watched until still 600 ms
Add-Type -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class MHT {
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

# ---- Tally's current field: the filled box and its label (left on the same row) or column head (above)
$script:fN = 0
function FieldNow([string]$tag, [switch]$keep) {
  $script:fN++
  $n = 'mh-{0:d4}-{1}' -f $script:fN, ($tag -replace '[^\w-]', '')
  & "$PSScriptRoot\shot.ps1" $n | Out-Null
  $png = Join-Path $env:SHOTS "$n.png"
  $raw = if (Test-Path $png) { @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ocrw.ps1" $png 2>&1 | ForEach-Object { "$_" }) } else { @('OCR-UNAVAILABLE no shot') }
  if (-not $keep -and (Test-Path $png)) { Move-Item $png (Join-Path $mhTmp "$n.png") -Force -ErrorAction SilentlyContinue }
  $boxes = @(); $lines = @()
  foreach ($r in $raw) {
    if ($r -match '^HL (\d+) (\d+) (\d+) (\d+)$') { $boxes += [pscustomobject]@{ x = [int]$Matches[1]; y = [int]$Matches[2]; w = [int]$Matches[3]; h = [int]$Matches[4] } }
    elseif ($r -match '^L (-?\d+) (-?\d+) (\d+) (\d+) (.*)$') { $lines += [pscustomobject]@{ x = [int]$Matches[1]; y = [int]$Matches[2]; w = [int]$Matches[3]; h = [int]$Matches[4]; t = $Matches[5] } }
  }
  $text = (($lines | ForEach-Object { $_.t }) -join ' ')
  # each filled box: the label on its left (same row, the nearest line ending left of it), the lines above it in its column
  # (nearest first: a table's column head is among them), the text inside it
  $cands = @()
  foreach ($b in $boxes) {
    if ($b.h -lt 10 -or $b.h -gt 40 -or $b.w -lt 20 -or $b.w -gt 700) { continue }
    $cy = $b.y + $b.h / 2; $lx = -1; $left = ''; $val = ''
    foreach ($l in $lines) {
      $ly = $l.y + $l.h / 2
      if ([math]::Abs($ly - $cy) -le ($b.h / 2 + 2)) {
        if (($l.x + $l.w) -le ($b.x + 6) -and ($b.x - ($l.x + $l.w)) -lt 420 -and ($l.x + $l.w) -gt $lx) { $lx = $l.x + $l.w; $left = $l.t }
        elseif ($l.x -ge $b.x - 4 -and $l.x -lt $b.x + $b.w) { $val = $l.t }
      }
    }
    $above = @()
    foreach ($l in $lines) { if (($l.y + $l.h) -le ($b.y + 2) -and ($b.y - $l.y) -lt 200 -and $l.x -lt ($b.x + $b.w) -and ($l.x + $l.w) -gt $b.x) { $above += $l } }
    $heads = @($above | Sort-Object { - $_.y } | ForEach-Object { ($_.t -replace '^[\s:]+|[\s:]+$', '') })
    $left = ($left -replace '^[^A-Za-z(]+', '' -replace '^[a-z]{1,2}\s+(?=[A-Z(])', '')
    $cands += [pscustomobject]@{ b = $b; left = ($left -replace '^[\s:]+|[\s:]+$', ''); heads = $heads; value = ($val -replace '^[\s:]+|[\s:]+$', '') }
  }
  # the current field: a box with a label on its left first (a list's chosen row has none), the leftmost
  $best = $null
  foreach ($c in $cands) { if ($c.left -and (-not $best -or $c.b.x -lt $best.b.x)) { $best = $c } }
  if (-not $best) { foreach ($c in $cands) { if (-not $best -or $c.b.x -lt $best.b.x) { $best = $c } } }
  $all = ($cands | ForEach-Object { "$($_.b.x),$($_.b.y),$($_.b.w)x$($_.b.h)[$($_.left)|$(($_.heads | Select-Object -First 3) -join '/')]" }) -join ' '
  $o = [pscustomobject]@{ n = $n; left = $(if ($best) { $best.left } else { '' }); heads = $(if ($best) { @($best.heads) } else { @() }); head = $(if ($best -and $best.heads.Count) { $best.heads[0] } else { '' }); value = $(if ($best) { $best.value } else { '' }); text = ($text -replace '\s+', ' ').Trim(); box = $(if ($best) { "$($best.b.x),$($best.b.y),$($best.b.w)x$($best.b.h)" } else { 'none' }); ocr = (-not ($raw -match '^OCR-UNAVAILABLE')) }
  $short = if ($o.text.Length -gt 1500) { $o.text.Substring(0, 1500) + '...' } else { $o.text }
  Write-Host ("[mh] {0}: field {1} left '{2}' heads '{3}' value '{4}' (boxes: {5}) | {6}" -f $n, $o.box, $o.left, (($o.heads | Select-Object -First 3) -join ' / '), $o.value, $all, $short)
  return $o
}
function FormUp($f) { if ($f.text -match 'Gateway ?of Tally' -and -not $f.left) { return $false }; if ($f.left) { return $true }; return ($f.box -ne 'none' -and $f.text -match '\bAccept\b' -and (($f.heads -join ' ') -notmatch 'Master (Creation|Alteration)')) }
# Walk a form: at each field, the first rule not yet used whose label regex matches (l: the label on the left; h: the column
# head above) types its keys; otherwise Enter. Ends when every rule is used ($stop), the form is gone, or after $max fields.
# Returns the labels seen (the log keeps them). A rule: @{ l = 'regex'; h = 'regex'; k = 'keys' }
function Walk([string]$tag, [object[]]$rules, [int]$max = 30, [switch]$stop) {
  $used = @{}; $seen = @(); $need = 0; foreach ($r in $rules) { if (-not $r.opt) { $need++ } }
  for ($i = 1; $i -le $max; $i++) {
    $f = FieldNow "$tag-w$i"
    $seen += "[$($f.left)|$($f.head)]"
    if ($f.text -match 'Accept \?|Yes or No') { Write-Host "[mh] $tag a question is up: stop"; break }
    if (-not (FormUp $f)) { Write-Host "[mh] $tag the form is gone: stop"; break }
    $hit = $null
    for ($j = 0; $j -lt $rules.Count; $j++) {
      if ($used[$j]) { continue }
      $r = $rules[$j]; $hm = $false
      if ($r.h) { foreach ($hd in $f.heads) { if ($hd -match $r.h) { $hm = $true; break } } }
      if (($r.l -and $f.left -and $f.left -match $r.l) -or $hm -or ($r.t -and $f.text -match $r.t)) { $hit = $j; break }
    }
    if ($null -ne $hit) {
      $used[$hit] = $true
      Write-Host "[mh] $tag rule $hit ($($rules[$hit].l)$($rules[$hit].h)$($rules[$hit].t)) on '$($f.left)|$($f.head)': keys '$($rules[$hit].k)'"
      KeysTo $rules[$hit].k 1.2
      if ($rules[$hit].last) { break }
      $done = 0; foreach ($k in $used.Keys) { if (-not $rules[$k].opt) { $done++ } }
      if ($stop -and $done -ge $need) { break }
      continue
    }
    KeysTo '{ENTER}' 1
  }
  $miss = @(); for ($j = 0; $j -lt $rules.Count; $j++) { if (-not $used[$j]) { $miss += "$($rules[$j].l)$($rules[$j].h)$($rules[$j].t)$(if ($rules[$j].opt) { '(optional)' })" } }
  return [pscustomobject]@{ seen = $seen; missed = $miss }
}

# ---- Tally's side
$mhSub = @{ 'Stock Item' = 'StockItem'; 'Godown' = 'Godown'; 'Pay Head' = 'Ledger' }
$mhFetch = @{
  'Stock Item' = 'NAME, PARENT, BASEUNITS, ADDITIONALUNITS, ISBATCHWISEON, OPENINGBALANCE, OPENINGRATE, OPENINGVALUE, GSTAPPLICABLE, GSTTYPEOFSUPPLY, MASTERID, ALTERID, LANGUAGENAME.*, BATCHALLOCATIONS.*, GSTDETAILS.*, GSTDETAILS.STATEWISEDETAILS.*, GSTDETAILS.STATEWISEDETAILS.RATEDETAILS.*, HSNDETAILS.*'
  'Godown'     = 'NAME, PARENT, MASTERID, ALTERID, LANGUAGENAME.*'
  'Pay Head'   = 'NAME, PARENT, PAYTYPE, CALCULATIONTYPE, AFFECTSNETSALARY, PAYSLIPNAME, CALCULATIONPERIOD, ATTENDANCETYPE, MASTERID, ALTERID, LANGUAGENAME.*'
}
# the master as Tally keeps it: a collection by name (its own fields, NATIVEMETHOD *, and the lists named) and the object
# export by name; both kept, the check reads both
function MhStored([string]$kind, [string]$name) {
  $f = '<SYSTEM TYPE="Formulae" NAME="MHF">$Name = "' + (SE $name) + '"</SYSTEM>'
  $c = MhPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MHC</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="MHC" ISMODIFY="No"><TYPE>' + $mhSub[$kind] + '</TYPE><FETCH>' + $mhFetch[$kind] + '</FETCH><NATIVEMETHOD>*</NATIVEMETHOD><FILTERS>MHF</FILTERS></COLLECTION>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $sub = if ($kind -eq 'Stock Item') { 'Stock Item' } else { $mhSub[$kind] }
  $o = MhPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>' + $sub + '</SUBTYPE><ID TYPE="Name">' + (SE $name) + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST><FETCH>*</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>')
  $has = "$c" -match ('NAME="' + [regex]::Escape((SE $name)) + '"')
  return [pscustomobject]@{ has = $has; coll = "$c"; obj = "$o"; all = "$c`n$o" }
}
# a typed value in the stored master: <TAG>value</TAG> with TAG matching $tag (regex) and the value matching $val (regex,
# whole value, spaces trimmed)
function MhHas([string]$xml, [string]$tag, [string]$val) {
  foreach ($m in [regex]::Matches($xml, '<(?<t>[A-Z][A-Z0-9.]*)(?: [^>]*)?>(?<v>[^<]*)</\k<t>>')) {
    if ($m.Groups['t'].Value -match "^($tag)$" -and ($m.Groups['v'].Value.Trim()) -match "^($val)$") { return $true }
  }
  foreach ($m in [regex]::Matches($xml, '<(?<t>[A-Z][A-Z0-9.]*)(?: [^>]*)?/>')) { if ($m.Groups['t'].Value -match "^($tag)$" -and '' -match "^($val)$") { return $true } }
  return $false
}
# the stored master as tag=value pairs, for A against B: ids, times and the phase's own name prefix taken out
function MhPairs([string]$xml) {
  $p = @()
  foreach ($m in [regex]::Matches($xml, '<(?<t>[A-Z][A-Z0-9.]*)(?: [^>]*)?>(?<v>[^<]*)</\k<t>>')) {
    $t = $m.Groups['t'].Value
    if ($t -match '^(GUID|MASTERID|ALTERID|ALTEREDON|ENTEREDBY|ALTEREDBY|CREATEDBY|CREATEDDATE|ALTEREDDATE|LASTVCHID|LASTSAVED.*|SORTPOSITION|REQUESTORRULE|.*TIME|.*ID|OLDAUDITENTRYIDS|AUDITENTRIES.*|UPDATEDDATETIME)$') { continue }
    $v = ($m.Groups['v'].Value.Trim() -replace '\bM[AB] ', 'MX ')
    $p += "$t=$v"
  }
  return , @($p | Sort-Object -Unique)
}
$recAll = { @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'failed.txt' } | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' }) }
function RecCount { $a = & $recAll; return $a.Count }
function RecSince([int]$n) { $a = & $recAll; if ($a.Count -le $n) { return , @() }; return , @($a[$n..($a.Count - 1)]) }
# the save: Ctrl+A timed to a still screen; "Accept? Yes or No" answered y (timed too); an error or a refusal read off the
# screen. Returns @{ ms; err; screen }
function MhSave([string]$tag) {
  $ms = -1; $err = ''; $f = $null
  for ($k = 1; $k -le 3; $k++) {
    KeysTo '' 0
    $a = [MHT]::Press(0x11, 0x41, 600, 15000); if ($k -eq 1) { $ms = [double](($a -split ';')[1]) }
    $f = FieldNow "$tag-saved$k" -keep
    if ($f.text -match 'Accept \?|Yes or No') { KeysTo '' 0; $b = [MHT]::Press(0, 0x59, 600, 15000); if ($k -eq 1) { $ms += [double](($b -split ';')[1]) }; $f = FieldNow "$tag-saved$k-y" -keep }
    if ($f.text -match '(Error|Oops|already exists|does not exist|not allowed|cannot|Cannot|Invalid|invalid|Duplicate|Warning)[^|]{0,120}') { $err = $Matches[0]; break }
    # left: no master form title, or a new blank creation form (the save of a create)
    if (-not (FormUp $f)) { break }
    if ($f.left -match '(^|\W)Name$' -and -not $f.value) { break }
    Write-Host "[mh] $tag still in the form after Ctrl+A $k (a sub-screen accepted?): Ctrl+A again"
  }
  return [pscustomobject]@{ ms = $ms; err = $err; screen = $f }
}
# the Gateway by Esc; "Quit? Yes or No" over a form answered y (left unsaved), a delete question n; Tally started afresh
# when the Gateway is not reached (TdsGateway's form words need the form titles, which OCR does not read on 7.x)
function MhGateway([string]$why = '') {
  for ($i = 0; $i -lt 8; $i++) {
    $t = TdsScreen "mgw$i"
    if ($t -match '^OCR-UNAVAILABLE') { break }
    if ($t -match 'Yes or No') { if ($t -match 'Delete') { & $script:TdsSend 'n' } else { & $script:TdsSend 'y' }; Start-Sleep 2; continue }
    if ($t -match 'Gateway ?of Tally' -and $t -notmatch 'Master (Creation|Alteration)|List of |Accept') { return $true }
    & $script:TdsSend '{ESC}'; Start-Sleep 1.5
  }
  TdsSay "the Gateway not reached ($why): Tally started again"
  & $script:TdsRestart
  return $true
}
# Create -> <kind>: the Master Creation box, the kind typed, its form (7.x calls a godown Location: both tried)
function MhOpenCreate([string]$kind, [string]$tag) {
  $names = if ($kind -eq 'Godown') { if ($script:gdKind) { @($script:gdKind) } else { @('Location', 'Godown') } } else { @($kind) }
  foreach ($k in $names) {
    $null = MhGateway "before $tag"
    KeysTo 'c' 2
    KeysTo ('{BACKSPACE}' * 20) 0.3; KeysTo (SK $k) 1.5; KeysTo '{ENTER}' 2.5
    $f = FieldNow "$tag-form"
    if ($f.left -match '(^|\W)Name$') { if ($kind -eq 'Godown') { $script:gdKind = $k }; return $true }
    Write-Host "[mh] $tag no '$k Creation' form after Create > $k"
  }
  return $false
}
# Alter -> <kind> -> the master by name: its alteration form
function MhOpenAlter([string]$kind, [string]$name, [string]$tag) {
  $names = if ($kind -eq 'Godown') { if ($script:gdKind) { @($script:gdKind) } else { @('Location', 'Godown') } } else { @($kind) }
  foreach ($k in $names) {
    $null = MhGateway "before $tag"
    KeysTo 'a' 2
    KeysTo ('{BACKSPACE}' * 20) 0.3; KeysTo (SK $k) 1.5; KeysTo '{ENTER}' 2.5
    KeysTo (SK $name) 1.5; KeysTo '{ENTER}' 2.5
    $f = FieldNow "$tag-form"
    if ($f.left -match '(^|\W)Name$' -and $f.value) { return $true }
    Write-Host "[mh] $tag no alteration form of '$name' after Alter > $k"
  }
  return $false
}
# the result of one case in one phase
$script:mh = [ordered]@{}; $script:gdKind = ''
function MhCase([string]$phase, [string]$case, [string]$kind, [string]$name, [scriptblock]$keys, [object[]]$checks, [string]$lineEv, [switch]$gone, [string]$oldName = '') {
  if ($mhOnly -and $case -notmatch $mhOnly) { return }
  Say "---- mh $phase $case ($kind '$name')"
  $r0 = RecCount
  $t0 = Get-Date
  $ok = $true; $res = $null
  try { foreach ($o in @(& $keys)) { if ($o -and $o.PSObject.Properties['ms']) { $res = $o } } } catch { Write-Host "[mh] $case keys threw: $_"; $ok = $false }
  if (-not $res) { $res = [pscustomobject]@{ ms = -1; err = 'no save'; walk = '' } }
  $null = MhGateway "after $case"
  Start-Sleep 1
  $st = MhStored $kind $name
  $tag = "mh-$phase-$case"
  Set-Content (Join-Path $mhCap "$tag.xml") $st.all -Encoding UTF8
  $old = if ($oldName) { MhStored $kind $oldName } else { $null }
  $lines = RecSince $r0
  Set-Content (Join-Path $mhCap "$tag.lines.txt") $lines -Encoding UTF8
  $miss = @()
  if ($gone) { if ($st.has) { $miss += "still in Tally" } }
  else {
    if (-not $st.has) { $miss += "not in Tally by name" }
    foreach ($c in $checks) { if (-not (MhHas $st.all $c[0] $c[1])) { $miss += "$($c[0])=$($c[1])" } }
    if ($old -and $old.has) { $miss += "old name '$oldName' still in Tally" }
  }
  $evs = @(); foreach ($l in $lines) { $evs += [regex]::Match($l, '^FCR1\|ev=([^|]+)').Groups[1].Value + '(' + [regex]::Match($l, '\|name=([^|]*)').Groups[1].Value + ')' }
  $lineOk = $false
  if ($lineEv) { foreach ($l in $lines) { if ($l -match "^FCR1\|ev=($lineEv)\|" -and ($l -match ('\|name=' + [regex]::Escape($name) + '\|') -or $l -match ('\|name=' + [regex]::Escape($oldName) + '\|'))) { $lineOk = $true } } }
  $script:mh["$phase|$case"] = [pscustomobject]@{ phase = $phase; case = $case; kind = $kind; name = $name; stored = ($miss.Count -eq 0); miss = ($miss -join '; '); err = $res.err; ms = $res.ms; lines = ($evs -join ' '); lineOk = $lineOk; walk = "$($res.walk)"; pairs = (MhPairs $st.all); sec = [int]((Get-Date) - $t0).TotalSeconds }
  Info ("mh {0} {1}: stored as typed {2}{3}; error '{4}'; Ctrl+A {5} ms; add-on lines: {6}" -f $phase, $case, ($miss.Count -eq 0), $(if ($miss.Count) { " (missing: $($miss -join '; '))" } else { '' }), $res.err, $res.ms, $(if ($evs.Count) { $evs -join ' ' } else { 'none' }))
}
# a form filled by rules, then saved (Ctrl+A)
function MhFill([string]$tag, [object[]]$rules, [int]$max = 30) {
  $w = Walk $tag $rules $max -stop
  $null = FieldNow "$tag-before-save" -keep
  $s = MhSave $tag
  return [pscustomobject]@{ ms = $s.ms; err = $s.err; walk = ("seen " + ($w.seen -join ' ') + $(if ($w.missed.Count) { " | rules not used: " + ($w.missed -join ', ') } else { '' })) }
}
function MhDelete([string]$kind, [string]$name, [string]$tag) {
  if (-not (MhOpenAlter $kind $name $tag)) { return [pscustomobject]@{ ms = -1; err = 'alteration form not reached'; walk = '' } }
  KeysTo '%d' 2
  $f = FieldNow "$tag-delete-q" -keep
  $ms = -1
  if ($f.text -match 'Delete|Yes or No') { KeysTo '' 0; $ms = [double](([MHT]::Press(0, 0x59, 600, 15000) -split ';')[1]) }
  $g = FieldNow "$tag-deleted" -keep
  $err = ''; if ($g.text -match '(Error|Oops|cannot|Cannot|not allowed|in use)[^|]{0,120}') { $err = $Matches[0] }
  return [pscustomobject]@{ ms = $ms; err = $err; walk = '' }
}

# ---- masters and features by XML (no add-on event fires for an import)
$coN = MhPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MHCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="MHCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
$featOn = @('ISPAYROLLON', 'ISBATCHWISEON', 'PREVISMULTIGODOWNON', 'ISCOSTCENTRESON') | Where-Object { $coN -match "<$_>" }
$null = TdsImport 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME>' + (($featOn | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</COMPANY>')
$coN = MhPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MHCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="MHCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
$featNow = @(foreach ($t in @('ISPAYROLLON', 'ISBATCHWISEON', 'PREVISMULTIGODOWNON', 'ISCOSTCENTRESON', 'ISGSTON', 'ISINVENTORYON')) { "$t=$([regex]::Match($coN, "<$t>([^<]*)<").Groups[1].Value)" })
Info "mh company features after the XML alter: $($featNow -join ', ')"
$batchOn = $coN -match '<ISBATCHWISEON>Yes<'
$mx = @(
  '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>',
  '<UNIT NAME="Kgs" ACTION="Create"><NAME>Kgs</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>',
  '<GODOWN NAME="MH Main" ACTION="Create"><NAME.LIST><NAME>MH Main</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>',
  '<LEDGER NAME="MH Sales" ACTION="Create"><NAME.LIST><NAME>MH Sales</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT></LEDGER>',
  '<LEDGER NAME="MH Wage" ACTION="Create"><NAME.LIST><NAME>MH Wage</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><FORPAYROLL>Yes</FORPAYROLL></LEDGER>')
foreach ($m in $mx) { $r = TdsImport 'All Masters' $m; Write-Host "[mh] master $([regex]::Match($m, 'NAME="([^"]+)"').Groups[1].Value): $(([regex]::Match("$r", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')" }
# the attendance and production types (pay heads "On Attendance" / "On Production"): the forms tried until one is taken
$att = $false
foreach ($u in @('', '<UNIT NAME="Days" ACTION="Create"><NAME>Days</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')) {
  if ($u) { $null = TdsImport 'All Masters' $u }
  foreach ($f in 'ATTENDANCEPRODUCTIONTYPE', 'ATTENDANCETYPE') {
    foreach ($b in @('', '<BASEUNITS>Days</BASEUNITS>')) {
      if ($att) { break }
      $x = TdsImport 'All Masters' ('<ATTENDANCETYPE NAME="MH Present" ACTION="Create"><NAME.LIST><NAME>MH Present</NAME></NAME.LIST><PARENT/><' + $f + '>Attendance/Leave with Pay</' + $f + '><ATTENDANCEPERIOD>Days</ATTENDANCEPERIOD>' + $b + '</ATTENDANCETYPE>')
      if ("$x" -match '<CREATED>1</CREATED>') { $att = $true; Info "mh attendance type MH Present made by XML ($f$b)" }
    }
  }
}
$prod = $false
foreach ($f in 'ATTENDANCEPRODUCTIONTYPE', 'ATTENDANCETYPE') {
  if ($prod) { break }
  $x = TdsImport 'All Masters' ('<ATTENDANCETYPE NAME="MH Pieces" ACTION="Create"><NAME.LIST><NAME>MH Pieces</NAME></NAME.LIST><PARENT/><' + $f + '>Production</' + $f + '><BASEUNITS>Nos</BASEUNITS></ATTENDANCETYPE>')
  if ("$x" -match '<CREATED>1</CREATED>') { $prod = $true; Info "mh production type MH Pieces made by XML ($f)" }
}
$atx = MhPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MHAt</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="MHAt" ISMODIFY="No"><TYPE>AttendanceType</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
Set-Content (Join-Path $mhCap 'mh-attendance-types.xml') "$atx" -Encoding UTF8
Info "mh attendance/production types made by XML: attendance $att, production $prod"
$addonText = Get-Content $tdl -Raw
$hooked = @(foreach ($m in [regex]::Matches($addonText, '(?m)^\[#Form: ([^\]]+)\]')) { $m.Groups[1].Value })
Info "mh the add-on loaded in phase A ($tdl, SHA-256 $((Get-FileHash $tdl -Algorithm SHA256).Hash.Substring(0, 16))...) hooks: $($hooked -join ', ')"

# ---- the cases (one phase): $P is the phase's name prefix ("MA" / "MB")
function MhPhase([string]$phase) {
  $P = if ($phase -eq 'A') { 'MA' } else { 'MB' }
  $line = ($phase -eq 'A')
  # ---------------- Godown
  MhCase $phase 'G1-create' 'Godown' "$P Godown 1" {
    if (-not (MhOpenCreate 'Godown' 'G1')) { return }
    MhFill 'G1' @(@{ l = '(^|\W)Name$'; k = (SK "$P Godown 1") + '{ENTER}' }, @{ l = 'alias'; k = (SK "$P G1") + '{ENTER}' }, @{ l = '(^|\W)Under$'; k = 'Primary{ENTER}' })
  } @(, @('NAME', [regex]::Escape("$P G1"))) $(if ($line) { 'godown_accept_post' })
  MhCase $phase 'G2-alter-alias' 'Godown' "$P Godown 1" {
    if (-not (MhOpenAlter 'Godown' "$P Godown 1" 'G2')) { return }
    MhFill 'G2' @(@{ l = 'alias'; k = (SK "$P G1X") + '{ENTER}' })
  } @(, @('NAME', [regex]::Escape("$P G1X"))) $(if ($line) { 'godown_accept_post' })
  MhCase $phase 'G3-rename' 'Godown' "$P Godown 1R" {
    if (-not (MhOpenAlter 'Godown' "$P Godown 1" 'G3')) { return }
    MhFill 'G3' @(@{ l = '(^|\W)Name$'; k = (SK "$P Godown 1R") + '{ENTER}' })
  } @() $(if ($line) { 'godown_accept_post' }) -oldName "$P Godown 1"
  MhCase $phase 'G4-create-under' 'Godown' "$P Godown 2" {
    if (-not (MhOpenCreate 'Godown' 'G4')) { return }
    MhFill 'G4' @(@{ l = '(^|\W)Name$'; k = (SK "$P Godown 2") + '{ENTER}' }, @{ l = '(^|\W)Under$'; k = (SK "$P Godown 1R") + '{ENTER}' })
  } @(, @('PARENT', [regex]::Escape("$P Godown 1R"))) $(if ($line) { 'godown_accept_post' })
  MhCase $phase 'G5-alter-under' 'Godown' "$P Godown 2" {
    if (-not (MhOpenAlter 'Godown' "$P Godown 2" 'G5')) { return }
    MhFill 'G5' @(@{ l = '(^|\W)Under$'; k = 'Primary{ENTER}' })
  } @(, @('PARENT', '(&#4; )?Primary|')) $(if ($line) { 'godown_accept_post' })
  # ---------------- Stock Item
  MhCase $phase 'S1-create' 'Stock Item' "$P Item 1" {
    if (-not (MhOpenCreate 'Stock Item' 'S1')) { return }
    MhFill 'S1' @(@{ l = '(^|\W)Name$'; k = (SK "$P Item 1") + '{ENTER}' }, @{ l = 'alias'; k = (SK "$P I1") + '{ENTER}' }, @{ l = '(^|\W)Under$'; k = 'Primary{ENTER}'; opt = $true }, @{ l = '(^|\W)Units$'; k = 'Nos{ENTER}' })
  } @(@('NAME', [regex]::Escape("$P I1")), @('BASEUNITS', 'Nos')) $(if ($line) { 'stockitem_accept_post' })
  MhCase $phase 'S2-alter-alias' 'Stock Item' "$P Item 1" {
    if (-not (MhOpenAlter 'Stock Item' "$P Item 1" 'S2')) { return }
    MhFill 'S2' @(@{ l = 'alias'; k = (SK "$P I1X") + '{ENTER}' })
  } @(, @('NAME', [regex]::Escape("$P I1X"))) $(if ($line) { 'stockitem_accept_post' })
  MhCase $phase 'S3-rename' 'Stock Item' "$P Item 1R" {
    if (-not (MhOpenAlter 'Stock Item' "$P Item 1" 'S3')) { return }
    MhFill 'S3' @(@{ l = '(^|\W)Name$'; k = (SK "$P Item 1R") + '{ENTER}' })
  } @() $(if ($line) { 'stockitem_accept_post' }) -oldName "$P Item 1"
  # GST / HSN: the HSN and the rate typed in the item's own GST details (3.0+: "HSN/SAC & Related Details" and "GST Rate
  # & Related Details" set to "Specify Details Here"; older forms: "Set/Alter GST Details" Yes and the GST Details screen)
  MhCase $phase 'S4-gst-hsn' 'Stock Item' "$P Item 1R" {
    if (-not (MhOpenAlter 'Stock Item' "$P Item 1R" 'S4')) { return }
    MhFill 'S4' @(
      @{ l = 'GST Applicab'; k = 'Applicable{ENTER}'; opt = $true },
      @{ l = 'HS.{0,3}SAC (&|and) Related|HS.{0,3}SAC Details$'; k = 'Specify Details Here{ENTER}' },
      @{ l = '(^|\W)HS.{0,3}SAC$|HS.{0,3}SAC Code'; k = '84713010{ENTER}' },
      @{ l = 'GST Rate (&|and) Related|GST Rate Details$|Set.?Alter GST'; k = 'Specify Details Here{ENTER}' },
      @{ l = 'Taxability'; k = 'Taxable{ENTER}'; opt = $true },
      @{ l = '(^|\W)GST Rate$|Integrated Tax|(^|\W)IGST'; k = '18{ENTER}' }) 45
  } @(@('[A-Z.]*HSN[A-Z.]*', '84713010'), @('[A-Z.]*RATE[A-Z.]*', '18(\.0+)?( ?%)?')) $(if ($line) { 'stockitem_accept_post' })
  MhCase $phase 'S5-unit-change' 'Stock Item' "$P Item 1R" {
    if (-not (MhOpenAlter 'Stock Item' "$P Item 1R" 'S5')) { return }
    MhFill 'S5' @(@{ l = '(^|\W)Units$'; k = 'Kgs{ENTER}' })
  } @(, @('BASEUNITS', 'Kgs')) $(if ($line) { 'stockitem_accept_post' })
  if ($batchOn) {
    MhCase $phase 'S6-opening-batches' 'Stock Item' "$P Item B" {
      if (-not (MhOpenCreate 'Stock Item' 'S6')) { return }
      MhFill 'S6' @(
        @{ l = '(^|\W)Name$'; k = (SK "$P Item B") + '{ENTER}' }, @{ l = '(^|\W)Units$'; k = 'Nos{ENTER}' }, @{ l = 'Maintain in batches'; k = 'y{ENTER}' },
        @{ l = 'Opening Balance'; k = '{ENTER}' },
        @{ h = 'Godown|Location'; k = 'MH Main{ENTER}' }, @{ h = 'Batch'; k = (SK "$P B1") + '{ENTER}' }, @{ h = '^Quantity'; k = '10{ENTER}' }, @{ h = '^Rate'; k = '50{ENTER}' },
        @{ h = 'Godown|Location'; k = 'MH Main{ENTER}' }, @{ h = 'Batch'; k = (SK "$P B2") + '{ENTER}' }, @{ h = '^Quantity'; k = '5{ENTER}' }, @{ h = '^Rate'; k = '50{ENTER}' },
        @{ h = 'Godown|Location'; k = 'End of List{ENTER}' }) 60
    } @(@('ISBATCHWISEON', 'Yes'), @('BATCHNAME', [regex]::Escape("$P B1")), @('BATCHNAME', [regex]::Escape("$P B2")), @('OPENINGBALANCE', '15 Nos'), @('[A-Z.]*OPENINGBALANCE', '10 Nos'), @('[A-Z.]*OPENINGBALANCE', '5 Nos')) $(if ($line) { 'stockitem_accept_post' })
  } else { Info "mh $phase S6-opening-batches: batches are not on for the company (ISBATCHWISEON not Yes): not run" }
  # a stock item made from inside an entry: Sales, the item field, Alt+C, the item form, Ctrl+A; the entry then left
  # unsaved (Esc, y)
  MhCase $phase 'S7-create-in-voucher' 'Stock Item' "$P Item V" {
    $null = MhGateway 'before S7'
    KeysTo 'v' 2.5; KeysTo '{F8}' 2.5
    $w = Walk 'S7v' @(
      @{ l = 'Party A.?c name|Party Name'; k = 'Cash{ENTER}' },
      @{ l = 'Delivery Note|Dispatch Doc|Buyer|Mailing Name|Order No'; k = '^a'; opt = $true },
      @{ l = 'Sales ledger'; k = 'MH Sales{ENTER}' },
      @{ h = 'Name of Item'; k = '%c'; last = $true }) 20 -stop
    Start-Sleep 2
    $f = FieldNow 'S7-item-form' -keep
    if ($f.text -notmatch 'Stock Item Creation') { return [pscustomobject]@{ ms = -1; err = 'Alt+C did not open Stock Item Creation'; walk = ($w.seen -join ' ') } }
    $s = MhFill 'S7' @(@{ l = '(^|\W)Name$'; k = (SK "$P Item V") + '{ENTER}' }, @{ l = '(^|\W)Units$'; k = 'Nos{ENTER}' })
    $null = FieldNow 'S7-back-in-voucher' -keep
    $s.walk = "voucher: $($w.seen -join ' ') | item: $($s.walk)"
    return $s
  } @(, @('BASEUNITS', 'Nos')) $(if ($line) { 'stockitem_accept_post' })
  # ---------------- Pay Head
  MhCase $phase 'P1-create-user-defined' 'Pay Head' "$P Basic" {
    if (-not (MhOpenCreate 'Pay Head' 'P1')) { return }
    MhFill 'P1' @(
      @{ l = '(^|\W)Name$'; k = (SK "$P Basic") + '{ENTER}' }, @{ l = 'Pay ?head type'; k = 'Earnings for Employees{ENTER}' },
      @{ l = '(^|\W)Under$'; k = 'Indirect Expenses{ENTER}' }, @{ l = 'Affect net salary'; k = 'y{ENTER}' },
      @{ l = 'Calculation type'; k = 'As User Defined Value{ENTER}' }) 30
  } @(@('PAYTYPE', 'Earnings for Employees'), @('PARENT', 'Indirect Expenses'), @('AFFECTSNETSALARY', 'Yes'), @('CALCULATIONTYPE', 'As User Defined Value')) $(if ($line) { 'payhead_accept_post' })
  MhCase $phase 'P2-create-computed-slab' 'Pay Head' "$P HRA" {
    if (-not (MhOpenCreate 'Pay Head' 'P2')) { return }
    MhFill 'P2' @(
      @{ l = '(^|\W)Name$'; k = (SK "$P HRA") + '{ENTER}' }, @{ l = 'Pay ?head type'; k = 'Earnings for Employees{ENTER}' },
      @{ l = '(^|\W)Under$'; k = 'Indirect Expenses{ENTER}' }, @{ l = 'Affect net salary'; k = 'y{ENTER}' },
      @{ l = 'Calculation type'; k = 'As Computed Value{ENTER}' }, @{ l = '(^|\W)Compute$'; k = 'On Specified Formula{ENTER}' },
      @{ h = '^Function'; k = 'Add Pay Head{ENTER}' }, @{ h = '^Pay ?Head$'; k = (SK "$P Basic") + '{ENTER}' }, @{ h = '^Function'; k = 'End of List{ENTER}' },
      @{ l = 'Effective From'; h = 'Effective From'; k = '1-4-2026{ENTER}' }, @{ h = 'Amount Upto|Upto'; k = '{ENTER}' }, @{ h = 'Slab Type'; k = 'Percentage{ENTER}' }, @{ h = '^Value'; k = '40{ENTER}' }) 45
  } @(@('CALCULATIONTYPE', 'As Computed Value'), @('[A-Z.]*', 'On Specified Formula'), @('[A-Z.]*', [regex]::Escape("$P Basic")), @('[A-Z.]*', '40(\.0+)?( ?%)?')) $(if ($line) { 'payhead_accept_post' })
  if ($att) {
    MhCase $phase 'P3-create-attendance' 'Pay Head' "$P Attend" {
      if (-not (MhOpenCreate 'Pay Head' 'P3')) { return }
      MhFill 'P3' @(
        @{ l = '(^|\W)Name$'; k = (SK "$P Attend") + '{ENTER}' }, @{ l = 'Pay ?head type'; k = 'Earnings for Employees{ENTER}' },
        @{ l = '(^|\W)Under$'; k = 'Indirect Expenses{ENTER}' }, @{ l = 'Affect net salary'; k = 'y{ENTER}' },
        @{ l = 'Calculation type'; k = 'On Attendance{ENTER}' }, @{ l = 'Attendance.?Leave with pay'; k = 'MH Present{ENTER}' },
        @{ l = 'Calculation period'; k = 'Months{ENTER}' }, @{ l = 'Per day calculation basis'; k = 'As per Calendar Period{ENTER}' }) 35
    } @(@('CALCULATIONTYPE', 'On Attendance'), @('[A-Z.]*', 'MH Present'), @('[A-Z.]*PERIOD[A-Z.]*', 'Months')) $(if ($line) { 'payhead_accept_post' })
  }
  if ($prod) {
    MhCase $phase 'P4-create-production' 'Pay Head' "$P Piece" {
      if (-not (MhOpenCreate 'Pay Head' 'P4')) { return }
      MhFill 'P4' @(
        @{ l = '(^|\W)Name$'; k = (SK "$P Piece") + '{ENTER}' }, @{ l = 'Pay ?head type'; k = 'Earnings for Employees{ENTER}' },
        @{ l = '(^|\W)Under$'; k = 'Indirect Expenses{ENTER}' }, @{ l = 'Affect net salary'; k = 'y{ENTER}' },
        @{ l = 'Calculation type'; k = 'On Production{ENTER}' }, @{ l = 'Production type'; k = 'MH Pieces{ENTER}' }) 35
    } @(@('CALCULATIONTYPE', 'On Production'), @('[A-Z.]*', 'MH Pieces')) $(if ($line) { 'payhead_accept_post' })
  }
  MhCase $phase 'P5-alter-net-salary' 'Pay Head' "$P Basic" {
    if (-not (MhOpenAlter 'Pay Head' "$P Basic" 'P5')) { return }
    MhFill 'P5' @(@{ l = 'Affect net salary'; k = 'n{ENTER}' }, @{ l = 'displayed in payslip'; k = (SK "$P Basic Pay") + '{ENTER}' })
  } @(@('AFFECTSNETSALARY', 'No'), @('[A-Z.]*', [regex]::Escape("$P Basic Pay"))) $(if ($line) { 'payhead_accept_post' })
  MhCase $phase 'P6-alter-slab' 'Pay Head' "$P HRA" {
    if (-not (MhOpenAlter 'Pay Head' "$P HRA" 'P6')) { return }
    MhFill 'P6' @(@{ l = '(^|\W)Compute$'; k = '{ENTER}' }, @{ h = '^Function'; k = 'End of List{ENTER}' }, @{ h = '^Value'; k = '50{ENTER}' }) 40
  } @(, @('[A-Z.]*', '50(\.0+)?( ?%)?')) $(if ($line) { 'payhead_accept_post' })
  # ---------------- deletes (Alter, Alt+D, y): the master gone; before_delete / after_delete lines
  MhCase $phase 'D1-delete-godown' 'Godown' "$P Godown 2" { MhDelete 'Godown' "$P Godown 2" 'D1' } @() $(if ($line) { 'after_delete|before_delete' }) -gone
  MhCase $phase 'D2-delete-stock-item' 'Stock Item' "$P Item V" { MhDelete 'Stock Item' "$P Item V" 'D2' } @() $(if ($line) { 'after_delete|before_delete' }) -gone
  MhCase $phase 'D3-delete-pay-head' 'Pay Head' "$P HRA" { MhDelete 'Pay Head' "$P HRA" 'D3' } @() $(if ($line) { 'after_delete|before_delete' }) -gone
  # ---------------- save time: the same alteration saved 5 times per master (alias typed afresh), Ctrl+A to a still screen
  if (-not $mhOnly -or 'T' -match $mhOnly) {
    foreach ($tm in @(@('Godown', "$P Godown 1R"), @('Stock Item', "$P Item 1R"), @('Pay Head', "$P Basic"))) {
      $ms = @()
      for ($i = 1; $i -le 5; $i++) {
        if (-not (MhOpenAlter $tm[0] $tm[1] "T-$($tm[0] -replace ' ', '')$i")) { $ms += -1; continue }
        $w = Walk "T$i" @(@{ l = 'alias'; k = (SK "$P T$i") + '{ENTER}' }) 4 -stop
        $s = MhSave "T-$($tm[0] -replace ' ', '')$i"; $ms += $s.ms
      }
      $null = MhGateway 'after the timing'
      $script:mh["$phase|T-$($tm[0])"] = [pscustomobject]@{ phase = $phase; case = "T-$($tm[0])"; kind = $tm[0]; ms = $ms }
      Info "mh $phase save time $($tm[0]) (alter, Ctrl+A to a still screen): $($ms -join ', ') ms"
    }
  }
}

# ---- phase A: the add-on from the ref (Tally as flowv.ps1 started it, afresh first: a known Gateway)
$script:mhTdl = @($tdl); MhIni; MhFresh 'phase A: the add-on from the ref'
$recFiles = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue)
MhPhase 'A'
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $mhCap "mh-A-recorder-$($_.Name)") }
# ---- phase B: no TDL at all
$script:mhTdl = @(); MhIni; MhFresh 'phase B: no TDL'
$rb = RecCount
MhPhase 'B'
Info "mh phase B (no TDL): add-on lines written during the phase: $((RecSince $rb).Count) (expected 0)"

# ---- the verdicts
$med = { param($a) $s = @($a | Where-Object { $_ -ge 0 } | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { -1 } }
$rows = @()
foreach ($k in $script:mh.Keys) {
  $a = $script:mh[$k]; if ($a.phase -ne 'A' -or $a.case -like 'T-*') { continue }
  $b = $script:mh["B|$($a.case)"]
  $diff = @()
  if ($b) { $ap = @($a.pairs); $bp = @($b.pairs); foreach ($x in $ap) { if ($bp -notcontains $x) { $diff += "A:$x" } }; foreach ($x in $bp) { if ($ap -notcontains $x) { $diff += "B:$x" } } }
  $state = if (-not $b) { 'HARNESS' }
           elseif (-not $b.stored) { 'HARNESS' }
           elseif ($a.stored -and -not $a.err -and $a.lineOk -and $diff.Count -eq 0) { 'PASS' }
           else { 'FAIL' }
  $why = @()
  if ($b -and -not $b.stored) { $why += "B (no add-on) did not store it either: the keys did not get there ($($b.miss))" }
  if (-not $a.stored) { $why += "A missing: $($a.miss)" }
  if ($a.err) { $why += "A error on screen: $($a.err)" }
  if (-not $a.lineOk) { $why += 'A: the add-on line for it not written' }
  if ($diff.Count) { $why += "A and B stored differently: $(($diff | Select-Object -First 12) -join '; ')" }
  $tA = $a.ms; $tB = if ($b) { $b.ms } else { -1 }
  Result "mh $($a.kind) $($a.case)" $state ("stored as typed A {0} / B {1}; line written {2} ({3}); Ctrl+A A {4} ms / B {5} ms; {6}; walk A: {7}" -f $a.stored, $(if ($b) { $b.stored } else { '-' }), $a.lineOk, $(if ($a.lines) { $a.lines } else { 'none' }), $tA, $tB, $(if ($why.Count) { $why -join ' | ' } else { 'A = B field by field' }), $a.walk)
  $rows += [pscustomobject]@{ rel = $rel; kind = $a.kind; case = $a.case; state = $state; storedA = $a.stored; storedB = $(if ($b) { $b.stored } else { $null }); line = $a.lineOk; msA = $tA; msB = $tB; diff = ($diff -join '; '); missA = $a.miss; missB = $(if ($b) { $b.miss } else { '' }); errA = $a.err; errB = $(if ($b) { $b.err } else { '' }); lines = $a.lines }
}
foreach ($kd in 'Godown', 'Stock Item', 'Pay Head') {
  $ta = $script:mh["A|T-$kd"]; $tb = $script:mh["B|T-$kd"]
  if (-not $ta -or -not $tb) { continue }
  $ma = & $med $ta.ms; $mb = & $med $tb.ms
  $rows += [pscustomobject]@{ rel = $rel; kind = $kd; case = 'T-save-time'; state = 'MEASURE'; msA = $ma; msB = $mb; diff = "A $($ta.ms -join ',') / B $($tb.ms -join ',')" }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE mh {0} save time (alter, Ctrl+A to a still screen, 5 each): with the add-on {1} ms (median {2}); no TDL {3} ms (median {4}); added {5} ms" -f $kd, ($ta.ms -join ', '), $ma, ($tb.ms -join ', '), $mb, $(if ($ma -ge 0 -and $mb -ge 0) { $ma - $mb } else { '-' }))
}
$rows | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'mh-summary.json') -Encoding UTF8
