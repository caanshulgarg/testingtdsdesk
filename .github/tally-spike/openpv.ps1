# openpv.ps1 - mode "openp" (30-Oct-2026, book 3d36a836 IMPETUS: openings that are the balance at the start of a later
# year). PROOF ONLY, test data, no bridge. Dot-sourced by flowv.ps1 after c1-c2 (the company open).
# Question: does the ledger list request exactly as the ref's bridge builds it (ledreq/ledlist-tail.xml: FinComLedgers,
# every MasterID, no period) give OPENINGBALANCE as the ledger's opening at the books' beginning, or as the balance at the
# start of the period the Tally session is in?
#   o1 the company's books-from and its year (Company: BOOKSFROM, STARTINGFROM, ENDINGAT)
#   o2 five ledgers made by XML with openings (a bill-wise party 1000 Cr with its opening bill, a plain party 1000 Cr, a
#      cash ledger 500 Dr, a loan with no opening, an expense), entries in year 1 and one in year 2 (Educational days: the 2nd)
#   o3 the request as built, the session in its own period: each ledger's OPENINGBALANCE
#   o4 the same request with SVFROMDATE / SVTODATE of year 2 added (the harness only: as if the session were in year 2)
#   o5 the session's period moved to year 2 by keys (Alt+F2), then the request as built again
#   o6 the reading: for each ledger, which of (opening at books-from, balance at year 2's start) each answer gave
Say '---- openp: the ledger list''s OPENINGBALANCE against the Tally session''s period'
$lq = Join-Path $PSScriptRoot 'ledreq'
$lqRef = if ($env:BRIDGE_DIST) { Join-Path $env:BRIDGE_DIST 'ledreq' } else { '' }
if ($lqRef -and (Test-Path (Join-Path $lqRef 'ledlist-tail.xml'))) { $lq = $lqRef }
$tplTail = Get-Content (Join-Path $lq 'ledlist-tail.xml') -Raw
Info "openp: the request from $lq ($(Get-Content (Join-Path $lq 'SOURCE.txt') -TotalCount 1 -ErrorAction SilentlyContinue)); SHA-256 $((Get-FileHash (Join-Path $lq 'ledlist-tail.xml') -Algorithm SHA256).Hash.Substring(0, 12))"
function OE([string]$s) { [Security.SecurityElement]::Escape($s) }
function OPost([string]$x) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 30).Content }
  catch { $c = "failed: $($_.Exception.Message)" }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
