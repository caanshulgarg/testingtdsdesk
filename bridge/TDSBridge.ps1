<#
  FinCom - Tally Bridge
  Garg Shekhar & Company

  Runs on the computer where TallyPrime runs. Listens only on this computer (127.0.0.1)
  and lets FinCom, opened in a browser on the same computer, read from and post to Tally.

  Works with Windows PowerShell 5.1 (built into Windows) and PowerShell 7.
  Start:  powershell -ExecutionPolicy Bypass -File TDSBridge.ps1
#>
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json'),
  [switch]$Sync,
  [switch]$Keep,
  [string]$Job = ''
)

$ErrorActionPreference = 'Stop'
# everything shown in this window is also kept in tds-bridge-console.txt
if (-not $Job) { try { Start-Transcript -Path (Join-Path $PSScriptRoot 'tds-bridge-console.txt') -Append -ErrorAction SilentlyContinue | Out-Null } catch { } }
trap {
  $stopMsg = 'BRIDGE STOPPED: ' + $_.Exception.Message + ' (TDSBridge.ps1 line ' + $_.InvocationInfo.ScriptLineNumber + ')'
  Write-Host ''
  Write-Host $stopMsg -ForegroundColor Red
  Write-Host 'Send this message (or tds-bridge-console.txt) to support.'
  try { Add-Content -Path (Join-Path $PSScriptRoot 'tds-bridge.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $stopMsg) } catch { }
  try { Stop-Transcript | Out-Null } catch { }
  break
}
$BridgeVersion = '1.14.3'

# ------------------------------------------------------------------ settings
function New-BridgeKey {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 24
  $rng.GetBytes($bytes)
  $out = ''
  foreach ($b in $bytes) { $out += $chars[$b % $chars.Length] }
  return $out
}

$defaults = [ordered]@{
  Port            = 9100
  TallyHost       = '127.0.0.1'
  TallyPorts      = 'auto'
  OnlyMySession   = $true
  PairWindowMin   = 15
  GentleMs        = 150
  StatusCacheSec  = 30
  FallbackPorts   = @(9000, 9001, 9002, 9003, 9004, 9005)
  TallyTimeoutSec = 120
  Key             = ''
  LogFile         = (Join-Path $PSScriptRoot 'tds-bridge.log')
  AllowImport     = $true
  SyncDir         = ''
  SyncCompanies   = @()
  KeepInStep      = $null
  CloudUrl        = ''
  CloudKey        = ''
  KeepSchedule    = ''
  KeepDailyAt     = ''
  AllowedOrigins  = @('https://app.fincom.live', 'https://staging.fincom.live', 'https://caanshulgarg.github.io', 'http://localhost', 'null')
}
$needSave = $false
if (Test-Path $ConfigPath) {
  try {
    $loaded = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $known = @($defaults.Keys)
    $have = @()
    foreach ($p in $loaded.PSObject.Properties) { $defaults[$p.Name] = $p.Value; $have += $p.Name }
    # settings added in a newer version are written into an older settings file
    foreach ($k in $known) { if ($have -notcontains $k) { $needSave = $true } }
  } catch {
    Write-Host ('  The settings file could not be read (' + $_.Exception.Message + '). Starting with the standard settings.') -ForegroundColor Yellow
    $needSave = $true
  }
}
if (-not $defaults.Key) { $defaults.Key = New-BridgeKey; $needSave = $true }
if ($needSave) { try { ($defaults | ConvertTo-Json) | Set-Content -Path $ConfigPath -Encoding UTF8 } catch { } }
$Cfg = [pscustomobject]$defaults

function Protect-LogText([string]$msg) {
  # anything that looks like a key, token, password or connect code is masked before it is shown or written
  $m = $msg -replace '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer ***'
  $m = $m -replace '(?i)\b(key|token|password|passwd|secret|code|authorization|x-tds-key)("?\s*[:=]\s*"?)[^\s",;&<]+', '$1$2***'
  $m = $m -replace '\btdsd_[0-9a-f]{16,}\b', 'tdsd_***'
  $m = $m -replace '\bfcd_[0-9a-f]{16,}\b', 'fcd_***'
  if ($Cfg -and $Cfg.Key -and $Cfg.Key.Length -ge 8) { $m = $m.Replace([string]$Cfg.Key, '***') }
  return $m
}
function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + (Protect-LogText $msg)
  Write-Host $line
  try {
    $f = $Cfg.LogFile
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 5MB)) {
      # rotation of the bridge's own log: tds-bridge.log.1 is the newest old copy, .5 the oldest (dropped at the next turn)
      for ($i = 4; $i -ge 1; $i--) { if (Test-Path ($f + '.' + $i)) { Move-Item ($f + '.' + $i) ($f + '.' + ($i + 1)) -Force } }
      Move-Item $f ($f + '.1') -Force
    }
    Add-Content -Path $f -Value $line -Encoding UTF8
  } catch { }
}

