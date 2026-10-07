# Bridge 2.3.2 (issue 232), input only=slow232: a company whose single-entry lookup takes Tally over 2 s, on a real
# TallyPrime. Dot-sourced by flow4.ps1 (KeysTo, Post, ListCo, Vouchers, WaitPort, StubReqs, StubLines, Mark, Say, Result,
# Shot, $B, $co1, $rec, $out, $resultsFile, $dir, $exe, $data1, $tdl, $script:tallyPids).
#   setup (before the bridges start): Tally 9000 is started without a company and without the add-on; a second company,
#     "FinCom Slow Co", is made by keys (as flow.ps1 C) and filled by XML with the push-design harness's large company
#     (branch tally-versions, .github/tally-spike/push/data.ps1: 3,000 ledgers, 3,000 items, up to 30,000 entries; the
#     bridge's lookup of one entry took 4.4-5.3 s there). Tally 9000 then starts again with the add-on and both companies.
#     Bridge 1 talks to Tally 9000 through a timing proxy on 127.0.0.2:9000 (slow232proxy.py: one JSON line per request,
#     its id, company, MasterID and times; nothing changed), so every request the bridge sends is counted per company.
#   run (after the bridges start): a small-company entry (it arrives with its details); entries in the large company
#     (imported: the add-on writes their lines); the bridge must mark the large company "entry fetch stopped: over 2 s"
#     after 2 separate occasions; then no entry request for it; its lines go up held with the words; its earlier held
#     lines end with the Day Book words; a small-company entry still arrives; no request of the bridge holds Tally 2 s or
#     more after the mark, and Tally's window keeps answering.
$S2 = @{ co = 'FinCom Slow Co'; dir = (Join-Path $out 'slow232'); vch = [int]$(if ($env:S232_VCH) { $env:S232_VCH } else { 30000 }); budget = [int]$(if ($env:S232_MIN) { $env:S232_MIN } else { 40 })
  proxyLog = (Join-Path $out 'slow232\proxy.jsonl'); words = "FinCom does not ask Tally for this company's entries: finding one entry took Tally longer than 2 s. Upload that day's Day Book to settle it."; ok = $false }
New-Item -ItemType Directory -Force $S2.dir | Out-Null

