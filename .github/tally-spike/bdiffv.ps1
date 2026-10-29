# Mode bdiff (bridge 2.4.9's gate, TEST DATA ONLY: a throwaway company in this runner's own Tally; no bridge installed).
# Dot-sourced by flowv.ps1 after c2, on dblib.ps1. The owner's condition of 29-Oct-2026: FinComVoucherBatch must give
# FinCom exactly what FinComVoucherObject gives, field for field, on the shapes the batch measurement did not have:
#   - the tdsgst test company (tdsgst/: GST sales, purchases, credit and debit notes, TDS journals, receipts; the 39 entries
#     of round 43 by XML),
#   - TDS challan payments (a Stat Payment by XML with its challan, the tax, interest and late-fee lines and a bank line),
#   - the payroll test company (payg/: payroll entries and salary payments with a bank line per employee),
#   - stock journals (items in and out, by XML).
# For every day holding entries: Tally's own list of the day, then the day's entries that are not payroll entries (the
# bridge reads payroll entries one by one) in ONE FinComVoucherBatch, in the range form when they are a run of the day's
# heads and always also in the list form, and FinComVoucherObject for each of them alone; raw answers kept (raw.zip).
# The job then puts both through the ref's own code (batch\zz_bdiff_test.go: batchConvert and fastStripWhy, as
# fetchVoucherBatch does) and compares every kept field (d1).
. (Join-Path $PSScriptRoot 'dblib.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$D0 = 'd0 the test data made (tdsgst, TDS challan payments, payroll with salary payments, stock journals)'
$D2 = 'd2 FinComVoucherBatch on every day: exactly the entries asked, each under 2 s'
$dDone = @{}
function DRes($c, $st, $ev) { if (-not $dDone[$c]) { Result $c $st $ev; $dDone[$c] = $true } }
function TM([string]$x) { '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + $x + '</TALLYMESSAGE>' }
$bt = Join-Path $cap 'batch'; $raw = Join-Path $bt 'raw'; New-Item -ItemType Directory -Force $raw | Out-Null
function RawSave([string]$n, $t) { [IO.File]::WriteAllText((Join-Path $raw $n), "$t", [Text.UTF8Encoding]::new($false)) }
$bq = Join-Path $env:BRIDGE_DIST 'batchreq'
$RB = @{}; foreach ($f in @(Get-ChildItem $bq -Filter '*.xml' -ErrorAction SilentlyContinue)) { $RB[$f.BaseName] = (Get-Content $f.FullName -Raw).Trim() }
if (-not $RB['b4-range'] -or -not $RB['b4-list'] -or -not $RB['object']) { foreach ($c in $D0, $D2) { DRes $c 'HARNESS' 'the requests are not in bridge-dist\batchreq' }; return }
Copy-Item (Join-Path $bq '*') $bt -ErrorAction SilentlyContinue
function NoInfo([string]$b) { return [regex]::Replace($b, '(?s)<CMPINFO>.*?</CMPINFO>', '') }
function MidsOf([string]$b) { @([regex]::Matches((NoInfo $b), '(?s)<VOUCHER[ >].*?</VOUCHER>') | ForEach-Object { [regex]::Match($_.Value, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value } | Where-Object { $_ }) }
$made = [ordered]@{}
try {
  # ---- tdsgst (masters.json steps, vouchers-p1.json), into this company
  $gdir = Join-Path $PSScriptRoot 'tdsgst'
  $M = Get-Content (Join-Path $gdir 'masters.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in $M.steps) { $k = DbImp 'All Masters' (TM $s[1]) "tdsgst $($s[0])"; $made["tdsgst masters $($s[0])"] = "$($k.c) created, $($k.e) errors" }
  $V1 = Get-Content (Join-Path $gdir 'vouchers-p1.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $ok = 0; $bad = @()
  foreach ($v in $V1.vouchers) {
    $k = DbImp 'Vouchers' (TM $v.xml) "tdsgst $($v.id)"
    if ($k.c -ne 1 -and $v.xml -match 'TAXOBJECTALLOCATIONS') { $k = DbImp 'Vouchers' (TM ($v.xml -replace '(?s)<TAXOBJECTALLOCATIONS\.LIST>.*?</TAXOBJECTALLOCATIONS\.LIST>', '')) "tdsgst $($v.id) (no TDS allocation)" }
    if ($k.c -eq 1) { $ok++ } else { $bad += "$($v.id): $($k.line)" }
  }
  $made['tdsgst entries'] = "$ok of $($V1.vouchers.Count)$(if ($bad.Count) { '; refused ' + ($bad -join '; ') })"
  # ---- TDS challan payments (tdschv.ps1's PX1 shape, on tdsgst's TDS ledgers): one with the challan, tax, interest and
  # late fee; one plain tax payment of another nature
  # the nature of payment as Tally's own TDSRate masters name it (a TDS company has Tally's natures; else one by XML)
  $null = DbImp 'All Masters' (TM '<TDSRATE NAME="BD Nature 194J" ACTION="Create"><NAME.LIST><NAME>BD Nature 194J</NAME></NAME.LIST><NAME>BD Nature 194J</NAME><SECTIONNUMBER>194J</SECTIONNUMBER><PAYMENTCODE>94J</PAYMENTCODE></TDSRATE>') 'a TDS nature by XML'
  $natX = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BDNat</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="BDNat" ISMODIFY="No"><TYPE>TDSRate</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 120
  $natNames = @([regex]::Matches("$($natX.body)", '<TDSRATE NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
  $nat = @($natNames | Where-Object { $_ -match 'Profession' }) + @($natNames | Where-Object { $_ -match '194J' }) + @($natNames) + @('BD Nature 194J') | Select-Object -First 1
  $made['TDS natures in Tally'] = "$($natNames.Count) (used '$nat')"
  $duty = 'TDS Payable 194J'
  foreach ($p in @(@{ no = 'BD-TDS-1'; d = '20260602'; tax = '10000.00'; int = '150.00'; fee = '200.00'; tot = '10350.00'; chal = '54321' }, @{ no = 'BD-TDS-2'; d = '20260702'; tax = '4500.00'; int = ''; fee = ''; tot = '4500.00'; chal = '54400' })) {
    $x = '<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>' + $p.d + '</DATE><EFFECTIVEDATE>' + $p.d + '</EFFECTIVEDATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>' + $p.no + '</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>' + $p.no + ' TDS challan payment by XML</NARRATION>' +
      '<STATPAYMENTTYPE>TDS</STATPAYMENTTYPE><TAXPAYPERIODFROMDATE>20260501</TAXPAYPERIODFROMDATE><TAXPAYPERIODTODATE>20260531</TAXPAYPERIODTODATE><TDSNATUREOFPAYMENT>' + (LE $nat) + '</TDSNATUREOFPAYMENT><TDSSECTIONNO>194J</TDSSECTIONNO>' +
      '<TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>' + $p.chal + '</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>' + $p.d + '</TAXCHALLANDATE><TAXCHEQUENUMBER>778899</TAXCHEQUENUMBER><TAXCHEQUEDATE>' + $p.d + '</TAXCHEQUEDATE><TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME><TAXBANKBRANCHNAME>Connaught Place</TAXBANKBRANCHNAME>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $duty + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $p.tax + '</AMOUNT><TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $nat) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
      $(if ($p.int) { '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $duty + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $p.int + '</AMOUNT><TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $nat) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' }) +
      $(if ($p.fee) { '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $duty + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $p.fee + '</AMOUNT><TYPEOFTAXPAYMENT>Late Fee</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $nat) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' }) +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $p.tot + '</AMOUNT><BANKALLOCATIONS.LIST><DATE>' + $p.d + '</DATE><INSTRUMENTDATE>' + $p.d + '</INSTRUMENTDATE><NAME>' + $p.no + '</NAME><TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE><INSTRUMENTNUMBER>778899</INSTRUMENTNUMBER><AMOUNT>' + $p.tot + '</AMOUNT></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>'
    $k = DbImp 'Vouchers' (TM $x) "TDS challan payment $($p.no)"
    if ($k.c -ne 1) { $k = DbImp 'Vouchers' (TM ($x -replace '(?s)<BANKALLOCATIONS\.LIST>.*?</BANKALLOCATIONS\.LIST>', '')) "TDS challan payment $($p.no) (no bank allocation)" }
    if ($k.c -ne 1) { $k = DbImp 'Vouchers' (TM ($x -replace '<TDSNATUREOFPAYMENT>[^<]*</TDSNATUREOFPAYMENT>', '' -replace '<STATNATURENAME>[^<]*</STATNATURENAME>', '')) "TDS challan payment $($p.no) (no nature)" }
    $made["TDS challan payment $($p.no)"] = "created $($k.c)$(if ($k.line) { ': ' + $k.line })"
  }
  # ---- payroll (payg/: the company renamed to this one, as paygv.ps1 does)
  $pdir = Join-Path $PSScriptRoot 'payg'
  $PS = Get-Content (Join-Path $pdir 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $mx = (Get-Content (Join-Path $pdir 'masters.xml') -Raw -Encoding UTF8).Replace('"' + (LE $PS.company) + '"', '"' + (LE $co1) + '"').Replace('<NAME>' + (LE $PS.company) + '</NAME>', '<NAME>' + (LE $co1) + '</NAME>')
  $k = DbImp 'All Masters' (TM $mx) 'payg masters'; $made['payg masters'] = "$($k.c) created, $($k.e) errors"
  $vx = @([regex]::Matches((Get-Content (Join-Path $pdir 'vouchers.xml') -Raw -Encoding UTF8), '(?s)<VOUCHER [^>]*>.*?</VOUCHER>') | ForEach-Object { $_.Value })
  $ok = 0; foreach ($v in $vx) { $k = DbImp 'Vouchers' (TM $v) 'payg entry'; if ($k.c -eq 1) { $ok++ } }
  $made['payg entries'] = "$ok of $($vx.Count)"
  # ---- stock journals (items in and out of the main location) and the items
  $m = '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>'
  foreach ($it in 'BD Raw A', 'BD Raw B', 'BD Finished') { $m += '<STOCKITEM NAME="' + $it + '" ACTION="Create"><NAME.LIST><NAME>' + $it + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE>100 Nos</OPENINGBALANCE><OPENINGVALUE>-1000.00</OPENINGVALUE><OPENINGRATE>10.00/Nos</OPENINGRATE></STOCKITEM>' }
  $k = DbImp 'All Masters' (TM $m) 'stock items'; $made['stock items'] = "$($k.c) created"
  $sjOk = 0
  foreach ($sj in @(@{ no = 'BD-SJ-1'; d = '20260402' }, @{ no = 'BD-SJ-2'; d = '20260702' })) {
    $inv = { param($tag, $item, $qty, $amt, $pos) '<' + $tag + '><STOCKITEMNAME>' + $item + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>' + $pos + '</ISDEEMEDPOSITIVE><RATE>10.00/Nos</RATE><AMOUNT>' + $amt + '</AMOUNT><ACTUALQTY> ' + $qty + ' Nos</ACTUALQTY><BILLEDQTY> ' + $qty + ' Nos</BILLEDQTY><BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><AMOUNT>' + $amt + '</AMOUNT><ACTUALQTY> ' + $qty + ' Nos</ACTUALQTY><BILLEDQTY> ' + $qty + ' Nos</BILLEDQTY></BATCHALLOCATIONS.LIST></' + $tag + '>' }
    $x = '<VOUCHER VCHTYPE="Stock Journal" ACTION="Create" OBJVIEW="Consumption Voucher View"><DATE>' + $sj.d + '</DATE><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $sj.no + '</VOUCHERNUMBER><PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW><NARRATION>' + $sj.no + ' stock journal by XML</NARRATION>' +
      (& $inv 'INVENTORYENTRIESOUT.LIST' 'BD Raw A' 5 '50.00' 'No') + (& $inv 'INVENTORYENTRIESOUT.LIST' 'BD Raw B' 3 '30.00' 'No') + (& $inv 'INVENTORYENTRIESIN.LIST' 'BD Finished' 8 '-80.00' 'Yes') + '</VOUCHER>'
    $k = DbImp 'Vouchers' (TM $x) "stock journal $($sj.no)"; if ($k.c -eq 1) { $sjOk++ } else { $made["stock journal $($sj.no) refused"] = $k.line }
  }
  $made['stock journals'] = "$sjOk of 2"
} catch { Info "bdiff: test data stopped: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }

# ---- every day holding entries: Tally's own list (the harness's, untimed), then the groups and the entries alone
$all = TSetup ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BDAll</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (LE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="BDAll" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 300
$ents = @(foreach ($mm in [regex]::Matches((NoInfo $all.body), '(?s)<VOUCHER[ >].*?</VOUCHER>')) { $v = $mm.Value
    [pscustomobject]@{ mid = [int64]('0' + [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value); date = [regex]::Match($v, '<DATE[^>]*>\s*(\d{8})').Groups[1].Value; type = [regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)<').Groups[1].Value } })
$byType = ($ents | Group-Object type | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', '
$tdsPay = @($made.Keys | Where-Object { $_ -like 'TDS challan payment *' -and "$($made[$_])" -like 'created 1*' }).Count
DRes $D0 $(if ($ents.Count -ge 60 -and @($ents | Where-Object { $_.type -eq 'Stock Journal' }).Count -ge 2 -and @($ents | Where-Object { $_.type -eq 'Payroll' }).Count -ge 1 -and $tdsPay -ge 1) { 'PASS' } else { 'HARNESS' }) ("{0} entries in Tally ({1}); {2}" -f $ents.Count, $byType, (($made.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join '; '))
$plan = [Collections.Generic.List[object]]::new(); $rows = [Collections.Generic.List[object]]::new()
foreach ($g in @($ents | Where-Object { $_.mid -gt 0 } | Group-Object date | Sort-Object Name)) {
  $d = $g.Name
  $heads = @($g.Group | Sort-Object mid)
  $wanted = @($heads | Where-Object { $_.type -ne 'Payroll' } | ForEach-Object { "$($_.mid)" })
  if ($wanted.Count -lt 1) { continue }
  foreach ($chunk in @(for ($i = 0; $i -lt $wanted.Count; $i += 100) { , @($wanted[$i..([math]::Min($i + 99, $wanted.Count - 1))]) })) {
    $lo = [int64]$chunk[0]; $hi = [int64]$chunk[-1]
    $run = @($heads | Where-Object { $_.mid -ge $lo -and $_.mid -le $hi }).Count -eq $chunk.Count
    $forms = @(@{ f = 'B5'; x = (WithDay $RB['b4-list'] $d).Replace('@@MIDS@@', ((@($chunk | ForEach-Object { "`$MasterID = $_" })) -join ' OR ')) })
    if ($run) { $forms += @{ f = 'B4'; x = (WithDay $RB['b4-range'] $d).Replace('111111', "$lo").Replace('222222', "$hi") } }
    foreach ($fm in $forms) {
      $r = TStop $fm.x 2000 60000
      $got = @(MidsOf $r.body)
      $exact = ($r.ok -and $got.Count -eq $chunk.Count -and @($chunk | Where-Object { $_ -notin $got }).Count -eq 0)
      $rows.Add([pscustomobject]@{ day = $d; form = $fm.f; n = $chunk.Count; ms = $r.ms; inTime = $r.inTime; ok = $r.ok; got = $got.Count; exact = $exact })
      $fn = "$($fm.f)-$d-$lo.xml"; RawSave $fn $r.body
      $plan.Add([pscustomobject]@{ phase = 'bdiff'; form = $fm.f; file = $fn; mids = @($chunk) })
      if ($r.hung) { $null = DbRestart 'bdiff-hung' }
    }
  }
  foreach ($mid in $wanted) { $r = TStop ((WithDay $RB['object'] '20991231').Replace('ID:99999', "ID:$mid")) 3000 60000; RawSave "obj-$mid.xml" $r.body }
}
$over = @($rows | Where-Object { -not $_.inTime }); $inex = @($rows | Where-Object { -not $_.exact })
DRes $D2 $(if (-not $rows.Count) { 'HARNESS' } elseif ($inex.Count -or $over.Count) { 'FAIL' } else { 'PASS' }) ("{0} group requests on {1} days ({2} entries), exact {3}; over 2 s: {4}; worst {5} ms" -f $rows.Count, @($rows | Group-Object day).Count, ($rows | Where-Object { $_.form -eq 'B5' } | Measure-Object n -Sum).Sum, @($rows | Where-Object exact).Count, $(if ($over.Count) { ($over | ForEach-Object { "$($_.form) $($_.day) $($_.ms) ms" }) -join ', ' } else { 'none' }), ($rows | Measure-Object ms -Maximum).Maximum)
try {
  [IO.File]::WriteAllText((Join-Path $raw 'diff-plan.json'), (ConvertTo-Json -InputObject @($plan.ToArray()) -Depth 6), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $bt 'rows.json'), (ConvertTo-Json -InputObject @($rows.ToArray()) -Depth 4), [Text.UTF8Encoding]::new($false))
  $z = Join-Path $bt 'raw.zip'; if (Test-Path $z) { Remove-Item $z -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($raw, $z, [IO.Compression.CompressionLevel]::Optimal, $true)
  Remove-Item $raw -Recurse -Force
} catch { Info "bdiff: raw answers not zipped ($_)" }
