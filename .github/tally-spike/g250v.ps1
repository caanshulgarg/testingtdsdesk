# Mode g250 (2.5.0's gate, the owner's decision of 30-Oct-2026: the ledger reads carry the books' first year as their
# period; TEST DATA ONLY, a throwaway company in this runner's own Tally). The published 2.4.9 is installed first (its
# committed setup, bridge-dist\old249), reads the ledgers with Tally's Gateway in a later year (what put the wrong openings
# in book 3d36a836), then the gate's setup (the committed 2.5.0) goes over it and reads them again. stubg.py is FinCom's
# cloud, proxy235.py stands between the bridge and Tally (every request logged with its time). Dot-sourced by flowv.ps1:
#   $g250Phase = 'masters' (before the bridge starts): ledgers under every primary group by XML, with openings, zero-opening
#     ones never used, names with double quotes and with a double space; entries in year 1 and year 2 (Educational days)
#   $g250Phase = 'run' (the published 2.4.9 running): then
#   e1 2.5.0 installed over 2.4.9: the version, the port and key carried
#   e2 the Gateway's period and date in a later year: every ledger's opening as at the books' beginning (2.4.9 sent the
#      later year's: said as INFO), openingsAt = BOOKSFROM, the first dated round sends every ledger
#   e3 every ledger read: zero-opening unused, quote and double-space names, every primary group
#   e4 each request within 2 s (the ledger requests, the company list), the ledger requests carrying exactly the books'
#      first year; the ref's three ledger requests asked here too, each timed
#   e5 one request in flight at Tally; postings first: a posting during the ledger read reaches Tally at once
# A step the harness could not do is HARNESS, never PASS.
$E1 = 'e1 2.5.0 installed over 2.4.9: the version and the settings carried'
$E2 = 'e2 the Gateway in a later year: every opening as at the books'' beginning'
$E3 = 'e3 every ledger read: zero-opening unused, quote and double-space names, every primary group'
$E4 = 'e4 each request within 2 s, the ledger requests carrying exactly the books'' first year'
$E5 = 'e5 one request in flight; postings first during the ledger read'
function EE([string]$s) { [Security.SecurityElement]::Escape($s) }
function ECount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; e = [int]$m.Groups[2].Value } }; return [pscustomobject]@{ c = 0; e = -1 } }
function ETimed([string]$x, [int]$sec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content } catch { $c = "failed: $($_.Exception.Message)" }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
# Tally's sign in OPENINGBALANCE: a credit positive. [name, group, opening at the books' beginning, used in entries]
$script:gLed = @(
  @('G5 Capital', 'Capital Account', '250000.00', $false), @('G5 Loan Taken', 'Loans (Liability)', '100000.00', $false),
  @('G5 Creditor "Quoted" Ltd', 'Sundry Creditors', '30000.00', $true), @('G5 R  K Service Station', 'Sundry Creditors', '0', $false),
  @('G5 Duty Ledger', 'Duties & Taxes', '0', $false), @('G5 Machinery', 'Fixed Assets', '-200000.00', $false),
  @('G5 FD', 'Investments', '-80000.00', $false), @('G5 Debtor', 'Sundry Debtors', '-50000.00', $true), @('G5 Bank', 'Bank Accounts', '-40000.00', $true),
  @('G5 Cash', 'Cash-in-Hand', '-10000.00', $true), @('G5 Branch', 'Branch / Divisions', '0', $false), @('G5 Suspense', 'Suspense A/c', '0', $false),
  @('G5 Sales', 'Sales Accounts', '0', $true), @('G5 Purchase', 'Purchase Accounts', '0', $true), @('G5 Direct Income', 'Direct Incomes', '0', $false),
  @('G5 Direct Expense', 'Direct Expenses', '0', $false), @('G5 Indirect Income', 'Indirect Incomes', '0', $false), @('G5 Rent', 'Indirect Expenses', '0', $true),
  @('G5 Unused Zero', 'Current Assets', '0', $false), @('G5 Misc Exp', 'Misc. Expenses (ASSET)', '0', $false))