function S2Esc([string]$s) { [Security.SecurityElement]::Escape($s) }
function S2Led($name, $parent, $extra = '') { '<LEDGER NAME="' + (S2Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (S2Esc $name) + '</NAME></NAME.LIST><PARENT>' + (S2Esc $parent) + '</PARENT>' + $extra + '</LEDGER>' }
function S2Item($name) { '<STOCKITEM NAME="' + (S2Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (S2Esc $name) + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>' }
# the push-design large company (data.ps1 on tally-versions: HeavyDates, HeavyMasters, HeavyVoucher, plain forms)
function S2Dates { $d = @(); $m = [DateTime]::new(2026, 4, 1); while ($m -lt [DateTime]::new(2026, 10, 1)) { $d += $m.ToString('yyyyMM') + '01'; $d += $m.ToString('yyyyMM') + '02'; if ([DateTime]::DaysInMonth($m.Year, $m.Month) -eq 31) { $d += $m.ToString('yyyyMM') + '31' }; $m = $m.AddMonths(1) }; return $d }
function S2Masters {
  $m = @('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
  $m += S2Led 'Sales' 'Sales Accounts'; $m += S2Led 'Output CGST' 'Duties & Taxes'; $m += S2Led 'Output SGST' 'Duties & Taxes'
  $m += S2Led 'HDFC Bank' 'Bank Accounts'; $m += S2Led 'Spike Income' 'Indirect Incomes'; $m += S2Led 'Spike Party' 'Sundry Debtors'
  for ($i = 1; $i -le 2700; $i++) { $m += S2Led ('HParty {0:d5}' -f $i) 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>' }
  for ($i = 1; $i -le 300; $i++) { $m += S2Led ('HExpense {0:d4}' -f $i) 'Indirect Expenses' }
  for ($i = 1; $i -le 3000; $i++) { $m += S2Item ('HItem {0:d5}' -f $i) }
  return $m
}
function S2Sales($date, $no, $party, [string[]]$items, $narr) {
  $sub = 200 * $items.Count; $tax = [math]::Round($sub * 0.09, 2); $tot = $sub + 2 * $tax; $f = '{0:0.00}'
  $x = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>'
  $x += '<PARTYLEDGERNAME>' + (S2Esc $party) + '</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>' + (S2Esc $narr) + '</NARRATION>'
  $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-' + ($f -f $tot) + '</AMOUNT>'
  $x += '<BILLALLOCATIONS.LIST><NAME>' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-' + ($f -f $tot) + '</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
  foreach ($t in 'Output CGST', 'Output SGST') { $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f $tax) + '</AMOUNT></LEDGERENTRIES.LIST>' }
  foreach ($it in $items) { $x += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + (S2Esc $it) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' }
  $x + '</VOUCHER>'
}
function S2Receipt($date, $no, $party, $amt, $narr) {
  $f = '{0:0.00}'
  '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + (S2Esc $narr) + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ($f -f $amt) + '</AMOUNT><BILLALLOCATIONS.LIST><NAME>ADV-' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>' + ($f -f $amt) + '</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ($f -f $amt) + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
function S2Journal($date, $no, $exp, $narr, $amt = 75) {
  '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + (S2Esc $narr) + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (S2Esc $exp) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
function S2Voucher($k, $dates) {
  $date = $dates[$k % $dates.Count]; $party = 'HParty {0:d5}' -f (($k % 2700) + 1)
  switch ($k % 5) {
    { $_ -in 0, 1 } { $its = @(); for ($j = 0; $j -lt 3; $j++) { $its += ('HItem {0:d5}' -f ((($k * 3 + $j) % 3000) + 1)) }; return S2Sales $date ('HS-{0:d6}' -f $k) $party $its "heavy sales $k" }
    { $_ -in 2, 3 } { return S2Receipt $date ('HR-{0:d6}' -f $k) $party 500 "heavy receipt $k" }
    default { return S2Journal $date ('HJ-{0:d6}' -f $k) ('HExpense {0:d4}' -f (($k % 300) + 1)) "heavy journal $k" }
  }
}
# one XML import of many objects into a company, with a long timeout; created / errors counted
function S2Imp($co, $report, [string[]]$objs, $label) {
  $body = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (S2Esc $co) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + ($objs -join '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  $t0 = Get-Date
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 900).Content } catch { $c = "failed: $($_.Exception.Message)" }
  $cr = [int]([regex]::Match("$c", '<CREATED>(\d+)</CREATED>').Groups[1].Value + '0') / 10; $er = [int]([regex]::Match("$c", '<ERRORS>(\d+)</ERRORS>').Groups[1].Value + '0') / 10
  Write-Host ("[slow232 import] {0}: {1} sent, created {2}, errors {3}, {4:0.0} s{5}" -f $label, $objs.Count, $cr, $er, ((Get-Date) - $t0).TotalSeconds, $(if ($er -or -not $cr) { ' ' + ("$c" -replace '\s+', ' ').Substring(0, [Math]::Min(300, "$c".Length)) } else { '' }))
  return [pscustomobject]@{ created = $cr; errors = $er; raw = "$c" }
}
function S2StartTally([string[]]$ini) {
  Stop-Process -Id $script:tallyPids[9000] -Force -ErrorAction SilentlyContinue
  # (run 37564741475: a tally process without a path stopped the harness here) only this Tally's port is checked
  for ($i = 0; $i -lt 10; $i++) { try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Sleep 1 } catch { break } }
  Start-Sleep 4
  Set-Content -Path "$dir\tally.ini" -Value $ini -Encoding ASCII
  Write-Host "[slow232] tally.ini: $($ini -join ' | ')"
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tallyPids[9000] = $t.Id
  $up = WaitPort 9000; Start-Sleep 5; KeysTo 9000 'a' 4; KeysTo 9000 't' 10
  return $up
}
function S2Ini($tdlFile, [string[]]$loads) {
  $l = @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($loads) { $l += 'Default Companies = Yes'; $l += $loads } else { $l += 'Default Companies = No' }
  if ($tdlFile) { $l += "TDL = $tdlFile" }
  return , $l
}
# runs 37562246809 and 37566575498: the company list (ListCo) answered no company while Tally showed one open; a company's
# own ledgers are asked instead (a company just made has Cash and Profit & Loss)
function S2Has([string]$name) {
  $r = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCS2L</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (S2Esc $name) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCS2L" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
  $ok = ("$r" -match '<LEDGER\b') -and ("$r" -notmatch 'Could not find')
  Write-Host "[slow232] company '$name' open in Tally 9000: $ok"
  return $ok
}

# ---- setup, before the bridges start
function Slow232Setup {
  Say "---- slow232 setup: a large company '$($S2.co)' in Tally 9000 beside '$co1' (up to $($S2.vch) entries, $($S2.budget) min), before the bridges start"
  $before = @(Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object Name)
  Write-Host "[slow232] company folders before: $($before -join ', ')"
  # 1. Tally without a company and without the add-on (its import lines would be 30,000 recorder lines): made by keys
  $null = S2StartTally (S2Ini $null $null)
  # run 37562246809: Tally 7.1 opened the last company again although tally.ini says Default Companies = No; then the
  # Gateway is up and {ENTER} is its masters' Create. With a company open: the Company menu (Alt+K), Create
  # (run 37566575498: the small company is open again by the time the keys go, whatever the check said): always the Company menu
  KeysTo 9000 '%k' 3 's232-01a-company-menu'; KeysTo 9000 'c' 5 's232-01-create-company'
  KeysTo 9000 $S2.co 2 's232-02-name'; KeysTo 9000 '^a' 8 's232-03-ctrl-a'
  $have = S2Has $S2.co
  foreach ($k in @('y', '^a', '{ENTER}', 'y', '{ESC}', 'y')) { if ($have) { break }; KeysTo 9000 $k 6 ''; $have = S2Has $S2.co }
  KeysTo 9000 '^a' 5 's232-04-company'
  if (-not $have) { Result 'slow232 setup: the large company made by keys' $false "Tally lists no '$($S2.co)'" $true; return }
  # 2. its masters and entries by XML (the push-design large company)
  $t0 = Get-Date
  $m = S2Masters
  for ($i = 0; $i -lt $m.Count; $i += 1000) { $null = S2Imp $S2.co 'All Masters' $m[$i..([math]::Min($i + 999, $m.Count - 1))] "masters $i" }
  $dates = S2Dates; $made = 0
  for ($k = 0; $k -lt $S2.vch; $k += 1000) {
    if (((Get-Date) - $t0).TotalMinutes -gt $S2.budget) { Say "slow232: the import stopped at its time budget ($($S2.budget) min) after $made entries"; break }
    $batch = @(); for ($j = $k; $j -lt [math]::Min($k + 1000, $S2.vch); $j++) { $batch += S2Voucher $j $dates }
    $made += (S2Imp $S2.co 'Vouchers' $batch "entries $k").created
  }
  $S2.made = $made; $S2.importMin = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO slow232: the large company '$($S2.co)' holds $made entries made by XML ($($S2.importMin) min), 3,000 ledgers, 3,000 items"
  $after = @(Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object Name)
  $hv = @($after | Where-Object { $_ -notin $before })[0]; $c1 = @($before)[0]
  Write-Host "[slow232] company folders after: $($after -join ', '); '$co1' $c1, '$($S2.co)' $hv"
  # 3. Tally again with the add-on and both companies loaded (two Load lines; else one line with both)
  $ok = $false
  foreach ($variant in @(@("Load = $c1", "Load = $hv"), @("Load = $c1, $hv"))) {
    $null = S2StartTally (S2Ini $tdl $variant)
    if ((S2Has $co1) -and (S2Has $S2.co)) { $ok = $true; break }
    Write-Host "[slow232] both companies not loaded with: $($variant -join ' | ')"
  }
  Shot 's232-05-both-loaded'
  if (-not $ok) { Result 'slow232 setup: both companies loaded in Tally 9000' $false "Tally lists: $(ListCo 9000)" $true; return }
  AddLedger 9000 $co1   # Spike Income in the small company, for its journals
  # the bridge's own entry request (as built at the ref) on one entry of the large company: its time on this Tally
  $req = Join-Path $env:BRIDGE_DIST 'requests\entry.xml'
  if (Test-Path $req) {
    $vs = @(Vouchers 9000 $S2.co | Select-Object -Last 3)
    foreach ($v in $vs) {
      $q = (Get-Content $req -Raw) -replace 'FinCom Spike Co', (S2Esc $S2.co) -replace '99999', "$($v.mid)" -replace '20261001', '20260401'
      $t1 = Get-Date; $a = Post 9000 $q ''; $ms = [int]((Get-Date) - $t1).TotalMilliseconds
      Add-Content -Path $resultsFile -Encoding UTF8 -Value "MEASURE slow232: the bridge's entry request for MasterID $($v.mid) of the large company took $ms ms on this Tally ($("$a".Length) bytes)"
    }
  }
  # bridge 1 talks to Tally 9000 through the timing proxy (its settings get TallyHost 127.0.0.2)
  $S2.proxy = Start-Process python -ArgumentList "`"$PSScriptRoot\slow232proxy.py`"", '9000', "`"$($S2.proxyLog)`"" -PassThru -WindowStyle Hidden
  Start-Sleep 3
  $S2.ok = $true
}

function S2Proxy { if (Test-Path $S2.proxyLog) { @(Get-Content $S2.proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }) } else { @() } }
function S2Entry($r) { $r.id -in 'FinComVoucherByMaster', 'FinComVoucherByNumber' }
function S2Import($co, $xml, $label) { S2Imp $co 'Vouchers' @($xml) $label }
function S2BridgeLog { if (Test-Path $B[1].log) { @(Get-Content $B[1].log) } else { @() } }

# ---- the run, after the bridges start
function Slow232 {
  if (-not $S2.ok) { Result 'slow232' $false 'the setup did not finish (see the HARNESS line above)' $true; return }
  Say '---- slow232: a small entry, then entries in the large company'
  Start-Sleep 60   # the bridge's first looks: both companies' starting points
  $m0 = Mark
  # 1. a small-company entry arrives with its details (baseline)
  $null = S2Import $co1 (S2Journal '20260401' 'S232-SMALL-1' 'Spike Party' 'slow232 small 1' 11) 'small 1'
  $sm1 = WaitLine $m0 { $_.vch -like '*S232-SMALL-1*' -and $_.xml } 180
  Result 'slow232 a small entry before' ($sm1.Count -ge 1) $(if ($sm1.Count) { Ev $sm1[0] } else { 'no line with a body in 180 s' })
  # 2. entries in the large company until the bridge marks it (an entry every 2 minutes, at most 6), a small entry between
  $t0 = Get-Date; $marked = $null; $n = 0
  while (-not $marked -and $n -lt 6) {
    $n++
    $null = S2Import $S2.co (S2Journal '20260401' "S232-BIG-$n" 'HExpense 0001' "slow232 big $n" (20 + $n)) "big $n"
    for ($w = 0; $w -lt 24 -and -not $marked; $w++) {
      Start-Sleep 5
      if ($w -eq 10) { $null = S2Import $co1 (S2Journal '20260401' "S232-SMALL-B$n" 'Spike Party' "slow232 small between $n" (30 + $n)) "small between $n" }
      $marked = @(S2BridgeLog | Where-Object { $_ -match [regex]::Escape($S2.co) + ': entry fetch stopped: over 2 s' })[0]
    }
  }
  $markAt = Get-Date
  $px = S2Proxy
  $bigBefore = @($px | Where-Object { (S2Entry $_) -and $_.company -eq $S2.co })
  $stopsBefore = @($bigBefore | Where-Object { $_.ms -ge 2000 })
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO slow232: the large company's entry requests before the mark: {0} ({1} took 2 s or more at Tally: {2} ms)" -f $bigBefore.Count, $stopsBefore.Count, (($bigBefore | ForEach-Object { $_.ms }) -join ', '))
  Result 'slow232 the large company is marked' ([bool]$marked) $(if ($marked) { "$marked; $($stopsBefore.Count) stop(s) of its entry request before it ($n entr$(if ($n -eq 1) { 'y' } else { 'ies' }) saved)" } else { "no mark in the bridge's log after $n entries ($([int]((Get-Date) - $t0).TotalMinutes) min)" })
  if (-not $marked) { return }
  $beat = @(StubReqs | Where-Object { $_.kind -eq 'beat' -and $_.body.recorderBodyFetch -and $_.body.recorderBodyFetch.($S2.co) } | Select-Object -Last 1)
  $bf = if ($beat.Count) { $beat[0].body.recorderBodyFetch.($S2.co) } else { $null }
  Result 'slow232 the beat carries it' ($bf -and $bf.off -eq $true -and $bf.company -eq $S2.co -and $bf.since -and [int]$bf.timesOver -ge 2) $(if ($bf) { ($bf | ConvertTo-Json -Compress) } else { 'no beat with recorderBodyFetch for it' })
  # 3. after the mark: two more large-company entries and a small one; Tally's window watched meanwhile
  $mk = Mark; $pxN = (S2Proxy).Count
  $hung = 0; $worst = 0; $tp = Get-Process -Id $script:tallyPids[9000]; $h = $tp.MainWindowHandle
  for ($j = 1; $j -le 2; $j++) { $null = S2Import $S2.co (S2Journal '20260401' "S232-AFTER-$j" 'HExpense 0002' "slow232 after $j" (40 + $j)) "after $j" }
  $null = S2Import $co1 (S2Journal '20260401' 'S232-SMALL-2' 'Spike Party' 'slow232 small 2' 12) 'small 2'
  $tEnd = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $tEnd) {
    $s = Get-Date; $r = $true; try { $r = [PuW]::Responds($h, 3000) } catch {}
    $ms = [int]((Get-Date) - $s).TotalMilliseconds; if ($ms -gt $worst) { $worst = $ms }; if (-not $r) { $hung++ }
    Start-Sleep -Milliseconds 250
  }
  $after = @(S2Proxy | Select-Object -Skip $pxN)
  $bigAfter = @($after | Where-Object { (S2Entry $_) -and $_.company -eq $S2.co })
  $slowAfter = @($after | Where-Object { $_.ms -ge 2000 })
  Result 'slow232 no entry request for it after the mark' ($bigAfter.Count -eq 0) ("{0} entry request(s) for '{1}' after the mark; the bridge's requests after it: {2}" -f $bigAfter.Count, $S2.co, ((($after | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', ')))
  $la = @(StubLines $mk | Where-Object { $_.vch -like '*S232-AFTER-*' })
  Result 'slow232 its new lines go up held with the words' ($la.Count -ge 2 -and @($la | Where-Object { $_.held -eq $S2.words -and -not $_.xml }).Count -ge 2) (($la | ForEach-Object { Ev $_ }) -join ' || ')
  $all = @(StubLines $m0 | Where-Object { $_.company -eq $S2.co -and $_.vch -like '*S232-BIG-*' })
  $ended = @($all | Where-Object { $_.held -match "upload that day's Day Book" })
  $bigNos = @($all | ForEach-Object { ($_.vch -split '/')[1] } | Select-Object -Unique)
  $endNos = @($ended | ForEach-Object { ($_.vch -split '/')[1] } | Select-Object -Unique)
  Result 'slow232 its held lines end with the Day Book words' ($bigNos.Count -ge 1 -and $endNos.Count -eq $bigNos.Count -and -not @($all | Where-Object { $_.xml })) ("entries {0}; ended {1}: {2}" -f ($bigNos -join ', '), ($endNos -join ', '), (($all | ForEach-Object { Ev $_ }) -join ' || '))
  $sm2 = @(StubLines $mk | Where-Object { $_.vch -like '*S232-SMALL-2*' -and $_.xml })
  Result 'slow232 a small entry after the mark' ($sm2.Count -ge 1) $(if ($sm2.Count) { Ev $sm2[0] } else { 'no line with a body' })
  Result 'slow232 Tally never held by the bridge after the mark' ($slowAfter.Count -eq 0 -and $hung -eq 0) ("requests of 2 s or more at Tally after the mark: {0}; Tally's window did not answer {1} time(s) in 4 min (the slowest answer {2} ms); the bridge's slowest request after the mark {3} ms" -f $slowAfter.Count, $hung, $worst, ((@($after | ForEach-Object { [int]$_.ms }) + 0 | Measure-Object -Maximum).Maximum))
  $bl = S2BridgeLog
  Set-Content (Join-Path $S2.dir 'bridge1-log-slow232.txt') ($bl | Where-Object { $_ -match 'Recorder: |did not answer in time|answered in time again|entry fetch' }) -Encoding UTF8
  Copy-Item $S2.proxyLog (Join-Path $S2.dir 'proxy-copy.jsonl') -ErrorAction SilentlyContinue
}
