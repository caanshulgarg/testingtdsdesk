# Mode g245 (bridge 2.4.5's gate; TEST DATA ONLY: a throwaway company in this runner's own Tally, never the owner's
# computer). The gate's setup (the committed FinComBridge-Setup-2.4.5.exe, from_source=no) as a person installs it, with
# stub245.py as FinCom's cloud (migration 98 and tally-ingest of next-245, modelled) and proxy235.py between the bridge and
# Tally (every request the bridge sends Tally logged with its time). Dot-sourced by flowv.ps1 twice:
#   $g5Phase = 'masters' (before the bridge is installed): ZZ BIG TEST (about 30,000 entries in FY 2026-27, 20,000 ledgers;
#     dbm/redate.py with DBM_PROFILE=big) made by XML, Tally's own truth taken (entries per day, ledgers); tally.ini written
#     as a client's may be (User TDL = Yes, another add-on of the client's own); nothing of FinCom's in it
#   $g5Phase = 'run' (after the setup ran):
#   g1 the installer added FinCom's add-on to tally.ini (add only, after the other TDL, backup = the file as it was, User
#      TDL not added again); Tally started again from that tally.ini loads FinCom's add-on AND the client's other TDL; the
#      beat reports "added"; the per-user first-start marker written
#   (ROUND 103: only Educational-allowed dates, the 1st, 2nd and 31st, are listed; the stand-in cloud has the
#    computer's switch on)
#   g2 the year counted day by day (FinComDayHeads, one day at a time, only days FinCom listed): every day's count exactly
#      Tally's own; the year above 20,000 vouchers (the half-years offered)
#   g3 the chosen part (Apr-Sep) fetched: FinCom ends holding every entry Tally lists for every day of it; only what
#      FinCom lacked asked (FinComVoucherObject once each); nothing asked for a day outside the part; no day to upload;
#      the progress line ends "N of N vouchers (100%)"
#   g4 no request over 2 s, one request at Tally at a time, Tally's window never blocked 2 s or more during the count and
#      the fetch (a probe of the window every 100 ms), Tally responding at the end
#   g5 postings first during the fetch: a posting from FinCom (/import) taken at once; no read of an older day reached
#      Tally after the posting's own request until the posting was done; the fetch went on after it
#   g6 the ledger count (Connect Tally step 5, the "ledgers" wake): FinComLedgerIds; the progress sent to FinCom never
#      going back and ending "N of N" with N Tally's own ledger count; every request under 2 s
#   g7 a tally.ini with User TDL = No: the setup run again leaves it byte for byte; the beat reports usertdl-no
#   g9 freeze safety: a day's list held at Tally (Tally suspended 5 s by proxy235.py) stops reading older entries of the
#      company: FinCom told (period_stop, over2s), nothing more asked, Tally answering after (ROUND 103, 1b)
#   (ROUND 103, the owner's decisions of 21-Oct-2026, evening) g3 is read at the NIGHT pace (the stand-in cloud answers
#   periodNight true and lists up to 30 days, as tally-ingest does outside the computer's office hours), with more of
#   Apr-Sep missing, and a payroll month in it (payg/'s payroll test masters, August 2026's payroll, salary payment and
#   TDS on salary, and a payroll of 500 employees on 31-Aug-2026):
#   g10 the night pace: more than 3 days an answer, the bridge reading day after day (an early beat when the listed days
#      are done); the entries a minute measured (MEASURE line); every rule of g4 kept
#   g11 the payroll month: the payroll's employees (FinComEmployees) sent before the first payroll entry; every payroll
#      voucher and the salary payment fetched (the 500-employee payroll's FinComVoucherObject within its 3 s, every other
#      request within 2 s); each payroll voucher sent with every employee's pay-head allocations, the salary payment with
#      the employees' names, no bank detail anywhere; the payroll vouchers counted like any other (the day's count = Tally's)
#   g8 job files under load: a posting job of 300 entries (POST /jobs) while the job is read without pause (GET /jobs?id=
#      and progress.json opened directly): never "no such job", never unreadable, the count never going back, done with
#      every entry
# A step the harness could not do is HARNESS, never PASS. Results: versions\results.txt; captures: stub-state.json,
# proxy.jsonl, the tally.ini files, the bridge log.
. (Join-Path $PSScriptRoot 'dblib.ps1')
$G1 = 'g1 the installer added the add-on to tally.ini; Tally loads it and the client''s other TDL at start'
$G2 = 'g2 the year counted day by day, every day exactly Tally''s count'
$G3 = 'g3 the chosen part fetched: FinCom holds every entry Tally lists, only what it lacked asked'
$G4 = 'g4 no request over 2 s, one at a time, Tally''s window never blocked 2 s, Tally responding'
$G5 = 'g5 postings first during the fetch'
$G6 = 'g6 the exact ledger count and its progress'
$G7 = 'g7 User TDL = No left untouched and reported'
$G8 = 'g8 job files read while written: nothing lost, never missing'
$G9 = 'g9 a day''s list held over 2 s stops reading older entries of the company (freeze safety)'
$G10 = 'g10 the night pace: day after day, more than 3 days an answer, entries a minute measured'

