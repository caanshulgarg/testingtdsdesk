# ------------------------------------------------------------------ 1.10: day book and balances on request, and a copy every night
# Rules, not guesses: these read exactly what Tally holds for the dates asked, nothing else.

function Test-TallyDate([string]$d) { return ($d -match '^\d{8}$') }
function ConvertFrom-TallyDate([string]$d) { return [datetime]::ParseExact($d, 'yyyyMMdd', [Globalization.CultureInfo]::InvariantCulture) }

# The Day Book of one company for a period, as Tally exports it (every voucher, every line, bill-wise details)
function Get-DayBookXml([string]$Company, [string]$From, [string]$To, [int]$PreferredPort) {
  if (-not $Company) { throw 'Say which company.' }
  if (-not (Test-TallyDate $From) -or -not (Test-TallyDate $To)) { throw 'Dates are to be given as yyyymmdd.' }
  if ($From -gt $To) { throw 'The period ends before it starts.' }
  if (((ConvertFrom-TallyDate $To) - (ConvertFrom-TallyDate $From)).TotalDays -gt 92) { throw 'Ask for three months at most at a time, so Tally is not held up.' }
  $port = Find-CompanyPort $Company $PreferredPort
  $req = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>' +
    '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY><SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE>' +
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
  $t = [Math]::Max([int]$Cfg.TallyTimeoutSec, 900)
  return (ConvertTo-CleanXml (Invoke-Tally -TallyPort $port -Xml $req -TimeoutSec $t))
}

# Every ledger's balance as Tally works it out: at the end of the day before the period, and at its end
function Get-Balances([string]$Company, [string]$From, [string]$To, [int]$PreferredPort) {
  if (-not (Test-TallyDate $From) -or -not (Test-TallyDate $To)) { throw 'Dates are to be given as yyyymmdd.' }
  $port = Find-CompanyPort $Company $PreferredPort
  $before = (ConvertFrom-TallyDate $From).AddDays(-1).ToString('yyyyMMdd')
  $read = {
    param($asOn)
    $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskBalances</ID></HEADER>' +
      '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
      '<SVFROMDATE>' + $asOn + '</SVFROMDATE><SVTODATE>' + $asOn + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
      '<COLLECTION NAME="TDSDeskBalances" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH></COLLECTION>' +
      '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml $req)
    $h = @{}
    foreach ($l in $doc.SelectNodes('//LEDGER')) {
      $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }
      if ($n) { $h[$n] = @{ parent = (Get-NodeText $l 'PARENT'); bal = (Get-NodeText $l 'CLOSINGBALANCE') } }
    }
    return $h
  }
  $open = & $read $before
  $close = & $read $To
  $list = @()
  foreach ($n in (@($open.Keys) + @($close.Keys) | Sort-Object -Unique)) {
    $o = $open[$n]; $c = $close[$n]
    $list += [ordered]@{ name = $n; parent = $(if ($c) { $c.parent } else { $o.parent }); open = $(if ($o) { $o.bal } else { '' }); close = $(if ($c) { $c.bal } else { '' }) }
  }
  return [ordered]@{ ok = $true; company = $Company; port = $port; from = $From; to = $To; openAsOn = $before; ledgers = $list }
}

# Text back as it is (the Day Book is too large to wrap in JSON)
function Send-Raw($stream, [int]$status, [string]$body, [string]$origin, [string]$type) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  if (-not $origin) { $origin = '*' }
  if (-not $type) { $type = 'text/xml; charset=utf-8' }
  $head = "HTTP/1.1 $status OK`r`n" +
    "Content-Type: $type`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    "Access-Control-Allow-Origin: $origin`r`n" +
    "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
    "Access-Control-Allow-Headers: Content-Type, X-Bridge-Key`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Cache-Control: no-store`r`n" +
    "Vary: Origin`r`n" +
    "Connection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