if ($g250Phase -eq 'masters') {
  Say '---- g250 masters (before the bridge)'
  $cx = ETimed ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>G5Co</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (EE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="G5Co" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, BOOKSFROM</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $script:gBf = [regex]::Match($cx.body, '<BOOKSFROM[^>]*>\s*(\d{8})').Groups[1].Value
  $mx = ''
  foreach ($l in $script:gLed) {
    $mx += '<LEDGER NAME="' + (EE $l[0]) + '" ACTION="Create"><NAME.LIST><NAME>' + (EE $l[0]) + '</NAME></NAME.LIST><PARENT>' + (EE $l[1]) + '</PARENT><ISBILLWISEON>No</ISBILLWISEON>'
    if ($l[2] -ne '0') { $mx += '<OPENINGBALANCE>' + $l[2] + '</OPENINGBALANCE>' }
    $mx += '</LEDGER>'
  }
  $script:gM = ECount (Imp 'All Masters' $mx 'g250 ledgers')
  if ($script:gBf) {
    $bfD = [datetime]::ParseExact($script:gBf, 'yyyyMMdd', $null)
    $script:gY2 = $bfD.AddYears(1)
    $d1a = $bfD.AddDays(1).ToString('yyyyMMdd'); $d1b = $bfD.AddMonths(9).AddDays(1).ToString('yyyyMMdd'); $d2 = $script:gY2.AddDays(1).ToString('yyyyMMdd')
    function GJv([string]$d, [string]$dr, [string]$cr, [int]$amt) {
      return '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $d + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g250 test data</NARRATION>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (EE $dr) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (EE $cr) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
    }
    $vx = (GJv $d1a 'G5 Debtor' 'G5 Sales' 11800) + (GJv $d1a 'G5 Purchase' 'G5 Creditor "Quoted" Ltd' 5000) + (GJv $d1b 'G5 Rent' 'G5 Bank' 2500) + (GJv $d1b 'G5 Cash' 'G5 Debtor' 7000) + (GJv $d2 'G5 Bank' 'G5 Debtor' 1000)
    $script:gV = ECount (Imp 'Vouchers' $vx 'g250 entries')
  }
  Info ("g250 masters: books from {0}; ledgers created {1} of {2} (errors {3}); entries created {4} of 5" -f $script:gBf, $script:gM.c, $script:gLed.Count, $script:gM.e, $(if ($script:gV) { $script:gV.c } else { 0 }))
  return
}

# ---------------------------------------------------------------- run
Say '---- g250: 2.4.9 reads with the Gateway in a later year, then 2.5.0 over it'
$gDone = @{}
function GRes($c, $s, $ev) { if (-not $gDone[$c]) { Result $c $s $ev; $gDone[$c] = $true } }
function GProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
# the last complete round at the stub after $from: every batch of the round with last = true
function GBody($q) { if ($q.dump -and $env:P72_DUMP) { $f = Join-Path $env:P72_DUMP "$($q.dump)-req.xml"; if (Test-Path $f) { return [IO.File]::ReadAllText($f) } }; return '' }
# the first complete round at the stub after $from (every batch of the round; its last batch has last = true)
function GRound([int]$from) {
  $r = @((StubReqs) | Select-Object -Skip $from | Where-Object { $_.kind -eq 'ledger_list' })
  $last = @($r | Where-Object { $_.body.last -eq $true }) | Select-Object -First 1
  if (-not $last) { return $null }
  $b = @($r | Where-Object { "$($_.body.round)" -eq "$($last.body.round)" })
  $rows = @{}; foreach ($q in $b) { foreach ($x in @($q.body.ledgers)) { if ($x -is [array] -or $x -is [Collections.IList]) { $rows["$($x[3])"] = @($x) } } }
  return [pscustomobject]@{ round = "$($last.body.round)"; at = "$($last.body.openingsAt)"; rows = $rows; batches = $b.Count; rowsRead = [int]$last.body.rowsRead }
}
function GWaitRound([int]$from, [int]$min = 12) {
  $t = Get-Date; while (((Get-Date) - $t).TotalMinutes -lt $min) { $g = GRound $from; if ($g) { return $g }; Start-Sleep 10 }; return $null
}
# what Tally lists itself (names, by an export the harness asks; the bridge's request is not used for the truth)
function GTruthNames {
  $x = (ETimed ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>G5All</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (EE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="G5All" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60).body
  return , @([regex]::Matches($x, '<LEDGER NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
}
try {
  if (-not $script:gBf -or $script:gM.c -ne $script:gLed.Count -or -not $script:gV -or $script:gV.c -ne 5) { throw "the test data was not made (books from '$($script:gBf)', ledgers $($script:gM.c), entries $(if ($script:gV) { $script:gV.c })" }
  $want = @{}; foreach ($l in $script:gLed) { $want[$l[0]] = [decimal]$l[2] }
  $y2from = $script:gY2.ToString('yyyyMMdd'); $y2to = $script:gY2.AddYears(1).AddDays(-1).ToString('yyyyMMdd')
  $f2 = $script:gY2.ToString('d-M-yyyy'); $t2 = $script:gY2.AddYears(1).AddDays(-1).ToString('d-M-yyyy'); $d7 = $script:gY2.AddDays(1).ToString('d-M-yyyy')
  # the Gateway's period and date in year 2 (openp o7's keys: proven to move the undated request's openings, runs 41002898108, 41004704755)
  KeysTo '{ESC}' 2; KeysTo '{ESC}' 2; KeysTo 'n' 2
  KeysTo '%{F2}' 3 'g250-gw-altf2'; KeysTo ($f2 + '{ENTER}') 2; KeysTo ($t2 + '{ENTER}') 2; KeysTo '^a' 4 'g250-gw-period'
  KeysTo '{F2}' 3 'g250-f2-date'; KeysTo ($d7 + '{ENTER}') 2; KeysTo '^a' 4 'g250-date-set'
  # the undated request now gives year 2's balances (the harness's own check that the Gateway moved)
  $und = (ETimed ((Get-Content (Join-Path $env:BRIDGE_DIST 'ledreq\ledlist-tail-249.xml') -Raw).Replace('@@CO@@', (EE $co1)).Replace('111111', '0').Trim())).body
  $undDebtor = [regex]::Match($und, '(?s)<LEDGER NAME="G5 Debtor".*?<OPENINGBALANCE[^>]*>\s*([^<]*)<').Groups[1].Value.Trim()
  Info "g250: with the Gateway in $f2..$t2 (date $d7), the undated request (2.4.9's) gives G5 Debtor's opening as '$undDebtor' (books' beginning -50000.00; year 2's start -54800.00)"
  # ---- 2.4.9 reads (Update now; after its own first read at the start, LedgersDebounceMin: 3 minutes)
  Start-Sleep 200
  $m0 = Mark
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $r249 = GWaitRound $m0
  Snap 'g250-249-read'
  if ($r249) {
    $wrong = @($want.Keys | Where-Object { $r249.rows.ContainsKey($_) -and [decimal]("$($r249.rows[$_][5])" -replace '[^\d.\-]', '') -ne $want[$_] })
    Info ("g250: 2.4.9's round {0}: {1} rows, openingsAt '{2}'; openings not as at the books' beginning: {3}" -f $r249.round, $r249.rows.Count, $r249.at, $(if ($wrong.Count) { ($wrong | ForEach-Object { "$_ $($r249.rows[$_][5])" }) -join '; ' } else { 'none' }))
  } else { Info 'g250: 2.4.9 sent no complete ledger round in 12 minutes' }
  # ---- 2.5.0 over it (its first rounds after the install are judged from here)
  $mI = Mark; $tI = NowMs
  $cfg0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  $setupNew = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-2.5.0.exe' | Select-Object -First 1
  $p = Start-Process -FilePath $setupNew.FullName -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the 2.5.0 setup did not end' }
  Start-Sleep 20
  $cfg1n = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg1n.Port; $bkey = "$($cfg1n.Key)"
  $st1 = $null; for ($i = 0; $i -lt 30 -and -not $st1; $i++) { $st1 = Bridge GET '/status' $null 10; if (-not $st1) { Start-Sleep 3 } }
  GRes $E1 $(if ($st1 -and "$($st1.version)" -eq '2.5.0' -and $cfg1n.Port -eq $cfg0.Port -and "$($cfg1n.Key)" -eq "$($cfg0.Key)" -and "$($cfg1n.TallyHost)" -eq "$($cfg0.TallyHost)") { 'PASS' } else { 'FAIL' }) ("the setup {0} ended {1}; after: {2}; port {3} -> {4}; key carried {5}; TallyHost {6} -> {7}" -f $setupNew.Name, $p.ExitCode, $(if ($st1) { "version $($st1.version)" } else { 'no answer' }), $cfg0.Port, $cfg1n.Port, ("$($cfg1n.Key)" -eq "$($cfg0.Key)"), $cfg0.TallyHost, $cfg1n.TallyHost)
  # ---- 2.5.0's first read (Update now; or its own first run after the start): the first complete round after the install
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $r250 = GWaitRound $mI
  Snap 'g250-250-read'
  # ---- a second read, a posting made while it reads (postings first)
  Start-Sleep 200   # LedgersDebounceMin: the bridge reads a company's ledger list at most once every 3 minutes
  $tR = NowMs
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  # postings first: once the first FinComLedgers of 2.5.0 is at Tally, a posting from FinCom
  $imp = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt 120 -and -not $imp) {
    if (@((GProxy) | Where-Object { $_.id -eq 'FinComLedgers' -and [int64]$_.t0 -ge $tR }).Count) {
      $vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $script:gY2.AddDays(1).ToString('yyyyMMdd') + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>g250 posting during the ledger read</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>G5 Rent</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>G5 Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
      $iS = NowMs; $ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "g250-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"; xml = $vx }) } 120; $iE = NowMs
      $imp = [pscustomobject]@{ s = $iS; e = $iE; ok = ($ir -and @($ir.results)[0].ok -eq $true) }
    } else { Start-Sleep -Milliseconds 200 }
  }
  Start-Sleep 30
  $names = GTruthNames
  if (-not $r250) { foreach ($c in $E2, $E3) { GRes $c 'FAIL' 'no complete ledger round from 2.5.0 at the stub in 12 minutes' } }
  else {
    $bad = @($want.Keys | Where-Object { -not $r250.rows.ContainsKey($_) -or [decimal]("$($r250.rows[$_][5])" -replace '[^\d.\-]', '') -ne $want[$_] })
    GRes $E2 $(if (-not $bad.Count -and $r250.at -eq $script:gBf -and $r250.rows.Count -eq $names.Count) { 'PASS' } else { 'FAIL' }) ("2.5.0's round {0}: openingsAt '{1}' (BOOKSFROM {2}); rows sent {3} of Tally's {4} ledgers (the first dated round: every ledger); openings not as at the books' beginning: {5}; e.g. G5 Debtor {6}, G5 Bank {7}" -f $r250.round, $r250.at, $script:gBf, $r250.rows.Count, $names.Count, $(if ($bad.Count) { ($bad | ForEach-Object { "$_ $(if ($r250.rows.ContainsKey($_)) { $r250.rows[$_][5] } else { 'absent' }) (want $($want[$_]))" }) -join '; ' } else { 'none' }), $(if ($r250.rows.ContainsKey('G5 Debtor')) { $r250.rows['G5 Debtor'][5] }), $(if ($r250.rows.ContainsKey('G5 Bank')) { $r250.rows['G5 Bank'][5] }))
    $missing = @($names | Where-Object { -not $r250.rows.ContainsKey($_) })
    $groups = @($script:gLed | ForEach-Object { $_[1] } | Sort-Object -Unique)
    $grpSeen = @($groups | Where-Object { $g = $_; @($r250.rows.Values | Where-Object { "$($_[4])" -eq $g }).Count })
    $special = @('G5 Creditor "Quoted" Ltd', 'G5 R  K Service Station', 'G5 Unused Zero')
    GRes $E3 $(if (-not $missing.Count -and $grpSeen.Count -eq $groups.Count -and @($special | Where-Object { $r250.rows.ContainsKey($_) }).Count -eq 3) { 'PASS' } else { 'FAIL' }) ("Tally lists {0} ledgers, the round sent {1}; missing: {2}; groups seen {3} of {4}; the quote, double-space and zero-opening unused ledgers: {5}" -f $names.Count, $r250.rows.Count, $(if ($missing.Count) { $missing -join '; ' } else { 'none' }), $grpSeen.Count, $groups.Count, (($special | ForEach-Object { "$_ $(if ($r250.rows.ContainsKey($_)) { 'sent, opening ' + $r250.rows[$_][5] } else { 'MISSING' })" }) -join '; '))
  }
  # ---- e4: the requests' times and periods (the proxy), and the ref's three ledger requests asked here
  $px = GProxy; $pxN = @($px | Where-Object { [int64]$_.t0 -ge $tI })
  $ledIds = 'FinComLedgers', 'FinComLedgerChanges', 'FinComLedgerByName'
  $mine = @($pxN | Where-Object { $_.id -in ($ledIds + 'TDSDeskCompanies') })
  $over = @($pxN | Where-Object { [int]$_.ms -gt 2000 })
  $ref = [ordered]@{}
  $bfTo = ([datetime]::ParseExact($script:gBf, 'yyyyMMdd', $null)).AddYears(1).AddDays(-1).ToString('yyyyMMdd')
  foreach ($f in 'ledlist-chunk-250', 'ledlist-tail-250', 'ledchanges-250', 'ledbyname-250') {
    $path = Join-Path $env:BRIDGE_DIST "ledreq\$f.xml"
    if (-not (Test-Path $path)) { $ref[$f] = 'absent'; continue }
    $x = (Get-Content $path -Raw).Replace('@@CO@@', (EE $co1)).Replace('@@NAME@@', 'G5 Rent').Replace('20990401', $script:gBf).Replace('21000331', $bfTo).Replace('111111', '0').Replace('222222', '2000').Trim()
    $okP = $x.Contains('<SVFROMDATE TYPE="Date">' + $script:gBf + '</SVFROMDATE><SVTODATE TYPE="Date">' + $bfTo + '</SVTODATE></STATICVARIABLES>')
    $a = ETimed $x; $ref[$f] = "$($a.ms) ms, the period $(if ($okP) { 'exact' } else { 'NOT exact' }), $(([regex]::Matches($a.body, '<LEDGER ')).Count) ledger(s)"
  }
  $refBad = @($ref.Values | Where-Object { $_ -eq 'absent' -or $_ -match 'NOT exact' -or [double](($_ -split ' ')[0]) -gt 2000 })
    $worst = ($mine | Measure-Object -Property ms -Maximum).Maximum
  $byId = ($mine | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count) worst $(($_.Group | Measure-Object -Property ms -Maximum).Maximum) ms" }) -join '; '
  $ledReqs = @($pxN | Where-Object { $_.id -in $ledIds })
  $noBody = @($ledReqs | Where-Object { -not (GBody $_) }).Count
  $undatedSent = @($ledReqs | Where-Object { $b = GBody $_; $b -and -not $b.Contains('<SVFROMDATE TYPE="Date">' + $script:gBf + '</SVFROMDATE><SVTODATE TYPE="Date">' + $bfTo + '</SVTODATE></STATICVARIABLES>') })
  GRes $E4 $(if (-not $mine.Count -or -not @($mine | Where-Object { $_.id -eq 'FinComLedgers' }).Count) { 'HARNESS' } elseif ($noBody -gt 0) { 'HARNESS' } elseif (-not $over.Count -and -not $refBad.Count -and -not $undatedSent.Count -and $worst -le 2000) { 'PASS' } else { 'FAIL' }) ("2.5.0's requests at Tally: {0} ({1}); over 2 s: {2}; ledger requests without exactly the books' first year: {3} of {5} (bodies not kept: {6}); the ref's requests asked here: {4}" -f $pxN.Count, $byId, $(if ($over.Count) { ($over | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join '; ' } else { 'none' }), $undatedSent.Count, (($ref.Keys | ForEach-Object { "$_ $($ref[$_])" }) -join '; '), $ledReqs.Count, $noBody)
  # ---- e5
  $pxS = @($pxN | Sort-Object { [int64]$_.t0 })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $pxS) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  if (-not $imp) { GRes $E5 'HARNESS' ("no FinComLedgers of 2.5.0 at Tally within 2 minutes of Update now: no posting made during it; requests started while another was at Tally: {0}" -f $overlap) }
  else {
    $impReq = @($pxS | Where-Object { $_.id -eq 'Import' -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -le $imp.e }) | Select-Object -First 1
    $after = @($pxS | Where-Object { $_.id -in $ledIds -and [int64]$_.t0 -ge $imp.e }).Count
    $inside = if ($impReq) { @($pxS | Where-Object { $_.id -in $ledIds -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -lt [int64]$impReq.t0 }).Count } else { -1 }
    $wait = if ($impReq) { [int64]$impReq.t0 - $imp.s } else { -1 }
    GRes $E5 $(if ($impReq -and $imp.ok -and $overlap -eq 0 -and $inside -le 1 -and $wait -lt 2500) { 'PASS' } else { 'FAIL' }) ("requests started while another was at Tally: {0} of {1}; the posting: ok {2}, {3} ms in all; its request reached Tally {4} ms after FinCom asked, ledger requests started before it in that time: {5}" -f $overlap, $pxS.Count, $imp.ok, ($imp.e - $imp.s), $wait, $inside)
  }
} catch {
  Info "g250: $_"
  foreach ($c in $E1, $E2, $E3, $E4, $E5) { GRes $c 'HARNESS' "not done: $_" }
}
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
