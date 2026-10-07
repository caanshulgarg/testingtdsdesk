# probe233.ps1 - bridge 2.3.3, items b and c: a probe on real TallyPrime (no bridge), run instead of round 4 when the
# workflow is dispatched with probe=probe233. Only the runner's own Windows user. Findings go to
# $env:RES\probe233\findings.txt, one line each; the screenshots p233-* to the shots.
#
#  b. the Windows user's name inside Tally: Tally's own functions asked through the XML port (Function export), and the
#     same expressions inside an add-on (one TDL file each, so a function Tally does not know fails that file alone),
#     written on a Ledger saved on the screen
#  c. the master forms: each master (Pay Head, Stock Item, Unit, Godown, Employee) altered and saved with no add-on, then
#     with a hook on its form (one file each); Unit with four hook shapes, each on its own start; the save confirmed by
#     the master's AlterID; Ctrl+A to a still screen timed; a master deleted with the live add-on loaded
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'probe233'; New-Item -ItemType Directory -Force $out | Out-Null
$pd = 'C:\fcspike\p233'; New-Item -ItemType Directory -Force $pd, "$pd\tdl" | Out-Null
$rec = 'C:\ProgramData\FinCom\recorder'; New-Item -ItemType Directory -Force $rec | Out-Null
$find = Join-Path $out 'findings.txt'; Set-Content $find @() -Encoding UTF8
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss.fff)] $m" }
function Find($m) { Write-Host "FINDING $m"; Add-Content -Path $find -Value $m -Encoding UTF8 }
function Shot($n) { & "$PSScriptRoot\shot.ps1" "p233-$n" }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class P233 {
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
  // Ctrl+<key> sent; ms until the screen first changed, and until it last changed before staying still for stableMs
  public static string CtrlTimed(char key, int stableMs, int maxMs) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr), bits;
    BMIH bi = new BMIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0), old = SelectObject(mem, dib);
    try {
      long prev = Hash(mem, scr, bits, w, h);
      Stopwatch sw = Stopwatch.StartNew();
      byte vk = (byte)char.ToUpperInvariant(key);
      keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
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
'@
$timer = [bool]('P233' -as [type])
if ($timer) { [P233]::timeBeginPeriod(1) | Out-Null } else { Say 'HARNESS: the screen timer did not compile' }

$script:tpid = 0
function Win { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; if (-not $p -or $p.MainWindowHandle -eq 0) { return $null }; $p }
function Front { $p = Win; if (-not $p) { return $false }; [P233]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [P233]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500; $true }
function KeysTo([string]$k, $wait = 2, $n = '') { if (-not (Front)) { Say "[keys] Tally has no window"; return }; [System.Windows.Forms.SendKeys]::SendWait($k); Write-Host "[keys] '$k'"; Start-Sleep $wait; if ($n) { Shot $n } }
function Post($body, $label = '') {
  try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 120).Content
    if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 400) { $s = $s.Substring(0, 400) + '...' }; Write-Host "[$label] $s" }; return $c } catch { Write-Host "[$label] failed: $($_.Exception.Message)"; return '' }
}
function Imp($msg, $label) {
  $r = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') ''
  $s = ($r -replace '\s+', ''); Say "import $label`: $($s.Substring(0, [Math]::Min(260, $s.Length)))"; return $r
}
function Coll($id, $type, $fetch, $filter = '', $extra = '') {
  $f = if ($filter) { "<FILTER>P233F</FILTER></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"P233F`">$([Security.SecurityElement]::Escape($filter))</SYSTEM>" } else { '</COLLECTION>' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $extra + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
$folder = (Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1).Name
function Start-T([string[]]$tdls, $tag) {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $l = @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $folder")
  foreach ($t in $tdls) { if ($t) { $l += "TDL = $t" } }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $p.Id
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {}; if ($p.HasExited) { break } }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 8 "$tag-started"
  $ok = (Post (Coll 'P233Co' 'Company' 'NAME, GUID')) -match [regex]::Escape($co)
  $script:warned = $false
  for ($w = 1; -not $ok -and $w -le 2; $w++) { KeysTo '{ENTER}' 8 "$tag-key-$w"; $ok = (Post (Coll 'P233Co' 'Company' 'NAME, GUID')) -match [regex]::Escape($co); if ($ok) { $script:warned = $true } }
  Say "Tally started ($tag; TDL: $(if ($tdls) { ($tdls | ForEach-Object { Split-Path $_ -Leaf }) -join ', ' } else { 'none' })): company open $ok; TDL-error warning $($script:warned)"
  return $ok
}

# ---------------------------------------------------------------- setup: payroll and godowns on; the masters
if (-not (Start-T @() 'setup')) { Find 'HARNESS: the company did not open'; return }
$cguid = [regex]::Match((Post (Coll 'P233Co' 'Company' 'NAME, GUID')), '<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value
$c0 = Post (Coll 'P233CoAll' 'Company' 'NAME' '' '<NATIVEMETHOD>*</NATIVEMETHOD>')
$on = @('ISPAYROLLON', 'PREVISMULTIGODOWNON', 'ISCOSTCENTRESON') | Where-Object { $c0 -match "<$_>" }
Imp ('<COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME>' + (($on | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</COMPANY>') "features $($on -join ',')" | Out-Null
$c1 = Post (Coll 'P233CoAll' 'Company' 'NAME' '' '<NATIVEMETHOD>*</NATIVEMETHOD>')
Find "company features after the alter: $((@('ISPAYROLLON', 'PREVISMULTIGODOWNON', 'ISCOSTCENTRESON') | ForEach-Object { "$_=$([regex]::Match($c1, "<$_[^>]*>([^<]*)<").Groups[1].Value)" }) -join ' ')"
$ms = @(
  '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>0</DECIMALPLACES></UNIT>',
  '<UNIT NAME="Box" ACTION="Create"><NAME>Box</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>0</DECIMALPLACES></UNIT>',
  '<GODOWN NAME="PD Godown A" ACTION="Create"><NAME.LIST><NAME>PD Godown A</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>',
  '<GODOWN NAME="PD Godown Del" ACTION="Create"><NAME.LIST><NAME>PD Godown Del</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>',
  '<STOCKITEM NAME="PD Item 1" ACTION="Create"><NAME.LIST><NAME>PD Item 1</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>',
  '<STOCKITEM NAME="PD Item Del" ACTION="Create"><NAME.LIST><NAME>PD Item Del</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>',
  '<COSTCENTRE NAME="PD Staff" ACTION="Create"><NAME.LIST><NAME>PD Staff</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>',
  '<COSTCENTRE NAME="PD Emp 001" ACTION="Create"><NAME.LIST><NAME>PD Emp 001</NAME></NAME.LIST><PARENT>PD Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20260401</DATEOFJOIN><DESIGNATION>Clerk</DESIGNATION><EMPLOYEENUMBER>E1</EMPLOYEENUMBER></COSTCENTRE>',
  '<LEDGER NAME="PD Basic" ACTION="Create"><NAME.LIST><NAME>PD Basic</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><FORPAYROLL>Yes</FORPAYROLL></LEDGER>'
)
foreach ($m in $ms) { Imp $m ([regex]::Match($m, 'NAME="([^"]+)"').Groups[1].Value) | Out-Null }

# ---------------------------------------------------------------- b. the Windows user's name: Tally's functions over XML
Say '---- b: Tally''s own functions asked through the XML port'
function Fn($id, [string[]]$params) {
  $pl = ($params | ForEach-Object { "<PARAM>$([Security.SecurityElement]::Escape($_))</PARAM>" }) -join ''
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST>' + $pl + '</FUNCPARAMLIST></DESC></BODY></ENVELOPE>') ''
  $r = [regex]::Match($x, '<RESULT[^>]*>([^<]*)</RESULT>'); $e = ([regex]::Matches($x, '<ERRORMSG>([^<]*)') | ForEach-Object { $_.Groups[1].Value -replace '&#10;', ' ' }) -join ' / '
  if ($r.Success) { "result '$($r.Groups[1].Value)'" } elseif ($e) { "error: $e" } else { "other: $(($x -replace '\s+', ' ').Substring(0, [Math]::Min(200, $x.Length)))" }
}
Find "runner: whoami=$(whoami) USERNAME=$env:USERNAME COMPUTERNAME=$env:COMPUTERNAME"
$sysinfo = 'UserName', 'WindowsUser', 'WindowsUserName', 'WinUserName', 'OSUserName', 'OSUser', 'SystemUserName', 'SystemUser', 'LoggedInUser', 'LoginUser', 'CurrentUser', 'User', 'SystemName', 'ComputerName', 'MachineName', 'ApplicationPath', 'DataPath', 'SystemDate', 'SerialNumber'
foreach ($s in $sysinfo) { Find "XML `$`$SysInfo:$s -> $(Fn '$$SysInfo' @($s))" }
foreach ($f in '$$GetEnv', '$$GetEnvVar', '$$GetEnvironmentVariable', '$$EnvVar', '$$Env', '$$Environment', '$$SysEnv', '$$EnvironmentVariable') { Find "XML ${f}:USERNAME -> $(Fn $f @('USERNAME'))" }
foreach ($f in '$$MachineName', '$$SystemName', '$$UserName', '$$WindowsUser', '$$WindowsUserName', '$$OSUserName', '$$CmpUserName', '$$LoginName', '$$ComputerName', '$$SysUserName') { Find "XML $f -> $(Fn $f @())" }

# ---------------------------------------------------------------- the TDL files of the probe
# the same expressions inside an add-on: one file each, [#Form: Ledger] On Form Accept calls only (W00 gives the form its
# Form Accept), each writing "<label>=<value>" to its own file; a file whose function Tally does not know is ignored
$wexpr = [ordered]@{}
foreach ($s in $sysinfo) { $wexpr["SysInfo:$s"] = "`$`$SysInfo:$s" }
foreach ($f in 'GetEnv', 'GetEnvVar', 'GetEnvironmentVariable', 'EnvVar', 'Env') { $wexpr["${f}:USERNAME"] = "`$`$${f}:`"USERNAME`"" }
foreach ($f in 'MachineName', 'SystemName', 'UserName', 'WindowsUser', 'OSUserName', 'CmpUserName', 'ComputerName') { $wexpr[$f] = "`$`$$f" }
$wfiles = @()
Set-Content "$pd\tdl\W00.tdl" -Encoding ASCII -Value @('[#Form: Ledger]', '    On : Form Accept : Yes : Form Accept')
$wfiles += "$pd\tdl\W00.tdl"
$i = 0
foreach ($k in $wexpr.Keys) {
  $i++; $n = 'W{0:d2}' -f $i
  Set-Content "$pd\tdl\$n.tdl" -Encoding ASCII -Value @(
    "[#Form: Ledger]", "    On : Form Accept : Yes : Call : P233${n}F", "",
    "[Function: P233${n}F]", "    Variable : v : String", "    Returns  : Logical",
    "    01 : SET : v : $($wexpr[$k])",
    "    02 : OPEN FILE : `"$pd\out-$n.txt`" : Text : Write : Unicode",
    "    03 : IF : NOT `$`$LastResult", "    04 :    RETURN : Yes", "    05 : END IF",
    "    06 : WRITE FILE LINE : `"$k=`" + ##v", "    07 : CLOSE TARGET FILE", "    08 : RETURN : Yes")
  $wfiles += "$pd\tdl\$n.tdl"
}
# a file name with %USERNAME% in it (is it expanded?)
Set-Content "$pd\tdl\W99.tdl" -Encoding ASCII -Value @(
  "[#Form: Ledger]", "    On : Form Accept : Yes : Call : P233W99F", "", "[Function: P233W99F]", "    Returns  : Logical",
  "    01 : OPEN FILE : `"$pd\env-%USERNAME%.txt`" : Text : Write : Unicode", "    02 : IF : NOT `$`$LastResult", "    03 :    RETURN : Yes", "    04 : END IF",
  "    05 : WRITE FILE LINE : `"pct`"", "    06 : CLOSE TARGET FILE", "    07 : RETURN : Yes")
$wfiles += "$pd\tdl\W99.tdl"

# the master forms: a hook per form name, one file each (the live add-on's three-line shape), heads only
function HookFile($n, $form, $tag, [string]$shape = 'full') {
  $f = "$pd\tdl\$n.tdl"
  $on = switch ($shape) {
    'accept' { @("    On : Form Accept : Yes : Form Accept") }
    'pre' { @("    On : Form Accept : Yes : Call : P233${n}F : `"${tag}_pre`"", "    On : Form Accept : Yes : Form Accept") }
    'post' { @("    On : Form Accept : Yes : Form Accept", "    On : Form Accept : Yes : Call : P233${n}F : `"${tag}_post`"") }
    default { @("    On : Form Accept : Yes : Call : P233${n}F : `"${tag}_pre`"", "    On : Form Accept : Yes : Form Accept", "    On : Form Accept : Yes : Call : P233${n}F : `"${tag}_post`"") }
  }
  Set-Content $f -Encoding ASCII -Value (@("[#Form: $form]") + $on + @("",
    "[Function: P233${n}F]", "    Parameter : pEv : String", "    Returns   : Logical",
    "    01 : OPEN FILE : `"$pd\hook-$n.txt`" : Text : Write : Unicode", "    02 : IF : NOT `$`$LastResult", "    03 :    RETURN : Yes", "    04 : END IF",
    "    05 : WRITE FILE LINE : `"ev=`" + ##pEv + `"|form=$form|name=`" + (`$`$String:`$Name) + `"|guid=`" + (`$`$String:`$Guid) + `"|mid=`" + (`$`$String:`$MasterID) + `"|aid=`" + (`$`$String:`$AlterID) + `"|parent=`" + (`$`$String:`$Parent) + `"|t=`" + (`$`$String:`$`$MachineTime)",
    "    06 : CLOSE TARGET FILE", "    07 : RETURN : Yes"))
  return $f
}
$hforms = [ordered]@{ H01 = 'Pay Head'; H02 = 'Stock Item'; H03 = 'Godown'; H04 = 'Employee'; H05 = 'Cost Centre'; H06 = 'Employee Master'; H07 = 'Employees'; H08 = 'Payroll Employee'; H09 = 'Location'; H10 = 'Stock Items'; H11 = 'Simple Unit'; H12 = 'Compound Unit'; H13 = 'Employee Group'; H14 = 'Cost Centres' }
$hfiles = @(); foreach ($k in $hforms.Keys) { $hfiles += HookFile $k $hforms[$k] (($hforms[$k] -replace ' ', '').ToLower()) }
# system events a master save might have (each its own file: an unknown event fails that file alone)
$sev = [ordered]@{ E01 = 'After Save Object'; E02 = 'Before Save Object'; E03 = 'After Object Save'; E04 = 'Save Object'; E05 = 'After Alter Object'; E06 = 'After Create Object'; E07 = 'Form Accept' }
$efiles = @()
foreach ($k in $sev.Keys) {
  $f = "$pd\tdl\$k.tdl"
  Set-Content $f -Encoding ASCII -Value @("[System: Events]", "    P233$k : $($sev[$k]) : Yes : Call : P233${k}F", "",
    "[Function: P233${k}F]", "    Returns : Logical",
    "    01 : OPEN FILE : `"$pd\sev-$k.txt`" : Text : Write : Unicode", "    02 : IF : NOT `$`$LastResult", "    03 :    RETURN : Yes", "    04 : END IF",
    "    05 : WRITE FILE LINE : `"$($sev[$k])|name=`" + (`$`$String:`$Name) + `"|mid=`" + (`$`$String:`$MasterID)", "    06 : CLOSE TARGET FILE", "    07 : RETURN : Yes")
  $efiles += $f
}

# ---------------------------------------------------------------- masters altered (Gateway > Alter > type > name > Ctrl+A)
$mType = @{ 'Pay Head' = 'Ledger'; 'Stock Item' = 'StockItem'; 'Unit' = 'Unit'; 'Godown' = 'Godown'; 'Employee' = 'CostCentre' }
$mName = [ordered]@{ 'Pay Head' = 'PD Basic'; 'Stock Item' = 'PD Item 1'; 'Unit' = 'Nos'; 'Godown' = 'PD Godown A'; 'Employee' = 'PD Emp 001' }
function Aid($form, $name) { [int]('0' + [regex]::Match((Post (Coll 'P233Aid' $mType[$form] 'NAME, ALTERID' "`$Name = `"$name`"")), '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value) }
function HookLines { $o = @(); Get-ChildItem $pd -Filter 'hook-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { $o += @(Get-Content $_.FullName -Encoding Unicode | ForEach-Object { "$($_)" }) }; Get-ChildItem $pd -Filter 'sev-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { $o += @(Get-Content $_.FullName -Encoding Unicode) }; $o }
function ClearHooks { Get-ChildItem $pd -Filter 'hook-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force; Get-ChildItem $pd -Filter 'sev-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force }
# one master altered on a fresh start; $change: a text typed into the form's second field first
function Alter($cfg, [string[]]$tdls, $form, [string]$change = '') {
  $name = $mName[$form]; $t = "$cfg-$($form -replace ' ', '')"
  $paths = if ($form -eq 'Godown') { @(@('Location', $name), @('Godown', $name), @($name)) } else { @(@($form, $name), @($name)) }
  $saved = $false; $how = ''; $tm = ''; $a0 = 0; $a1 = 0
  foreach ($path in $paths) {
    if (-not (Start-T $tdls $t)) { Find "HARNESS: $t did not open the company"; return }
    $warned = $script:warned; ClearHooks
    $a0 = Aid $form $name
    KeysTo 'a' 3 "$t-alter"
    foreach ($k in $path) { KeysTo $k 2; KeysTo '{ENTER}' 3 }
    Shot "$t-form"
    if ($change) { KeysTo '{ENTER}' 1; KeysTo $change 1 "$t-changed" }
    if ((Front) -and $timer) { $tm = [P233]::CtrlTimed('a', 600, 15000) } else { KeysTo '^a' 2 }
    Start-Sleep 2; Shot "$t-after"
    $a1 = Aid $form $name
    if ($a1 -gt $a0) { $saved = $true; $how = $path -join ' > '; break }
  }
  $hl = @(HookLines)
  if ($hl.Count) { Set-Content (Join-Path $out "hook-$t.txt") $hl -Encoding UTF8 }
  Find ("master {0} '{1}' [{2}{3}]: saved {4} (AlterID {5} -> {6}, via {7}); Ctrl+A to a still screen (first;last ms) {8}; TDL warning {9}; hook lines {10}: {11}" -f $form, $name, $cfg, $(if ($change) { ", typed '$change'" }), $saved, $a0, $a1, $(if ($how) { $how } else { 'none' }), $tm, $warned, $hl.Count, ($hl -join ' || '))
}

# ---------------------------------------------------------------- c. no add-on: can each master be saved here, and how fast
Say '---- c: each master altered with no add-on'
foreach ($f in $mName.Keys) { Alter 'none' @() $f }
Alter 'none' @() 'Unit' 'Numbers'

# ---------------------------------------------------------------- b + c: every probe file loaded at once (Unit not hooked)
Say '---- b + c: the probe files loaded at once: a ledger on the screen, then each master altered'
$all = @($wfiles) + @($hfiles) + @($efiles)
if (Start-T $all 'probe-files') {
  Find "probe files loaded: $($all.Count); Tally's TDL-error warning shown: $($script:warned)"
  # Help > TDLs & Add-Ons: which files Tally ignored (screens)
  KeysTo '{F1}' 3 'help-0'; KeysTo 'TDL' 2 'help-1'; KeysTo '{ENTER}' 4 'help-2'; KeysTo '{F4}' 4 'help-3'; KeysTo '{ESC}' 2; KeysTo '{ESC}' 2; KeysTo '{ESC}' 2 'help-4'
  if (-not (Start-T $all 'probe-files-2')) { Find 'HARNESS: probe-files-2 did not open' }
  KeysTo 'c' 3 'w-create'; KeysTo 'Ledger{ENTER}' 3; KeysTo 'P233 User Party{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo 'Sundry Debtors{ENTER}' 2 'w-form'; KeysTo '^a' 4 'w-saved'
  $led = Post (Coll 'P233Led' 'Ledger' 'NAME, ALTERID' '$Name = "P233 User Party"')
  Find "ledger saved on the screen with the probe files: $([bool]($led -match 'P233 User Party'))"
  foreach ($k in 1..($wexpr.Count)) {
    $n = 'W{0:d2}' -f $k; $lab = @($wexpr.Keys)[$k - 1]; $f = "$pd\out-$n.txt"
    Find "TDL $n $lab ($($wexpr[$lab])): $(if (Test-Path $f) { "written: '$((Get-Content $f -Encoding Unicode) -join ' | ')'" } else { 'NOT written (the file was ignored, or its function wrote nothing)' })"
  }
  Find "TDL W99 %USERNAME% in a file name: files $((Get-ChildItem $pd -Filter 'env-*' | ForEach-Object Name) -join ', ')"
  $hl = @(HookLines); Find "hook lines on the ledger save (none expected): $($hl -join ' || ')"
}
foreach ($f in 'Pay Head', 'Stock Item', 'Godown', 'Employee') { Alter 'hooks' $all $f }

# ---------------------------------------------------------------- c: Unit, each hook shape on its own start
Say '---- c: Unit with each hook shape'
foreach ($s in 'full', 'accept', 'pre', 'post') {
  $u = HookFile "U_$s" 'Unit' 'unit' $s
  Alter "unit-$s" @($u) 'Unit'
  Alter "unit-$s" @($u) 'Unit' "N$s"
}

# ---------------------------------------------------------------- c: deletes with the live add-on (do its System Events see masters?)
Say '---- c: masters deleted with the live add-on loaded'
$live = Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl'
if (Test-Path $live) {
  Copy-Item $live "$pd\tdl\FinComRecorder.tdl" -Force
  Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue
  foreach ($d in @(@('Stock Item', 'PD Item Del'), @('Godown', 'PD Godown Del'))) {
    $mName[$d[0]] = $d[1]
    if (-not (Start-T @("$pd\tdl\FinComRecorder.tdl") "del-$($d[0] -replace ' ', '')")) { continue }
    KeysTo 'a' 3; $p = if ($d[0] -eq 'Godown') { 'Location' } else { $d[0] }
    KeysTo $p 2; KeysTo '{ENTER}' 3; KeysTo $d[1] 2; KeysTo '{ENTER}' 3 "del-$($d[0] -replace ' ', '')-form"
    KeysTo '%d' 3 "del-$($d[0] -replace ' ', '')-ask"; KeysTo 'y' 3 "del-$($d[0] -replace ' ', '')-done"
    $left = Post (Coll 'P233Left' $mType[$d[0]] 'NAME' "`$Name = `"$($d[1])`"")
    Find "delete $($d[0]) '$($d[1])' with the live add-on: gone from Tally $(-not ($left -match [regex]::Escape($d[1])))"
  }
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "rec-$($_.Name)"); Find "live add-on file $($_.Name): $((Get-Content $_.FullName -Encoding Unicode) -join ' || ')" }
} else { Find "HARNESS: no live add-on at $live" }
Get-ChildItem "$pd\tdl" | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "tdl-$($_.Name)") }
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Say '== probe233 end'
