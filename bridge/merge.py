import sys
base = open(sys.argv[1], encoding='utf-8-sig').read().replace('\r\n', '\n')
add = open('additions.ps1', encoding='utf-8').read()
def R(a, b):
    global base
    assert base.count(a) == 1, ('anchor', a[:60], base.count(a))
    base = base.replace(a, b)
import re
base = re.sub(r"\$BridgeVersion = '[0-9.]+'", "$BridgeVersion = '1.10.0'", base, 1)
R("param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json')\n)",
  "param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json'),\n  [switch]$Sync\n)")
R("  AllowImport     = $true\n}", "  AllowImport     = $true\n  SyncDir         = ''\n  SyncCompanies   = @()\n}")
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
open(sys.argv[2], 'w', encoding='utf-8-sig', newline='\r\n').write(base)
print('merged', len(base))
