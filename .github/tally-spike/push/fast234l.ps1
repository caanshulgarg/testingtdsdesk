# fast234l.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234l,
# after the light company's setup (masters, the 3 templates, the features, the voucher types' templates: payroll, stock
# journal, orders, notes, the batch invoice). The independent review of 2.3.4 (08-Oct-2026):
#   L2/L3  real answers of every kind of entry, each asked three ways on the same voucher: today's FinComVoucherByMaster
#          (2.3.3), the 2.3.4 entry request FinComVoucherObject (the object export ID:<MasterID>, the bridge's own XML) and
#          FinComVoucherByNumber; the TDS entry made on Tally's own screens (S5); a credit note (accounting and with items),
#          a debit note, a journal with cost centres, a bank payment with the UTR, a sales voucher in voucher mode with
#          items (inventory allocations under the ledger line), and what the object export gives for a deleted
#          voucher's MasterID, a ledger's MasterID and a MasterID never used. Every answer kept (captures\l-*)
#   M3     a 200- and a 500-item sales invoice: time and size of the 2.3.4 request against today's, on this small company
#          and after it is grown to 100,000 vouchers (two more such invoices made then), a warm-up and 5 timed reps
. "$here\fast234.ps1"   # its request templates and helpers (it returns before its own run in this mode)
. "$here\v3.ps1"        # the S5 screen route (tdslib.ps1) and the TDS masters
$lcsv = Join-Path $out 'fast234l.csv'
$keepBig = $rel -in '7.1', '3.0'
function SaveCap($name, [string]$x) {
  $p = Join-Path $cap $name
  if ($x.Length -le 3000000) { Set-Content $p $x -Encoding UTF8; return }
  if (-not $keepBig) { Set-Content $p ("TOO BIG TO KEEP: $($x.Length) chars; head:`n" + $x.Substring(0, 20000)) -Encoding UTF8; return }
  $fs = [IO.File]::Create("$p.gz"); $gz = New-Object IO.Compression.GZipStream($fs, [IO.Compression.CompressionMode]::Compress)
  $b = [Text.Encoding]::UTF8.GetBytes($x); $gz.Write($b, 0, $b.Length); $gz.Close(); $fs.Close()
}
function AllV($filter = '') {
  $x = Post (Coll 'FCPAllV' 'Voucher' 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISCANCELLED' $filter) '' 900
  $o = @()
  foreach ($m in [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $o += [pscustomobject]@{ mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; date = [regex]::Match($v, '<DATE[^>]*>(\d{8})').Groups[1].Value
      type = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value); vno = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value)
      narr = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<NARRATION[^>]*>([^<]*)').Groups[1].Value); guid = [regex]::Match($v, '<GUID[^>]*>([^<]*)').Groups[1].Value }
  }
  return , $o
}
function OReq($mid) { $tplOBJ.Replace('@@CO@@', (X $co)).Replace('987654321', "$mid") }
# one voucher: the three requests, each a warm-up (kept) and $n timed reps
function Ask3($case, $t, $kind, $n = 1, [bool]$keep = $true) {
  if ($t.mid -notmatch '^\d+$' -or $t.date -notmatch '^\d{8}$') { Say "L ${case} ${kind}: no MasterID or date in Tally's list ($($t.type) $($t.vno)): not asked"; return }
  $forms = [ordered]@{ object = (OReq $t.mid); bymaster = (ReqBM $t.date $t.mid) }
  if ($t.vno -and $t.type) { $forms['bynumber'] = ReqBN $t.date $t.type $t.vno }
  $line = @()
  foreach ($f in $forms.Keys) {
    $ms = @()
    for ($r = 0; $r -le $n; $r++) {
      $x = Post $forms[$f] '' 60; $t0 = $script:lastMs
      $hit = $x -match "<MASTERID[^>]*>\s*$($t.mid)\s*<"
      $err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|Unknown Request[^<]*|Could not[^<]*|<ERROR>[^<]*').Value
      [pscustomobject]@{ rel = $rel; case = $case; kind = $kind; type = $t.type; vno = $t.vno; date = $t.date; mid = $t.mid; form = $f; rep = $r; ms = $t0; bytes = $x.Length
        vouchers_in_answer = ([regex]::Matches($x, '<VOUCHER[ >]')).Count; has_target = $hit; err = $(if (-not $x) { 'NO ANSWER' } else { $err }) } | Export-Csv $lcsv -Append -NoTypeInformation -Encoding UTF8
      if ($r -eq 0 -and $keep) { SaveCap "l-$case-$kind-$f.xml" $x }
      if ($r -ge 1) { $ms += $t0 }
      if (-not $x) {
        # run 37730488503: no answer: Tally started again when it no longer answers the company list (each later ask
        # would wait its whole limit)
        if (-not ((Post $listCo '' 20) -match '<COMPANY')) { Say "L ${case} ${kind} ${f}: Tally does not answer after it: started again"; Shot "l-hung-$kind-$f"; Start-T $light @() "l-again-$kind-$f" | Out-Null }
        break
      }
    }
    $s = @($ms | Sort-Object); if ($s.Count) { $line += "$f median $($s[[int][math]::Floor(($s.Count - 1) / 2)]) worst $($s[-1])" }
  }
  Say "L $case ${kind}: $($t.type) $($t.vno) $($t.date) MasterID $($t.mid): $($line -join '; ') ms"
}
function ById($all, $mid) { @($all | Where-Object { $_.mid -eq "$mid" })[0] }

# ---------------------------------------------------------------- the extra entries (1-Nov-2026: no other voucher there)
$lD = '20261101'
function LLine($led, $pos, $amt, $inner = '') { '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (Esc $led) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $(if ($pos) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT>' + $inner + '</ALLLEDGERENTRIES.LIST>' }
function LVch($type, $no, $narr, $body, $party = '', $view = 'Accounting Voucher View', $inv = 'No') {
  '<VOUCHER VCHTYPE="' + $type + '" ACTION="Create" OBJVIEW="' + $view + '"><DATE>' + $lD + '</DATE><VOUCHERTYPENAME>' + $type + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER>' +
  $(if ($party) { '<PARTYLEDGERNAME>' + (Esc $party) + '</PARTYLEDGERNAME>' }) + '<PERSISTEDVIEW>' + $view + '</PERSISTEDVIEW><ISINVOICE>' + $inv + '</ISINVOICE><NARRATION>' + (Esc $narr) + '</NARRATION>' + $body + '</VOUCHER>'
}
$cc = { param($a, $b) '<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><COSTCENTREALLOCATIONS.LIST><NAME>CC Main</NAME><AMOUNT>' + $a + '</AMOUNT></COSTCENTREALLOCATIONS.LIST><COSTCENTREALLOCATIONS.LIST><NAME>CC Branch</NAME><AMOUNT>' + $b + '</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>' }
$bill = { param($n, $t, $a) '<BILLALLOCATIONS.LIST><NAME>' + $n + '</NAME><BILLTYPE>' + $t + '</BILLTYPE><AMOUNT>' + $a + '</AMOUNT></BILLALLOCATIONS.LIST>' }
function Extras {
  $o = [ordered]@{}
  # a credit note against the 5-item invoice: sales and GST back, the party credited against its bill (accounting form)
  $o['creditnote'] = LVch 'Credit Note' 'CN-1' 'fast234l credit note' ((LLine 'Sales' $true '-1000.00') + (LLine 'Output CGST' $true '-90.00') + (LLine 'Output SGST' $true '-90.00') + (LLine 'Template Party' $false '1180.00' (& $bill 'TS5-1' 'Agst Ref' '1180.00'))) 'Template Party'
  # a credit note with items (a sales return as an invoice)
  $ci = '<LEDGERENTRIES.LIST><LEDGERNAME>Template Party</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>472.00</AMOUNT>' + (& $bill 'TS5-1' 'Agst Ref' '472.00') + '</LEDGERENTRIES.LIST>'
  foreach ($t in 'Output CGST', 'Output SGST') { $ci += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-36.00</AMOUNT></LEDGERENTRIES.LIST>' }
  foreach ($it in 'Item T01', 'Item T02') { $ci += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + $it + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>-200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY>' + (BatchLine 'PD Godown A' 'Primary Batch' 2 '-200.00') + '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' }
  $o['creditnote-items'] = LVch 'Credit Note' 'CN-2' 'fast234l credit note with items' $ci 'Template Party' 'Invoice Voucher View' 'Yes'
  # a debit note: the supplier debited, purchase back
  $o['debitnote'] = LVch 'Debit Note' 'DBN-1' 'fast234l debit note' ((LLine 'PD Supplier' $true '-500.00' (& $bill 'DBN-1' 'New Ref' '-500.00')) + (LLine 'Purchase' $false '500.00')) 'PD Supplier'
  # a journal with cost centres on both lines (two centres each)
  $o['journal-cc'] = LVch 'Journal' 'JCC-1' 'fast234l journal with cost centres' ((LLine 'Sales' $true '-500.00' ((& $cc '-300.00' '-200.00') -replace '<ISDEEMEDPOSITIVE>No', '<ISDEEMEDPOSITIVE>Yes')) + (LLine 'Spike Income' $false '500.00' (& $cc '300.00' '200.00')))
  # a bank payment by e-fund transfer with its UTR, against the supplier's bill
  $bk = '<BANKALLOCATIONS.LIST><DATE>' + $lD + '</DATE><INSTRUMENTDATE>' + $lD + '</INSTRUMENTDATE><BANKERSDATE>' + $lD + '</BANKERSDATE><NAME>BP-1</NAME><TRANSACTIONTYPE>e-Fund Transfer</TRANSACTIONTYPE><PAYMENTFAVOURING>PD Supplier</PAYMENTFAVOURING><INSTRUMENTNUMBER>NEFT001</INSTRUMENTNUMBER><UNIQUEREFERENCENUMBER>HDFCN26110100042</UNIQUEREFERENCENUMBER><AMOUNT>2500.00</AMOUNT></BANKALLOCATIONS.LIST>'
  $o['bank-payment'] = LVch 'Payment' 'BP-1' 'fast234l bank payment with UTR' ((LLine 'PD Supplier' $true '-2500.00' (& $bill 'PB-7' 'New Ref' '-2500.00')) + (LLine 'HDFC Bank' $false '2500.00' $bk))
  $o['bank-payment-cheque'] = ($o['bank-payment'] -replace 'BP-1', 'BP-2' -replace 'e-Fund Transfer', 'Cheque' -replace 'with UTR', 'by cheque')
  # a sales voucher in voucher mode with items: the stock under the sales ledger's line (inventory allocations)
  $va = '<INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Item T03</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>300.00</AMOUNT><ACTUALQTY> 3 Nos</ACTUALQTY><BILLEDQTY> 3 Nos</BILLEDQTY>' + (BatchLine 'PD Godown A' 'Primary Batch' 3 '300.00') + '</INVENTORYALLOCATIONS.LIST>'
  $o['voucher-mode-items'] = LVch 'Sales' 'SV-1' 'fast234l sales in voucher mode with items' ((LLine 'Template Party' $true '-300.00' (& $bill 'SV-1' 'New Ref' '-300.00')) + (LLine 'Sales' $false '300.00' $va)) 'Template Party'
  # the same without a godown (a company without godowns)
  $o['voucher-mode-items-nog'] = ($o['voucher-mode-items'] -replace 'SV-1', 'SV-2' -replace '<BATCHALLOCATIONS\.LIST>.*?</BATCHALLOCATIONS\.LIST>', '')
  # a journal deleted after it is made: its MasterID asked afterwards
  $o['deleted'] = LVch 'Journal' 'DEL-1' 'fast234l to be deleted' ((LLine 'Spike Party' $true '-75.00') + (LLine 'Spike Income' $false '75.00'))
  return $o
}
function Big($no, $n, $date) { $its = @(); for ($i = 0; $i -lt $n; $i++) { $its += ('Item T{0:d2}' -f (($i % 50) + 1)) }; SalesXml $date $no 'Template Party' $its "fast234l sales $n items $no" $true 'PD Godown A' }

# ---------------------------------------------------------------- the TDS entry on Tally's screens (S5, as v3.ps1 V3Tds, no add-on)
function LTds {
  $N = $script:tdsNames
  $script:tdsTdls = @()
  if (-not (Start-T $light @() 'l-tds')) { Say 'HARNESS: TDS: the company did not open'; return }
  $pre = @((AllV) | ForEach-Object mid)
  $null = TdsGateway 'before the TDS entry'
  $null = TK 'v' 2.5 's5-vouchers' 'Voucher'
  $null = TK '{F7}' 2.5 's5-journal' 'Journal'
  $null = TK '{F2}' 1.5 's5-date-box' 'Date'
  $null = TK '2-11-2026{ENTER}' 2 's5-date-set'
  $null = TK ((SK $N.exp) + '{ENTER}') 2 's5-r1-ledger'
  $null = TK '100000{ENTER}' 2 's5-r1-amount'
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "s5-r1-after$j"; if ($t -match 'Cost Centre Alloc|Cost Allocations|Details for|Bill-wise|Assessable|Nature of Pay|Tax Details') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $null = TK 't{ENTER}' 1.5 's5-r2-to'
  $null = TK ((SK $N.tds) + '{ENTER}') 2.5 's5-r2-ledger'
  for ($j = 1; $j -le 5; $j++) { $t = TdsScreen "s5-r2-sub$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Deductee|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $t = TdsScreen 's5-r2-amount-shown'; $byTally = $t -match '2,000|2000'
  if (-not $byTally -and $t -match '\d ?%') { $null = TK '{ENTER}' 2 's5-r2-pct'; $t = TdsScreen 's5-r2-amount-shown2'; $byTally = $t -match '2,000|2000' }
  if ($byTally) { $null = TK '{ENTER}' 2 's5-r2-amount-tally' } else { $null = TK '2000{ENTER}' 2 's5-r2-amount-typed' }
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "s5-r2-after$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $null = TK 't{ENTER}' 1.5 's5-r3-to'
  $null = TK ((SK $N.party) + '{ENTER}') 2.5 's5-r3-ledger'
  $t = TdsScreen 's5-r3-amount-shown'
  if ($t -match '98,000|98000') { $null = TK '{ENTER}' 2 's5-r3-amount' } else { $null = TK '98000{ENTER}' 2 's5-r3-amount-typed' }
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "s5-r3-after$j"; if ($t -match 'Details for|Bill-wise|Assessable|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $t = TdsScreen 's5-before-narration'
  if ($t -notmatch 'Narration') { $null = TK '{ENTER}' 2 's5-rows-done' }
  $null = TK ((SK 'fast234l TDS 194C typed on the screen') + '{ENTER}') 2 's5-narration'
  $t = TdsScreen 's5-accept-q'
  if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 's5-accepted' } else { $null = TK '^a' 3 's5-ctrl-a'; $t = TdsScreen 's5-accept-q2'; if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 's5-accepted2' } }
  Set-Content (Join-Path $out 'tds-screen-log.txt') $script:tdsLog -Encoding UTF8
  $nv = @((AllV) | Where-Object { $_.mid -notin $pre })
  Say "TDS: $(if ($nv.Count) { "entry saved: MasterID $($nv[0].mid) $($nv[0].type) $($nv[0].vno)" } else { 'NO entry saved (see the tds-* screenshots)' }); TDS amount $(if ($byTally) { 'by Tally' } else { 'typed' }); OCR $(if ($script:ocrOk) { 'read the screens' } else { 'UNAVAILABLE' })"
  KeysTo '{ESC}' 1; KeysTo '{ESC}' 1
}

# ---------------------------------------------------------------- run
try {
  Say "fast234l on TallyPrime ${rel}: the entry kinds (L2) and the 200 / 500-item invoices (M3)"
  # credit / debit notes active (as pushm.ps1 makes the other types active)
  $vtA = @()
  foreach ($t in 'Credit Note', 'Debit Note') { if ($t -in $vtNames) { $vtA += '<VOUCHERTYPE NAME="' + $t + '" ACTION="Alter"><NAME>' + $t + '</NAME>' + (($actField | ForEach-Object { "<$_>Yes</$_>" }) -join '') + '</VOUCHERTYPE>' } }
  if ($vtA) { Imp 'All Masters' $vtA 'credit / debit note types active' | Out-Null }
  try { V3TdsMasters } catch { Say "HARNESS: TDS masters: $_" }
  $made = [ordered]@{}
  $ex = Extras
  foreach ($k in $ex.Keys) { $r = Imp 'Vouchers' @($ex[$k]) "extra $k"; $made[$k] = $r.created; if ($r.created -lt 1) { Set-Content (Join-Path $cap "l-import-$k-answer.xml") $r.raw -Encoding UTF8 } }
  foreach ($b in @(@('BIG200-1', 200), @('BIG500-1', 500))) { $r = Imp 'Vouchers' @(Big $b[0] $b[1] $lD) "invoice $($b[0])"; $made[$b[0]] = $r.created; if ($r.created -lt 1) { Set-Content (Join-Path $cap "l-import-$($b[0])-answer.xml") $r.raw -Encoding UTF8 } }
  Say "made: $(($made.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join '; ')"
  $all = AllV
  $del = @($all | Where-Object { $_.narr -eq 'fast234l to be deleted' })[0]
  if ($del) {
    # (run 37730488503: by its number it stayed; by its GUID, as an Alter by REMOTEID works)
    $r = Imp 'Vouchers' @('<VOUCHER REMOTEID="' + $del.guid + '" VCHTYPE="Journal" ACTION="Delete"><DATE>' + $lD + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + $del.vno + '</VOUCHERNUMBER></VOUCHER>') 'delete DEL-1'
    Say "deleted DEL-1 (MasterID $($del.mid)): still in Tally $([bool](ById (AllV) $del.mid))"
  }
  Stop-T
  try { LTds } catch { Say "HARNESS: TDS screens: $_ $($_.ScriptStackTrace)" }
  if (-not (Start-T $light @() 'l-ask')) { Say 'HARNESS: the company did not open for the asks'; return }
  $all = AllV
  Set-Content (Join-Path $cap 'l-vouchers.json') ($all | ConvertTo-Json -Depth 3) -Encoding UTF8
  Say "the company holds $($all.Count) vouchers: $(($all | ForEach-Object { "$($_.type) $($_.vno) ($($_.mid))" }) -join ', ')"
  # every voucher of the small company, each kind named by its narration or type
  # (run 37730488503: Tally's list began with an empty row, no MasterID: asked as such, the by-MasterID and by-number
  # requests with nothing in them hung Tally for the rest of the run; such rows are skipped now)
  $all = @($all | Where-Object { $_.mid -match '^\d+$' })
  foreach ($v in $all) {
    $kind = (("$($v.type)-$($v.vno)" -replace '[^\w-]', '_').ToLower())
    $n = if ($v.vno -like 'BIG*') { 5 } else { 1 }
    Ask3 'small' $v $kind $n
  }
  # the object export for a MasterID that is no voucher: the deleted one, a ledger's, one never used
  $max = ($all | ForEach-Object { [int64]$_.mid } | Measure-Object -Maximum).Maximum
  $lm = [regex]::Match((Post (Coll 'FCPLedMid' 'Ledger' 'NAME, MASTERID' '$Name = "Template Party"') '' 60), '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
  $odd = [ordered]@{ 'deleted-mid' = $(if ($del) { $del.mid }); 'ledger-mid' = $lm; 'never-mid' = "$($max + 5000)" }
  foreach ($k in $odd.Keys) {
    if (-not $odd[$k]) { Say "L small ${k}: none"; continue }
    $x = Post (OReq $odd[$k]) '' 60; SaveCap "l-small-$k-object.xml" $x
    $vm = [regex]::Match($x, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
    Say "L small ${k} ($($odd[$k])): $($script:lastMs) ms, $($x.Length) chars, vouchers $(([regex]::Matches($x, '<VOUCHER[ >]')).Count), MasterID in the answer '$vm', type '$([regex]::Match($x, '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value)'; $([regex]::Match($x, '<LINEERROR>[^<]*').Value)"
  }
  # M3 on 100,000 vouchers: the company grown in place (the heavy masters and vouchers of pushm.ps1, with the godown)
  if ($rel -in '7.1', '3.0' -or $env:PD_L_GROW -eq 'all') {
    ImpMasters (HeavyMasters 300 300) 'heavy masters'
    $dates = HeavyDates
    for ($k = 0; $k -lt 100000; $k += 1000) {
      $b = @(); for ($j = $k; $j -lt $k + 1000; $j++) { $b += HeavyVoucher $j $dates 270 30 300 }
      $r = Imp 'Vouchers' $b "vouchers $k-$($k + 999)"
      if ($r.created -lt 1000) { Say "HARNESS: vouchers $k-$($k + 999): only $($r.created) made" }
    }
    foreach ($b in @(@('BIG200-2', 200), @('BIG500-2', 500))) { Imp 'Vouchers' @(Big $b[0] $b[1] '20261102') "invoice $($b[0]) (at 100,000)" | Out-Null }
    if (-not (Start-T $light @() 'l-100k')) { Say 'HARNESS: the grown company did not open'; return }
    $nAll = Count 'Voucher'
    $all = AllV '$Date >= $$Date:"01-10-2026"'
    Say "grown: $nAll vouchers"
    foreach ($v in @($all | Where-Object { $_.vno -like 'BIG*' -or $_.vno -in 'TS5-1', 'TR-1' })) { Ask3 'big' $v (("$($v.type)-$($v.vno)" -replace '[^\w-]', '_').ToLower()) 5 }
  }
} catch { Say "HARNESS: fast234l stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Say 'done (fast234 fast234l)'
