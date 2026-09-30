# ------------------------------------------------------------------ 1.13.0: the copy goes to FinCom's cloud
# Each company kept in step is also sent to FinCom's cloud (the tally-ingest function), so FinCom answers from there:
# on any computer or phone, with Tally closed, fast. What is sent: each day's day book that changed (gzip), the
# ledgers with their opening balances, and the copy's state. Nothing is sent until:
#   - this computer is connected to the firm in FinCom (a key made there, kept here encrypted for this Windows user), and
#   - the Tally company is linked to one of the firm's clients (by its Tally name, or by hand in FinCom).
# Days waiting to go are kept in a queue on disk (cloud-out.txt in the company's folder): without internet, or with
# FinCom's cloud down, nothing is lost; it goes when it can, a little at a time, never holding Tally.

function Protect-CloudKey([string]$k) {
  try { Add-Type -AssemblyName System.Security -ErrorAction Stop
    $b = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($k), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return 'dpapi:' + [Convert]::ToBase64String($b) } catch {
    if ($env:OS -eq 'Windows_NT') { throw 'Windows could not protect the key for this user, so it was not kept.' }
    return 'plain:' + $k }     # not on Windows (tests only): kept as is
}
function Get-CloudKey {
  $v = [string]$Cfg.CloudKey
  if ($v -like 'dpapi:*') {
    try { Add-Type -AssemblyName System.Security -ErrorAction Stop
      return [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v.Substring(6)), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)) } catch { return '' }
  }
  if ($v -like 'plain:*') { return $v.Substring(6) }
  return $v
}
function Test-CloudOn { return [bool]([string]$Cfg.CloudUrl) -and [bool](Get-CloudKey) }

# one call to the cloud: @{ code; json; error }
function Invoke-Cloud($body, [int]$TimeoutSec = 60) {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $body['version'] = $BridgeVersion
  $json = $body | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $req = [System.Net.HttpWebRequest]::Create([string]$Cfg.CloudUrl)
  $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Timeout = $TimeoutSec * 1000; $req.ReadWriteTimeout = $TimeoutSec * 1000
  $req.Headers.Add('x-fincom-device', (Get-CloudKey))
  $req.ContentLength = $bytes.Length
  try {
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ code = 0; json = $null; error = $_.Exception.Message } }
  }
  try {
    $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $txt = $sr.ReadToEnd(); $code = [int]$resp.StatusCode
    $o = $null; try { $o = $txt | ConvertFrom-Json } catch { }
    return @{ code = $code; json = $o; error = $(if ($o -and $o.error) { [string]$o.error } elseif ($code -ge 400) { 'HTTP ' + $code } else { '' }) }
  } finally { $resp.Close() }
}

function ConvertTo-GzipBase64([string]$text) {
  $b = [Text.Encoding]::UTF8.GetBytes($text)
  $ms = New-Object IO.MemoryStream
  $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
  $gz.Write($b, 0, $b.Length); $gz.Close()
  return [Convert]::ToBase64String($ms.ToArray())
}

# the queue: days waiting to go, one a line; and a mark that the ledgers are to go
function Add-CloudDays([string]$Dir, [string[]]$Days) {
  if (-not (Test-CloudOn) -or -not $Days.Count) { return }
  try { [IO.File]::AppendAllText((Join-Path $Dir 'cloud-out.txt'), (($Days | Where-Object { $_ }) -join "`n") + "`n") } catch { }
}
function Set-CloudLedgers([string]$Dir) { if (Test-CloudOn) { try { [IO.File]::WriteAllText((Join-Path $Dir 'cloud-ledgers.flag'), (Get-Date).ToString('s')) } catch { } } }
function Get-CloudQueue([string]$Dir) {
  $f = Join-Path $Dir 'cloud-out.txt'
  if (-not (Test-Path -LiteralPath $f)) { return @() }
  return @([IO.File]::ReadAllLines($f) | Where-Object { $_ -match '^\d{8}$' } | Sort-Object -Unique)
}
function Remove-CloudDays([string]$Dir, [string[]]$Sent) {
  $f = Join-Path $Dir 'cloud-out.txt'
  $left = @(Get-CloudQueue $Dir | Where-Object { $Sent -notcontains $_ })
  Save-KeepFile $f ($(if ($left.Count) { ($left -join "`n") + "`n" } else { '' }))
}