# ---------- the nightly copy: each company's day book, balances and ledgers kept in a folder, ready in the morning
function Get-SyncDir { if ($Cfg.SyncDir) { return [string]$Cfg.SyncDir }; return (Join-Path $PSScriptRoot 'sync') }
function Get-SafeName([string]$s) { return ([regex]::Replace($s, '[\\/:*?"<>|]', '_')).Trim() }
function Get-SyncFolder([string]$Company) { return (Join-Path (Get-SyncDir) (Get-SafeName $Company)) }
function Get-FyStart([datetime]$d) { $y = $d.Year; if ($d.Month -lt 4) { $y-- }; return [datetime]::new($y, 4, 1) }

function Invoke-CompanySync([string]$Company, [int]$Port) {
  $dir = Get-SyncFolder $Company
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $today = (Get-Date).Date
  $from = Get-FyStart $today
  # after the year ends, keep the last year too until its audit is done (to 30 November)
  if ($today.Month -ge 4 -and $today.Month -le 11) { $from = $from.AddYears(-1) }
  $months = @()
  $m = $from
  while ($m -le $today) {
    $end = $m.AddMonths(1).AddDays(-1); if ($end -gt $today) { $end = $today }
    $f = $m.ToString('yyyyMMdd'); $t = $end.ToString('yyyyMMdd')
    $xml = Get-DayBookXml $Company $f $t $Port
    $file = Join-Path $dir ('daybook-' + $m.ToString('yyyyMM') + '.xml')
    [IO.File]::WriteAllText($file, $xml, (New-Object System.Text.UTF8Encoding($false)))
    $months += [ordered]@{ ym = $m.ToString('yyyyMM'); from = $f; to = $t; bytes = (Get-Item $file).Length }
    $m = $m.AddMonths(1)
  }
  $bal = Get-Balances $Company $from.ToString('yyyyMMdd') $today.ToString('yyyyMMdd') $Port
  ($bal | ConvertTo-Json -Depth 6 -Compress) | Set-Content -Path (Join-Path $dir 'balances.json') -Encoding UTF8
  $led = Get-Ledgers $Company $Port
  ($led | ConvertTo-Json -Depth 6 -Compress) | Set-Content -Path (Join-Path $dir 'ledgers.json') -Encoding UTF8
  $man = [ordered]@{ ok = $true; company = $Company; at = (Get-Date).ToString('s'); from = $from.ToString('yyyyMMdd'); to = $today.ToString('yyyyMMdd'); months = $months; bridge = $BridgeVersion }
  ($man | ConvertTo-Json -Depth 6 -Compress) | Set-Content -Path (Join-Path $dir 'manifest.json') -Encoding UTF8
  return $man
}

function Invoke-NightlySync {
  $done = @(); $failed = @()
  $wanted = @($Cfg.SyncCompanies | Where-Object { $_ })
  foreach ($s in (Get-OpenCompanies -Fresh)) {
    if ($s.skipped) { continue }
    foreach ($c in $s.companies) {
      if ($wanted.Count -and $wanted -notcontains $c.name) { continue }
      try { Invoke-CompanySync $c.name $s.port | Out-Null; $done += $c.name; Write-Log ('Nightly copy of ' + $c.name + ': done') }
      catch { $failed += ($c.name + ': ' + $_.Exception.Message); Write-Log ('Nightly copy of ' + $c.name + ' FAILED: ' + $_.Exception.Message) }
    }
  }
  $sum = [ordered]@{ at = (Get-Date).ToString('s'); done = $done; failed = $failed }
  New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null
  ($sum | ConvertTo-Json -Depth 4 -Compress) | Set-Content -Path (Join-Path (Get-SyncDir) 'last-run.json') -Encoding UTF8
  return $sum
}

