# push-design (measurement only): the XML the companies are made of. Dot-sourced by pushm.ps1.
#   Light company: a few masters (a party, sales, CGST/SGST, a bank, an income ledger, two cost centres, 50 items) and the
#   three templates the saves duplicate: a Receipt (bill-wise, bank details), a Sales invoice with 5 items, one with 50.
#   Heavy company: a copy of the light one plus $PD_HEAVY_LED ledgers, $PD_HEAVY_ITEM items and up to $PD_HEAVY_VCH vouchers.
# EDU mode takes only the 1st, 2nd and 31st of a month: every date below is one of those.

function Esc([string]$s) { [Security.SecurityElement]::Escape($s) }

function LedgerXml($name, $parent, $extra = '') {
  '<LEDGER NAME="' + (Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (Esc $name) + '</NAME></NAME.LIST><PARENT>' + (Esc $parent) + '</PARENT>' + $extra + '</LEDGER>'
}
function ItemXml($name, $opening) {
  $o = if ($opening) { '<OPENINGBALANCE> 100000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-5000000.00</OPENINGVALUE>' } else { '' }
  '<STOCKITEM NAME="' + (Esc $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (Esc $name) + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS>' + $o + '</STOCKITEM>'
}

function LightMasters {
  $m = @()
  $m += '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>'
  $m += '<COSTCENTRE NAME="CC Main" ACTION="Create"><NAME.LIST><NAME>CC Main</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY></COSTCENTRE>'
  $m += '<COSTCENTRE NAME="CC Branch" ACTION="Create"><NAME.LIST><NAME>CC Branch</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY></COSTCENTRE>'
  $m += LedgerXml 'Template Party' 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON><PARTYGSTIN>07AAACT1234A1Z5</PARTYGSTIN><LEDSTATENAME>Delhi</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME><INCOMETAXNUMBER>AAACT1234A</INCOMETAXNUMBER>'
  $m += LedgerXml 'Sales' 'Sales Accounts' '<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>'
  $m += LedgerXml 'Output CGST' 'Duties & Taxes'
  $m += LedgerXml 'Output SGST' 'Duties & Taxes'
  $m += LedgerXml 'HDFC Bank' 'Bank Accounts'
  $m += LedgerXml 'Spike Income' 'Indirect Incomes' '<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>'
  $m += LedgerXml 'Spike Party' 'Sundry Debtors'
  for ($i = 1; $i -le 50; $i++) { $m += ItemXml ('Item T{0:d2}' -f $i) $true }
  return $m
}

# a Sales invoice (item invoice) with $items items of 2 Nos at 100, CGST and SGST 9 % each; $rich adds the fields the
# 2.3.1 request reads (HSN and GST rate details on each item, cost centres under the sales ledger, the e-way bill, IRN,
# reference, party GSTIN and place of supply); $rich = $false is the plain fallback if Tally refuses one of them
function SalesXml($date, $no, $party, [string[]]$items, $narr, [bool]$rich = $true) {
  $per = 200; $sub = $per * $items.Count; $tax = [math]::Round($sub * 0.09, 2); $tot = $sub + 2 * $tax
  $f = '{0:0.00}'
  $x = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>'
  $x += '<PARTYLEDGERNAME>' + (Esc $party) + '</PARTYLEDGERNAME><PARTYNAME>' + (Esc $party) + '</PARTYNAME><BASICBUYERNAME>' + (Esc $party) + '</BASICBUYERNAME>'
  if ($rich) {
    $x += '<REFERENCE>PO-' + $no + '</REFERENCE><REFERENCEDATE>' + $date + '</REFERENCEDATE><PARTYGSTIN>07AAACT1234A1Z5</PARTYGSTIN><PLACEOFSUPPLY>Delhi</PLACEOFSUPPLY><STATENAME>Delhi</STATENAME>'
    $x += '<IRN>8f1e0c6b2d7a4f0e9b3c5d1a7e2f4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a</IRN><IRNACKNO>112610000012345</IRNACKNO><IRNACKDATE>' + $date + '</IRNACKDATE>'
  }
  $x += '<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>' + (Esc $narr) + '</NARRATION>'
  if ($rich) { $x += '<EWAYBILLDETAILS.LIST><BILLNUMBER>331000123456</BILLNUMBER><BILLDATE>' + $date + '</BILLDATE></EWAYBILLDETAILS.LIST>' }
  $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + (Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-' + ($f -f $tot) + '</AMOUNT>'
  $x += '<BILLALLOCATIONS.LIST><NAME>' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD><AMOUNT>-' + ($f -f $tot) + '</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
  foreach ($t in 'Output CGST', 'Output SGST') { $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f $tax) + '</AMOUNT></LEDGERENTRIES.LIST>' }
  foreach ($it in $items) {
    $x += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + (Esc $it) + '</STOCKITEMNAME>'
    if ($rich) { $x += '<GSTHSNNAME>847130</GSTHSNNAME>' }
    $x += '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>'
    if ($rich) { foreach ($h in 'CGST', 'SGST') { $x += '<RATEDETAILS.LIST><GSTRATEDUTYHEAD>' + $h + '</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9</GSTRATE></RATEDETAILS.LIST>' } }
    $x += '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT>'
    if ($rich) { $x += '<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><COSTCENTREALLOCATIONS.LIST><NAME>CC Main</NAME><AMOUNT>200.00</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>' }
    $x += '</ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'
  }
  $x + '</VOUCHER>'
}

# a Receipt from the party into the bank: the bill it settles (Agst Ref), the bank details (cheque, instrument number,
# UTR, dates), a cost centre on an income line
function ReceiptXml($date, $no, $party, $bill, $amt, $narr, [bool]$rich = $true) {
  $f = '{0:0.00}'
  $x = '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + (Esc $narr) + '</NARRATION>'
  $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (Esc $party) + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ($f -f $amt) + '</AMOUNT>'
  $x += '<BILLALLOCATIONS.LIST><NAME>' + $bill + '</NAME><BILLTYPE>' + $(if ($rich) { 'Agst Ref' } else { 'New Ref' }) + '</BILLTYPE><AMOUNT>' + ($f -f $amt) + '</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>'
  $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ($f -f ($amt + 10)) + '</AMOUNT>'
  if ($rich) { $x += '<BANKALLOCATIONS.LIST><DATE>' + $date + '</DATE><INSTRUMENTDATE>' + $date + '</INSTRUMENTDATE><BANKERSDATE>' + $date + '</BANKERSDATE><NAME>' + $no + '</NAME><TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE><PAYMENTFAVOURING>' + (Esc $party) + '</PAYMENTFAVOURING><INSTRUMENTNUMBER>004512</INSTRUMENTNUMBER><UNIQUEREFERENCENUMBER>UTR2610010001</UNIQUEREFERENCENUMBER><AMOUNT>-' + ($f -f ($amt + 10)) + '</AMOUNT></BANKALLOCATIONS.LIST>' }
  $x += '</ALLLEDGERENTRIES.LIST>'
  $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT>'
  if ($rich) { $x += '<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><COSTCENTREALLOCATIONS.LIST><NAME>CC Branch</NAME><AMOUNT>10.00</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>' }
  $x + '</ALLLEDGERENTRIES.LIST></VOUCHER>'
}

# FinCom's posting: one Journal, as flowv.ps1's c3 sends it, on its own day (2-11-2026: no template lives there)
function PostingXml($narr) {
  '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261102</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>' + (Esc $narr) + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-250.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>250.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}

# the heavy company's dates: the 1st and 2nd of every month April - September 2026, and the 31st where it exists (the
# company's books run 1-Apr-2026 to 31-Mar-2027: Tally refused earlier dates as "Out of Range" in run 37443094212)
function HeavyDates {
  $d = @(); $m = Get-Date -Year 2026 -Month 4 -Day 1
  while ($m -lt (Get-Date -Year 2026 -Month 10 -Day 1)) {
    $d += $m.ToString('yyyyMM') + '01'; $d += $m.ToString('yyyyMM') + '02'
    if ([DateTime]::DaysInMonth($m.Year, $m.Month) -eq 31) { $d += $m.ToString('yyyyMM') + '31' }
    $m = $m.AddMonths(1)
  }
  return $d
}

function HeavyMasters($nLed, $nItem) {
  $m = @()
  $nParty = [int]($nLed * 0.9)
  for ($i = 1; $i -le $nParty; $i++) { $m += LedgerXml ('HParty {0:d5}' -f $i) 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>' }
  for ($i = 1; $i -le ($nLed - $nParty); $i++) { $m += LedgerXml ('HExpense {0:d4}' -f $i) 'Indirect Expenses' }
  for ($i = 1; $i -le $nItem; $i++) { $m += ItemXml ('HItem {0:d5}' -f $i) $false }
  return $m
}

# voucher k of the heavy company: 2 of 5 Sales invoices with 3 items, 2 of 5 Receipts, 1 of 5 Journals
function HeavyVoucher($k, $dates, $nParty, $nExp, $nItem) {
  $date = $dates[$k % $dates.Count]
  $party = 'HParty {0:d5}' -f (($k % $nParty) + 1)
  switch ($k % 5) {
    { $_ -in 0, 1 } {
      $its = @(); for ($j = 0; $j -lt 3; $j++) { $its += ('HItem {0:d5}' -f ((($k * 3 + $j) % $nItem) + 1)) }
      return SalesXml $date ('HS-{0:d6}' -f $k) $party $its "heavy sales $k" $false
    }
    { $_ -in 2, 3 } { return ReceiptXml $date ('HR-{0:d6}' -f $k) $party ('HADV-{0:d6}' -f $k) 500 "heavy receipt $k" $false }
    default {
      $exp = 'HExpense {0:d4}' -f (($k % $nExp) + 1)
      return '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + ('HJ-{0:d6}' -f $k) + '</VOUCHERNUMBER><NARRATION>heavy journal ' + $k + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $exp + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-75.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>75.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
    }
  }
}
