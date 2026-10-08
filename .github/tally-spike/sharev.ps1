# The full-entry line against Tally's stored entry, per kind of entry, typed on Tally's own screens as a user would
# (branch next-push's add-on loaded; no bridge). Dot-sourced by flowv.ps1 in mode "share" after c1-c2 (Tally started with
# the ref's FinComRecorder.tdl, the company open). MEASUREMENT ONLY: the owner's question of 08-Oct-2026 (the full line is
# the voucher FORM at Form Accept; Tally sets the party of a non-invoice entry made new and turns an Alt+2 copy's
# "New Ref" into "Agst Ref" as it stores the entry): for each kind, does the line's party and every bill field match what
# Tally stored?
#   receipt (Agst Ref against a bill; and one with no party), payment (Agst Ref; and one to an expense), contra, journal
#   with a party (New Ref) and without, sales and purchase item invoices with a New Ref bill and with an Agst Ref bill,
#   a credit note (Agst Ref), Alt+2 copies (the New Ref invoice, the journal with a party, the receipt with no party),
#   alterations (the receipt with no party: its amount; the receipt with a bill: saved again as it is)
# Each case: keys with a screen read (tdslib.ps1: every key a screenshot read by Windows' OCR), the entry Tally made or
# altered found by its own list, then kept for the comparison (done offline from these captures):
#   captures/share-<case>.stored.xml  Tally's stored entry (a Voucher collection by MasterID: the party, every ledger line
#                                      with its bills)
#   captures/share-<case>.lines.txt   the add-on's lines for that MasterID written during the case
#   captures/share-ledgers.xml        the ledgers with their groups (for a party derived from the ledger lines)
#   captures/share-summary.json       per case: what was typed, the MasterID, made by keys or not
# A case whose keys made no entry is HARNESS (never compared).
Say '---- share: the full line against the stored entry, per kind, typed on the screen'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x }
$script:TdsCo = $co1
$script:TdsRestart = {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'share-restarted'
}
$shareDate = '2-10-2026'

# ---- masters and the bills to settle, by XML (1-10-2026; Educational mode takes the 1st, 2nd and 31st only)
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }
function SLed($n, $p, $x = '') { '<LEDGER NAME="' + (SE $n) + '" ACTION="Create"><NAME.LIST><NAME>' + (SE $n) + '</NAME></NAME.LIST><PARENT>' + (SE $p) + '</PARENT>' + $x + '</LEDGER>' }
$bw = '<ISBILLWISEON>Yes</ISBILLWISEON>'
$ms = '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>' +
  (SLed 'Spike Income' 'Indirect Incomes') + (SLed 'Share Party' 'Sundry Debtors' $bw) + (SLed 'Share Supplier' 'Sundry Creditors' $bw) +
  (SLed 'Share Bank' 'Bank Accounts') + (SLed 'Share Sales' 'Sales Accounts') + (SLed 'Share Purchase' 'Purchase Accounts') + (SLed 'Share Expense' 'Indirect Expenses') +
  '<STOCKITEM NAME="Share Item" ACTION="Create"><NAME.LIST><NAME>Share Item</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE> 100 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-5000.00</OPENINGVALUE></STOCKITEM>'
$mr = Imp 'All Masters' $ms 'share masters'
Info "share masters: $(([regex]::Match("$mr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
function SBillJ($no, $narr, $l1, $a1, $bill, $l2) {
  # a journal of 1-10-2026: $l1 with the bill (New Ref $bill), $a1 its signed amount (below 0: debit), $l2 the other side
  $f = '{0:0.00}'; $dp1 = if ($a1 -lt 0) { 'Yes' } else { 'No' }; $dp2 = if ($a1 -lt 0) { 'No' } else { 'Yes' }
  '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + $narr + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (SE $l1) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $dp1 + '</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f $a1) + '</AMOUNT><BILLALLOCATIONS.LIST><NAME>' + $bill + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>' + ($f -f $a1) + '</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (SE $l2) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $dp2 + '</ISDEEMEDPOSITIVE><AMOUNT>' + ($f -f (-$a1)) + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$br = Imp 'Vouchers' ((SBillJ 'SH-O1' 'share open SB-1' 'Share Party' -5000 'SB-1' 'Spike Income') + (SBillJ 'SH-O2' 'share open PB-1' 'Share Supplier' 4000 'PB-1' 'Share Expense') +
  (SBillJ 'SH-O3' 'share open ADVS-1' 'Share Party' 1000 'ADVS-1' 'Cash') + (SBillJ 'SH-O4' 'share open ADVP-1' 'Share Supplier' -1000 'ADVP-1' 'Cash')) 'share bills'
Info "share bills to settle (SB-1, PB-1, ADVS-1, ADVP-1): $(([regex]::Match("$br", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"