$script:TaskName = 'TDS Desk - nightly Tally copy'
function Get-Schedule {
  $q = & schtasks.exe /Query /TN $script:TaskName /FO LIST 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $q) { return [ordered]@{ ok = $true; on = $false } }
  $next = (($q | Where-Object { $_ -match '^Next Run Time' }) -replace '^Next Run Time:\s*', '')
  $last = $null
  $lr = Join-Path (Get-SyncDir) 'last-run.json'
  if (Test-Path $lr) { $last = Get-Content -Raw $lr | ConvertFrom-Json }
  return [ordered]@{ ok = $true; on = $true; next = $next; last = $last }
}
function Set-Schedule([bool]$On, [string]$Time) {
  if (-not $On) { & schtasks.exe /Delete /TN $script:TaskName /F 2>$null | Out-Null; return (Get-Schedule) }
  if ($Time -notmatch '^\d{2}:\d{2}$') { $Time = '02:00' }
  $ps = Join-Path $PSHOME 'powershell.exe'; if (-not (Test-Path $ps)) { $ps = 'powershell.exe' }
  $cmd = '"' + $ps + '" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Sync'
  & schtasks.exe /Create /F /SC DAILY /ST $Time /TN $script:TaskName /TR $cmd | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows did not accept the nightly task.' }
  return (Get-Schedule)
}

# ---------- the FVU: Protean's File Validation Utility, run on this computer, behind the bridge key
function Invoke-Fvu($o) {
  $homeDir = $env:USERPROFILE; if (-not $homeDir) { $homeDir = $HOME }
  $jar = [string]$o.fvuJar
  if (-not $jar) { $jar = Join-Path $homeDir 'TDS-Desk\FVU\FVU_STANDALONE.jar' }
  $outDir = [string]$o.outDir
  if (-not $outDir) { $outDir = Join-Path $homeDir 'TDS-Desk\FVU\out' }
  if ($jar -notmatch '\.jar$' -or -not (Test-Path -LiteralPath $jar)) { return [ordered]@{ ok = $false; error = "The FVU was not found at $jar. Install Protean's FVU and set its path in TDS Desk." } }
  if (-not (Get-Command java -ErrorAction SilentlyContinue)) { return [ordered]@{ ok = $false; error = 'Java is not installed on this computer. The FVU needs Java to run.' } }
  $text = [string]$o.text
  if (-not $text) { return [ordered]@{ ok = $false; error = 'The return file is empty.' } }
  $name = [IO.Path]::GetFileName([string]$o.name)
  if (-not $name -or $name -notmatch '^[\w .()-]+\.txt$') { $name = 'return.txt' }
  # each run in its own folder, so nothing from an earlier run is overwritten or mistaken for this one
  $runDir = Join-Path $outDir ((Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $inFile = Join-Path $runDir $name
  [IO.File]::WriteAllText($inFile, $text, [Text.Encoding]::ASCII)
  $errFile = [IO.Path]::ChangeExtension($inFile, '.err')
  $argList = @('-jar', $jar, $inFile, $errFile, $runDir)
  $csi = [string]$o.csi
  if ($csi -and (Test-Path -LiteralPath $csi)) { $argList += $csi }
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = 'java'
  $psi.Arguments = ($argList | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $so = $proc.StandardOutput.ReadToEndAsync(); $se = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(180000)) { try { $proc.Kill() } catch { }; return [ordered]@{ ok = $false; error = 'The FVU did not finish in three minutes.' } }
  $fvuFile = Get-ChildItem -LiteralPath $runDir -Filter '*.fvu' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $errors = ''
  if (Test-Path -LiteralPath $errFile) { $errors = [IO.File]::ReadAllText($errFile) }
  $fvuPath = ''
  if ($fvuFile) { $fvuPath = $fvuFile.FullName }
  Write-Log ('FVU run on ' + $name + ': ' + $(if ($fvuFile) { 'accepted' } else { 'errors' }))
  # ok: the FVU ran; accepted: it made the .fvu file
  return [ordered]@{ ok = $true; accepted = [bool]$fvuFile; fvu = $fvuPath; errors = $errors; output = ($so.Result + $se.Result); folder = $runDir; input = $inFile }
}
