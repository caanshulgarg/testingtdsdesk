import sys
base = open(sys.argv[1], encoding='utf-8-sig').read().replace('\r\n', '\n')
add = open('additions.ps1', encoding='utf-8').read() + '\n' + open('jobs.ps1', encoding='utf-8').read() + '\n' + open('keep.ps1', encoding='utf-8').read() + '\n' + open('cloud.ps1', encoding='utf-8').read()
def R(a, b):
    global base
    assert base.count(a) == 1, ('anchor', a[:60], base.count(a))
    base = base.replace(a, b)
import re
base = re.sub(r"\$BridgeVersion = '[0-9.]+'", "$BridgeVersion = '1.13.5'", base, 1)
# 1.12.7 (security): the log never holds keys, codes or passwords, and is rotated at 5 MB keeping 5 old copies
R(r"""function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Write-Host $line
  try { Add-Content -Path $Cfg.LogFile -Value $line -Encoding UTF8 } catch { }
}""", r"""function Protect-LogText([string]$msg) {
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
}""")
def RA(a, b, n):
    global base
    assert base.count(a) == n, ('anchor', a[:60], base.count(a))
    base = base.replace(a, b)
R("param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json')\n)",
  "param(\n  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tds-bridge.config.json'),\n  [switch]$Sync,\n  [string]$Job = ''\n)")
R("  AllowImport     = $true\n}", "  AllowImport     = $true\n  SyncDir         = ''\n  SyncCompanies   = @()\n  AllowedOrigins  = @('https://app.fincom.live', 'https://staging.fincom.live', 'https://caanshulgarg.github.io', 'http://localhost', 'null')\n}")
R("# ------------------------------------------------------------------ start\n", add + "\n# the nightly copy runs on its own and stops; it does not start the bridge\n# a posting job runs on its own, reports to its folder and stops\nif ($Job) {\n  try { Invoke-JobWorker $Job } catch { Write-Log ('Posting job stopped: ' + $_.Exception.Message) }\n  exit 0\n}\nif ($Sync) {\n  $r = Invoke-NightlySync\n  Write-Host ('Nightly copy: ' + @($r.done).Count + ' done, ' + @($r.failed).Count + ' failed.')\n  try { Stop-Transcript | Out-Null } catch { }\n  exit 0\n}\n\n# ------------------------------------------------------------------ start\n")
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
        # every voucher TDS Desk posted in a date range (its tag is in the narration): one light read, no ledger lines
        $port = Find-CompanyPort ([string]$qs['company']) ([int]('0' + $qs['port']))
        $heads = Get-VoucherHeads -Port $port -Company ([string]$qs['company']) -From ([string]$qs['from']) -To ([string]$qs['to'])
        $tagged = New-Object System.Collections.ArrayList
        foreach ($h in $heads) { if ([string]$h.narration -match 'TDSDesk:') { $null = $tagged.Add($h) } }
        $result = [ordered]@{ ok = $true; port = $port; vouchers = @($tagged) }
      }
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
  # 1.12.11: FinCom's own addresses are always allowed, also with a settings file saved by an older bridge
  foreach ($a in @('https://app.fincom.live', 'https://staging.fincom.live', 'https://fincom.live', 'https://caanshulgarg.github.io')) { if ($o -eq $a) { return $true } }
  foreach ($a in @($Cfg.AllowedOrigins)) {
    $a = [string]$a
    if ($o -eq $a) { return $true }
    if (($a -eq 'http://localhost') -and ($o -match '^http://(localhost|127\\.0\\.0\\.1)(:\\d+)?$')) { return $true }
  }
  return $false
}

