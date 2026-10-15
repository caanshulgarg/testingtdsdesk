# Bridge 2.4.5 harness library (modes dbm and dbres). TEST DATA ONLY: a throwaway company in this runner's own Tally,
# never the owner's computer; no bridge is installed. Dot-sourced by dbmv.ps1 / dbresv.ps1 (themselves dot-sourced by
# flowv.ps1 after c2, so $co1, $exe, $dir, $cap, $out, $resultsFile, Result, Info, Say, Shot, KeysTo and $script:tpid are
# flowv.ps1's).
#
# The rule of every request sent here (the owner's, for 2.4.5): ONE request at Tally at a time; the harness stops waiting
# at 2 s (the hard stop the bridge uses) and then does what the bridge does after a stop: it keeps the connection and
# waits for Tally's late answer, sending nothing else, so the full time Tally was held is known beside the stop. A
# request with no answer by its limit is "hung": the harness closes that Tally (by its own process id) and starts it again
# before anything else is sent. TStop throws if it is ever asked to send while a request is at Tally.
Add-Type -AssemblyName System.Net.Http
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DbNt { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h); }
'@
$script:DBT = 'http://127.0.0.1:9000'
$script:dbHc = [System.Net.Http.HttpClient]::new(); $script:dbHc.Timeout = [TimeSpan]::FromMinutes(15)
$script:dbBusy = $false
$script:dbSent = 0; $script:dbMaxInFlight = 0
function LE([string]$s) { [Security.SecurityElement]::Escape($s) }
function DbSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function DbDecode([byte[]]$b) {
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { return [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
  return [Text.Encoding]::UTF8.GetString($b)
}
# one request. inTime: answered within $stopMs. overrun: stopped at $stopMs, the late answer awaited (ms is Tally's full
# time). hung: no answer by $maxMs. ok: an answer was read. err: refused / reset / not answered
function TStop([string]$x, [int]$stopMs = 2000, [int]$maxMs = 60000) {
  if ($script:dbBusy) { throw 'harness rule broken: a second request while one is at Tally' }
  $script:dbBusy = $true; $script:dbSent++; $script:dbMaxInFlight = [Math]::Max($script:dbMaxInFlight, 1)
  $o = [pscustomobject]@{ ok = $false; inTime = $false; overrun = $false; hung = $false; ms = -1.0; body = ''; err = '' }
  $sw = [Diagnostics.Stopwatch]::StartNew(); $t = $null
  try {
    $c = [System.Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes($x))
    $c.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/xml;charset=utf-8')
    $t = $script:dbHc.PostAsync($script:DBT, $c)
    try { $null = $t.Wait($stopMs) } catch { }
    if (-not $t.IsCompleted) { $o.overrun = $true; try { $null = $t.Wait([Math]::Max(0, $maxMs - $stopMs)) } catch { } }
    if ($t.IsCompleted -and -not $t.IsFaulted -and -not $t.IsCanceled) {
      $o.body = DbDecode ($t.Result.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()); $o.ok = $true; $o.inTime = -not $o.overrun
    } elseif ($t.IsFaulted -or $t.IsCanceled) { $o.err = if ($t.Exception) { "$($t.Exception.GetBaseException().Message)" } else { 'cancelled' } }
    else { $o.hung = $true; $o.err = "no answer in $maxMs ms" }
  } catch { $o.err = "$_" }
  $o.ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
  if (-not $o.hung) { $script:dbBusy = $false }
  return $o
}
# the harness's own setup requests (imports, the full lists it counts from): one at a time too, no 2 s stop
function TSetup([string]$x, [int]$sec = 600) { TStop $x ($sec * 1000) ($sec * 1000) }

# ---- Tally's state without a request: the process, its window, the port
function DbPortOpen {
  $tc = [Net.Sockets.TcpClient]::new()
  try { $ar = $tc.BeginConnect('127.0.0.1', 9000, $null, $null); return ($ar.AsyncWaitHandle.WaitOne(500) -and $tc.Connected) } catch { return $false } finally { $tc.Close() }
}
function DbResponding { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; return [bool]($p -and -not $p.HasExited -and $p.Responding) }
function DbIdle { return ((DbResponding) -and (DbPortOpen)) }
function DbSuspend { $h = [DbNt]::OpenProcess(0x0800, $false, [int]$script:tpid); if ($h -ne [IntPtr]::Zero) { $null = [DbNt]::NtSuspendProcess($h); $null = [DbNt]::CloseHandle($h) }; Say "db: Tally (pid $($script:tpid)) suspended (not answering)" }
function DbResume { $h = [DbNt]::OpenProcess(0x0800, $false, [int]$script:tpid); if ($h -ne [IntPtr]::Zero) { $null = [DbNt]::NtResumeProcess($h); $null = [DbNt]::CloseHandle($h) } }
# close THIS Tally only (its own process id; never by name)
function DbClose { if ($script:tpid) { DbResume; Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; $script:dbBusy = $false; Start-Sleep 2; Say "db: Tally (pid $($script:tpid)) closed" }
function DbStartNoWait { $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id; Say "db: Tally started (pid $($script:tpid)), not waited for" }
# as flowv.ps1 starts it: the port, then the Educational-mode keys; the company loads from tally.ini
function DbStartKeys($tag) { KeysTo 'a' 4; KeysTo 't' 10 "db-$tag-started" }
$script:dbListCo = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function DbCompanyUp { $r = TStop $script:dbListCo 2000 20000; if ($r.hung) { DbClose; return $false }; return ($r.ok -and $r.body -match [regex]::Escape($co1)) }
function DbRestart($tag) {
  DbClose; DbStartNoWait
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; if (DbPortOpen) { break } }
  Start-Sleep 5; DbStartKeys $tag
  for ($i = 0; $i -lt 20; $i++) { if (DbCompanyUp) { return $true }; Start-Sleep 3 }
  return $false
}
# a light request after a step: the company list under 2 s, and the window responding
function DbLight { $r = TStop $script:dbListCo 2000 20000; if ($r.hung) { $null = DbRestart 'light-hung' }; return [pscustomobject]@{ ms = $r.ms; ok = ($r.ok -and $r.inTime); responding = (DbResponding) } }
# modal screens a person may leave open: the Day Book's date box (F2), an unsaved Receipt with its date box open
function DbModalDayBookDate { KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 6; KeysTo '{F2}' 3 'db-modal-daybook-f2' }
function DbModalEntry { KeysTo 'v' 4; KeysTo '{F6}' 3; KeysTo '{F2}' 3 'db-modal-entry-f2' }

# ---- the requests: from the ref's source (bridge-dist\dbmreq, written by a go test at the ref), else the copy committed
# beside this file (dbm\req, written at tax-accuracy 9fbaa74d3, bridge 2.4.4)
$script:dbReqDir = Join-Path $env:BRIDGE_DIST 'dbmreq'
if (-not (Test-Path (Join-Path $script:dbReqDir 'daybook-plain.xml'))) { $script:dbReqDir = Join-Path $PSScriptRoot 'dbm\req' }
$script:RQ = @{}
foreach ($f in Get-ChildItem $script:dbReqDir -Filter '*.xml') { $script:RQ[$f.BaseName] = (Get-Content $f.FullName -Raw).Trim() }
Info "db: requests from $($script:dbReqDir): $(($script:RQ.Keys | Sort-Object) -join ', ')"
function DmyOf([string]$d) { [DateTime]::ParseExact($d, 'yyyyMMdd', $null).ToString('d-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture) }
function WithDay([string]$tpl, [string]$d) { $tpl.Replace('@@CO@@', (LE $co1)).Replace('20991231', $d).Replace('31-Dec-2099', (DmyOf $d)) }
function WithRange([string]$tpl, [int64]$a, [int64]$u) { $tpl.Replace('@@CO@@', (LE $co1)).Replace('111111', "$a").Replace('222222', "$u") }
# the Day Book forms: D1-D4 exactly as the 2.4.4 source builds them (on the allow-list under "Day Book", pinned in all four
# forms); D5 = D1 with SVCURRENTDATE added (a new static variable: needs the owner's OK)
$script:DayForms = [ordered]@{ D1 = 'daybook-plain'; D2 = 'daybook-dmy'; D3 = 'daybook-plaint'; D4 = 'daybook-dmyt' }
function DayReq([string]$form, [string]$d) {
  if ($form -eq 'D5') { return (WithDay $script:RQ['daybook-plain'] $d).Replace('</SVTODATE>', "</SVTODATE><SVCURRENTDATE>$d</SVCURRENTDATE>") }
  return WithDay $script:RQ[$script:DayForms[$form]] $d
}
# the split by voucher type (each a new form: needs the owner's OK)
#   S1 <form>: the Day Book with <VOUCHERTYPENAME> added to its static variables
#   S2 <form>: the Voucher Register report with <VOUCHERTYPENAME>
#   S3 <n>:    the heads of that day and type: FinComDatesProbe's collection form n with AND $VoucherTypeName = "<type>"
#              (the bridge's formCollection filter shape); each entry then by FinComVoucherObject (on the allow-list)
function SplitReq([string]$kind, [string]$form, [string]$d, [string]$type) {
  $vt = '<VOUCHERTYPENAME>' + (LE $type) + '</VOUCHERTYPENAME>'
  switch ($kind) {
    'S1' { return (DayReq $form $d).Replace('</SVTODATE>', "</SVTODATE>$vt") }
    'S2' { return (DayReq $form $d).Replace('<REPORTNAME>Day Book</REPORTNAME>', '<REPORTNAME>Voucher Register</REPORTNAME>').Replace('</SVTODATE>', "</SVTODATE>$vt") }
    'S3' {
      $x = WithDay $script:RQ["datesprobe-$form"] $d
      $m = [regex]::Match($x, '(<SYSTEM TYPE="Formulae" NAME="FinComDatesProbeOnly">)(.*?)(</SYSTEM>)')
      $flt = '$VoucherTypeName = &#34;' + (LE $type) + '&#34;'
      if ($m.Success) { return $x.Substring(0, $m.Index) + $m.Groups[1].Value + '(' + $m.Groups[2].Value + ') AND ' + $flt + $m.Groups[3].Value + $x.Substring($m.Index + $m.Length) }
      return $x.Replace('</FETCH></COLLECTION>', '</FETCH><FILTERS>FinComDatesProbeOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDatesProbeOnly">' + $flt + '</SYSTEM>')
    }
  }
}
# the ledger count forms
#   L1: Tally's function $$NumItems:Ledger (TYPE Function; a $$ function other than $$SysName: TestNoComputedFigure)
#   L2: a Company collection with a COMPUTE of $$NumItems:Ledger (TYPE Collection; the same $$ rule)
#   L3: FinComLedgerIds, the bridge's fcCollection of Ledger fetching MASTERID only (no $$; a new request id), one request
#       for all, and chunked by 2,000 MasterIDs as FinComLedgers is
#   L4: TDSDeskNames (on the allow-list today; NAME, PARENT), chunked by 2,000 MasterIDs: the rows counted
#   L5: FinComCompany's AltMstId (on the allow-list): the highest master number, NOT a ledger count (shown to prove it)
function LedCountReq([string]$form) {
  switch ($form) {
    'L1' { return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>' }
    'L2' { return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerCount</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerCount" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCLEDGERCOUNT:$$NumItems:Ledger</COMPUTE><FILTERS>FinComLedgerCountOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerCountOnly">$Name = &#34;' + (LE $co1) + '&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>' }
  }
}
function CountRows([string]$body, [string]$tag) { return @([regex]::Matches($body, "<$tag[ >]")).Count }
function MaxMid([string]$body) { $m = 0L; foreach ($x in [regex]::Matches($body, '<MASTERID[^>]*>\s*(\d+)')) { $v = [int64]$x.Groups[1].Value; if ($v -gt $m) { $m = $v } }; return $m }
function AltMst { $r = TStop (WithDay $script:RQ['company-check'] '20991231') 2000 30000; if ($r.hung) { $null = DbRestart 'altmst-hung' }; return [pscustomobject]@{ r = $r; v = [int64]('0' + [regex]::Match($r.body, '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value) } }
# the entries of a Day Book / Voucher Register / collection answer: each one's first DATE and its type
function Entries([string]$body) {
  $l = @()
  foreach ($m in [regex]::Matches($body, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $d = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value
    $t = [regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)<').Groups[1].Value; if (-not $t) { $t = [regex]::Match($v, 'VCHTYPE="([^"]*)"').Groups[1].Value }
    $mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
    $l += [pscustomobject]@{ date = $d; type = $t; mid = $mid }
  }
  return , $l
}

# ---- the test data (TEST DATA ONLY): ZZ BIG TEST's masters, its vouchers re-dated by dbm\redate.py at the build
function DbImp([string]$report, [string]$msgs, [string]$label) {
  $x = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' + $msgs + '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  $r = TSetup $x 900
  $m = [regex]::Match($r.body, '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>')
  $k = [pscustomobject]@{ c = [int]('0' + $m.Groups[1].Value); a = [int]('0' + $m.Groups[2].Value); e = [int]('0' + $m.Groups[3].Value); ms = $r.ms
    line = (([regex]::Matches($r.body, '<LINEERROR>([^<]*)</LINEERROR>') | Select-Object -First 2 | ForEach-Object { $_.Groups[1].Value }) -join ' | ') }
  Write-Host ("[db] {0}: created {1}, altered {2}, errors {3}, {4} ms{5}" -f $label, $k.c, $k.a, $k.e, $r.ms, $(if ($k.line) { "; Tally said: $($k.line)" } else { '' }))
  return $k
}
# Tally's own truth, asked without dates and without a time limit (the harness's, never a bridge request)
function TruthVouchers {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DBTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DBTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE, VOUCHERTYPENAME, MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 600
  return Entries $r.body
}
function TruthLedgers {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DBTruthL</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DBTruthL" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 600
  return @([regex]::Matches($r.body, '<GUID[^>]*>([^<]+)<') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique).Count
}
function DbMakeData {
  $null = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + (LE $co1) + '" ACTION="Alter"><NAME>' + (LE $co1) + '</NAME><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><ISBILLWISEON>Yes</ISBILLWISEON></COMPANY></TALLYMESSAGE>') 'company: cost centres, bill-wise'
  $dd = Join-Path $env:BRIDGE_DIST 'dbm'
  $mf = Join-Path $dd 'big-masters.xml'
  if (-not (Test-Path $mf)) { return "no test data in bridge-dist\dbm (the build did not write it)" }
  $mx = Get-Content $mf -Raw
  $msgs = [regex]::Match($mx, '(?s)<REQUESTDATA>(.*)</REQUESTDATA>').Groups[1].Value
  $mk = DbImp 'All Masters' $msgs 'ZZ BIG TEST masters'
  $vc = 0; $ve = 0
  foreach ($f in Get-ChildItem $dd -Filter 'dbm-vouchers-*.xml' | Sort-Object Name) { $k = DbImp 'Vouchers' (Get-Content $f.FullName -Raw) $f.Name; $vc += $k.c; $ve += $k.e }
  return "masters created $($mk.c) (errors $($mk.e)); entries created $vc (errors $ve)"
}
# ledgers up to $n (filler "DB Ledger nnnnn" under Sundry Creditors, 1,000 an import)
function DbLedgersTo([int]$n) {
  $have = TruthLedgers; $i = 0
  while ($have -lt $n) {
    $objs = ''
    for ($j = 0; $j -lt 1000 -and $have -lt $n; $j++) { $script:dbFill++; $have++; $nm = 'DB Ledger {0:d5}' -f $script:dbFill; $objs += '<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT></LEDGER></TALLYMESSAGE>' }
    $null = DbImp 'All Masters' $objs "filler ledgers to $n"
  }
  return TruthLedgers
}
$script:dbFill = 0