# payroll (push-design data.ps1's form 5, the payroll form Tally takes by XML: the pay heads as ledger lines allocated to
# each employee as cost centres, the payable credited), five employees, 1-10-2026; cost centres on for the company
$pm = '<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY>'
$null = Imp 'All Masters' $pm 'share company cost centres'
$pm = '<COSTCENTRE NAME="Share Staff" ACTION="Create"><NAME.LIST><NAME>Share Staff</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>'
for ($i = 1; $i -le 5; $i++) { $pm += '<COSTCENTRE NAME="Share Emp ' + $i + '" ACTION="Create"><NAME.LIST><NAME>Share Emp ' + $i + '</NAME></NAME.LIST><PARENT>Share Staff</PARENT><CATEGORY>Primary Cost Category</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20260401</DATEOFJOIN></COSTCENTRE>' }
foreach ($ph in 'Share Basic', 'Share HRA') { $pm += SLed $ph 'Indirect Expenses' '<PAYTYPE>Earnings for Employees</PAYTYPE><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><FORPAYROLL>Yes</FORPAYROLL>' }
$pm += SLed 'Share Salary Payable' 'Current Liabilities' '<PAYTYPE>Not Applicable</PAYTYPE>'
$pr = Imp 'All Masters' $pm 'share payroll masters'
$px = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261001</DATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>SH-PR1</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>share payroll template</NARRATION>'
foreach ($ph in @(@('Share Basic', 1000), @('Share HRA', 500))) {
  $px += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $ph[0] + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ('{0:0.00}' -f ($ph[1] * 5)) + '</AMOUNT><CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>'
  for ($i = 1; $i -le 5; $i++) { $px += '<COSTCENTREALLOCATIONS.LIST><NAME>Share Emp ' + $i + '</NAME><AMOUNT>-' + ('{0:0.00}' -f $ph[1]) + '</AMOUNT></COSTCENTREALLOCATIONS.LIST>' }
  $px += '</CATEGORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>'
}
$px += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Salary Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>7500.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
$prv = Imp 'Vouchers' $px 'share payroll template'
Info "share payroll masters and template: $(([regex]::Match("$pr", '<CREATED>\d+</CREATED>').Value)) / $(([regex]::Match("$prv", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"

