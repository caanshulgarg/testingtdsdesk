<#
  TDS Desk - Tally Bridge
  Garg Shekhar & Company

  Runs on the computer where TallyPrime runs. Listens only on this computer (127.0.0.1)
  and lets TDS Desk, opened in a browser on the same computer, read from and post to Tally.

  Works with Windows PowerShell 5.1 (built into Windows) and PowerShell 7.
  Start:  powershell -ExecutionPolicy Bypass -File TDSBridge.ps1
#>
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json'),
  [switch]$Sync
)

$ErrorActionPreference = 'Stop'
# everything shown in this window is also kept in tds-bridge-console.txt
try { Start-Transcript -Path (Join-Path $PSScriptRoot 'tds-bridge-console.txt') -Append -ErrorAction SilentlyContinue | Out-Null } catch { }
trap {
  $stopMsg = 'BRIDGE STOPPED: ' + $_.Exception.Message + ' (TDSBridge.ps1 line ' + $_.InvocationInfo.ScriptLineNumber + ')'
  Write-Host ''
  Write-Host $stopMsg -ForegroundColor Red
  Write-Host 'Send this message (or tds-bridge-console.txt) to support.'
  try { Add-Content -Path (Join-Path $PSScriptRoot 'tds-bridge.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $stopMsg) } catch { }
  try { Stop-Transcript | Out-Null } catch { }
  break
}
$BridgeVersion = '1.10.0'

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

function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Write-Host $line
  try { Add-Content -Path $Cfg.LogFile -Value $line -Encoding UTF8 } catch { }
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
    & $add 'warn' 'Windows did not let the bridge see which programs are running, so it cannot tell which Tally is yours.' 'In TDS Desk > Settings > Tally Bridge, press "Use this Tally" on your own Tally (the port shown in TallyPrime: F1 > Settings > Connectivity).'
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

# The Tally to use for a company. A port chosen in TDS Desk wins; otherwise the company must be open
# in exactly one Tally (your own session first) - the bridge never guesses between two.
function Find-CompanyPort([string]$Company, [int]$PreferredPort) {
  foreach ($fresh in @($false, $true)) {
    $sessions = if ($fresh) { @(Get-OpenCompanies -Fresh) } else { @(Get-OpenCompanies) }
    $usable = @($sessions | Where-Object { -not $_.skipped -and $_.ok })
    if ($PreferredPort -gt 0) {
      $s = $usable | Where-Object { $_.port -eq $PreferredPort } | Select-Object -First 1
      if ($s -and (@($s.companies | Where-Object { $_.name -eq $Company }).Count -gt 0)) { return [int]$PreferredPort }
      if ($fresh) {
        if (-not $s) { throw "The Tally chosen in TDS Desk (port $PreferredPort) is not running in your Windows session. Start it, or choose another Tally in TDS Desk > Settings > Tally Bridge." }
        throw "Company '$Company' is not open in the Tally chosen in TDS Desk (port $PreferredPort). Open it there."
      }
      continue
    }
    $withIt = @($usable | Where-Object { @($_.companies | Where-Object { $_.name -eq $Company }).Count -gt 0 })
    if ($withIt.Count -eq 1) { return [int]$withIt[0].port }
    if ($withIt.Count -gt 1) {
      $mine = @($withIt | Where-Object { $_.mine -eq $true })
      if ($mine.Count -eq 1) { return [int]$mine[0].port }
      if ($fresh) { throw ("Company '$Company' is open in more than one Tally (ports " + (($withIt | ForEach-Object { $_.port }) -join ', ') + "). Choose your Tally in TDS Desk > Settings > Tally Bridge.") }
    }
  }
  throw "Company '$Company' is not open in Tally. Open it in TallyPrime on this computer and try again."
}

function Get-Ledgers([string]$Company, [int]$PreferredPort) {
  $port = Find-CompanyPort $Company $PreferredPort
  $fetch = 'NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE'
  $doc = Get-XmlDoc (Invoke-Tally -TallyPort $port -Xml (New-CollectionRequest 'TDSDeskLedgers' 'Ledger' $fetch $Company ''))
  $ledgers = @()
  foreach ($l in $doc.SelectNodes('//LEDGER')) {
    $name = $l.GetAttribute('NAME')
    if (-not $name) { $name = Get-NodeText $l 'NAME' }
    if (-not $name) { continue }
    $gstin = Get-NodeText $l 'PARTYGSTIN'
    if (-not $gstin) { $gstin = Get-NodeText $l 'LEDGSTREGDETAILS.LIST/GSTIN' }
    $ledgers += [ordered]@{
      name = $name; group = (Get-NodeText $l 'PARENT'); pan = (Get-NodeText $l 'INCOMETAXNUMBER'); gstin = $gstin
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
  if (-not $origin) { $origin = '*' }
  $head = "HTTP/1.1 $status $reason`r`n" +
    "Content-Type: application/json; charset=utf-8`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    "Access-Control-Allow-Origin: $origin`r`n" +
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

  $origin = '*'
  if ($headers.ContainsKey('origin')) { $origin = $headers['origin'] }
  $path = $target
  $query = ''
  $q = $target.IndexOf('?')
  if ($q -ge 0) { $path = $target.Substring(0, $q); $query = $target.Substring($q + 1) }
  $qs = Get-QueryValues $query

  if ($method -eq 'OPTIONS') { Send-Response $stream 204 '' $origin; return }
  if ($path -eq '/ping') { Send-Response $stream 200 (ConvertTo-JsonText ([ordered]@{ ok = $true; bridge = 'TDS Desk Tally Bridge'; version = $BridgeVersion })) $origin; return }
  # TDS Desk on this same computer may fetch the key itself for a while after the bridge starts
  if ($path -eq '/pair') {
    if ((Get-Date) -le $script:PairUntil) {
      Write-Log 'TDS Desk on this computer connected itself (no key typed).'
      Send-Response $stream 200 (ConvertTo-JsonText ([ordered]@{ ok = $true; key = $Cfg.Key; computer = $env:COMPUTERNAME; user = $env:USERNAME; version = $BridgeVersion })) $origin
    } else {
      Send-Response $stream 403 (ConvertTo-JsonText ([ordered]@{ ok = $false; error = 'The connect window has closed. Start the bridge again (Start-TDS-Bridge), then press Connect in TDS Desk within ' + $Cfg.PairWindowMin + ' minutes.' })) $origin
    }
    return
  }

  $key = ''
  if ($headers.ContainsKey('x-bridge-key')) { $key = $headers['x-bridge-key'] }
  if ($key -ne $Cfg.Key) {
    Send-Response $stream 401 (ConvertTo-JsonText @{ ok = $false; error = 'Wrong bridge key. Copy the key shown in the bridge window into TDS Desk Settings.' }) $origin
    return
  }
  try {
    $result = $null
    switch ($path) {
      '/status' {
        $sessions = @(Get-OpenCompanies -Fresh)
        $result = [ordered]@{ ok = $true; version = $BridgeVersion; computer = $env:COMPUTERNAME; user = $env:USERNAME; mySession = $script:MySession; mode = $script:PlanMode; onlyMySession = [bool]$Cfg.OnlyMySession; time = (Get-Date).ToString('s'); sessions = $sessions; allowImport = [bool]$Cfg.AllowImport }
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
      '/vouchers' { $result = Get-Vouchers $qs['company'] $qs['from'] $qs['to'] $qs['ledger'] $qs['types'] ([int]('0' + $qs['port'])) }
      '/unpost' {
        $bodyObj = $body | ConvertFrom-Json
        $company = [string]$bodyObj.company
        $port = Find-CompanyPort $company ([int]('0' + $qs['port']))
        $guid = [string]$bodyObj.guid
        $vtype = [string]$bodyObj.vchType
        $vdate = [string]$bodyObj.vchDate
        $vnum = [string]$bodyObj.vchNumber
        if (-not $guid -and -not ($vnum -and $vdate -and $vtype)) { $result = [ordered]@{ ok = $false; error = 'This entry has no Tally identity stored, so it cannot be removed automatically. Delete it in Tally.' } }
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

# the nightly copy runs on its own and stops; it does not start the bridge
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
  Write-Host 'in tds-bridge.config.json and use the new address in TDS Desk.'
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
Write-Host ''
Write-Host '  TDS Desk - Tally Bridge' $BridgeVersion -ForegroundColor Green
Write-Host ('  Address : http://127.0.0.1:' + $Cfg.Port)
Write-Host ('  Key     : ' + $Cfg.Key) -ForegroundColor Yellow
Write-Host '  Copy the address and key into TDS Desk > Settings > Tally Bridge.'
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
Write-Host ('  READY - the bridge is running. Waiting for TDS Desk at http://127.0.0.1:' + $Cfg.Port) -ForegroundColor Green
if ($script:PlanMode -eq 'fallback') { Write-Log 'Windows did not say which Tally belongs to you; ports from the settings are used. Choose your Tally in TDS Desk.' }
$script:PairUntil = (Get-Date).AddMinutes([int]$Cfg.PairWindowMin)
Write-Host ('  TDS Desk on this computer can connect by itself until ' + $script:PairUntil.ToString('HH:mm') + ' - no key to copy.') -ForegroundColor Green
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
