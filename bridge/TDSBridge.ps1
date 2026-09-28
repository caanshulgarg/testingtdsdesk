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
$BridgeVersion = '1.12.11'

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
        $sessions = @($(if ($jobsNow.Count) { Get-OpenCompanies } else { Get-OpenCompanies -Fresh }))
        $result = [ordered]@{ ok = $true; version = $BridgeVersion; computer = $env:COMPUTERNAME; user = $env:USERNAME; mySession = $script:MySession; mode = $script:PlanMode; onlyMySession = [bool]$Cfg.OnlyMySession; time = (Get-Date).ToString('s'); sessions = $sessions; allowImport = [bool]$Cfg.AllowImport }
        $result['jobs'] = $jobsNow
      }
      '/companies' {
        $list = @()
        foreach ($s in (Get-OpenCompanies -Fresh)) { if ($s.skipped) { continue }; foreach ($c in $s.companies) { $list += [ordered]@{ name = $c.name; port = $s.port; mine = $s.mine; from = $c.from; to = $c.to } } }
        $result = [ordered]@{ ok = $true; companies = $list }
      }
      '/diagnose' { $result = Get-Diagnosis }
      '/readtest' { $result = Invoke-ReadTest $qs['company'] ([int]('0' + $qs['port'])) }
      '/ledgers' { $result = Get-Ledgers $qs['company'] ([int]('0' + $qs['port'])) }
      '/ledgervouchers' { $result = Get-LedgerVouchers $qs['company'] $qs['ledger'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])) }
      '/daybook' { $xml = Get-DayBookXml $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])); Send-Raw $stream 200 $xml $origin; return }
      '/balances' { $result = Get-Balances $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])) }
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
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $false
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

# the nightly copy runs on its own and stops; it does not start the bridge
# a posting job runs on its own, reports to its folder and stops
if ($Job) {
  try { Invoke-JobWorker $Job } catch { Write-Log ('Posting job stopped: ' + $_.Exception.Message) }
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
    if (((Get-Date) - $lastCheck).TotalSeconds -ge 60) { $lastCheck = Get-Date; Show-Diagnosis }
  }
  $client = $listener.AcceptTcpClient()
  try { Invoke-Client $client }
  catch { Write-Log ("Request failed: " + $_.Exception.Message) }
  finally { try { $client.Close() } catch { } }
}
