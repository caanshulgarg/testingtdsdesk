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
  # 1.14.9 (review of 01-Oct-2026): with no opening balances read yet (they wait for a quiet time), the ledgers and their
  # groups still go, on their own: the cloud keeps each ledger's group and Tally's groups, and leaves openings and
  # entries as they are
  if ((Test-Path -LiteralPath $lf) -and -not (Test-Path -LiteralPath $bf)) {
    $kj = Read-KeepJson (Join-Path $Dir 'ledgers.json'); $gj = Read-KeepJson (Join-Path $Dir 'groups.json')
    if ($kj -and $gj) {
      $led = @($kj.PSObject.Properties | ForEach-Object { $v = @($_.Value); if ([string]$v[0]) { , @([string]$v[0], [string]$v[1]) } })
      $grp = @(@($gj) | ForEach-Object { , @([string]$_[0], [string]$_[1]) })
      $r = Invoke-Cloud @{ kind = 'groups'; company = $Company; ledgers = $led; groups = $grp } 120
      if ($r.code -eq 409) { $script:CloudLinks[$Company] = $false; return }
      if ($r.code -ne 200) { throw ('the ledger groups did not go: ' + $r.error) }
      Remove-Item -LiteralPath $lf -Force -ErrorAction SilentlyContinue
      Write-Log ('Cloud: ' + $Company + ': ' + $led.Count + ' ledgers with their groups and ' + $grp.Count + ' groups sent')
    }
  }
  if ((Test-Path -LiteralPath $lf) -and (Test-Path -LiteralPath $bf)) {
    $bal = Read-KeepJson $bf
    if ($bal -and $bal.from -and $bal.openAsOn) {
      # 1.14.7 (review of 01-Oct-2026): every ledger in Tally goes, with its group. The opening balances may come from a
      # trial balance file, which lists only ledgers with a balance and no groups: names and groups come from the
      # ledger list read from Tally (ledgers.json), the opening from the balances (0 when a ledger has none)
      $rows = [ordered]@{}
      foreach ($l in @($bal.ledgers)) { $n = [string]$l.name; if ($n) { $rows[$n] = @($n, [string]$l.parent, [string]$l.open) } }
      $kj = Read-KeepJson (Join-Path $Dir 'ledgers.json')
      if ($kj) {
        foreach ($p in $kj.PSObject.Properties) {
          $v = @($p.Value); $n = [string]$v[0]; $par = [string]$v[1]
          if (-not $n) { continue }
          if ($rows.Contains($n)) { if (-not $rows[$n][1]) { $rows[$n][1] = $par } } else { $rows[$n] = @($n, $par, '0') }
        }
      }
      $led = @($rows.Values | ForEach-Object { , @([string]$_[0], [string]$_[1], [string]$_[2]) })
      $grp = @(); $gj = Read-KeepJson (Join-Path $Dir 'groups.json')
      if ($gj) { $grp = @(@($gj) | ForEach-Object { , @([string]$_[0], [string]$_[1]) }) }
      $r = Invoke-Cloud @{ kind = 'ledgers'; company = $Company; from = [string]$bal.from; openAsOn = [string]$bal.openAsOn; ledgers = $led; groups = $grp } 120
      if ($r.code -eq 200 -and $r.json -and $r.json.kept) { Write-Log ('Cloud: ' + $Company + ': ' + [string]$r.json.kept) }
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

# 1.14.1: a heartbeat to the cloud every few minutes, so FinCom shows for each client whether its Tally computer is on,
# Tally open, and when the books were last updated. Tally is asked nothing: all of it is what the bridge already knows
$script:BeatAt = [DateTime]::MinValue
function Send-CloudBeat {
  if (-not (Test-CloudOn)) { return }
  if (([DateTime]::UtcNow - $script:BeatAt).TotalSeconds -lt (Get-KeepNum 'CloudBeatSec' 60)) { return }
  $script:BeatAt = [DateTime]::UtcNow
  $open = @(); $tally = $false; $ports = @()
  try { foreach ($s in @(Get-OpenCompaniesCached)) {
    # 1.14.9: each Tally port as the bridge sees it, so FinCom (and support) can tell why Tally shows as not open
    $ports += [ordered]@{ port = [int]$s.port; ok = [bool]$s.ok; skipped = [bool]$s.skipped; n = @($s.companies).Count; error = ([string]$s.error).Substring(0, [Math]::Min(120, ([string]$s.error).Length)) }
    if ($s.skipped) { continue }; if ($s.ok) { $tally = $true; $open += @($s.companies | ForEach-Object { [string]$_.name }) } } } catch { }
  $cos = @()
  foreach ($d in @(Get-ChildItem -LiteralPath (Get-SyncDir) -Directory -ErrorAction SilentlyContinue)) {
    $st = Read-KeepState $d.FullName; if (-not $st -or -not $st.company) { continue }
    $cos += [ordered]@{ name = [string]$st.company; open = [bool]($open -contains [string]$st.company); at = [string]$st.at; phase = [string]$st.phase; waiting = @(Get-CloudQueue $d.FullName).Count }
  }
  $running = $false; try { $p = [int]('0' + [IO.File]::ReadAllText((Join-Path (Get-SyncDir) 'keep.pid')).Trim()); $running = [bool]($p -and (Test-ProcessAlive $p)) } catch { }
  $beat = [ordered]@{ kind = 'beat'; tally = $tally; open = $open; ports = $ports; companies = $cos; updating = $running; dailyAt = (Get-KeepDailyAt); lastRun = (Get-KeepLastRun) }
  $r = Invoke-Cloud $beat 10
  # 1.15.0: the computer's own Realtime channel, where FinCom's database wakes it at once (a posting, Update now)
  if ($r.code -eq 200 -and $r.json) { try { Set-CloudWake $r.json.wake } catch { } }
  # 1.14.4: Update now pressed in FinCom on another computer
  if ($r.code -eq 200 -and $r.json -and $r.json.updateNow) { Request-KeepNow; try { Start-KeepIfNeeded } catch { } }
  if ($r.code -eq 200 -and $r.json -and [int]$r.json.posts -gt 0 -and $Cfg.AllowImport) { try { Invoke-CloudPostTake } catch { Write-Log ('Posting queue: ' + $_.Exception.Message) } }
  if ($r.code -ne 200) { $script:BeatAt = [DateTime]::UtcNow.AddMinutes(25) }       # the cloud or the internet is down: tried again in half an hour
}

# 1.14.6 (build 199, step 4): the posting queue. FinCom on any computer queues entries in the cloud; the heartbeat says
# how many wait for this computer, and they are taken one posting at a time and run as the bridge's usual posting job
# (batches, one writer per Tally, FinCom's ID stamped in each entry). A queued posting always checks Tally for those IDs
# first, so an entry posted before (a posting pressed twice, a computer restarted) is never posted again. How it goes is
# written back to the cloud, where FinCom follows it.
$script:CloudPosts = $null; $script:CloudPostsAt = [DateTime]::MinValue
function Get-CloudPostsFile { return (Join-Path (Get-SyncDir) 'cloud-posts.txt') }
function Get-CloudPosts {
  if ($null -eq $script:CloudPosts) {
    $script:CloudPosts = @{}
    try { foreach ($l in ([IO.File]::ReadAllLines((Get-CloudPostsFile)))) { if ($l.Trim()) { $script:CloudPosts[$l.Trim()] = '' } } } catch { }
  }
  return $script:CloudPosts
}
function Save-CloudPosts { try { New-Item -ItemType Directory -Force -Path (Get-SyncDir) | Out-Null; [IO.File]::WriteAllLines((Get-CloudPostsFile), [string[]]@((Get-CloudPosts).Keys)) } catch { } }
function Invoke-CloudPostTake {
  $cp = Get-CloudPosts
  for ($i = 0; $i -lt 5; $i++) {
    $r = Invoke-Cloud ([ordered]@{ kind = 'posts_take' }) 30
    if ($r.code -ne 200 -or -not $r.json -or -not $r.json.job) { return }
    $j = $r.json.job
    try {
      $pl = [pscustomobject]@{ jobId = [string]$j.id; company = [string]$j.company; masters = @($j.payload.masters | Where-Object { $_ }); vouchers = @($j.payload.vouchers | Where-Object { $_ }); ledger = [string]$j.payload.ledger; checkFirst = $true }
      $v = New-PostJob $pl
      $cp[[string]$j.id] = ''; Save-CloudPosts
      Write-Log ('Posting from FinCom''s queue: ' + $v.total + ' item(s) for ' + $j.company + ' (job ' + $j.id + ')')
    } catch {
      $null = Invoke-Cloud ([ordered]@{ kind = 'posts_update'; id = [string]$j.id; status = 'failed'; done = 0; message = ('The Tally computer could not start this posting: ' + $_.Exception.Message); results = @() }) 30
    }
  }
}
function Sync-CloudPosts {
  $cp = Get-CloudPosts
  if (-not $cp.Count) { return }
  if (([DateTime]::UtcNow - $script:CloudPostsAt).TotalSeconds -lt (Get-KeepNum 'CloudPostSyncSec' 3)) { return }
  $script:CloudPostsAt = [DateTime]::UtcNow
  foreach ($id in @($cp.Keys)) {
    $v = Get-JobView (Get-JobDir $id)
    if (-not $v) { $cp.Remove($id); Save-CloudPosts; continue }
    if ($v.status -eq 'interrupted') { try { $v = Resume-PostJob $id } catch { } }
    $st = $(if ($v.status -eq 'done' -or $v.status -eq 'failed') { [string]$v.status } else { 'running' })
    $sig = $st + '|' + $v.done + '|' + $v.message + '|' + $v.checking
    if ($sig -eq $cp[$id]) { continue }
    $res = @(@($v.results) | Where-Object { $_ } | ForEach-Object { [ordered]@{ id = [string]$_.id; kind = [string]$_.kind; ok = [bool]$_.ok; verified = $_.verified; message = [string]$_.message; vchNumber = [string]$_.vchNumber; vchType = [string]$_.vchType; guid = [string]$_.guid; masterId = [string]$_.masterId; vchDate = [string]$_.vchDate; optional = [bool]$_.optional; alreadyThere = [bool]$_.alreadyThere } })
    $r = Invoke-Cloud ([ordered]@{ kind = 'posts_update'; id = $id; status = $st; done = [int]$v.done; message = [string]$v.message; results = $res; checking = [bool]$v.checking }) 30
    if ($r.code -eq 200) {
      $cp[$id] = $sig
      if (($st -eq 'done' -or $st -eq 'failed') -and -not $v.checking) { $cp.Remove($id); Save-CloudPosts; Write-Log ('Posting from FinCom''s queue ' + $id + ': ' + $v.message) }
    }
  }
}


# ------------------------------------------------------------------ 1.15.0 (fast-sync): woken at once through Realtime
# "Post to Tally", "Update now" and "Send ledgers and groups now" in FinCom reached this computer with its next heartbeat
# (up to a minute). Now FinCom's database sends a wake-up on this computer's own channel the moment one is asked for
# (Supabase Realtime, a websocket kept open here), and the bridge asks for the work at once, with its key, as before.
# The wake-up says only "post" or "update"; the channel's name is a random token of this computer, given in the
# heartbeat's answer. Without the channel (an older FinCom, no internet, a Windows without websockets) the heartbeat
# carries on as before. CloudWake = 'off' in the settings turns it off.
$script:Wake = @{ ws = $null; recv = $null; buf = $null; sb = $null; topic = ''; url = ''; key = ''; ref = 0; joinRef = ''; hbAt = [DateTime]::MinValue; retryAt = [DateTime]::MinValue; wait = 5; joined = $false; info = '' }
function Set-CloudWake($w) {
  if (-not $w -or -not [string]$w.topic -or -not [string]$w.url) { return }
  $n = [string]$w.url + '|' + [string]$w.topic
  if ($n -eq $script:Wake.info) { return }
  $script:Wake.info = $n; $script:Wake.url = [string]$w.url; $script:Wake.key = [string]$w.key; $script:Wake.topic = [string]$w.topic; $script:Wake.wait = 5; $script:Wake.retryAt = [DateTime]::MinValue
  Stop-CloudWake
}
function Stop-CloudWake { try { if ($script:Wake.ws) { $script:Wake.ws.Abort(); $script:Wake.ws.Dispose() } } catch { }; $script:Wake.ws = $null; $script:Wake.recv = $null; $script:Wake.joined = $false }
function Send-WakeMsg([string]$topic, [string]$event, $payload) {
  $script:Wake.ref++
  $t = ([ordered]@{ topic = $topic; event = $event; payload = $payload; ref = [string]$script:Wake.ref } | ConvertTo-Json -Depth 6 -Compress)
  $b = [Text.Encoding]::UTF8.GetBytes($t)
  $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $b)
  if (-not $script:Wake.ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(5000)) { throw 'the channel did not take a message' }
  return [string]$script:Wake.ref
}
function Get-WakeStatus { return [ordered]@{ on = [bool]$script:Wake.topic; joined = [bool]$script:Wake.joined } }
# from the main loop, ten times a second: nothing waits here (the socket is read only when a message has come)
function Step-CloudWake {
  $w = $script:Wake
  if (-not $w.topic -or -not (Test-CloudOn) -or [string]$Cfg.CloudWake -eq 'off') { return }
  if (-not $w.ws -or $w.ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
    if ($w.ws) { Stop-CloudWake; $w.retryAt = [DateTime]::UtcNow.AddSeconds($w.wait); $w.wait = [Math]::Min(300, $w.wait * 2); return }
    if ([DateTime]::UtcNow -lt $w.retryAt) { return }
    try {
      $ws = New-Object System.Net.WebSockets.ClientWebSocket
      $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
      $u = [Uri]($w.url + '?apikey=' + [Uri]::EscapeDataString($w.key) + '&vsn=1.0.0')
      if (-not $ws.ConnectAsync($u, [Threading.CancellationToken]::None).Wait(10000)) { throw 'no answer in 10 s' }
      $w.ws = $ws; $w.recv = $null; $w.sb = New-Object Text.StringBuilder
      $w.joinRef = Send-WakeMsg ('realtime:' + $w.topic) 'phx_join' ([ordered]@{ config = [ordered]@{ broadcast = [ordered]@{ self = $false; ack = $false }; presence = [ordered]@{ key = '' }; postgres_changes = @(); private = $false } })
      $w.hbAt = [DateTime]::UtcNow
    } catch {
      if ($w.wait -le 10) { Write-Log ('Wake-up channel: could not connect (' + $_.Exception.Message + '); the heartbeat carries on meanwhile') }
      Stop-CloudWake; $w.retryAt = [DateTime]::UtcNow.AddSeconds($w.wait); $w.wait = [Math]::Min(300, $w.wait * 2); return
    }
  }
  for ($i = 0; $i -lt 20; $i++) {
    if ($null -eq $w.recv) { $w.buf = New-Object byte[] 16384; $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $w.buf); $w.recv = $w.ws.ReceiveAsync($seg, [Threading.CancellationToken]::None) }
    if (-not $w.recv.IsCompleted) { break }
    $r = $null; try { $r = $w.recv.Result } catch { Stop-CloudWake; return }
    $w.recv = $null
    if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { Stop-CloudWake; return }
    $null = $w.sb.Append([Text.Encoding]::UTF8.GetString($w.buf, 0, $r.Count))
    if ($r.EndOfMessage) { $t = $w.sb.ToString(); $null = $w.sb.Clear(); try { Invoke-WakeMsg ($t | ConvertFrom-Json) } catch { Write-Log ('Wake-up channel: ' + $_.Exception.Message) } }
  }
  if (([DateTime]::UtcNow - $w.hbAt).TotalSeconds -ge 25) { $w.hbAt = [DateTime]::UtcNow; try { $null = Send-WakeMsg 'phoenix' 'heartbeat' @{} } catch { Stop-CloudWake } }
}
function Invoke-WakeMsg($m) {
  $w = $script:Wake
  if ([string]$m.event -eq 'phx_reply' -and [string]$m.ref -eq $w.joinRef) {
    $w.joined = ([string]$m.payload.status -eq 'ok')
    if ($w.joined) { $w.wait = 5; Write-Log 'Wake-up channel: connected (postings and Update now reach this computer at once)' } else { Write-Log 'Wake-up channel: not taken by FinCom''s cloud; the heartbeat carries on' }
    return
  }
  if ([string]$m.event -ne 'broadcast' -or -not $m.payload) { return }
  $what = [string]$m.payload.event
  if ($what -eq 'post') {
    Write-Log 'Woken by FinCom: a posting is waiting'
    if ($Cfg.AllowImport) { try { Invoke-CloudPostTake } catch { Write-Log ('Posting queue: ' + $_.Exception.Message) } }
  } elseif ($what -eq 'update') {
    Write-Log 'Woken by FinCom: Update now'
    Request-KeepNow; try { Start-KeepIfNeeded } catch { Write-Log ('Could not start the update: ' + $_.Exception.Message) }
  }
}
