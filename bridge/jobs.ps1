# ------------------------------------------------------------------ posting as a background job (bridge 1.12)
# TDS Desk hands a batch to POST /jobs and gets a job number at once. A separate PowerShell process (this same
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
  $psi.UseShellExecute = $true; $psi.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden     # inherits nothing, not the bridge's port
  return [Diagnostics.Process]::Start($psi).Id
}

# a job as TDS Desk sees it; a running job whose process has gone is "interrupted" (TDS Desk resumes it)
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
    # sending is finished: TDS Desk shows it at once; the read-back runs after, in one read, while TDS Desk carries on
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