# ------------------------------------------------------------------ talking to Tally
function Get-TextFromBytes([byte[]]$bytes) {
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) }
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { return [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
  # UTF-16 without a byte-order mark: every second byte is zero
  $zeros = 0
  $n = [Math]::Min($bytes.Length, 400)
  for ($i = 1; $i -lt $n; $i += 2) { if ($bytes[$i] -eq 0) { $zeros++ } }
  if ($n -gt 10 -and $zeros -gt ($n / 4)) { return [Text.Encoding]::Unicode.GetString($bytes) }
  return [Text.Encoding]::UTF8.GetString($bytes)
}

function Wait-Gentle {
  $ms = [int]$Cfg.GentleMs
  if ($ms -gt 0) { Start-Sleep -Milliseconds $ms }
}
function Invoke-Tally([int]$TallyPort, [string]$Xml, [int]$TimeoutSec) {
  if (-not $TimeoutSec) { $TimeoutSec = [int]$Cfg.TallyTimeoutSec }
  Wait-Gentle
  $req = [System.Net.HttpWebRequest]::Create("http://$($Cfg.TallyHost):$TallyPort")
  $req.Method = 'POST'
  $req.ContentType = 'text/xml;charset=utf-8'
  $req.Timeout = $TimeoutSec * 1000
  $req.ReadWriteTimeout = $TimeoutSec * 1000
  $req.KeepAlive = $false
  $body = [Text.Encoding]::UTF8.GetBytes($Xml)
  $req.ContentLength = $body.Length
  $s = $req.GetRequestStream()
  $s.Write($body, 0, $body.Length)
  $s.Close()
  $resp = $req.GetResponse()
  try {
    $rs = $resp.GetResponseStream()
    $ms = New-Object System.IO.MemoryStream
    $rs.CopyTo($ms)
    return (Get-TextFromBytes $ms.ToArray())
  } finally { $resp.Close() }
}

# Tally sometimes sends characters that are not allowed in XML
function ConvertTo-CleanXml([string]$text) {
  $t = [regex]::Replace($text, '&#(x0*[0-8bBcCeEfF]|x0*1[0-9a-fA-F]|0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);', '')
  $t = [regex]::Replace($t, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '')
  # a bare & that is not part of an entity
  $t = [regex]::Replace($t, '&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)', '&amp;')
  return $t
}

function Get-XmlDoc([string]$text) {
  $clean = ConvertTo-CleanXml $text
  $doc = New-Object System.Xml.XmlDocument
  $doc.XmlResolver = $null
  # Tally sends tags like <UDF:FIELD> without declaring the prefix, so read without namespace checking
  $sr = New-Object System.IO.StringReader($clean)
  $reader = New-Object System.Xml.XmlTextReader($sr)
  $reader.Namespaces = $false
  $reader.XmlResolver = $null
  $reader.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
  try { $doc.Load($reader) }
  catch {
    # last resort: drop the prefixes and try again
    $noPrefix = [regex]::Replace($clean, '(</?)([A-Za-z_][\w.-]*):', '$1$2_')
    $noPrefix = [regex]::Replace($noPrefix, '\s([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)=', ' $1_$2=')
    $doc.LoadXml($noPrefix)
  }
  finally { try { $reader.Close() } catch { } }
  return $doc
}

function Esc([string]$s) { return ([string]$s).Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&#34;').Replace("'", '&#39;') }

function New-CollectionRequest([string]$Id, [string]$Type, [string]$Fetch, [string]$Company, [string]$Extra) {
  $sv = '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'
  if ($Company) { $sv += '<SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' }
  return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $Id + '</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES>' + $sv + '</STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="' + $Id + '" ISMODIFY="No"><TYPE>' + $Type + '</TYPE><FETCH>' + $Fetch + '</FETCH>' + $Extra + '</COLLECTION>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}

function Get-NodeText($node, [string]$name) {
  if (-not $node) { return '' }
  $n = $node.SelectSingleNode($name)
  if ($n) { return $n.InnerText.Trim() }
  return ''
}

# ------------------------------------------------------------------ which Tally is yours
$script:MySession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$script:Fake = $null
if ($env:TDSBRIDGE_FAKE -and (Test-Path $env:TDSBRIDGE_FAKE)) {
  # test mode only: processes, listeners and users come from a file
  $script:Fake = Get-Content -Raw $env:TDSBRIDGE_FAKE | ConvertFrom-Json
  $script:MySession = [int]$script:Fake.mySession
}

# Windows users signed in to this server, by session number
function Get-SessionUsers {
  $map = @{}
  if ($script:Fake) { foreach ($p in $script:Fake.users.PSObject.Properties) { $map[[int]$p.Name] = [string]$p.Value }; return $map }
  try {
    $lines = & quser.exe 2>$null
    foreach ($l in $lines) {
      $m = [regex]::Match([string]$l, '^\s*>?(\S+)\s+(?:(\S+)\s+)?(\d+)\s+(Active|Disc|Conn|Listen|Idle)', 'IgnoreCase')
      if ($m.Success) { $map[[int]$m.Groups[3].Value] = $m.Groups[1].Value }
    }
  } catch { }
  if (-not $map.ContainsKey($script:MySession)) { $map[$script:MySession] = $env:USERNAME }
  return $map
}

# Running programs and listening ports (real Windows data, or the test file)
function Get-NetState {
  if ($script:Fake) { $script:Fake = Get-Content -Raw $env:TDSBRIDGE_FAKE | ConvertFrom-Json }
  if ($script:Fake) {
    $procs = @(); foreach ($x in $script:Fake.processes) { $procs += [pscustomobject]@{ Id = [int]$x.pid; ProcessName = [string]$x.name; SessionId = [int]$x.session; Path = [string]$x.path } }
    $lis = @(); foreach ($x in $script:Fake.listeners) { $lis += [pscustomobject]@{ LocalPort = [int]$x.port; OwningProcess = [int]$x.pid } }
    return @{ ok = $true; procs = $procs; listeners = $lis }
  }
  try {
    $procs = @(Get-Process -ErrorAction Stop)
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return @{ ok = $false; procs = $procs; listeners = @() } }
    $lis = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    return @{ ok = $true; procs = $procs; listeners = $lis }
  } catch { return @{ ok = $false; procs = @(); listeners = @() } }
}

# TallyPrime programs that are listening, with the Windows session they run in.
# Returns $null when Windows cannot tell us (then the ports from the settings are tried).
function Get-TallyListeners {
  $ns = Get-NetState
  if (-not $ns.ok) { return $null }
  $procs = @{}
  foreach ($pr in $ns.procs) { if ($pr.ProcessName -match '^tally') { $procs[[int]$pr.Id] = $pr } }
  if ($procs.Count -eq 0) { return ,@() }
  $users = Get-SessionUsers
  $seen = @{}
  $out = @()
  foreach ($c in $ns.listeners) {
    $procId = [int]$c.OwningProcess
    if (-not $procs.ContainsKey($procId)) { continue }
    $port = [int]$c.LocalPort
    if ($seen.ContainsKey($port)) { continue }
    $seen[$port] = $true
    $pr = $procs[$procId]
    $out += [ordered]@{ port = $port; pid = $procId; session = [int]$pr.SessionId; mine = ([int]$pr.SessionId -eq $script:MySession); program = $pr.ProcessName; user = [string]$users[[int]$pr.SessionId] }
  }
  return ,@($out)
}

# Read TallyPrime's own settings (tally.ini next to tally.exe), read-only
function Get-TallyIni([string]$exePath) {
  $info = [ordered]@{ found = $false; path = ''; mode = ''; port = 0 }
  if (-not $exePath) { return $info }
  try {
    $ini = Join-Path (Split-Path -Parent $exePath) 'tally.ini'
    if (-not (Test-Path $ini)) { return $info }
    $text = Get-Content -Raw $ini -ErrorAction Stop
    $info.found = $true; $info.path = $ini
    $m = [regex]::Match($text, '(?im)^\s*client\s*server\s*=\s*(\w+)'); if ($m.Success) { $info.mode = $m.Groups[1].Value }
    $m = [regex]::Match($text, '(?im)^\s*server\s*port\s*=\s*(\d+)'); if ($m.Success) { $info.port = [int]$m.Groups[1].Value }
  } catch { }
  return $info
}

# Plain-language check: is your Tally reachable, and if not, why
function Get-Diagnosis {
  $ns = Get-NetState
  $users = Get-SessionUsers
  $me = [string]$users[$script:MySession]
  $findings = @()
  $add = { param($level, $text, $fix) $script:tmpFindings += ,([ordered]@{ level = $level; text = $text; fix = $fix }) }
  $script:tmpFindings = @()
  $tallies = @()
  $listeners = @()
  $portOwner = @{}
  if ($ns.ok) {
    $byId = @{}
    foreach ($pr in $ns.procs) { $byId[[int]$pr.Id] = $pr }
    foreach ($c in $ns.listeners) {
      $port = [int]$c.LocalPort
      if ($port -lt 9000 -or $port -gt 9999 -or $portOwner.ContainsKey($port)) { continue }
      $pr = $byId[[int]$c.OwningProcess]
      $o = [ordered]@{ port = $port; pid = [int]$c.OwningProcess; program = $(if ($pr) { $pr.ProcessName } else { '' }); session = $(if ($pr) { [int]$pr.SessionId } else { -1 }); user = $(if ($pr) { [string]$users[[int]$pr.SessionId] } else { '' }) }
      $portOwner[$port] = $o
      $listeners += $o
    }
    foreach ($pr in $ns.procs) {
      if ($pr.ProcessName -notmatch '^tally') { continue }
      $ports = @($listeners | Where-Object { $_.pid -eq [int]$pr.Id } | ForEach-Object { $_.port })
      $path = ''
      try { $path = [string]$pr.Path } catch { }
      $tallies += [ordered]@{ pid = [int]$pr.Id; program = $pr.ProcessName; session = [int]$pr.SessionId; user = [string]$users[[int]$pr.SessionId]; mine = ([int]$pr.SessionId -eq $script:MySession); ports = $ports; ini = (Get-TallyIni $path) }
    }
  }
  $free = 0
  foreach ($p in 9001..9099) { if (-not $portOwner.ContainsKey($p)) { $free = $p; break } }
  $mine = @($tallies | Where-Object { $_.mine })
  $others = @($tallies | Where-Object { -not $_.mine })
  if (-not $ns.ok) {
    & $add 'warn' 'Windows did not let the bridge see which programs are running, so it cannot tell which Tally is yours.' 'In FinCom > Settings > Tally Bridge, press "Use this Tally" on your own Tally (the port shown in TallyPrime: F1 > Settings > Connectivity).'
  } elseif ($mine.Count -eq 0) {
    $txt = 'TallyPrime is not running in your Windows login (' + $me + ').'
    if ($others.Count) { $txt += ' TallyPrime is running for: ' + (($others | ForEach-Object { $u = $_.user; if (-not $u) { $u = 'session ' + $_.session }; $u + $(if ($_.ports.Count) { ' (port ' + ($_.ports -join ', ') + ')' } else { '' }) }) -join '; ') + '.' }
    & $add 'bad' $txt ('Open TallyPrime in your own login. If that Tally above is yours, start the bridge from that same login - the bridge only uses the Tally of the Windows user it runs as (' + $me + ').')
  } else {
    foreach ($t in $mine) {
      if ($t.ports.Count) {
        & $add 'ok' ('Your TallyPrime accepts connections on port ' + ($t.ports -join ', ') + '.') ''
        continue
      }
      $want = 9000
      if ($t.ini.port) { $want = [int]$t.ini.port }
      if ($t.ini.found -and $t.ini.mode -and $t.ini.mode -notmatch '^(both|server)$') {
        & $add 'bad' ('Your TallyPrime is not set to accept connections ("TallyPrime acts as" is ' + $t.ini.mode + ').') 'In TallyPrime: F1 Help > Settings > Connectivity > set "TallyPrime acts as" to Both, keep a port, save and restart TallyPrime.'
        continue
      }
      $holder = $portOwner[$want]
      if ($holder -and $holder.pid -ne $t.pid) {
        $who = $holder.user; if (-not $who) { $who = 'Windows session ' + $holder.session }
        if ($holder.program -match '^tally') {
          & $add 'bad' ('Your TallyPrime is running but cannot accept connections: port ' + $want + ' is already taken by the TallyPrime of ' + $who + '. Only one program can use a port, so each user needs a different one.') ('In YOUR TallyPrime: F1 Help > Settings > Connectivity > Port = ' + $free + ' (free), save and restart TallyPrime. If that setting changes the port for every user of the server, ask your server provider to give each user a separate Tally port.')
        } else {
          & $add 'bad' ('Port ' + $want + ' is taken by another program (' + $holder.program + ', ' + $who + '), so your TallyPrime cannot use it.') ('In TallyPrime: F1 Help > Settings > Connectivity > Port = ' + $free + ', save and restart TallyPrime.')
        }
      } else {
        & $add 'bad' ('Your TallyPrime is running but is not accepting connections on port ' + $want + ' yet.') 'In TallyPrime: F1 Help > Settings > Connectivity > "TallyPrime acts as" = Both, then close and reopen TallyPrime (the setting takes effect after a restart).'
      }
    }
  }
  return [ordered]@{ ok = $true; version = $BridgeVersion; user = $me; mySession = $script:MySession; seeProcesses = [bool]$ns.ok; findings = $script:tmpFindings; tallies = $tallies; listeners = $listeners; freePort = $free }
}

function Get-PortPlan {
  $cfgPorts = $Cfg.TallyPorts
  if ($cfgPorts -and -not ($cfgPorts -is [string])) {
    $list = @()
    foreach ($p in @($cfgPorts)) { $list += [ordered]@{ port = [int]$p; pid = $null; session = $null; mine = $null; program = '' } }
    return @{ mode = 'config'; ports = $list }
  }
  $found = Get-TallyListeners
  if ($null -eq $found) {
    $list = @()
    foreach ($p in @($Cfg.FallbackPorts)) { $list += [ordered]@{ port = [int]$p; pid = $null; session = $null; mine = $null; program = '' } }
    return @{ mode = 'fallback'; ports = $list }
  }
  return @{ mode = 'auto'; ports = @($found) }
}

# Companies open in each Tally session (cached for 30 seconds)
$script:CompanyCache = $null
$script:CompanyCacheAt = [datetime]::MinValue
$script:PlanMode = ''
function Get-OpenCompanies([switch]$Fresh) {
  $cacheSec = [int]$Cfg.StatusCacheSec
  if ($cacheSec -lt 5) { $cacheSec = 5 }
  if (-not $Fresh -and $script:CompanyCache -and ((Get-Date) - $script:CompanyCacheAt).TotalSeconds -lt $cacheSec) { return $script:CompanyCache }
  $plan = Get-PortPlan
  $script:PlanMode = $plan.mode
  $sessions = @()
  foreach ($pp in $plan.ports) {
    $entry = [ordered]@{ port = [int]$pp.port; ok = $false; companies = @(); error = ''; mine = $pp.mine; session = $pp.session; program = $pp.program; user = $pp.user; skipped = $false }
    if ($Cfg.OnlyMySession -and $pp.mine -eq $false) {
      # another Windows user's Tally: listed, never read or written
      $entry.skipped = $true
      $who = $pp.user; if (-not $who) { $who = 'Windows session ' + $pp.session }
      $entry.error = "Tally of " + $who
      $sessions += $entry
      continue
    }
    try {
      $xml = Invoke-Tally -TallyPort $pp.port -Xml (New-CollectionRequest 'TDSDeskCompanies' 'Company' 'NAME,STARTINGFROM,ENDINGAT,GUID,BASICCOMPANYFORMALNAME,GSTREGISTRATIONNUMBER,INCOMETAXNUMBER,STATENAME,GSTREGISTRATIONDETAILS.LIST' '' '') -TimeoutSec 4
      $doc = Get-XmlDoc $xml
      $list = @()
      foreach ($c in $doc.SelectNodes('//COMPANY')) {
        $name = $c.GetAttribute('NAME')
        if (-not $name) { $name = Get-NodeText $c 'NAME' }
        $g = Get-NodeText $c 'GSTREGISTRATIONNUMBER'
        if (-not $g) { $g = Get-NodeText $c 'GSTREGISTRATIONDETAILS.LIST/GSTIN' }
        if ($name) { $list += [ordered]@{ name = $name; from = (Get-NodeText $c 'STARTINGFROM'); to = (Get-NodeText $c 'ENDINGAT'); guid = (Get-NodeText $c 'GUID'); gstin = $g; pan = (Get-NodeText $c 'INCOMETAXNUMBER') } }
      }
      $entry.ok = $true
      $entry.companies = $list
    } catch { $entry.error = $_.Exception.Message }
    $sessions += $entry
  }
  $script:CompanyCache = $sessions
  $script:CompanyCacheAt = Get-Date
  return $sessions
}

# The Tally to use for a company. A port chosen in FinCom wins; otherwise the company must be open
# in exactly one Tally (your own session first) - the bridge never guesses between two.
function Find-CompanyPort([string]$Company, [int]$PreferredPort) {
  foreach ($fresh in @($false, $true)) {
    $sessions = if ($fresh) { @(Get-OpenCompanies -Fresh) } else { @(Get-OpenCompanies) }
    $usable = @($sessions | Where-Object { -not $_.skipped -and $_.ok })
    if ($PreferredPort -gt 0) {
      $s = $usable | Where-Object { $_.port -eq $PreferredPort } | Select-Object -First 1
      if ($s -and (@($s.companies | Where-Object { $_.name -eq $Company }).Count -gt 0)) { return [int]$PreferredPort }
      if ($fresh) {
        if (-not $s) { throw "The Tally chosen in FinCom (port $PreferredPort) is not running in your Windows session. Start it, or choose another Tally in FinCom > Settings > Tally Bridge." }
        throw "Company '$Company' is not open in the Tally chosen in FinCom (port $PreferredPort). Open it there."
      }
      continue
    }
    $withIt = @($usable | Where-Object { @($_.companies | Where-Object { $_.name -eq $Company }).Count -gt 0 })
    if ($withIt.Count -eq 1) { return [int]$withIt[0].port }
    if ($withIt.Count -gt 1) {
      $mine = @($withIt | Where-Object { $_.mine -eq $true })
      if ($mine.Count -eq 1) { return [int]$mine[0].port }
      if ($fresh) { throw ("Company '$Company' is open in more than one Tally (ports " + (($withIt | ForEach-Object { $_.port }) -join ', ') + "). Choose your Tally in FinCom > Settings > Tally Bridge.") }
    }
  }
  throw "Company '$Company' is not open in Tally. Open it in TallyPrime on this computer and try again."
}

function Get-Ledgers([string]$Company, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $fetch = 'NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE,EMAIL,LEDGERPHONE,LEDGERMOBILE,ADDRESS.LIST,LEDMAILINGDETAILS.LIST'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml (New-CollectionRequest 'TDSDeskLedgers' 'Ledger' $fetch $Company ''))
  $ledgers = @()
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $name = $l.GetAttribute('NAME')
    if (-not $name) { $name = Get-NodeText $l 'NAME' }
    if (-not $name) { continue }
    $gstin = Get-NodeText $l 'PARTYGSTIN'
    if (-not $gstin) { $gstin = Get-NodeText $l 'LEDGSTREGDETAILS.LIST/GSTIN' }
    $addr = @(); foreach ($an in $l.SelectNodes('ADDRESS.LIST/ADDRESS')) { if ($an.InnerText.Trim()) { $addr += $an.InnerText.Trim() } }
    if (-not $addr.Count) { foreach ($an in $l.SelectNodes('LEDMAILINGDETAILS.LIST/ADDRESS.LIST/ADDRESS')) { if ($an.InnerText.Trim()) { $addr += $an.InnerText.Trim() } } }
    $ledgers += [ordered]@{
      name = $name; group = (Get-NodeText $l 'PARENT'); pan = (Get-NodeText $l 'INCOMETAXNUMBER'); gstin = $gstin
      email = (Get-NodeText $l 'EMAIL'); phone = (Get-NodeText $l 'LEDGERPHONE'); mobile = (Get-NodeText $l 'LEDGERMOBILE'); address = @($addr)
      billwise = (Get-NodeText $l 'ISBILLWISEON'); guid = (Get-NodeText $l 'GUID'); alterId = (Get-NodeText $l 'ALTERID')
      acNo = (Get-NodeText $l 'PAYMENTDETAILS.LIST/ACCOUNTNUMBER'); ifsc = (Get-NodeText $l 'PAYMENTDETAILS.LIST/IFSCODE')
      taxType = (Get-NodeText $l 'TAXTYPE'); dutyHead = (Get-NodeText $l 'GSTDUTYHEAD')
      tdsNature = $(if (Get-NodeText $l 'TDSNATUREOFPAYMENT') { Get-NodeText $l 'TDSNATUREOFPAYMENT' } else { Get-NodeText $l 'NATUREOFPAYMENT' })
    }
  }
  $gdoc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml (New-CollectionRequest 'TDSDeskGroups' 'Group' 'NAME,PARENT,GUID' $Company ''))
  $groups = @()
  foreach ($g in $gdoc.SelectNodes('//GROUP')) {
    $name = $g.GetAttribute('NAME')
    if (-not $name) { $name = Get-NodeText $g 'NAME' }
    if ($name) { $groups += [ordered]@{ name = $name; parent = (Get-NodeText $g 'PARENT') } }
  }
  return [ordered]@{ ok = $true; company = $Company; port = $port; ledgers = $ledgers; groups = $groups }
}

function ConvertTo-TallyDate([datetime]$d) { return $d.ToString('yyyyMMdd') }

