import sys
base = open(sys.argv[1], encoding='utf-8-sig').read().replace('\r\n', '\n')
add = open('additions.ps1', encoding='utf-8').read()
def R(a, b):
    global base
    assert base.count(a) == 1, ('anchor', a[:60], base.count(a))
    base = base.replace(a, b)
import re
base = re.sub(r"\$BridgeVersion = '[0-9.]+'", "$BridgeVersion = '1.11.0'", base, 1)
def RA(a, b, n):
    global base
    assert base.count(a) == n, ('anchor', a[:60], base.count(a))
    base = base.replace(a, b)
R("param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json')\n)",
  "param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json'),\n  [switch]$Sync\n)")
R("  AllowImport     = $true\n}", "  AllowImport     = $true\n  SyncDir         = ''\n  SyncCompanies   = @()\n  AllowedOrigins  = @('https://caanshulgarg.github.io', 'http://localhost', 'null')\n}")
R("# ------------------------------------------------------------------ start\n", add + "\n# the nightly copy runs on its own and stops; it does not start the bridge\nif ($Sync) {\n  $r = Invoke-NightlySync\n  Write-Host ('Nightly copy: ' + @($r.done).Count + ' done, ' + @($r.failed).Count + ' failed.')\n  try { Stop-Transcript | Out-Null } catch { }\n  exit 0\n}\n\n# ------------------------------------------------------------------ start\n")
R("      '/vouchers' {", """      '/daybook' { $xml = Get-DayBookXml $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])); Send-Raw $stream 200 $xml $origin; return }
      '/balances' { $result = Get-Balances $qs['company'] $qs['from'] $qs['to'] ([int]('0' + $qs['port'])) }
      '/synced' {
        $mf = Join-Path (Get-SyncFolder $qs['company']) 'manifest.json'
        if (Test-Path $mf) { Send-Raw $stream 200 ([IO.File]::ReadAllText($mf)) $origin 'application/json; charset=utf-8'; return }
        $result = [ordered]@{ ok = $true; none = $true }
      }
      '/syncfile' {
        $name = [string]$qs['file']
        if ($name -notmatch '^(daybook-\\d{6}\\.xml|balances\\.json|ledgers\\.json)$') { throw 'Not a file of the nightly copy.' }
        $fp = Join-Path (Get-SyncFolder $qs['company']) $name
        if (-not (Test-Path $fp)) { throw 'That is not in the nightly copy.' }
        Send-Raw $stream 200 ([IO.File]::ReadAllText($fp)) $origin $(if ($name -like '*.json') { 'application/json; charset=utf-8' } else { 'text/xml; charset=utf-8' }); return
      }
      '/schedule' { if ($method -eq 'POST') { $o = $body | ConvertFrom-Json; $result = Set-Schedule ([bool]$o.on) ([string]$o.time) } else { $result = Get-Schedule } }
      '/syncnow' { if ($method -ne 'POST') { throw 'Use POST.' }; $o = $body | ConvertFrom-Json; $result = Invoke-CompanySync ([string]$o.company) ([int]('0' + $o.port)) }
      '/fvu' { if ($method -ne 'POST') { throw 'Use POST.' }; $result = Invoke-Fvu ($body | ConvertFrom-Json) }
      '/vouchers' {""")
# --- 1.11.0: a web page other than TDS Desk gets nothing from the bridge; connecting needs the code in the bridge window
RA("  if (-not $origin) { $origin = '*' }\n", "", 2)
RA('    "Access-Control-Allow-Origin: $origin`r`n" +\n', "    $(if ($origin) { \"Access-Control-Allow-Origin: $origin`r`n\" } else { '' }) +\n", 2)
R("  $origin = '*'\n  if ($headers.ContainsKey('origin')) { $origin = $headers['origin'] }\n",
  """  # a browser always says which page is asking; only TDS Desk's own pages (the allowed origins) are answered in a way the page can read
  $sentOrigin = ''
  if ($headers.ContainsKey('origin')) { $sentOrigin = [string]$headers['origin'] }
  $originOk = Test-AllowedOrigin $sentOrigin
  $origin = $(if ($sentOrigin -and $originOk) { $sentOrigin } else { '' })
""")
R("""  if ($path -eq '/pair') {
    if ((Get-Date) -le $script:PairUntil) {
      Write-Log 'TDS Desk on this computer connected itself (no key typed).'""",
  """  if ($sentOrigin -and -not $originOk -and $path -ne '/ping') {
    Write-Log ('Refused a request from the web page ' + $sentOrigin + ' (not TDS Desk).')
    Send-Response $stream 403 (ConvertTo-JsonText ([ordered]@{ ok = $false; error = 'This bridge answers TDS Desk only.' })) $origin
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
      Write-Log ('TDS Desk connected with the code (' + $sentOrigin + ').')""")
R("""$script:PairUntil = (Get-Date).AddMinutes([int]$Cfg.PairWindowMin)
Write-Host ('  TDS Desk on this computer can connect by itself until ' + $script:PairUntil.ToString('HH:mm') + ' - no key to copy.') -ForegroundColor Green""",
  """$script:PairUntil = (Get-Date).AddMinutes([int]$Cfg.PairWindowMin)
$script:PairTries = 0
$rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $b4 = New-Object byte[] 4; $rng.GetBytes($b4)
$script:PairCode = ([BitConverter]::ToUInt32($b4, 0) % 1000000).ToString('000000')
Write-Host ('  To connect TDS Desk: press Connect there and type the code  ' + $script:PairCode + '  (until ' + $script:PairUntil.ToString('HH:mm') + ').') -ForegroundColor Green""")
R("function ConvertTo-JsonText($obj) {", """# the pages allowed to talk to the bridge: TDS Desk's own addresses (settings: AllowedOrigins); 'http://localhost' allows any port
function Test-AllowedOrigin([string]$o) {
  if (-not $o) { return $true }
  foreach ($a in @($Cfg.AllowedOrigins)) {
    $a = [string]$a
    if ($o -eq $a) { return $true }
    if (($a -eq 'http://localhost') -and ($o -match '^http://(localhost|127\\.0\\.0\\.1)(:\\d+)?$')) { return $true }
  }
  return $false
}

function ConvertTo-JsonText($obj) {""")
open(sys.argv[2], 'w', encoding='utf-8-sig', newline='\r\n').write(base)
print('merged', len(base))
