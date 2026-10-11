# Mode gsttype (bridge 2.4.2, round 44 part B: the owner's approval of 11-Oct-2026, "send each entry's GST type"; TEST DATA
# ONLY: a throwaway company in this runner's own Tally). Dot-sourced by flowv.ps1 after c2; no bridge is installed.
# What Tally stores for an entry's GST type, as the bridge's own entry request (FinComVoucherObject, the request XML the
# gate's ref builds: requests/entry-object.xml, unchanged in shape) gets it back, on every release:
#   1. the round-43 company (tdsgst/masters.json: GST and TDS on, the ledgers and parties) and its GST entries
#      (tdsgst/vouchers-p1.json: B2B, SEZ with and without payment, exports with and without payment, B2C, nil-rated,
#      exempt, credit and debit notes, reverse charge, blocked credit, exempt inward supply)
#   2. the blocked credit (17(5)) set as a user sets it, and what Tally keeps of each way (round 43: Tally 7.1 dropped
#      the voucher-level mark given by XML):
#        L  the ledger's own GST details "Ineligible for input credit" (GSTDETAILS.LIST GSTINELIGIBLEITC Yes, the field the
#           ledger screen sets: masters-p1.xml of run 38072484999 shows it there, kept No), then a purchase with no override
#        V1 the ledger line's override GSTOVRDNINELIGIBLEITC "Applicable" (the voucher's GST override on the line)
#        V2 the same, "&#4; Applicable" (Tally's own form of the value)
#   3. an item invoice (a stock item, its accounting allocation) to the SEZ party under LUT: where the item lines keep it
#   4. each entry asked by its MasterID with the ref's FinComVoucherObject request exactly (company and MasterID put in),
#      the raw answer kept (captures/obj-<id>.xml) and timed; the month's Voucher collection with every field beside it
#      (captures/coll-all.xml) and the masters (captures/masters.xml)
# The tags are judged on Linux from the captures (which tag carries which GST type, on which release); here only:
# x1 the entries made, x2 every entry's object answer captured and its time, x3 the blocked credit as Tally kept it.
$xdir = Join-Path $PSScriptRoot 'tdsgst'
$TX1 = 'x1 the GST entries made in Tally'; $TX2 = 'x2 the entry request answered for every entry (raw kept, timed)'; $TX3 = 'x3 the blocked credit as Tally keeps it'
function XCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; return [pscustomobject]@{ c = 0; a = 0; e = -1; line = ("$r" -replace '\s+', ' ').Substring(0, [Math]::Min(300, ("$r" -replace '\s+', ' ').Length)) } }
function XSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
$xDone = @{}
function XRes($c, $st, $ev) { if (-not $xDone[$c]) { Result $c $st $ev; $xDone[$c] = $true } }
try {
  Say '---- gsttype: masters'
  $M = Get-Content (Join-Path $xdir 'masters.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in $M.steps) { $k = XCount (Imp 'All Masters' $s[1] "gsttype $($s[0])"); Info "gsttype masters $($s[0]): created $($k.c), altered $($k.a), errors $($k.e)$(if ($k.line) { "; Tally said: $($k.line)" })" }
  # L: the ledger's own "ineligible for input credit", in its GST details (where the ledger screen keeps it)
  $car = '<LEDGER NAME="Motor Car Blocked" ACTION="Create"><NAME.LIST><NAME>Motor Car Blocked</NAME></NAME.LIST><PARENT>Fixed Assets</PARENT><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY><AFFECTSSTOCK>No</AFFECTSSTOCK><GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>8703</HSNCODE><TAXABILITY>Taxable</TAXABILITY><GSTINELIGIBLEITC>Yes</GSTINELIGIBLEITC><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>14</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>14</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>28</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></LEDGER>'
  $k = XCount (Imp 'All Masters' $car 'gsttype ledger Motor Car Blocked'); Info "gsttype ledger Motor Car Blocked (GSTDETAILS.LIST GSTINELIGIBLEITC Yes): created $($k.c), errors $($k.e) $($k.line)"
  # the item invoice's masters: a unit and a stock item with its GST details
  $itm = '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT><STOCKITEM NAME="Laptop" ACTION="Create"><NAME.LIST><NAME>Laptop</NAME></NAME.LIST><PARENT/><BASEUNITS>Nos</BASEUNITS><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY><GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>8471</HSNCODE><TAXABILITY>Taxable</TAXABILITY><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></STOCKITEM>'
  $k = XCount (Imp 'All Masters' $itm 'gsttype unit and stock item'); Info "gsttype unit Nos and stock item Laptop: created $($k.c), errors $($k.e) $($k.line)"

  Say '---- gsttype: the GST entries'
  $V1 = Get-Content (Join-Path $xdir 'vouchers-p1.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $gstIds = 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S15', 'CN1', 'CN2', 'DN1', 'P01', 'P02', 'P03', 'P04', 'P05', 'DN2'
  $list = @(); foreach ($v in $V1.vouchers) { if ($gstIds -contains $v.id) { $list += [pscustomobject]@{ id = $v.id; xml = $v.xml } } }
  $p04 = ($V1.vouchers | Where-Object { $_.id -eq 'P04' })[0].xml -replace '<GSTOVRDNINELIGIBLEITC>[^<]*</GSTOVRDNINELIGIBLEITC>', ''
  # L: the ledger ineligible, no override on the entry
  $list += [pscustomobject]@{ id = 'P04L'; xml = (($p04 -replace 'P04 motor car', 'P04L motor car, ledger ineligible') -replace '<LEDGERNAME>Motor Car</LEDGERNAME>', '<LEDGERNAME>Motor Car Blocked</LEDGERNAME>' -replace 'PUR/004', 'PUR/004L') }
  # V1 / V2: the line's own override
  foreach ($vv in @(@('P04V1', 'Applicable'), @('P04V2', '&#4; Applicable'))) {
    $x = ($p04 -replace 'P04 motor car', "$($vv[0]) motor car, line override") -replace 'PUR/004', "PUR/$($vv[0])"
    $x = $x -replace '(<LEDGERNAME>Motor Car</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-500000.00</AMOUNT>)', ('$1<GSTOVRDNINELIGIBLEITC>' + $vv[1] + '</GSTOVRDNINELIGIBLEITC>')
    $list += [pscustomobject]@{ id = $vv[0]; xml = $x }
  }
  # the item invoices (as push/data.ps1 makes them, the form every release took): I01 to the SEZ party under LUT with the
  # nature given on the item and on its accounting allocation; I02 the same with no nature given (what Tally works out)
  $null = Imp 'All Masters' '<LEDGER NAME="Sales Items" ACTION="Create"><NAME.LIST><NAME>Sales Items</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><AFFECTSSTOCK>Yes</AFFECTSSTOCK></LEDGER>' 'gsttype ledger Sales Items'
  foreach ($iv in @(@('I01', $true), @('I02', $false))) {
    $ov = if ($iv[1]) { '<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY><GSTOVRDNNATURE>Sales to SEZ - LUT/Bond</GSTOVRDNNATURE>' } else { '' }
    $x = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>20260503</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>FC/26-27/' + $iv[0] + '</VOUCHERNUMBER>' +
      '<PARTYLEDGERNAME>Gamma SEZ Unit</PARTYLEDGERNAME><PARTYNAME>Gamma SEZ Unit</PARTYNAME><BASICBUYERNAME>Gamma SEZ Unit</BASICBUYERNAME><PARTYGSTIN>29AABCG3333C1Z1</PARTYGSTIN><PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY><STATENAME>Karnataka</STATENAME>' +
      '<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>' + $iv[0] + ' item invoice, SEZ under LUT</NARRATION>' +
      '<LEDGERENTRIES.LIST><LEDGERNAME>Gamma SEZ Unit</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-400.00</AMOUNT></LEDGERENTRIES.LIST>' +
      '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Laptop</STOCKITEMNAME><GSTHSNNAME>8471</GSTHSNNAME>' + $ov + '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>200.00/Nos</RATE><AMOUNT>400.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>' +
      '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales Items</LEDGERNAME>' + $ov + '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>'
    $list += [pscustomobject]@{ id = $iv[0]; xml = $x }
  }
  $made = @(); $bad = @()
  foreach ($v in $list) { $k = XCount (Imp 'Vouchers' $v.xml "gsttype $($v.id)"); if ($k.c -eq 1) { $made += $v.id } else { $bad += "$($v.id) (created $($k.c), errors $($k.e): $($k.line))" } }
  XRes $TX1 $(if ($made.Count -eq $list.Count) { 'PASS' } else { 'HARNESS' }) ("{0} of {1} entries made by XML; refused: {2}" -f $made.Count, $list.Count, $(if ($bad.Count) { $bad -join '; ' } else { 'none' }))

  Say '---- gsttype: the entry request for each entry'
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>XgV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="XgV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, VOUCHERNUMBER, NARRATION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60
  $all = @(); try { $d = [xml]($x -replace '&#4;', ''); foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $n = Val $v.NARRATION; $all += [pscustomobject]@{ id = ($n -split ' ', 2)[0]; mid = (Val $v.MASTERID); guid = Val $v.GUID } } } catch { XSave 'vouchers-unparsed.xml' $x }
  $all | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'tally-vouchers.json') -Encoding UTF8
  $reqFile = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  $tmpl = if (Test-Path $reqFile) { Get-Content $reqFile -Raw } else { '' }
  if ($tmpl) { Info "gsttype: the entry request of the ref (requests/entry-object.xml, SHA-256 $((Get-FileHash $reqFile -Algorithm SHA256).Hash.ToLower()), $($tmpl.Length) characters)" }
  $times = @(); $miss = @()
  # the bridge sends FinComVoucherObject only right after TDSDeskCompanies names the company (Tally 3.0 .. 7.1 crash on an
  # object export naming a company that is not open): the company list first, as the bridge does
  foreach ($id in $made) {
    $e = @($all | Where-Object { $_.id -eq $id })[0]
    if (-not $tmpl -or -not $e -or -not $e.mid) { $miss += "$id (no MasterID or no request)"; continue }
    $null = Post $listCoXml ''
    $q = $tmpl.Replace('FinCom Spike Co', $co1).Replace('ID:99999<', "ID:$($e.mid)<")
    $best = $null
    foreach ($try in 1..3) { $a = Post $q '' 30; $ms = $script:lastMs; if ($null -eq $best -or $ms -lt $best) { $best = $ms }; if ($try -eq 1) { XSave "obj-$id.xml" $a; $first = $ms; $ok = "$a" -match '<VOUCHER ' } }
    $times += [pscustomobject]@{ id = $id; mid = $e.mid; first = $first; best = $best; ok = $ok; bytes = "$a".Length }
    if (-not $ok) { $miss += "$id (no voucher in the answer)" }
  }
  $times | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'obj-times.json') -Encoding UTF8
  $mx = ($times | Measure-Object -Property first -Maximum).Maximum; $md = @($times | Sort-Object first)[[int][math]::Floor($times.Count / 2)].first
  XRes $TX2 $(if (-not $times.Count) { 'HARNESS' } elseif (-not $miss.Count) { 'PASS' } else { 'FAIL' }) ("{0} entries asked one by one with the ref's FinComVoucherObject (MasterID put in): answered with the voucher {1}; first ask median {2} ms, worst {3} ms (under 2,000 ms: {4}); per entry: {5}; not answered: {6}" -f $times.Count, @($times | Where-Object { $_.ok }).Count, $md, $mx, ($mx -lt 2000), (($times | ForEach-Object { "$($_.id) $($_.first)ms" }) -join ', '), $(if ($miss.Count) { $miss -join '; ' } else { 'none' }))
  # every stored field of every entry (as the Day Book export carries them) and the masters, beside the object answers
  $fl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.RATEDETAILS.*, LEDGERENTRIES.*, ALLINVENTORYENTRIES.*, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.*'
  XSave 'coll-all.xml' (Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>XgD</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260531</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="XgD" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fl + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'gsttype collection' 300)
  $mxml = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 'gsttype masters' 300
  XSave 'masters.xml' $mxml
  # x3: what Tally kept of the blocked credit, each way
  $blk = @()
  $lm = [regex]::Match("$mxml", '(?s)<LEDGER NAME="Motor Car Blocked".*?</LEDGER>').Value
  $blk += "ledger Motor Car Blocked: GSTINELIGIBLEITC=$(([regex]::Matches($lm, '<GSTINELIGIBLEITC[^>]*>([^<]*)<') | ForEach-Object { $_.Groups[1].Value }) -join '/')"
  foreach ($id in 'P04', 'P04L', 'P04V1', 'P04V2') {
    $f = Join-Path $cap "obj-$id.xml"; $t = if (Test-Path $f) { Get-Content $f -Raw } else { '' }
    $tags = ([regex]::Matches($t, '<(GSTOVRDNINELIGIBLEITC|ISELIGIBLEFORITC|GSTINELIGIBLEITC|VCHGSTCLASS)[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" } | Select-Object -Unique) -join ', '
    $blk += "${id}: $tags"
  }
  $kept = ($blk -join ' | ') -match 'GSTINELIGIBLEITC=Yes|GSTOVRDNINELIGIBLEITC=(?!&#4; Not)[^,|]*Applicable'
  XRes $TX3 $(if ($kept) { 'PASS' } else { 'FAIL' }) ($blk -join ' | ')
} catch {
  Write-Host "gsttype stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($TX1, $TX2, $TX3)) { XRes $c 'HARNESS' "the harness stopped: $_" }
}