# Vouchers from the Day Book, a month at a time; optionally only those touching one ledger
function Get-Vouchers([string]$Company, [string]$From, [string]$To, [string]$Ledger, [string]$Types, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $start = [datetime]::ParseExact($From, 'yyyyMMdd', $null)
  $end = [datetime]::ParseExact($To, 'yyyyMMdd', $null)
  $typeList = @()
  if ($Types) { $typeList = $Types.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
  $out = New-Object System.Collections.ArrayList
  $cur = $start
  while ($cur -le $end) {
    $chunkEnd = $cur.AddMonths(1).AddDays(-1)
    if ($chunkEnd -gt $end) { $chunkEnd = $end }
    $req = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>' +
      '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY><SVFROMDATE>' + (ConvertTo-TallyDate $cur) + '</SVFROMDATE><SVTODATE>' + (ConvertTo-TallyDate $chunkEnd) + '</SVTODATE>' +
      '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
    $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml $req)
    foreach ($v in $doc.SelectNodes('//VOUCHER')) {
      $type = Get-NodeText $v 'VOUCHERTYPENAME'
      if (-not $type) { $type = $v.GetAttribute('VCHTYPE') }
      if ($typeList.Count -gt 0 -and -not ($typeList -contains $type)) { continue }
      $entries = @()
      $touches = -not $Ledger
      $lists = $v.SelectNodes('ALLLEDGERENTRIES.LIST | LEDGERENTRIES.LIST')
      foreach ($e in $lists) {
        $lname = Get-NodeText $e 'LEDGERNAME'
        if ($Ledger -and $lname -eq $Ledger) { $touches = $true }
        $bank = $e.SelectSingleNode('BANKALLOCATIONS.LIST')
        $bills = @()
        foreach ($b in $e.SelectNodes('BILLALLOCATIONS.LIST')) { $bills += [ordered]@{ name = (Get-NodeText $b 'NAME'); type = (Get-NodeText $b 'BILLTYPE'); amount = (Get-NodeText $b 'AMOUNT') } }
        $entries += [ordered]@{
          ledger = $lname; amount = (Get-NodeText $e 'AMOUNT'); deemedPositive = (Get-NodeText $e 'ISDEEMEDPOSITIVE')
          bankDate = (Get-NodeText $bank 'BANKERSDATE'); instrument = (Get-NodeText $bank 'INSTRUMENTNUMBER'); txType = (Get-NodeText $bank 'TRANSACTIONTYPE'); bills = $bills
        }
      }
      if (-not $touches) { continue }
      [void]$out.Add([ordered]@{
        guid = (Get-NodeText $v 'GUID'); masterId = (Get-NodeText $v 'MASTERID'); date = (Get-NodeText $v 'DATE'); type = $type
        number = (Get-NodeText $v 'VOUCHERNUMBER'); reference = (Get-NodeText $v 'REFERENCE'); party = (Get-NodeText $v 'PARTYLEDGERNAME')
        narration = (Get-NodeText $v 'NARRATION'); optional = (Get-NodeText $v 'ISOPTIONAL'); cancelled = (Get-NodeText $v 'ISCANCELLED'); entries = $entries
      })
    }
    if ($true) {
      try {
        $known = @{}
        foreach ($x in $out) { if ($x.guid) { $known[$x.guid] = $true } }
        foreach ($h in (Get-VoucherHeads -Port $port -Company $Company -From (ConvertTo-TallyDate $cur) -To (ConvertTo-TallyDate $chunkEnd))) {
          if ($h.guid -and $known.ContainsKey($h.guid)) { continue }
          if ($typeList.Count -gt 0 -and -not ($typeList -contains $h.type)) { continue }
          if ($h.optional -notmatch '^yes$') { continue }
          [void]$out.Add($h)
        }
      } catch { }
    }
    $cur = $chunkEnd.AddDays(1)
  }
  return [ordered]@{ ok = $true; company = $Company; port = $port; count = $out.Count; vouchers = $out.ToArray() }
}

# one ledger's vouchers, filtered by Tally itself: far lighter than reading the Day Book
function Get-LedgerVouchers([string]$Company, [string]$Ledger, [string]$From, [string]$To, [int]$PinPort) {
  $port = Find-CompanyPort $Company $PinPort
  $req = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Ledger Vouchers</REPORTNAME>' +
    '<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE><LEDGERNAME>' + (Esc $Ledger) + '</LEDGERNAME>' +
    '</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
  $raw = Invoke-Tally -TallyPort $port -Xml $req
  $doc = Get-XmlDoc $raw
  $rows = @(); $cur = $null
  foreach ($n in $doc.SelectNodes('//*')) {
    switch ($n.Name) {
      'DSPVCHDATE'       { if ($cur) { $rows += $cur }; $cur = [ordered]@{ date = $n.InnerText.Trim(); other = ''; type = ''; dr = ''; cr = '' } }
      'DSPVCHLEDACCOUNT' { if ($cur -and -not $cur.other) { $cur.other = $n.InnerText.Trim() } }
      'DSPVCHTYPE'       { if ($cur) { $cur.type = $n.InnerText.Trim() } }
      'DSPVCHDRAMT'      { if ($cur) { $cur.dr = $n.InnerText.Trim() } }
      'DSPVCHCRAMT'      { if ($cur) { $cur.cr = $n.InnerText.Trim() } }
    }
  }
  if ($cur) { $rows += $cur }
  return [ordered]@{ ok = $true; company = $Company; port = $port; ledger = $Ledger; count = $rows.Count; rows = $rows }
}
function Get-VoucherHeads([int]$Port, [string]$Company, [string]$From, [string]$To) {
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskVchHeads</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskVchHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ISOPTIONAL,ISCANCELLED</FETCH></COLLECTION>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req)
  $list = @()
  foreach ($v in $doc.SelectNodes('//VOUCHER')) {
    $d = Get-NodeText $v 'DATE'
    if ($d -and ($d -lt $From -or $d -gt $To)) { continue }
    $type = Get-NodeText $v 'VOUCHERTYPENAME'; if (-not $type) { $type = $v.GetAttribute('VCHTYPE') }
    $list += [ordered]@{ guid = (Get-NodeText $v 'GUID'); masterId = (Get-NodeText $v 'MASTERID'); date = $d; type = $type; number = (Get-NodeText $v 'VOUCHERNUMBER')
      reference = (Get-NodeText $v 'REFERENCE'); party = (Get-NodeText $v 'PARTYLEDGERNAME'); narration = (Get-NodeText $v 'NARRATION')
      optional = (Get-NodeText $v 'ISOPTIONAL'); cancelled = (Get-NodeText $v 'ISCANCELLED'); entries = @() }
  }
  return ,@($list)
}

# Day Book report for a date range (regular vouchers only), as voucher heads
function Get-DayBookHeads([int]$Port, [string]$Company, [string]$From, [string]$To) {
  $req = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>' +
    '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY><SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE>' +
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req)
  $list = @()
  foreach ($v in $doc.SelectNodes('//VOUCHER')) {
    $type = Get-NodeText $v 'VOUCHERTYPENAME'; if (-not $type) { $type = $v.GetAttribute('VCHTYPE') }
    $list += [ordered]@{ guid = (Get-NodeText $v 'GUID'); masterId = (Get-NodeText $v 'MASTERID'); date = (Get-NodeText $v 'DATE'); type = $type; number = (Get-NodeText $v 'VOUCHERNUMBER')
      reference = (Get-NodeText $v 'REFERENCE'); party = (Get-NodeText $v 'PARTYLEDGERNAME'); narration = (Get-NodeText $v 'NARRATION'); optional = (Get-NodeText $v 'ISOPTIONAL') }
  }
  return ,@($list)
}

# After Tally says "created", read the voucher back several ways.
# found: $true (seen), $false (a working read did not show it), $null (no read showed any voucher)
function Confirm-Voucher([int]$Port, [string]$Company, [string]$Xml, [string]$VchId) {
  $m = [regex]::Match($Xml, '<DATE>(\d{8})</DATE>')
  if (-not $m.Success) { return @{ found = $null; note = 'no date in the entry' } }
  $date = $m.Groups[1].Value
  $tag = [regex]::Match($Xml, 'TDSDesk:[A-Za-z0-9._-]+')
  $ref = [regex]::Match($Xml, '<REFERENCE>([^<]*)</REFERENCE>')
  $d0 = [datetime]::ParseExact($date, 'yyyyMMdd', $null)
  $wideFrom = ConvertTo-TallyDate $d0.AddDays(-30); $wideTo = ConvertTo-TallyDate $d0.AddDays(30)
  $isOurs = {
    param($h)
    if ($tag.Success) { return ([string]$h.narration -like ('*' + $tag.Value + '*')) }
    if ($VchId -and $h.masterId -eq $VchId) { return $true }
    return ($ref.Success -and $ref.Groups[1].Value -and $h.reference -eq [System.Net.WebUtility]::HtmlDecode($ref.Groups[1].Value) -and $h.date -eq $date)
  }
  $sawAny = $false
  $notes = @()
  $tries = @(
    @{ name = 'voucher list (day)'; run = { Get-VoucherHeads -Port $Port -Company $Company -From $date -To $date } },
    @{ name = 'Day Book (day)'; run = { Get-DayBookHeads -Port $Port -Company $Company -From $date -To $date } },
    @{ name = 'voucher list (60 days)'; run = { Get-VoucherHeads -Port $Port -Company $Company -From $wideFrom -To $wideTo } },
    @{ name = 'Day Book (60 days)'; run = { Get-DayBookHeads -Port $Port -Company $Company -From $wideFrom -To $wideTo } }
  )
  foreach ($t in $tries) {
    try {
      $heads = & $t.run
      if ($null -eq $heads) { $heads = @() }
      $notes += ($t.name + ': ' + $heads.Count)
      if ($heads.Count -gt 0) { $sawAny = $true }
      $hit = $null
      foreach ($h in $heads) { if (& $isOurs $h) { $hit = $h; break } }
      if ($hit) { return @{ found = $true; optional = ($hit.optional -match '^yes$'); number = $hit.number; type = $hit.type; date = $date; how = $t.name; note = ($notes -join '; ') } }
    } catch { $notes += ($t.name + ': failed (' + $_.Exception.Message + ')') }
  }
  # an Optional entry is only visible in the voucher list; if that list shows nothing here, we cannot tell
  $isOptional = $Xml -match '<ISOPTIONAL>\s*Yes\s*</ISOPTIONAL>'
  $listWorks = @($notes | Where-Object { $_ -match '^voucher list .*: [1-9]' }).Count -gt 0
  if ($isOptional -and -not $listWorks) { return @{ found = $null; date = $date; note = (($notes -join '; ') + '; Optional vouchers cannot be listed on this Tally') } }
  if ($sawAny) { return @{ found = $false; date = $date; note = ($notes -join '; ') } }
  return @{ found = $null; date = $date; note = ($notes -join '; ') }
}

# What reading works on this Tally (nothing is written)
function Invoke-ReadTest([string]$Company, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $to = Get-Date; $from = $to.AddDays(-90)
  $f = ConvertTo-TallyDate $from; $t = ConvertTo-TallyDate $to
  $out = [ordered]@{ ok = $true; company = $Company; port = $port; from = $f; to = $t; tests = @() }
  $probe = {
    param($name, $block)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
      $r = & $block
      if ($null -eq $r) { $r = @() }
      $opt = 0
      foreach ($x in $r) { if ([string]$x.optional -match '^yes$') { $opt++ } }
      $out.tests += [ordered]@{ name = $name; ok = $true; count = @($r).Count; ms = $sw.ElapsedMilliseconds; optional = $opt }
    }
    catch { $out.tests += [ordered]@{ name = $name; ok = $false; error = $_.Exception.Message; ms = $sw.ElapsedMilliseconds } }
  }
  & $probe 'Ledgers' { ,@((Get-Ledgers $Company $port).ledgers) }
  & $probe 'Day Book, last 90 days' { Get-DayBookHeads -Port $port -Company $Company -From $f -To $t }
  & $probe 'Voucher list, last 90 days (includes Optional)' { Get-VoucherHeads -Port $port -Company $Company -From $f -To $t }
  return $out
}

function Read-ImportResult([string]$text) {
  $num = {
    param($tag)
    $m = [regex]::Match($text, '<' + $tag + '>\s*(-?\d+)\s*</' + $tag + '>')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return 0
  }
  $errs = @()
  foreach ($m in [regex]::Matches($text, '<LINEERROR>([\s\S]*?)</LINEERROR>')) { $errs += [System.Net.WebUtility]::HtmlDecode([System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value.Trim())) }
  $created = & $num 'CREATED'; $altered = & $num 'ALTERED'; $errors = & $num 'ERRORS'; $exceptions = & $num 'EXCEPTIONS'; $ignored = & $num 'IGNORED'
  $lastVch = [regex]::Match($text, '<LASTVCHID>\s*(\d+)\s*</LASTVCHID>')
  $ok = ($created + $altered) -gt 0 -and $errors -eq 0 -and $exceptions -eq 0
  $msg = ($errs -join ' ')
  if (-not $ok -and -not $msg) {
    if ($ignored -gt 0) { $msg = 'Tally ignored it (it may already exist).' }
    elseif ($exceptions -gt 0) { $msg = 'Tally reported an exception. Check the ledger names and the voucher type.' }
    else { $msg = 'Tally did not create it.' }
  }
  $vchId = ''
  if ($lastVch.Success) { $vchId = $lastVch.Groups[1].Value }
  return [ordered]@{ ok = $ok; created = $created; altered = $altered; errors = $errors; exceptions = $exceptions; ignored = $ignored; message = $msg; lastVchId = $vchId }
}