$script:CloudLinks = @{}; $script:CloudLinksAt = [DateTime]::MinValue; $script:CloudBack = @{}; $script:CloudStateAt = @{}
$script:CloudLast = @{ at = ''; error = ''; sentDays = 0 }
function Update-CloudLinks {
  $cos = @()
  foreach ($s in @(Get-OpenCompanies)) { if (-not $s.skipped -and $s.ok) { foreach ($c in $s.companies) { $cos += [ordered]@{ name = $c.name; gstin = [string]$c.gstin } } } }
  # companies kept here but not open now are asked about too
  foreach ($d in @(Get-ChildItem -LiteralPath (Get-SyncDir) -Directory -ErrorAction SilentlyContinue)) {
    $st = Read-KeepState $d.FullName; if ($st -and $st.company -and -not ($cos | Where-Object { $_.name -eq $st.company })) { $cos += [ordered]@{ name = [string]$st.company; gstin = '' } }
  }
  if (-not $cos.Count) { return }
  $r = Invoke-Cloud @{ kind = 'companies'; companies = $cos }
  if ($r.code -eq 200 -and $r.json) {
    $was = $script:CloudLinks.Clone()
    foreach ($p in $r.json.links.PSObject.Properties) { $script:CloudLinks[$p.Name] = [bool]$p.Value }
    $script:CloudLinksAt = [DateTime]::UtcNow
    # a company linked just now: everything kept for it goes
    foreach ($k in @($script:CloudLinks.Keys)) {
      if ($script:CloudLinks[$k] -and -not $was[$k]) {
        $dir = Get-SyncFolder $k; $mark = Join-Path $dir 'cloud-all.done'
        if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath $mark)) {
          $days = @(Get-ChildItem -LiteralPath (Join-Path $dir 'days') -Filter '*.xml' -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })
          Add-CloudDays $dir $days; Set-CloudLedgers $dir
          [IO.File]::WriteAllText($mark, (Get-Date).ToString('s'))
          Write-Log ('Cloud: ' + $k + ' is linked in FinCom; sending its copy (' + $days.Count + ' days)')
        }
      }
    }
  } else { $script:CloudLast.error = $r.error }
}

