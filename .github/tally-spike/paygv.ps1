# Mode payg (2.4.4's gate, payroll; TEST DATA ONLY: a throwaway company in this runner's own Tally). The gate's setup (the
# committed FinComBridge-Setup-2.4.4.exe) reads Tally's payroll as in production, stubg.py as FinCom's cloud (recorderSource
# "both", every company linked). The data: the payroll test company with known answers (payg/: masters.xml, vouchers.xml,
# setup.json, copied from tests/fixtures/payroll-e2e; made by make.mjs). Dot-sourced by flowv.ps1 twice:
#   $pgPhase = 'masters' (before the bridge starts): payroll on, the ledgers, pay heads, the employee group, 7 employees (each
#     with a bank account, IFSC and an Aadhaar-like number, as a real employee master has them) and a cost centre that is
#     not payroll's, by XML; what Tally kept exported (captures/masters-p0.xml)
#   $pgPhase = 'run' (after the bridge): the 36 entries by XML (12 payrolls in the PaySlip form, 12 salary payments with
#     each employee's bank line, 12 Stat Payments of Income Tax with the challan); the bridge reads them; then:
#   w1 the payroll company made in Tally (masters and the 36 entries)
#   w2 FinComEmployees: only payroll rows reach FinCom (the 7 employees and their group, 11 columns each; the cost centre
#      not for payroll never; no bank account, IFSC or Aadhaar-like number in anything the bridge sent or logged)
#   w3 the ledger list carries the pay-head fields (PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL as the 15th-18th columns)
#   w4 every entry reaches FinCom with Tally's entry; a salary payment keeps BANKEMPLOYEENAME and its AMOUNT, never
#      ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING
#   w5 the payroll entries' request (FinComVoucherObject) within 3 s: no entry fetch the bridge stopped or found over its
#      limit, and the ref's request asked here for each payroll entry under 3 s, Tally responding
# Kept for tests/run_e2e_payroll.py (REAL=<this folder>\captures): bodies.xml (every entry as the bridge sent it),
# employees.json and ledgers.json (the rows as sent), stub-requests.jsonl. A step the harness could not do is HARNESS.
$pdir = Join-Path $PSScriptRoot 'payg'
$W1 = 'w1 the payroll company made in Tally (masters and the 36 entries)'
$W2 = 'w2 FinComEmployees: only payroll rows reach FinCom, nothing personal'
$W3 = 'w3 the ledger list carries the pay-head fields'
$W4 = 'w4 every entry reaches FinCom; a salary payment keeps the employee and amount, never the bank details'
$W5 = 'w5 the payroll entry within 3 s, every other request within 2 s, Tally responding'
function PgCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | Select-Object -First 3 | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; $f = ("$r" -replace '\s+', ' '); return [pscustomobject]@{ c = 0; a = 0; e = -1; line = $f.Substring(0, [Math]::Min(300, $f.Length)) } }
function PgSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function PgE([string]$s) { [Security.SecurityElement]::Escape($s) }
$PS = Get-Content (Join-Path $pdir 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pgPhase -eq 'masters') {
  Say '---- payg masters (before the bridge)'
  $mx = (Get-Content (Join-Path $pdir 'masters.xml') -Raw -Encoding UTF8).Replace('"' + (PgE $PS.company) + '"', '"' + (PgE $co1) + '"').Replace('<NAME>' + (PgE $PS.company) + '</NAME>', '<NAME>' + (PgE $co1) + '</NAME>')
  $script:pgM = PgCount (Imp 'All Masters' $mx 'payg masters')
  Info "payg masters: created $($script:pgM.c), altered $($script:pgM.a), errors $($script:pgM.e)$(if ($script:pgM.line) { "; Tally said: $($script:pgM.line)" })"
  $x = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (PgE $co1) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 'payg masters export' 300
  PgSave 'masters-p0.xml' $x
  $script:pgCC = @([regex]::Matches("$x", '<COSTCENTRE NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
  Info "payg: cost centres in Tally: $($script:pgCC -join ', ')"
  return
}

# ---------------------------------------------------------------- run
Say '---- payg: the entries, the bridge'
$pgDone = @{}
function PgRes($c, $st, $ev) { if (-not $pgDone[$c]) { Result $c $st $ev; $pgDone[$c] = $true } }
function PgAll {
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PgVA</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (PgE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PgVA" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60
  $l = @()
  try { $d = [xml]($x -replace '&#4;', '')
    foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $l += [pscustomobject]@{ guid = Val $v.GUID; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); vno = Val $v.VOUCHERNUMBER; type = Val $v.VOUCHERTYPENAME; date = Val $v.DATE; narr = Val $v.NARRATION } }
  } catch { Write-Host "PgAll parse: $_"; PgSave "vouchers-unparsed-$(Get-Date -Format HHmmss).xml" $x }
  return , @($l | Where-Object { $_.narr -like '*payroll e2e test data*' })
}
function PgTimed([string]$x, [int]$sec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content; $ok = $true } catch { $c = ''; $ok = $false }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ok = $ok; ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); len = "$c".Length }
}
# what must never leave Tally: the masters' bank accounts, IFSCs and Aadhaar-like numbers, the entries' account numbers
$mxRaw = Get-Content (Join-Path $pdir 'masters.xml') -Raw -Encoding UTF8; $vxRaw = Get-Content (Join-Path $pdir 'vouchers.xml') -Raw -Encoding UTF8
$secret = @(@([regex]::Matches($mxRaw + $vxRaw, '<(BANKACCOUNTNUMBER|ACCOUNTNUMBER|IFSCODE|AADHARNUMBER)>([^<]+)<') | ForEach-Object { $_.Groups[2].Value.Trim() }) | Where-Object { $_.Length -ge 6 } | Sort-Object -Unique)
try {
  Start-Sleep 30; Snap 'pg-start'
  $m0 = Mark
  $r = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  Info "payg: Update now: $(if ($r) { 'asked' } else { 'the bridge did not answer' })"
  # ---- the entries
  $vx = @([regex]::Matches($vxRaw, '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | ForEach-Object { $_.Value })
  $made = 0; $bad = @()
  foreach ($v in $vx) {
    $no = [regex]::Match($v, '<VOUCHERNUMBER>([^<]*)<').Groups[1].Value
    $k = PgCount (Imp 'Vouchers' $v "payg $no")
    if ($k.c -eq 1) { $made++ } else { $bad += "$no (created $($k.c), errors $($k.e): $($k.line))" }
  }
  $all = PgAll
  $all | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'tally-vouchers.json') -Encoding UTF8
  $mOk = $script:pgM -and $script:pgM.e -eq 0 -and $script:pgM.c -gt 0
  $other = @($PS.other)
  $ccOk = @($PS.employees | Where-Object { $_[0] -notin $script:pgCC }).Count -eq 0 -and @($other | Where-Object { $_ -notin $script:pgCC }).Count -eq 0
  PgRes $W1 $(if ($mOk -and $ccOk -and $made -eq $vx.Count -and $all.Count -eq $vx.Count) { 'PASS' } else { 'HARNESS' }) ("masters: created {0}, errors {1}{2}; employees and the other cost centre in Tally: {3}; entries made by XML: {4} of {5} (in Tally: {6}); refused: {7}" -f $script:pgM.c, $script:pgM.e, $(if ($script:pgM.line) { " ($($script:pgM.line))" }), $ccOk, $made, $vx.Count, $all.Count, $(if ($bad.Count) { $bad -join '; ' } else { 'none' }))
  # ---- the bridge reads them: every entry's line with Tally's entry; the employees' list
  $t0 = Get-Date; $until = $t0.AddMinutes(30); $miss = $all; $emp = $null
  while ((Get-Date) -lt $until) {
    $sl = StubLines 0
    $miss = @($all | Where-Object { $w = $_; -not @($sl | Where-Object { $_.guid -eq $w.guid -and $_.xml -and [int]$_.aid -ge $w.aid }).Count })
    $emp = @((StubReqs) | Where-Object { $_.kind -eq 'employees' }) | Select-Object -Last 1
    if (-not $miss.Count -and $emp) { break }
    Write-Host "[payg] waiting: $($miss.Count) of $($all.Count) entries, employees $(if ($emp) { 'sent' } else { 'not yet' })"
    Start-Sleep 20
  }
  Snap 'pg-read'
  $reqs = StubReqs
  $sent = Get-Content $stubLog -Raw -Encoding UTF8
  $blogText = if (Test-Path $blog) { Get-Content $blog -Raw -Encoding UTF8 } else { '' }
  # w2
  $leak = @($secret | Where-Object { $sent.Contains($_) -or $blogText.Contains($_) })
  if ($emp) {
    $rows = @($emp.body.employees)
    $names = @($rows | ForEach-Object { "$($_[3])" })
    $wantN = @(@($PS.employees | ForEach-Object { $_[0] }) + @($PS.group))
    $missN = @($wantN | Where-Object { $_ -notin $names }); $extra = @($names | Where-Object { $_ -notin $wantN })
    $cols = @($rows | ForEach-Object { @($_).Count } | Sort-Object -Unique)
    $grp = @($rows | Where-Object { "$($_[3])" -eq $PS.group -and "$($_[6])" -eq '1' }).Count
    $pan = @($rows | Where-Object { "$($_[3])" -eq 'PE Gita Sharma' -and "$($_[7])" -eq 'ABCPS1007G' }).Count
    $rows | ConvertTo-Json -Depth 4 -Compress | Set-Content (Join-Path $cap 'employees.json') -Encoding UTF8
    $empLog = @(($blogText -split "`n") | Where-Object { $_ -match 'Employees of ' } | Select-Object -Last 3)
    PgRes $W2 $(if (-not $missN.Count -and -not $extra.Count -and "$cols" -eq '11' -and $grp -eq 1 -and $pan -eq 1 -and -not $leak.Count) { 'PASS' } else { 'FAIL' }) ("{0} rows sent ({1}); missing: {2}; not payroll's yet sent: {3}; columns per row: {4}; the group marked: {5}; a PAN as typed: {6}; bank account, IFSC or Aadhaar-like number in what the bridge sent or logged: {7}; the log: {8}" -f $rows.Count, ($names -join ', '), $(if ($missN.Count) { $missN -join ', ' } else { 'none' }), $(if ($extra.Count) { $extra -join ', ' } else { 'none' }), "$cols", $grp, $pan, $(if ($leak.Count) { $leak -join ', ' } else { 'none' }), ($empLog -join ' | '))
  } else { PgRes $W2 'FAIL' ("no employees list reached the stub in {0} min; the log: {1}" -f [math]::Round(((Get-Date) - $t0).TotalMinutes, 1), ((@(($blogText -split "`n") | Where-Object { $_ -match 'Employees' } | Select-Object -Last 3)) -join ' | ')) }
  # w3: the ledger rows (ledger_list / ledger_changes)
  $lrows = @(); foreach ($q in $reqs) { if ($q.kind -in 'ledger_list', 'ledger_changes') { foreach ($x in @($q.body.ledgers)) { if ($x -is [array] -or $x -is [Collections.IList]) { $lrows += , @($x) } } } }
  $lrows | ConvertTo-Json -Depth 4 -Compress | Set-Content (Join-Path $cap 'ledgers.json') -Encoding UTF8
  function PgLed($n) { @($lrows | Where-Object { "$($_[3])" -eq $n }) | Select-Object -Last 1 }
  $chk = @()
  foreach ($h in $PS.payHeads) {
    $row = PgLed $h[0]
    if (-not $row) { $chk += "$($h[0]): no row"; continue }
    $a = @($row); $n = $a.Count
    $got = if ($n -ge 18) { @("$($a[$n - 4])", "$($a[$n - 3])", "$($a[$n - 2])", "$($a[$n - 1])") } else { @() }
    $ok = $n -ge 18 -and $got[0] -eq $h[2] -and $got[1] -eq "$($h[3])" -and $got[2] -eq "$($h[4])" -and $got[3] -eq 'Yes'
    $chk += "$($h[0]): $(if ($ok) { 'ok' } else { "NOT ($n columns: $($got -join ' / '))" })"
  }
  $cash = PgLed $PS.payable
  $cashOk = $cash -and @($cash).Count -ge 18 -and "$(@($cash)[-1])" -ne 'Yes'
  PgRes $W3 $(if (-not $lrows.Count) { 'FAIL' } elseif (-not @($chk | Where-Object { $_ -notmatch ': ok$' }).Count -and $cashOk) { 'PASS' } else { 'FAIL' }) ("{0} ledger rows sent; pay heads (PAYTYPE / PAYSTATTYPE / ITCOMPONENT / FORPAYROLL): {1}; {2} not for payroll: {3}" -f $lrows.Count, ($chk -join '; '), $PS.payable, $cashOk)
  # w4: every entry with its body; the salary payments' bank lines
  $sl = StubLines 0
  $bodies = @{}; foreach ($w in $all) { $b = @($sl | Where-Object { $_.guid -eq $w.guid -and $_.xml } | Sort-Object { [int]$_.aid }) | Select-Object -Last 1; if ($b) { $bodies[$w.guid] = $b.xml } }
  PgSave 'bodies.xml' ('<ENVELOPE><BODY><DATA><TALLYMESSAGE>' + (($all | Where-Object { $bodies[$_.guid] } | ForEach-Object { $bodies[$_.guid] }) -join "`n") + '</TALLYMESSAGE></DATA></BODY></ENVELOPE>')
  $pays = @($all | Where-Object { $_.type -eq 'Payment' -and $bodies[$_.guid] -match 'BANKALLOCATIONS' })
  $named = @($pays | Where-Object { $bodies[$_.guid] -match '<BANKEMPLOYEENAME[^>]*>[^<]+<' }).Count
  $never = @($all | Where-Object { $bodies[$_.guid] -match '<(ACCOUNTNUMBER|IFSCODE|PAYMENTFAVOURING)[ >]' } | ForEach-Object { $_.vno })
  $tagLeak = $sent -match '(ACCOUNTNUMBER|IFSCODE|PAYMENTFAVOURING)'
  $prl = @($all | Where-Object { $_.type -eq 'Payroll' }); $prlBody = @($prl | Where-Object { $bodies[$_.guid] -match 'COSTCENTREALLOCATIONS\.LIST' }).Count   # each employee's amount per pay head: the pay head's line, its cost centre (the employee) allocations (run 38271385254: the strip keeps these, not the pay slip's EMPLOYEEENTRIES)
  PgRes $W4 $(if (-not $all.Count) { 'HARNESS' } elseif (-not $miss.Count -and $named -ge 12 -and -not $never.Count -and -not $tagLeak -and $prlBody -eq $prl.Count) { 'PASS' } else { 'FAIL' }) ("{0} of {1} entries reached the stub with Tally's entry in {2} min (not: {3}); payrolls with each employee's amount per pay head (cost centre allocations): {4} of {5}; salary payments naming the employee on the bank line: {6} (of {7} payments with a bank line); an entry keeping ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING: {8}; those tags anywhere in what the bridge sent: {9}" -f ($all.Count - $miss.Count), $all.Count, [math]::Round(((Get-Date) - $t0).TotalMinutes, 1), $(if ($miss.Count) { ($miss | ForEach-Object { $_.vno }) -join ', ' } else { 'none' }), $prlBody, $prl.Count, $named, $pays.Count, $(if ($never.Count) { $never -join ', ' } else { 'none' }), $tagLeak)
  # w5: the bridge's own words on its entry fetches, then the ref's request for each payroll entry asked here
  $slow = @(($blogText -split "`n") | Where-Object { $_ -match 'entry fetch of .*(over 2 s|over the limit|not answered)' })
  $learn = @(($blogText -split "`n") | Where-Object { $_ -match 'Payroll: the voucher type' }).Count
  $tmplF = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'; $times = @(); $resp = $true
  if (Test-Path $tmplF) {
    $tpl = (Get-Content $tmplF -Raw).Trim()
    foreach ($p in $prl) {
      $q = $tpl.Replace('FinCom Spike Co', (PgE $co1)).Replace('99999', "$($p.mid)")
      $t = PgTimed $q 30; $times += $t.ms
      if (-not $t.ok -or $t.len -lt 200) { $resp = $false }
      $lt = PgTimed '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PgLight</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PgLight" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>' 10
      if (-not $lt.ok) { $resp = $false }
    }
  }
  $worst = if ($times.Count) { ($times | Measure-Object -Maximum).Maximum } else { -1 }
  PgRes $W5 $(if (-not $times.Count) { 'HARNESS' } elseif (-not $slow.Count -and $worst -lt 3000 -and $resp) { 'PASS' } else { 'FAIL' }) ("the bridge's entry fetches stopped or over the limit: {0}; the payroll type learnt or known: {1}; the ref's FinComVoucherObject on the {2} payroll entries: {3} ms (worst {4} ms), Tally responding after each: {5}" -f $(if ($slow.Count) { ($slow | Select-Object -First 3) -join ' | ' } else { 'none' }), $(if ($learn) { "learnt ($learn line(s))" } else { "Tally's own Payroll type" }), $prl.Count, ($times -join '/'), $worst, $resp)
} catch {
  Write-Host "payg stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($W1, $W2, $W3, $W4, $W5)) { PgRes $c 'HARNESS' "the harness stopped: $_" }
}
# ---- what is kept
Snap 'pg-end'
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
foreach ($f in @(Get-ChildItem (Split-Path $blog) -Filter 'tds-bridge*.log' -ErrorAction SilentlyContinue)) { Copy-Item $f.FullName (Join-Path $out "bridge-full-$($f.Name)") -ErrorAction SilentlyContinue }
$cf = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $cf.Key = '(kept out)'; if ($cf.CloudKey) { $cf.CloudKey = '(kept out)' }
$cf | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'bridge-settings.json')