$asBuilt = $tplTail.Replace('@@CO@@', (OE $co1)).Replace('111111', '0').Trim()
# o1: the company's year
$cx = OPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OPCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (OE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="OPCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, BOOKSFROM, STARTINGFROM, ENDINGAT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
$bf = [regex]::Match($cx.body, '<BOOKSFROM[^>]*>\s*(\d{8})').Groups[1].Value
if (-not $bf) { $bf = [regex]::Match($cx.body, '<STARTINGFROM[^>]*>\s*(\d{8})').Groups[1].Value }
if (-not $bf) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "HARNESS openp o1: the company's books-from not read ($($cx.body.Substring(0, [math]::Min(300, $cx.body.Length))))"; return }
$y = [int]$bf.Substring(0, 4); $md = $bf.Substring(4)
$y2from = "$($y + 1)$md"; $y2to = (([datetime]::ParseExact($y2from, 'yyyyMMdd', $null)).AddYears(1).AddDays(-1)).ToString('yyyyMMdd')
$d1a = ([datetime]::ParseExact($bf, 'yyyyMMdd', $null)).AddDays(1).ToString('yyyyMMdd')          # year 1, the 2nd
$d1b = ([datetime]::ParseExact($bf, 'yyyyMMdd', $null)).AddMonths(9).AddDays(1).ToString('yyyyMMdd') # year 1, nine months on
$d2 = ([datetime]::ParseExact($y2from, 'yyyyMMdd', $null)).AddDays(1).ToString('yyyyMMdd')        # year 2, the 2nd
Add-Content -Path $resultsFile -Encoding UTF8 -Value "PASS openp o1 the company's year: books from $bf; year 2 $y2from-$y2to; entries on $d1a, $d1b (year 1) and $d2 (year 2)"
# o2: the ledgers and entries (amounts: Tally's sign, a credit positive in OPENINGBALANCE and ISDEEMEDPOSITIVE No)
function Led([string]$n, [string]$grp, [string]$open, [bool]$bill) {
  $x = '<LEDGER NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><PARENT>' + (OE $grp) + '</PARENT><ISBILLWISEON>' + $(if ($bill) { 'Yes' } else { 'No' }) + '</ISBILLWISEON>'
  if ($open) { $x += '<OPENINGBALANCE>' + $open + '</OPENINGBALANCE>' }
  if ($bill -and $open) { $x += '<BILLALLOCATIONS.LIST><NAME>OB-1</NAME><BILLDATE>' + $bf + '</BILLDATE><OPENINGBALANCE>' + $open + '</OPENINGBALANCE><BILLTYPE>New Ref</BILLTYPE></BILLALLOCATIONS.LIST>' }
  return $x + '</LEDGER>'
}
$mk = OPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (OE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + `
  (Led 'OP Party Billwise' 'Sundry Creditors' '1000.00' $true) + (Led 'OP Party Plain' 'Sundry Creditors' '1000.00' $false) + (Led 'OP Cash Two' 'Cash-in-Hand' '-500.00' $false) + `
  (Led 'OP Loan Given' 'Loans & Advances (Asset)' '' $false) + (Led 'OP Expense' 'Indirect Expenses' '' $false) + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
function Jv([string]$d, [string]$dr, [string]$cr, [int]$amt, [string]$bill) {
  $l = '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $dr + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
  $l += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $cr + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT>'
  if ($bill) { $l += '<BILLALLOCATIONS.LIST><NAME>' + $bill + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>' + $amt + '.00</AMOUNT></BILLALLOCATIONS.LIST>' }
  return '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $d + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>openp</NARRATION>' + $l + '</ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$vx = OPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (OE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + `
  (Jv $d1a 'OP Expense' 'OP Party Billwise' 300 'J-1') + (Jv $d1b 'OP Expense' 'OP Party Plain' 200 '') + (Jv $d1a 'OP Loan Given' 'OP Cash Two' 700 '') + (Jv $d2 'OP Expense' 'OP Party Plain' 50 '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
Set-Content (Join-Path $out 'openp-masters-answer.xml') $mk.body -Encoding UTF8; Set-Content (Join-Path $out 'openp-entries-answer.xml') $vx.body -Encoding UTF8
$created = [regex]::Match($mk.body, '<CREATED>(\d+)').Groups[1].Value; $vcreated = [regex]::Match($vx.body, '<CREATED>(\d+)').Groups[1].Value
$o2 = if ($created -eq '5' -and $vcreated -eq '4') { 'PASS' } else { 'HARNESS' }
Add-Content -Path $resultsFile -Encoding UTF8 -Value "$o2 openp o2 made by XML: ledgers created $created of 5 ($($mk.body -replace '\s+', ' ')), entries created $vcreated of 4 ($($vx.body -replace '\s+', ' '))"
if ($o2 -ne 'PASS') { return }
# the expected figures: at the books' beginning, and at year 2's start (Tally's sign: Cr positive)
$want = [ordered]@{
  'OP Party Billwise' = @(1000, 1300); 'OP Party Plain' = @(1000, 1200); 'OP Cash Two' = @(-500, 200); 'OP Loan Given' = @(0, -700); 'OP Expense' = @(0, 0)
}
function Openings([string]$x) {
  $r = OPost $x; $m = @{}
  foreach ($l in [regex]::Matches($r.body, '<LEDGER NAME="(OP [^"]+)"(?s:.*?)</LEDGER>')) {
    $o = [regex]::Match($l.Value, '<OPENINGBALANCE[^>]*>\s*([^<]*)</OPENINGBALANCE>').Groups[1].Value.Trim()
    $m[$l.Groups[1].Value] = if ($o) { [decimal]($o -replace '[^\d.\-]', '') } else { [decimal]0 }
  }
  return [pscustomobject]@{ ms = $r.ms; open = $m; bytes = $r.body.Length }
}
function Reading($label, $res) {
  $parts = @(); $atBooks = 0; $atY2 = 0; $other = 0
  foreach ($k in $want.Keys) {
    $g = if ($res.open.ContainsKey($k)) { $res.open[$k] } else { 'absent' }
    $kind = if ($g -eq 'absent') { 'absent' } elseif ($g -eq $want[$k][0] -and $g -eq $want[$k][1]) { 'same either way' } elseif ($g -eq $want[$k][0]) { $atBooks++; 'at books-from' } elseif ($g -eq $want[$k][1]) { $atY2++; 'at year 2' } else { $other++; 'neither' }
    $parts += "$k $g ($kind)"
  }
  Write-Host "[openp] $label`: $($parts -join '; ')"
  return [pscustomobject]@{ text = ($parts -join '; '); books = $atBooks; y2 = $atY2; other = $other; ms = $res.ms }
}
# o3: as built
$r3 = Reading 'o3 as built' (Openings $asBuilt)
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} openp o3 the request as built, the session in its own period ({1} ms): {2}" -f $(if ($r3.text -match 'absent') { 'HARNESS' } elseif ($r3.y2 -eq 0 -and $r3.other -eq 0) { 'PASS' } else { 'FAIL' }), $r3.ms, $r3.text)
# o4: the same with year 2's period in its static variables (as if the session were in year 2)
$withP = $asBuilt.Replace('</STATICVARIABLES>', '<SVFROMDATE TYPE="Date">' + $y2from + '</SVFROMDATE><SVTODATE TYPE="Date">' + $y2to + '</SVTODATE></STATICVARIABLES>')
$r4 = Reading 'o4 year 2 period' (Openings $withP)
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO openp o4 the same request with year 2's SVFROMDATE/SVTODATE added (harness only) ({0} ms): {1}" -f $r4.ms, $r4.text)
# o5: the session's period moved to year 2 by keys (Alt+F2: From, To), then the request as built
$f2 = ([datetime]::ParseExact($y2from, 'yyyyMMdd', $null)).ToString('d-M-yyyy'); $t2 = ([datetime]::ParseExact($y2to, 'yyyyMMdd', $null)).ToString('d-M-yyyy')
KeysTo '%{F2}' 3 'openp-altf2'
KeysTo ('^a' + $f2 + '{ENTER}') 2
KeysTo ('^a' + $t2 + '{ENTER}') 3 'openp-period-set'
KeysTo '^a' 3
$r5 = Reading 'o5 session in year 2' (Openings $asBuilt)
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO openp o5 the session's period set to {0}..{1} by keys (Alt+F2; screenshots openp-*), then the request as built ({2} ms): {3}" -f $f2, $t2, $r5.ms, $r5.text)
# o6: the reading
$depends = ($r4.y2 -gt 0) -or ($r5.y2 -gt 0)
Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO openp o6 OPENINGBALANCE follows the session's period: {0} (o3 at books-from {1}, at year 2 {2}; o4 at year 2 {3} of {5}; o5 at year 2 {4} of {5})" -f $(if ($depends) { 'YES' } else { 'NO' }), $r3.books, $r3.y2, $r4.y2, $r5.y2, $want.Count)
Set-Content (Join-Path $out 'openp-request-as-built.xml') $asBuilt -Encoding UTF8