# Posts masters first, then vouchers, one request each so every item gets its own result
function Invoke-Import($payload) {
  if (-not $Cfg.AllowImport) { throw 'Posting to Tally is switched off in tds-bridge.config.json (AllowImport).' }
  $company = [string]$payload.company
  if (-not $company) { throw 'No company given.' }
  $pref = 0
  if ($payload.port) { $pref = [int]$payload.port }
  $port = Find-CompanyPort $company $pref
  $results = @()
  $pending = @()
  $groups = @(@{ kind = 'master'; report = 'All Masters'; items = @($payload.masters) }, @{ kind = 'voucher'; report = 'Vouchers'; items = @($payload.vouchers) })
  foreach ($g in $groups) {
    foreach ($it in $g.items) {
      if (-not $it) { continue }
      $xml = [string]$it.xml
      # a voucher type may only have its numbering changed: no other field, and only an Alter
      $vtOnly = $false
      if ($xml -match '^\s*<VOUCHERTYPE\b') {
        $inner = [regex]::Replace($xml, '(?s)^\s*<VOUCHERTYPE[^>]*>|</VOUCHERTYPE>\s*$', '')
        $tags = @([regex]::Matches($inner, '<([A-Z.]+)>') | ForEach-Object { $_.Groups[1].Value })
        $vtOnly = ($xml -match 'ACTION="Alter"') -and ($tags.Count -gt 0) -and (@($tags | Where-Object { $_ -notin @('NAME', 'NUMBERINGMETHOD', 'PREVENTDUPLICATES') }).Count -eq 0)
      }
      if (($xml -match '^\s*<VOUCHER\b') -and ($xml -notmatch '<DATE>(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])</DATE>')) { $results += [ordered]@{ id = $it.id; kind = $g.kind; ok = $false; message = 'The entry has no valid date, so it was not sent to Tally.' }; continue }
      if (($xml -notmatch '^\s*<(VOUCHER|LEDGER|GROUP)\b') -and -not $vtOnly) { $results += [ordered]@{ id = $it.id; kind = $g.kind; ok = $false; message = 'Only VOUCHER, LEDGER or GROUP objects can be posted, or a voucher type''s numbering changed.' }; continue }
      $env = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $g.report + '</REPORTNAME>' +
        '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $company) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' +
        '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $xml + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
      try {
        $rawReply = Invoke-Tally -TallyPort $port -Xml $env
        $r = Read-ImportResult $rawReply
        $flat = ($rawReply -replace '\s+', ' ')
        $r['replySnip'] = $flat.Substring(0, [Math]::Min(300, $flat.Length))
        Write-Log ("    Tally replied: " + (($rawReply -replace '\s+', ' ') -replace '^.*?(<IMPORTRESULT>|<RESPONSE>)', '$1').Substring(0, [Math]::Min(400, (($rawReply -replace '\s+', ' ') -replace '^.*?(<IMPORTRESULT>|<RESPONSE>)', '$1').Length)))
        $r['id'] = $it.id; $r['kind'] = $g.kind; $r['company'] = $company; $r['port'] = $port
        if ($r.ok -and $g.kind -eq 'voucher') {
          # confirmed later, for the whole batch at once
          $r['xmlSent'] = $xml
          $pending += $r
        }
        $results += $r
        Write-Log ("  " + $g.kind + " " + $it.id + ": " + $(if ($r.ok) { 'created' + $(if ($r['verified'] -eq $true) { ' and found in Tally' + $(if ($r['optional']) { ' (Optional voucher)' } else { '' }) } else { ' (not read back)' }) } else { 'FAILED ' + $r.message }))
      } catch {
        $results += [ordered]@{ id = $it.id; kind = $g.kind; ok = $false; message = 'Tally did not answer: ' + $_.Exception.Message }
      }
    }
  }
  # ---- one read-back for everything just posted ----
  if ($pending.Count -gt 0) {
    $dates = @()
    foreach ($r in $pending) { $m = [regex]::Match([string]$r.xmlSent, '<DATE>(\d{8})</DATE>'); if ($m.Success) { $dates += $m.Groups[1].Value } }
    $dates = @($dates | Sort-Object -Unique)
    $heads = @()
    if ($dates.Count -gt 0) {
      $from = $dates[0]; $to = $dates[$dates.Count - 1]
      $listSeesOptional = $false
      foreach ($try in @('list', 'daybook')) {
        try {
          $heads = if ($try -eq 'list') { Get-VoucherHeads -Port $port -Company $company -From $from -To $to } else { Get-DayBookHeads -Port $port -Company $company -From $from -To $to }
          if ($null -eq $heads) { $heads = @() }
          if (@($heads).Count -gt 0) {
            # the voucher list is only trusted for Optional entries if it actually shows Optional ones
            if ($try -eq 'list') { foreach ($h in @($heads)) { if ([string]$h.optional -match '^yes$') { $listSeesOptional = $true; break } } }
            break
          }
        } catch { $heads = @() }
      }
      Write-Log ("  read-back for the batch: " + @($heads).Count + " vouchers listed for " + $from + " to " + $to)
    }
    $seen = @{}
    foreach ($h in $heads) { if ($h.narration) { $seen[[string]$h.narration] = $h } }
    foreach ($r in $pending) {
      $tag = [regex]::Match([string]$r.xmlSent, 'TDSDesk:[A-Za-z0-9._-]+')
      $hit = $null
      if ($tag.Success) { foreach ($h in $heads) { if ([string]$h.narration -like ('*' + $tag.Value + '*')) { $hit = $h; break } } }
      # Tally's "last voucher id" can point at an older voucher, so it is only trusted when the entry carries no tag of its own
      elseif ($r.lastVchId) { foreach ($h in $heads) { if ($h.masterId -eq $r.lastVchId) { $hit = $h; break } } }
      if ($hit) {
        $r['verified'] = $true; $r['optional'] = ([string]$hit.optional -match '^yes$'); $r['vchNumber'] = [string]$hit.number; $r['vchType'] = [string]$hit.type
        $r['guid'] = [string]$hit.guid; $r['masterId'] = [string]$hit.masterId; $r['vchDate'] = [string]$hit.date
      } elseif ([string]$r.xmlSent -match '<ISOPTIONAL>\s*Yes' -and -not $listSeesOptional) {
        # an Optional entry that this Tally will not show us: we cannot tell, so we say so plainly
        $r['verified'] = $null
        $r['verifyNote'] = 'posted as an Optional voucher, which this Tally does not list'
        $r.message = "Tally created this as an Optional voucher, which does not show in the Day Book and cannot be read back here. Look for it in Display More Reports > Exception Reports > Optional Vouchers before posting it again."
      } elseif (@($heads).Count -gt 0) {
        $r['verified'] = $false
        $r.ok = $false
        # did it land in another company open in this Tally?
        $elsewhere = ''
        if ($tag.Success) {
          try {
            $sess = @(Get-OpenCompanies | Where-Object { $_.port -eq $port })
            foreach ($sx in $sess) {
              foreach ($cx in @($sx.companies)) {
                $cn = [string]$cx.name
                if (-not $cn -or $cn -eq $company) { continue }
                $other = Get-VoucherHeads -Port $port -Company $cn -From $from -To $to
                foreach ($h in @($other)) { if ([string]$h.narration -like ('*' + $tag.Value + '*')) { $elsewhere = $cn; break } }
                if ($elsewhere) { break }
              }
              if ($elsewhere) { break }
            }
          } catch { }
        }
        if ($elsewhere) {
          $r['wrongCompany'] = $elsewhere
          $r.message = "Tally put this entry into '" + $elsewhere + "', not '" + $company + "'. Delete it from '" + $elsewhere + "' in Tally, close that company (or make '" + $company + "' the active one), then post again."
          Write-Log ("  WRONG COMPANY: " + $tag.Value + " went into '" + $elsewhere + "' instead of '" + $company + "'")
        } else {
          $r.message = "Tally replied 'created', but the entry cannot be found in '" + $company + "' or in any other company open in this Tally. It was not marked as posted. Tally's reply: " + $r.replySnip
        }
      } else {
        $r['verified'] = $null
        $r['verifyNote'] = 'Tally listed no vouchers for those dates'
      }
      $r.Remove('xmlSent')
    }
  }
  $okCount = @($results | Where-Object { $_.ok }).Count
  Write-Log ("Import into '" + $company + "': " + $okCount + " of " + $results.Count + " created")
  return [ordered]@{ ok = $true; company = $company; port = $port; results = $results }
}

# ------------------------------------------------------------------ the small web server
function Get-QueryValues([string]$query) {
  $h = @{}
  if (-not $query) { return $h }
  foreach ($pair in $query.TrimStart('?').Split('&')) {
    if (-not $pair) { continue }
    $kv = $pair.Split('=', 2)
    $k = [Uri]::UnescapeDataString($kv[0].Replace('+', ' '))
    $v = ''
    if ($kv.Length -gt 1) { $v = [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) }
    $h[$k] = $v
  }
  return $h
}

function Send-Response($stream, [int]$status, [string]$body, [string]$origin) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 401 = 'Unauthorized'; 404 = 'Not Found'; 500 = 'Internal Server Error'; 502 = 'Bad Gateway' }[$status]
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $head = "HTTP/1.1 $status $reason`r`n" +
    "Content-Type: application/json; charset=utf-8`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    $(if ($origin) { "Access-Control-Allow-Origin: $origin`r`n" } else { '' }) +
    "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
    "Access-Control-Allow-Headers: Content-Type, X-Bridge-Key`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Access-Control-Max-Age: 600`r`n" +
    "Cache-Control: no-store`r`n" +
    "Vary: Origin`r`n" +
    "Connection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