# one company's queue: ledgers first, then days, a batch at a time (a few MB at most), within a time budget
function Push-CloudCompany([string]$Company, [string]$Dir, [double]$BudgetSec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $lf = Join-Path $Dir 'cloud-ledgers.flag'; $bf = Join-Path $Dir 'balances.json'
  if ((Test-Path -LiteralPath $lf) -and (Test-Path -LiteralPath $bf)) {
    $bal = Read-KeepJson $bf
    if ($bal -and $bal.from -and $bal.openAsOn) {
      $led = @(@($bal.ledgers) | ForEach-Object { , @([string]$_.name, [string]$_.parent, [string]$_.open) })
      $r = Invoke-Cloud @{ kind = 'ledgers'; company = $Company; from = [string]$bal.from; openAsOn = [string]$bal.openAsOn; ledgers = $led } 120
      if ($r.code -eq 409) { $script:CloudLinks[$Company] = $false; return }
      if ($r.code -ne 200) { throw ('the ledgers did not go: ' + $r.error) }
      Remove-Item -LiteralPath $lf -Force -ErrorAction SilentlyContinue
    }
  }
  $q = @(Get-CloudQueue $Dir)
  $pf = Join-Path $Dir 'cloud-plain.txt'
  $plain = @(); if (Test-Path -LiteralPath $pf) { $plain = @([IO.File]::ReadAllLines($pf) | Where-Object { $_ -match '^\d{8}$' }) }
  $maxB = (Get-KeepNum 'CloudBatchKB' 3000) * 1024
  $i = 0
  while ($i -lt $q.Count -and $sw.Elapsed.TotalSeconds -lt $BudgetSec) {
    $batch = @(); $size = 0
    while ($i -lt $q.Count -and $batch.Count -lt 31) {
      $d = $q[$i]; $f = Join-Path (Join-Path $Dir 'days') ($d + '.xml')
      $t = ''; if (Test-Path -LiteralPath $f) { $t = [IO.File]::ReadAllText($f) }
      # 1.14.0: packed here (gzip); a day the cloud could not open that way is sent again as plain text, packed there
      if ($plain -contains $d) { $one = [ordered]@{ day = $d; b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)) }; $len = $one.b64.Length }
      else { $one = [ordered]@{ day = $d; gz = (ConvertTo-GzipBase64 $t) }; $len = $one.gz.Length }
      if ($batch.Count -and $size + $len -gt $maxB) { break }
      $batch += $one; $size += $len; $i++
    }
    $r = Invoke-Cloud @{ kind = 'days'; company = $Company; days = $batch } 180
    if ($r.code -eq 409) { $script:CloudLinks[$Company] = $false; return }
    if ($r.code -ne 200) { throw ('days did not go: ' + $r.error) }
    $done = @($r.json.done | ForEach-Object { [string]$_ })
    # a day the cloud could not open (Windows' gzip): sent again as plain text; any other refusal is logged and the day
    # left out, so it does not hold up every day after it
    $bad = @($r.json.bad | Where-Object { $_ })
    $again = @($bad | Where-Object { [string]$_.error -match 'gzip|checksum|corrupt|invalid' -and -not ($plain -contains [string]$_.day) } | ForEach-Object { [string]$_.day })
    if ($again.Count) { $plain = @($plain + $again | Sort-Object -Unique); [IO.File]::WriteAllLines($pf, [string[]]$plain); Write-Log ('Cloud: ' + $Company + ': ' + $again.Count + ' day(s) go again as plain text') }
    $dropped = @($bad | Where-Object { -not ($again -contains [string]$_.day) })
    foreach ($b in $dropped) { Write-Log ('Cloud: ' + $Company + ' ' + $b.day + ' was not taken: ' + $b.error) }
    Remove-CloudDays $Dir (@($done) + @($dropped | ForEach-Object { [string]$_.day }))
    $done = @($done) + @($dropped | ForEach-Object { [string]$_.day }) + $again
    if ($again.Count) { $i = $q.Count }
    $script:CloudLast.sentDays += $done.Count
    if ($done.Count -lt $batch.Count) { throw ('only ' + $done.Count + ' of ' + $batch.Count + ' days were taken') }
  }
}

# the copy's state for FinCom (what the page shows: in step, copying, days not read, trouble), once a minute at most
function Push-CloudState([string]$Company, [string]$Dir) {
  $k = $Company
  if ($script:CloudStateAt[$k] -and ([DateTime]::UtcNow - $script:CloudStateAt[$k]).TotalSeconds -lt (Get-KeepNum 'CloudStateSec' 60)) { return }
  $m = Read-KeepJson (Join-Path $Dir 'manifest.json'); if (-not $m) { return }
  $st = [ordered]@{ phase = $m.phase; from = $m.from; to = $m.to; doneTo = $m.doneTo; seen = $m.seen; skipped = @($m.skipped); trouble = $m.trouble; bridge = $BridgeVersion;
    queue = @(Get-CloudQueue $Dir).Count; computer = $env:COMPUTERNAME }
  $r = Invoke-Cloud @{ kind = 'state'; company = $Company; state = $st } 30
  if ($r.code -eq 200) { $script:CloudStateAt[$k] = [DateTime]::UtcNow }
}

