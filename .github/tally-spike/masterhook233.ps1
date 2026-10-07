# masterhook233.ps1 - branch next-masterhook (input only=masterhook): the add-on's master-form hooks on real Tally. Dot-sourced
# by flow4.ps1 (Tally 9000 with the add-on from the ref, bridge 1 running against the stub). For every master form the add-on
# at the ref hooks ([#Form: ...] in its FinComRecorder.tdl): the payroll and godown features on (XML), a master made by XML,
# then altered on the screen (Gateway > Alter > type > name > its alias typed > Ctrl+A, timed to a still screen):
#   MH-<form> saved: Tally's AlterID went up (the save normal), the add-on's file gained <kind>_accept_pre/post lines, bridge 1
#             sent master_altered with master_type, name and the GUID / MasterID; Ctrl+A to a still screen in ms
#   MH-create  a Unit and a Stock Item made on the screen: master_created
# The time of the same alter with no add-on is probe233's (run 37563133547, the same runner image).
Add-Type -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class MH233T {
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
  public static string CtrlA(int stableMs, int maxMs) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr), bits;
    BMIH bi = new BMIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0), old = SelectObject(mem, dib);
    try {
      long prev = Hash(mem, scr, bits, w, h);
      Stopwatch sw = Stopwatch.StartNew();
      keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x41, 0, 0, UIntPtr.Zero); keybd_event(0x41, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
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
function MHColl($id, $type, $fetch, $filter) {
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH><FILTER>MHF</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="MHF">' + [Security.SecurityElement]::Escape($filter) + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
function MH233 {
  Say '---- MH: the add-on''s master forms (next-masterhook)'
  $addon = Get-Content (Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl') -Raw
  $hooked = @([regex]::Matches($addon, '(?m)^\[#Form: ([^\]]+)\]') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -notin 'Voucher', 'Ledger' })
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO MH the add-on at the ref hooks: $($hooked -join ', ')"
  # features and masters by XML (no add-on event fires for an XML import)
  $c0 = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MHCoAll</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="MHCoAll" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $on = @('ISPAYROLLON', 'PREVISMULTIGODOWNON', 'ISCOSTCENTRESON') | Where-Object { $c0 -match "<$_>" }
  Imp 9000 $co1 'All Masters' ('<COMPANY NAME="' + $co1 + '" ACTION="Alter"><NAME>' + $co1 + '</NAME>' + (($on | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</COMPANY>') "features $($on -join ',')" | Out-Null
  foreach ($m in @(
      '<UNIT NAME="MHN" ACTION="Create"><NAME>MHN</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>0</DECIMALPLACES></UNIT>',
      '<GODOWN NAME="MH Godown A" ACTION="Create"><NAME.LIST><NAME>MH Godown A</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>',
      '<STOCKITEM NAME="MH Item 1" ACTION="Create"><NAME.LIST><NAME>MH Item 1</NAME></NAME.LIST><BASEUNITS>MHN</BASEUNITS></STOCKITEM>',
      '<COSTCENTRE NAME="MH Staff" ACTION="Create"><NAME.LIST><NAME>MH Staff</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>',
      '<COSTCENTRE NAME="MH Emp 001" ACTION="Create"><NAME.LIST><NAME>MH Emp 001</NAME></NAME.LIST><PARENT>MH Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20260401</DATEOFJOIN><DESIGNATION>Clerk</DESIGNATION><EMPLOYEENUMBER>E1</EMPLOYEENUMBER></COSTCENTRE>',
      '<LEDGER NAME="MH Basic" ACTION="Create"><NAME.LIST><NAME>MH Basic</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><FORPAYROLL>Yes</FORPAYROLL></LEDGER>')) {
    Imp 9000 $co1 'All Masters' $m ([regex]::Match($m, 'NAME="([^"]+)"').Groups[1].Value) | Out-Null
  }
  $mType = @{ 'Pay Head' = 'Ledger'; 'Stock Item' = 'StockItem'; 'Unit' = 'Unit'; 'Godown' = 'Godown'; 'Employee' = 'CostCentre' }
  $mName = [ordered]@{ 'Pay Head' = 'MH Basic'; 'Stock Item' = 'MH Item 1'; 'Unit' = 'MHN'; 'Godown' = 'MH Godown A'; 'Employee' = 'MH Emp 001' }
  $kind = @{ 'Pay Head' = 'payhead'; 'Stock Item' = 'stockitem'; 'Unit' = 'unit'; 'Godown' = 'godown'; 'Employee' = 'employee' }
  function MAid($form, $name) { [int]('0' + [regex]::Match((Post 9000 (MHColl 'MHAid' $mType[$form] 'NAME, ALTERID, MASTERID, GUID' "`$Name = `"$name`"")), '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value) }
  function RecText { (Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'failed.txt' } | ForEach-Object { Get-Content $_.FullName -Encoding Unicode }) -join "`n" }
  # Tally 9000 started afresh before each master (its Gateway in a known state: run 37568281335 found it left in a
  # Banking menu by the step before); the add-on and the company as round 4 loaded them; bridge 1 keeps running
  function MHFresh($tag) {
    Get-Process -Id $script:tallyPids[9000] -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
    $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tallyPids[9000] = $t.Id
    $up = WaitPort 9000; Start-Sleep 5; KeysTo 9000 'a' 4; KeysTo 9000 't' 8 "mh-$tag-fresh"
    Write-Host "  Tally :9000 started afresh ($tag): port $up, company open $((ListCo 9000) -match [regex]::Escape($co1))"
  }
  foreach ($form in $mName.Keys) {
    $name = $mName[$form]; $t = $form -replace ' ', ''
    $paths = if ($form -eq 'Godown') { @(@('Location', $name), @('Godown', $name)) } else { @(@($form, $name)) }
    $m0 = Mark; $a0 = MAid $form $name; $saved = $false; $tm = ''; $how = ''
    foreach ($path in $paths) {
      MHFresh $t
      $r0 = RecText
      KeysTo 9000 'a' 3 "mh-$t-alter"
      foreach ($k in $path) { KeysTo 9000 $k 2; KeysTo 9000 '{ENTER}' 3 }
      Shot "mh-$t-form"
      # a real change: the second field (alias; a Unit's formal name) typed, so Tally has something to save (probe233: a
      # Unit or Godown accepted unchanged is not saved again when the form carries an On : Form Accept line)
      KeysTo 9000 '{ENTER}' 1; KeysTo 9000 ("MH" + (Get-Random -Minimum 1000 -Maximum 9999)) 1 "mh-$t-changed"
      try { KeysTo 9000 '' 0 } catch {}
      $tm = [MH233T]::CtrlA(600, 15000)
      Start-Sleep 2; Shot "mh-$t-after"
      $a1 = MAid $form $name
      foreach ($i in 1..3) { KeysTo 9000 '{ESC}' 1 }
      KeysTo 9000 'n' 1   # a quit question at the Gateway, if one came: no
      if ($a1 -gt $a0) { $saved = $true; $how = $path -join ' > '; break }
    }
    Start-Sleep 3
    $new = (RecText).Substring([Math]::Min((RecText).Length, $r0.Length))
    $evs = @([regex]::Matches($new, 'FCR1\|ev=(' + $kind[$form] + '_accept_(?:pre|post))\|') | ForEach-Object { $_.Groups[1].Value })
    $isHooked = $form -in $hooked
    $x = $null
    if ($isHooked) { $x = @((WaitLine $m0 { $_.ev -eq 'master_altered' } 90) | Where-Object { $_.bid -eq $B[1].id })[0] }
    $raw = if ($x) { @((StubReqs)[$x.i].body.lines | Where-Object { $_.line_id -eq $x.lid })[0] } else { $null }
    $okLine = (-not $isHooked) -or ($evs -contains "$($kind[$form])_accept_post" -and $raw -and $raw.master_type -eq $form -and $raw.name -eq $name)
    $ms = ($tm -split ';')[1]
    Result "MH-$t saves with the hook" ($saved -and $okLine) ("{0} '{1}': hooked {2}; saved {3} (AlterID {4} -> {5}, via {6}); Ctrl+A to a still screen {7} ms (first change {8} ms); add-on lines: {9}; bridge 1 sent: {10}" -f $form, $name, $isHooked, $saved, $a0, $a1, $(if ($how) { $how } else { 'none' }), $ms, ($tm -split ';')[0], $(if ($evs) { $evs -join ' ' } else { 'none' }), $(if ($raw) { "event=$($raw.event) master_type=$($raw.master_type) name=$($raw.name) parent=$($raw.parent) guid=$($raw.object_guid) mid=$($raw.master_id) aid=$($raw.alter_id) xml=$(if ($raw.xml) { 'yes' } else { 'none' })" } else { 'nothing' }))
  }
  # a new Unit made on the screen: master_created (when Unit is hooked)
  if ('Unit' -in $hooked) {
    MHFresh 'cu'
    $m0 = Mark
    KeysTo 9000 'c' 3 'mh-cu-create'; KeysTo 9000 'Unit{ENTER}' 3 'mh-cu-form'; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 'MHB{ENTER}' 2 'mh-cu-typed'; try { KeysTo 9000 '' 0 } catch {}
    $tm = [MH233T]::CtrlA(600, 15000); Start-Sleep 2; Shot 'mh-cu-after'
    foreach ($i in 1..3) { KeysTo 9000 '{ESC}' 1 }; KeysTo 9000 'n' 1
    $made = (Post 9000 (MHColl 'MHU' 'Unit' 'NAME' '$Name = "MHB"')) -match 'MHB'
    $x = @((WaitLine $m0 { $_.ev -eq 'master_created' } 90) | Where-Object { $_.bid -eq $B[1].id })[0]
    $raw = if ($x) { @((StubReqs)[$x.i].body.lines | Where-Object { $_.line_id -eq $x.lid })[0] } else { $null }
    Result 'MH-create a Unit on the screen' ($made -and $raw -and $raw.master_type -eq 'Unit') ("made in Tally: {0}; Ctrl+A {1} ms; bridge 1 sent: {2}" -f $made, ($tm -split ';')[1], $(if ($raw) { "event=$($raw.event) master_type=$($raw.master_type) name=$($raw.name)" } else { 'nothing' }))
  }
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "mh-rec-$($_.Name)") }
  Snap 'mh'
}
