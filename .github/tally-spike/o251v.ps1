# Mode o251 (2.5.1's gate, the openings fix of book 3d36a836, 30-Oct-2026; TEST DATA ONLY, a throwaway company in this
# runner's own Tally). The company's Tally books begin a year BEFORE FinCom's first day of its book: stubg.py, FinCom's
# cloud, names FinCom's first day in every beat answer (booksFrom {company: Tally's BOOKSFROM + 1 year}, as tally-ingest
# does from tally_books.from_date). The published 2.5.0 is installed first (its committed setup, bridge-dist\old250) and
# reads the ledgers as at Tally's own books-from (the fault: said as INFO), then the gate's setup (the committed 2.5.1) goes
# over it. proxy235.py stands between the bridge and Tally (every request logged with its time and body). Dot-sourced by
# flowv.ps1:
#   $o251Phase = 'masters' (before the bridge starts): g250's ledgers under every primary group by XML, with openings at
#     Tally's books-from, zero-opening ones never used, names with double quotes and with a double space; entries in year
#     1 and year 2 (Educational days); the stub's booksFrom written (FinCom's first day = year 2's first day)
#   $o251Phase = 'run' (the published 2.5.0 running): then
#   o1 2.5.1 installed over 2.5.0: the version, the port and key carried
#   o2 Tally's books a year before FinCom's: every ledger's opening equals Tally's own at FinCom's first day (the harness's
#      own export at that day, and the four balance-sheet ledgers year 1 moved as worked out from the entries), openingsAt
#      = FinCom's first day, every ledger sent
#   o3 every ledger read: zero-opening unused, quote and double-space names, every primary group (g250's e3)
#   o4 FinCom with no first day (the stub's booksFrom ""): every opening as at Tally's books' beginning, openingsAt =
#      BOOKSFROM (g250's e2 on 2.5.1)
#   o5 each request within 2 s (the ledger requests, the company list), every ledger request carrying exactly the first
#      year of the date in use (FinCom's, or Tally's once FinCom has none); the ref's three requests asked here dated from
#      FinCom's first day, each timed
#   o6 one request in flight at Tally; postings first: a posting during the ledger read reaches Tally at once
# A step the harness could not do is HARNESS, never PASS.
$O1 = 'o1 2.5.1 installed over 2.5.0: the version and the settings carried'
$O2 = 'o2 Tally''s books a year before FinCom''s: every opening equals Tally''s at FinCom''s first day'
$O3 = 'o3 every ledger read: zero-opening unused, quote and double-space names, every primary group'
$O4 = 'o4 FinCom with no first day: every opening as at Tally''s books'' beginning'
$O5 = 'o5 each request within 2 s, the ledger requests carrying exactly the first year of the date in use'
$O6 = 'o6 one request in flight; postings first during the ledger read'
function EE([string]$s) { [Security.SecurityElement]::Escape($s) }
function ECount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; e = [int]$m.Groups[2].Value } }; return [pscustomobject]@{ c = 0; e = -1 } }
function ETimed([string]$x, [int]$sec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content } catch { $c = "failed: $($_.Exception.Message)" }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
function ODec($v) { $s = "$v" -replace '[^\d.\-]', ''; if ($s -eq '' -or $s -eq '-') { return [decimal]0 }; return [decimal]$s }
# Tally's sign in OPENINGBALANCE: a credit positive. [name, group, opening at Tally's books-from, used in entries]
$script:oLed = @(
  @('O5 Capital', 'Capital Account', '250000.00', $false), @('O5 Loan Taken', 'Loans (Liability)', '100000.00', $false),
  @('O5 Creditor "Quoted" Ltd', 'Sundry Creditors', '30000.00', $true), @('O5 R  K Service Station', 'Sundry Creditors', '0', $false),
  @('O5 Duty Ledger', 'Duties & Taxes', '0', $false), @('O5 Machinery', 'Fixed Assets', '-200000.00', $false),
  @('O5 FD', 'Investments', '-80000.00', $false), @('O5 Debtor', 'Sundry Debtors', '-50000.00', $true), @('O5 Bank', 'Bank Accounts', '-40000.00', $true),
  @('O5 Cash', 'Cash-in-Hand', '-10000.00', $true), @('O5 Branch', 'Branch / Divisions', '0', $false), @('O5 Suspense', 'Suspense A/c', '0', $false),
  @('O5 Sales', 'Sales Accounts', '0', $true), @('O5 Purchase', 'Purchase Accounts', '0', $true), @('O5 Direct Income', 'Direct Incomes', '0', $false),
  @('O5 Direct Expense', 'Direct Expenses', '0', $false), @('O5 Indirect Income', 'Indirect Incomes', '0', $false), @('O5 Rent', 'Indirect Expenses', '0', $true),
  @('O5 Unused Zero', 'Current Assets', '0', $false), @('O5 Misc Exp', 'Misc. Expenses (ASSET)', '0', $false))
