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
function ShareEntry($tag, [string[]]$keys, $typeWords, $account, $rows, $narr) {
  $null = TdsGateway "before $tag"
  if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher')) { return }
  foreach ($k in $keys) { $null = TK $k 2.5 "$tag-type" }
  $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'
  $null = TK ((SK $shareDate) + '{ENTER}') 2 "$tag-date"
  if ($account) { $null = TK ((SK $account) + '{ENTER}') 2 "$tag-account"; ShareSubs "$tag-acc" }
  $r = 0
  foreach ($row in $rows) {
    $r++
    $null = TK ((SK $row[0]) + '{ENTER}') 2 "$tag-row$r"
    ShareSubs "$tag-row$r-a"
    if ($row[1]) { $null = TK ((SK "$($row[1])") + '{ENTER}') 2 "$tag-row$r-amt" } else { $null = TK '{ENTER}' 2 "$tag-row$r-amt" }
    ShareBills $row[2] "$tag-row$r"
    ShareSubs "$tag-row$r-b"
  }
  $null = TK '{ENTER}' 2 "$tag-rows-done"
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
    if ($t -match 'Dispatch|Receipt Details|Party Details|Supplier Details') { continue }
    break
  }
  $null = TdsGateway "after $tag"
}
# an item invoice (Ctrl+H: Item Invoice) as check 8 of tally-real types it: the party, the details screens, the sales or
# purchase ledger, one item row, Ctrl+A with the bill
function ShareInvoice($tag, [string[]]$keys, $party, $ledger, $head, $qty, $rate, $bill, $narr) {
  $null = TdsGateway "before $tag"
  if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher')) { return }
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
function ShareDayBookLast($tag, $type) {
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Day Book' 1.5; $null = TK '{ENTER}' 3 "$tag-daybook" 'Day Book'
  $null = TK '{F2}' 1.5 "$tag-db-date"; $null = TK ((SK $shareDate) + '{ENTER}') 3 "$tag-db-dated"
  $null = TK '{F4}' 2 "$tag-db-type"; $null = TK ((SK $type) + '{ENTER}') 3 "$tag-db-typed"
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
$null = ShareCase 'journal-party' 'journal with a party (Share Expense Dr / Share Supplier Cr, New Ref JN-1)' { ShareEntry 'J1' @('{F7}') 'Journal' $null @(@('Share Expense', '600', $null), @('Share Supplier', '', @('New Ref', 'JN-1'))) 'share journal party' }
$null = ShareCase 'journal-plain' 'journal with no party (Share Expense Dr / Spike Income Cr)' { ShareEntry 'J2' @('{F7}') 'Journal' $null @(@('Share Expense', '250', $null), @('Spike Income', '', $null)) 'share journal plain' }
$S1 = ShareCase 'sales-new' 'sales item invoice, New Ref bill (SI-1)' { ShareInvoice 'S1' @('{F8}') 'Share Party' 'Share Sales' @() 2 100 @('New Ref', 'SI-1') 'share sales new' }
$null = ShareCase 'copy-sales-new' 'Alt+2 copy of the New Ref sales invoice (its bill as the copy carries it)' { ShareDayBookLast 'D1' 'Sales'; $null = TK '%2' 3 'D1-copy'; ShareAccept 'D1' $null }
$null = ShareCase 'sales-agst' 'sales item invoice, Agst Ref bill (the advance ADVS-1)' { ShareInvoice 'S2' @('{F8}') 'Share Party' 'Share Sales' @() 3 100 @('Agst Ref', 'ADVS-1') 'share sales agst' }
$null = ShareCase 'purchase-new' 'purchase item invoice, New Ref bill (PI-1)' { ShareInvoice 'U1' @('{F9}') 'Share Supplier' 'Share Purchase' @('SUP-1{ENTER}', '{ENTER}') 2 80 @('New Ref', 'PI-1') 'share purchase new' }
$null = ShareCase 'purchase-agst' 'purchase item invoice, Agst Ref bill (the advance ADVP-1)' { ShareInvoice 'U2' @('{F9}') 'Share Supplier' 'Share Purchase' @('SUP-2{ENTER}', '{ENTER}') 3 80 @('Agst Ref', 'ADVP-1') 'share purchase agst' }
$null = ShareCase 'credit-note' 'credit note, item invoice, Agst Ref the sales bill SB-1' { ShareInvoice 'N1' @('{F10}', 'Credit Note{ENTER}') 'Share Party' 'Share Sales' @() 1 100 @('Agst Ref', 'SB-1') 'share credit note' }
$null = ShareCase 'copy-journal-party' 'Alt+2 copy of the journal with a party (its New Ref JN-1 as the copy carries it)' { ShareDayBookLast 'D2' 'Journal'; $null = TK '%2' 3 'D2-copy'; ShareAccept 'D2' $null }
$null = ShareCase 'copy-receipt-plain' 'Alt+2 copy of the receipt with no party' { ShareDayBookLast 'D3' 'Receipt'; $null = TK '%2' 3 'D3-copy'; ShareAccept 'D3' $null }
if ($R2) {
  # the last receipt of the day is the copy above: the receipt with no party is opened from its own position (the
  # second-to-last receipt), its amount 800 (c4b's keys)
  $null = ShareCase 'alter-receipt-plain' 'alteration: the receipt with no party, its amount 700 -> 800' { ShareDayBookLast 'A1' 'Receipt'; $null = TK '{UP}' 1.5 'A1-up'; $null = TK '{ENTER}' 3 'A1-open'
    $null = TK '{ENTER}' 1.5; $null = TK '{ENTER}' 1.5; $null = TK '{ENTER}' 1.5 'A1-at-amount'; $null = TK '800{ENTER}' 2 'A1-amount'; ShareAccept 'A1' $null } $R2.mid
}
if ($R1) {
  $null = ShareCase 'alter-receipt-agst' 'alteration: the receipt against SB-1 saved again unchanged (opened, Ctrl+A)' { ShareDayBookLast 'A2' 'Receipt'; $null = TK '{HOME}' 1.5 'A2-first'; $null = TK '{ENTER}' 3 'A2-open'; ShareAccept 'A2' $null } $R1.mid
}

# ---- the ledgers and groups (a party derived from the ledger lines is checked against the stored party offline)
$lx = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareLed</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT, ISBILLWISEON</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
Set-Content (Join-Path $cap 'share-ledgers.xml') $lx -Encoding UTF8
$gx = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareGrp</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareGrp" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
Set-Content (Join-Path $cap 'share-groups.xml') $gx -Encoding UTF8
@(& $recLines) | Set-Content (Join-Path $cap 'share-recorder-all.txt') -Encoding UTF8
$summary | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'share-summary.json') -Encoding UTF8
$script:tdsLog | Set-Content (Join-Path $out 'share-screen-log.txt') -Encoding UTF8
Info ("share: {0} of {1} cases made by keys: {2}" -f @($summary | Where-Object made).Count, $summary.Count, (($summary | ForEach-Object { "$($_.case)=$(if ($_.made) { "mid $($_.mid)" } else { 'NOT MADE' })" }) -join '; '))