# the pages allowed to talk to the bridge: FinCom's own addresses (settings: AllowedOrigins); 'http://localhost' allows any port
function Test-AllowedOrigin([string]$o) {
  if (-not $o) { return $true }
  # 1.12.11: FinCom's own addresses are always allowed, also with a settings file saved by an older bridge
  foreach ($a in @('https://app.fincom.live', 'https://staging.fincom.live', 'https://fincom.live', 'https://caanshulgarg.github.io')) { if ($o -eq $a) { return $true } }
  foreach ($a in @($Cfg.AllowedOrigins)) {
    $a = [string]$a
    if ($o -eq $a) { return $true }
    if (($a -eq 'http://localhost') -and ($o -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$')) { return $true }
  }
  return $false
}

function ConvertTo-JsonText($obj) { return (ConvertTo-Json -InputObject $obj -Depth 12 -Compress) }

function Find-Bytes([byte[]]$data, [int]$count, [byte[]]$pattern) {
  for ($i = 0; $i -le $count - $pattern.Length; $i++) {
    $hit = $true
    for ($j = 0; $j -lt $pattern.Length; $j++) { if ($data[$i + $j] -ne $pattern[$j]) { $hit = $false; break } }
    if ($hit) { return $i }
  }
  return -1
}

function Invoke-Client($client) {
  $client.ReceiveTimeout = 30000
  $client.SendTimeout = 30000
  $stream = $client.GetStream()
  $buf = New-Object byte[] 65536
  $data = New-Object System.IO.MemoryStream
  $headerEnd = -1
  $sep = [byte[]](13, 10, 13, 10)
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return }
    $data.Write($buf, 0, $n)
    $all = $data.ToArray()
    $headerEnd = Find-Bytes $all $all.Length $sep
    if ($data.Length -gt 65536 -and $headerEnd -lt 0) { return }
  }
  $all = $data.ToArray()
  $headText = [Text.Encoding]::ASCII.GetString($all, 0, $headerEnd)
  $lines = $headText -split "`r`n"
  $first = $lines[0].Split(' ')
  $method = $first[0].ToUpperInvariant()
  $target = $first[1]
  $headers = @{}
  $rest = @()
  if ($lines.Length -gt 1) { $rest = $lines[1..($lines.Length - 1)] }
  foreach ($l in $rest) {
    $i = $l.IndexOf(':')
    if ($i -gt 0) { $headers[$l.Substring(0, $i).Trim().ToLowerInvariant()] = $l.Substring($i + 1).Trim() }
  }
  $len = 0
  if ($headers.ContainsKey('content-length')) { $len = [int]$headers['content-length'] }
  if ($len -gt 50MB) { Send-Response $stream 400 (ConvertTo-JsonText @{ ok = $false; error = 'Request too large.' }) '*'; return }
  $bodyStart = $headerEnd + 4
  while (($all.Length - $bodyStart) -lt $len) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $data.Write($buf, 0, $n)
    $all = $data.ToArray()
  }
  $body = ''
  if ($len -gt 0) { $body = [Text.Encoding]::UTF8.GetString($all, $bodyStart, [Math]::Min($len, $all.Length - $bodyStart)) }

  # a browser always says which page is asking; only FinCom's own pages (the allowed origins) are answered in a way the page can read
  $sentOrigin = ''
  if ($headers.ContainsKey('origin')) { $sentOrigin = [string]$headers['origin'] }
  $originOk = Test-AllowedOrigin $sentOrigin
  $origin = $(if ($sentOrigin -and $originOk) { $sentOrigin } else { '' })
  $path = $target
  $query = ''
  $q = $target.IndexOf('?')
  if ($q -ge 0) { $path = $target.Substring(0, $q); $query = $target.Substring($q + 1) }
  $qs = Get-QueryValues $query

  if ($method -eq 'OPTIONS') { Send-Response $stream 204 '' $origin; return }
  if ($path -eq '/ping') { Send-Response $stream 200 (ConvertTo-JsonText ([ordered]@{ ok = $true; bridge = 'FinCom Tally Bridge'; version = $BridgeVersion })) $origin; return }
  # FinCom on this same computer may fetch the key itself for a while after the bridge starts
  if ($sentOrigin -and -not $originOk -and $path -ne '/ping') {
    Write-Log ('Refused a request from the web page ' + $sentOrigin + ' (not FinCom).')
    Send-Response $stream 403 (ConvertTo-JsonText ([ordered]@{ ok = $false; error = 'This bridge answers FinCom only.' })) $origin
    return
  }
  if ($path -eq '/pair') {
    $code = [string]$qs['code']
    if ((Get-Date) -gt $script:PairUntil) { }
    elseif ($code -ne $script:PairCode) {
      $script:PairTries++
      Write-Log ('A wrong connect code was typed (' + $script:PairTries + ' of 5).')
      if ($script:PairTries -ge 5) { $script:PairUntil = (Get-Date).AddMinutes(-1); Write-Log 'Five wrong codes: connecting is closed until the bridge is started again.' }
      Send-Response $stream 403 (ConvertTo-JsonText ([ordered]@{ ok = $false; error = $(if ($code) { 'That is not the code shown in the bridge window.' } else { 'Type the 6-digit code shown in the bridge window.' }); needCode = $true })) $origin
      return
    }
    if ((Get-Date) -le $script:PairUntil) {
      $script:PairUntil = (Get-Date).AddMinutes(-1)      # one connection per start
      Write-Log ('FinCom connected with the code (' + $sentOrigin + ').')
      Send-Response $stream 200 (ConvertTo-JsonText ([ordered]@{ ok = $true; key = $Cfg.Key; computer = $env:COMPUTERNAME; user = $env:USERNAME; version = $BridgeVersion })) $origin
    } else {
      Send-Response $stream 403 (ConvertTo-JsonText ([ordered]@{ ok = $false; error = 'The connect window has closed. Start the bridge again (Start-TDS-Bridge), then press Connect in FinCom within ' + $Cfg.PairWindowMin + ' minutes.' })) $origin
    }
    return
  }

  $key = ''
  if ($headers.ContainsKey('x-bridge-key')) { $key = $headers['x-bridge-key'] }
  if ($key -ne $Cfg.Key) {
    Send-Response $stream 401 (ConvertTo-JsonText @{ ok = $false; error = 'Wrong bridge key. Copy the key shown in the bridge window into FinCom Settings.' }) $origin
    return
  }
  try {
    $result = $null
    switch ($path) {
      '/status' {
        $jobsNow = @(Get-ActiveJobs | Where-Object { $_.status -ne 'interrupted' })
        $sessions = @($(if ($qs['fresh']) { Get-OpenCompanies } else { Get-OpenCompaniesCached }))          # 1.14.0: Tally is not asked on a status check, unless a person's action asks (fresh=1)
        $result = [ordered]@{ ok = $true; version = $BridgeVersion; computer = $env:COMPUTERNAME; user = $env:USERNAME; mySession = $script:MySession; mode = $script:PlanMode; onlyMySession = [bool]$Cfg.OnlyMySession; time = (Get-Date).ToString('s'); sessions = $sessions; allowImport = [bool]$Cfg.AllowImport; tallyStuck = (Get-TallyStuck) }
        $result['jobs'] = $jobsNow
      }
      '/companies' {
        $list = @()
        foreach ($s in (Get-OpenCompanies)) { if ($s.skipped) { continue }; foreach ($c in $s.companies) { $list += [ordered]@{ name = $c.name; port = $s.port; mine = $s.mine; from = $c.from; to = $c.to } } }
        $result = [ordered]@{ ok = $true; companies = $list }
      }
      '/diagnose' { $result = Get-Diagnosis }
      '/readtest' { $result = Invoke-ReadTest $qs['company'] ([int]('0' + $qs['port'])) }
      '/ledgers' { $result = Get-Ledgers $qs['company'] ([int]('0' + $qs['port'])) }
      '/ledgervouchers' { $result = Get-LedgerVouchers $qs['company'] $qs['ledger'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])) }
      '/seed' { if ($method -ne 'POST') { throw 'Send the day book with POST.' }; $result = Import-KeepSeed $qs['company'] $qs['from'] $qs['to'] $body }
      '/keepmode' { if ($method -ne 'POST') { throw 'POST only.' }; $o = $body | ConvertFrom-Json; $result = Set-KeepMode ([string]$o.company) ([string]$o.mode) }
      '/seedbal' { if ($method -ne 'POST') { throw 'Send the balances with POST.' }; $result = Import-KeepOpening $qs['company'] $body }
      '/daybook' { Set-FinComReading; $xml = Get-DayBookXml $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])); Send-Raw $stream 200 $xml $origin; return }
      '/balances' { Set-FinComReading; $result = Get-Balances $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])) ($qs['open'] -eq '1') }
      '/synced' {
        $mf = Join-Path (Get-SyncFolder $qs['company']) 'manifest.json'
        if (Test-Path $mf) { Send-Raw $stream 200 ([IO.File]::ReadAllText($mf)) $origin 'application/json; charset=utf-8'; return }
        $result = [ordered]@{ ok = $true; none = $true }
      }
      '/syncfile' {
        $name = [string]$qs['file']
        if ($name -notmatch '^(daybook-\d{6}\.xml|balances\.json|ledgers\.json)$') { throw 'Not a file of the nightly copy.' }
        $fp = Join-Path (Get-SyncFolder $qs['company']) $name
        if (-not (Test-Path $fp)) { throw 'That is not in the nightly copy.' }
        Send-Raw $stream 200 ([IO.File]::ReadAllText($fp)) $origin $(if ($name -like '*.json') { 'application/json; charset=utf-8' } else { 'text/xml; charset=utf-8' }); return
      }
      '/schedule' { if ($method -eq 'POST') { $o = $body | ConvertFrom-Json; $result = Set-Schedule ([bool]$o.on) ([string]$o.time) } else { $result = Get-Schedule } }
      '/syncnow' { if ($method -ne 'POST') { throw 'Use POST.' }; $o = $body | ConvertFrom-Json; $result = Invoke-CompanySync ([string]$o.company) ([int]('0' + $o.port)) }
      '/fvu' { if ($method -ne 'POST') { throw 'Use POST.' }; $result = Invoke-Fvu ($body | ConvertFrom-Json) }
      '/jobs' {
        if ($method -eq 'POST') { $result = New-PostJob ($body | ConvertFrom-Json) }
        elseif ($qs['id']) { $v = Get-JobView (Get-JobDir $qs['id']); if (-not $v) { throw 'No such job.' }; $result = $v }
        else { $result = [ordered]@{ ok = $true; jobs = @(Get-ActiveJobs) } }
      }
      '/jobs/resume' { if ($method -ne 'POST') { throw 'Use POST.' }; $o = $body | ConvertFrom-Json; $result = Resume-PostJob ([string]$o.id) }
      '/ledgerlines' {
        # one ledger's vouchers for a period (light); the Day Book month by month only if this Tally will not answer that way
        $co = [string]$qs['company']; $port = Find-CompanyPort $co ([int]('0' + $qs['port']))
        $lv = $null; try { $lv = Get-LedgerVoucherList $port $co ([string]$qs['ledger']) ([string]$qs['from']) ([string]$qs['to']) } catch { $lv = $null }
        if ($null -ne $lv) { $result = [ordered]@{ ok = $true; port = $port; via = 'ledger'; vouchers = @($lv) } }
        else { $r0 = Get-Vouchers $co ([string]$qs['from']) ([string]$qs['to']) ([string]$qs['ledger']) '' $port; $r0['via'] = 'daybook'; $result = $r0 }
      }
      '/ledgernames' { $result = Get-LedgerNames ([string]$qs['company']) ([int]('0' + $qs['port'])) }
      '/tb' { $result = Get-TrialBalance ([string]$qs['company']) ([string]$qs['to']) ([int]('0' + $qs['port'])) }
      '/paircode' {
        # the FinCom Connector (which holds the key) opens a fresh connect code for FinCom on this computer
        if ($method -eq 'POST') {
          $rng2 = [Security.Cryptography.RandomNumberGenerator]::Create(); $b42 = New-Object byte[] 4; $rng2.GetBytes($b42)
          $script:PairCode = ([BitConverter]::ToUInt32($b42, 0) % 1000000).ToString('000000')
          $script:PairUntil = (Get-Date).AddMinutes(10); $script:PairTries = 0
          Write-Log 'A new connect code was opened for 10 minutes (from the FinCom Connector).'
        }
        $open = (Get-Date) -le $script:PairUntil
        $result = [ordered]@{ ok = $true; open = $open; code = $(if ($open) { $script:PairCode } else { '' }); until = $(if ($open) { $script:PairUntil.ToString('s') } else { '' }) }
      }
      '/shutdown' { if ($method -ne 'POST') { throw 'Use POST.' }; $script:ShutdownAfter = $true; $result = [ordered]@{ ok = $true; stopping = $true } }
      '/cloudlink' { if ($method -eq 'POST') { $result = Set-CloudLink ($body | ConvertFrom-Json) } else { $result = Get-CloudLinkStatus } }
      '/keep' { if ($method -eq 'POST') { $o = $body | ConvertFrom-Json; if ($null -ne $o.on) { $Cfg.KeepInStep = [bool]$o.on }; if ($o.dailyAt -and [string]$o.dailyAt -match '^([01]?\d|2[0-3]):[0-5]\d$') { $Cfg.KeepDailyAt = [string]$o.dailyAt }; if ($o.schedule -eq 'daily' -or $o.schedule -eq 'continuous') { $Cfg.KeepSchedule = [string]$o.schedule }; Save-Config; if ($o.now) { $Cfg.KeepInStep = $true; Save-Config; Request-KeepNow }; if (Test-KeepOn) { Start-KeepIfNeeded } }; $result = Get-KeepStatus ([string]$qs['company']) }
      '/keepcheck' { $result = Test-KeepMonth ([string]$qs['company']) ([string]$qs['ym']) ([int]('0' + $qs['port'])) }
      '/ledgerbalance' {
        # one ledger's balance the day before 'from' and on 'to'
        $co = [string]$qs['company']; $port = Find-CompanyPort $co ([int]('0' + $qs['port'])); $led = [string]$qs['ledger']
        $before = ([datetime]::ParseExact([string]$qs['from'], 'yyyyMMdd', $null)).AddDays(-1).ToString('yyyyMMdd')
        # only=close: one read (after a posting); the opening is read when the reason for a difference is asked for
        $o = $null; if ([string]$qs['only'] -ne 'close') { $o = Get-OneLedgerBalance $port $co $led $before }
        $c = Get-OneLedgerBalance $port $co $led ([string]$qs['to'])
        if ($null -eq $c) { throw ('Ledger ' + $led + ' was not found in ' + $co + '.') }
        $result = [ordered]@{ ok = $true; port = $port; ledger = $led; openAsOn = $before; open = [string]$o; close = [string]$c }
      }
      '/tags' {
        # every voucher FinCom posted in a date range (its tag is in the narration): one light read, no ledger lines
        $port = Find-CompanyPort ([string]$qs['company']) ([int]('0' + $qs['port']))
        $heads = Get-VoucherHeads -Port $port -Company ([string]$qs['company']) -From ([string]$qs['from']) -To ([string]$qs['to'])
        $tagged = New-Object System.Collections.ArrayList
        foreach ($h in $heads) { if ([string]$h.narration -match 'TDSDesk:') { $null = $tagged.Add($h) } }
        $result = [ordered]@{ ok = $true; port = $port; vouchers = @($tagged) }
      }
      '/vouchers' { $result = Get-Vouchers $qs['company'] $qs['from'] $qs['to'] $qs['ledger'] $qs['types'] ([int]('0' + $qs['port'])) }
      '/unpost' {
        $bodyObj = $body | ConvertFrom-Json
        $company = [string]$bodyObj.company
        $port = Find-CompanyPort $company ([int]('0' + $qs['port']))
        $guid = [string]$bodyObj.guid
        $vtype = [string]$bodyObj.vchType
        $vdate = [string]$bodyObj.vchDate
        $vnum = [string]$bodyObj.vchNumber
        $mid = [string]$bodyObj.masterId
        if ($true) {
          try { $rv = Remove-TallyVoucher $port $company $guid $mid $vtype $vdate $vnum; Write-Log ("Unpost " + $vtype + ' ' + $vnum + ' of ' + $vdate + " from '" + $company + "': " + $(if ($rv.ok) { 'removed (' + $rv.how + ')' } else { 'FAILED ' + $rv.message })); $result = [ordered]@{ ok = [bool]$rv.ok; company = $company; port = $port; message = $rv.message; error = $(if ($rv.ok) { '' } else { [string]$rv.message }); how = $rv.how } }
          catch { $result = [ordered]@{ ok = $false; error = 'Tally did not answer: ' + $_.Exception.Message } }
        }
        elseif (-not $guid -and -not ($vnum -and $vdate -and $vtype)) { $result = [ordered]@{ ok = $false; error = 'This entry has no Tally identity stored, so it cannot be removed automatically. Delete it in Tally.' } }
        else {
          $x = if ($guid) {
            '<VOUCHER REMOTEID="' + (Esc $guid) + '" VCHTYPE="' + (Esc $vtype) + '" ACTION="Delete">' +
            '<DATE>' + (Esc $vdate) + '</DATE><VOUCHERTYPENAME>' + (Esc $vtype) + '</VOUCHERTYPENAME></VOUCHER>'
          } else {
            '<VOUCHER DATE="' + (Esc $vdate) + '" TAGNAME="Voucher Number" TAGVALUE="' + (Esc $vnum) + '" VCHTYPE="' + (Esc $vtype) + '" ACTION="Delete">' +
            '<DATE>' + (Esc $vdate) + '</DATE><VOUCHERTYPENAME>' + (Esc $vtype) + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + (Esc $vnum) + '</VOUCHERNUMBER></VOUCHER>'
          }
          $env2 = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' +
                  '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $company) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' +
                  '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $x + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
          try {
            $raw = Invoke-Tally -TallyPort $port -Xml $env2
            $res = Read-ImportResult $raw
            $gone = ($raw -match '<DELETED>\s*1') -or $res.ok
            Write-Log ("Unpost " + $(if ($guid) { $guid } else { $vtype + ' ' + $vnum + ' of ' + $vdate }) + " from '" + $company + "': " + $(if ($gone) { 'removed' } else { 'FAILED ' + $res.message }))
            $result = [ordered]@{ ok = [bool]$gone; company = $company; port = $port; message = $res.message }
          } catch { $result = [ordered]@{ ok = $false; error = 'Tally did not answer: ' + $_.Exception.Message } }
        }
      }
      '/import' {
        if ($method -ne 'POST') { throw 'Use POST.' }
        $result = Invoke-Import ($body | ConvertFrom-Json)
      }
      default { Send-Response $stream 404 (ConvertTo-JsonText @{ ok = $false; error = 'Unknown address ' + $path }) $origin; return }
    }
    Send-Response $stream 200 (ConvertTo-JsonText $result) $origin
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match 'Unable to connect|actively refused|No connection could be made|Connection refused') { $msg = 'Tally is not answering on this computer. In TallyPrime: F1 Help > Settings > Connectivity > set "TallyPrime acts as" to Both (or Server) and port 9000.' }
    Write-Log ("ERROR " + $path + ": " + $msg)
    Send-Response $stream 502 (ConvertTo-JsonText @{ ok = $false; error = $msg }) $origin
  }
}

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
  if ($script:KeepReadSec -gt 0) { $t = $script:KeepReadSec }      # the keep-in-step worker: small reads, short limit
  return (ConvertTo-CleanXml (Invoke-Tally -TallyPort $port -Xml $req -TimeoutSec $t))
}

