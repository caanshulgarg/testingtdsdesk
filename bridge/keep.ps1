
# ------------------------------------------------------------------ 1.12.13: keep FinCom's copy of each company in step with Tally
# A worker of its own (TDSBridge.ps1 -Keep), started by the bridge while any company is open in your Tally, and stopping
# ten minutes after the last one is closed. For each open company it:
#   1. reads the opening balances once, in small groups of ledgers (never every ledger at once);
#   2. copies the year's day book a few days at a time, pausing between reads and taking smaller steps when Tally is slow,
#      carrying on where it stopped the next time the company is open;
#   3. then asks only what changed: the entries with a change number (ALTERID) above the last one seen, and re-reads just
#      those dates; and, one month at a time, compares the list of entries with Tally's, which also finds deleted ones.
# Only the day book (the format FinCom already reads) and light lists (numbers, no amounts) are asked for.
# ---- Tally's time: every request to a Tally is timed. The worker keeps its share of each Tally's time small
# (KeepSharePct, 10% in office hours; KeepNightSharePct outside them), and slow or failed requests go in the log.
$script:TallyInvokeOrig = ${function:Invoke-Tally}
$script:TallyUse = @{}
$script:TallyStats = @{}
function Get-TallyReqKind([string]$x) {
  $m = [regex]::Match($x, '<ID>([^<]+)</ID>'); if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match($x, '<REPORTNAME>([^<]+)</REPORTNAME>'); if ($m.Success) { return $m.Groups[1].Value }
  if ($x -match 'Import Data') { return 'Posting' }
  return 'Other'
}
function Add-TallyUse([int]$Port, [double]$Sec, [string]$Xml, [string]$Fail) {
  try {
    if (-not $script:TallyUse.ContainsKey($Port)) { $script:TallyUse[$Port] = New-Object System.Collections.ArrayList }
    $now = [DateTime]::UtcNow
    $null = $script:TallyUse[$Port].Add(@($now, $Sec))
    while ($script:TallyUse[$Port].Count -and ($now - $script:TallyUse[$Port][0][0]).TotalSeconds -gt 300) { $script:TallyUse[$Port].RemoveAt(0) }
    $kind = Get-TallyReqKind $Xml
    $k = [string]$Port + ' ' + $kind
    if (-not $script:TallyStats.ContainsKey($k)) { $script:TallyStats[$k] = @{ port = $Port; kind = $kind; n = 0; sec = 0.0; max = 0.0; fail = 0 } }
    $t = $script:TallyStats[$k]; $t.n++; $t.sec += $Sec; if ($Sec -gt $t.max) { $t.max = $Sec }; if ($Fail) { $t.fail++ }
    $slow = [double](Get-KeepNum 'KeepSlowSec' 3)
    if ($Fail -or $Sec -ge $slow) {
      $f = [regex]::Match($Xml, '<SVFROMDATE>(\d{8})</SVFROMDATE>').Groups[1].Value; $to = [regex]::Match($Xml, '<SVTODATE>(\d{8})</SVTODATE>').Groups[1].Value
      Write-Log ('Tally ' + $Port + ': ' + $kind + $(if ($f) { ' ' + $f + $(if ($to -and $to -ne $f) { '-' + $to } else { '' }) } else { '' }) + ' took ' + [Math]::Round($Sec, 1) + 's' + $(if ($Fail) { ' and failed: ' + $Fail } else { '' }))
    }
  } catch { }
}
# A Tally that did not answer in time is still working on that request (giving up here does not stop it), so it is not
# asked again for a while: 10 s, then 20, 40, 80, at most 2 minutes, until it answers again. Requests meanwhile fail at
# once with a plain message instead of piling up behind the one Tally is busy with.
$script:TallyCool = @{}
# 1.14.2: "Tally not responding since HH:MM": kept in a file the bridge, its copier and FinCom's status all see. A Tally
# showing a message box (or busy in a long report) answers nothing until someone deals with it
function Get-TallyStuckFile { return (Join-Path (Get-SyncDir) 'tally-stuck.json') }
function Set-TallyStuck([int]$Port) {
  try {
    $o = $null; $f = Get-TallyStuckFile; if (Test-Path -LiteralPath $f) { $o = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json }
    $since = $(if ($o -and $o.port -eq $Port -and $o.last -and ((Get-Date) - [DateTime]$o.last).TotalMinutes -lt 15) { [string]$o.since } else { (Get-Date).ToString('s') })
    New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null
    [IO.File]::WriteAllText($f, ([ordered]@{ port = $Port; since = $since; last = (Get-Date).ToString('s') } | ConvertTo-Json -Compress))
  } catch { }
}
function Clear-TallyStuck([int]$Port) { try { $f = Get-TallyStuckFile; if (Test-Path -LiteralPath $f) { $o = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json; if ($o.port -eq $Port) { Remove-Item -LiteralPath $f -Force } } } catch { } }
function Get-TallyStuck { try { $o = Get-Content -Raw -LiteralPath (Get-TallyStuckFile) -ErrorAction Stop | ConvertFrom-Json; if (((Get-Date) - [DateTime]$o.last).TotalMinutes -lt 10) { return $o } } catch { }; return $null }
# 1.14.1: one request at a time to each Tally. The bridge, its copier and its posting worker are separate programs; a
# lock they share (by name) makes a request wait its turn instead of reaching Tally alongside another one
# 1.14.2: FinCom first. A request from FinCom (posting, Update now, a check someone asked for) marks that it is waiting;
# the copier gives way between its reads while that mark is fresh, so posting never queues behind the routine copy
function Get-TallyWantFile { return (Join-Path (Get-SyncDir) 'tally-want.txt') }
function Set-TallyWant { try { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; [IO.File]::WriteAllText((Get-TallyWantFile), (Get-Date).ToString('s')) } catch { } }
function Test-TallyWanted { try { return ((Get-Date) - (Get-Item -LiteralPath (Get-TallyWantFile) -ErrorAction Stop).LastWriteTime).TotalSeconds -lt 4 } catch { return $false } }
function Enter-TallyLock([int]$Port, [int]$WaitSec) {
  if ($script:IsCopier) {
    $sw0 = [Diagnostics.Stopwatch]::StartNew()
    while ((Test-TallyWanted) -and $sw0.Elapsed.TotalSeconds -lt 180) { Start-Sleep -Milliseconds 500 }
  } else { Set-TallyWant }
  $m = New-Object Threading.Mutex($false, ('Local\FinComTally' + $Port))
  $got = $false; $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $got = $m.WaitOne([Math]::Max(1, $WaitSec) * 1000) } catch [Threading.AbandonedMutexException] { $got = $true }     # its holder ended without letting go
  if (-not $got) { $m.Dispose(); throw ('Tally (port ' + $Port + ') is busy with another FinCom request; try again in a moment') }
  if ($sw.Elapsed.TotalSeconds -ge 3) { try { Write-Log ('Tally ' + $Port + ': waited ' + [int]$sw.Elapsed.TotalSeconds + 's for another FinCom request to finish first') } catch { } }
  return $m
}
function Invoke-Tally([int]$TallyPort, [string]$Xml, [int]$TimeoutSec) {
  $c = $script:TallyCool[$TallyPort]
  if ($c -and [DateTime]::UtcNow -lt $c.until) { throw ('Tally (port ' + $TallyPort + ') is busy and did not answer the last request; not asked again until ' + $c.until.ToLocalTime().ToString('HH:mm:ss')) }
  $lock = Enter-TallyLock $TallyPort $(if ($TimeoutSec -gt 0) { [Math]::Min(300, $TimeoutSec) } else { 120 })
  $sw = [Diagnostics.Stopwatch]::StartNew(); $fail = ''
  try { $r = (& $script:TallyInvokeOrig $TallyPort $Xml $TimeoutSec); $script:TallyCool.Remove($TallyPort); Clear-TallyStuck $TallyPort; return $r }
  catch {
    $fail = $_.Exception.Message
    if ($fail -match 'timed out|was closed|unexpected error occurred on a receive|forcibly closed') {
      $n = $(if ($c) { [int]$c.n + 1 } else { 1 })
      $wait = [int][Math]::Min(120, 10 * [Math]::Pow(2, $n - 1))
      $script:TallyCool[$TallyPort] = @{ n = $n; until = [DateTime]::UtcNow.AddSeconds($wait) }
      Set-TallyStuck $TallyPort
      try { Write-Log ('Tally ' + $TallyPort + ' is busy and did not answer in time; it is not asked again for ' + $wait + 's, so requests do not pile up') } catch { }
    }
    throw
  }
  finally { if (-not $script:IsCopier) { Set-TallyWant }; try { $lock.ReleaseMutex() } catch { }; $lock.Dispose(); Add-TallyUse $TallyPort $sw.Elapsed.TotalSeconds $Xml $fail; Test-KeepSlowRead $sw.Elapsed.TotalSeconds }
}
# the share of one Tally's time used by this program in the last minute (0..1)
function Get-TallyShare([int]$Port, [int]$WindowSec = 60) {
  if (-not $script:TallyUse.ContainsKey($Port)) { return 0.0 }
  $now = [DateTime]::UtcNow; $sum = 0.0
  foreach ($u in $script:TallyUse[$Port]) { if (($now - $u[0]).TotalSeconds -le $WindowSec) { $sum += [double]$u[1] } }
  return [Math]::Min(1.0, $sum / $WindowSec)
}
# office hours: a small share; outside them (and on Sundays) a larger one, so a first copy goes faster at night
function Get-KeepSharePct {
  $now = Get-Date
  $h1 = Get-KeepNum 'KeepOfficeFrom' 9; $h2 = Get-KeepNum 'KeepOfficeTo' 19
  $office = $now.DayOfWeek -ne [DayOfWeek]::Sunday -and $now.Hour -ge $h1 -and $now.Hour -lt $h2
  if ($office) { return (Get-KeepNum 'KeepSharePct' 10) }
  return (Get-KeepNum 'KeepNightSharePct' 40)
}
function Test-KeepRoom([int]$Port) { return ((Get-TallyShare $Port) * 100 -lt (Get-KeepSharePct)) }
# ---- Tally comes first (1.13.1). Tally answers one request at a time and its screen waits meanwhile, so the worker:
#   - leaves Tally alone for its first minutes after it opens (it is still loading the company);
#   - does not read while the person is working in Tally (Tally in front, a key or the mouse used in the last seconds);
#   - sizes every read to take a few seconds at most, and rests for a long while after a read that took long.
function Get-KeepTargetSec {
  $now = Get-Date
  $office = $now.DayOfWeek -ne [DayOfWeek]::Sunday -and $now.Hour -ge (Get-KeepNum 'KeepOfficeFrom' 9) -and $now.Hour -lt (Get-KeepNum 'KeepOfficeTo' 19)
  if ($office) { return [double](Get-KeepNum 'KeepTargetSec' 3) }
  return [double](Get-KeepNum 'KeepNightTargetSec' 10)
}
$script:KeepUserApi = $null
function Initialize-KeepUserApi {
  if ($null -ne $script:KeepUserApi) { return [bool]$script:KeepUserApi }
  try {
      Add-Type -Namespace FinCom -Name KeepUser -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
public static double IdleSec() { LII l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); if (!GetLastInputInfo(ref l)) return 9999; return ((uint)Environment.TickCount - l.dwTime) / 1000.0; }
public static int Front() { uint p = 0; GetWindowThreadProcessId(GetForegroundWindow(), out p); return (int)p; }
'@ -ErrorAction Stop
    $script:KeepUserApi = $true
  } catch { $script:KeepUserApi = $false }
  return [bool]$script:KeepUserApi
}
# seconds since the keyboard or mouse was last used on this computer
function Get-KeepIdleSec {
  if ($script:Fake) { if ($null -ne $Cfg.KeepFakeIdleSec) { return [double]$Cfg.KeepFakeIdleSec }; return 99999.0 }
  if (-not (Initialize-KeepUserApi)) { return 99999.0 }
  try { return [double][FinCom.KeepUser]::IdleSec() } catch { return 99999.0 }
}
function Get-KeepUserInTally {
  if ($script:Fake) { return [bool]$Cfg.KeepFakeUserBusy }
  if ((Get-KeepIdleSec) -ge (Get-KeepNum 'KeepUserIdleSec' 15)) { return $false }
  try { $fp = Get-Process -Id ([FinCom.KeepUser]::Front()) -ErrorAction Stop; return ($fp.ProcessName -like 'tally*') } catch { return $false }
}
# a quiet time, for a read that may hold Tally up for long: outside office hours, or nobody at this computer for a while
function Test-KeepQuiet {
  $now = Get-Date
  $office = $now.DayOfWeek -ne [DayOfWeek]::Sunday -and $now.Hour -ge (Get-KeepNum 'KeepOfficeFrom' 9) -and $now.Hour -lt (Get-KeepNum 'KeepOfficeTo' 19)
  if ($script:Fake) { if ($null -eq $Cfg.KeepFakeOffice) { return $true }; $office = [bool]$Cfg.KeepFakeOffice }
  if (-not $office) { return $true }
  return ((Get-KeepIdleSec) -ge 60 * (Get-KeepNum 'KeepQuietMin' 10))
}
# ---- Which companies are open (1.13.5): the question every status check asks, so it must cost Tally nothing.
# Only the names and periods are asked (Tally answers at once); a company's GSTIN and PAN are asked once, when it is
# first seen, and remembered. The answer is shared through a file by the bridge and its copier, and kept 30 seconds,
# so FinCom's checks, the Connector's and the copier's together put at most one small question to Tally each 30 s.
$script:CoInfo = $null
function Get-CoInfoFile { return (Join-Path (Get-SyncDir) 'company-info.json') }
function Get-CoInfo([string]$Name, [int]$Port) {
  if ($null -eq $script:CoInfo) { $script:CoInfo = @{}; try { $f = Get-CoInfoFile; if (Test-Path -LiteralPath $f) { $o = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json; foreach ($p in $o.PSObject.Properties) { $script:CoInfo[$p.Name] = $p.Value } } } catch { } }
  $x = $script:CoInfo[$Name]
  if ($x -and ($x.gstin -or $x.pan -or ((Get-Date) - [datetime]$x.at).TotalHours -lt 6)) { return $x }
  $g = ''; $pan = ''
  try {
    $req = New-CollectionRequest 'TDSDeskCompanyInfo' 'Company' 'NAME,GSTREGISTRATIONNUMBER,INCOMETAXNUMBER,GSTREGISTRATIONDETAILS.LIST' '' ('<FILTERS>TDSDeskThisCo</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="TDSDeskThisCo">$Name = "' + (Esc ($Name.Replace('"', ''))) + '"</SYSTEM><COLLECTION NAME="TDSDeskUnused" ISMODIFY="No"><TYPE>Company</TYPE>')
    $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec 15)
    $c = $doc.SelectSingleNode('//COMPANY')
    if ($c) { $g = Get-NodeText $c 'GSTREGISTRATIONNUMBER'; if (-not $g) { $g = Get-NodeText $c 'GSTREGISTRATIONDETAILS.LIST/GSTIN' }; $pan = Get-NodeText $c 'INCOMETAXNUMBER' }
  } catch { }
  $x = [pscustomobject]@{ gstin = $g; pan = $pan; at = (Get-Date).ToString('s') }
  $script:CoInfo[$Name] = $x
  try { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; $o = [ordered]@{}; foreach ($k in $script:CoInfo.Keys) { $o[$k] = $script:CoInfo[$k] }; Save-KeepFile (Get-CoInfoFile) ($o | ConvertTo-Json -Depth 3 -Compress) } catch { }
  return $x
}
function Get-OpenCompanies([switch]$Fresh) {
  $cacheSec = [int]$Cfg.StatusCacheSec; if ($cacheSec -lt 30) { $cacheSec = 30 }
  if (-not $Fresh -and $script:CompanyCache -and ((Get-Date) - $script:CompanyCacheAt).TotalSeconds -lt $cacheSec) { return $script:CompanyCache }
  # what the bridge or the copier asked a moment ago
  $shared = Join-Path (Get-SyncDir) 'open-companies.json'
  if (-not $Fresh) {
    try {
      $fi = Get-Item -LiteralPath $shared -ErrorAction Stop
      if (((Get-Date) - $fi.LastWriteTime).TotalSeconds -lt $cacheSec) {
        $script:CompanyCache = @(Get-Content -Raw -LiteralPath $shared | ConvertFrom-Json | ForEach-Object { $h = [ordered]@{}; foreach ($p in $_.PSObject.Properties) { $h[$p.Name] = $p.Value }; $h.companies = @($h.companies | ForEach-Object { $c = [ordered]@{}; foreach ($q in $_.PSObject.Properties) { $c[$q.Name] = $q.Value }; $c }); $h })
        $script:CompanyCacheAt = $fi.LastWriteTime
        return $script:CompanyCache
      }
    } catch { }
  }
  $plan = Get-PortPlan
  $script:PlanMode = $plan.mode
  $sessions = @()
  foreach ($pp in $plan.ports) {
    $entry = [ordered]@{ port = [int]$pp.port; ok = $false; companies = @(); error = ''; mine = $pp.mine; session = $pp.session; program = $pp.program; user = $pp.user; skipped = $false }
    if ($Cfg.OnlyMySession -and $pp.mine -eq $false) {
      $entry.skipped = $true
      $who = $pp.user; if (-not $who) { $who = 'Windows session ' + $pp.session }
      $entry.error = "Tally of " + $who
      $sessions += $entry
      continue
    }
    try {
      $xml = Invoke-Tally -TallyPort $pp.port -Xml (New-CollectionRequest 'TDSDeskCompanies' 'Company' 'NAME,STARTINGFROM,ENDINGAT,GUID' '' '') -TimeoutSec 8
      $doc = Get-XmlDoc $xml
      $list = @()
      foreach ($c in $doc.SelectNodes('//COMPANY')) {
        $name = $c.GetAttribute('NAME')
        if (-not $name) { $name = Get-NodeText $c 'NAME' }
        if (-not $name) { continue }
        $inf = Get-CoInfo $name ([int]$pp.port)
        $list += [ordered]@{ name = $name; from = (Get-NodeText $c 'STARTINGFROM'); to = (Get-NodeText $c 'ENDINGAT'); guid = (Get-NodeText $c 'GUID'); gstin = [string]$inf.gstin; pan = [string]$inf.pan }
      }
      $entry.ok = $true
      $entry.companies = $list
    } catch { $entry.error = $_.Exception.Message }
    $sessions += $entry
  }
  $script:CompanyCache = $sessions
  $script:CompanyCacheAt = Get-Date
  try { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; Save-KeepFile $shared (ConvertTo-Json -InputObject @($sessions) -Depth 6 -Compress) } catch { }
  return $sessions
}
# FinCom reading from Tally (a day book or the balances): the copier waits until it is done
# 1.14.0: the status checks (FinCom's page every minute, the Connector every half minute) never ask Tally. They get the
# companies Tally named the last time it was asked (by something a person did: posting, Update now, opening FinCom),
# and whether Tally's port takes connections (a connection opened and closed; Tally is asked nothing)
function Test-TallyPortOpen([int]$Port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ar = $c.BeginConnect('127.0.0.1', $Port, $null, $null); if (-not $ar.AsyncWaitHandle.WaitOne(500)) { return $false }; $c.EndConnect($ar); return $true } catch { return $false } finally { try { $c.Close() } catch { } }
}
$script:EmptyAskAt = [DateTime]::MinValue
function Get-OpenCompaniesCached {
  $shared = Join-Path (Get-SyncDir) 'open-companies.json'
  $list = $null
  try { if (Test-Path -LiteralPath $shared) { $list = @(Get-Content -Raw -LiteralPath $shared | ConvertFrom-Json | ForEach-Object { $h = [ordered]@{}; foreach ($p in $_.PSObject.Properties) { $h[$p.Name] = $p.Value }; $h.companies = @($h.companies | Where-Object { $_ } | ForEach-Object { $c = [ordered]@{}; foreach ($q in $_.PSObject.Properties) { $c[$q.Name] = $q.Value }; $c }); $h }) } } catch { $list = $null }
  $stale = $false
  if ($list) {
    foreach ($e in $list) {
      if ($e.skipped) { continue }
      $open = Test-TallyPortOpen ([int]$e.port)
      if ($open -and (-not $e.ok -or -not @($e.companies).Count)) { $stale = $true }     # Tally opened since it was last asked
      $e.ok = $open; if (-not $open) { $e.companies = @() }
    }
  }
  # nothing known yet, or Tally has been opened since: asked once, and not again for ten minutes
  if ((-not $list -or $stale) -and ((Get-Date) - $script:EmptyAskAt).TotalMinutes -ge 10 -and -not (Get-KeepUserInTally)) {
    $script:EmptyAskAt = Get-Date
    return @(Get-OpenCompanies)
  }
  if (-not $list) { return @() }
  return $list
}
function Set-FinComReading { try { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; [IO.File]::WriteAllText((Join-Path (Get-SyncDir) 'fincom-reading.txt'), (Get-Date).ToString('s')) } catch { } }
# why Tally is to be left alone right now ('' when it is free)
function Get-KeepHold {
  try { $fr = Get-Item -LiteralPath (Join-Path (Get-SyncDir) 'fincom-reading.txt') -ErrorAction Stop; if (((Get-Date) - $fr.LastWriteTime).TotalSeconds -lt 120) { return 'FinCom is reading from Tally' } } catch { }
  if ($script:Fake -and $Cfg.KeepFakeHold) { return [string]$Cfg.KeepFakeHold }
  try {
    $young = @(Get-Process -Name 'tally*' -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -and ((Get-Date) - $_.StartTime).TotalMinutes -lt (Get-KeepNum 'KeepSettleMin' 3) })
    if ($young.Count) { return 'Tally has just opened; letting it finish loading' }
  } catch { }
  if (Get-KeepUserInTally) { return 'someone is working in Tally' }
  return ''
}
# a read that took long: the company is left alone for ten times as long (at most half an hour)
$script:KeepLong = 0.0
function Test-KeepSlowRead([double]$Sec) { if ($Sec -gt $script:KeepLong) { $script:KeepLong = $Sec } }
# what the worker tells FinCom and the Connector about each Tally's load
function Write-KeepLoad {
  try {
    $ports = @(); foreach ($p in $script:TallyUse.Keys) { $ports += [ordered]@{ port = $p; sharePct = [Math]::Round((Get-TallyShare $p) * 100, 1); limitPct = (Get-KeepSharePct) } }
    $kinds = @(); foreach ($t in $script:TallyStats.Values) { $kinds += [ordered]@{ port = $t.port; kind = $t.kind; n = $t.n; avgSec = [Math]::Round($t.sec / [Math]::Max(1, $t.n), 2); maxSec = [Math]::Round($t.max, 2); failed = $t.fail } }
    Save-KeepFile (Join-Path (Get-SyncDir) 'keep-load.json') ([ordered]@{ at = (Get-Date).ToString('s'); ports = $ports; requests = $kinds } | ConvertTo-Json -Depth 5 -Compress)
  } catch { }
}
# Tally's own change counters for a company (the last change number of entries and of masters): one tiny request.
# When neither has moved, nothing in the company has changed and nothing more is asked. A Tally that does not give
# them is simply asked the usual way.
function Get-KeepCounters([string]$Company, [int]$Port) {
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepCo</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskKeepCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME,ALTVCHID,ALTMSTID</FETCH><FILTERS>TDSDeskKeepThisCo</FILTERS></COLLECTION>' +
    '<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepThisCo">' + (Esc ('$Name = "' + $Company.Replace('"', '') + '"')) + '</SYSTEM>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $raw = Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec 15
  $v = [regex]::Match($raw, '<ALTVCHID[^>]*>\s*(\d+)\s*</ALTVCHID>').Groups[1].Value
  $m = [regex]::Match($raw, '<ALTMSTID[^>]*>\s*(\d+)\s*</ALTMSTID>').Groups[1].Value
  if (-not $v -or -not $m) { return @{ ok = $false } }
  return @{ ok = $true; v = [long]$v; m = [long]$m }
}
function Save-Config { try { ($Cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $ConfigPath -Encoding UTF8 } catch { Write-Log ('Could not save the settings: ' + $_.Exception.Message) } }
# 1.14.0: when the copier reads Tally. 'daily' (the default): once a day, at KeepDailyAt (20:00 unless set), and when
# someone presses Update now in FinCom; never through the working day by itself. 'continuous': every minute (as before)
function Get-KeepSchedule {
  $v = [string]$Cfg.KeepSchedule
  if ($v -eq 'daily' -or $v -eq 'continuous') { return $v }
  if ($script:Fake) { return 'continuous' }
  return 'daily'
}
function Get-KeepDailyAt { $v = [string]$Cfg.KeepDailyAt; if ($v -match '^([01]?\d|2[0-3]):[0-5]\d$') { return $v }; return '20:00' }
function Get-KeepLastRun { try { return ([IO.File]::ReadAllText((Join-Path (Get-SyncDir) 'keep-lastrun.txt'))).Trim() } catch { return '' } }
# '' (not now), 'now' (someone asked) or 'daily' (the day's run is due)
function Test-KeepDue {
  if (Test-Path -LiteralPath (Join-Path (Get-SyncDir) 'keep-now.txt')) { return 'now' }
  if ((Get-KeepSchedule) -ne 'daily') { return 'continuous' }
  $now = Get-Date; $p = (Get-KeepDailyAt).Split(':')
  $at = $now.Date.AddHours([int]$p[0]).AddMinutes([int]$p[1])
  if ($now -ge $at -and (Get-KeepLastRun) -ne $now.ToString('yyyyMMdd')) { return 'daily' }
  return ''
}
function Request-KeepNow { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; [IO.File]::WriteAllText((Join-Path (Get-SyncDir) 'keep-now.txt'), (Get-Date).ToString('s')); Write-Log 'Update from Tally asked for now' }
function Test-KeepOn {
  if ($null -ne $Cfg.KeepInStep) { return [bool]$Cfg.KeepInStep }
  return (-not $script:Fake)             # on by default; off in test mode unless asked for
}
function Get-KeepNum([string]$k, [int]$def) { $v = 0; try { $v = [int]$Cfg.$k } catch { }; if ($v -gt 0) { return $v }; return $def }
function ConvertTo-KeepHash($o) {
  if ($null -eq $o) { return $null }
  if ($o -is [hashtable]) { return $o }
  $h = @{}
  foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $(if ($p.Value -is [Management.Automation.PSCustomObject]) { ConvertTo-KeepHash $p.Value } else { $p.Value }) }
  return $h
}
function Read-KeepState([string]$dir) {
  $f = Join-Path $dir 'keep.json'
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  try { return (ConvertTo-KeepHash (Get-Content -Raw -LiteralPath $f | ConvertFrom-Json)) } catch { return $null }
}
function Save-KeepFile([string]$path, [string]$text) {
  $tmp = $path + '.tmp'
  [IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
}
function Add-KeepDays([string]$d, [int]$n) { return (ConvertFrom-TallyDate $d).AddDays($n).ToString('yyyyMMdd') }

# the entries of a period, as numbers only: [guid, change number, date]; 'after' asks only for those changed since
function Get-KeepList([string]$Company, [int]$Port, [string]$From, [string]$To, [long]$After) {
  $flt = ''; $sys = ''
  if ($After -gt 0) { $flt = '<FILTERS>TDSDeskKeepNew</FILTERS>'; $sys = '<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepNew">$AlterID &gt; ' + $After + '</SYSTEM>' }
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepList</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskKeepList" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID,ALTERID,DATE</FETCH>' + $flt + '</COLLECTION>' + $sys +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $raw = Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec 120
  $out = New-Object System.Collections.ArrayList
  foreach ($m in [regex]::Matches($raw, '<VOUCHER\b[\s\S]*?</VOUCHER>')) {
    $x = $m.Value
    $g = [regex]::Match($x, '<GUID>([^<]*)</GUID>').Groups[1].Value.Trim()
    $a = [regex]::Match($x, '<ALTERID>\s*(\d+)').Groups[1].Value
    $d = [regex]::Match($x, '<DATE>(\d{8})</DATE>').Groups[1].Value
    if ($g -and $d -and $d -ge $From -and $d -le $To) { $null = $out.Add(@($g, [long]('0' + $a), $d)) }   # a Tally that ignores the period is cut here
  }
  return , $out
}
# opening balances for a group of ledgers, on one date
function Get-KeepBalances([string]$Company, [int]$Port, [string[]]$Names, [string]$AsOn) {
  $f = ($Names | ForEach-Object { '$Name = "' + ([string]$_).Replace('"', '') + '"' }) -join ' OR '
  $flt = '<FILTERS>TDSDeskKeepThese</FILTERS>'; $sys = '<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepThese">' + (Esc $f) + '</SYSTEM>'
  if (-not @($Names).Count) { $flt = ''; $sys = '' }       # every ledger, in one read (only at a quiet time)
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepBal</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $AsOn + '</SVFROMDATE><SVTODATE>' + $AsOn + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskKeepBal" ISMODIFY="No"><TYPE>Ledger</TYPE>' + $flt + '<FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH></COLLECTION>' + $sys +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $t = 120; if (-not @($Names).Count) { $t = 900 }
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec $t)
  $out = @()
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }
    if ($n) { $out += , @($n, (Get-NodeText $l 'PARENT'), (Get-NodeText $l 'CLOSINGBALANCE')) }
  }
  return $out
}
# one stretch of the day book, kept as one file a day; a day with nothing left in Tally is kept empty
function Copy-KeepDays([string]$Company, [int]$Port, [string]$Dir, [string]$From, [string]$To) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $xml = Get-DayBookXml $Company $From $To $Port
  $sec = $sw.Elapsed.TotalSeconds
  $n = Save-KeepDays $Dir $From $To $xml
  return @($sec, $n)
}
# a stretch of the day book (from Tally, or from a day book file) kept as one file a day; a day with nothing is kept empty
function Save-KeepDays([string]$Dir, [string]$From, [string]$To, [string]$xml) {
  $by = @{}
  foreach ($m in [regex]::Matches($xml, '<VOUCHER\b[\s\S]*?</VOUCHER>')) {
    $d = [regex]::Match($m.Value, '<DATE>(\d{8})</DATE>').Groups[1].Value
    if (-not $d) { continue }
    if (-not $by.ContainsKey($d)) { $by[$d] = New-Object Text.StringBuilder }
    $null = $by[$d].Append('<TALLYMESSAGE>').Append($m.Value).Append('</TALLYMESSAGE>')
  }
  $days = Join-Path $Dir 'days'; New-Item -ItemType Directory -Force -Path $days | Out-Null
  $d = $From; $n = 0; $written = @()
  $where = Get-KeepWhere $Dir
  while ($d -le $To) {
    $t = ''; if ($by.ContainsKey($d)) { $t = $by[$d].ToString(); $n += [regex]::Matches($t, '<VOUCHER\b').Count }
    Save-KeepFile (Join-Path $days ($d + '.xml')) $t
    $ix = Get-KeepIndexText $t
    Save-KeepFile (Join-Path $days ($d + '.idx')) $ix
    foreach ($ln in ($ix -split "`n")) { $g = ($ln -split "`t")[0]; if ($g) { $where[$g] = $d } }
    $written += $d
    $d = Add-KeepDays $d 1
  }
  Add-CloudDays $Dir $written
  return $n
}
# how a company's year comes in: 'files' (the day book files chosen in FinCom; the default) or 'bridge' (the bridge reads
# it from Tally at a quiet time). Chosen in FinCom's setup list for the company
function Get-KeepMode([string]$Company) {
  $m = $null; try { $m = $Cfg.KeepModes.$Company } catch { }
  if ($m -eq 'bridge' -or $m -eq 'files') { return $m }
  if ($script:Fake -and -not $Cfg.KeepFakeFilesFirst) { return 'bridge' }
  return 'files'
}
function Set-KeepMode([string]$Company, [string]$Mode) {
  if ($Mode -ne 'bridge' -and $Mode -ne 'files') { throw 'The way is files or bridge.' }
  $h = [ordered]@{}; try { foreach ($p in $Cfg.KeepModes.PSObject.Properties) { $h[$p.Name] = $p.Value } } catch { }
  $h[$Company] = $Mode
  $Cfg | Add-Member -NotePropertyName KeepModes -NotePropertyValue ([pscustomobject]$h) -Force
  Save-Config
  Write-Log ('Keeping ' + $Company + ' in step: the year comes ' + $(if ($Mode -eq 'bridge') { 'from Tally, read by the bridge at a quiet time' } else { 'from the day book files chosen in FinCom' }))
  return (Get-KeepStatus $Company)
}
# 1.13.8: opening balances from a trial balance exported from Tally (as on the day before the copy starts), so the
# bridge never asks Tally for them either
function Import-KeepOpening([string]$Company, [string]$Json) {
  $o = $Json | ConvertFrom-Json
  $dir = Get-SyncFolder $Company; $st = Read-KeepState $dir
  if (-not $st) { return [ordered]@{ ok = $true; skipped = 'The bridge has no copy of this company yet: give it the day book first, then the trial balance.' } }
  $want = Add-KeepDays ([string]$st.from) -1
  if ([string]$o.openAsOn -ne $want) { return [ordered]@{ ok = $true; skipped = ('The copy starts on ' + $st.from + ', so it needs the balances as on ' + $want + '; this trial balance is as on ' + $o.openAsOn + '.') } }
  $led = @($o.ledgers | ForEach-Object { [ordered]@{ name = [string]$_.name; parent = [string]$_.parent; open = [string]$_.open; close = '' } })
  $bal = [ordered]@{ ok = $true; company = $Company; from = $st.from; to = (Get-Date).ToString('yyyyMMdd'); openAsOn = $want; ledgers = $led; keep = $true; source = 'trial balance file' }
  Save-KeepFile (Join-Path $dir 'balances.json') ($bal | ConvertTo-Json -Depth 6 -Compress)
  Set-CloudLedgers $dir
  $st.openPending = $false; $st.balAt = (Get-Date).ToString('s'); $st.lastM = 0
  Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress)
  Write-KeepManifest $dir $st ((Get-Date).ToString('yyyyMMdd'))
  Write-Log ('Keeping ' + $Company + ': opening balances of ' + $led.Count + ' ledgers taken from the trial balance file')
  return [ordered]@{ ok = $true; ledgers = $led.Count; openAsOn = $want }
}
# 1.13.7: the day book exported from Tally once (Display > Day Book > Ctrl+E > XML) and chosen in FinCom: FinCom sends it
# here a few megabytes at a time, and it becomes the copy, so the bridge never reads the year from Tally itself. After
# it only changes are read; the opening balances and the month-by-month check follow at a quiet time
function Import-KeepSeed([string]$Company, [string]$From, [string]$To, [string]$Xml) {
  if (-not $Company) { throw 'Say which company.' }
  if (-not (Test-TallyDate $From) -or -not (Test-TallyDate $To) -or $From -gt $To) { throw 'Dates are to be given as yyyymmdd.' }
  Set-FinComReading                                            # the copier waits meanwhile
  $dir = Get-SyncFolder $Company
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $st = Read-KeepState $dir
  if ($st -and -not $st.seeded -and ($st.phase -eq 'check' -or $st.phase -eq 'live')) { return [ordered]@{ ok = $true; skipped = 'This company is already kept in step; its copy was made before.' } }
  if (-not $st -or -not $st.seeded) {
    $st = @{ company = $Company; from = $From; next = $From; slice = 1; phase = 'check'; openIdx = 0; last = 0; lastM = 0; checkYm = $From.Substring(0, 6); months = @{}; cycle = 0; skipped = @(); dayFail = 0; balMode = 'whole'; openPending = $true; seeded = $true }
    Write-Log ('Keeping ' + $Company + ' in step: the copy starts from the day book file chosen in FinCom')
  }
  $n = Save-KeepDays $dir $From $To $Xml
  $mx = [long]$st.last
  foreach ($m in [regex]::Matches($Xml, '<ALTERID>\s*(\d+)')) { $v = [long]$m.Groups[1].Value; if ($v -gt $mx) { $mx = $v } }
  $st.last = $mx
  if ($From -lt [string]$st.from) { $st.from = $From; $st.checkYm = $From.Substring(0, 6); $st.openPending = $true; $st.balMode = 'whole' }   # an earlier start needs earlier opening balances
  # copied up to the first day with nothing in the copy: parts may come in any order, and a gap is read from Tally later
  $d = [string]$st.from; $today = (Get-Date).ToString('yyyyMMdd'); $days = Join-Path $dir 'days'
  while ($d -le $today -and (Test-Path -LiteralPath (Join-Path $days ($d + '.xml')))) { $d = Add-KeepDays $d 1 }
  $st.next = $d
  $st.phase = 'check'
  $ym = $From.Substring(0, 6); while ($ym -le $To.Substring(0, 6)) { Write-KeepMonth $dir $ym $st; $ym = (ConvertFrom-TallyDate ($ym + '01')).AddMonths(1).ToString('yyyyMM') }
  $st.at = (Get-Date).ToString('s')
  Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress)
  Write-KeepManifest $dir $st ((Get-Date).ToString('yyyyMMdd'))
  Write-Log ('Keeping ' + $Company + ': ' + $n + ' entries of ' + $From + '-' + $To + ' taken from the day book file')
  return [ordered]@{ ok = $true; entries = $n; from = $From; to = $To; next = $st.next }
}
# one day's entries as numbers only, one line each: guid, change number
function Get-KeepIndexText([string]$t) {
  $sb = New-Object Text.StringBuilder
  foreach ($m in [regex]::Matches($t, '<VOUCHER\b[\s\S]*?</VOUCHER>')) {
    $g = [regex]::Match($m.Value, '<GUID>([^<]*)</GUID>').Groups[1].Value.Trim()
    $a = [regex]::Match($m.Value, '<ALTERID>\s*(\d+)').Groups[1].Value
    if ($g) { $null = $sb.Append($g).Append("`t").Append($a).Append("`n") }
  }
  return $sb.ToString()
}
# a day's index, made from the day's file when an older bridge kept it without one
function Read-KeepIndex([string]$DayXml) {
  $ixf = [IO.Path]::ChangeExtension($DayXml, '.idx')
  if (-not (Test-Path -LiteralPath $ixf)) { Save-KeepFile $ixf (Get-KeepIndexText ([IO.File]::ReadAllText($DayXml))) }
  return [IO.File]::ReadAllText($ixf)
}
# where each entry sits in the copy (guid -> date), held in memory by the worker; an entry moved to another date is
# then taken off its old date too
$script:KeepWhereMap = @{}
function Get-KeepWhere([string]$Dir) {
  if ($script:KeepWhereMap.ContainsKey($Dir)) { return $script:KeepWhereMap[$Dir] }
  $w = @{}
  $days = Join-Path $Dir 'days'
  if (Test-Path $days) {
    foreach ($f in (Get-ChildItem -LiteralPath $days -Filter '*.xml' | Sort-Object Name)) {
      foreach ($ln in ((Read-KeepIndex $f.FullName) -split "`n")) { $g = ($ln -split "`t")[0]; if ($g) { $w[$g] = $f.BaseName } }
    }
  }
  $script:KeepWhereMap[$Dir] = $w
  return $w
}
# the entries kept for a month: guid -> [change number, date]
function Get-KeepHeld([string]$Dir, [string]$Ym) {
  $h = @{}
  $days = Join-Path $Dir 'days'
  if (-not (Test-Path $days)) { return $h }
  foreach ($f in (Get-ChildItem -LiteralPath $days -Filter ($Ym + '*.xml'))) {
    foreach ($ln in ((Read-KeepIndex $f.FullName) -split "`n")) {
      $p = $ln -split "`t"
      if ($p[0]) { $h[$p[0]] = @([long]('0' + $p[1]), $f.BaseName) }
    }
  }
  return $h
}
# a month's day book file, put together from its days, for FinCom to read
function Write-KeepMonth([string]$Dir, [string]$Ym, $St) {
  $days = Join-Path $Dir 'days'
  $sb = New-Object Text.StringBuilder
  $null = $sb.Append('<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>')
  $n = 0
  foreach ($f in (Get-ChildItem -LiteralPath $days -Filter ($Ym + '*.xml') | Sort-Object Name)) { $t = [IO.File]::ReadAllText($f.FullName); $n += [regex]::Matches($t, '<VOUCHER\b').Count; $null = $sb.Append($t) }
  $null = $sb.Append('</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
  Save-KeepFile (Join-Path $Dir ('daybook-' + $Ym + '.xml')) $sb.ToString()
  if (-not $St.months) { $St.months = @{} }
  $St.months[$Ym] = @{ at = (Get-Date).ToString('s'); n = $n }
}
function Write-KeepManifest([string]$Dir, $St, [string]$Today) {
  $months = @()
  foreach ($ym in ($St.months.Keys | Sort-Object)) {
    $m = ConvertTo-KeepHash $St.months[$ym]
    $f = $ym + '01'; $e = (ConvertFrom-TallyDate $f).AddMonths(1).AddDays(-1).ToString('yyyyMMdd'); if ($e -gt $Today) { $e = $Today }
    if ($f -lt $St.from) { $f = $St.from }
    $months += [ordered]@{ ym = $ym; from = $f; to = $e; at = $m.at; n = $m.n }
  }
  $doneTo = Add-KeepDays ([string]$St.next) -1
  $man = [ordered]@{ ok = $true; keep = $true; company = $St.company; at = (Get-Date).ToString('s'); from = $St.from; to = $(if ($St.phase -eq 'first' -or $St.phase -eq 'open') { $doneTo } else { $Today });
    phase = $St.phase; doneTo = $doneTo; seen = (Get-Date).ToString('s'); months = $months; balancesAt = $St.balAt; bridge = $BridgeVersion;
    skipped = @(@($St.skipped) | Where-Object { $_ }); trouble = $St.trouble }
  Save-KeepFile (Join-Path $Dir 'manifest.json') ($man | ConvertTo-Json -Depth 6 -Compress)
}
# re-read some dates (changed or found different), a few at a time; a date Tally cannot give now is noted and tried later
function Update-KeepDates([string]$Company, [int]$Port, [string]$Dir, $St, [string[]]$Dates) {
  $touched = @{}
  $list = @($Dates | Where-Object { $_ -and $_ -ge [string]$St.from } | Sort-Object -Unique)
  $i = 0
  while ($i -lt $list.Count) {
    $a = $list[$i]; $b = $a
    while ($i + 1 -lt $list.Count -and $list[$i + 1] -eq (Add-KeepDays $b 1) -and ((ConvertFrom-TallyDate $list[$i + 1]) - (ConvertFrom-TallyDate $a)).TotalDays -lt [Math]::Max(1, [Math]::Min(7, [int]$St.slice))) { $i++; $b = $list[$i] }
    try {
      $r = Copy-KeepDays $Company $Port $Dir $a $b
      $touched[$a.Substring(0, 6)] = $true; $touched[$b.Substring(0, 6)] = $true
      $St.skipped = @(@($St.skipped) | Where-Object { $_ -and ($_ -lt $a -or $_ -gt $b) })
      Start-Sleep -Milliseconds ([int][Math]::Max(1000, $r[0] * 1500))
    } catch {
      $d = $a; while ($d -le $b) { Add-KeepSkipped $St $d; $d = Add-KeepDays $d 1 }
      Write-Log ('Keeping ' + $Company + ': Tally did not give ' + $a + $(if ($b -ne $a) { '-' + $b } else { '' }) + ' (' + $_.Exception.Message + '); tried again later')
      Start-Sleep -Seconds 5
    }
    $i++
  }
  foreach ($ym in $touched.Keys) { Write-KeepMonth $Dir $ym $St }
  return $touched.Count
}
function Add-KeepSkipped($St, [string]$d) { $St.skipped = @(@($St.skipped) + $d | Where-Object { $_ } | Sort-Object -Unique) }

# the ledgers as numbers and names only: [guid, change number, name, parent]; 'after' asks only for those changed since
function Get-KeepLedgers([string]$Company, [int]$Port, [long]$After) {
  $flt = ''; $sys = ''
  if ($After -gt 0) { $flt = '<FILTERS>TDSDeskKeepLedNew</FILTERS>'; $sys = '<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepLedNew">$AlterID &gt; ' + $After + '</SYSTEM>' }
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepLed</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskKeepLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID,ALTERID,NAME,PARENT</FETCH>' + $flt + '</COLLECTION>' + $sys +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec 120)
  $out = New-Object System.Collections.ArrayList
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }
    $g = (Get-NodeText $l 'GUID').Trim()
    if ($n -and $g) { $null = $out.Add(@($g, [long]('0' + ((Get-NodeText $l 'ALTERID') -replace '\D', '')), $n, (Get-NodeText $l 'PARENT'))) }
  }
  return , $out
}
function Read-KeepJson([string]$f) { if (-not (Test-Path -LiteralPath $f)) { return $null }; try { return (Get-Content -Raw -LiteralPath $f -Encoding UTF8 | ConvertFrom-Json) } catch { return $null } }
# a ledger renamed in Tally: the copy's entries carry the new name (Tally's own entries do); nothing is asked of Tally for it
function Rename-KeepLedger([string]$Dir, $St, [string]$Old, [string]$New) {
  $days = Join-Path $Dir 'days'; $touched = @{}
  $olds = @((Esc $Old), $Old.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;'), $Old.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace("'", '&apos;')) | Sort-Object -Unique
  $nw = $New.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
  foreach ($f in (Get-ChildItem -LiteralPath $days -Filter '*.xml')) {
    $t = [IO.File]::ReadAllText($f.FullName); $t2 = $t
    foreach ($o in $olds) { foreach ($tag in 'LEDGERNAME', 'PARTYLEDGERNAME') { $t2 = $t2.Replace('<' + $tag + '>' + $o + '</' + $tag + '>', '<' + $tag + '>' + $nw + '</' + $tag + '>') } }
    if ($t2 -ne $t) { Save-KeepFile $f.FullName $t2; $touched[$f.BaseName.Substring(0, 6)] = $true; Add-CloudDays $Dir @($f.BaseName) }
  }
  foreach ($ym in $touched.Keys) { Write-KeepMonth $Dir $ym $St }
  return $touched.Count
}
# ledger masters changed in Tally (new, renamed, opening or group changed): names put right, those ledgers' opening read again
function Update-KeepLedgers([string]$Company, [int]$Port, [string]$Dir, $St, [bool]$Full) {
  $lf = Join-Path $Dir 'ledgers.json'
  $known = @{}; $kj = Read-KeepJson $lf; if ($kj) { foreach ($p in $kj.PSObject.Properties) { $known[$p.Name] = @($p.Value) } }
  $first = -not $known.Count -or -not ([long]$St.lastM -gt 0)
  $ch = Get-KeepLedgers $Company $Port $(if ($Full -or $first) { 0 } else { [long]$St.lastM })
  $renamed = 0; $again = @(); $seen = @{}
  foreach ($c in $ch) {
    $seen[$c[0]] = $true
    if ([long]$c[1] -gt [long]$St.lastM) { $St.lastM = [long]$c[1] }
    $k = $known[$c[0]]
    if ($first) { $known[$c[0]] = @($c[2], $c[3], [long]$c[1]); continue }
    if ($k -and [long]$k[2] -eq [long]$c[1] -and $k[0] -eq $c[2]) { continue }
    if ($k -and $k[0] -ne $c[2]) { $null = Rename-KeepLedger $Dir $St ([string]$k[0]) ([string]$c[2]); $renamed++; Write-Log ('Keeping ' + $Company + ': ledger ' + $k[0] + ' is now ' + $c[2]) }
    $known[$c[0]] = @($c[2], $c[3], [long]$c[1]); $again += , @($c[2], $(if ($k) { [string]$k[0] } else { '' }))
  }
  $gone = @()
  if ($Full -and -not $first) { foreach ($g in @($known.Keys)) { if (-not $seen.ContainsKey($g)) { $gone += [string]$known[$g][0]; $known.Remove($g) } } }
  if (-not $first -and ($again.Count -or $gone.Count)) {
    $bf = Join-Path $Dir 'balances.json'; $bal = Read-KeepJson $bf
    if ($bal) {
      $rows = [ordered]@{}; foreach ($l in @($bal.ledgers)) { $rows[[string]$l.name] = [ordered]@{ name = [string]$l.name; parent = [string]$l.parent; open = [string]$l.open; close = '' } }
      foreach ($x in $again) { if ($x[1] -and $x[1] -ne $x[0] -and $rows.Contains($x[1])) { $rows.Remove($x[1]) } }
      foreach ($n in $gone) { if ($rows.Contains($n)) { $rows.Remove($n) } }
      $names = @($again | ForEach-Object { $_[0] })
      if ($St.balMode -eq 'whole' -and $names.Count) { $St.openPending = $true; $names = @() }     # read with every other one, at a quiet time
      for ($i = 0; $i -lt $names.Count; $i += 150) {
        $chunk = $names[$i .. ([Math]::Min($names.Count, $i + 150) - 1)]
        foreach ($chunkName in $chunk) { if ($rows.Contains($chunkName)) { $rows.Remove($chunkName) } }
        foreach ($r in (Get-KeepBalances $Company $Port $chunk ([string]$bal.openAsOn))) { $rows[[string]$r[0]] = [ordered]@{ name = [string]$r[0]; parent = [string]$r[1]; open = [string]$r[2]; close = '' } }
      }
      $bal.ledgers = @($rows.Values)
      Save-KeepFile $bf ($bal | ConvertTo-Json -Depth 6 -Compress)
      Set-CloudLedgers $Dir
      $St.balAt = (Get-Date).ToString('s')
      Write-Log ('Keeping ' + $Company + ': ' + $names.Count + ' ledger(s) changed in Tally' + $(if ($gone.Count) { ', ' + $gone.Count + ' no longer there' } else { '' }) + '; their opening read again')
    }
  }
  $o = [ordered]@{}; foreach ($g in $known.Keys) { $o[$g] = $known[$g] }
  Save-KeepFile $lf ($o | ConvertTo-Json -Depth 4 -Compress)
}
# one month of the copy compared with Tally's list of entries, and the dates that differ read again. Also notices when
# Tally's change numbers have gone back (a backup restored, the data rewritten): then every month is checked again.
function Test-KeepMonthFix([string]$Company, [int]$Port, [string]$Dir, $St, [string]$Ym, [string]$Today) {
  $mf = $Ym + '01'; if ($mf -lt [string]$St.from) { $mf = [string]$St.from }
  $mt = (ConvertFrom-TallyDate ($Ym + '01')).AddMonths(1).AddDays(-1).ToString('yyyyMMdd'); if ($mt -gt $Today) { $mt = $Today }
  if ($mf -gt $mt) { return 0 }
  $tl = Get-KeepList $Company $Port $mf $mt 0
  $held = Get-KeepHeld $Dir $Ym
  $bad = @{}; $seen = @{}; $back = 0; $max = 0
  foreach ($e in $tl) {
    $seen[$e[0]] = $true
    if ([long]$e[1] -gt $max) { $max = [long]$e[1] }
    $h = $held[$e[0]]
    if (-not $h) { $bad[$e[2]] = $true }
    elseif ([long]$h[0] -ne [long]$e[1] -or $h[1] -ne $e[2]) { $bad[$e[2]] = $true; $bad[$h[1]] = $true; if ([long]$h[0] -gt [long]$e[1]) { $back++ } }
  }
  foreach ($g in $held.Keys) { if (-not $seen.ContainsKey($g)) { $bad[$held[$g][1]] = $true } }
  if ($back -gt 0 -and $St.phase -eq 'live') {
    # everything may differ: copied again the gentle way, a few days at a time; the old copy serves until each day is replaced
    Write-Log ('Keeping ' + $Company + ': Tally''s change numbers have gone back (a backup restored or the data rewritten?); copying the company again, gently')
    $St.phase = 'first'; $St.last = 0; $St.next = [string]$St.from; $St.slice = (Get-KeepNum 'KeepSliceDays' 1); $St.checkYm = ([string]$St.from).Substring(0, 6)
    return 0
  }
  if ($max -gt [long]$St.last -and $St.phase -ne 'live') { $St.last = $max }
  if ($bad.Count) { $null = Update-KeepDates $Company $Port $Dir $St @($bad.Keys); Write-Log ('Keeping ' + $Company + ': ' + $Ym + ' differed on ' + $bad.Count + ' date(s); read again') }
  return $bad.Count
}
# the opening balances, as FinCom reads them (balances.json), and on to the cloud
function Save-KeepOpening([string]$Company, [int]$Port, [string]$Dir, $St, $Rows, [string]$AsOn, [string]$Today) {
  $led = @($Rows | ForEach-Object { [ordered]@{ name = $_[0]; parent = $_[1]; open = $_[2]; close = '' } })
  $bal = [ordered]@{ ok = $true; company = $Company; from = $St.from; to = $Today; openAsOn = $AsOn; ledgers = $led; keep = $true }
  Save-KeepFile (Join-Path $Dir 'balances.json') ($bal | ConvertTo-Json -Depth 6 -Compress)
  Set-CloudLedgers $Dir
  $St.balAt = (Get-Date).ToString('s')
  $St.lastM = 0; Update-KeepLedgers $Company $Port $Dir $St $false        # the ledgers' own numbers, to follow renames and changes
  Write-Log ('Keeping ' + $Company + ': opening balances read (' + $led.Count + ' ledgers)')
}
# one turn for one open company: at most a few seconds of Tally's time, with pauses between reads
function Step-Keep([string]$Company, [int]$Port, [string]$BooksFrom) {
  $dir = Get-SyncFolder $Company
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $today = (Get-Date).ToString('yyyyMMdd')
  $st = Read-KeepState $dir
  if (-not $st -and (Get-KeepMode $Company) -ne 'bridge') {
    # 1.13.9: the year comes from the day book files chosen in FinCom; the bridge does not read it from Tally by itself
    $wf = Join-Path $dir 'waiting.txt'
    if (-not (Test-Path -LiteralPath $wf)) { try { [IO.File]::WriteAllText($wf, (Get-Date).ToString('s')) } catch { }; Write-Log ('Keeping ' + $Company + ' in step: waiting for the day book files from FinCom (Books, From Tally); Tally is not read for the year') }
    return
  }
  if (-not $st) {
    $from = (Get-FyStart (Get-Date)).ToString('yyyyMMdd')
    if ([string]$Cfg.KeepFrom -match '^\d{8}$') { $from = [string]$Cfg.KeepFrom }        # e.g. last year's start, for an audit
    if ($BooksFrom -and $BooksFrom -match '^\d{8}$' -and $BooksFrom -gt $from) { $from = $BooksFrom }
    $st = @{ company = $Company; from = $from; next = $from; slice = (Get-KeepNum 'KeepSliceDays' 1); phase = 'open'; openIdx = 0; last = 0; lastM = 0; checkYm = ''; months = @{}; cycle = 0; skipped = @(); dayFail = 0 }
    Write-Log ('Keeping ' + $Company + ' in step with FinCom: first copy from ' + $from)
  }
  # 1.13.5: the heavy work (the first copy of the year, its opening balances, the month-by-month check) only at a
  # quiet time: after office hours, or when nobody has used the computer for a while. In the day only changes are read
  $script:KeepCaughtUp = $false
  if ($st.phase -ne 'live' -and -not $script:KeepForce -and -not (Test-KeepQuiet)) {
    if (-not $st.waitNoted){ $st.waitNoted = $true; Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress); Write-Log ('Keeping ' + $Company + ': the first copy is made at a quiet time (after ' + (Get-KeepNum 'KeepOfficeTo' 19) + ':00, or when nobody has used this computer for ' + (Get-KeepNum 'KeepQuietMin' 10) + ' minutes), so Tally is not held up while you work') }
    return
  }
  $st.waitNoted = $false
  $st.cycle = [int]$st.cycle + 1
  $budget = Get-KeepNum 'KeepBudgetSec' 20
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $save = { $st.at = (Get-Date).ToString('s'); Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress); Write-KeepManifest $dir $st $today }

  if ($st.phase -eq 'open') {
    # opening balances on the day before the copy starts. Some Tallys work out every balance each time they are asked,
    # however few ledgers: then small groups only multiply the wait, so every balance is read once, at a quiet time
    # (evening, or nobody at the computer), and the day book copy goes on meanwhile
    $asOn = Add-KeepDays $st.from -1
    if ([string]$st.balMode -ne 'whole') {
      $names = @((Get-LedgerNames $Company $Port).ledgers | ForEach-Object { $_[0] } | Sort-Object)
      $pf = Join-Path $dir 'open-part.json'
      $got = @(); if ([int]$st.openIdx -gt 0 -and (Test-Path $pf)) { $got = @(Get-Content -Raw $pf | ConvertFrom-Json) }
      # the first read is of five ledgers, tried only when nobody has touched the computer for a minute
      $size = [int]$st.openSize; if ($size -le 0) { $size = 5 }
      $later = $false
      while ([int]$st.openIdx -lt $names.Count -and $sw.Elapsed.TotalSeconds -lt $budget -and (Test-KeepRoom $Port) -and -not (Get-KeepHold)) {
        if (-not $st.balMode -and (Get-KeepIdleSec) -lt (Get-KeepNum 'KeepProbeIdleSec' 60) -and -not (Test-KeepQuiet)) { $later = $true; break }
        $chunk = $names[[int]$st.openIdx .. ([Math]::Min($names.Count, [int]$st.openIdx + $size) - 1)]
        $t0 = $sw.Elapsed.TotalSeconds
        foreach ($r in (Get-KeepBalances $Company $Port $chunk $asOn)) { $got += , @($r[0], $r[1], $r[2]) }
        $st.openIdx = [int]$st.openIdx + $chunk.Count
        $took = $sw.Elapsed.TotalSeconds - $t0; $aim = Get-KeepTargetSec
        Save-KeepFile $pf (ConvertTo-Json -InputObject @($got) -Depth 4 -Compress)
        if ($took -gt $aim -and $chunk.Count -le 5) {
          $st.balMode = 'whole'
          Write-Log ('Keeping ' + $Company + ': Tally took ' + [Math]::Round($took, 1) + 's for the opening balance of ' + $chunk.Count + ' ledgers, so every opening balance will be read once at a quiet time (evening, or when nobody is at the computer); the day book copy goes on meanwhile')
          break
        }
        $st.balMode = 'chunk'
        if ($took -gt $aim) { $size = [int][Math]::Max(5, [Math]::Floor($size / 2)) } elseif ($took -lt $aim / 3) { $size = [int][Math]::Min(150, $size * 2) }
        $st.openSize = $size
        & $save
        Start-Sleep -Milliseconds ([int][Math]::Max(1000, $took * 1500))
      }
      if ($st.balMode -eq 'chunk' -and [int]$st.openIdx -ge $names.Count) {
        Save-KeepOpening $Company $Port $dir $st @($got) $asOn $today
        $st.phase = $(if ([string]$st.next -gt $today) { 'check' } else { 'first' })
      }
    }
    if ($later -and -not $st.balMode) { Write-Log ('Keeping ' + $Company + ': the opening balances will be read at a quiet time; the day book copy starts now') }
    if ($st.balMode -eq 'whole' -or ($later -and -not $st.balMode)) { $st.openPending = $true; $st.phase = $(if ([string]$st.next -gt $today) { 'check' } else { 'first' }) }
    & $save
    if ($st.phase -eq 'open') { return }
  }
  # every opening balance in one read, when it is a quiet time
  if ($st.openPending -and (Test-KeepQuiet) -and -not (Get-KeepHold) -and (Test-KeepRoom $Port)) {
    $asOn = Add-KeepDays $st.from -1
    Write-Log ('Keeping ' + $Company + ': reading every opening balance now (a quiet time)')
    $rows = @(Get-KeepBalances $Company $Port @() $asOn)
    Save-KeepOpening $Company $Port $dir $st $rows $asOn $today
    $st.openPending = $false
    & $save
    return
  }
  if ($st.phase -eq 'first') {
    # the year's day book, a few days at a time; smaller steps when Tally is slow, bigger when it is quick
    while ([string]$st.next -le $today -and $sw.Elapsed.TotalSeconds -lt $budget -and (Test-KeepRoom $Port) -and -not (Get-KeepHold)) {
      $f = [string]$st.next; $t = Add-KeepDays $f ([int]$st.slice - 1); if ($t -gt $today) { $t = $today }
      try { $r = Copy-KeepDays $Company $Port $dir $f $t }
      catch {
        $why = $_.Exception.Message
        if ([int]$st.slice -gt 1) { $st.slice = [int][Math]::Max(1, [Math]::Floor([int]$st.slice / 2)); & $save; throw ('Tally did not give ' + $f + '-' + $t + ' (' + $why + '); next time a smaller step') }
        $st.dayFail = [int]$st.dayFail + 1
        if ([int]$st.dayFail -ge 3) {
          Add-KeepSkipped $st $f; $st.next = Add-KeepDays $f 1; $st.dayFail = 0; & $save
          Write-Log ('Keeping ' + $Company + ': Tally could not give ' + $f + ' after 3 tries (' + $why + '); going on, and trying that day again later')
          return
        }
        & $save; throw ('Tally did not give ' + $f + ' (' + $why + '); try ' + $st.dayFail + ' of 3')
      }
      $st.dayFail = 0
      $sec = $r[0]
      $aim = Get-KeepTargetSec
      if ($sec -gt $aim -and [int]$st.slice -gt 1) { $st.slice = [int][Math]::Max(1, [Math]::Floor([int]$st.slice / 2)) }
      elseif ($sec -lt $aim / 3 -and [int]$st.slice -lt 31) { $st.slice = [int][Math]::Min(31, [int]$st.slice * 2) }
      $ymA = $f.Substring(0, 6); $ymB = $t.Substring(0, 6)
      Write-KeepMonth $dir $ymA $st; if ($ymB -ne $ymA) { Write-KeepMonth $dir $ymB $st }
      $st.next = Add-KeepDays $t 1
      & $save
      Start-Sleep -Milliseconds ([int][Math]::Max(2000, $sec * 1500))
    }
    if ([string]$st.next -gt $today) { $st.phase = 'check'; $st.checkYm = $st.from.Substring(0, 6); Write-Log ('Keeping ' + $Company + ': first copy done; checking it month by month') }
    $st.trouble = $null; & $save
    return
  }
  # a new day: the days since the last turn
  if ([string]$st.next -le $today) { $null = Update-KeepDates $Company $Port $dir $st @(Get-KeepDayRange ([string]$st.next) $today); $st.next = Add-KeepDays $today 1 }
  # Tally's own change counters first: when neither has moved since the last turn, nothing changed in the company
  $cn = @{ ok = $false }
  if ($st.phase -eq 'live') { try { $cn = Get-KeepCounters $Company $Port } catch { $cn = @{ ok = $false } } }
  $quiet = $cn.ok -and $null -ne $st.cv -and [long]$st.cv -eq $cn.v -and [long]$st.cm -eq $cn.m
  if ($cn.ok -and $null -ne $st.cv -and [long]$cn.v -lt [long]$st.cv) {
    # the counter went back: a backup restored or the data rewritten. Copied again, gently; the old copy serves meanwhile
    Write-Log ('Keeping ' + $Company + ': Tally''s change numbers have gone back (a backup restored or the data rewritten?); copying the company again, gently')
    $st.phase = 'first'; $st.last = 0; $st.next = [string]$st.from; $st.slice = (Get-KeepNum 'KeepSliceDays' 1); $st.checkYm = ([string]$st.from).Substring(0, 6); $st.cv = $null; $st.cm = $null
    & $save; return
  }
  $st.counters = [bool]$cn.ok
  # entries changed since the last change number seen: their dates now, and where the copy had them before.
  # Recent months every turn; the whole period only when the counter says something changed that they did not explain
  # (or, without counters, every few turns)
  $ch = @()
  if ($st.phase -eq 'live' -and [long]$st.last -gt 0 -and -not $quiet) {
    $rf = (Get-Date).AddMonths(-2).ToString('yyyyMM') + '01'; if ($rf -lt [string]$st.from) { $rf = [string]$st.from }
    $ch = Get-KeepList $Company $Port $rf $today ([long]$st.last)
    $wide = $false
    if ($cn.ok) { $mx = [long]$st.last; foreach ($c in $ch) { if ([long]$c[1] -gt $mx) { $mx = [long]$c[1] } }; $wide = $mx -lt $cn.v -and $rf -gt [string]$st.from }
    elseif ($rf -gt [string]$st.from -and ([int]$st.cycle % (Get-KeepNum 'KeepCheckEvery' 5)) -eq 0) { $wide = $true }
    if ($wide -and (Test-KeepRoom $Port)) { $ch = Get-KeepList $Company $Port ([string]$st.from) $today ([long]$st.last) }
    if ($ch.Count) {
      $where = Get-KeepWhere $dir
      $dates = @($ch | ForEach-Object { $_[2] })
      foreach ($c in $ch) { $o = $where[$c[0]]; if ($o -and $o -ne $c[2]) { $dates += $o } }
      $dates = @($dates | Sort-Object -Unique)
      $null = Update-KeepDates $Company $Port $dir $st $dates
      $st.last = [long](($ch | ForEach-Object { $_[1] } | Measure-Object -Maximum).Maximum)
      Write-Log ('Keeping ' + $Company + ': ' + $ch.Count + ' changed entries on ' + $dates.Count + ' dates brought in')
    }
    # the counter moved but no entry has a newer change number: most likely an entry was deleted. Recent months are
    # compared with Tally's list now; older ones in their turn
    if ($cn.ok -and -not $ch.Count -and [long]$cn.v -ne [long]$st.cv -and $null -ne $st.cv) {
      foreach ($ym in @($today.Substring(0, 6), (Get-Date).AddMonths(-1).ToString('yyyyMM'))) {
        if ($ym -ge ([string]$st.from).Substring(0, 6) -and (Test-KeepRoom $Port)) { $null = Test-KeepMonthFix $Company $Port $dir $st $ym $today }
      }
    }
  }
  # 1.14.0: nothing changed since the last look (or nothing new came in): this company is up to date for today's run
  # 1.14.3: in the daily update, every month is also compared with Tally's list once (deleted entries leave no change
  # number): the company is up to date only when a whole round of months has been checked today
  if ($st.phase -eq 'live' -and ($quiet -or -not @($ch).Count) -and (-not $script:KeepOnce -or ([string]$st.roundFrom -eq $today -and [string]$st.roundAt -eq $today))) { $script:KeepCaughtUp = $true }
  # ledger masters changed since the last look
  if ($st.phase -eq 'live' -and $sw.Elapsed.TotalSeconds -lt $budget -and -not ($cn.ok -and $null -ne $st.cm -and [long]$st.cm -eq $cn.m)) { Update-KeepLedgers $Company $Port $dir $st $false }
  if ($cn.ok) { $st.cv = $cn.v; $st.cm = $cn.m }
  # a month FinCom asked to be checked, now
  $rq = Join-Path $dir 'recheck.txt'
  if ((Test-Path -LiteralPath $rq) -and $sw.Elapsed.TotalSeconds -lt $budget) {
    $want = ([IO.File]::ReadAllText($rq)).Trim(); [IO.File]::WriteAllText($rq, '')
    if ($want -match '^\d{6}$') { $null = Test-KeepMonthFix $Company $Port $dir $st $want $today }
  }
  # deleted entries leave no change number, so months are compared with Tally's list: this month often, the others in turn
  $every = $(if ($st.phase -eq 'check') { 1 } else { Get-KeepNum 'KeepCheckEvery' 5 })
  $nowEvery = Get-KeepNum 'KeepNowEvery' 2
  if ($quiet) { $every = $every * 3; $nowEvery = $nowEvery * 3 }       # nothing changed: look less often
  if ($script:KeepOnce) { $every = 1 }                                  # the daily update: a month every turn
  if ($sw.Elapsed.TotalSeconds -lt $budget -and (Test-KeepRoom $Port)) {
    if (([int]$st.cycle % $every) -eq 0) {
      $ym = [string]$st.checkYm; if (-not $ym) { $ym = $st.from.Substring(0, 6) }
      if ($ym -eq $st.from.Substring(0, 6)) { $st.roundFrom = $today }
      $null = Test-KeepMonthFix $Company $Port $dir $st $ym $today
      if ($st.checkYm -eq $ym) {
        $nx = (ConvertFrom-TallyDate ($ym + '01')).AddMonths(1).ToString('yyyyMM')
        if ($nx -gt $today.Substring(0, 6)) {
          $nx = $st.from.Substring(0, 6)
          if ([string]$st.roundFrom -eq $today) { $st.roundAt = $today }
          if ($st.phase -eq 'check') { $st.phase = 'live'; Write-Log ('Keeping ' + $Company + ': in step with Tally') }
          if ($st.phase -eq 'live' -and $sw.Elapsed.TotalSeconds -lt $budget) { Update-KeepLedgers $Company $Port $dir $st $true }   # once a round: ledgers no longer in Tally
        }
        $st.checkYm = $nx
      }
    } elseif ($st.phase -eq 'live' -and ([int]$st.cycle % $nowEvery) -eq 0) {
      $null = Test-KeepMonthFix $Company $Port $dir $st $today.Substring(0, 6) $today
    }
  }
  # days Tally could not give before: one more try now and then
  if ($st.phase -eq 'live' -and @($st.skipped | Where-Object { $_ }).Count -and ([int]$st.cycle % $every) -eq 1 -and $sw.Elapsed.TotalSeconds -lt $budget) {
    $d = @($st.skipped | Where-Object { $_ })[0]
    $null = Update-KeepDates $Company $Port $dir $st @($d)
    if (-not (@($st.skipped) -contains $d)) { Write-Log ('Keeping ' + $Company + ': ' + $d + ' read now') }
  }
  $st.trouble = $null
  & $save
}
function Get-KeepDayRange([string]$a, [string]$b) { $o = @(); $d = $a; while ($d -le $b) { $o += $d; $d = Add-KeepDays $d 1 }; return $o }
# a turn that went wrong: noted for FinCom to show, and that company left alone for a while (longer each time)
$script:KeepBack = @{}
function Set-KeepTrouble([string]$Company, [string]$Why) {
  try {
    $dir = Get-SyncFolder $Company; $st = Read-KeepState $dir
    if ($st) { $st.trouble = [ordered]@{ at = (Get-Date).ToString('s'); why = $Why }; Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress); Write-KeepManifest $dir $st ((Get-Date).ToString('yyyyMMdd')) }
  } catch { }
}
# the worker runs for hours: settings changed meanwhile (keeping in step switched off, this computer connected to
# FinCom's cloud) are read again from the settings file when it changes
$script:CfgStamp = $null
function Sync-WorkerConfig {
  try {
    $t = (Get-Item -LiteralPath $ConfigPath -ErrorAction Stop).LastWriteTimeUtc
    if ($script:CfgStamp -eq $t) { return }
    $script:CfgStamp = $t
    $o = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    foreach ($p in $o.PSObject.Properties) {
      if ($Cfg.PSObject.Properties[$p.Name]) { $Cfg.($p.Name) = $p.Value } else { $Cfg | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force }
    }
  } catch { }
}
function Invoke-KeepWorker {
  $lock = Join-Path (Get-SyncDir) 'keep.pid'
  New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null
  [IO.File]::WriteAllText($lock, [string]$PID)
  [IO.File]::WriteAllText((Join-Path (Get-SyncDir) 'keep.ver'), [string]$BridgeVersion)     # a bridge of another version stops this one
  Write-Log ('Keeping copies in step: started (' + $BridgeVersion + ')')
  $script:KeepReadSec = Get-KeepNum 'KeepReadSec' 120      # no read of the day book may hold Tally longer than this
  $idle = Get-Date
  # the bridge that started this worker: when it is gone (Quit, an update, a restart), the worker stops too
  $parent = 0
  try { $parent = [int](Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID) -ErrorAction Stop).ParentProcessId } catch { try { $parent = [int](Get-Process -Id $PID).Parent.Id } catch { $parent = 0 } }
  $held = ''
  $script:IsCopier = $true
  $due = Test-KeepDue; $once = $due -eq 'daily' -or $due -eq 'now'
  $script:KeepForce = $due -eq 'now'
  $script:KeepOnce = $once
  $runEnd = (Get-Date).AddMinutes((Get-KeepNum 'KeepRunMin' 30)); $upToDate = @{}
  if ($once) { Write-Log ('Update from Tally: ' + $(if ($due -eq 'now') { 'asked for now' } else { 'the daily update (' + (Get-KeepDailyAt) + ')' })) }
  try {
    Sync-WorkerConfig
    while ($(Sync-WorkerConfig; Test-KeepOn)) {
      if ($parent -and -not (Test-ProcessAlive $parent)) { Write-Log 'Keeping copies in step: the bridge has stopped, so this stops too'; break }
      if ($once -and (Get-Date) -gt $runEnd) { Write-Log 'Update from Tally: time is up for today; the rest follows at the next update'; break }
      $hold = Get-KeepHold
      if ($hold) {
        if ($hold -ne $held) { Write-Log ('Keeping copies in step: waiting, ' + $hold) }
        $held = $hold; $idle = Get-Date; Start-Sleep -Seconds 5; continue
      }
      $held = ''
      $busy = $false; try { $busy = @(Get-ActiveJobs).Count -gt 0 } catch { }
      $open = @()
      if (-not $busy) {
        foreach ($s in @(Get-OpenCompanies)) {
          if ($s.skipped -or -not $s.ok) { continue }
          foreach ($c in $s.companies) {
            $want = @($Cfg.KeepCompanies | Where-Object { $_ })
            if ($want.Count -and -not ($want -contains $c.name)) { continue }
            $open += , @($c.name, [int]$s.port, [string]$c.from)
          }
        }
      }
      if ($once -and $open.Count -and -not @($open | Where-Object { -not $upToDate[$_[0]] }).Count) {
        Write-Log 'Update from Tally: every open company is up to date'
        break
      }
      if (-not $open.Count) {
        if ($once -and -not $busy) { Write-Log 'Update from Tally: no company is open in Tally; tried again at the next update'; break }
        $waiting = 0; try { $waiting = Invoke-CloudPush } catch { }
        if (((Get-Date) - $idle).TotalMinutes -ge (Get-KeepNum 'KeepIdleMin' 10) -and ($waiting -eq 0 -or ((Get-Date) - $idle).TotalMinutes -ge 60)) { break }
        Start-Sleep -Seconds 20; continue
      }
      $idle = Get-Date
      foreach ($o in $open) {
        $bk = $script:KeepBack[$o[0]]
        if ($bk -and (Get-Date) -lt $bk.until) { continue }
        if (-not (Test-KeepRoom ([int]$o[1]))) { continue }             # this Tally has had its share this minute
        if (Get-KeepHold) { break }
        $script:KeepLong = 0.0
        $rested = { param($name)
          if ($script:KeepLong -gt (Get-KeepNum 'KeepTooLongSec' 20)) {
            $rest = [int][Math]::Min(1800, $script:KeepLong * 10)
            $script:KeepBack[$name] = @{ n = $(if ($script:KeepBack[$name]) { [int]$script:KeepBack[$name].n } else { 0 }); until = (Get-Date).AddSeconds($rest) }
            Write-Log ('Keeping ' + $name + ': one read took ' + [int]$script:KeepLong + 's, so Tally is left alone for ' + [Math]::Max(1, [int]($rest / 60)) + ' min to stay usable; the next reads will be smaller')
          }
        }
        if ($upToDate[$o[0]]) { continue }
        try { Step-Keep $o[0] $o[1] $o[2]; $script:KeepBack.Remove($o[0]); & $rested $o[0]; if ($once -and $script:KeepCaughtUp) { $upToDate[$o[0]] = $true } }
        catch {
          $n = $(if ($bk) { [int]$bk.n + 1 } else { 1 })
          $wait = [Math]::Min(1800, (Get-KeepNum 'KeepCycleSec' 60) * [Math]::Pow(2, $n))
          $script:KeepBack[$o[0]] = @{ n = $n; until = (Get-Date).AddSeconds($wait) }
          Write-Log ('Keeping ' + $o[0] + ' in step: ' + $_.Exception.Message + ' - leaving Tally alone for ' + [int]$wait + 's')
          Set-KeepTrouble $o[0] $_.Exception.Message
          & $rested $o[0]
        }
      }
      Write-KeepLoad
      try { $null = Invoke-CloudPush } catch { Write-Log ('Cloud: ' + $_.Exception.Message) }
      Start-Sleep -Seconds $(if ($once) { [Math]::Min(5, (Get-KeepNum 'KeepCycleSec' 60)) } else { Get-KeepNum 'KeepCycleSec' 60 })
    }
    if ($once) {
      # what came in goes on to the cloud before this stops (a few minutes at most)
      $until = (Get-Date).AddMinutes(10)
      while ((Get-Date) -lt $until) { $w = 0; try { $w = Invoke-CloudPush } catch { }; if (-not $w) { break }; Start-Sleep -Seconds 10 }
      [IO.File]::WriteAllText((Join-Path (Get-SyncDir) 'keep-lastrun.txt'), (Get-Date).ToString('yyyyMMdd'))
      Remove-Item -LiteralPath (Join-Path (Get-SyncDir) 'keep-now.txt') -Force -ErrorAction SilentlyContinue
      Write-Log ('Update from Tally: done; the next one at ' + (Get-KeepDailyAt) + ', or when someone presses Update now')
    }
  } finally { try { if ([IO.File]::ReadAllText($lock) -eq [string]$PID) { [IO.File]::WriteAllText($lock, '') } } catch { } ; Write-Log 'Keeping copies in step: stopped' }
}
# from the bridge, once a minute: a worker runs while a company is open
function Start-KeepIfNeeded {
  if (-not (Test-KeepOn)) { return }
  $lock = Join-Path (Get-SyncDir) 'keep.pid'
  if (Test-Path $lock) {
    $p = 0; try { $p = [int]('0' + [IO.File]::ReadAllText($lock).Trim()) } catch { }
    if ($p -and (Test-ProcessAlive $p)) {
      $ver = ''; try { $ver = [IO.File]::ReadAllText((Join-Path (Get-SyncDir) 'keep.ver')).Trim() } catch { }
      if ($ver -eq [string]$BridgeVersion) { return }
      # a copier from an older bridge (an update does not stop it by itself): stopped, and this version's started
      try { $pr = Get-Process -Id $p -ErrorAction Stop; if ($pr.ProcessName -match 'powershell|pwsh') { Write-Log ('Stopping the copier of bridge ' + $(if ($ver) { $ver } else { 'before 1.13.2' }) + ' (process ' + $p + ')'); $pr.Kill(); $null = $pr.WaitForExit(5000) } else { return } } catch { }
    }
  }
  # 1.14.0: Tally is not asked here. The copier starts only when its run is due (once a day, or Update now); in the
  # 'continuous' schedule, when Tally's port takes connections
  $due = Test-KeepDue
  if (-not $due) { return }
  if ($due -eq 'continuous') { $any = $false; foreach ($pp in @((Get-PortPlan).ports)) { if (Test-TallyPortOpen ([int]$pp.port)) { $any = $true } }; if (-not $any) { return } }
  $exe = (Get-Process -Id $PID).Path
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -ConfigPath "' + $ConfigPath + '" -Keep'
  # not through the shell: that fails from the bridge's hidden window ("Unknown error (0xffffffff)"). The bridge's
  # port is kept from this worker another way (made non-inheritable when the bridge starts)
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $pr = [Diagnostics.Process]::Start($psi)
  New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null
  [IO.File]::WriteAllText($lock, [string]$pr.Id)
}
# FinCom's view: each company's copy, and whether the worker is running
function Get-KeepStatus([string]$Company) {
  $lock = Join-Path (Get-SyncDir) 'keep.pid'; $p = 0
  if (Test-Path $lock) { try { $p = [int]('0' + [IO.File]::ReadAllText($lock).Trim()) } catch { } }
  $st = $null; if ($Company) { $st = Read-KeepState (Get-SyncFolder $Company) }
  $load = $null; try { $lf = Join-Path (Get-SyncDir) 'keep-load.json'; if (Test-Path $lf) { $load = Get-Content -Raw $lf | ConvertFrom-Json } } catch { }
  $cloud = $null; try { $cloud = Get-CloudLinkStatus } catch { }
  return [ordered]@{ ok = $true; on = (Test-KeepOn); running = [bool]($p -and (Test-ProcessAlive $p)); load = $load; cloud = $cloud; phase = $(if ($st) { $st.phase } else { '' }); next = $(if ($st) { $st.next } else { '' }); from = $(if ($st) { $st.from } else { '' }); at = $(if ($st) { $st.at } else { '' });
    schedule = (Get-KeepSchedule); dailyAt = (Get-KeepDailyAt); lastRun = (Get-KeepLastRun); now = [bool](Test-Path -LiteralPath (Join-Path (Get-SyncDir) 'keep-now.txt'));
    mode = $(if ($Company) { Get-KeepMode $Company } else { '' }); seeded = [bool]($st -and $st.seeded); openPending = [bool]($st -and $st.openPending); balances = [bool]($st -and $st.balAt) }
}
# the check: one month of the copy against Tally's own list of entries
function Test-KeepMonth([string]$Company, [string]$Ym, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $dir = Get-SyncFolder $Company
  $today = (Get-Date).ToString('yyyyMMdd')
  $mf = $Ym + '01'; $mt = (ConvertFrom-TallyDate $mf).AddMonths(1).AddDays(-1).ToString('yyyyMMdd'); if ($mt -gt $today) { $mt = $today }
  $tl = Get-KeepList $Company $port $mf $mt 0
  $held = Get-KeepHeld $dir $Ym
  $missing = 0; $differ = 0; $seen = @{}
  foreach ($e in $tl) { $seen[$e[0]] = $true; $h = $held[$e[0]]; if (-not $h) { $missing++ } elseif ([long]$h[0] -ne [long]$e[1]) { $differ++ } }
  $extra = @($held.Keys | Where-Object { -not $seen.ContainsKey($_) }).Count
  $fixing = $false
  if ($missing -or $differ -or $extra) { try { [IO.File]::WriteAllText((Join-Path $dir 'recheck.txt'), $Ym); $fixing = $true } catch { } }   # the worker reads those dates again on its next turn
  # the light list against the day book for the first three days: the same entries both ways
  $d3 = Add-KeepDays $mf 2; if ($d3 -gt $mt) { $d3 = $mt }
  $dbx = Get-DayBookXml $Company $mf $d3 $port
  $dbG = @{}; foreach ($m in [regex]::Matches($dbx, '<VOUCHER\b[\s\S]*?</VOUCHER>')) { $g = [regex]::Match($m.Value, '<GUID>([^<]*)</GUID>').Groups[1].Value.Trim(); if ($g) { $dbG[$g] = $true } }
  $lsG = @{}; foreach ($e in $tl) { if ($e[2] -le $d3) { $lsG[$e[0]] = $true } }
  $same = ($dbG.Count -eq $lsG.Count) -and -not @($dbG.Keys | Where-Object { -not $lsG.ContainsKey($_) }).Count
  return [ordered]@{ ok = $true; ym = $Ym; tally = $tl.Count; copy = $held.Count; missing = $missing; differ = $differ; extra = $extra; firstDays = $d3; dayBook = $dbG.Count; list = $lsG.Count; listMatchesDayBook = $same; fixing = $fixing }
}