# 2.4.9: the entries an entry request asked: FinComVoucherObject's one MasterID; FinComVoucherBatch's list, or its range
# a..b read against that day's heads as FinCom's stub was told them (proxy235.py: mid "<day>:<a>..<b>" or "<day>:<m1>,...")
function EntryMidsOf($q, $gs) {
  if ($q.id -eq 'FinComVoucherObject') { return @("$($q.mid)") }
  if ($q.id -ne 'FinComVoucherBatch') { return @() }
  $p = "$($q.mid)".Split(':', 2); if ($p.Count -lt 2) { return @() }
  if ($p[1] -match '^(\d+)\.\.(\d+)$') {
    $a = [int64]$Matches[1]; $b = [int64]$Matches[2]
    return @(@((Prop (Prop $gs 'head_mids') $p[0])) | Where-Object { [int64]$_ -ge $a -and [int64]$_ -le $b } | ForEach-Object { "$_" })
  }
  return @($p[1].Split(',') | Where-Object { $_ })
}
$EntryIds = 'FinComVoucherObject', 'FinComVoucherBatch'
$G11 = 'g11 the payroll month in the period: employees first, payroll entries within 3 s, pay heads per employee, no bank detail'
$fcAddon = 'C:\ProgramData\FinCom\addon\FinComRecorder.tdl'
$otherTdl = 'C:\fcother\FinComOtherTest.tdl'
$iniPath = Join-Path $dir 'tally.ini'
$g5Ctl = Join-Path $out 'stub245-ctl.json'; $g5State = Join-Path $out 'stub-state.json'
function G5Ini { @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'Default Companies = Yes', "Load = $($folder.Name)") }
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
function Ents([string]$b) {
  $l = [Collections.Generic.List[object]]::new()
  foreach ($m in [regex]::Matches((NoInfo $b), '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $l.Add([pscustomobject]@{ date = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value; mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value })
  }
  return , $l.ToArray()
}
function TruthV {
  $r = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DBTruthV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DBTruthV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE, MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 900
  return (Ents $r.body)
}
function FormulaProbe([string]$name) {
  $x = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCIniProbe</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCIniProbe" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCPROBE:@@' + $name + '</COMPUTE></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $r = TStop $x 2000 20000; if ($r.hung) { DbClose }
  return [regex]::Match($r.body, '<FCPROBE[^>]*>([^<]*)<').Groups[1].Value
}
function G5Ctl($o) { [IO.File]::WriteAllText($g5Ctl, ($o | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false)) }

if ($g5Phase -eq 'masters') {
  Say '---- g245 masters (before the bridge): ZZ BIG TEST, Tally''s truth, tally.ini as a client''s'
  G5Ctl @{ company = $co1; phase = 'off' }
  $script:g5Made = DbMakeData
  $script:g5Led = DbLedgersTo 20000
  # ROUND 103 (B): a payroll month in the period chosen (TEST DATA: payg/, the 2.4.4 payroll test masters with 7 employees,
  # their bank details as a real master has them; August 2026's payroll, salary payment and TDS on salary), and a payroll
  # of 500 employees on 31-Aug-2026 (its entry request may take Tally up to 3 s)
  $pdir = Join-Path $PSScriptRoot 'payg'
  $pgS = Get-Content (Join-Path $pdir 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $mx = (Get-Content (Join-Path $pdir 'masters.xml') -Raw -Encoding UTF8).Replace('"' + (LE $pgS.company) + '"', '"' + (LE $co1) + '"').Replace('<NAME>' + (LE $pgS.company) + '</NAME>', '<NAME>' + (LE $co1) + '</NAME>')
  $pm = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $mx + '</TALLYMESSAGE>') 'payroll masters (payg)'
  $grp = "$($pgS.group)"; $cat = "$($pgS.category)"
  $eb = 0
  for ($b = 0; $b -lt 2; $b++) {
    $m = ''
    for ($j = 1; $j -le 250; $j++) { $n = $b * 250 + $j; $nm = 'PE Bulk {0:d4}' -f $n
      $m += '<COSTCENTRE NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>' + (LE $grp) + '</PARENT><CATEGORY>' + (LE $cat) + '</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20250401</DATEOFJOIN><DESIGNATION>Operator</DESIGNATION></COSTCENTRE>' }
    $k = DbImp 'All Masters' ('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $m + '</TALLYMESSAGE>') "500 employees, batch $($b + 1)"; $eb += $k.c
  }
  $vxRaw = Get-Content (Join-Path $pdir 'vouchers.xml') -Raw -Encoding UTF8
  $pv = @([regex]::Matches($vxRaw, '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | ForEach-Object { $_.Value } | Where-Object { $_ -match '<VOUCHERNUMBER>(PE-PAY-202608|PE-SAL-202608|PE-TDS-202607)</VOUCHERNUMBER>' })
  $pc = 0; foreach ($v in $pv) { $k = DbImp 'Vouchers' ('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $v + '</TALLYMESSAGE>') ([regex]::Match($v, '<VOUCHERNUMBER>([^<]*)<').Groups[1].Value); $pc += $k.c }
  $heads = @('PE Basic', 'PE HRA', 'PE Special Allowance', 'PE PF Employee', 'PE Professional Tax'); $earn = @($true, $true, $true, $false, $false)
  $ce = ''; $tot = 0.0
  for ($i = 1; $i -le 500; $i++) {
    $amts = @((30000 + $i), 12000, 8000, 1800, 200); $ea = 0.0; $pa = ''
    for ($q = 0; $q -lt 5; $q++) { $a = if ($earn[$q]) { - [double]$amts[$q] } else { [double]$amts[$q] }; $ea += $a
      $pa += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>' + $heads[$q] + '</PAYHEADNAME><ISDEEMEDPOSITIVE>' + $(if ($earn[$q]) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>' + ($q + 1) + '</PAYHEADSORTORDER><AMOUNT>' + ('{0:0.00}' -f $a) + '</AMOUNT></PAYHEADALLOCATIONS.LIST>' }
    $tot += $ea
    $ce += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + ('PE Bulk {0:d4}' -f $i) + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + $i + '</EMPLOYEESORTORDER><AMOUNT>' + ('{0:0.00}' -f $ea) + '</AMOUNT>' + $pa + '</EMPLOYEEENTRIES.LIST>'
  }
  $bx = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>20260831</DATE><EFFECTIVEDATE>20260831</EFFECTIVEDATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>PE-PAY-BULK500</VOUCHERNUMBER><PARTYLEDGERNAME>' + (LE $pgS.payable) + '</PARTYLEDGERNAME><PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW><ASPAYSLIP>Yes</ASPAYSLIP><VCHENTRYMODE>Payslip</VCHENTRYMODE><NARRATION>PE-PAY-BULK500 payroll of 500 employees (test data)</NARRATION>' +
    '<LEDGERENTRIES.LIST><LEDGERNAME>' + (LE $pgS.payable) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ('{0:0.00}' -f (- $tot)) + '</AMOUNT></LEDGERENTRIES.LIST><CATEGORYENTRY.LIST><CATEGORY>' + (LE $cat) + '</CATEGORY>' + $ce + '</CATEGORYENTRY.LIST></VOUCHER>'
  $k = DbImp 'Vouchers' ('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $bx + '</TALLYMESSAGE>') 'payroll of 500 employees'; $pc += $k.c
  $script:g5Pay = [pscustomobject]@{ masters = $pm.c; mastersErr = $pm.e; bulk = $eb; entries = $pc }
  Info ("g245: the payroll month: masters created {0} (errors {1}), 500 employees created {2}, entries created {3} of 4 (PE-PAY-202608 01-Aug, PE-SAL-202608 02-Aug, PE-TDS-202607 02-Aug, PE-PAY-BULK500 31-Aug)" -f $pm.c, $pm.e, $eb, $pc)
  $tv = @(TruthV | Where-Object { $_.date })
  $script:g5Truth = @{}; foreach ($g in ($tv | Group-Object date)) { $script:g5Truth[$g.Name] = $g.Count }
  $script:g5TruthMid = @{}; foreach ($e in $tv) { $script:g5TruthMid[$e.mid] = $e.date }
  Info ("g245: {0}; ledgers {1}; entries in Tally {2} on {3} days" -f $script:g5Made, $script:g5Led, $tv.Count, $script:g5Truth.Count)
  New-Item -ItemType Directory -Force (Split-Path $otherTdl) | Out-Null
  Set-Content $otherTdl @('; a harmless TDL standing for a client''s own add-on (harness only)', '[System: Formula]', '    FCOtherMark : "other-loaded"') -Encoding ASCII
  $script:g5IniA = (G5Ini) + @('User TDL = Yes', "TDL = $otherTdl")
  Remove-Item "$iniPath.fincom-bak" -Force -ErrorAction SilentlyContinue
  Set-Content -Path $iniPath -Value $script:g5IniA -Encoding ASCII
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-A-before-setup.txt') -Force
  return
}

# ---------------------------------------------------------------- run
Say '---- g245: the gate'
$gDone = @{}
function GRes($c, $s, $ev) { if (-not $gDone[$c]) { Result $c $s $ev; $gDone[$c] = $true } }
function GState { try { return (Get-Content $g5State -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null } }
function GProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function GLog { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Nf($n) { ([int64]$n).ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('en-IN')) }
function Prop($o, [string]$k) { if ($null -eq $o) { return $null }; $p = $o.PSObject.Properties[$k]; if ($p) { return $p.Value }; return $null }
# Tally started again from tally.ini as it is (the harness does not write it), by its own process id; the proxy after it
function G5Restart([string]$tag) {
  Stop-S235Proxy; DbClose; DbStartNoWait
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; if (DbPortOpen) { break } }
  Start-Sleep 5; DbStartKeys $tag
  $up = $false; for ($i = 0; $i -lt 20; $i++) { if (DbCompanyUp) { $up = $true; break }; Start-Sleep 3 }
  $ok = Start-S235Proxy
  Say "g245: Tally started again ($tag): pid $($script:tpid), company up $up, proxy $ok"
  return ($up -and $ok)
}
# ---- the window probe (dbbigv.ps1's): the longest time Tally's window did not answer WM_NULL within 250 ms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class G5Frz { [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res); }
'@
$script:frz = [hashtable]::Synchronized(@{ on = $false; stop = $false; h = [IntPtr]::Zero; max = 0.0; maxAt = ''; beats = 0; err = ''; over = 0; spells = [Collections.ArrayList]::Synchronized([Collections.ArrayList]::new()) })
$script:frzOk = $false
try {
  $script:frzJob = Start-ThreadJob -ArgumentList $script:frz -ScriptBlock {
    param($f)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $since = $null
    while (-not $f.stop) {
      if ($f.on -and $f.h -ne [IntPtr]::Zero) {
        $t0 = $sw.Elapsed.TotalMilliseconds; $r = [IntPtr]::Zero
        try { $ok = [G5Frz]::SendMessageTimeout($f.h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 250, [ref]$r) } catch { $f.err = "$_"; $ok = [IntPtr]1 }
        if ($ok -eq [IntPtr]::Zero) { if ($null -eq $since) { $since = $t0 }; $cur = $sw.Elapsed.TotalMilliseconds - $since; if ($cur -gt $f.max) { $f.max = $cur; $f.maxAt = (Get-Date).ToString('HH:mm:ss') } }
        else { if ($null -ne $since) { $dur = $sw.Elapsed.TotalMilliseconds - $since; if ($dur -ge 2000) { $f.over++ }; if ($dur -ge 1500) { $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $null = $f.spells.Add(@(($now - [int64]$dur), $now)) } }; $since = $null }
      } else { $since = $null }
      $f.beats++
      Start-Sleep -Milliseconds 100
    }
  }
  Start-Sleep 2; $script:frzOk = ($script:frz.beats -gt 0)
} catch { Info "g245: the window probe could not start ($_)" }
function FrzOn { $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $script:frz.h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }; $script:frz.on = $true }

try {
  # ---- the bridge's start: its version, the starting point recorded (reading is prospective only)
  $t = Get-Date; $sp = $false
  while (((Get-Date) - $t).TotalMinutes -lt 6) { if (@((GLog) | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { $sp = $true; break }; Start-Sleep 5 }
  Info "g245: the bridge $($st.version) recorded the company's starting point: $sp"

  # ================================================================ g1 tally.ini (the installer)
  $after = @(Get-Content $iniPath); Copy-Item $iniPath (Join-Path $cap 'tally-ini-A-after-setup.txt') -Force
  $bak = "$iniPath.fincom-bak"; $bakSame = (Test-Path $bak) -and ((Get-Content $bak) -join "`n") -eq ($script:g5IniA -join "`n")
  $j = 0; foreach ($l in $after) { if ($j -lt $script:g5IniA.Count -and $l -eq $script:g5IniA[$j]) { $j++ } }; $kept = ($j -eq $script:g5IniA.Count)
  $added = @($after | Select-Object -Skip 0 | Where-Object { $_ -notin $script:g5IniA })
  $addOk = ($added.Count -eq 1 -and $added[0] -eq "TDL = $fcAddon")
  $iOther = [array]::IndexOf($after, "TDL = $otherTdl"); $iMine = [array]::IndexOf($after, "TDL = $fcAddon")
  $userN = @($after | Where-Object { $_ -match '^\s*User\s+TDL\s*=' }).Count
  $exeDir = ''; try { $bp = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -match 'FinCom' -and $_.Name -match '\.exe$' } | Select-Object -First 1; if ($bp) { $exeDir = Split-Path $bp.ExecutablePath } } catch {}
  $marker = if ($exeDir) { Get-Content (Join-Path $exeDir 'fincom-tallyini-version.txt') -ErrorAction SilentlyContinue } else { '' }
  $up = G5Restart 'ini-A'
  $mine = FormulaProbe 'FCRFolder'; $oth = FormulaProbe 'FCOtherMark'
  $afterTally = @(Get-Content $iniPath); $untouched = (($afterTally -join "`n") -eq ($after -join "`n"))
  Start-Sleep 20
  $gs = GState; $ini = @((Prop $gs 'tallyIni')); $iniMe = @($ini | Where-Object { "$($_.path)" -ieq $iniPath }) | Select-Object -First 1
  $blIni = @((GLog) | Where-Object { $_ -match 'tally\.ini' } | Select-Object -Last 3)
  GRes $G1 $(if (-not $up) { 'HARNESS' } elseif ($addOk -and $kept -and $bakSame -and $iMine -gt $iOther -and $userN -eq 1 -and $mine -eq 'C:\ProgramData\FinCom\recorder\' -and $oth -eq 'other-loaded' -and $untouched -and $iniMe -and "$($iniMe.state)" -in 'added', 'already') { 'PASS' } else { 'FAIL' }) ("added by the setup: [{0}]; the lines before kept in order {1}; after the client's TDL line {2}; User TDL lines {3}; backup = the file as it was {4}; Tally started again: FinCom's add-on formula '{5}', the client's TDL formula '{6}'; Tally left the file as it was {7}; the beat: {8}; the per-user marker '{9}' in '{10}'; the log: {11}" -f ($added -join ' | '), $kept, ($iMine -gt $iOther), $userN, $bakSame, $mine, $oth, $untouched, $(if ($iniMe) { "$($iniMe.path) $($iniMe.state)" } else { "no entry for $iniPath ($(($ini | ForEach-Object { "$($_.path) $($_.state)" }) -join '; '))" }), "$marker", $exeDir, ($blIni -join ' | '))

  # ================================================================ g2 the year counted
  $today = (Get-Date).ToString('yyyyMMdd')
  $days = @(); $d = [DateTime]::ParseExact('20260401', 'yyyyMMdd', $null)
  # ROUND 103 (2): only the dates Educational TallyPrime takes (the 1st, 2nd and 31st: run 39563247775 showed every other
  # date answered in 2-15 s, the date not applied); the stand-in cloud lists only those
  while ($d.ToString('yyyyMMdd') -le $today -and $d.ToString('yyyyMMdd') -le '20270331') { if ($d.Day -in 1, 2, 31) { $days += $d.ToString('yyyyMMdd') }; $d = $d.AddDays(1) }
  [array]::Reverse($days)
  Say "g245: counting FY 2026-27, $($days.Count) days (newest first)"
  Start-Sleep 70   # the person's 60 s (the keys of the restart) go by first
  FrzOn; $tCount = NowMs
  G5Ctl @{ company = $co1; phase = 'count'; count_days = $days }
  $t = Get-Date; $gs = $null
  while (((Get-Date) - $t).TotalMinutes -lt 75) {
    Start-Sleep 20; $gs = GState
    $c = Prop $gs 'counted'; $n = if ($c) { @($c.PSObject.Properties).Count } else { 0 }
    Write-Host "[g245] counted $n of $($days.Count) days"
    if ($n -ge $days.Count) { break }
    if ($n -eq 0 -and ((Get-Date) - $t).TotalMinutes -gt 10) { break }
  }
  $tCountEnd = NowMs
  $c = Prop $gs 'counted'
  $bad = @(); $sum = 0; $tsum = 0
  foreach ($dd in $days) { $got = Prop $c $dd; $want = [int]$script:g5Truth[$dd]; $tsum += $want; if ($null -eq $got) { $bad += "$dd not counted" } else { $sum += [int]$got; if ([int]$got -ne $want) { $bad += "$dd $got (Tally $want)" } } }
  $half = $sum -gt 20000
  $waits = @((GLog) | Where-Object { $_ -match 'Older entries of .* waits' } | Select-Object -Last 3)
  GRes $G2 $(if (-not $c) { 'FAIL' } elseif (-not $bad.Count -and $half) { 'PASS' } else { 'FAIL' }) ("{0} days counted in {1} min, {2} vouchers in all (Tally's own {3}); not as Tally: {4}; above 20,000 (the half-years offered): {5}; the bridge's waits: {6}" -f $(if ($c) { @($c.PSObject.Properties).Count } else { 0 }), [math]::Round(($tCountEnd - $tCount) / 60000, 1), (Nf $sum), (Nf $tsum), $(if ($bad.Count) { ($bad | Select-Object -First 8) -join '; ' } else { 'none' }), $half, ($waits -join ' | '))

  # ================================================================ g3 the part chosen (Apr-Sep), with g5 during it
  $part = @($days | Where-Object { $_ -le '20260930' }); [array]::Reverse($part)
  # ROUND 103: the payroll month's days (01-Aug, 02-Aug, 31-Aug) and the heavy 01-Aug among the days FinCom lacks; read
  # at the night pace (g10)
  $missing = @('20260601', '20260702', '20260731', '20260801', '20260802', '20260831') | Where-Object { $_ -in $part }
  $wantTotal = 0; foreach ($m in $missing) { $wantTotal += [int]$script:g5Truth[$m] }
  Say "g245: fetching Apr-Sep ($($part.Count) days); FinCom lacks $($missing -join ', ') ($wantTotal entries)"
  $tFetch = NowMs
  $b0 = [int](Prop (GState) 'beats')
  G5Ctl @{ company = $co1; phase = 'fetch'; count_days = $days; part_days = $part; missing = $missing; night = $true }
  $posted = $false; $imp = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt 90) {
    Start-Sleep 10; $gs = GState
    if (-not $gs) { continue }
    $done = @((Prop $gs 'done')); $left = @($part | Where-Object { $_ -notin $done -and $_ -notin @((Prop $gs 'upload').PSObject.Properties.Name) })
    $px = GProxy; $objNow = 0; foreach ($q in @($px | Where-Object { $_.id -in $EntryIds -and [int64]$_.t0 -ge $tFetch })) { $objNow += @(EntryMidsOf $q $gs).Count }
    Write-Host "[g245] fetch: $($part.Count - $left.Count) of $($part.Count) days done; entries asked $objNow (FinComVoucherObject and FinComVoucherBatch)"
    # g5: a posting from FinCom while the fetch is going (entries being asked)
    if (-not $posted -and $objNow -ge 50) {
      $posted = $true
      $vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g245 posting during the fetch</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-25.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>25.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
      $iS = NowMs
      $ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "g245-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"; xml = $vx }) } 120
      $iE = NowMs
      $imp = [pscustomobject]@{ s = $iS; e = $iE; ok = ($ir -and @($ir.results)[0].ok -eq $true); ans = ($ir | ConvertTo-Json -Depth 6 -Compress) }
      Info "g245: the posting during the fetch: $($iE - $iS) ms, ok $($imp.ok)"
    }
    if (-not $left.Count) { break }
  }
  $tFetchEnd = NowMs
  Start-Sleep 5
  $script:frz.on = $false
  $gs = GState; $gs | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $cap 'stub-state-after-fetch.json') -Encoding UTF8
  $counted = Prop $gs 'counted'; $held = Prop $gs 'held'; $up5 = @((Prop $gs 'upload').PSObject.Properties | ForEach-Object { "$($_.Name): $($_.Value.words)" })
  $notHeld = @(foreach ($dd in $part) { $h = [int](Prop $held $dd); $n = [int](Prop $counted $dd); $tw = [int]$script:g5Truth[$dd]; if ($h -lt $n -or $n -ne $tw) { "$dd held $h of $n (Tally $tw)" } })
  $y = 0; $x = 0; foreach ($dd in $part) { $y += [int](Prop $counted $dd); $x += [math]::Min([int](Prop $held $dd), [int](Prop $counted $dd)) }
  $pct = if ($y) { [math]::Round($x * 100 / $y) } else { 0 }; if ($x -lt $y -and $pct -ge 100) { $pct = 99 }
  $words = "{0} of {1} vouchers ({2}%) · {3}" -f (Nf $x), (Nf $y), $pct, $(if ($y - $x) { "$(Nf ($y - $x)) left" } else { 'all in FinCom' })
  $px = GProxy
  $pxF = @($px | Where-Object { [int64]$_.t0 -ge $tFetch -and [int64]$_.t0 -le $tFetchEnd })
  $objMids = @(foreach ($q in @($pxF | Where-Object { $_.id -in $EntryIds })) { EntryMidsOf $q $gs })
  # ROUND 104 (g3): every MasterID FinCom wanted, over all its answers (a day of more than 2,000 is wanted over two:
  # tally_period_held's limit); 'want' keeps only each day's last answer
  $wantAll = @(); $wantMap = Prop $gs 'want_all'; if (-not $wantMap) { $wantMap = Prop $gs 'want' }; foreach ($p in @($wantMap.PSObject.Properties)) { $wantAll += @($p.Value | ForEach-Object { "$_" }) }
  # ROUND 104 (g3, run 39647340380 on 3.0): an entry whose read was cut so FinCom's posting went first ("a background read
  # was stopped at once so FinCom's request goes first; it resumes afterwards") is asked again by design: a second ask of
  # a MasterID whose earlier ask was within 5 s of the posting is not counted as asked twice (it is said in the evidence)
  $objReqs = @(foreach ($q in @($pxF | Where-Object { $_.id -in $EntryIds })) { foreach ($m in @(EntryMidsOf $q $gs)) { [pscustomobject]@{ id = $q.id; mid = $m; t0 = $q.t0; t1 = $q.t1 } } })
  $script:objCutN = 0
  $objTwice = @($objReqs | Group-Object mid | Where-Object { $_.Count -gt 1 } | Where-Object {
      $g = @($_.Group | Sort-Object { [int64]$_.t0 }); $early = @($g | Select-Object -First ($g.Count - 1))
      $cut = $imp -and @($early | Where-Object { [int64]$_.t0 -ge ($imp.s - 5000) -and [int64]$_.t0 -le ($imp.e + 5000) }).Count -gt 0 -and $g.Count -eq 2
      if ($cut) { $script:objCutN++ }; -not $cut }).Count
  $objCut = [int]$script:objCutN
  $objNotWanted = @($objMids | Where-Object { $_ -notin $wantAll }).Count
  $missOk = @($missing | Where-Object { [int](Prop (Prop $gs 'entries_sent') $_) -ge [int]$script:g5Truth[$_] }).Count -eq $missing.Count
  $listed = @((Prop $gs 'period_days_listed') | Where-Object { $_[2] -eq $true } | ForEach-Object { @($_[1]) })
  $outside = @($listed | Where-Object { $_ -notin $part } | Sort-Object -Unique)
  $badDates = @((Prop $gs 'bad_dates')).Count
  GRes $G3 $(if (-not $gs) { 'HARNESS' } elseif (-not $notHeld.Count -and $x -eq $y -and $missOk -and -not $up5.Count -and $objTwice -eq 0 -and $objNotWanted -eq 0 -and -not $outside.Count -and $badDates -eq 0 -and $objMids.Count -ge $wantTotal) { 'PASS' } else { 'FAIL' }) ("Apr-Sep, {0} days, in {1} min: the progress line ends '{2}'; days not held in full or not as Tally: {3}; FinCom lacked {4} entries on {5}: all sent {6}; FinComVoucherObject asked {7} times ({8} wanted by FinCom; asked twice {9}, asked again after a cut for the posting {14}; not wanted {10}); days listed for the fetch outside the part {11}; entries with another date {12}; days to upload: {13}" -f $part.Count, [math]::Round(($tFetchEnd - $tFetch) / 60000, 1), $words, $(if ($notHeld.Count) { ($notHeld | Select-Object -First 6) -join '; ' } else { 'none' }), $wantTotal, ($missing -join ', '), $missOk, $objMids.Count, $wantAll.Count, $objTwice, $objNotWanted, $(if ($outside.Count) { $outside -join ',' } else { 'none' }), $badDates, $(if ($up5.Count) { $up5 -join ' | ' } else { 'none' }), $objCut)

  # ================================================================ g4 the 2 s rule, one at a time, no freeze
  $pxC = @($px | Where-Object { [int64]$_.t0 -ge $tCount -and [int64]$_.t0 -le $tFetchEnd -and $_.method -eq 'POST' } | Sort-Object { [int64]$_.t0 })
  # ROUND 103 (B): a payroll voucher's entry request may take 3 s (the owner's decision of 12-Oct-2026); every other 2 s
  $payMids = @((Prop $gs 'payroll_mids') | ForEach-Object { "$_" })
  $isPay = { param($q) $q.id -eq 'FinComVoucherObject' -and "$($q.mid)" -in $payMids }
  $over = @($pxC | Where-Object { [int]$_.ms -gt $(if (& $isPay $_) { 3000 } else { 2000 }) })
  $payReqs = @($pxC | Where-Object { & $isPay $_ })
  # a window spell of 2 s or more is allowed only while a payroll entry was at Tally, and under 3 s
  $spBad = @(@($script:frz.spells) | Where-Object { ($_[1] - $_[0]) -ge 2000 -and [int64]$_[0] -ge $tCount -and [int64]$_[0] -le $tFetchEnd } | Where-Object { $sp = $_; ($sp[1] - $sp[0]) -ge 3000 -or -not @($payReqs | Where-Object { [int64]$sp[0] -ge ([int64]$_.t0 - 300) -and [int64]$sp[1] -le ([int64]$_.t1 + 300) }).Count })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $pxC) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  $byId = ($pxC | Group-Object id | ForEach-Object { $w = ($_.Group | Measure-Object -Property ms -Maximum).Maximum; "$($_.Name) $($_.Count) (worst $w ms)" }) -join ', '
  $stops = @((GLog) | Where-Object { $_ -match 'longer than 2 s|stopped waiting \(2 s\)|over 2 s' } | Select-Object -Last 3)
  $resp = DbResponding
  $blocked = if ($script:frzOk) { [math]::Round($script:frz.max) } else { -1 }
  GRes $G4 $(if (-not $pxC.Count -or -not $script:frzOk) { 'HARNESS' } elseif (-not $over.Count -and $overlap -eq 0 -and -not $spBad.Count -and $blocked -lt 3000 -and $resp) { 'PASS' } else { 'FAIL' }) ("{0} requests at Tally during the count and the fetch ({1}); over 2 s (a payroll entry over 3 s): {2}; payroll entries {3} (worst {4} ms); started while another was at Tally: {5}; Tally's window longest not answering {6} ms (at {7}; spells of 2 s or more: {8}, outside a payroll entry or 3 s or more: {9}); Tally responding at the end {10}; the bridge's stops: {11}" -f $pxC.Count, $byId, $(if ($over.Count) { ($over | Select-Object -First 5 | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join ', ' } else { 'none' }), $payReqs.Count, (($payReqs | Measure-Object -Property ms -Maximum).Maximum), $overlap, $blocked, $script:frz.maxAt, $script:frz.over, $spBad.Count, $resp, $(if ($stops.Count) { $stops -join ' | ' } else { 'none' }))

  # ================================================================ g10 the night pace (ROUND 103, the owner's decision of 21-Oct-2026, evening)
  $el = @((Prop $gs 'entries_log') | Where-Object { [double]$_[0] * 1000 -ge $tFetch -and [double]$_[0] * 1000 -le $tFetchEnd })
  $nEnt = ($el | ForEach-Object { [int]$_[1] } | Measure-Object -Sum).Sum
  $objF = @($pxF | Where-Object { $_.id -in $EntryIds } | Sort-Object { [int64]$_.t0 })
  $spanMin = if ($objF.Count -ge 2) { ([int64]$objF[-1].t1 - [int64]$objF[0].t0) / 60000.0 } else { 0 }
  $perMin = if ($spanMin -gt 0) { [math]::Round($nEnt / $spanMin) } else { 0 }
  $maxL = [int](Prop $gs 'max_listed'); $nb = [int](Prop $gs 'night_beats'); $beatsF = [int](Prop $gs 'beats') - $b0
  $fetchMin = [math]::Round(($tFetchEnd - $tFetch) / 60000.0, 1)
  $eta200k = if ($perMin -gt 0) { [math]::Round(200000 / $perMin / 60.0, 1) } else { -1 }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ('MEASURE g10 night pace: ' + ("{0} entries sent in {1} min of entry requests ({2} entries a minute; 2,00,000 entries would take about {3} h at this pace); requests at Tally in the fetch: {4}" -f (Nf $nEnt), [math]::Round($spanMin, 1), (Nf $perMin), $eta200k, ($pxF.Count)))
  # ROUND 104: the owner's choice (a) of 22-Oct-2026 (the company list once a day, a lighter night step; no new request):
  # about 2-3 times the 165 entries a minute of run 39647340380, so at least 330; the faster form (b) waits for 2.4.6
  GRes $G10 $(if (-not $gs -or -not $objF.Count) { 'HARNESS' } elseif ($maxL -gt 3 -and $nb -gt 0 -and $perMin -ge 330 -and -not $over.Count -and $overlap -eq 0 -and -not $spBad.Count) { 'PASS' } else { 'FAIL' }) ("periodNight answered {0} time(s); at most {1} days in one answer; {2} beats in {3} min of fetch; {4} entries a minute ({5} entries over {6} min); the rules of g4 kept: over the limit {7}, overlapping {8}, window spells not allowed {9}" -f $nb, $maxL, $beatsF, $fetchMin, (Nf $perMin), (Nf $nEnt), [math]::Round($spanMin, 1), $over.Count, $overlap, $spBad.Count)

  # ================================================================ g11 the payroll month (ROUND 103, B)
  $pay = @((Prop $gs 'payroll')); $sal = @((Prop $gs 'salpay')); $emps = @((Prop $gs 'employees'))
  $firstPay = @($payReqs | Sort-Object { [int64]$_.t0 }) | Select-Object -First 1
  $empFirst = if ($firstPay -and $emps.Count) { ([double]$emps[0].at * 1000) -lt [int64]$firstPay.t0 } else { $false }
  # ROUND 104 (g11): Tally numbers the payroll vouchers itself (the XML's PE-PAY-... numbers are not kept: run 39647340380
  # sent them as 1 and 2), so each is known by its day: 31-Aug-2026 the payroll of 500, 01-Aug-2026 August's of 7
  $bulk = @($pay | Where-Object { "$($_.day)" -eq '20260831' } | Sort-Object { [int]$_.employees } -Descending) | Select-Object -First 1
  $aug = @($pay | Where-Object { "$($_.day)" -eq '20260801' }) | Select-Object -First 1
  $bankAny = @($pay + $sal | Where-Object { @($_.bank).Count -gt 0 })
  $cnt = Prop $gs 'counted'
  $dayOk = @('20260801', '20260802', '20260831' | Where-Object { [int](Prop $cnt $_) -ne [int]$script:g5Truth[$_] })
  $payWorst = ($payReqs | Measure-Object -Property ms -Maximum).Maximum
  $stopsPay = @((Prop $gs 'stops'))
  GRes $G11 $(if (-not $script:g5Pay -or $script:g5Pay.entries -ne 4 -or $script:g5Pay.bulk -ne 500) { 'HARNESS' } elseif ($empFirst -and $bulk -and [int]$bulk.employees -ge 500 -and $aug -and [int]$aug.employees -ge 5 -and $sal.Count -ge 1 -and [int]$sal[0].employees -ge 5 -and -not $bankAny.Count -and -not $dayOk.Count -and $payReqs.Count -ge 2 -and $payWorst -le 3000 -and -not $stopsPay.Count) { 'PASS' } else { 'FAIL' }) ("the payroll's employees sent {0} time(s) ({1} rows), before the first payroll entry {2}; payroll vouchers sent: {3}; the salary payment: {4}; bank details sent: {5}; payroll entry requests {6} (worst {7} ms, limit 3,000); the payroll days' counts as Tally's: {8}; period stops {9}" -f $emps.Count, $(if ($emps.Count) { $emps[-1].n } else { 0 }), $empFirst, (($pay | ForEach-Object { "$($_.no) on $($_.day): $($_.employees) employees, $($_.alloc) allocations" }) -join '; '), (($sal | ForEach-Object { "$($_.no): $($_.employees) employees" }) -join '; '), $(if ($bankAny.Count) { ($bankAny | ForEach-Object { "$($_.no) $(@($_.bank) -join ',')" }) -join '; ' } else { 'none' }), $payReqs.Count, $payWorst, $(if ($dayOk.Count) { "no: $($dayOk -join ', ')" } else { 'yes' }), $stopsPay.Count)

  # ================================================================ g5 postings first
  if (-not $imp) { GRes $G5 'HARNESS' 'the fetch never reached 50 entries asked: no posting made during it' }
  else {
    $impReq = @($px | Where-Object { $_.id -eq 'Import' -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -le $imp.e }) | Select-Object -First 1
    $pullIds = 'FinComDayHeads', 'FinComVoucherObject', 'FinComVoucherBatch'
    $inside = if ($impReq) { @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -gt [int64]$impReq.t0 -and [int64]$_.t0 -lt $imp.e }).Count } else { -1 }
    $before = if ($impReq) { @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -lt [int64]$impReq.t0 }).Count } else { -1 }
    $afterN = @($px | Where-Object { $_.id -in $pullIds -and [int64]$_.t0 -ge $imp.e }).Count
    $wait = if ($impReq) { [int64]$impReq.t0 - $imp.s } else { -1 }
    GRes $G5 $(if (-not $impReq) { 'FAIL' } elseif ($imp.ok -and $inside -eq 0 -and $before -le 1 -and $wait -lt 2500 -and $afterN -gt 0 -and ($imp.e - $imp.s) -lt 15000) { 'PASS' } else { 'FAIL' }) ("the posting: {0} ms in all, ok {1}; its request reached Tally {2} ms after FinCom asked (older-day reads started before it in that time: {3}); older-day reads started after it until the posting was done: {4}; the fetch went on after it ({5} more reads); the answer {6}" -f ($imp.e - $imp.s), $imp.ok, $wait, $before, $inside, $afterN, $imp.ans.Substring(0, [math]::Min(300, $imp.ans.Length)))
  }

  # ================================================================ g6 the ledger count
  # ROUND 103 (2): the company kept in step first (Update now, as a person presses it), so the "ledgers" wake reads
  $nLed = TruthLedgers
  $mK = Mark
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $t = Get-Date; while (((Get-Date) - $t).TotalMinutes -lt 15) { Start-Sleep 10; if (@((StubReqs) | Select-Object -Skip $mK | Where-Object { $_.kind -in 'ledger_list', 'ledgers' }).Count) { break } }
  # ROUND 104 (g6): the bridge reads a company's ledger list at most once every LedgersDebounceMin (3 minutes): the wake
  # sent 30 s after Update now's own read was too soon (run 39647340380), so it waits the 3 minutes out
  Start-Sleep 200
  $tL = NowMs
  G5Ctl @{ company = $co1; phase = 'off'; ledgers_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
  $t = Get-Date; $lp = @()
  while (((Get-Date) - $t).TotalMinutes -lt 20) { Start-Sleep 15; $gs = GState; $lp = @((Prop $gs 'ledger_progress')); if (@($lp | Where-Object { $_.done -eq $true }).Count) { break } }
  G5Ctl @{ company = $co1; phase = 'off' }
  $px = GProxy; $pxL = @($px | Where-Object { [int64]$_.t0 -ge $tL })
  $ids = @($pxL | Where-Object { $_.id -eq 'FinComLedgerIds' }); $ledReq = @($pxL | Where-Object { $_.id -eq 'FinComLedgers' })
  $last = $lp | Select-Object -Last 1
  $back = 0; $prev = 0; foreach ($p in $lp) { if ([int]$p.read -lt $prev) { $back++ }; $prev = [int]$p.read }
  $ofSame = @($lp | Where-Object { [int]$_.of -ne $nLed }).Count
  $worstL = (@($pxL | Where-Object { $_.id -in 'FinComLedgerIds', 'FinComLedgers' }) | Measure-Object -Property ms -Maximum).Maximum
  GRes $G6 $(if (-not $lp.Count) { 'FAIL' } elseif ($last.done -eq $true -and [int]$last.read -eq $nLed -and [int]$last.of -eq $nLed -and $back -eq 0 -and $ofSame -eq 0 -and $ids.Count -ge 1 -and $worstL -le 2000) { 'PASS' } else { 'FAIL' }) ("Tally's ledgers {0}; FinComLedgerIds asked {1} time(s) ({2} ms), FinComLedgers {3} chunk(s), worst {4} ms; progress sent {5} time(s): {6}; the last '{7} of {8} ledgers' done {9}; going back {10}; 'of' not Tally's count {11}" -f (Nf $nLed), $ids.Count, (($ids | ForEach-Object { $_.ms }) -join '/'), $ledReq.Count, $worstL, $lp.Count, (($lp | Select-Object -First 6 | ForEach-Object { "$($_.read)/$($_.of)" }) -join ', '), (Nf $last.read), (Nf $last.of), $last.done, $back, $ofSame)

  # ================================================================ g7 User TDL = No put in after the first start: the bridge
  # restarted (no setup) looks at tally.ini again, read only, and reports it (ROUND 103, 1a)
  $iniC = (G5Ini) + @('User TDL = No', "TDL = $otherTdl")
  Set-Content -Path $iniPath -Value $iniC -Encoding ASCII
  $hC = (Get-FileHash $iniPath).Hash; $hBak = (Get-FileHash $bak -ErrorAction SilentlyContinue).Hash
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-C-before-restart.txt') -Force
  $m0 = (GLog).Count
  $rr = Bridge POST '/tray/restart' @{} 20
  $p = [pscustomobject]@{ ExitCode = $(if ($rr -and $rr.ok) { 0 } else { 1 }) }
  Start-Sleep 20
  $cfg2 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg2.Port; $bkey = "$($cfg2.Key)"
  $st2 = $null; for ($i = 0; $i -lt 30 -and -not $st2; $i++) { $st2 = Bridge GET '/status' $null 10; if (-not $st2) { Start-Sleep 3 } }
  $t = Get-Date; $iniMe = $null
  while (((Get-Date) - $t).TotalMinutes -lt 4) { Start-Sleep 10; $gs = GState; $iniMe = @(@((Prop $gs 'tallyIni')) | Where-Object { "$($_.path)" -ieq $iniPath -and "$($_.state)" -eq 'usertdl-no' }) | Select-Object -First 1; if ($iniMe) { break } }
  $hC2 = (Get-FileHash $iniPath).Hash; $hBak2 = (Get-FileHash $bak -ErrorAction SilentlyContinue).Hash
  Copy-Item $iniPath (Join-Path $cap 'tally-ini-C-after-restart.txt') -Force
  $lC = @((GLog) | Select-Object -Skip $m0 | Where-Object { $_ -match 'User TDL = No|usertdl-no|looked at again' } | Select-Object -Last 2)
  GRes $G7 $(if ($p.ExitCode -ne 0 -or -not $st2) { 'HARNESS' } elseif ($hC -eq $hC2 -and $hBak -eq $hBak2 -and $iniMe) { 'PASS' } else { 'FAIL' }) ("the bridge restarted from the tray's address (asked {0}, the bridge {1}); tally.ini byte for byte the same {2}; the backup untouched {3}; the beat: {4}; the log: {5}" -f $p.ExitCode, $(if ($st2) { $st2.version } else { 'not answering' }), ($hC -eq $hC2), ($hBak -eq $hBak2), $(if ($iniMe) { "$($iniMe.state): $($iniMe.why)" } else { 'no usertdl-no entry' }), ($lC -join ' | '))
  Set-Content -Path $iniPath -Value $script:g5IniA -Encoding ASCII   # back as it was (the client's own)

  # ================================================================ g9 freeze safety (ROUND 103, 1b): the next day's list held
  # at Tally (proxy235.py suspends Tally for 5 s at the first FinComDayHeads), the bridge stops at 2 s and stops reading
  # older entries of the company; FinCom told; nothing more asked; Tally answering after
  $chosen = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $oct = @($days | Where-Object { $_ -ge '20261001' -and $_ -le '20261031' }); [array]::Reverse($oct)
  [IO.File]::WriteAllText($proxyCtl, (@{ suspendOn = '^FinComDayHeads$'; pid = $script:tpid; sec = 5 } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $t9 = NowMs
  G5Ctl @{ company = $co1; phase = 'fetch'; count_days = $days; part_days = $oct; missing = @($oct | Select-Object -First 1); chosen_at = $chosen }
  $t = Get-Date; $stops = @()
  while (((Get-Date) - $t).TotalMinutes -lt 8) { Start-Sleep 10; $gs = GState; $stops = @((Prop $gs 'stops')); if ($stops.Count) { break } }
  Start-Sleep 90
  G5Ctl @{ company = $co1; phase = 'off' }
  $px = GProxy
  # ROUND 104 (g9): the proxy's suspend line has no t0 (GProxy keeps request lines only): read from the whole log
  $pxEv = if (Test-Path $proxyLog) { @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.event }) } else { @() }
  $sus = @($pxEv | Where-Object { $_.event -eq 'suspend' -and [int64]$_.t -ge $t9 })
  $heads9 = @($px | Where-Object { $_.id -in 'FinComDayHeads', 'FinComVoucherObject', 'FinComVoucherBatch' -and [int64]$_.t0 -ge $t9 })
  $after = @($heads9 | Select-Object -Skip 1)
  $resp9 = DbResponding
  $st9 = (GState).periodPull
  GRes $G9 $(if (-not $sus.Count) { 'HARNESS' } elseif ($stops.Count -eq 1 -and "$($stops[0].why)" -eq 'over2s' -and -not $after.Count -and $resp9) { 'PASS' } else { 'FAIL' }) ("Tally suspended 5 s at the first day's list ({0}); FinCom told: {1}; requests for older days after the stop: {2}; Tally responding after {3}" -f $sus.Count, $(if ($stops.Count) { ($stops | ForEach-Object { "$($_.day) $($_.why): $($_.words)" }) -join ' | ' } else { 'nothing' }), $(if ($after.Count) { ($after | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join ', ' } else { 'none' }), $resp9)
  Remove-Item $proxyCtl -Force -ErrorAction SilentlyContinue

  # ================================================================ g8 job files read while written
  $jid = "g245stress-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
  $vs = @(foreach ($k in 1..300) { $a = '{0:0.00}' -f (1 + $k / 100); @{ id = "$jid-$k"; xml = ('<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g245 job ' + $k + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $a + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') } })
  $jr = Bridge POST '/jobs' @{ jobId = $jid; company = $co1; vouchers = $vs } 60
  $pf = Join-Path (Join-Path (Join-Path $h1 'jobs') $jid) 'progress.json'
  # the job's folder where the bridge keeps it (its Home\jobs; looked for once the job is there)
  for ($i = 0; $i -lt 20 -and -not (Test-Path $pf); $i++) { $f = Get-ChildItem $env:LOCALAPPDATA, $env:ProgramData -Recurse -Filter 'progress.json' -ErrorAction SilentlyContinue | Where-Object { (Split-Path $_.DirectoryName -Leaf) -eq $jid } | Select-Object -First 1; if ($f) { $pf = $f.FullName; break }; Start-Sleep -Milliseconds 500 }
  Info "g245: the job's progress file: $pf (there: $(Test-Path $pf))"
  $reads = 0; $noJob = 0; $unread = 0; $fileMiss = 0; $fileBad = 0; $backN = 0; $prevDone = -1; $status = ''; $view = $null
  $t = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt 20) {
    $reads++
    try { $view = Invoke-RestMethod -Uri "http://127.0.0.1:$bport/jobs?id=$jid" -Headers @{ 'X-Bridge-Key' = $bkey } -TimeoutSec 10
      if (-not $view -or ($view.PSObject.Properties['error'] -and "$($view.error)" -match 'No such job')) { $noJob++ } else { $dn = [int]$view.done; if ($dn -lt $prevDone) { $backN++ }; $prevDone = [math]::Max($prevDone, $dn); $status = "$($view.status)" }
    } catch { if ("$($_.ErrorDetails.Message)$($_.Exception.Message)" -match 'No such job') { $noJob++ } else { $unread++ } }
    try { $fs = [IO.File]::Open($pf, 'Open', 'Read', [IO.FileShare]'ReadWrite, Delete'); try { $sr = [IO.StreamReader]::new($fs); $txt = $sr.ReadToEnd() } finally { $fs.Dispose() }; try { $null = $txt | ConvertFrom-Json } catch { $fileBad++ } } catch [IO.FileNotFoundException] { $fileMiss++ } catch { $fileMiss++ }
    if ($status -in 'done', 'failed', 'cancelled') { break }
    Start-Sleep -Milliseconds 30
  }
  $res = @($view.results); $okN = @($res | Where-Object { $_.ok -eq $true }).Count
  GRes $G8 $(if (-not $jr) { 'HARNESS' } elseif ($status -eq 'done' -and $okN -eq 300 -and $noJob -eq 0 -and $unread -eq 0 -and $fileMiss -eq 0 -and $fileBad -eq 0 -and $backN -eq 0) { 'PASS' } else { 'FAIL' }) ("the job of 300 entries: {0}, {1} of 300 posted; read {2} times while written: 'no such job' {3}, not answered {4}; progress.json opened directly: missing or locked {5}, not whole {6}; the count going back {7}; {8} min" -f $status, $okN, $reads, $noJob, $unread, $fileMiss, $fileBad, $backN, [math]::Round(((Get-Date) - $t).TotalMinutes, 1))
} catch {
  Write-Host "g245 stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($G1, $G2, $G3, $G4, $G10, $G11, $G5, $G6, $G7, $G9, $G8)) { GRes $c 'HARNESS' "the harness stopped: $_" }
}
$script:frz.stop = $true
Snap 'g245-end'
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Copy-Item $g5State (Join-Path $cap 'stub-state.json') -ErrorAction SilentlyContinue
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
foreach ($f in @(Get-ChildItem (Split-Path $blog) -Filter 'tds-bridge*.log' -ErrorAction SilentlyContinue)) { Copy-Item $f.FullName (Join-Path $out "bridge-full-$($f.Name)") -ErrorAction SilentlyContinue }