# Every ledger's balance as Tally works it out: at the end of the day before the period, and at its end
function Get-Balances([string]$Company, [string]$From, [string]$To, [int]$PreferredPort, [bool]$OpenOnly = $false) {
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
  $close = $(if ($OpenOnly) { @{} } else { & $read $To })          # FinCom works the closing out from the entries
  $list = @()
  foreach ($n in (@($open.Keys) + @($close.Keys) | Sort-Object -Unique)) {
    $o = $open[$n]; $c = $close[$n]
    $list += [ordered]@{ name = $n; parent = $(if ($c) { $c.parent } else { $o.parent }); open = $(if ($o) { $o.bal } else { '' }); close = $(if ($c) { $c.bal } else { '' }) }
  }
  return [ordered]@{ ok = $true; company = $Company; port = $port; from = $From; to = $To; openAsOn = $before; openOnly = $OpenOnly; ledgers = $list }
}

# Text back as it is (the Day Book is too large to wrap in JSON)
function Send-Raw($stream, [int]$status, [string]$body, [string]$origin, [string]$type) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  if (-not $type) { $type = 'text/xml; charset=utf-8' }
  $head = "HTTP/1.1 $status OK`r`n" +
    "Content-Type: $type`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    $(if ($origin) { "Access-Control-Allow-Origin: $origin`r`n" } else { '' }) +
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
  $q = $null; $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $q = & schtasks.exe /Query /TN $script:TaskName /FO LIST 2>$null } catch { $q = $null } finally { $ErrorActionPreference = $eap }
  if ($LASTEXITCODE -ne 0 -or -not $q) { return [ordered]@{ ok = $true; on = $false } }
  $next = (($q | Where-Object { $_ -match '^Next Run Time' }) -replace '^Next Run Time:\s*', '')
  $last = $null
  $lr = Join-Path (Get-SyncDir) 'last-run.json'
  if (Test-Path $lr) { $last = Get-Content -Raw $lr | ConvertFrom-Json }
  return [ordered]@{ ok = $true; on = $true; next = $next; last = $last }
}
function Set-Schedule([bool]$On, [string]$Time) {
  if (-not $On) { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & schtasks.exe /Delete /TN $script:TaskName /F 2>$null | Out-Null } catch { } finally { $ErrorActionPreference = $eap }; return (Get-Schedule) }
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
  if ($jar -notmatch '\.jar$' -or -not (Test-Path -LiteralPath $jar)) { return [ordered]@{ ok = $false; error = "The FVU was not found at $jar. Install Protean's FVU and set its path in FinCom." } }
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

# ------------------------------------------------------------------ 1.12.10: light reads for Look up, so Tally is not held up
# every ledger's name and group, and every group's parent: no balances, so Tally answers at once
function Get-LedgerNames([string]$Company, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml (New-CollectionRequest 'TDSDeskNames' 'Ledger' 'NAME,PARENT' $Company ''))
  $led = New-Object System.Collections.ArrayList
  foreach ($l in $doc.SelectNodes('//LEDGER')) { $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }; if ($n) { $null = $led.Add(@($n, (Get-NodeText $l 'PARENT'))) } }
  $gdoc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml (New-CollectionRequest 'TDSDeskGroupNames' 'Group' 'NAME,PARENT' $Company ''))
  $grp = New-Object System.Collections.ArrayList
  foreach ($g in $gdoc.SelectNodes('//GROUP')) { $n = $g.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $g 'NAME' }; if ($n) { $null = $grp.Add(@($n, (Get-NodeText $g 'PARENT'))) } }
  return [ordered]@{ ok = $true; company = $Company; port = $port; ledgers = @($led); groups = @($grp) }
}
# the trial balance on one date: one read, and only ledgers with a balance (the full /balances reads every ledger twice)
function Get-TrialBalance([string]$Company, [string]$AsOn, [int]$PreferredPort) {
  if (-not (Test-TallyDate $AsOn)) { throw 'The date is to be given as yyyymmdd.' }
  $port = Find-CompanyPort $Company $PreferredPort
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskTB</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $AsOn + '</SVFROMDATE><SVTODATE>' + $AsOn + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskTB" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH><FILTERS>TDSDeskHasBal</FILTERS></COLLECTION>' +
    '<SYSTEM TYPE="Formulae" NAME="TDSDeskHasBal">NOT $$IsEmpty:$ClosingBalance</SYSTEM>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml $req)
  $list = New-Object System.Collections.ArrayList
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }
    $b = Get-NodeText $l 'CLOSINGBALANCE'
    if ($n -and $b) { $null = $list.Add(@($n, (Get-NodeText $l 'PARENT'), $b)) }
  }
  Write-Log ('Trial balance of ' + $Company + ' on ' + $AsOn + ': ' + $list.Count + ' ledgers in ' + [int]$sw.Elapsed.TotalMilliseconds + ' ms')
  return [ordered]@{ ok = $true; company = $Company; port = $port; asOn = $AsOn; ms = [int]$sw.Elapsed.TotalMilliseconds; ledgers = @($list) }
}

# ------------------------------------------------------------------ posting as a background job (bridge 1.12)
# FinCom hands a batch to POST /jobs and gets a job number at once. A separate PowerShell process (this same
# script with -Job) posts it in small batches, one writer per Tally at a time, and writes its progress to
# jobs\<id>\progress.json after every batch. The bridge keeps answering while it runs; the browser may close,
# the network may drop, the bridge may restart: the job goes on, or is resumed, and nothing is posted twice:
# anything whose answer was lost (a timeout, a crash) is looked for in Tally by its TDSDesk tag before it is sent again.

$script:JobsDir = Join-Path $PSScriptRoot 'jobs'
$script:JobChunk = 25

function Get-JobDir([string]$id) {
  if ($id -notmatch '^[A-Za-z0-9-]{8,64}$') { throw 'Not a job number.' }
  return (Join-Path $script:JobsDir $id)
}

function Read-JobProgress([string]$dir) {
  $f = Join-Path $dir 'progress.json'
  if (-not (Test-Path $f)) { return $null }
  for ($i = 0; $i -lt 5; $i++) {
    try { return ([IO.File]::ReadAllText($f) | ConvertFrom-Json) } catch { Start-Sleep -Milliseconds 60 }
  }
  return $null
}

# written whole, then moved into place, so a reader never sees half a file
function Write-JobProgress([string]$dir, $p) {
  $p.updatedAt = (Get-Date).ToString('o')
  $tmp = Join-Path $dir ('progress.' + $PID + '.tmp')
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $p -Depth 12 -Compress))
  Move-Item -LiteralPath $tmp -Destination (Join-Path $dir 'progress.json') -Force
}

function Test-ProcessAlive([int]$procId) {
  if (-not $procId) { return $false }
  try { $null = Get-Process -Id $procId -ErrorAction Stop; return $true } catch { return $false }
}

function Start-JobWorker([string]$dir) {
  $exe = (Get-Process -Id $PID).Path
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -ConfigPath "' + $ConfigPath + '" -Job "' + $dir + '"'
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true     # not through the shell (fails from a hidden window); the port is kept non-inheritable
  return [Diagnostics.Process]::Start($psi).Id
}

# a job as FinCom sees it; a running job whose process has gone is "interrupted" (FinCom resumes it)
function Get-JobView([string]$dir) {
  $p = Read-JobProgress $dir
  if (-not $p) { return $null }
  if ($p.status -in @('queued', 'waiting', 'running') -and -not (Test-ProcessAlive ([int]$p.pid))) {
    $age = ((Get-Date) - [datetime]$p.updatedAt).TotalSeconds
    if ($age -gt 5) { $p.status = 'interrupted'; $p.message = 'The posting stopped part-way (the computer or the bridge was restarted). Resume to finish it; nothing already in Tally is sent again.' }
  }
  # the check after posting stopped with its process: the entries are in Tally, only not read back
  if ($p.status -eq 'done' -and $p.checking -and -not (Test-ProcessAlive ([int]$p.pid))) {
    $age = ((Get-Date) - [datetime]$p.updatedAt).TotalSeconds
    if ($age -gt 5) { $p.checking = $false; $p.checkFailed = $true }
  }
  return $p
}

function Get-ActiveJobs {
  $out = @()
  if (-not (Test-Path $script:JobsDir)) { return }
  $since = (Get-Date).AddHours(-12)
  foreach ($d in @(Get-ChildItem -LiteralPath $script:JobsDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $since })) {
    $p = Get-JobView $d.FullName
    if ($p -and $p.status -in @('queued', 'waiting', 'running', 'interrupted')) {
      $out += [ordered]@{ id = $p.id; status = $p.status; company = $p.company; done = $p.done; total = $p.total; message = $p.message; updatedAt = $p.updatedAt }
    }
  }
  return $out
}

# POST /jobs: {jobId, company, port, masters, vouchers}. The same jobId sent again returns the same job (a retried
# request after a dropped connection never starts a second posting).
function New-PostJob($payload) {
  if (-not $Cfg.AllowImport) { throw 'Posting to Tally is switched off in tds-bridge.config.json (AllowImport).' }
  $id = [string]$payload.jobId
  if (-not $id) { $id = [guid]::NewGuid().ToString() }
  $dir = Get-JobDir $id
  if (Test-Path (Join-Path $dir 'progress.json')) { return (Get-JobView $dir) }
  if (-not [string]$payload.company) { throw 'No company given.' }
  $null = New-Item -ItemType Directory -Force -Path $dir
  $items = @()
  foreach ($m in @($payload.masters)) { if ($m) { $items += [ordered]@{ id = [string]$m.id; kind = 'master'; xml = [string]$m.xml } } }
  foreach ($v in @($payload.vouchers)) { if ($v) { $items += [ordered]@{ id = [string]$v.id; kind = 'voucher'; xml = [string]$v.xml } } }
  [IO.File]::WriteAllText((Join-Path $dir 'payload.json'), (ConvertTo-Json -InputObject ([ordered]@{ company = [string]$payload.company; port = [int]('0' + $payload.port); ledger = [string]$payload.ledger; items = $items }) -Depth 8 -Compress))
  $p = [ordered]@{ ok = $true; id = $id; status = 'queued'; company = [string]$payload.company; port = 0; total = $items.Count; done = 0; results = @(); message = 'Starting'; pid = 0; resumed = $false; startedAt = (Get-Date).ToString('o'); updatedAt = ''; finishedAt = ''; checking = $false; checkFailed = $false }
  Write-JobProgress $dir $p
  $p.pid = Start-JobWorker $dir
  Write-JobProgress $dir $p
  Write-Log ('Posting job ' + $id + ': ' + $items.Count + ' item(s) for ' + $p.company)
  return $p
}

function Resume-PostJob([string]$id) {
  $dir = Get-JobDir $id
  $p = Get-JobView $dir
  if (-not $p) { throw 'No such job.' }
  if ($p.status -ne 'interrupted') { return $p }
  $p.status = 'queued'; $p.message = 'Resuming'
  $p.pid = Start-JobWorker $dir
  Write-JobProgress $dir $p
  Write-Log ('Posting job ' + $id + ' resumed')
  return $p
}

# what a failure means, in words
function Get-TallyTrouble([string]$msg) {
  if ($msg -match 'timed out|timeout|operation has timed') { return 'Tally is busy and did not answer in time (a report, a pop-up or another user may be holding it).' }
  if ($msg -match 'refused|actively refused|Unable to connect|No connection|could not be made') { return 'Tally is not answering on its port: is TallyPrime open, with the company loaded?' }
  return $msg
}

# the TDSDesk tags of these items already in Tally (found by reading the dates they carry)
# --- 1.12.3: reads that ask Tally for one ledger only (a bank ledger has a few hundred entries a month; the company has thousands)
# The vouchers of one ledger for a period, with every ledger line; $null when this Tally will not give them this way
function Get-LedgerVoucherList([int]$Port, [string]$Company, [string]$Ledger, [string]$From, [string]$To) {
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskLedVch</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $From + '</SVFROMDATE><SVTODATE>' + $To + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskLedVch" ISMODIFY="No"><TYPE>Vouchers : Ledger</TYPE><CHILDOF>' + (Esc $Ledger) + '</CHILDOF>' +
    '<FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ISOPTIONAL,ISCANCELLED,ALLLEDGERENTRIES.LIST</FETCH></COLLECTION>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $raw = Invoke-Tally -TallyPort $Port -Xml $req
  if ($raw -match '<LINEERROR>|Could not find|Unknown Request') { return $null }
  $doc = Get-XmlDoc $raw
  $list = New-Object System.Collections.ArrayList
  foreach ($v in $doc.SelectNodes('//VOUCHER')) {
    $d = Get-NodeText $v 'DATE'
    if ($d -and ($d -lt $From -or $d -gt $To)) { continue }
    $type = Get-NodeText $v 'VOUCHERTYPENAME'; if (-not $type) { $type = $v.GetAttribute('VCHTYPE') }
    $entries = @()
    foreach ($e in $v.SelectNodes('ALLLEDGERENTRIES.LIST | LEDGERENTRIES.LIST')) {
      $bank = $e.SelectSingleNode('BANKALLOCATIONS.LIST')
      $bills = @(); foreach ($bl in $e.SelectNodes('BILLALLOCATIONS.LIST')) { $bn = Get-NodeText $bl 'NAME'; if ($bn) { $bills += $bn } }
      $entries += [ordered]@{ ledger = (Get-NodeText $e 'LEDGERNAME'); amount = (Get-NodeText $e 'AMOUNT'); instrument = (Get-NodeText $bank 'INSTRUMENTNUMBER'); bills = $bills }
    }
    $null = $list.Add([ordered]@{ guid = (Get-NodeText $v 'GUID'); masterId = (Get-NodeText $v 'MASTERID'); date = $d; type = $type; number = (Get-NodeText $v 'VOUCHERNUMBER'); reference = (Get-NodeText $v 'REFERENCE')
      party = (Get-NodeText $v 'PARTYLEDGERNAME'); narration = (Get-NodeText $v 'NARRATION'); optional = (Get-NodeText $v 'ISOPTIONAL'); cancelled = (Get-NodeText $v 'ISCANCELLED'); entries = $entries })
  }
  return ,$list
}
# One ledger's balance as on a date (Tally: a debit balance is negative); $null when not found this way
function Get-OneLedgerBalance([int]$Port, [string]$Company, [string]$Ledger, [string]$AsOn) {
  $f = ([string]$Ledger).Replace('"', '')
  $req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskOneLed</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY>' +
    '<SVFROMDATE>' + $AsOn + '</SVFROMDATE><SVTODATE>' + $AsOn + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="TDSDeskOneLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FILTERS>TDSDeskThisLed</FILTERS><FETCH>NAME,CLOSINGBALANCE</FETCH></COLLECTION>' +
    '<SYSTEM TYPE="Formulae" NAME="TDSDeskThisLed">$Name = "' + (Esc $f) + '"</SYSTEM>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $Port -Xml $req)
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $n = $l.GetAttribute('NAME'); if (-not $n) { $n = Get-NodeText $l 'NAME' }
    if ($n -eq $Ledger) { return (Get-NodeText $l 'CLOSINGBALANCE') }
  }
  return $null
}