# ---- the screens
# a bill-wise screen, if it is up: the bill typed ($bill = @(type, name)) or Tally's own default taken (Ctrl+A)
function ShareBills($bill, $tag) {
  for ($j = 1; $j -le 4; $j++) {
    $t = TdsScreen "$tag-bills$j"
    if ($t -notmatch 'Bill-wise|Bill wise|Type of Ref') { return }
    if ($bill -and $j -eq 1) {
      $null = TK ((SK $bill[0]) + '{ENTER}') 2 "$tag-reftype"
      $null = TK ((SK $bill[1]) + '{ENTER}') 2 "$tag-refname"
      if ($bill[0] -eq 'New Ref') { $null = TK '{ENTER}' 1.5 "$tag-due" }
      $null = TK '{ENTER}' 2 "$tag-refamount"
      continue
    }
    $null = TK '^a' 2 "$tag-bills-accept"
  }
}
# other sub-screens an entry may open (cost centres, bank details, dispatch / party details): taken as Tally offers them
function ShareSubs($tag) {
  for ($j = 1; $j -le 4; $j++) {
    $t = TdsScreen "$tag-sub$j"
    if ($t -match 'Bill-wise|Bill wise|Type of Ref') { return }
    if ($t -match 'Cost Centre|Cost Category|Bank Allocation|Bank Details|Transaction Type|Dispatch|Receipt Details|Party Details|Supplier Details|Buyer') { $null = TK '^a' 2 "$tag-sub-accept"; continue }
    return
  }
}
# an entry from the Gateway: its type ($keys), the date, the Account (single-entry receipt / payment / contra) and its
# rows @(ledger, amount or '' for Tally's own, bill @(type, name) or $null), the narration, Ctrl+A (and "Yes" if asked)
function ShareEntry($tag, [string[]]$keys, $typeWords, $account, $rows, $narr, [switch]$byTo) {
  $null = TdsGateway "before $tag"
  # (run 37725649024, 3.0: a blank creation form left by the save before stayed up and "v" went into its fields; the type
  # keys switch from inside a creation form)
  $t0s = TdsScreen "$tag-start"
  if ($t0s -notmatch 'cher Creati') { if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher|ucher')) { return } }
  foreach ($k in $keys) { $null = TK $k 2.5 "$tag-type" }
  $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'
  $null = TK ((SK $shareDate) + '{ENTER}') 2 "$tag-date"
  if ($account) { $null = TK ((SK $account) + '{ENTER}') 2 "$tag-account"; ShareSubs "$tag-acc" }
  $r = 0
  foreach ($row in $rows) {
    $r++
    # a journal-style row after the first starts in its By / To field (run 37719717293: the ledger's first letters went
    # there and Tally took the wrong side and ledger): To, then the ledger
    if ($byTo -and $r -gt 1) { $null = TK 'To{ENTER}' 1.5 "$tag-row$r-to" }
    $null = TK ((SK $row[0]) + '{ENTER}') 2 "$tag-row$r"
    ShareSubs "$tag-row$r-a"
    if ($row[1]) { $null = TK ((SK "$($row[1])") + '{ENTER}') 2 "$tag-row$r-amt" } else { $null = TK '{ENTER}' 2 "$tag-row$r-amt" }
    ShareBills $row[2] "$tag-row$r"
    ShareSubs "$tag-row$r-b"
  }
  if ($byTo) {
    # (run 37725649024: in As Voucher mode the next row's ledger list was open and Ctrl+A there opened Ledger Creation)
    $t = TdsScreen "$tag-last-row"; if ($t -match 'List of Ledger') { $null = TK '{ESC}' 1.5 "$tag-list-closed" }
    ShareAccept $tag $null; return
  }   # (run 37722273938: As Voucher's empty row Enter opened Ledger Creation)
  $null = TK '{ENTER}' 2 "$tag-rows-done"
  # (run 37719717293: a contra's Bank Allocations came up here and took the narration)
  ShareSubs "$tag-done"
  $null = TK ((SK $narr) + '{ENTER}') 2 "$tag-narr"
  ShareAccept $tag $null
}
# Ctrl+A until Tally takes it (a bill-wise screen at the save gets $bill, else its default), "Yes" when asked
function ShareAccept($tag, $bill) {
  for ($a = 1; $a -le 3; $a++) {
    $null = TK '^a' 3 "$tag-accept$a"
    $t = TdsScreen "$tag-after$a"
    if ($t -match 'Bill-wise|Bill wise|Type of Ref') { ShareBills $bill "$tag-at$a"; continue }
    if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }
    if ($t -match 'Dispatch|Receipt Details|Party Details|Supplier Details|Bank Allocation') { continue }
    # (run 37722273938: a contra's late Bank Allocations took the first Ctrl+A; the form was still up)
    if ($t -match 'Voucher Creati|Voucher Alterati|ccounting Voucher') { continue }
    break
  }
  $null = TdsGateway "after $tag"
}
# an item invoice (Ctrl+H: Item Invoice) as check 8 of tally-real types it: the party, the details screens, the sales or
# purchase ledger, one item row, Ctrl+A with the bill
function ShareInvoice($tag, [string[]]$keys, $party, $ledger, $head, $qty, $rate, $bill, $narr) {
  $null = TdsGateway "before $tag"
  # (run 37725649024, 3.0: a blank creation form left by the save before stayed up and "v" went into its fields; the type
  # keys switch from inside a creation form)
  $t0s = TdsScreen "$tag-start"
  if ($t0s -notmatch 'cher Creati') { if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher|ucher')) { return } }
  foreach ($k in $keys) { $null = TK $k 2.5 "$tag-type" }
  $null = TK '^h' 2 "$tag-mode" 'Mode|Invoice|Voucher'
  $null = TK 'Item Invoice{ENTER}' 2 "$tag-item-mode"
  $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'
  $null = TK ((SK $shareDate) + '{ENTER}') 2 "$tag-date"
  foreach ($h in $head) { $null = TK $h 1.5 "$tag-head" }
  $null = TK ((SK $party) + '{ENTER}') 2.5 "$tag-party"
  ShareSubs "$tag-party"
  $null = TK ((SK $ledger) + '{ENTER}') 2 "$tag-ledger"
  $null = TK 'Share Item{ENTER}' 2 "$tag-item"
  ShareSubs "$tag-item"
  $null = TK "$qty{ENTER}" 1.5 "$tag-qty"; $null = TK "$rate{ENTER}" 1.5 "$tag-rate"; $null = TK '{ENTER}' 1.5 "$tag-amount"
  ShareSubs "$tag-item-b"
  $null = TK '{ENTER}' 1.5 "$tag-items-done"
  ShareAccept $tag $bill
}
# the Day Book of the share date, one type only, its last entry (Alt+2 copies it; Enter opens it)
function ShareDayBookLast($tag, $type, $date = $shareDate) {
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Day Book' 1.5; $null = TK '{ENTER}' 3 "$tag-daybook" 'Day Book'
  $null = TK '{F2}' 1.5 "$tag-db-date"; $null = TK ((SK $date) + '{ENTER}') 3 "$tag-db-dated"
  if ($type) { $null = TK '{F4}' 2 "$tag-db-type"; $null = TK ((SK $type) + '{ENTER}') 3 "$tag-db-typed" }
  $null = TK '{END}' 1.5 "$tag-db-last"
}

# ---- the cases
$recLines = { @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' }) }
$summary = @()
function ShareStored($mid) {
  Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareStored</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareStored" ISMODIFY="No"><TYPE>Voucher</TYPE>' +
    '<FETCH>GUID, MASTERID, ALTERID, VOUCHERTYPENAME, VOUCHERNUMBER, DATE, PARTYLEDGERNAME, ISINVOICE, PERSISTEDVIEW, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.ISPARTYLEDGER, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD, ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER, LEDGERENTRIES.LEDGERNAME, LEDGERENTRIES.ISPARTYLEDGER, LEDGERENTRIES.AMOUNT, LEDGERENTRIES.BILLALLOCATIONS.NAME, LEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, LEDGERENTRIES.BILLALLOCATIONS.AMOUNT, LEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD</FETCH>' +
    '<FILTERS>ShareF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="ShareF">$MasterID = ' + [int64]$mid + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
}
# one case: $do types it; $alterOf: the MasterID it alters (else a new entry is looked for)
function ShareCase($id, $what, [scriptblock]$do, $alterOf = $null) {
  Say "---- share ${id}: $what"
  $pre = Vouchers; $l0 = (& $recLines).Count; $t0 = Get-Date
  try { & $do } catch { Write-Host "share $id keys: $_" }
  Start-Sleep 3
  $post = Vouchers
  $v = if ($alterOf) { $was = @($pre | Where-Object mid -eq $alterOf)[0]; $now = @($post | Where-Object mid -eq $alterOf)[0]; if ($was -and $now -and $now.aid -gt $was.aid) { $now } else { $null } }
       else { @($post | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0] }
  $new = @(& $recLines | Select-Object -Skip $l0)
  $mine = if ($v) { @($new | Where-Object { $_ -match "\|mid=$($v.mid)\|" }) } else { @() }
  $o = [ordered]@{ case = $id; what = $what; made = [bool]$v; mid = $(if ($v) { $v.mid } else { $null }); type = $(if ($v) { $v.type } else { '' }); vno = $(if ($v) { $v.vno } else { '' }); sec = [math]::Round(((Get-Date) - $t0).TotalSeconds); lines = @($mine | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) }
  if ($v) {
    $sx = ShareStored $v.mid
    Set-Content (Join-Path $cap "share-$id.stored.xml") $sx -Encoding UTF8
    Set-Content (Join-Path $cap "share-$id.lines.txt") $mine -Encoding UTF8
    $party = [System.Net.WebUtility]::HtmlDecode([regex]::Match("$sx", '<PARTYLEDGERNAME[^>]*>([^<]*)<').Groups[1].Value)
    $bills = (@([regex]::Matches("$sx", '<BILLTYPE[^>]*>([^<]*)<') | ForEach-Object { $_.Groups[1].Value }) -join ',')
    $full = @($mine | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' })
    $lp = if ($full.Count) { [regex]::Match($full[0], '\|part=1\|.*?\|party=([^|]*)\|').Groups[1].Value } else { '(no full line)' }
    $lb = (@($full | ForEach-Object { [regex]::Matches($_, '\|L\d+B\d+=name=[^~|]*~type=([^~|]*)') | ForEach-Object { $_.Groups[1].Value } }) | Where-Object { $_ }) -join ','
    Info ("share {0} ({1}): Tally {2} {3} mid {4}; stored party '{5}' bills [{6}]; the line party '{7}' bills [{8}]; lines {9}" -f $id, $what, $v.type, $v.vno, $v.mid, $party, $bills, $lp, $lb, (($o.lines | Group-Object | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '))
  } else {
    Add-Content -Path $resultsFile -Value "HARNESS share ${id}: the keys made no entry ($what); see the tds-*-$id-* screenshots" -Encoding UTF8
  }
  $script:summary += [pscustomobject]$o
  return $v
}

$R2 = $null; $R1 = $null; $S1 = $null
$R1 = ShareCase 'receipt-agst' 'receipt from a party against its bill (Agst Ref SB-1)' { ShareEntry 'R1' @('{F6}') 'Receipt' 'Cash' @(, @('Share Party', '500', @('Agst Ref', 'SB-1'))) 'share receipt agst' }
$R2 = ShareCase 'receipt-plain' 'receipt with no party (Cash / Spike Income)' { ShareEntry 'R2' @('{F6}') 'Receipt' 'Cash' @(, @('Spike Income', '700', $null)) 'share receipt plain' }
$null = ShareCase 'payment-agst' 'payment to a supplier against its bill (Agst Ref PB-1)' { ShareEntry 'P1' @('{F5}') 'Payment' 'Cash' @(, @('Share Supplier', '400', @('Agst Ref', 'PB-1'))) 'share payment agst' }
$null = ShareCase 'payment-expense' 'payment of an expense (no party)' { ShareEntry 'P2' @('{F5}') 'Payment' 'Cash' @(, @('Share Expense', '300', $null)) 'share payment expense' }
$null = ShareCase 'contra' 'contra: cash into the bank' { ShareEntry 'C1' @('{F4}') 'Contra' 'Share Bank' @(, @('Cash', '200', $null)) 'share contra' }
$null = ShareCase 'journal-party' 'journal with a party (Share Expense Dr / Share Supplier Cr, New Ref JN-1)' { ShareEntry 'J1' @('{F7}') 'Journal' $null @(@('Share Expense', '600', $null), @('Share Supplier', '', @('New Ref', 'JN-1'))) 'share journal party' -byTo }
$null = ShareCase 'journal-plain' 'journal with no party (Share Expense Dr / Spike Income Cr)' { ShareEntry 'J2' @('{F7}') 'Journal' $null @(@('Share Expense', '250', $null), @('Spike Income', '', $null)) 'share journal plain' -byTo }
$S1 = ShareCase 'sales-new' 'sales item invoice, New Ref bill (SI-1)' { ShareInvoice 'S1' @('{F8}') 'Share Party' 'Share Sales' @() 2 100 @('New Ref', 'SI-1') 'share sales new' }
$null = ShareCase 'copy-sales-new' 'Alt+2 copy of the New Ref sales invoice (its bill as the copy carries it)' { ShareDayBookLast 'D1' 'Sales'; $null = TK '%2' 3 'D1-copy'; ShareAccept 'D1' $null }
$null = ShareCase 'sales-new2' 'sales item invoice, a second one (Tally allocates its bill at the save: no bill-wise screen in item invoice mode, run 37719717293)' { ShareInvoice 'S2' @('{F8}') 'Share Party' 'Share Sales' @() 3 100 @('Agst Ref', 'ADVS-1') 'share sales agst' }
$null = ShareCase 'purchase-new' 'purchase item invoice, New Ref bill (PI-1)' { ShareInvoice 'U1' @('{F9}') 'Share Supplier' 'Share Purchase' @('SUP-1{ENTER}', '{ENTER}') 2 80 @('New Ref', 'PI-1') 'share purchase new' }
$null = ShareCase 'purchase-new2' 'purchase item invoice, a second one (Tally allocates its bill at the save)' { ShareInvoice 'U2' @('{F9}') 'Share Supplier' 'Share Purchase' @('SUP-2{ENTER}', '{ENTER}') 3 80 @('Agst Ref', 'ADVP-1') 'share purchase agst' }
# an invoice's Agst Ref is typed where Tally asks for it: "As Voucher" mode (Ctrl+H), the party row's bill-wise screen
$null = ShareCase 'sales-agst' 'sales in As Voucher mode, the party Dr with an Agst Ref bill (the advance ADVS-1)' { ShareEntry 'S3' @('{F8}', '^h', 'As Voucher{ENTER}') 'Sales' $null @(@('Share Party', '300', @('Agst Ref', 'ADVS-1')), @('Share Sales', '', $null)) 'share sales agst' -byTo }
$null = ShareCase 'purchase-agst' 'purchase in As Voucher mode, the supplier Cr with an Agst Ref bill (the advance ADVP-1)' { ShareEntry 'U3' @('{F9}', '^h', 'As Voucher{ENTER}') 'Purchase' $null @(@('Share Purchase', '240', $null), @('Share Supplier', '', @('Agst Ref', 'ADVP-1'))) 'share purchase agst' -byTo }
$null = ShareCase 'credit-note' 'credit note, item invoice, Agst Ref the sales bill SB-1' { ShareInvoice 'N1' @('{F10}', 'Credit Note{ENTER}') 'Share Party' 'Share Sales' @() 1 100 @('Agst Ref', 'SB-1') 'share credit note' }
$null = ShareCase 'copy-journal-party' 'Alt+2 copy of the journal with a party (its New Ref JN-1 as the copy carries it)' { ShareDayBookLast 'D2' 'Journal'; $null = TK '%2' 3 'D2-copy'; ShareAccept 'D2' $null }
$null = ShareCase 'copy-receipt-plain' 'Alt+2 copy of the receipt with no party' { ShareDayBookLast 'D3' 'Receipt'; $null = TK '%2' 3 'D3-copy'; ShareAccept 'D3' $null }
if ($R2) {
  # the last receipt of the day is the copy above: the receipt with no party is opened from its own position (the
  # second-to-last receipt), its amount 800 (c4b's keys)
  $null = ShareCase 'alter-receipt-plain' 'alteration: the receipt with no party, its amount 700 -> 800' { ShareDayBookLast 'A1' 'Receipt'; $null = TK '{UP}' 1.5 'A1-up'; $null = TK '{ENTER}' 3 'A1-open'
    $null = TK '{ENTER}' 1.5; $null = TK '{ENTER}' 1.5; $null = TK '{ENTER}' 1.5 'A1-at-amount'; $null = TK '800{ENTER}' 2 'A1-amount'; ShareAccept 'A1' $null } $R2.mid
}
if ($S1) {
  $null = ShareCase 'alter-sales-new' 'alteration: the New Ref sales invoice saved again unchanged (opened, Ctrl+A)' { ShareDayBookLast 'A3' 'Sales'; $null = TK '{HOME}' 1.5 'A3-first'; $null = TK '{ENTER}' 3 'A3-open'; ShareAccept 'A3' $null } $S1.mid
}
if ($R1) {
  $null = ShareCase 'alter-receipt-agst' 'alteration: the receipt against SB-1 saved again unchanged (opened, Ctrl+A)' { ShareDayBookLast 'A2' 'Receipt'; $null = TK '{HOME}' 1.5 'A2-first'; $null = TK '{ENTER}' 3 'A2-open'; ShareAccept 'A2' $null } $R1.mid
}

# (run 37725649024: the Day Book's voucher type list had no Payroll and the number SH-PR1 was not kept: found by narration,
# the template the last entry of 1-10-2026; the alteration first, then the copy, so the template stays the last of the day)
$PT = @(Vouchers | Where-Object { $_.narr -like 'share payroll template*' })[0]
if ($PT) { $null = ShareCase 'alter-payroll' 'alteration: the payroll entry saved again unchanged (opened, Ctrl+A)' { ShareDayBookLast 'Y2' '' '1-10-2026'; $null = TK '{ENTER}' 3 'Y2-open'; ShareAccept 'Y2' $null } $PT.mid }
else { Add-Content -Path $resultsFile -Value 'HARNESS share alter-payroll: the payroll template is not in Tally''s list' -Encoding UTF8 }
$null = ShareCase 'copy-payroll' 'Alt+2 copy of the payroll entry (five employees, two pay heads)' { ShareDayBookLast 'Y1' '' '1-10-2026'; $null = TK '%2' 3 'Y1-copy'; ShareAccept 'Y1' $null }

# ---- P7 and P9 of push233 (moved here from tally-real, the owner's queue order of 08-Oct-2026), judged by what the add-on
# writes: FinCom gets an entry live only through the add-on's line (the bridge has no other live path for an entry)
$tg = { param($x, $t) [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", "<$t(?:\s[^>]*)?>([^<]*)</$t>").Groups[1].Value).Trim() }
$coll = { param($id, $fetch, $filter) Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fetch + '</FETCH><FILTERS>' + $id + 'F</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="' + $id + 'F">' + $filter + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' }
$vlist = { param($x) @(foreach ($v in [regex]::Matches("$x", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) { [pscustomobject]@{ guid = (& $tg $v.Value 'GUID'); mid = [int64]('0' + (& $tg $v.Value 'MASTERID')); vno = (& $tg $v.Value 'VOUCHERNUMBER'); aid = (& $tg $v.Value 'ALTERID'); x = $v.Value } }) }
try {
  # P7a: an invoice imported (as a bill would be), then its IRN and e-way bill written back by an XML alteration (as e-invoice
  # and e-way bill utilities do after the save)
  $f7 = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.LEDGERNAME'
  $inv = '<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>SH-E1</VOUCHERNUMBER><PARTYLEDGERNAME>Share Party</PARTYLEDGERNAME><NARRATION>share e-invoice</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-150.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>SH-E1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-150.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>150.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $null = Imp 'Vouchers' $inv 'p7 invoice SH-E1'
  # (run 37722273938: a lookup by $VoucherNumber found nothing; Tally's own list, then the entry by its MasterID)
  $eid = @(Vouchers | Where-Object { $_.narr -like 'share e-invoice*' })[0]   # (its number SH-E1 may not be kept: automatic numbering)
  $e7 = { if ($eid) { $a = & $coll 'ShareE' $f7 ('$MasterID = ' + $eid.mid); Add-Content (Join-Path $cap 'p7a-answers.xml') $a -Encoding UTF8; @(& $vlist $a)[0] } }
  $e0 = & $e7
  $l0 = (& $recLines).Count
  $irn = '<IRN>IRN-SHARE-0001</IRN><IRNACKNO>ACK-SHARE-1</IRNACKNO><IRNACKDATE>20261002</IRNACKDATE><EWAYBILLDETAILS.LIST><BILLDATE>20261002</BILLDATE><BILLNUMBER>381101234299</BILLNUMBER><DOCUMENTTYPE>Tax Invoice</DOCUMENTTYPE></EWAYBILLDETAILS.LIST>'
  $how = 'neither form of XML alteration took'; $e1 = $e0
  if ($e0) {
    foreach ($hdr in @(('<VOUCHER REMOTEID="' + $e0.guid + '" VCHTYPE="Sales" ACTION="Alter"'), ('<VOUCHER DATE="20261002" TAGNAME="Voucher Number" TAGVALUE="' + $(if ($e0) { $e0.vno } else { 'SH-E1' }) + '" VCHTYPE="Sales" ACTION="Alter"'))) {
      $null = Imp 'Vouchers' (($inv -replace '<VOUCHER VCHTYPE="Sales" ACTION="Create"', $hdr) -replace '<NARRATION>', ($irn + '<NARRATION>')) 'p7a IRN and e-way bill by a tool'
      $e1 = & $e7
      if ((& $tg $e1.x 'IRN') -eq 'IRN-SHARE-0001') { $how = $hdr -replace '^<VOUCHER ', ''; break }
    }
  }
  Set-Content (Join-Path $cap 'p7a-stored.xml') $e1.x -Encoding UTF8
  $n7 = @(& $recLines | Select-Object -Skip $l0)
  $made7 = $e1 -and (& $tg $e1.x 'IRN') -eq 'IRN-SHARE-0001' -and (& $tg $e1.x 'BILLNUMBER') -eq '381101234299'
  if (-not $made7) { Result 'P7a IRN and e-way bill written back after the save by a tool' 'HARNESS' "not made: $how" }
  else { Result 'P7a IRN and e-way bill written back after the save by a tool' $(if (@($n7 | Where-Object { $_ -match 'IRN-SHARE-0001' }).Count) { 'PASS' } else { 'FAIL' }) ("made by an XML alteration ({0}): Tally stored IRN '{1}' ack '{2}' {3} e-way bill '{4}', AlterID {5} -> {6}; the add-on wrote {7} line(s) (an alteration with no form: FinCom has it from the Day Book only)" -f $how, (& $tg $e1.x 'IRN'), (& $tg $e1.x 'IRNACKNO'), (& $tg $e1.x 'IRNACKDATE'), (& $tg $e1.x 'BILLNUMBER'), $e0.aid, $e1.aid, $n7.Count) }
  # P7b: that invoice saved again on its form: the full line's irn / irnack / irnackdt / ewb against Tally's
  if ($made7) {
    $l0 = (& $recLines).Count
    ShareDayBookLast 'P7b' 'Sales'; $null = TK '{HOME}' 1.5 'P7b-first'
    # SH-E1 is the first sales entry of the day only if it sorts first; find it by moving down until its number shows
    for ($i = 0; $i -lt 8; $i++) { $t = TdsScreen "P7b-row$i"; if ($t -match [regex]::Escape("$($e1.vno)") -and $t -match 'share e-invoice|Share Party') { break }; $null = TK '{DOWN}' 1 }
    $null = TK '{ENTER}' 3 'P7b-open'; ShareAccept 'P7b' $null
    $n7 = @(& $recLines | Select-Object -Skip $l0); $fl = @($n7 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$($e1.mid)\|" })
    $lf = { param($k) if ($fl.Count) { [regex]::Match($fl[0], "\|part=1\|.*?\|$k=([^|]*)").Groups[1].Value } else { $null } }
    $ad = & $lf 'irnackdt'; $ad8 = try { [datetime]::ParseExact($ad, @('d-MMM-yy', 'd-MMM-yyyy'), [Globalization.CultureInfo]::InvariantCulture, 0).ToString('yyyyMMdd') } catch { $ad }
    $ok = $fl.Count -and (& $lf 'irn') -eq 'IRN-SHARE-0001' -and (& $lf 'irnack') -eq 'ACK-SHARE-1' -and $ad8 -eq '20261002' -and (& $lf 'ewb') -eq '381101234299'
    Result 'P7b IRN and e-way bill in the full line of the form save' $(if (-not $fl.Count) { 'HARNESS' } elseif ($ok) { 'PASS' } else { 'FAIL' }) ("the line: irn '{0}' irnack '{1}' irnackdt '{2}' ewb '{3}'; Tally: IRN-SHARE-0001 / ACK-SHARE-1 / 20261002 / 381101234299; lines {4}" -f (& $lf 'irn'), (& $lf 'irnack'), $ad, (& $lf 'ewb'), $n7.Count)
  }
  # P7c: the bank date set in Bank Reconciliation (Share Bank: the contra's deposit of 2-10-2026)
  $bf = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE'
  $b0 = & $vlist (& $coll 'ShareB' $bf '$VoucherTypeName = "Contra"'); $l0 = (& $recLines).Count
  $null = TdsGateway 'P7c'
  $null = TK '%g' 2 'P7c-goto'; $null = TK 'Bank Reconciliation' 1.5 'P7c-typed'; $null = TK '{ENTER}' 3 'P7c-select'
  $null = TK 'Share Bank{ENTER}' 3 'P7c-brs' 'Reconcil|Bank Date|Bankers'
  $null = TK '2-10-2026{ENTER}' 2 'P7c-date'
  $null = TK '^a' 3 'P7c-accept'; $t = TdsScreen 'P7c-after'; if ($t -match 'Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3 }
  $null = TdsGateway 'after P7c'
  $b1 = & $vlist (& $coll 'ShareB' $bf '$VoucherTypeName = "Contra"')
  $dated = @($b1 | Where-Object { $_.x -match '<BANKERSDATE[^>]*>\s*20261002\s*<' -and $_.guid -notin @($b0 | Where-Object { $_.x -match '<BANKERSDATE[^>]*>\s*20261002\s*<' } | ForEach-Object guid) })
  $n7 = @(& $recLines | Select-Object -Skip $l0)
  if (-not $dated.Count) { Result 'P7c bank date set in Bank Reconciliation' 'HARNESS' 'not made: no contra has the bank date 2-10-2026 after the keys (see tds-*-P7c-* screenshots)' }
  else { Result 'P7c bank date set in Bank Reconciliation' $(if (@($n7 | Where-Object { $_ -match "\|mid=$($dated[0].mid)\|" -and $_ -like 'FCR1|ev=voucher_full|*' }).Count) { 'PASS' } else { 'FAIL' }) ("made: contra {0} (mid {1}, AlterID {2} -> {3}) has bank date 20261002; the add-on wrote {4} line(s) (Bank Reconciliation is not a voucher form: FinCom has it from the Day Book only)" -f $dated[0].vno, $dated[0].mid, @($b0 | Where-Object mid -eq $dated[0].mid)[0].aid, $dated[0].aid, $n7.Count) }
  # P9b: a receipt inserted (Alt+I) before the first receipt of 2-10-2026: each receipt Tally renumbers (no form, so no line)
  $rf = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER'
  $r0 = & $vlist (& $coll 'ShareR' $rf '$VoucherTypeName = "Receipt"'); $l0 = (& $recLines).Count
  ShareDayBookLast 'P9b' 'Receipt'; $null = TK '{HOME}' 1.5 'P9b-first'
  $null = TK '%i' 3 'P9b-insert' 'Receipt|Creation|Insert'
  $null = TK 'Cash{ENTER}' 2 'P9b-account'; $null = TK 'Spike Income{ENTER}' 2 'P9b-ledger'; ShareSubs 'P9b-led'; $null = TK '60{ENTER}' 2 'P9b-amount'; ShareSubs 'P9b-amt'
  $null = TK '{ENTER}' 2 'P9b-rows-done'; ShareSubs 'P9b-done'; $null = TK 'share insert{ENTER}' 2 'P9b-narr'; ShareAccept 'P9b' $null
  $r1 = & $vlist (& $coll 'ShareR' $rf '$VoucherTypeName = "Receipt"')
  $mx = (@($r0 | ForEach-Object mid) + 0 | Measure-Object -Maximum).Maximum
  $ins = @($r1 | Where-Object { $_.mid -gt $mx })[0]
  $ren = @($r1 | Where-Object { $o = $_; $p = @($r0 | Where-Object mid -eq $o.mid)[0]; $p -and $p.vno -ne $o.vno })
  $n9 = @(& $recLines | Select-Object -Skip $l0)
  $lined = @($ren | Where-Object { $e = $_; @($n9 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$($e.mid)\|" -and $_ -match "\|part=1\|.*?\|vno=$([regex]::Escape($e.vno))\|" }).Count })
  $ilv = if ($ins) { [regex]::Match((@($n9 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$($ins.mid)\|" })[0]), '\|part=1\|.*?\|vno=([^|]*)\|').Groups[1].Value } else { '' }
  if (-not $ins) { Result 'P9b back-dated insert: the renumbered entries' 'HARNESS' 'not made: no receipt inserted (see tds-*-P9b-* screenshots)' }
  elseif (-not $ren.Count) { Result 'P9b back-dated insert: the renumbered entries' 'HARNESS' ("receipt {0} (mid {1}, its line's number '{2}') inserted; Tally renumbered none" -f $ins.vno, $ins.mid, $ilv) }
  else { Result 'P9b back-dated insert: the renumbered entries' $(if ($lined.Count -eq $ren.Count) { 'PASS' } else { 'FAIL' }) ("receipt {0} (mid {1}, its line's number '{2}') inserted; Tally renumbered {3}: {4}; a line with the new number for {5} of them (renumbering is not a form: FinCom keeps the old numbers until the Day Book)" -f $ins.vno, $ins.mid, $ilv, $ren.Count, (($ren | ForEach-Object { $o = $_; "mid $($o.mid) $(@($r0 | Where-Object mid -eq $o.mid)[0].vno) -> $($o.vno)" }) -join ', '), $lined.Count) }
  # P9r (the owner, 08-Oct-2026): the same with renumbering ON. The Receipt voucher type exported whole (kept), its
  # numbering set to Automatic and every field about keeping the original number on insertion / deletion set to No, by
  # XML, checked by exporting it again; then a receipt inserted before the first of the day and one in the middle deleted.
  # For each receipt Tally renumbers: a line written for it, its AlterID, the company's ALTVCHID, and what the fast request
  # (next-fastfetch's object export ID:<MasterID>, the voucher number fetched) answers
  $vtq = { Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareVT</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareVT" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>*</FETCH><FILTERS>ShareVTF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="ShareVTF">$Name = "Receipt"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' }
  $vt0 = & $vtq; Set-Content (Join-Path $cap 'p9r-vouchertype-before.xml') $vt0 -Encoding UTF8
  # the Receipt type keeps its number series in VOUCHERNUMBERSERIES.LIST (push-design run 37588508934, 7.1: series
  # "Default", NUMBERINGMETHOD Automatic, NUMBERINGSUBMETHOD "Auto Retain": numbers kept on insertion / deletion, as P9b
  # saw). Renumbering ON: the sub-method set to each candidate in turn until Tally's export shows it
  $sub = { param($x) [regex]::Match("$x", '(?s)<VOUCHERNUMBERSERIES\.LIST>.*?<NUMBERINGSUBMETHOD[^>]*>([^<]*)<').Groups[1].Value.Trim() }
  $sm0 = & $sub $vt0; $sm1 = $sm0; $tried = @()
  foreach ($cand in @('Auto Renumber', 'Renumber', 'Automatic', 'Auto')) {
    $alt = '<VOUCHERTYPE NAME="Receipt" ACTION="Alter"><NAME.LIST><NAME>Receipt</NAME></NAME.LIST><VOUCHERNUMBERSERIES.LIST><NAME>Default</NAME><NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD><NUMBERINGSUBMETHOD>' + $cand + '</NUMBERINGSUBMETHOD></VOUCHERNUMBERSERIES.LIST></VOUCHERTYPE>'
    $null = Imp 'All Masters' $alt "p9r sub-method $cand"
    $vt1 = & $vtq; $sm1 = & $sub $vt1; $tried += "$cand -> '$sm1'"
    if ($sm1 -and $sm1 -ne $sm0) { break }
  }
  Set-Content (Join-Path $cap 'p9r-vouchertype-after.xml') $vt1 -Encoding UTF8
  Info ("P9r the Receipt voucher type's numbering sub-method: '{0}' -> '{1}' (tried: {2})" -f $sm0, $sm1, ($tried -join '; '))
  if (-not $sm1 -or $sm1 -eq $sm0) { Result 'P9r renumbering on' 'HARNESS' ("Tally kept the sub-method '{0}' for every value tried ({1}); see p9r-vouchertype-*.xml" -f $sm0, ($tried -join '; ')) }
  $altv = { [int64]('0' + [regex]::Match((Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareAlt</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareAlt" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ALTVCHID</FETCH><FILTERS>ShareAltF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="ShareAltF">$Name = "' + $co1 + '"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''), '<ALTVCHID[^>]*>\s*(\d+)').Groups[1].Value) }
  $objNo = { param($mid) $a = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:' + $mid + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST><FETCH>VOUCHERNUMBER</FETCH><FETCH>ALTERID</FETCH><FETCH>MASTERID</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>') ''; (& $tg $a 'VOUCHERNUMBER') }
  foreach ($step in @(if ($sm1 -and $sm1 -ne $sm0) { 'insert', 'delete' })) {
    $r0 = & $vlist (& $coll 'ShareR' $rf '$VoucherTypeName = "Receipt"'); $l0 = (& $recLines).Count; $a0 = & $altv
    ShareDayBookLast "P9r-$step" 'Receipt'; $null = TK '{HOME}' 1.5 "P9r-$step-first"
    if ($step -eq 'insert') {
      $null = TK '%i' 3 'P9r-insert' 'Receipt|Creation|Insert'
      $null = TK 'Cash{ENTER}' 2 'P9r-account'; $null = TK 'Spike Income{ENTER}' 2 'P9r-ledger'; ShareSubs 'P9r-led'; $null = TK '70{ENTER}' 2 'P9r-amount'; ShareSubs 'P9r-amt'
      $null = TK '{ENTER}' 2 'P9r-rows-done'; ShareSubs 'P9r-done'; $null = TK 'share insert renumbering{ENTER}' 2 'P9r-narr'; ShareAccept 'P9r-ins' $null
    } else {
      $null = TK '{DOWN}' 1.5 'P9r-down1'; $null = TK '{DOWN}' 1.5 'P9r-middle'
      $null = TK '%d' 3 'P9r-delete-q'; $t = TdsScreen 'P9r-delete-ask'; if ($t -match 'Yes or No|Delete') { & $script:TdsSend 'y'; Start-Sleep 3 }
      $null = TdsGateway 'after P9r delete'
    }
    $r1 = & $vlist (& $coll 'ShareR' $rf '$VoucherTypeName = "Receipt"'); $a1 = & $altv
    $mx = (@($r0 | ForEach-Object mid) + 0 | Measure-Object -Maximum).Maximum
    $did = if ($step -eq 'insert') { @($r1 | Where-Object { $_.mid -gt $mx }).Count -eq 1 } else { $r1.Count -eq $r0.Count - 1 }
    $ren = @($r1 | Where-Object { $o = $_; $p0 = @($r0 | Where-Object mid -eq $o.mid)[0]; $p0 -and $p0.vno -ne $o.vno })
    $n9 = @(& $recLines | Select-Object -Skip $l0)
    $each = @(foreach ($o in $ren) {
      $p0 = @($r0 | Where-Object mid -eq $o.mid)[0]
      $ln = @($n9 | Where-Object { $_ -match "\|mid=$($o.mid)\|" }).Count
      "mid $($o.mid) $($p0.vno) -> $($o.vno), AlterID $($p0.aid) -> $($o.aid), lines $ln, the fast request says '$(& $objNo $o.mid)'" })
    $st = if (-not $did) { 'HARNESS' } elseif (-not $ren.Count) { 'HARNESS' } elseif (@($ren | Where-Object { $o = $_; @($n9 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$($o.mid)\|" }).Count -eq 0 }).Count) { 'FAIL' } else { 'PASS' }
    Result "P9r renumbering on: $step" $st ("the {0} {1}; Tally renumbered {2}; ALTVCHID {3} -> {4}; each: {5} (a renumbered receipt with no line keeps its old number in FinCom until something asks Tally for it)" -f $step, $(if ($did) { 'made' } else { 'NOT made by the keys' }), $ren.Count, $a0, $a1, $(if ($each.Count) { $each -join '; ' } else { '-' }))
  }
} catch { Result 'P7 / P9' 'HARNESS' "the harness stopped: $_" }

# ---- the ledgers and groups (a party derived from the ledger lines is checked against the stored party offline)
$lx = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareLed</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT, ISBILLWISEON</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
Set-Content (Join-Path $cap 'share-ledgers.xml') $lx -Encoding UTF8
$gx = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareGrp</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareGrp" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
Set-Content (Join-Path $cap 'share-groups.xml') $gx -Encoding UTF8
@(& $recLines) | Set-Content (Join-Path $cap 'share-recorder-all.txt') -Encoding UTF8
$summary | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'share-summary.json') -Encoding UTF8
$script:tdsLog | Set-Content (Join-Path $out 'share-screen-log.txt') -Encoding UTF8
Info ("share: {0} of {1} cases made by keys: {2}" -f @($summary | Where-Object made).Count, $summary.Count, (($summary | ForEach-Object { "$($_.case)=$(if ($_.made) { "mid $($_.mid)" } else { 'NOT MADE' })" }) -join '; '))
