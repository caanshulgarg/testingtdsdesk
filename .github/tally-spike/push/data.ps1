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
  # dates only (run 37450532756: two Get-Date calls a moment apart let October in, so the heavy Day Book of 1, 2 and
  # 31 October held heavy vouchers and the measurement duplicated one of them instead of the template)
  $d = @(); $m = [DateTime]::new(2026, 4, 1)
  while ($m -lt [DateTime]::new(2026, 10, 1)) {
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

# ======================================================================================================================
# The owner's second ask (06-Oct-2026): every voucher type, with its allocations. Masters: two godowns, 50 items kept in
# batches (opening stock in two godowns x two batches), an employee group with 200 employees, two pay heads and the
# salary payable ledger, an attendance type. Templates, each on its own date (EDU mode: 1st, 2nd, 31st only):
$TypeDates = [ordered]@{
  payroll50 = '20261201'; payroll200 = '20261202'; attendance = '20261231'; stockjournal = '20270101'; mfgjournal = '20270102'
  deliverynote = '20270131'; receiptnote = '20270201'; salesorder = '20270202'; purchaseorder = '20270301'; physicalstock = '20270302'
  salesbatch = '20270331'
}
function BatchItem($i) { 'PD Bat {0:d2}' -f $i }
function Emp($i) { 'PD Emp {0:d3}' -f $i }
function TypeMasters {
  $m = @()
  foreach ($g in 'PD Godown A', 'PD Godown B') { $m += '<GODOWN NAME="' + $g + '" ACTION="Create"><NAME.LIST><NAME>' + $g + '</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>' }
  for ($i = 1; $i -le 50; $i++) {
    $n = BatchItem $i
    $x = '<STOCKITEM NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><ISBATCHWISEON>Yes</ISBATCHWISEON><HASMFGDATE>No</HASMFGDATE><ISPERISHABLEON>No</ISPERISHABLEON>'
    $x += '<OPENINGBALANCE> 4000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-200000.00</OPENINGVALUE>'
    foreach ($g in 'PD Godown A', 'PD Godown B') { foreach ($b in 'B1', 'B2') {
      $x += '<BATCHALLOCATIONS.LIST><GODOWNNAME>' + $g + '</GODOWNNAME><BATCHNAME>' + $b + '</BATCHNAME><OPENINGBALANCE> 1000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-50000.00</OPENINGVALUE></BATCHALLOCATIONS.LIST>' } }
    $m += $x + '</STOCKITEM>'
  }
  $m += '<COSTCENTRE NAME="PD Staff" ACTION="Create"><NAME.LIST><NAME>PD Staff</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>'
  for ($i = 1; $i -le 200; $i++) {
    $n = Emp $i
    $m += '<COSTCENTRE NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><PARENT>PD Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20260401</DATEOFJOIN><DESIGNATION>Clerk</DESIGNATION><EMPLOYEENUMBER>E' + $i + '</EMPLOYEENUMBER></COSTCENTRE>'
  }
  foreach ($p in 'PD Basic', 'PD HRA') {
    $m += LedgerXml $p 'Indirect Expenses' '<PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><FORPAYROLL>Yes</FORPAYROLL>'
  }
  $m += LedgerXml 'PD Salary Payable' 'Current Liabilities' '<PAYTYPE>Not Applicable</PAYTYPE>'
  $m += '<ATTENDANCETYPE NAME="PD Present" ACTION="Create"><NAME.LIST><NAME>PD Present</NAME></NAME.LIST><ATTENDANCETYPE>Attendance / Leave with Pay</ATTENDANCETYPE><ATTENDANCEPERIOD>Days</ATTENDANCEPERIOD><PARENT/></ATTENDANCETYPE>'
  $m += LedgerXml 'PD Supplier' 'Sundry Creditors' '<ISBILLWISEON>Yes</ISBILLWISEON>'
  $m += LedgerXml 'Purchase' 'Purchase Accounts'
  return $m
}
# $form: 1 the payroll view with only the payable on the ledger side; 2 the same in LEDGERENTRIES; 3 the pay heads on the
# ledger side too (probe 4, run 37479202675: form 3 under PaySlip view was refused on 3.0 as "Voucher totals do not
# match", Cr empty, and went to exceptions on 7.1)
function PayrollXml($date, $no, $n, $form = 1) {
  $f = '{0:0.00}'
  $view = if ($form -eq 3) { 'PaySlip Voucher View' } else { 'Payroll Voucher View' }
  $lst = if ($form -eq 2) { 'LEDGERENTRIES.LIST' } else { 'ALLLEDGERENTRIES.LIST' }
  $x = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="' + $view + '"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PERSISTEDVIEW>' + $view + '</PERSISTEDVIEW><NARRATION>template payroll ' + $n + ' employees</NARRATION>'
  $x += '<' + $lst + '><LEDGERNAME>PD Salary Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f (1500 * $n)) + '</AMOUNT></' + $lst + '>'
  $x += '<CATEGORYENTRY.LIST><CATEGORY>Primary Cost Category</CATEGORY>'
  for ($i = 1; $i -le $n; $i++) {
    $x += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + (Emp $i) + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + $i + '</EMPLOYEESORTORDER><AMOUNT>-1500.00</AMOUNT>'
    $x += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>PD Basic</PAYHEADNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>1</PAYHEADSORTORDER><AMOUNT>-1000.00</AMOUNT></PAYHEADALLOCATIONS.LIST>'
    $x += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>PD HRA</PAYHEADNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>2</PAYHEADSORTORDER><AMOUNT>-500.00</AMOUNT></PAYHEADALLOCATIONS.LIST>'
    $x += '</EMPLOYEEENTRIES.LIST>'
  }
  $x += '</CATEGORYENTRY.LIST>'
  if ($form -eq 3) {
    $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PD Basic</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ($f -f (1000 * $n)) + '</AMOUNT></ALLLEDGERENTRIES.LIST>'
    $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PD HRA</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ($f -f (500 * $n)) + '</AMOUNT></ALLLEDGERENTRIES.LIST>'
  }
  $x + '</VOUCHER>'
}
function AttendanceXml($date, $no, $n) {
  $x = '<VOUCHER VCHTYPE="Attendance" ACTION="Create" OBJVIEW="Attendance Voucher View"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Attendance</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PERSISTEDVIEW>Attendance Voucher View</PERSISTEDVIEW><NARRATION>template attendance</NARRATION>'
  $x += '<CATEGORYENTRY.LIST><CATEGORY>Primary Cost Category</CATEGORY>'
  for ($i = 1; $i -le $n; $i++) { $x += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + (Emp $i) + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + $i + '</EMPLOYEESORTORDER><ATTENDANCEENTRIES.LIST><NAME>PD Present</NAME><ATTENDANCETYPE>PD Present</ATTENDANCETYPE><ATTDTYPEVALUE> 26</ATTDTYPEVALUE></ATTENDANCEENTRIES.LIST></EMPLOYEEENTRIES.LIST>' }
  $x + '</CATEGORYENTRY.LIST></VOUCHER>'
}
# a batch line: godown, batch, quantity, amount, and (when given) the order and tracking numbers
function BatchLine($godown, $batch, $qty, $amt, $order = '', $track = '', $due = '') {
  $x = '<BATCHALLOCATIONS.LIST><GODOWNNAME>' + $godown + '</GODOWNNAME><BATCHNAME>' + $batch + '</BATCHNAME>'
  if ($order) { $x += '<ORDERNO>' + $order + '</ORDERNO>' }
  if ($track) { $x += '<TRACKINGNUMBER>' + $track + '</TRACKINGNUMBER>' }
  if ($due) { $x += '<ORDERDUEDATE P="' + $due + '">' + $due + '</ORDERDUEDATE>' }
  $x + '<AMOUNT>' + $amt + '</AMOUNT><ACTUALQTY> ' + $qty + ' Nos</ACTUALQTY><BILLEDQTY> ' + $qty + ' Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>'
}
# stock journal: $n items moved from godown A batch B1 to godown B batch B2 (n lines out, n lines in)
function StockJournalXml($date, $no, $n, $vtype = 'Stock Journal', $view = 'Consumption Voucher View') {
  $x = '<VOUCHER VCHTYPE="' + $vtype + '" ACTION="Create" OBJVIEW="' + $view + '"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>' + $vtype + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PERSISTEDVIEW>' + $view + '</PERSISTEDVIEW><NARRATION>template ' + $vtype.ToLower() + ' ' + $n + ' items</NARRATION>'
  for ($i = 1; $i -le $n; $i++) { $x += '<INVENTORYENTRIESOUT.LIST><STOCKITEMNAME>' + (BatchItem $i) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>50.00/Nos</RATE><AMOUNT>100.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>' + (BatchLine 'PD Godown A' 'B1' 2 '100.00') + '</INVENTORYENTRIESOUT.LIST>' }
  for ($i = 1; $i -le $n; $i++) { $x += '<INVENTORYENTRIESIN.LIST><STOCKITEMNAME>' + (BatchItem $i) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><RATE>50.00/Nos</RATE><AMOUNT>-100.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>' + (BatchLine 'PD Godown B' 'B2' 2 '-100.00') + '</INVENTORYENTRIESIN.LIST>' }
  $x + '</VOUCHER>'
}
# an item voucher with a party (Delivery Note, Receipt Note, Sales Order, Purchase Order, a Sales invoice in batches)
function ItemVchXml($vtype, $date, $no, $n, $party, $partyLedgerOut, $acct, $order = '', $track = '', $view = 'Invoice Voucher View', $form = 1) {
  if ($form -eq 2) { $order = '' }
  $f = '{0:0.00}'; $sales = $vtype -in 'Sales', 'Delivery Note', 'Sales Order'
  $sign = if ($sales) { '' } else { '-' }; $psign = if ($sales) { '-' } else { '' }
  $tot = 200 * $n
  $x = '<VOUCHER VCHTYPE="' + $vtype + '" ACTION="Create" OBJVIEW="' + $view + '"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>' + $vtype + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + $party + '</PARTYLEDGERNAME><PARTYNAME>' + $party + '</PARTYNAME><BASICBUYERNAME>' + $party + '</BASICBUYERNAME><PERSISTEDVIEW>' + $view + '</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>template ' + $vtype.ToLower() + ' ' + $n + ' items</NARRATION>'
  if ($order) { $x += '<INVOICEORDERLIST.LIST><BASICORDERDATE>' + $date + '</BASICORDERDATE><BASICPURCHASEORDERNO>' + $order + '</BASICPURCHASEORDERNO></INVOICEORDERLIST.LIST>' }
  $x += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $party + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $(if ($sales) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + $psign + ($f -f $tot) + '</AMOUNT></LEDGERENTRIES.LIST>'
  for ($i = 1; $i -le $n; $i++) {
    $g = if ($i % 2) { 'PD Godown A' } else { 'PD Godown B' }; $b = if ($i % 4 -lt 2) { 'B1' } else { 'B2' }
    $x += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + (BatchItem $i) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>' + $(if ($sales) { 'No' } else { 'Yes' }) + '</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>' + $sign + '200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>'
    $x += BatchLine $g $b 2 ($sign + '200.00') $order $track $(if ($order) { $date })
    $x += '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>' + $acct + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $(if ($sales) { 'No' } else { 'Yes' }) + '</ISDEEMEDPOSITIVE><AMOUNT>' + $sign + '200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'
  }
  $x + '</VOUCHER>'
}
function PhysicalStockXml($date, $no, $n) {
  $x = '<VOUCHER VCHTYPE="Physical Stock" ACTION="Create" OBJVIEW="Consumption Voucher View"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Physical Stock</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW><NARRATION>template physical stock</NARRATION>'
  for ($i = 1; $i -le $n; $i++) { $x += '<INVENTORYENTRIESIN.LIST><STOCKITEMNAME>' + (BatchItem $i) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ACTUALQTY> 990 Nos</ACTUALQTY><BILLEDQTY> 990 Nos</BILLEDQTY>' + (BatchLine 'PD Godown A' 'B1' 990 '0.00') + '</INVENTORYENTRIESIN.LIST>' }
  $x + '</VOUCHER>'
}
# every template: kind -> XML (the order is the import order: orders before the notes that follow them)
function TypeTemplates {
  $d = $TypeDates
  [ordered]@{
    payroll50     = @((PayrollXml $d.payroll50 'PR-50' 50 1), (PayrollXml $d.payroll50 'PR-50' 50 2), (PayrollXml $d.payroll50 'PR-50' 50 3))
    payroll200    = @((PayrollXml $d.payroll200 'PR-200' 200 1), (PayrollXml $d.payroll200 'PR-200' 200 2), (PayrollXml $d.payroll200 'PR-200' 200 3))
    attendance    = AttendanceXml $d.attendance 'AT-1' 50
    stockjournal  = StockJournalXml $d.stockjournal 'SJ-50' 50
    mfgjournal    = StockJournalXml $d.mfgjournal 'MJ-1' 5 'PD Manufacturing Journal'
    salesorder    = @((ItemVchXml 'Sales Order' $d.salesorder 'SO-1' 5 'Template Party' $true 'Sales' 'SO-1'), (ItemVchXml 'Sales Order' $d.salesorder 'SO-1' 5 'Template Party' $true 'Sales' 'SO-1' '' 'Invoice Voucher View' 2))
    purchaseorder = @((ItemVchXml 'Purchase Order' $d.purchaseorder 'PO-1' 5 'PD Supplier' $false 'Purchase' 'PO-1'), (ItemVchXml 'Purchase Order' $d.purchaseorder 'PO-1' 5 'PD Supplier' $false 'Purchase' 'PO-1' '' 'Invoice Voucher View' 2))
    deliverynote  = ItemVchXml 'Delivery Note' $d.deliverynote 'DN-1' 5 'Template Party' $true 'Sales' 'SO-1' 'DN-1'
    receiptnote   = ItemVchXml 'Receipt Note' $d.receiptnote 'RN-1' 5 'PD Supplier' $false 'Purchase' 'PO-1' 'RN-1'
    physicalstock = PhysicalStockXml $d.physicalstock 'PS-1' 5
    salesbatch    = ItemVchXml 'Sales' $d.salesbatch 'SB-50' 50 'Template Party' $true 'Sales'
  }
}
