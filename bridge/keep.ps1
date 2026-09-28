
# ------------------------------------------------------------------ 1.12.12: keep FinCom's copy of each company in step with Tally
# A worker of its own (TDSBridge.ps1 -Keep), started by the bridge while any company is open in your Tally, and stopping
# ten minutes after the last one is closed. For each open company it:
#   1. reads the opening balances once, in small groups of ledgers (never every ledger at once);
#   2. copies the year's day book a few days at a time, pausing between reads and taking smaller steps when Tally is slow,
#      carrying on where it stopped the next time the company is open;
#   3. then asks only what changed: the entries with a change number (ALTERID) above the last one seen, and re-reads just
#      those dates; and, one month at a time, compares the list of entries with Tally's, which also finds deleted ones.
# Only the day book (the format FinCom already reads) and light lists (numbers, no amounts) are asked for.
function Save-Config { try { ($Cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $ConfigPath -Encoding UTF8 } catch { Write-Log ('Could not save the settings: ' + $_.Exception.Message) } }
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
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepBal</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $AsOn + '</SVFROMDATE><SVTODATE>' + $AsOn + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskKeepBal" ISMODIFY="No"><TYPE>Ledger</TYPE><FILTERS>TDSDeskKeepThese</FILTERS><FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH></COLLECTION>' +
    '<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepThese">' + (Esc $f) + '</SYSTEM>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req -TimeoutSec 120)
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
  $by = @{}
  foreach ($m in [regex]::Matches($xml, '<VOUCHER\b[\s\S]*?</VOUCHER>')) {
    $d = [regex]::Match($m.Value, '<DATE>(\d{8})</DATE>').Groups[1].Value
    if (-not $d) { continue }
    if (-not $by.ContainsKey($d)) { $by[$d] = New-Object Text.StringBuilder }
    $null = $by[$d].Append('<TALLYMESSAGE>').Append($m.Value).Append('</TALLYMESSAGE>')
  }
  $days = Join-Path $Dir 'days'; New-Item -ItemType Directory -Force -Path $days | Out-Null
  $d = $From; $n = 0
  while ($d -le $To) {
    $t = ''; if ($by.ContainsKey($d)) { $t = $by[$d].ToString(); $n += [regex]::Matches($t, '<VOUCHER\b').Count }
    Save-KeepFile (Join-Path $days ($d + '.xml')) $t
    $d = Add-KeepDays $d 1
  }
  return @($sec, $n)
}
# the entries kept for a month: guid -> [change number, date]
function Get-KeepHeld([string]$Dir, [string]$Ym) {
  $h = @{}
  $days = Join-Path $Dir 'days'
  if (-not (Test-Path $days)) { return $h }
  foreach ($f in (Get-ChildItem -LiteralPath $days -Filter ($Ym + '*.xml'))) {
    $t = [IO.File]::ReadAllText($f.FullName)
    foreach ($m in [regex]::Matches($t, '<VOUCHER\b[\s\S]*?</VOUCHER>')) {
      $g = [regex]::Match($m.Value, '<GUID>([^<]*)</GUID>').Groups[1].Value.Trim()
      $a = [regex]::Match($m.Value, '<ALTERID>\s*(\d+)').Groups[1].Value
      if ($g) { $h[$g] = @([long]('0' + $a), $f.BaseName) }
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
    phase = $St.phase; doneTo = $doneTo; seen = (Get-Date).ToString('s'); months = $months; balancesAt = $St.balAt; bridge = $BridgeVersion }
  Save-KeepFile (Join-Path $Dir 'manifest.json') ($man | ConvertTo-Json -Depth 6 -Compress)
}
# re-read some dates (changed or found different), a few at a time
function Update-KeepDates([string]$Company, [int]$Port, [string]$Dir, $St, [string[]]$Dates) {
  $touched = @{}
  $list = @($Dates | Sort-Object -Unique)
  $i = 0
  while ($i -lt $list.Count) {
    $a = $list[$i]; $b = $a
    while ($i + 1 -lt $list.Count -and $list[$i + 1] -eq (Add-KeepDays $b 1) -and ((ConvertFrom-TallyDate $list[$i + 1]) - (ConvertFrom-TallyDate $a)).TotalDays -lt 7) { $i++; $b = $list[$i] }
    $r = Copy-KeepDays $Company $Port $Dir $a $b
    $touched[$a.Substring(0, 6)] = $true; $touched[$b.Substring(0, 6)] = $true
    Start-Sleep -Milliseconds ([int][Math]::Max(1000, $r[0] * 1500))
    $i++
  }
  foreach ($ym in $touched.Keys) { Write-KeepMonth $Dir $ym $St }
  return $touched.Count
}
# one turn for one open company: at most a few seconds of Tally's time, with pauses between reads
function Step-Keep([string]$Company, [int]$Port, [string]$BooksFrom) {
  $dir = Get-SyncFolder $Company
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $today = (Get-Date).ToString('yyyyMMdd')
  $st = Read-KeepState $dir
  if (-not $st) {
    $from = (Get-FyStart (Get-Date)).ToString('yyyyMMdd')
    if ([string]$Cfg.KeepFrom -match '^\d{8}$') { $from = [string]$Cfg.KeepFrom }        # e.g. last year's start, for an audit
    if ($BooksFrom -and $BooksFrom -match '^\d{8}$' -and $BooksFrom -gt $from) { $from = $BooksFrom }
    $st = @{ company = $Company; from = $from; next = $from; slice = (Get-KeepNum 'KeepSliceDays' 3); phase = 'open'; openIdx = 0; last = 0; checkYm = ''; checkRound = 0; months = @{}; cycle = 0 }
    Write-Log ('Keeping ' + $Company + ' in step with FinCom: first copy from ' + $from)
  }
  $st.cycle = [int]$st.cycle + 1
  $budget = Get-KeepNum 'KeepBudgetSec' 20
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $save = { $st.at = (Get-Date).ToString('s'); Save-KeepFile (Join-Path $dir 'keep.json') ($st | ConvertTo-Json -Depth 6 -Compress); Write-KeepManifest $dir $st $today }

  if ($st.phase -eq 'open') {
    # opening balances on the day before the copy starts, 150 ledgers at a time
    $names = @((Get-LedgerNames $Company $Port).ledgers | ForEach-Object { $_[0] } | Sort-Object)
    $asOn = Add-KeepDays $st.from -1
    $pf = Join-Path $dir 'open-part.json'
    $got = @(); if ([int]$st.openIdx -gt 0 -and (Test-Path $pf)) { $got = @(Get-Content -Raw $pf | ConvertFrom-Json) }
    $size = 150
    while ([int]$st.openIdx -lt $names.Count -and $sw.Elapsed.TotalSeconds -lt $budget) {
      $chunk = $names[[int]$st.openIdx .. ([Math]::Min($names.Count, [int]$st.openIdx + $size) - 1)]
      $t0 = $sw.Elapsed.TotalSeconds
      foreach ($r in (Get-KeepBalances $Company $Port $chunk $asOn)) { $got += , @($r[0], $r[1], $r[2]) }
      $st.openIdx = [int]$st.openIdx + $chunk.Count
      Start-Sleep -Milliseconds ([int][Math]::Max(1000, ($sw.Elapsed.TotalSeconds - $t0) * 1500))
    }
    Save-KeepFile $pf (ConvertTo-Json -InputObject @($got) -Depth 4 -Compress)
    if ([int]$st.openIdx -ge $names.Count) {
      $led = @($got | ForEach-Object { [ordered]@{ name = $_[0]; parent = $_[1]; open = $_[2]; close = '' } })
      $bal = [ordered]@{ ok = $true; company = $Company; from = $st.from; to = $today; openAsOn = $asOn; ledgers = $led; keep = $true }
      Save-KeepFile (Join-Path $dir 'balances.json') ($bal | ConvertTo-Json -Depth 6 -Compress)
      $st.balAt = (Get-Date).ToString('s')
      $st.phase = $(if ([string]$st.next -gt $today) { 'check' } else { 'first' })
      Write-Log ('Keeping ' + $Company + ': opening balances read (' + $led.Count + ' ledgers)')
    }
    & $save
    if ($st.phase -eq 'open') { return }
  }
  if ($st.phase -eq 'first') {
    # the year's day book, a few days at a time; smaller steps when Tally is slow, bigger when it is quick
    while ([string]$st.next -le $today -and $sw.Elapsed.TotalSeconds -lt $budget) {
      $f = [string]$st.next; $t = Add-KeepDays $f ([int]$st.slice - 1); if ($t -gt $today) { $t = $today }
      $r = Copy-KeepDays $Company $Port $dir $f $t
      $sec = $r[0]
      if ($sec -gt 8 -and [int]$st.slice -gt 1) { $st.slice = [int][Math]::Max(1, [int]$st.slice / 2) }
      elseif ($sec -lt 2 -and [int]$st.slice -lt 31) { $st.slice = [int][Math]::Min(31, [int]$st.slice * 2) }
      $ymA = $f.Substring(0, 6); $ymB = $t.Substring(0, 6)
      Write-KeepMonth $dir $ymA $st; if ($ymB -ne $ymA) { Write-KeepMonth $dir $ymB $st }
      $st.next = Add-KeepDays $t 1
      & $save
      Start-Sleep -Milliseconds ([int][Math]::Max(2000, $sec * 1500))
    }
    if ([string]$st.next -gt $today) { $st.phase = 'check'; $st.checkYm = $st.from.Substring(0, 6); Write-Log ('Keeping ' + $Company + ': first copy done; checking it month by month') }
    & $save
    return
  }
  # a new day: the days since the last turn
  if ([string]$st.next -le $today) { $r = Copy-KeepDays $Company $Port $dir ([string]$st.next) $today; Write-KeepMonth $dir $today.Substring(0, 6) $st; if (([string]$st.next).Substring(0, 6) -ne $today.Substring(0, 6)) { Write-KeepMonth $dir ([string]$st.next).Substring(0, 6) $st }; $st.next = Add-KeepDays $today 1 }
  # what changed since the last change number seen
  if ($st.phase -eq 'live' -and [long]$st.last -gt 0) {
    $ch = Get-KeepList $Company $Port ([string]$st.from) $today ([long]$st.last)
    if ($ch.Count) {
      $dates = @($ch | ForEach-Object { $_[2] } | Sort-Object -Unique)
      $n = Update-KeepDates $Company $Port $dir $st $dates
      $st.last = [long](($ch | ForEach-Object { $_[1] } | Measure-Object -Maximum).Maximum)
      Write-Log ('Keeping ' + $Company + ': ' + $ch.Count + ' changed entries on ' + $dates.Count + ' dates brought in')
    }
  }
  # one month compared with Tally's list: finds deleted entries, and anything the change numbers missed
  $every = $(if ($st.phase -eq 'check') { 1 } else { Get-KeepNum 'KeepCheckEvery' 5 })
  if (([int]$st.cycle % $every) -eq 0 -and $sw.Elapsed.TotalSeconds -lt $budget) {
    $ym = [string]$st.checkYm; if (-not $ym) { $ym = $st.from.Substring(0, 6) }
    $mf = $ym + '01'; if ($mf -lt $st.from) { $mf = $st.from }
    $mt = (ConvertFrom-TallyDate ($ym + '01')).AddMonths(1).AddDays(-1).ToString('yyyyMMdd'); if ($mt -gt $today) { $mt = $today }
    $tl = Get-KeepList $Company $Port $mf $mt 0
    $held = Get-KeepHeld $dir $ym
    $bad = @{}
    $seen = @{}
    foreach ($e in $tl) {
      $seen[$e[0]] = $true
      if ([long]$e[1] -gt [long]$st.last) { $st.last = [long]$e[1] }
      $h = $held[$e[0]]
      if (-not $h) { $bad[$e[2]] = $true }
      elseif ([long]$h[0] -ne [long]$e[1] -or $h[1] -ne $e[2]) { $bad[$e[2]] = $true; $bad[$h[1]] = $true }
    }
    foreach ($g in $held.Keys) { if (-not $seen.ContainsKey($g)) { $bad[$held[$g][1]] = $true } }
    if ($bad.Count) { $null = Update-KeepDates $Company $Port $dir $st @($bad.Keys); Write-Log ('Keeping ' + $Company + ': ' + $ym + ' differed on ' + $bad.Count + ' dates; read again') }
    $nx = (ConvertFrom-TallyDate ($ym + '01')).AddMonths(1).ToString('yyyyMM')
    if ($nx -gt $today.Substring(0, 6)) { $nx = $st.from.Substring(0, 6); if ($st.phase -eq 'check') { $st.phase = 'live'; Write-Log ('Keeping ' + $Company + ': in step with Tally') } }
    $st.checkYm = $nx
  }
  & $save
}
function Invoke-KeepWorker {
  $lock = Join-Path (Get-SyncDir) 'keep.pid'
  New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null
  [IO.File]::WriteAllText($lock, [string]$PID)
  Write-Log 'Keeping copies in step: started'
  $idle = Get-Date
  try {
    while (Test-KeepOn) {
      $busy = $false; try { $busy = @(Get-ActiveJobs).Count -gt 0 } catch { }
      $open = @()
      if (-not $busy) {
        foreach ($s in @(Get-OpenCompanies -Fresh)) {
          if ($s.skipped -or -not $s.ok) { continue }
          foreach ($c in $s.companies) {
            $want = @($Cfg.KeepCompanies | Where-Object { $_ })
            if ($want.Count -and -not ($want -contains $c.name)) { continue }
            $open += , @($c.name, [int]$s.port, [string]$c.from)
          }
        }
      }
      if (-not $open.Count) { if (((Get-Date) - $idle).TotalMinutes -ge (Get-KeepNum 'KeepIdleMin' 10)) { break }; Start-Sleep -Seconds 20; continue }
      $idle = Get-Date
      foreach ($o in $open) { try { Step-Keep $o[0] $o[1] $o[2] } catch { Write-Log ('Keeping ' + $o[0] + ' in step: ' + $_.Exception.Message) } }
      Start-Sleep -Seconds (Get-KeepNum 'KeepCycleSec' 60)
    }
  } finally { try { if ([IO.File]::ReadAllText($lock) -eq [string]$PID) { [IO.File]::WriteAllText($lock, '') } } catch { } ; Write-Log 'Keeping copies in step: stopped' }
}
# from the bridge, once a minute: a worker runs while a company is open
function Start-KeepIfNeeded {
  if (-not (Test-KeepOn)) { return }
  $lock = Join-Path (Get-SyncDir) 'keep.pid'
  if (Test-Path $lock) { $p = 0; try { $p = [int]('0' + [IO.File]::ReadAllText($lock).Trim()) } catch { }; if ($p -and (Test-ProcessAlive $p)) { return } }
  $any = $false
  try { foreach ($s in @(Get-OpenCompanies)) { if (-not $s.skipped -and $s.ok -and @($s.companies).Count) { $any = $true } } } catch { }
  if (-not $any) { return }
  $exe = (Get-Process -Id $PID).Path
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -ConfigPath "' + $ConfigPath + '" -Keep'
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
  return [ordered]@{ ok = $true; on = (Test-KeepOn); running = [bool]($p -and (Test-ProcessAlive $p)); phase = $(if ($st) { $st.phase } else { '' }); next = $(if ($st) { $st.next } else { '' }); from = $(if ($st) { $st.from } else { '' }); at = $(if ($st) { $st.at } else { '' }) }
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
  # the light list against the day book for the first three days: the same entries both ways
  $d3 = Add-KeepDays $mf 2; if ($d3 -gt $mt) { $d3 = $mt }
  $dbx = Get-DayBookXml $Company $mf $d3 $port
  $dbG = @{}; foreach ($m in [regex]::Matches($dbx, '<VOUCHER\b[\s\S]*?</VOUCHER>')) { $g = [regex]::Match($m.Value, '<GUID>([^<]*)</GUID>').Groups[1].Value.Trim(); if ($g) { $dbG[$g] = $true } }
  $lsG = @{}; foreach ($e in $tl) { if ($e[2] -le $d3) { $lsG[$e[0]] = $true } }
  $same = ($dbG.Count -eq $lsG.Count) -and -not @($dbG.Keys | Where-Object { -not $lsG.ContainsKey($_) }).Count
  return [ordered]@{ ok = $true; ym = $Ym; tally = $tl.Count; copy = $held.Count; missing = $missing; differ = $differ; extra = $extra; firstDays = $d3; dayBook = $dbG.Count; list = $lsG.Count; listMatchesDayBook = $same }
}