# the balance-sheet ledgers year 1's entries move (worked out from the entries below; credit positive): their opening at
# FinCom's first day (year 2's first day)
$script:oMoved = @{ 'O5 Debtor' = [decimal]-54800; 'O5 Creditor "Quoted" Ltd' = [decimal]35000; 'O5 Bank' = [decimal]-37500; 'O5 Cash' = [decimal]-17000 }
$script:oBfFile = "$stubLog.booksfrom.json"
function OSetBooksFrom([string]$day) { [IO.File]::WriteAllText($script:oBfFile, (@{ $co1 = $day } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false)) }
if ($o251Phase -eq 'masters') {
  Say '---- o251 masters (before the bridge)'
  $cx = ETimed ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>O5Co</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (EE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="O5Co" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, BOOKSFROM</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $script:oBf = [regex]::Match($cx.body, '<BOOKSFROM[^>]*>\s*(\d{8})').Groups[1].Value
  $mx = ''
  foreach ($l in $script:oLed) {
    $mx += '<LEDGER NAME="' + (EE $l[0]) + '" ACTION="Create"><NAME.LIST><NAME>' + (EE $l[0]) + '</NAME></NAME.LIST><PARENT>' + (EE $l[1]) + '</PARENT><ISBILLWISEON>No</ISBILLWISEON>'
    if ($l[2] -ne '0') { $mx += '<OPENINGBALANCE>' + $l[2] + '</OPENINGBALANCE>' }
    $mx += '</LEDGER>'
  }
  $script:oM = ECount (Imp 'All Masters' $mx 'o251 ledgers')
  if ($script:oBf) {
    $bfD = [datetime]::ParseExact($script:oBf, 'yyyyMMdd', $null)
    $script:oY2 = $bfD.AddYears(1)
    $script:oFc = $script:oY2.ToString('yyyyMMdd')     # FinCom's first day of the book: a year after Tally's books-from
    $d1a = $bfD.AddDays(1).ToString('yyyyMMdd'); $d1b = $bfD.AddMonths(9).AddDays(1).ToString('yyyyMMdd'); $d2 = $script:oY2.AddDays(1).ToString('yyyyMMdd')
    function OJv([string]$d, [string]$dr, [string]$cr, [int]$amt) {
      return '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $d + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>o251 test data</NARRATION>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (EE $dr) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (EE $cr) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
    }
    $vx = (OJv $d1a 'O5 Debtor' 'O5 Sales' 11800) + (OJv $d1a 'O5 Purchase' 'O5 Creditor "Quoted" Ltd' 5000) + (OJv $d1b 'O5 Rent' 'O5 Bank' 2500) + (OJv $d1b 'O5 Cash' 'O5 Debtor' 7000) + (OJv $d2 'O5 Bank' 'O5 Debtor' 1000)
    $script:oV = ECount (Imp 'Vouchers' $vx 'o251 entries')
    OSetBooksFrom $script:oFc
  }
  Info ("o251 masters: Tally's books from {0}; FinCom's first day named by the stub {1}; ledgers created {2} of {3} (errors {4}); entries created {5} of 5" -f $script:oBf, $script:oFc, $script:oM.c, $script:oLed.Count, $script:oM.e, $(if ($script:oV) { $script:oV.c } else { 0 }))
  return
}

# ---------------------------------------------------------------- run
Say '---- o251: 2.5.0 reads as at Tally''s books-from, then 2.5.1 over it reads as at FinCom''s first day'
$oDone = @{}
function ORes($c, $s, $ev) { if (-not $oDone[$c]) { Result $c $s $ev; $oDone[$c] = $true } }
function OProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function OBody($q) { if ($q.dump -and $env:P72_DUMP) { $f = Join-Path $env:P72_DUMP "$($q.dump)-req.xml"; if (Test-Path $f) { return [IO.File]::ReadAllText($f) } }; return '' }
# the complete rounds at the stub after $from (each: every batch of the round; its last batch has last = true), in order
function ORounds([int]$from) {
  $r = @((StubReqs) | Select-Object -Skip $from | Where-Object { $_.kind -eq 'ledger_list' })
  $out = @()
  foreach ($last in @($r | Where-Object { $_.body.last -eq $true })) {
    $b = @($r | Where-Object { "$($_.body.round)" -eq "$($last.body.round)" })
    $rows = @{}; foreach ($q in $b) { foreach ($x in @($q.body.ledgers)) { if ($x -is [array] -or $x -is [Collections.IList]) { $rows["$($x[3])"] = @($x) } } }
    $out += [pscustomobject]@{ round = "$($last.body.round)"; at = "$($last.body.openingsAt)"; rows = $rows; batches = $b.Count }
  }
  return , $out
}
# the first complete round after $from whose openingsAt is $at (12 minutes at most); the rounds before it kept in $script:oOther
function OWaitRound([int]$from, [string]$at, [int]$min = 12) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalMinutes -lt $min) {
    $all = ORounds $from
    $hit = @($all | Where-Object { $_.at -eq $at }) | Select-Object -First 1
    if ($hit) { $script:oOther = @($all | Where-Object { $_.at -ne $at }); return $hit }
    Start-Sleep 10
  }
  $script:oOther = @(ORounds $from); return $null
}
# Tally's own ledgers and openings as at a day (the harness's export, not the bridge's request): name -> opening
function OTruth([string]$from) {
  $to = ([datetime]::ParseExact($from, 'yyyyMMdd', $null)).AddYears(1).AddDays(-1).ToString('yyyyMMdd')
  $x = (ETimed ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>O5All</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (EE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">' + $from + '</SVFROMDATE><SVTODATE TYPE="Date">' + $to + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="O5All" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT, OPENINGBALANCE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 60).body
  $o = @{}
  foreach ($m in [regex]::Matches($x, '(?s)<LEDGER NAME="([^"]*)"(.*?)</LEDGER>')) { $o[[Net.WebUtility]::HtmlDecode($m.Groups[1].Value)] = ODec ([regex]::Match($m.Groups[2].Value, '<OPENINGBALANCE[^>]*>\s*([^<]*)<').Groups[1].Value) }
  return $o
}
function OOpenBad($round, $want) { return , @($want.Keys | Where-Object { -not $round.rows.ContainsKey($_) -or (ODec $round.rows[$_][5]) -ne $want[$_] }) }
try {
  if (-not $script:oBf -or $script:oM.c -ne $script:oLed.Count -or -not $script:oV -or $script:oV.c -ne 5) { throw "the test data was not made (books from '$($script:oBf)', ledgers $($script:oM.c), entries $(if ($script:oV) { $script:oV.c })" }
  $bf = $script:oBf; $fc = $script:oFc
  $bfTo = ([datetime]::ParseExact($bf, 'yyyyMMdd', $null)).AddYears(1).AddDays(-1).ToString('yyyyMMdd')
  $fcTo = ([datetime]::ParseExact($fc, 'yyyyMMdd', $null)).AddYears(1).AddDays(-1).ToString('yyyyMMdd')
  $perBf = '<SVFROMDATE TYPE="Date">' + $bf + '</SVFROMDATE><SVTODATE TYPE="Date">' + $bfTo + '</SVTODATE></STATICVARIABLES>'
  $perFc = '<SVFROMDATE TYPE="Date">' + $fc + '</SVFROMDATE><SVTODATE TYPE="Date">' + $fcTo + '</SVTODATE></STATICVARIABLES>'
  $wantBf = @{}; foreach ($l in $script:oLed) { $wantBf[$l[0]] = [decimal]$l[2] }
  $truthFc = OTruth $fc; $truthBf = OTruth $bf
  # the harness's own truth at FinCom's first day: Tally's export at that day, and the balance-sheet ledgers year 1 moved
  $wantFc = @{}; foreach ($l in $script:oLed) { $wantFc[$l[0]] = if ($truthFc.ContainsKey($l[0])) { $truthFc[$l[0]] } else { [decimal]::MinValue } }
  $movedBad = @($script:oMoved.Keys | Where-Object { $wantFc[$_] -ne $script:oMoved[$_] })
  Info ("o251: Tally's export as at FinCom's first day {0}: O5 Debtor {1}, O5 Bank {2}, O5 Cash {3}, O5 Creditor {4}, O5 Sales {5}, O5 Rent {6}; as at Tally's books-from {7}: O5 Debtor {8}; the balance-sheet ledgers year 1 moved, not as worked out: {9}" -f $fc, $wantFc['O5 Debtor'], $wantFc['O5 Bank'], $wantFc['O5 Cash'], $wantFc['O5 Creditor "Quoted" Ltd'], $wantFc['O5 Sales'], $wantFc['O5 Rent'], $bf, $truthBf['O5 Debtor'], $(if ($movedBad.Count) { ($movedBad | ForEach-Object { "$_ $($wantFc[$_]) (worked out $($script:oMoved[$_]))" }) -join '; ' } else { 'none' }))
  # ---- 2.5.0 reads (Update now; after its own first read at the start, LedgersDebounceMin: 3 minutes)
  Start-Sleep 200
  $m0 = Mark
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $r250 = OWaitRound $m0 $bf
  Snap 'o251-250-read'
  if ($r250) {
    $diff = @($wantFc.Keys | Where-Object { $r250.rows.ContainsKey($_) -and (ODec $r250.rows[$_][5]) -ne $wantFc[$_] })
    Info ("o251: 2.5.0's round {0}: {1} rows, openingsAt '{2}' (Tally's books-from; FinCom's first day {3}: the fault of book 3d36a836); openings other than Tally's at FinCom's first day: {4}" -f $r250.round, $r250.rows.Count, $r250.at, $fc, $(if ($diff.Count) { ($diff | ForEach-Object { "$_ $($r250.rows[$_][5])" }) -join '; ' } else { 'none' }))
  } else { Info ("o251: 2.5.0 sent no complete ledger round as at {0} in 12 minutes (rounds: {1})" -f $bf, (($script:oOther | ForEach-Object { "$($_.round) at '$($_.at)'" }) -join '; ')) }
  # ---- 2.5.1 over it (its rounds after the install are judged from here)
  $mI = Mark; $tI = NowMs
  $cfg0 = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json
  $setupNew = Get-ChildItem $env:BRIDGE_DIST -Filter 'FinComBridge-Setup-2.5.1.exe' | Select-Object -First 1
  $p = Start-Process -FilePath $setupNew.FullName -ArgumentList '/S', '/CURRENTUSER', '/MODE=sole' -PassThru; $null = $p.Handle
  if (-not $p.WaitForExit(300000)) { Write-Host 'the 2.5.1 setup did not end' }
  Start-Sleep 20
  $cfg1n = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $bport = [int]$cfg1n.Port; $bkey = "$($cfg1n.Key)"
  $st1 = $null; for ($i = 0; $i -lt 30 -and -not $st1; $i++) { $st1 = Bridge GET '/status' $null 10; if (-not $st1) { Start-Sleep 3 } }
  ORes $O1 $(if ($st1 -and "$($st1.version)" -eq '2.5.1' -and $cfg1n.Port -eq $cfg0.Port -and "$($cfg1n.Key)" -eq "$($cfg0.Key)" -and "$($cfg1n.TallyHost)" -eq "$($cfg0.TallyHost)") { 'PASS' } else { 'FAIL' }) ("the setup {0} ended {1}; after: {2}; port {3} -> {4}; key carried {5}; TallyHost {6} -> {7}" -f $setupNew.Name, $p.ExitCode, $(if ($st1) { "version $($st1.version)" } else { 'no answer' }), $cfg0.Port, $cfg1n.Port, ("$($cfg1n.Key)" -eq "$($cfg0.Key)"), $cfg0.TallyHost, $cfg1n.TallyHost)
  # ---- 2.5.1's read as at FinCom's first day (Update now; or its own first run after the start)
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $r251 = OWaitRound $mI $fc
  $before = $script:oOther
  Snap 'o251-251-read'
  $names = @($truthFc.Keys)
  if (-not $r251) { foreach ($c in $O2, $O3) { ORes $c 'FAIL' ("no complete ledger round as at FinCom's first day {0} from 2.5.1 at the stub in 12 minutes (rounds: {1})" -f $fc, (($before | ForEach-Object { "$($_.round) at '$($_.at)'" }) -join '; ')) } }
  else {
    $bad = OOpenBad $r251 $wantFc
    $bad2 = @($names | Where-Object { -not $r251.rows.ContainsKey($_) -or (ODec $r251.rows[$_][5]) -ne $truthFc[$_] })
    ORes $O2 $(if (-not $bad.Count -and -not $bad2.Count -and -not $movedBad.Count -and $r251.at -eq $fc -and $r251.rows.Count -eq $names.Count) { 'PASS' } else { 'FAIL' }) ("2.5.1's round {0}: openingsAt '{1}' (FinCom's first day {2}; Tally's books-from {3}); rows sent {4} of Tally's {5} ledgers; openings not Tally's at FinCom's first day: {6}; e.g. O5 Debtor {7} (at Tally's books-from {8}), O5 Bank {9}, O5 Cash {10}; rounds of 2.5.1 before it as at another day: {11}" -f $r251.round, $r251.at, $fc, $bf, $r251.rows.Count, $names.Count, $(if ($bad.Count -or $bad2.Count) { (@($bad + $bad2) | Sort-Object -Unique | ForEach-Object { "$_ $(if ($r251.rows.ContainsKey($_)) { $r251.rows[$_][5] } else { 'absent' }) (Tally $($truthFc[$_]))" }) -join '; ' } else { 'none' }), $(if ($r251.rows.ContainsKey('O5 Debtor')) { $r251.rows['O5 Debtor'][5] }), $truthBf['O5 Debtor'], $(if ($r251.rows.ContainsKey('O5 Bank')) { $r251.rows['O5 Bank'][5] }), $(if ($r251.rows.ContainsKey('O5 Cash')) { $r251.rows['O5 Cash'][5] }), $(if ($before.Count) { ($before | ForEach-Object { "$($_.round) at '$($_.at)'" }) -join '; ' } else { 'none' }))
    $missing = @($names | Where-Object { -not $r251.rows.ContainsKey($_) })
    $groups = @($script:oLed | ForEach-Object { $_[1] } | Sort-Object -Unique)
    $grpSeen = @($groups | Where-Object { $g = $_; @($r251.rows.Values | Where-Object { "$($_[4])" -eq $g }).Count })
    $special = @('O5 Creditor "Quoted" Ltd', 'O5 R  K Service Station', 'O5 Unused Zero')
    ORes $O3 $(if (-not $missing.Count -and $grpSeen.Count -eq $groups.Count -and @($special | Where-Object { $r251.rows.ContainsKey($_) }).Count -eq 3) { 'PASS' } else { 'FAIL' }) ("Tally lists {0} ledgers, the round sent {1}; missing: {2}; groups seen {3} of {4}; the quote, double-space and zero-opening unused ledgers: {5}" -f $names.Count, $r251.rows.Count, $(if ($missing.Count) { $missing -join '; ' } else { 'none' }), $grpSeen.Count, $groups.Count, (($special | ForEach-Object { "$_ $(if ($r251.rows.ContainsKey($_)) { 'sent, opening ' + $r251.rows[$_][5] } else { 'MISSING' })" }) -join '; '))
  }
  # ---- FinCom with no first day: the stub's booksFrom "" (the bridge forgets FinCom's day at the next beat), then a read
  # with a posting made while it reads (postings first)
  OSetBooksFrom ''
  Start-Sleep 200   # LedgersDebounceMin: the bridge reads a company's ledger list at most once every 3 minutes
  $mN = Mark; $tR = NowMs
  $null = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  $imp = $null; $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt 120 -and -not $imp) {
    if (@((OProxy) | Where-Object { $_.id -eq 'FinComLedgers' -and [int64]$_.t0 -ge $tR }).Count) {
      $vx = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $script:oY2.AddDays(1).ToString('yyyyMMdd') + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>o251 posting during the ledger read</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>O5 Rent</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>O5 Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
      $iS = NowMs; $ir = Bridge POST '/import' @{ company = $co1; vouchers = @(@{ id = "o251-$rel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"; xml = $vx }) } 120; $iE = NowMs
      $imp = [pscustomobject]@{ s = $iS; e = $iE; ok = ($ir -and @($ir.results)[0].ok -eq $true) }
    } else { Start-Sleep -Milliseconds 200 }
  }
  $rN = OWaitRound $mN $bf
  Snap 'o251-none-read'
  if (-not $rN) { ORes $O4 'FAIL' ("no complete ledger round as at Tally's books-from {0} in 12 minutes after FinCom's booksFrom became """" (rounds: {1})" -f $bf, (($script:oOther | ForEach-Object { "$($_.round) at '$($_.at)'" }) -join '; ')) }
  else {
    $bad = OOpenBad $rN $wantBf
    ORes $O4 $(if (-not $bad.Count -and $rN.at -eq $bf -and $rN.rows.Count -eq $names.Count) { 'PASS' } else { 'FAIL' }) ("round {0} with FinCom's booksFrom """": openingsAt '{1}' (BOOKSFROM {2}); rows sent {3} of Tally's {4} (the date changed: every ledger); openings not as at Tally's books' beginning: {5}; e.g. O5 Debtor {6}, O5 Bank {7}" -f $rN.round, $rN.at, $bf, $rN.rows.Count, $names.Count, $(if ($bad.Count) { ($bad | ForEach-Object { "$_ $(if ($rN.rows.ContainsKey($_)) { $rN.rows[$_][5] } else { 'absent' }) (want $($wantBf[$_]))" }) -join '; ' } else { 'none' }), $(if ($rN.rows.ContainsKey('O5 Debtor')) { $rN.rows['O5 Debtor'][5] }), $(if ($rN.rows.ContainsKey('O5 Bank')) { $rN.rows['O5 Bank'][5] }))
  }
  Start-Sleep 20
  # ---- o5: the requests' times and periods (the proxy), and the ref's three ledger requests asked here, FinCom's day
  $px = OProxy; $pxN = @($px | Where-Object { [int64]$_.t0 -ge $tI })
  $ledIds = 'FinComLedgers', 'FinComLedgerChanges', 'FinComLedgerByName'
  $mine = @($pxN | Where-Object { $_.id -in ($ledIds + 'TDSDeskCompanies') })
  $over = @($pxN | Where-Object { [int]$_.ms -gt 2000 })
  $ref = [ordered]@{}
  foreach ($f in 'ledlist-chunk-250', 'ledlist-tail-250', 'ledchanges-250', 'ledbyname-250') {
    $path = Join-Path $env:BRIDGE_DIST "ledreq\$f.xml"
    if (-not (Test-Path $path)) { $ref[$f] = 'absent'; continue }
    $x = (Get-Content $path -Raw).Replace('@@CO@@', (EE $co1)).Replace('@@NAME@@', 'O5 Rent').Replace('20990401', $fc).Replace('21000331', $fcTo).Replace('111111', '0').Replace('222222', '2000').Trim()
    $okP = $x.Contains($perFc)
    $a = ETimed $x; $ref[$f] = "$($a.ms) ms, the period $(if ($okP) { 'exact' } else { 'NOT exact' }), $(([regex]::Matches($a.body, '<LEDGER ')).Count) ledger(s)"
  }
  $refBad = @($ref.Values | Where-Object { $_ -eq 'absent' -or $_ -match 'NOT exact' -or [double](($_ -split ' ')[0]) -gt 2000 })
  $worst = ($mine | Measure-Object -Property ms -Maximum).Maximum
  $byId = ($mine | Group-Object id | ForEach-Object { "$($_.Name) x$($_.Count) worst $(($_.Group | Measure-Object -Property ms -Maximum).Maximum) ms" }) -join '; '
  $ledReqs = @($pxN | Where-Object { $_.id -in $ledIds })
  $noBody = @($ledReqs | Where-Object { -not (OBody $_) }).Count
  $nFc = @($ledReqs | Where-Object { (OBody $_).Contains($perFc) }).Count; $nBf = @($ledReqs | Where-Object { (OBody $_).Contains($perBf) }).Count
  # before FinCom's booksFrom became "" ($tR) every ledger request carries FinCom's first year (Tally's only in a round
  # 2.5.1 began before its first heartbeat answer: counted, said); after it, Tally's
  $early = @($ledReqs | Where-Object { [int64]$_.t0 -lt $tR }); $late = @($ledReqs | Where-Object { [int64]$_.t0 -ge $tR + 10000 })
  $wrongEarly = @($early | Where-Object { $b = OBody $_; $b -and -not $b.Contains($perFc) -and -not $b.Contains($perBf) })
  $wrongLate = @($late | Where-Object { $b = OBody $_; $b -and -not $b.Contains($perBf) })
  $bfEarly = @($early | Where-Object { (OBody $_).Contains($perBf) }).Count
  ORes $O5 $(if (-not $mine.Count -or -not @($mine | Where-Object { $_.id -eq 'FinComLedgers' }).Count) { 'HARNESS' } elseif ($noBody -gt 0) { 'HARNESS' } elseif (-not $over.Count -and -not $refBad.Count -and -not $wrongEarly.Count -and -not $wrongLate.Count -and $nFc -gt 0 -and $worst -le 2000) { 'PASS' } else { 'FAIL' }) ("2.5.1's requests at Tally: {0} ({1}); over 2 s: {2}; ledger requests: {3} with FinCom's first year, {4} with Tally's ({5} of them before FinCom's booksFrom became """"), with neither or the wrong one: {6} (bodies not kept: {7}); the ref's requests asked here with FinCom's first day: {8}" -f $pxN.Count, $byId, $(if ($over.Count) { ($over | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join '; ' } else { 'none' }), $nFc, $nBf, $bfEarly, ($wrongEarly.Count + $wrongLate.Count), $noBody, (($ref.Keys | ForEach-Object { "$_ $($ref[$_])" }) -join '; '))
  # ---- o6
  $pxS = @($pxN | Sort-Object { [int64]$_.t0 })
  $overlap = 0; $prevEnd = 0L; foreach ($q in $pxS) { if ([int64]$q.t0 -lt $prevEnd) { $overlap++ }; $prevEnd = [math]::Max($prevEnd, [int64]$q.t1) }
  if (-not $imp) { ORes $O6 'HARNESS' ("no FinComLedgers of 2.5.1 at Tally within 2 minutes of Update now: no posting made during it; requests started while another was at Tally: {0}" -f $overlap) }
  else {
    $impReq = @($pxS | Where-Object { $_.id -eq 'Import' -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -le $imp.e }) | Select-Object -First 1
    $inside = if ($impReq) { @($pxS | Where-Object { $_.id -in $ledIds -and [int64]$_.t0 -ge $imp.s -and [int64]$_.t0 -lt [int64]$impReq.t0 }).Count } else { -1 }
    $wait = if ($impReq) { [int64]$impReq.t0 - $imp.s } else { -1 }
    ORes $O6 $(if ($impReq -and $imp.ok -and $overlap -eq 0 -and $inside -le 1 -and $wait -lt 2500) { 'PASS' } else { 'FAIL' }) ("requests started while another was at Tally: {0} of {1}; the posting: ok {2}, {3} ms in all; its request reached Tally {4} ms after FinCom asked, ledger requests started before it in that time: {5}" -f $overlap, $pxS.Count, $imp.ok, ($imp.e - $imp.s), $wait, $inside)
  }
  $logT = Join-Path $h1 'bridge.log'; if (-not (Test-Path $logT)) { $logT = Get-ChildItem $h1 -Filter '*.log' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
  if ($logT) { Get-Content $logT -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ -match "are read as at|not read: Tally has not said" } | Select-Object -First 5 | ForEach-Object { Info "o251 bridge log: $_" } }
} catch {
  Info "o251: $_"
  foreach ($c in $O1, $O2, $O3, $O4, $O5, $O6) { ORes $c 'HARNESS' "not done: $_" }
}
Copy-Item $proxyLog (Join-Path $cap 'proxy.jsonl') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