# every turn of the worker: all companies kept here, whether open in Tally or not (sending needs no Tally)
function Invoke-CloudPush {
  if (-not (Test-CloudOn)) { return 0 }
  if (([DateTime]::UtcNow - $script:CloudLinksAt).TotalSeconds -ge (Get-KeepNum 'CloudLinksSec' 300)) { try { Update-CloudLinks } catch { $script:CloudLast.error = $_.Exception.Message } }
  $left = 0
  foreach ($d in @(Get-ChildItem -LiteralPath (Get-SyncDir) -Directory -ErrorAction SilentlyContinue)) {
    $st = Read-KeepState $d.FullName; if (-not $st -or -not $st.company) { continue }
    $co = [string]$st.company
    if (-not $script:CloudLinks[$co]) { continue }
    $bk = $script:CloudBack[$co]
    if ($bk -and [DateTime]::UtcNow -lt $bk.until) { $left += @(Get-CloudQueue $d.FullName).Count; continue }
    try {
      Push-CloudCompany $co $d.FullName (Get-KeepNum 'CloudBudgetSec' 30)
      Push-CloudState $co $d.FullName
      $script:CloudBack.Remove($co); $script:CloudLast.error = ''; $script:CloudLast.at = (Get-Date).ToString('s')
    } catch {
      $n = $(if ($bk) { [int]$bk.n + 1 } else { 1 })
      $wait = [Math]::Min(1800, 30 * [Math]::Pow(2, $n))
      $script:CloudBack[$co] = @{ n = $n; until = [DateTime]::UtcNow.AddSeconds($wait) }
      $script:CloudLast.error = $_.Exception.Message
      Write-Log ('Cloud: ' + $co + ': ' + $_.Exception.Message + ' - trying again in ' + [int]$wait + 's; nothing is lost')
    }
    $left += @(Get-CloudQueue $d.FullName).Count
  }
  try { Save-KeepFile (Join-Path (Get-SyncDir) 'cloud-status.json') ([ordered]@{ at = (Get-Date).ToString('s'); lastSent = $script:CloudLast.at; error = $script:CloudLast.error; sentDays = $script:CloudLast.sentDays; waiting = $left; links = $script:CloudLinks } | ConvertTo-Json -Depth 4 -Compress) } catch { }
  return $left
}

# from FinCom: connect this computer (the key made in FinCom) or disconnect it
function Set-CloudLink($o) {
  if ($o.off) { $Cfg.CloudKey = ''; Save-Config; Write-Log 'Cloud: this computer was disconnected from FinCom'; return [ordered]@{ ok = $true; connected = $false } }
  $url = [string]$o.url; $key = [string]$o.key
  # only FinCom's own cloud (the live database, and the test site's): the books go nowhere else
  if ($url -notmatch '^https://(nrtczucrlgalvtojwoes|qbocskaiewaxqcvaunzc)\.supabase\.co/functions/v1/tally-ingest$' -and -not ($script:Fake -and $url -match '^http://127\.0\.0\.1:\d+/')) { throw 'That is not FinCom''s cloud address.' }
  if ($key -notmatch '^fcd_[0-9a-f]{48}$') { throw 'That is not a FinCom computer key.' }
  $oldU = $Cfg.CloudUrl; $oldK = $Cfg.CloudKey
  $Cfg.CloudUrl = $url; $Cfg.CloudKey = Protect-CloudKey $key
  $r = Invoke-Cloud @{ kind = 'hello'; info = [ordered]@{ computer = $env:COMPUTERNAME; user = $env:USERNAME } }
  if ($r.code -ne 200) { $Cfg.CloudUrl = $oldU; $Cfg.CloudKey = $oldK; throw ('FinCom''s cloud did not accept this computer: ' + $r.error) }
  Save-Config
  $script:CloudLinksAt = [DateTime]::MinValue
  # everything kept so far is queued for when its company is linked (the link step sends it all)
  foreach ($d in @(Get-ChildItem -LiteralPath (Get-SyncDir) -Directory -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath (Join-Path $d.FullName 'cloud-all.done') -Force -ErrorAction SilentlyContinue }
  Write-Log ('Cloud: this computer is connected to ' + $r.json.firm + ' as "' + $r.json.device + '"')
  return [ordered]@{ ok = $true; connected = $true; firm = $r.json.firm; device = $r.json.device }
}
function Get-CloudLinkStatus {
  $s = $null; try { $f = Join-Path (Get-SyncDir) 'cloud-status.json'; if (Test-Path $f) { $s = Get-Content -Raw $f | ConvertFrom-Json } } catch { }
  return [ordered]@{ ok = $true; connected = (Test-CloudOn); url = [string]$Cfg.CloudUrl; status = $s }
}
