# Mode tdsm (bridge 2.4.3, MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally). Dot-sourced by
# flowv.ps1 after c2; no bridge is installed. The 2.4.3 requests exactly as the ref's source builds them (bridge-dist\ledreq,
# written by a go test at the ref: ledgerChunkRequest, ledgerByNameRequest, natureChunkRequest; requests/entry-object.xml):
#   m1 TDS masters made: the company's TDS on (XML), two natures of payment on their own form with rates and a threshold
#      (keys), a TDS duty ledger with its nature (XML, TDSRATENAME), a party with a lower-deduction certificate and a party
#      with a special rate (XML)
#   m2 the ledger list (FinComLedgers of the ref) and FinComLedgerByName give the duty ledger's nature, the special rate and
#      every field of the certificate (nature, from, to, section, certificate number, rate, limit) as made
#   m3 FinComTdsNatures, chunked as the bridge reads it (5,000 MasterIDs a request up to the company's highest master
#      number, then the open end), finds every nature Tally's own TDSRate collection lists, each with its section, rates
#      and threshold
#   m4 a TDS payment made by XML with its challan, tax, interest and late fee lines: the ref's FinComVoucherObject answers
#      the challan fields (raw kept for the bridge's tests)
#   m5 times: on ZZ BIG TEST's masters (tests/fixtures/big/make_big_company.py, imported) and at about 20,000 ledgers (one
#      in ten with a certificate): every FinComLedgers chunk (2.4.3 fields) beside the same chunk with 2.4.2's fields,
#      FinComTdsNatures (every chunk) and FinComLedgerByName; after each the company list timed and Tally's window asked
#      whether it responds. PASS when every FinComTdsNatures and FinComLedgerByName answer is under 2 s, Tally responds
#      after each, and no request fails
# MEASURE lines carry the numbers (summary).
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 60 }
$script:TdsCo = $co1
$script:TdsRestart = {
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'tdsm-restarted'
}
$M1 = 'm1 TDS masters made (natures with rates and threshold, duty ledger with nature, certificate, special rate)'
$M2 = 'm2 the ledger requests give the nature, the special rate and the certificate'
$M3 = 'm3 FinComTdsNatures, chunked, finds every nature with its section, rates and threshold'
$M4 = 'm4 the challan fields in FinComVoucherObject''s answer'
$M5 = 'm5 times on ZZ BIG TEST''s masters and at 20,000 ledgers (natures and by-name under 2 s, Tally responding)'
$mDone = @{}
function MRes($c, $st, $ev) { if (-not $mDone[$c]) { Result $c $st $ev; $mDone[$c] = $true } }
function XSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function LE([string]$s) { [Security.SecurityElement]::Escape($s) }
function XImp($report, $msg, $label) {
  $r = Imp $report $msg $label
  $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>')
  $k = [pscustomobject]@{ c = [int]('0' + $m.Groups[1].Value); a = [int]('0' + $m.Groups[2].Value); e = [int]('0' + $m.Groups[3].Value) }
  Info ("tdsm {0}: created {1}, altered {2}, errors {3}" -f $label, $k.c, $k.a, $k.e); return $k
}
function TPost([string]$x, [int]$sec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($x)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec).Content; $ok = $true }
  catch { $c = "failed: $($_.Exception.Message)"; $ok = $false }
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return [pscustomobject]@{ ok = $ok; ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); body = "$c" }
}
$lightX = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TMLight</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TMLight" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function AltM {
  $r = TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TMCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TMCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ALTMSTID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  return [int64]('0' + [regex]::Match($r.body, '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value)
}
# the ref's requests
$lq = Join-Path $env:BRIDGE_DIST 'ledreq'
$need = 'ledlist-chunk.xml', 'ledlist-tail.xml', 'ledlist-chunk-242.xml', 'ledbyname.xml', 'natures-chunk.xml', 'natures-tail.xml'
$miss = @($need | Where-Object { -not (Test-Path (Join-Path $lq $_)) })
if ($miss.Count) { foreach ($c in $M1, $M2, $M3, $M4, $M5) { MRes $c 'HARNESS' "the ref's requests are not in bridge-dist\ledreq: $($miss -join ', ')" }; return }
$T = @{}; foreach ($n in $need) { $T[$n] = (Get-Content (Join-Path $lq $n) -Raw).Trim() }
Info "tdsm: the ref's requests from $lq ($(Get-Content (Join-Path $lq 'SOURCE.txt') -TotalCount 1 -ErrorAction SilentlyContinue))"
function Req([string]$tpl, [int64]$a, [int64]$u) { $tpl.Replace('@@CO@@', (LE $co1)).Replace('111111', "$a").Replace('222222', "$u") }
function ByName([string]$name) { $T['ledbyname.xml'].Replace('@@CO@@', (LE $co1)).Replace('@@NAME@@', (LE $name)) }
# the natures as the bridge reads them: MasterID chunks of 5,000 up to the highest master number, then the open end
function NatRead {
  $bound = AltM; $after = [int64]0; $all = ''; $times = @(); $ok = $true
  while ($true) {
    $tail = ($after -ge $bound)
    $r = TPost (Req $(if ($tail) { $T['natures-tail.xml'] } else { $T['natures-chunk.xml'] }) $after $(if ($tail) { 0 } else { $after + 5000 }))
    $times += $r.ms; if (-not $r.ok) { $ok = $false; break }
    $all += $r.body
    if ($tail) { break }; $after += 5000
  }
  return [pscustomobject]@{ body = $all; times = $times; ok = $ok; n = $times.Count }
}
$NAT1 = 'FM Contract 194C'; $NAT2 = 'FM Prof Fees 194J'; $DUTY = 'FM TDS 194J'; $LDC = 'FM LDC Party'; $SPC = 'FM Special Party'; $EXP = 'FM Prof Exp'
$made = [ordered]@{}
try {
  Say '---- tdsm: masters'
  $null = XImp 'All Masters' ('<COMPANY NAME="' + $co1 + '" ACTION="Alter"><NAME>' + $co1 + '</NAME><ISTDSON>Yes</ISTDSON><TANUMBER>DELF01234E</TANUMBER><TANREGNO>DELF01234E</TANREGNO><TDSDEDUCTORTYPE>Company</TDSDEDUCTORTYPE></COMPANY>') 'company TDS on, TAN'
  function NatureKeys([string]$name, [string]$sec, [string]$pay, [string]$rI, [string]$rO, [string]$thr) {
    if (TdsHas 'TDSRate' $name) { return $true }
    if (-not (TdsOpenCreate 'TDS Nature of Payments' 'Nature|Section')) { return $false }
    $null = TK ((SK $name) + '{ENTER}') 1.5 'nat-name'
    $null = TK ((SK $sec) + '{ENTER}') 1.5 'nat-section'
    $null = TK ((SK $pay) + '{ENTER}') 1.5 'nat-paycode'
    $null = TK '{ENTER}' 1.5 'nat-remit'
    $null = TK ($rI + '{ENTER}') 1.5 'nat-rate-ind'
    $null = TK ($rO + '{ENTER}') 1.5 'nat-rate-oth'
    for ($i = 1; $i -le 3; $i++) {
      $t = TdsScreen "nat-before-thr$i"
      if ($t -match 'Yes or No|Accept \?') { break }
      $null = TK ($thr + '{ENTER}') 1.5 "nat-thr$i"
    }
    $t = TdsScreen 'nat-accept-q'
    if ($t -match 'Yes or No|Accept') { $null = TK 'y' 2.5 'nat-yes' } else { $null = TK '^a' 2.5 'nat-ctrl-a'; $t = TdsScreen 'nat-accept-q2'; if ($t -match 'Yes or No') { $null = TK 'y' 2.5 'nat-yes2' } }
    $null = TK '{ESC}' 2 'nat-esc1'; $null = TK '{ESC}' 2 'nat-esc2'
    $ok = TdsHas 'TDSRate' $name
    $null = TdsGateway 'after the nature'; return $ok
  }
  $n1 = $false; $n2 = $false
  try { $n1 = NatureKeys $NAT1 '194C' '94C' '1' '2' '30000' } catch { Write-Host "tdsm nature 1: $_" }
  try { $n2 = NatureKeys $NAT2 '194J' '94J' '10' '10' '50000' } catch { Write-Host "tdsm nature 2: $_" }
  $made['natures'] = "keys $n1/$n2"
  $led = ('<LEDGER NAME="' + $DUTY + '" ACTION="Create"><NAME.LIST><NAME>' + $DUTY + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>TDS</TAXTYPE><TDSRATENAME>' + (LE $NAT2) + '</TDSRATENAME></LEDGER>') +
    ('<LEDGER NAME="' + $EXP + '" ACTION="Create"><NAME.LIST><NAME>' + $EXP + '</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><ISTDSEXPENSE>Yes</ISTDSEXPENSE><TDSRATENAME>' + (LE $NAT2) + '</TDSRATENAME></LEDGER>') +
    ('<LEDGER NAME="' + $LDC + '" ACTION="Create"><NAME.LIST><NAME>' + $LDC + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><INCOMETAXNUMBER>AAACL0005E</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE>' +
      '<LOWERDEDUCTION.LIST><NATUREOFPAYMENT>' + (LE $NAT2) + '</NATUREOFPAYMENT><LOWERDEDUCTIONDETAILS.LIST><FROMDATE>20260401</FROMDATE><TODATE>20270331</TODATE><SECTIONNO>197</SECTIONNO><CERTIFICATENO>LDC197CERT0001</CERTIFICATENO><TDSITRATE>1</TDSITRATE><LOWERDEDUCTIONLIMIT>500000.00</LOWERDEDUCTIONLIMIT></LOWERDEDUCTIONDETAILS.LIST></LOWERDEDUCTION.LIST></LEDGER>') +
    ('<LEDGER NAME="' + $SPC + '" ACTION="Create"><NAME.LIST><NAME>' + $SPC + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><INCOMETAXNUMBER>ABCPF0002B</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Individual/HUF - Resident</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>Yes</TDSDEDUCTEEISSPECIALRATE><TDSDEDUCTEESPECIALRATE>1</TDSDEDUCTEESPECIALRATE></LEDGER>') +
    '<LEDGER NAME="HDFC Bank" ACTION="Create"><NAME.LIST><NAME>HDFC Bank</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>'
  $k = XImp 'All Masters' $led 'the duty ledger, an expense, the certificate party, the special-rate party, the bank'
  $made['ledgers'] = "XML created $($k.c)"
  MRes $M1 $(if ($n1 -and $n2 -and $k.c -ge 4) { 'PASS' } else { 'HARNESS' }) ("natures by keys {0}/{1}; ledgers by XML: created {2}, errors {3}" -f $n1, $n2, $k.c, $k.e)

  Say '---- tdsm: the ledger requests'
  $ch = TPost (Req $T['ledlist-tail.xml'] 0 0); XSave 'ledlist-243.xml' $ch.body
  $bn = TPost (ByName $LDC); XSave 'ledbyname-ldc.xml' $bn.body
  $bd = TPost (ByName $DUTY); $bs = TPost (ByName $SPC)
  $blk = { param($t, $name) [regex]::Match($t, '(?s)<LEDGER NAME="' + [regex]::Escape((LE $name)) + '"[^>]*>.*?</LEDGER>').Value }
  $v = { param($t, $tag) [regex]::Match($t, "<$tag(?:\s[^>]*)?>([^<]*)</$tag>").Groups[1].Value.Trim() }
  $want = [ordered]@{ NATUREOFPAYMENT = $NAT2; FROMDATE = '20260401'; TODATE = '20270331'; SECTIONNO = '197'; CERTIFICATENO = 'LDC197CERT0001'; TDSITRATE = '1'; LOWERDEDUCTIONLIMIT = '500000.00' }
  $ev = @(); $good = $true
  foreach ($src in @(@('FinComLedgers', $ch.body), @('FinComLedgerByName', "$($bn.body)$($bd.body)$($bs.body)"))) {
    $l = & $blk $src[1] $LDC; $d = & $blk $src[1] $DUTY; $s = & $blk $src[1] $SPC
    $got = [ordered]@{}; foreach ($f in $want.Keys) { $got[$f] = & $v $l $f }
    $nat = & $v $d 'TDSRATENAME'; $sp = "$(& $v $s 'TDSDEDUCTEEISSPECIALRATE')/$(& $v $s 'TDSDEDUCTEESPECIALRATE')"
    $okC = @($want.Keys | Where-Object { $got[$_] -ne $want[$_] -and -not ($_ -eq 'TDSITRATE' -and [double]('0' + $got[$_]) -eq 1) }).Count -eq 0
    $okN = ($nat -eq $NAT2); $okS = ($sp -match '^Yes/\s*1(\.0+)?$')
    if (-not ($okC -and $okN -and $okS)) { $good = $false }
    $ev += "$($src[0]): nature '$nat' $okN; special $sp $okS; certificate $(($got.Keys | ForEach-Object { "$_=$($got[$_])" }) -join ' ') $okC"
  }
  MRes $M2 $(if (-not $ch.ok -or -not $bn.ok) { 'FAIL' } elseif ($good) { 'PASS' } else { 'FAIL' }) ($ev -join ' | ')

  Say '---- tdsm: the natures'
  $nr = NatRead; XSave 'natures-243.xml' $nr.body
  $natAll = TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TMNat</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TMNat" ISMODIFY="No"><TYPE>TDSRate</TYPE><FETCH>*, *.*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  XSave 'natures-all.xml' $natAll.body
  $names = { param($t) @([regex]::Matches($t, '<TDSRATE NAME="([^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) }
  $nB = & $names $nr.body; $nT = & $names $natAll.body
  $missN = @($nT | Where-Object { $nB -notcontains $_ })
  $one = { param($t, $name) [regex]::Match($t, '(?s)<TDSRATE NAME="' + [regex]::Escape((LE $name)) + '"[^>]*>.*?</TDSRATE>').Value }
  $c1 = & $one $nr.body $NAT1; $c2 = & $one $nr.body $NAT2
  $f = { param($b) "section=$(& $v $b 'TDSRATESECTION') rate=$(& $v $b 'RATEOFTAX') other=$(& $v $b 'OTHERRATE') nopan=$(& $v $b 'NOPANRATEOFTAX') threshold=$(& $v $b 'EXEMPTIONLIMIT') single=$(& $v $b 'SINGLEBILLVALUE') from=$(& $v $b 'APPLICABLEFROM')" }
  $okN1 = (& $v $c1 'TDSRATESECTION') -eq '194C' -and [double]('0' + (& $v $c1 'RATEOFTAX')) -eq 1 -and [double]('0' + (& $v $c1 'OTHERRATE')) -eq 2
  $okN2 = (& $v $c2 'TDSRATESECTION') -eq '194J' -and [double]('0' + (& $v $c2 'RATEOFTAX')) -eq 10
  $thr = ("$(& $v $c1 'EXEMPTIONLIMIT')/$(& $v $c2 'EXEMPTIONLIMIT')")
  Info "tdsm: natures: the bridge's chunks $($nr.n) ($(($nr.times | ForEach-Object { "$_ ms" }) -join ', ')), found $($nB.Count); Tally's TDSRate lists $($nT.Count); missed by the chunks: $($missN -join ', ')"
  MRes $M3 $(if (-not $nr.ok) { 'FAIL' } elseif ($missN.Count -eq 0 -and $nT.Count -gt 0 -and ((-not ($n1 -and $n2)) -or ($okN1 -and $okN2))) { 'PASS' } else { 'FAIL' }) `
    ("chunks {0}, {1} natures of Tally's {2}, none missed: {3}; '{4}': {5}; '{6}': {7}; thresholds typed 30000/50000, read {8}" -f $nr.n, $nB.Count, $nT.Count, ($missN.Count -eq 0), $NAT1, (& $f $c1), $NAT2, (& $f $c2), $thr)

  Say '---- tdsm: a TDS payment with its challan (XML)'
  $px = '<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261202</DATE><EFFECTIVEDATE>20261202</EFFECTIVEDATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PM1</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>PM1 TDS payment by XML, 194J</NARRATION>' +
    '<STATPAYMENTTYPE>TDS</STATPAYMENTTYPE><TAXPAYPERIODFROMDATE>20261101</TAXPAYPERIODFROMDATE><TAXPAYPERIODTODATE>20261130</TAXPAYPERIODTODATE><TDSNATUREOFPAYMENT>' + (LE $NAT2) + '</TDSNATUREOFPAYMENT><TDSSECTIONNO>194J</TDSSECTIONNO>' +
    '<TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>54321</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>20261231</TAXCHALLANDATE><TAXCHEQUENUMBER>778899</TAXCHEQUENUMBER><TAXCHEQUEDATE>20261201</TAXCHEQUEDATE><TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME><TAXBANKBRANCHNAME>Connaught Place</TAXBANKBRANCHNAME>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTY + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10000.00</AMOUNT><TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTY + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-150.00</AMOUNT><TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTY + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT><TYPEOFTAXPAYMENT>Late Fee</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10350.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $k = XImp 'Vouchers' $px 'payment PM1 (XML)'
  $e = @(Vouchers | Where-Object { $_.narr -like 'PM1 *' })[0]
  $tmplF = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  if ($e -and (Test-Path $tmplF)) {
    $mid = TdsMid "$($e.mid)"
    $o = TPost ((Get-Content $tmplF -Raw).Replace('FinCom Spike Co', $co1).Replace('ID:99999<', "ID:$mid<"))
    XSave 'obj-PM1.xml' $o.body
    $tags = 'STATPAYMENTTYPE', 'TAXPAYPERIODFROMDATE', 'TAXPAYPERIODTODATE', 'TAXCHALLANBSRCODE', 'TAXBANKCHALLANNUMBER', 'TAXCHALLANDATE', 'TAXCHEQUENUMBER', 'TAXCHEQUEDATE', 'TAXBANKNAME', 'TAXBANKBRANCHNAME', 'TDSNATUREOFPAYMENT', 'TDSSECTIONNO'
    $gotT = [ordered]@{}; foreach ($t in $tags) { $gotT[$t] = & $v $o.body $t }
    $kinds = @([regex]::Matches($o.body, '<TYPEOFTAXPAYMENT[^>]*>([^<]+)<') | ForEach-Object { $_.Groups[1].Value.Trim() })
    $okP = $gotT['TAXCHALLANBSRCODE'] -eq '0510308' -and $gotT['TAXBANKCHALLANNUMBER'] -eq '54321' -and $gotT['TAXCHALLANDATE'] -eq '20261231' -and ($kinds -join ',') -match 'Tax,Interest,Late Fee'
    MRes $M4 $(if ($okP) { 'PASS' } else { 'FAIL' }) ("PM1 MasterID {0}, {1} ms, {2} bytes: {3}; lines {4}" -f $mid, $o.ms, $o.body.Length, (($gotT.Keys | ForEach-Object { "$_=$($gotT[$_])" }) -join ' '), ($kinds -join ','))
  } else { MRes $M4 'HARNESS' "the payment was not made (created $($k.c)) or the ref's entry request is missing" }

  Say '---- tdsm: times'
  $rows = @(); $fails = 0; $slow = @()
  function Timed([string]$label, [string]$size, [string]$req, [string]$x) {
    $r = TPost $x 30
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $resp = [bool]($p -and $p.Responding)
    $l = TPost $lightX 10
    $script:rows += [pscustomobject]@{ size = $size; req = $req; span = $label; ms = $r.ms; bytes = $r.body.Length; light = $l.ms; responding = ($resp -and $l.ok); ok = $r.ok }
    if (-not $r.ok) { $script:fails++ }
    Write-Host ("[tdsm] {0} {1} {2}: {3} ms, {4} bytes; light {5} ms, responding {6}" -f $size, $req, $label, $r.ms, $r.body.Length, $l.ms, ($resp -and $l.ok))
    return $r
  }
  function Round([string]$size) {
    $bound = AltM; $after = [int64]0
    while ($true) {
      $tail = ($after -ge $bound); $u = if ($tail) { 0 } else { $after + 2000 }
      $null = Timed $(if ($tail) { "from $($after + 1)" } else { "$($after + 1)-$u" }) $size 'FinComLedgers' (Req $(if ($tail) { $T['ledlist-tail.xml'] } else { $T['ledlist-chunk.xml'] }) $after $u)
      if (-not $tail) { $null = Timed "$($after + 1)-$u" $size 'FinComLedgers 2.4.2' (Req $T['ledlist-chunk-242.xml'] $after $u) }
      if ($tail) { break }; $after = $u
    }
    $after = [int64]0
    while ($true) {
      $tail = ($after -ge $bound)
      $null = Timed $(if ($tail) { "from $($after + 1)" } else { "$($after + 1)-$($after + 5000)" }) $size 'FinComTdsNatures' (Req $(if ($tail) { $T['natures-tail.xml'] } else { $T['natures-chunk.xml'] }) $after $(if ($tail) { 0 } else { $after + 5000 }))
      if ($tail) { break }; $after += 5000
    }
    foreach ($n in $LDC, $DUTY, 'TM Ledger 00007') { $null = Timed $n $size 'FinComLedgerByName' (ByName $n) }
  }
  # ZZ BIG TEST's masters (its generator, run by the build: bridge-dist\big\big-masters.xml)
  $bigF = Join-Path $env:BRIDGE_DIST 'big\big-masters.xml'
  if (Test-Path $bigF) {
    $bx = Get-Content $bigF -Raw
    $msg = [regex]::Match($bx, '(?s)<TALLYMESSAGE[^>]*>(.*)</TALLYMESSAGE>').Groups[1].Value
    if (-not $msg) { $msg = $bx }
    $r = TPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 600
    Info ("tdsm: ZZ BIG TEST's masters imported in {0} ms: {1}" -f $r.ms, ([regex]::Match($r.body, '(?s)<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>').Value -replace '\s+', ' '))
    Round 'ZZ BIG TEST masters'
  } else { Info 'tdsm: no ZZ BIG TEST masters in bridge-dist\big (the build did not write them)' }
  # up to about 20,000 ledgers, one in ten with a certificate
  $have = [int]('0' + [regex]::Match((TPost ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>')).body, '<RESULT[^>]*>\s*(\d+)').Groups[1].Value)
  $i = 0
  while ($have + $i -lt 20000) {
    $objs = @()
    for ($j = 0; $j -lt 1000 -and ($have + $i) -lt 20000; $j++) {
      $i++; $n = 'TM Ledger {0:d5}' -f $i
      $x = '<LEDGER NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><INCOMETAXNUMBER>AAAPL' + ('{0:d4}' -f ($i % 10000)) + 'K</INCOMETAXNUMBER>'
      if ($i % 10 -eq 0) { $x += '<TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE><LOWERDEDUCTION.LIST><NATUREOFPAYMENT>' + (LE $NAT2) + '</NATUREOFPAYMENT><LOWERDEDUCTIONDETAILS.LIST><FROMDATE>20260401</FROMDATE><TODATE>20270331</TODATE><SECTIONNO>197</SECTIONNO><CERTIFICATENO>LDC' + $i + '</CERTIFICATENO><TDSITRATE>1</TDSITRATE><LOWERDEDUCTIONLIMIT>100000.00</LOWERDEDUCTIONLIMIT></LOWERDEDUCTIONDETAILS.LIST></LOWERDEDUCTION.LIST>' }
      $objs += $x + '</LEDGER>'
    }
    $null = TPost ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + ($objs -join '') + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') 600
  }
  Info "tdsm: $i ledgers added (one in ten with a certificate) to the $have there were"
  Round '20,000 ledgers'
  $rows | Export-Csv (Join-Path $out 'tdsm-times.csv') -NoTypeInformation
  $by = $rows | Group-Object { "$($_.size)|$($_.req)" }
  foreach ($g in $by) { $s = @($g.Group | Sort-Object ms); Add-Content -Path $resultsFile -Value ("MEASURE {0}: {1} request(s), worst {2} ms, median {3} ms, worst light {4} ms" -f ($g.Name -replace '\|', ' '), $s.Count, $s[-1].ms, $s[[int][math]::Floor(($s.Count - 1) / 2)].ms, (@($g.Group | Sort-Object light))[-1].light) -Encoding UTF8 }
  $over = @($rows | Where-Object { $_.req -in 'FinComTdsNatures', 'FinComLedgerByName' -and $_.ms -ge 2000 })
  $nr2 = @($rows | Where-Object { -not $_.responding })
  $w = { param($req) $x = @($rows | Where-Object { $_.req -eq $req } | Sort-Object ms); if ($x.Count) { $x[-1].ms } else { -1 } }
  MRes $M5 $(if ($fails -or $over.Count -or $nr2.Count) { 'FAIL' } else { 'PASS' }) ("worst FinComTdsNatures {0} ms, FinComLedgerByName {1} ms, FinComLedgers (2.4.3) {2} ms, the same chunk with 2.4.2's fields {3} ms; failed {4}, not responding {5}, natures or by-name over 2 s {6}" -f (& $w 'FinComTdsNatures'), (& $w 'FinComLedgerByName'), (& $w 'FinComLedgers'), (& $w 'FinComLedgers 2.4.2'), $fails, $nr2.Count, $over.Count)
} catch {
  Write-Host "tdsm stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in $M1, $M2, $M3, $M4, $M5) { MRes $c 'HARNESS' "the harness stopped: $_" }
}