# --- 1.12.5: delete one voucher from Tally, trying each way Tally identifies a voucher, and saying what Tally answered
function Remove-TallyVoucher([int]$Port, [string]$Company, [string]$Guid, [string]$MasterId, [string]$VType, [string]$VDate, [string]$VNum) {
  $d = $null; try { $d = [datetime]::ParseExact($VDate, 'yyyyMMdd', $null) } catch { }
  # each try is a name and the XML, built first and then added (PowerShell's comma binds tighter than +)
  $tries = New-Object System.Collections.ArrayList
  $vt = Esc $VType
  if ($Guid) {
    $x1 = '<VOUCHER REMOTEID="' + (Esc $Guid) + '" VCHTYPE="' + $vt + '" ACTION="Delete"><DATE>' + (Esc $VDate) + '</DATE><VOUCHERTYPENAME>' + $vt + '</VOUCHERTYPENAME></VOUCHER>'
    $null = $tries.Add(@('GUID', $x1))
  }
  if ($MasterId) {
    $x2 = '<VOUCHER TAGNAME="MASTERID" TAGVALUE="' + (Esc $MasterId) + '" VCHTYPE="' + $vt + '" ACTION="Delete"><VOUCHERTYPENAME>' + $vt + '</VOUCHERTYPENAME></VOUCHER>'
    $null = $tries.Add(@('MasterID', $x2))
  }
  if ($VNum -and $d) {
    foreach ($ds in @($d.ToString('d-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture), $VDate)) {
      $x3 = '<VOUCHER DATE="' + (Esc $ds) + '" TAGNAME="Voucher Number" TAGVALUE="' + (Esc $VNum) + '" VCHTYPE="' + $vt + '" ACTION="Delete"><DATE>' + (Esc $VDate) + '</DATE><VOUCHERTYPENAME>' + $vt + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + (Esc $VNum) + '</VOUCHERNUMBER></VOUCHER>'
      $n3 = 'number ' + $ds
      $null = $tries.Add(@($n3, $x3))
    }
  }
  if (-not $tries.Count) { return [ordered]@{ ok = $false; message = 'This entry has no Tally identity (GUID, master ID or voucher number), so it cannot be removed automatically.' } }
  $said = @()
  foreach ($t in $tries) {
    $env2 = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' +
      '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $Company) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' +
      '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $t[1] + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
    $raw = Invoke-Tally -TallyPort $Port -Xml $env2
    $del = [regex]::Match($raw, '<DELETED>\s*(\d+)\s*</DELETED>')
    $res = Read-ImportResult $raw
    $flat = ($raw -replace '\s+', ' ')
    Write-Log ('  delete by ' + $t[0] + ': ' + $flat.Substring(0, [Math]::Min(300, $flat.Length)))
    if ($del.Success -and [int]$del.Groups[1].Value -gt 0) { return [ordered]@{ ok = $true; how = $t[0]; message = '' } }
    $m = [string]$res.message; if ($m -and $m -notmatch 'did not create') { $said += $m }
  }
  $why = (@($said | Select-Object -Unique) -join ' ')
  if (-not $why) { $why = 'Tally did not delete it (it may already be gone, or its voucher number or type has changed).' }
  return [ordered]@{ ok = $false; message = $why }
}

function Find-PostedTags([int]$port, [string]$company, $items, [string]$ledger) {
  $found = @{}
  $dates = @()
  foreach ($it in $items) { $m = [regex]::Match([string]$it.xml, '<DATE>(\d{8})</DATE>'); if ($m.Success) { $dates += $m.Groups[1].Value } }
  $dates = @($dates | Sort-Object -Unique)
  if (-not $dates.Count) { return $found }
  # a read that Tally did not answer tells nothing: $null, so nothing is sent again on a guess
  $heads = @(); $read = $false
  if ($ledger) { try { $lv = Get-LedgerVoucherList $port $company $ledger $dates[0] $dates[$dates.Count - 1]; if ($null -ne $lv) { $heads = @($lv); $read = $true } } catch { } }
  if (-not $read) { try { $heads = @(Get-VoucherHeads -Port $port -Company $company -From $dates[0] -To $dates[$dates.Count - 1]); $read = $true } catch { } }
  if (-not $heads.Count) { try { $heads = @(Get-DayBookHeads -Port $port -Company $company -From $dates[0] -To $dates[$dates.Count - 1]); $read = $true } catch { } }
  if (-not $read) { return $null }
  foreach ($it in $items) {
    $tag = [regex]::Match([string]$it.xml, 'TDSDesk:[A-Za-z0-9._-]+')
    if (-not $tag.Success) { continue }
    foreach ($h in $heads) { if ([string]$h.narration -like ('*' + $tag.Value + '*')) { $found[$it.id] = $h; break } }
  }
  return $found
}

# keep the computer awake while posting (Windows); nothing to do elsewhere
function Set-KeepAwake([bool]$on) {
  try {
    if (-not ('TDSDesk.Power' -as [type])) { Add-Type -Namespace TDSDesk -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' }
    $null = [TDSDesk.Power]::SetThreadExecutionState($(if ($on) { [uint32]2147483649 } else { [uint32]2147483648 }))
  } catch { }
}

# Entries Tally said it created are read back together (one read for up to 100), not after every batch:
# found -> confirmed with Tally's voucher number; not found -> not sent again, said so; no answer -> left unconfirmed
function Confirm-Posted($port, [string]$company, $pending, $results, $items, [string]$ledger) {
  if (-not $pending.Count) { return }
  $byId = @{}; foreach ($it in $items) { $byId[[string]$it.id] = $it }
  $there = $null
  for ($a = 0; $null -eq $there -and $a -lt 4; $a++) {
    $there = Find-PostedTags $port $company @($pending | ForEach-Object { $byId[[string]$_] } | Where-Object { $_ }) $ledger
    if ($null -eq $there) { Start-Sleep -Seconds @(2, 5, 10, 20)[$a] }
  }
  foreach ($r in $results) {
    $k = [string]$r.id
    if (-not ($pending -contains $k)) { continue }
    if ($null -eq $there) { $r.verified = $null; $r.message = "Tally said it created this, but did not answer the check afterwards. Use 'Check Tally' before posting it again." }
    elseif ($there.ContainsKey($k)) { $h = $there[$k]; $r.verified = $true; $r.vchNumber = [string]$h.number; $r.vchType = [string]$h.type; $r.masterId = [string]$h.masterId; $r.guid = [string]$h.guid; $r.vchDate = [string]$h.date; $r.message = '' }
    else { $r.ok = $false; $r.verified = $false; $r.message = "Tally replied 'created', but the entry cannot be found in '" + $company + "'. It was not sent again: look for it in Tally (another company open in Tally, or an Optional voucher)." }
  }
  $pending.Clear()
}

# the worker: this script started with -Job <folder>
function Invoke-JobWorker([string]$dir) {
  $p = Read-JobProgress $dir
  $pl = [IO.File]::ReadAllText((Join-Path $dir 'payload.json')) | ConvertFrom-Json
  $p.pid = $PID; $p.status = 'waiting'; $p.message = 'Finding the company in Tally'
  $results = [Collections.ArrayList]@()
  foreach ($r in @($p.results)) { if ($r) { $null = $results.Add($r) } }
  $doneIds = @{}; foreach ($r in $results) { $doneIds[[string]$r.id] = $true }
  $p.results = $results
  Write-JobProgress $dir $p
  $port = 0
  for ($t = 0; $t -lt 20; $t++) {
    try { $port = Find-CompanyPort ([string]$pl.company) ([int]$pl.port); break }
    catch { $p.message = 'Waiting for Tally: ' + (Get-TallyTrouble $_.Exception.Message); Write-JobProgress $dir $p; Start-Sleep -Seconds 6 }
  }
  if (-not $port) { $p.status = 'failed'; $p.message = 'Tally did not show ' + $pl.company + ' for two minutes. Open it in TallyPrime and post again.'; $p.finishedAt = (Get-Date).ToString('o'); Write-JobProgress $dir $p; return }
  $p.port = $port
  # one writer per Tally: wait for another posting to the same Tally to finish
  $lockPath = Join-Path $script:JobsDir ('tally-' + $port + '.lock')
  $lock = $null
  for ($t = 0; -not $lock; $t++) {
    try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { if ($t % 5 -eq 0) { $p.message = 'Waiting for another posting to this Tally to finish'; Write-JobProgress $dir $p }; Start-Sleep -Milliseconds 700; if ($t -gt 2000) { throw 'Another posting held Tally for too long.' } }
  }
  Set-KeepAwake $true
  try {
    $p.status = 'running'
    $todo = @($pl.items | Where-Object { -not $doneIds.ContainsKey([string]$_.id) })
    # resuming: whatever reached Tally before the stop is counted, not sent again
    if ($results.Count -gt 0 -or $p.resumed) {
      $there = $null
      for ($a = 0; $null -eq $there -and $a -lt 6; $a++) {
        $there = Find-PostedTags $port ([string]$pl.company) @($todo | Where-Object { $_.kind -eq 'voucher' }) ([string]$pl.ledger)
        if ($null -eq $there) { $p.message = 'Checking Tally for entries sent before the stop'; Write-JobProgress $dir $p; Start-Sleep -Seconds (5 * ($a + 1)) }
      }
      if ($null -eq $there) { throw 'Tally did not answer, so it cannot be told which entries arrived before the stop. Open Tally and resume again.' }
      foreach ($it in $todo) { if ($there.ContainsKey([string]$it.id)) { $h = $there[[string]$it.id]
        $null = $results.Add([ordered]@{ id = $it.id; kind = 'voucher'; ok = $true; verified = $true; alreadyThere = $true; vchNumber = [string]$h.number; vchType = [string]$h.type; masterId = [string]$h.masterId; guid = [string]$h.guid; vchDate = [string]$h.date; message = 'Already in Tally (sent before the stop)' }) } }
      $todo = @($todo | Where-Object { -not $there.ContainsKey([string]$_.id) })
    }
    $p.resumed = $true
    $p.done = $results.Count
    $p.message = 'Posting'
    Write-JobProgress $dir $p
    $queue = [Collections.ArrayList]@($todo)
    $tries = @{}
    $allItems = @($pl.items)
    # entries created before a stop but not yet read back are confirmed with the next read
    $toConfirm = New-Object System.Collections.ArrayList
    foreach ($r in $results) { if ($r.ok -and $r.pendingCheck) { $null = $toConfirm.Add([string]$r.id) } }
    while ($queue.Count -gt 0) {
      $n = [Math]::Min($script:JobChunk, $queue.Count)
      $chunk = @($queue.GetRange(0, $n)); $queue.RemoveRange(0, $n)
      $masters = @($chunk | Where-Object { $_.kind -eq 'master' } | ForEach-Object { [ordered]@{ id = $_.id; xml = $_.xml } })
      $vouchers = @($chunk | Where-Object { $_.kind -eq 'voucher' } | ForEach-Object { [ordered]@{ id = $_.id; xml = $_.xml } })
      $p.message = 'Posting ' + ($p.done + 1) + ' to ' + ($p.done + $chunk.Count) + ' of ' + $p.total
      Write-JobProgress $dir $p
      $res = @()
      # fast way: the batch's vouchers in one request, then each found in Tally by its tag.
      #   found                          -> done
      #   Tally made fewer than it got   -> the rest were refused: sent one by one, for each one's own reason
      #   Tally made all, one not found  -> not sent again (another company, or Optional): said so
      #   no answer, or no answered read -> treated as lost: checked in Tally again before anything is resent
      $fast = @($vouchers | Where-Object { ([string]$_.xml -match 'TDSDesk:[A-Za-z0-9._-]+') -and ([string]$_.xml -notmatch '<ISOPTIONAL>\s*Yes') -and ([string]$_.xml -match '^\s*<VOUCHER\b') -and ([string]$_.xml -match '<DATE>\d{8}</DATE>') })
      if ($fast.Count -ge 2) {
        $fastIds = @{}; foreach ($v in $fast) { $fastIds[[string]$v.id] = $true }
        $vouchers = @($vouchers | Where-Object { -not $fastIds.ContainsKey([string]$_.id) })
        $rr = $null
        try {
          $env = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' +
            '<STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc ([string]$pl.company)) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' +
            (($fast | ForEach-Object { '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + [string]$_.xml + '</TALLYMESSAGE>' }) -join '') + '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
          $rr = Read-ImportResult (Invoke-Tally -TallyPort $port -Xml $env)
        } catch { $rr = $null; $why = Get-TallyTrouble $_.Exception.Message }
        $there = $null
        if ($rr -and $rr.created -eq $fast.Count -and -not $rr.errors -and -not $rr.exceptions) {
          # Tally made every one: counted now, read back with the next batch check (one read instead of one per batch)
          foreach ($v in $fast) { $res += [ordered]@{ id = [string]$v.id; kind = 'voucher'; ok = $true; verified = $null; pendingCheck = $true; created = 1; company = [string]$pl.company; port = $port; vchNumber = ''; vchType = ''; masterId = ''; guid = ''; vchDate = ''; message = '' }; $null = $toConfirm.Add([string]$v.id) }
          $fast = @()
        }
        elseif ($rr) { $there = Find-PostedTags $port ([string]$pl.company) @($fast | ForEach-Object { [ordered]@{ id = $_.id; kind = 'voucher'; xml = $_.xml } }) ([string]$pl.ledger) }
        if (-not $fast.Count) { }
        elseif ($null -eq $there) {
          if ($rr) { $why = 'Tally did not answer the check after posting' }
          foreach ($v in $fast) { $res += [ordered]@{ id = [string]$v.id; kind = 'voucher'; ok = $false; message = 'Tally did not answer: ' + $why } }
        } else {
          foreach ($v in $fast) {
            $k = [string]$v.id
            if ($there.ContainsKey($k)) { $h = $there[$k]
              $res += [ordered]@{ id = $k; kind = 'voucher'; ok = $true; verified = $true; created = 1; company = [string]$pl.company; port = $port; vchNumber = [string]$h.number; vchType = [string]$h.type; masterId = [string]$h.masterId; guid = [string]$h.guid; vchDate = [string]$h.date; message = '' }
            } elseif ($rr.created -ge $fast.Count) {
              $res += [ordered]@{ id = $k; kind = 'voucher'; ok = $false; verified = $false; message = "Tally replied 'created', but the entry cannot be found in '" + [string]$pl.company + "'. It was not sent again: look for it in Tally (another company open in Tally, or an Optional voucher)." }
            } else { $vouchers += $v }
          }
        }
      }
      try { if ($masters.Count -or $vouchers.Count) { $res += @((Invoke-Import ([pscustomobject]@{ company = [string]$pl.company; port = $port; masters = $masters; vouchers = $vouchers })).results) } }
      catch { $msg = Get-TallyTrouble $_.Exception.Message; $res = @($chunk | ForEach-Object { [ordered]@{ id = $_.id; kind = $_.kind; ok = $false; message = 'Tally did not answer: ' + $msg } }) }
      # no answer from Tally: look for it in Tally before sending it again, then try again (three times, waiting longer each time)
      $lost = @($res | Where-Object { -not $_.ok -and [string]$_.message -like 'Tally did not answer*' })
      if ($lost.Count) {
        $lostItems = @($chunk | Where-Object { $lid = [string]$_.id; @($lost | Where-Object { [string]$_.id -eq $lid }).Count })
        # Tally works one request at a time: a read it answers comes after the lost one was dealt with
        $there = $null
        for ($a = 0; $null -eq $there -and $a -lt 5; $a++) {
          $there = Find-PostedTags $port ([string]$pl.company) @($lostItems | Where-Object { $_.kind -eq 'voucher' }) ([string]$pl.ledger)
          if ($null -eq $there) { $p.message = 'Tally is busy: waiting to check what arrived'; Write-JobProgress $dir $p; Start-Sleep -Seconds @(3, 10, 20, 30, 45)[$a] }
        }
        $unsure = ($null -eq $there)
        if ($unsure) { $there = @{} }
        $retry = @()
        foreach ($it in $lostItems) {
          $k = [string]$it.id
          if ($there.ContainsKey($k)) {
            $h = $there[$k]
            $res = @($res | Where-Object { [string]$_.id -ne $k }) + @([ordered]@{ id = $k; kind = 'voucher'; ok = $true; verified = $true; vchNumber = [string]$h.number; vchType = [string]$h.type; masterId = [string]$h.masterId; guid = [string]$h.guid; vchDate = [string]$h.date; message = 'Created (Tally answered late)' })
          } elseif ($unsure -and $it.kind -eq 'voucher') {
            foreach ($r in $res) { if ([string]$r.id -eq $k) { $r.message = 'Tally did not answer, and did not answer a check either, so it is not known whether this entry arrived. It was not sent again: look in Tally before posting it again.'; $r['unsure'] = $true } }
          } elseif ([int]$tries[$k] -lt 3) {
            $tries[$k] = [int]$tries[$k] + 1
            $res = @($res | Where-Object { [string]$_.id -ne $k })
            $retry += $it
          } else {
            foreach ($r in $res) { if ([string]$r.id -eq $k) { $r.message = [string]$r.message + ' (tried 4 times)' } }
          }
        }
        if ($retry.Count) {
          $wait = @(3, 10, 30)[[Math]::Min(2, [int]$tries[[string]$retry[0].id] - 1)]
          $p.message = 'Tally is busy: trying ' + $retry.Count + ' again in ' + $wait + ' seconds'
          Write-JobProgress $dir $p
          Start-Sleep -Seconds $wait
          $queue.InsertRange(0, [object[]]$retry)
        }
      }
      foreach ($r in $res) { $r.Remove('replySnip'); $null = $results.Add($r) }
      $p.done = $results.Count
      Write-JobProgress $dir $p
    }
    # sending is finished: FinCom shows it at once; the read-back runs after, in one read, while FinCom carries on
    $okN = @($results | Where-Object { $_.ok }).Count
    $p.status = 'done'; $p.checking = ($toConfirm.Count -gt 0); $p.message = [string]$okN + ' of ' + $p.total + ' sent to Tally'; $p.finishedAt = (Get-Date).ToString('o')
    Write-JobProgress $dir $p
    if ($toConfirm.Count) {
      Confirm-Posted $port ([string]$pl.company) $toConfirm $results $allItems ([string]$pl.ledger)
      foreach ($r in $results) { if ($r -is [System.Collections.IDictionary]) { if ($r.Contains('pendingCheck')) { $r.Remove('pendingCheck') } } elseif ($r.PSObject.Properties['pendingCheck']) { $r.PSObject.Properties.Remove('pendingCheck') } }
      $okN = @($results | Where-Object { $_.ok }).Count
      $p.checking = $false; $p.message = [string]$okN + ' of ' + $p.total + ' in Tally'
      Write-JobProgress $dir $p
    }
    Write-Log ('Posting job ' + $p.id + ' finished: ' + $p.message)
  } catch {
    $p.status = 'failed'; $p.message = Get-TallyTrouble $_.Exception.Message; $p.finishedAt = (Get-Date).ToString('o')
    Write-JobProgress $dir $p
    Write-Log ('Posting job ' + $p.id + ' failed: ' + $p.message)
  } finally {
    Set-KeepAwake $false
    try { $lock.Close() } catch { }
  }
}


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

# 1.14.1: a heartbeat to the cloud every few minutes, so FinCom shows for each client whether its Tally computer is on,
# Tally open, and when the books were last updated. Tally is asked nothing: all of it is what the bridge already knows
$script:BeatAt = [DateTime]::MinValue
function Send-CloudBeat {
  if (-not (Test-CloudOn)) { return }
  if (([DateTime]::UtcNow - $script:BeatAt).TotalSeconds -lt (Get-KeepNum 'CloudBeatSec' 300)) { return }
  $script:BeatAt = [DateTime]::UtcNow
  $open = @(); $tally = $false
  try { foreach ($s in @(Get-OpenCompaniesCached)) { if ($s.skipped) { continue }; if ($s.ok) { $tally = $true; $open += @($s.companies | ForEach-Object { [string]$_.name }) } } } catch { }
  $cos = @()
  foreach ($d in @(Get-ChildItem -LiteralPath (Get-SyncDir) -Directory -ErrorAction SilentlyContinue)) {
    $st = Read-KeepState $d.FullName; if (-not $st -or -not $st.company) { continue }
    $cos += [ordered]@{ name = [string]$st.company; open = [bool]($open -contains [string]$st.company); at = [string]$st.at; phase = [string]$st.phase; waiting = @(Get-CloudQueue $d.FullName).Count }
  }
  $running = $false; try { $p = [int]('0' + [IO.File]::ReadAllText((Join-Path (Get-SyncDir) 'keep.pid')).Trim()); $running = [bool]($p -and (Test-ProcessAlive $p)) } catch { }
  $beat = [ordered]@{ kind = 'beat'; tally = $tally; open = $open; companies = $cos; updating = $running; dailyAt = (Get-KeepDailyAt); lastRun = (Get-KeepLastRun) }
  $r = Invoke-Cloud $beat 10
  if ($r.code -ne 200) { $script:BeatAt = [DateTime]::UtcNow.AddMinutes(25) }       # the cloud or the internet is down: tried again in half an hour
}

# the nightly copy runs on its own and stops; it does not start the bridge
# a posting job runs on its own, reports to its folder and stops
if ($Job) {
  try { Invoke-JobWorker $Job } catch { Write-Log ('Posting job stopped: ' + $_.Exception.Message) }
  exit 0
}
if ($Keep) {
  try { Invoke-KeepWorker } catch { Write-Log ('Keeping copies in step stopped: ' + $_.Exception.Message) }
  exit 0
}
if ($Sync) {
  $r = Invoke-NightlySync
  Write-Host ('Nightly copy: ' + @($r.done).Count + ' done, ' + @($r.failed).Count + ' failed.')
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}

# ------------------------------------------------------------------ start
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$Cfg.Port)
try { $listener.Start() } catch {
  Write-Host "Could not start on port $($Cfg.Port): $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Another program already uses this port. Usually the bridge is already running (another window,'
  Write-Host 'or started hidden at sign-in). Run Remove-AutoStart.ps1 to stop hidden copies, or change "Port"'
  Write-Host 'in tds-bridge.config.json and use the new address in FinCom.'
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
# 1.13.2: the port is not handed down to programs the bridge starts (a worker holding it kept a new bridge from starting)
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
  try {
    Add-Type -Namespace FinCom -Name NoInherit -MemberDefinition '[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);' -ErrorAction Stop
    if (-not [FinCom.NoInherit]::SetHandleInformation($listener.Server.Handle, 1, 0)) { Write-Log 'Could not keep the port from the workers (Windows said no); the FinCom Connector clears leftovers if one holds it' }
  } catch { try { Write-Log ('Could not keep the port from the workers: ' + $_.Exception.Message) } catch { } }
}
Write-Host ''
Write-Host '  FinCom - Tally Bridge' $BridgeVersion -ForegroundColor Green
Write-Host ('  Address : http://127.0.0.1:' + $Cfg.Port)
Write-Host ('  Key     : ' + $Cfg.Key) -ForegroundColor Yellow
Write-Host '  Copy the address and key into FinCom > Settings > Tally Bridge.'
Write-Host '  Keep this window open while you work. Press Ctrl+C to stop.'
Write-Host ''
Write-Host ('  Your Windows session: ' + $script:MySession + ' (' + $env:USERNAME + ')')
try {
  foreach ($s in @(Get-OpenCompanies -Fresh)) {
    if ($s.skipped) { Write-Log ("Tally on port " + $s.port + ": another user's session, not used") }
    elseif ($s.ok) { Write-Log ("Tally on port " + $s.port + $(if ($s.mine) { ' (yours)' } else { '' }) + ": " + (($s.companies | ForEach-Object { $_.name }) -join ', ')) }
  }
} catch { Write-Log ('Could not list Tally companies yet: ' + $_.Exception.Message) }
$script:LastDiag = ''
function Show-Diagnosis {
  try {
    $d = Get-Diagnosis
    $txt = ($d.findings | ForEach-Object { $_.level + '|' + $_.text }) -join "`n"
    if ($txt -eq $script:LastDiag) { return }
    $script:LastDiag = $txt
    foreach ($f in $d.findings) {
      $color = @{ ok = 'Green'; warn = 'Yellow'; bad = 'Red' }[$f.level]
      Write-Host ('  ' + $(if ($f.level -eq 'ok') { 'OK   ' } else { 'CHECK' }) + ' ' + $f.text) -ForegroundColor $color
      if ($f.fix) { Write-Host ('        Fix: ' + $f.fix) }
      Write-Log ('Check: ' + $f.level + ' - ' + $f.text)
    }
  } catch { }
}
Show-Diagnosis
Write-Host ''
Write-Host ('  READY - the bridge is running. Waiting for FinCom at http://127.0.0.1:' + $Cfg.Port) -ForegroundColor Green
if ($script:PlanMode -eq 'fallback') { Write-Log 'Windows did not say which Tally belongs to you; ports from the settings are used. Choose your Tally in FinCom.' }
$script:PairUntil = (Get-Date).AddMinutes([int]$Cfg.PairWindowMin)
$script:PairTries = 0
$rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $b4 = New-Object byte[] 4; $rng.GetBytes($b4)
$script:PairCode = ([BitConverter]::ToUInt32($b4, 0) % 1000000).ToString('000000')
Write-Host ('  To connect FinCom: press Connect there and type the code  ' + $script:PairCode + '  (until ' + $script:PairUntil.ToString('HH:mm') + ').') -ForegroundColor Green
Write-Host ''
$lastCheck = Get-Date
while ($true) {
  while (-not $listener.Pending()) {
    Start-Sleep -Milliseconds 100
    if (((Get-Date) - $lastCheck).TotalSeconds -ge (Get-KeepNum 'KeepStartSec' 60)) { $lastCheck = Get-Date; Show-Diagnosis; try { Start-KeepIfNeeded } catch { Write-Log ('Could not start keeping copies in step: ' + $_.Exception.Message) }; try { Send-CloudBeat } catch { } }
  }
  $client = $listener.AcceptTcpClient()
  try { Invoke-Client $client }
  catch { Write-Log ("Request failed: " + $_.Exception.Message) }
  finally { try { $client.Close() } catch { } }
  if ($script:ShutdownAfter) { Write-Log 'Stopping: the FinCom Connector asked'; try { $listener.Stop() } catch { }; exit 0 }
}