function ConvertTo-JsonText($obj) {""")
# --- 1.12.0: posting jobs
R("try { Start-Transcript -Path", "if (-not $Job) { try { Start-Transcript -Path")
R("-Append -ErrorAction SilentlyContinue | Out-Null } catch { }\n", "-Append -ErrorAction SilentlyContinue | Out-Null } catch { } }\n")
R("      }\n      '/companies' {", "        $result['jobs'] = $jobsNow\n      }\n      '/companies' {")
R("        $sessions = @(Get-OpenCompanies -Fresh)\n", "        $jobsNow = @(Get-ActiveJobs | Where-Object { $_.status -ne 'interrupted' })\n        $sessions = @($(if ($jobsNow.Count) { Get-OpenCompanies } else { Get-OpenCompanies -Fresh }))\n")
# --- 1.12.5: /unpost tries every way Tally identifies a voucher, and passes on what Tally said
R("""        if (-not $guid -and -not ($vnum -and $vdate -and $vtype)) {""", """        $mid = [string]$bodyObj.masterId
        if ($true) {
          try { $rv = Remove-TallyVoucher $port $company $guid $mid $vtype $vdate $vnum; Write-Log ("Unpost " + $vtype + ' ' + $vnum + ' of ' + $vdate + " from '" + $company + "': " + $(if ($rv.ok) { 'removed (' + $rv.how + ')' } else { 'FAILED ' + $rv.message })); $result = [ordered]@{ ok = [bool]$rv.ok; company = $company; port = $port; message = $rv.message; error = $(if ($rv.ok) { '' } else { [string]$rv.message }); how = $rv.how } }
          catch { $result = [ordered]@{ ok = $false; error = 'Tally did not answer: ' + $_.Exception.Message } }
        }
        elseif (-not $guid -and -not ($vnum -and $vdate -and $vtype)) {""")
# --- 1.12.1: a voucher without a proper date never reaches Tally (Tally answers "Voucher date is missing" but may still make it)
R("""      if (($xml -notmatch '^\\s*<(VOUCHER|LEDGER|GROUP)\\b') -and -not $vtOnly) {""", """      if (($xml -match '^\\s*<VOUCHER\\b') -and ($xml -notmatch '<DATE>(19|20)\\d\\d(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])</DATE>')) { $results += [ordered]@{ id = $it.id; kind = $g.kind; ok = $false; message = 'The entry has no valid date, so it was not sent to Tally.' }; continue }
      if (($xml -notmatch '^\\s*<(VOUCHER|LEDGER|GROUP)\\b') -and -not $vtOnly) {""")
# 1.12.9: the ledgers carry the party's email, phone and address, for balance confirmations and reminders
R("""  $fetch = 'NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE'""",
  """  $fetch = 'NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE,EMAIL,LEDGERPHONE,LEDGERMOBILE,ADDRESS.LIST,LEDMAILINGDETAILS.LIST'""")
R("""    $ledgers += [ordered]@{
      name = $name; group = (Get-NodeText $l 'PARENT'); pan = (Get-NodeText $l 'INCOMETAXNUMBER'); gstin = $gstin""", """    $addr = @(); foreach ($an in $l.SelectNodes('ADDRESS.LIST/ADDRESS')) { if ($an.InnerText.Trim()) { $addr += $an.InnerText.Trim() } }
    if (-not $addr.Count) { foreach ($an in $l.SelectNodes('LEDMAILINGDETAILS.LIST/ADDRESS.LIST/ADDRESS')) { if ($an.InnerText.Trim()) { $addr += $an.InnerText.Trim() } } }
    $ledgers += [ordered]@{
      name = $name; group = (Get-NodeText $l 'PARENT'); pan = (Get-NodeText $l 'INCOMETAXNUMBER'); gstin = $gstin
      email = (Get-NodeText $l 'EMAIL'); phone = (Get-NodeText $l 'LEDGERPHONE'); mobile = (Get-NodeText $l 'LEDGERMOBILE'); address = @($addr)""")
# 1.12.10: light reads for Look up (ledger names; the trial balance on a date in one read)
R("""      '/ledgerbalance' {""", """      '/ledgernames' { $result = Get-LedgerNames ([string]$qs['company']) ([int]('0' + $qs['port'])) }
      '/tb' { $result = Get-TrialBalance ([string]$qs['company']) ([string]$qs['to']) ([int]('0' + $qs['port'])) }
      '/ledgerbalance' {""")
# 1.13.0: keeping FinCom's copy of each open company in step with Tally, in a worker of its own
R("""Write-Host ''
Write-Host '  TDS Desk - Tally Bridge' $BridgeVersion -ForegroundColor Green""", """# 1.13.2: the port is not handed down to programs the bridge starts (a worker holding it kept a new bridge from starting)
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
  try {
    Add-Type -Namespace FinCom -Name NoInherit -MemberDefinition '[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);' -ErrorAction Stop
    if (-not [FinCom.NoInherit]::SetHandleInformation($listener.Server.Handle, 1, 0)) { Write-Log 'Could not keep the port from the workers (Windows said no); the FinCom Connector clears leftovers if one holds it' }
  } catch { try { Write-Log ('Could not keep the port from the workers: ' + $_.Exception.Message) } catch { } }
}
Write-Host ''
Write-Host '  TDS Desk - Tally Bridge' $BridgeVersion -ForegroundColor Green""")
R("""        $sessions = @($(if ($jobsNow.Count) { Get-OpenCompanies } else { Get-OpenCompanies -Fresh }))""", """        $sessions = @(Get-OpenCompanies)          # 1.13.5: the shared answer, at most 30 s old; Tally is not asked on every check""")
R("""        foreach ($s in (Get-OpenCompanies -Fresh)) { if ($s.skipped) { continue }; foreach ($c in $s.companies) { $list += [ordered]@{ name = $c.name; port = $s.port; mine = $s.mine; from = $c.from; to = $c.to } } }""", """        foreach ($s in (Get-OpenCompanies)) { if ($s.skipped) { continue }; foreach ($c in $s.companies) { $list += [ordered]@{ name = $c.name; port = $s.port; mine = $s.mine; from = $c.from; to = $c.to } } }""")
R("[switch]$Sync,", "[switch]$Sync,\n  [switch]$Keep,")
R("  SyncCompanies   = @()\n", "  SyncCompanies   = @()\n  KeepInStep      = $null\n  CloudUrl        = ''\n  CloudKey        = ''\n")
R("if ($Sync) {\n  $r = Invoke-NightlySync", "if ($Keep) {\n  try { Invoke-KeepWorker } catch { Write-Log ('Keeping copies in step stopped: ' + $_.Exception.Message) }\n  exit 0\n}\nif ($Sync) {\n  $r = Invoke-NightlySync")
R("""    if (((Get-Date) - $lastCheck).TotalSeconds -ge 60) { $lastCheck = Get-Date; Show-Diagnosis }""", """    if (((Get-Date) - $lastCheck).TotalSeconds -ge (Get-KeepNum 'KeepStartSec' 60)) { $lastCheck = Get-Date; Show-Diagnosis; try { Start-KeepIfNeeded } catch { Write-Log ('Could not start keeping copies in step: ' + $_.Exception.Message) } }""")
R("""      '/ledgerbalance' {""", """      '/paircode' {
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
      '/keep' { if ($method -eq 'POST') { $o = $body | ConvertFrom-Json; $Cfg.KeepInStep = [bool]$o.on; Save-Config; if ($o.on) { Start-KeepIfNeeded } }; $result = Get-KeepStatus ([string]$qs['company']) }
      '/keepcheck' { $result = Test-KeepMonth ([string]$qs['company']) ([string]$qs['ym']) ([int]('0' + $qs['port'])) }
      '/ledgerbalance' {""")
# 1.13.0: the FinCom Connector may ask the bridge to stop (to update it, or restart it cleanly)
R("""  finally { try { $client.Close() } catch { } }
}""", """  finally { try { $client.Close() } catch { } }
  if ($script:ShutdownAfter) { Write-Log 'Stopping: the FinCom Connector asked'; try { $listener.Stop() } catch { }; exit 0 }
}""")
# 1.12.8: the product is now called FinCom. Only what people read changes; the scheduled task keeps its old name
# (an installed bridge finds and replaces it by that name)
base = '\n'.join(l if "$script:TaskName = 'TDS Desk - nightly Tally copy'" in l else l.replace('TDS Desk', 'FinCom') for l in base.split('\n'))
open(sys.argv[2], 'w', encoding='utf-8-sig', newline='\r\n').write(base)
print('merged', len(base))
