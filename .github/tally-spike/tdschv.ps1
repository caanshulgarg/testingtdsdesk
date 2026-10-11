# Mode tdsch (MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally). Dot-sourced by flowv.ps1 after
# c2; no bridge is installed, nothing of the bridge, the add-on, the cloud or the app is changed. Where Tally keeps a TDS
# challan's details and the TDS master settings, as the bridge's EXISTING requests get them back (FinComVoucherObject,
# requests/entry-object.xml of the ref; FinComLedgers, ledreq/ledlist-tail.xml of the ref) and as Tally's own full export
# shows them (harness only):
#   1. masters: the company's TDS (tdsgst/masters.json: company and ledgers by XML); two natures of payment typed on their
#      own form with a threshold; a TDS duty ledger typed with its nature, another by XML (TDSRATENAME); party ledgers by
#      XML with deductee types (company, individual, HUF, firm) and PAN; a lower-deduction party whose lists
#      (LOWERDEDUCTION.LIST, TDSCATEGORYDETAILS.LIST, TDSEXEMPTIONRULES.LIST) are first imported with one field so Tally's
#      List of Accounts export shows every field of the list, then filled by name and read back
#   2. deductions: one Journal typed on the screen (tds240's keys), five by XML (TDS allocation and the TDS bill), a purchase
#   3. the payment: Payment (F5), Ctrl+F / Alt+S Stat Payment, TDS for November 2026, the bank, accepted (keys, each screen
#      read by OCR); a second payment by XML with the challan tags, an interest line and Agst Ref bills (also the fallback)
#   4. the challan details: Go To, Challan Reconciliation, distinct values typed (BSR 0240020, challan 12345, challan date
#      2-12-2026, cheque 456789, 31-12-2026), each try checked by the payment's object answer
#   5. kept: obj-<id>.xml (raw FinComVoucherObject answer), full-<id>.xml (the voucher with every stored field and list),
#      month exports, ledlist-raw.xml (raw FinComLedgers answer), masters.xml (List of Accounts), natures.xml (TDSRate)
# Judged on Linux from the captures. Here: h1-h5, each PASS (made / kept) or HARNESS (the harness could not), with which
# way (keys or XML) each thing was made.
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 60 }
$script:TdsCo = $co1
$script:TdsRestart = {
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'tdsch-restarted'
}
$H1 = 'h1 TDS masters made (natures with threshold, duty ledgers with nature, parties with deductee type, PAN, lower deduction)'
$H2 = 'h2 TDS deductions made (keys and XML)'
$H3 = 'h3 TDS payment by Stat Payment (keys) and by XML'
$H4 = 'h4 challan details on the payment (Challan Reconciliation keys, else XML)'
$H5 = 'h5 raw answers kept (FinComVoucherObject, FinComLedgers, Tally full exports)'
$hDone = @{}
function HRes($c, $st, $ev) { if (-not $hDone[$c]) { Result $c $st $ev; $hDone[$c] = $true } }
function XSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function XCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; return [pscustomobject]@{ c = 0; a = 0; e = -1; line = ("$r" -replace '\s+', ' ').Substring(0, [Math]::Min(300, ("$r" -replace '\s+', ' ').Length)) } }
function XImp($report, $msg, $label) { $r = Imp $report $msg $label; $k = XCount $r; Info ("tdsch {0}: created {1}, altered {2}, errors {3}{4}" -f $label, $k.c, $k.a, $k.e, $(if ($k.line) { "; Tally said: $($k.line)" } else { '' })); return $k }
function LE([string]$s) { [Security.SecurityElement]::Escape($s) }
# every non-empty tag of a text whose name matches, with its path (lists and VOUCHER / LEDGER only), for the INFO lines
function TagVals([string]$t, [string]$pat) {
  $st = New-Object System.Collections.Generic.List[string]; $o = @(); $last = 0
  foreach ($m in [regex]::Matches($t, '<(/?)([A-Za-z_][\w.]*)([^>]*?)(/?)>')) {
    $txt = $t.Substring($last, $m.Index - $last); $last = $m.Index + $m.Length
    if ($m.Groups[1].Value) {
      if ($st.Count -and $st[$st.Count - 1] -eq $m.Groups[2].Value) {
        $n = $st[$st.Count - 1]
        if ($n -match $pat -and $txt.Trim()) { $p = (@($st | Where-Object { $_ -like '*.LIST' -or $_ -eq 'VOUCHER' -or $_ -eq 'LEDGER' }) -join '/'); $o += "$p/$n=$($txt.Trim())" }
        $st.RemoveAt($st.Count - 1)
      }
      continue
    }
    if (-not $m.Groups[4].Value) { $st.Add($m.Groups[2].Value) }
  }
  return ($o | Select-Object -Unique)
}
$NAT1 = 'FC Contract 194C'; $NAT2 = 'FC Prof Fees 194J'
$DUTYK = 'FC TDS 194C Keys'; $DUTYX = 'FC TDS 194J XML'
$EK = 'FC Contract Exp'; $EP = 'FC Prof Exp'
$PT = [ordered]@{ co = @('FC Party Company', 'Company - Resident', 'AAACF0001A'); ind = @('FC Party Individual', 'Individual/HUF - Resident', 'ABCPF0002B'); huf = @('FC Party HUF', 'Individual/HUF - Resident', 'AAAHF0003C'); firm = @('FC Party Firm', 'Partnership Firm', 'AABFF0004D'); ldc = @('FC LDC Party', 'Company - Resident', 'AAACL0005E') }
$made = [ordered]@{}   # id -> how it was made (keys / XML)
try {
  Say '---- tdsch: masters'
  $M = Get-Content (Join-Path $PSScriptRoot 'tdsgst\masters.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in $M.steps) { if ($s[0] -in @('company', 'ledgers')) { $null = XImp 'All Masters' $s[1] "masters.json $($s[0])" } }
  # natures of payment on their own form, a threshold typed (the form of 7.1: Name, Section, Payment code, Remittance code,
  # rate individuals/HUF, rate others, Is zero rated, Threshold/exemption limit)
  function NatureKeys([string]$name, [string]$sec, [string]$pay, [string]$rI, [string]$rO, [string]$thr) {
    if (TdsHas 'TDSRate' $name) { TdsSay "nature '$name' is there already"; return $true }
    if (-not (TdsOpenCreate 'TDS Nature of Payments' 'Nature|Section')) { return $false }
    $null = TK ((SK $name) + '{ENTER}') 1.5 'nat-name'
    $null = TK ((SK $sec) + '{ENTER}') 1.5 'nat-section'
    $null = TK ((SK $pay) + '{ENTER}') 1.5 'nat-paycode'
    $null = TK '{ENTER}' 1.5 'nat-remit'
    $null = TK ($rI + '{ENTER}') 1.5 'nat-rate-ind'
    $null = TK ($rO + '{ENTER}') 1.5 'nat-rate-oth'
    # tds240 (run 37820758173, 7.1): one Enter after the rate of others brought "Accept?": the cursor then stood on the
    # threshold. The threshold is typed; if no "Accept?" follows (the cursor was on "Is zero rated"), it is typed again
    for ($i = 1; $i -le 3; $i++) {
      $t = TdsScreen "nat-before-thr$i"
      if ($t -match 'Yes or No|Accept \?') { break }
      $null = TK ($thr + '{ENTER}') 1.5 "nat-thr$i"
    }
    $t = TdsScreen 'nat-accept-q'
    if ($t -match 'Yes or No|Accept') { $null = TK 'y' 2.5 'nat-yes' } else { $null = TK '^a' 2.5 'nat-ctrl-a'; $t = TdsScreen 'nat-accept-q2'; if ($t -match 'Yes or No') { $null = TK 'y' 2.5 'nat-yes2' } }
    $null = TK '{ESC}' 2 'nat-esc1'; $null = TK '{ESC}' 2 'nat-esc2'
    $ok = TdsHas 'TDSRate' $name; TdsSay "nature '$name' in Tally's export (TDSRate): $ok"
    $null = TdsGateway 'after the nature'; return $ok
  }
  $natOk1 = $false; $natOk2 = $false
  try { $natOk1 = NatureKeys $NAT1 '194C' '94C' '1' '2' '30000' } catch { Write-Host "tdsch nature 1: $_" }
  try { $natOk2 = NatureKeys $NAT2 '194J' '94J' '10' '10' '30000' } catch { Write-Host "tdsch nature 2: $_" }
  $made['nature1'] = "keys $natOk1"; $made['nature2'] = "keys $natOk2"
  # a nature by XML too (TDSRATE, the names Tally's TDSRate export gives), to see whether an import makes one
  $null = XImp 'All Masters' '<TDSRATE NAME="FC XML Nature 194H" ACTION="Create"><NAME.LIST><NAME>FC XML Nature 194H</NAME></NAME.LIST><NAME>FC XML Nature 194H</NAME><SECTIONNUMBER>194H</SECTIONNUMBER><PAYMENTCODE>94H</PAYMENTCODE></TDSRATE>' 'nature by XML (TDSRATE)'
  $natX = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FcNat</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FcNat" ISMODIFY="No"><TYPE>TDSRate</TYPE><FETCH>*, *.*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'natures' 120
  XSave 'natures.xml' $natX
  $natNames = @([regex]::Matches("$natX", '<TDSRATE NAME="([^"]*)"') | ForEach-Object { $_.Groups[1].Value })
  Info "tdsch: natures in Tally (TDSRate): $($natNames.Count): $(($natNames | Select-Object -First 40) -join ', ')"
  $nk = [regex]::Match("$natX", '(?s)<TDSRATE NAME="' + [regex]::Escape($NAT1) + '".*?</TDSRATE>').Value
  Info "tdsch: nature '$NAT1' non-empty fields: $((TagVals $nk '.') -join ' | ')"
  if (-not $natOk1) { $NAT1use = @($natNames | Where-Object { $_ -match 'Contract' })[0] } else { $NAT1use = $NAT1 }
  if (-not $natOk2) { $NAT2use = @($natNames | Where-Object { $_ -match 'Profession' })[0] } else { $NAT2use = $NAT2 }
  if (-not $NAT1use) { $NAT1use = $NAT1 }; if (-not $NAT2use) { $NAT2use = $NAT2 }
  Info "tdsch: natures used: 194C '$NAT1use', 194J '$NAT2use'"

  # the expense ledgers (XML, as tds240) and the duty ledger by XML with its nature (TDSRATENAME, tds240's form)
  $led = ('<LEDGER NAME="' + $EK + '" ACTION="Create"><NAME.LIST><NAME>' + $EK + '</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><ISTDSEXPENSE>Yes</ISTDSEXPENSE><TDSAPPLICABLE>' + (LE $NAT1use) + '</TDSAPPLICABLE><TDSCATEGORYNAME>' + (LE $NAT1use) + '</TDSCATEGORYNAME><TDSRATENAME>' + (LE $NAT1use) + '</TDSRATENAME></LEDGER>') +
    ('<LEDGER NAME="' + $EP + '" ACTION="Create"><NAME.LIST><NAME>' + $EP + '</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><ISTDSEXPENSE>Yes</ISTDSEXPENSE><TDSAPPLICABLE>' + (LE $NAT2use) + '</TDSAPPLICABLE><TDSCATEGORYNAME>' + (LE $NAT2use) + '</TDSCATEGORYNAME><TDSRATENAME>' + (LE $NAT2use) + '</TDSRATENAME></LEDGER>') +
    ('<LEDGER NAME="' + $DUTYX + '" ACTION="Create"><NAME.LIST><NAME>' + $DUTYX + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><TAXTYPE>TDS</TAXTYPE><TDSRATENAME>' + (LE $NAT2use) + '</TDSRATENAME><TDSCATEGORYNAME>' + (LE $NAT2use) + '</TDSCATEGORYNAME></LEDGER>')
  $null = XImp 'All Masters' $led 'expense ledgers and the XML duty ledger'
  # the duty ledger typed: Name, Under Duties & Taxes, Type of duty/tax TDS, Nature of payment, accepted
  $dkOk = $false
  try { $dkOk = TdsLedgerScreen $DUTYK 'Duties & Taxes' @(@('TDS{ENTER}', ''), @(((SK $NAT1use) + '{ENTER}'), ''), @('{ENTER}', ''), @('{ENTER}', '')) } catch { Write-Host "tdsch duty ledger keys: $_" }
  $made['duty-keys'] = "keys $dkOk"
  if (-not $dkOk) { $null = XImp 'All Masters' ('<LEDGER NAME="' + $DUTYK + '" ACTION="Create"><NAME.LIST><NAME>' + $DUTYK + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>TDS</TAXTYPE><TDSRATENAME>' + (LE $NAT1use) + '</TDSRATENAME></LEDGER>') 'duty ledger 194C (XML, the keys made none)'; $made['duty-keys'] = 'XML (keys failed)' }

  # the parties: deductee types and PAN; the lower-deduction party's lists probed with one field each
  $px = ''
  foreach ($k in $PT.Keys) {
    $p = $PT[$k]
    $x = '<LEDGER NAME="' + $p[0] + '" ACTION="Create"><NAME.LIST><NAME>' + $p[0] + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><INCOMETAXNUMBER>' + $p[2] + '</INCOMETAXNUMBER><LEDSTATENAME>Delhi</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>' + $p[1] + '</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><DEDUCTINSAMEVCHRULES.LIST><DATE>20260401</DATE><DEDUCTINSAMEVCH>Yes</DEDUCTINSAMEVCH></DEDUCTINSAMEVCHRULES.LIST>'
    if ($k -eq 'ldc') { $x += '<LOWERDEDUCTION.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM></LOWERDEDUCTION.LIST><TDSCATEGORYDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM></TDSCATEGORYDETAILS.LIST><TDSEXEMPTIONRULES.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM></TDSEXEMPTIONRULES.LIST>' }
    $px += $x + '</LEDGER>'
  }
  $null = XImp 'All Masters' $px 'parties (deductee types, PAN, the lower-deduction probe)'
  $listAcc = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
  # run 38147459474: List of Accounts writes these lists empty (DEDUCTINSAMEVCHRULES.LIST too, though it was given), so
  # each list is read by a Ledger collection fetching it; the lists are given with candidate field names (a name Tally
  # does not have is dropped, one it has makes the element, whose fields the fetch then shows)
  function LedLists([string]$name, [string]$tag) {
    $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FcLed</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FcLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>*, LOWERDEDUCTION.*, TDSCATEGORYDETAILS.*, TDSEXEMPTIONRULES.*, DEDUCTINSAMEVCHRULES.*</FETCH><FILTERS>FcLedF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FcLedF">$Name = "' + $name + '"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "ledger lists $tag" 60
    XSave "ledger-lists-$tag.xml" $x
    foreach ($lst in 'LOWERDEDUCTION.LIST', 'TDSCATEGORYDETAILS.LIST', 'TDSEXEMPTIONRULES.LIST', 'DEDUCTINSAMEVCHRULES.LIST') {
      $blk = [regex]::Match("$x", '(?s)<' + [regex]::Escape($lst) + '>(.*?)</' + [regex]::Escape($lst) + '>').Groups[1].Value
      $flds = @([regex]::Matches($blk, '<([A-Z][A-Z0-9_]*)(?:\s[^>]*)?/?>') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
      Info "tdsch: $name $lst ($tag): fields $($flds -join ', '); values: $((TagVals $blk '.') -join ' | ')"
    }
  }
  LedLists 'FC LDC Party' 'as-made'
  $cand = '<DATE>20260401</DATE><APPLICABLEFROM>20260401</APPLICABLEFROM><APPLICABLETO>20270331</APPLICABLETO><FROMDATE>20260401</FROMDATE><TODATE>20270331</TODATE><STARTDATE>20260401</STARTDATE><ENDDATE>20270331</ENDDATE><VALIDFROM>20260401</VALIDFROM><VALIDTO>20270331</VALIDTO>' +
    '<CERTIFICATENO>LDC197CERT0001</CERTIFICATENO><CERTIFICATENUMBER>LDC197CERT0001</CERTIFICATENUMBER><CERTIFICATEDATE>20260415</CERTIFICATEDATE><LOWERDEDNCERTNO>LDC197CERT0001</LOWERDEDNCERTNO><TDSCERTIFICATENO>LDC197CERT0001</TDSCERTIFICATENO>' +
    '<SECTIONNUMBER>197</SECTIONNUMBER><SECTION>197</SECTION><TDSSECTION>197</TDSSECTION><CATEGORY>' + (LE $NAT2use) + '</CATEGORY><CATEGORYNAME>' + (LE $NAT2use) + '</CATEGORYNAME><TDSRATENAME>' + (LE $NAT2use) + '</TDSRATENAME><NATUREOFPAYMENT>' + (LE $NAT2use) + '</NATUREOFPAYMENT>' +
    '<RATE>1</RATE><TDSRATE>1</TDSRATE><RATEOFTAX>1</RATEOFTAX><LOWERRATE>1</LOWERRATE><TAXRATE>1</TAXRATE>' +
    '<LIMIT>500000.00</LIMIT><AMOUNTLIMIT>500000.00</AMOUNTLIMIT><EXEMPTIONLIMIT>500000.00</EXEMPTIONLIMIT><THRESHOLDLIMIT>500000.00</THRESHOLDLIMIT><AMOUNT>500000.00</AMOUNT><MAXAMOUNT>500000.00</MAXAMOUNT>'
  $null = XImp 'All Masters' ('<LEDGER NAME="FC LDC Party" ACTION="Alter"><NAME.LIST><NAME>FC LDC Party</NAME></NAME.LIST><TDSDEDUCTEEISSPECIALRATE>Yes</TDSDEDUCTEEISSPECIALRATE><TDSDEDUCTEESPECIALRATE>1</TDSDEDUCTEESPECIALRATE><LOWERDEDUCTION.LIST>' + $cand + '</LOWERDEDUCTION.LIST><TDSCATEGORYDETAILS.LIST>' + $cand + '</TDSCATEGORYDETAILS.LIST><TDSEXEMPTIONRULES.LIST>' + $cand + '</TDSEXEMPTIONRULES.LIST></LEDGER>') 'the lower-deduction party, candidate field names (XML)'
  LedLists 'FC LDC Party' 'candidates'
  # the party ledger's own form, walked by Enter (screens kept: where the lower deduction is asked on 7.1), left unchanged
  try {
    $null = TdsGateway 'before the ledger tour'
    if (TK 'a' 2 'tour-alter' 'Alteration|List of Masters') {
      $null = TK ('{BACKSPACE}' * 30) 0.5
      $null = TK ((SK 'Ledger') + '{ENTER}') 2 'tour-ledger'
      $null = TK ((SK 'FC LDC Party') + '{ENTER}') 2.5 'tour-form'
      for ($i = 1; $i -le 28; $i++) { $t = TdsScreen ("tour-{0:d2}" -f $i); if ($t -match 'Yes or No|Accept \?') { break }; & $script:TdsSend '{ENTER}'; Start-Sleep 1.2 }
      $null = TK '{ESC}' 2 'tour-esc'
    }
    $null = TdsGateway 'after the ledger tour'
  } catch { Write-Host "tdsch ledger tour: $_" }
  $made['ldc'] = 'XML (candidate field names, read by a Ledger collection); the ledger form walked by keys (screens)'

  Say '---- tdsch: deductions'
  $vs0 = Vouchers
  # K1: a Journal typed on the screen (tds240's keys, run 37820758173 on 7.1)
  $kOk = $false
  try {
    $null = TdsGateway 'before the TDS entry'
    $null = TK 'v' 2.5 'k1-vouchers' 'Voucher'
    $null = TK '{F7}' 2.5 'k1-journal' 'Journal'
    $null = TK '{F2}' 1.5 'k1-date-box' 'Date'
    $null = TK '1-11-2026{ENTER}' 2 'k1-date-set'
    $null = TK ((SK $EK) + '{ENTER}') 2 'k1-r1-ledger'
    $null = TK '100000{ENTER}' 2 'k1-r1-amount'
    for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "k1-r1-after$j"; if ($t -match 'Cost Centre Alloc|Cost Allocations|Details for|Bill-wise|Assessable|Nature of Pay|Tax Details') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
    $null = TK 't{ENTER}' 1.5 'k1-r2-to'
    $null = TK ((SK $DUTYK) + '{ENTER}') 2.5 'k1-r2-ledger'
    for ($j = 1; $j -le 5; $j++) { $t = TdsScreen "k1-r2-sub$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Deductee|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
    $t = TdsScreen 'k1-r2-amount-shown'
    if ($t -match '2,000|2000') { $null = TK '{ENTER}' 2 'k1-r2-amount-tally' } else { $null = TK '2000{ENTER}' 2 'k1-r2-amount-typed' }
    for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "k1-r2-after$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
    $null = TK 't{ENTER}' 1.5 'k1-r3-to'
    $null = TK ((SK $PT.co[0]) + '{ENTER}') 2.5 'k1-r3-ledger'
    $t = TdsScreen 'k1-r3-amount-shown'
    if ($t -match '98,000|98000') { $null = TK '{ENTER}' 2 'k1-r3-amount' } else { $null = TK '98000{ENTER}' 2 'k1-r3-amount-typed' }
    # the party is bill-wise: its bill (New Ref) accepted as Tally offers it
    for ($j = 1; $j -le 8; $j++) { $t = TdsScreen "k1-r3-after$j"; if ($t -match 'Bill-wise|Details for|Assessable|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations|Type of Ref|New Ref') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
    $t = TdsScreen 'k1-before-narration'
    if ($t -notmatch 'Narration') { $null = TK '{ENTER}' 2 'k1-rows-done' }
    $null = TK ((SK 'K1 TDS deduction typed on the screen') + '{ENTER}') 2 'k1-narration'
    $t = TdsScreen 'k1-accept-q'
    if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 'k1-accepted' } else { $null = TK '^a' 3 'k1-ctrl-a'; $t = TdsScreen 'k1-accept-q2'; if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 'k1-accepted2' } }
    $null = TdsGateway 'after the TDS entry'
  } catch { Write-Host "tdsch K1 keys: $_" }
  $vs1 = Vouchers
  $k1 = @($vs1 | Where-Object { "$($_.mid)" -notin @($vs0 | ForEach-Object { "$($_.mid)" }) })
  if ($k1.Count) { $kOk = $true; $made['K1'] = "keys (mid $($k1[0].mid))" } else { $made['K1'] = 'keys: no entry saved' }
  # X1..X5 by XML: the TDS allocation (nature, party, rate, base, tax, its ref) and the TDS bill on the duty ledger line
  function DedXml($id, $date, $exp, $duty, $nat, $party, $base, $rate, $note) {
    $tax = [math]::Round($base * $rate / 100, 2); $net = $base - $tax
    return '<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>' + $date + '</DATE><EFFECTIVEDATE>' + $date + '</EFFECTIVEDATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>JV/' + $id + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + $party + '</PARTYLEDGERNAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>' + $id + ' ' + $note + '</NARRATION>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $exp + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + ('{0:0.00}' -f $base) + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $duty + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f $tax) + '</AMOUNT>' +
      '<TAXOBJECTALLOCATIONS.LIST><CATEGORY>' + (LE $nat) + '</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>' + $party + '</PARTYLEDGER><REFTYPE>New Ref</REFTYPE><ISPANVALID>Yes</ISPANVALID><SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>' + $duty + '</DUTYLEDGER><TAXRATE>' + $rate + '</TAXRATE><ASSESSABLEAMOUNT>' + ('{0:0.00}' -f $base) + '</ASSESSABLEAMOUNT><TAX>' + ('{0:0.00}' -f $tax) + '</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $party + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f $net) + '</AMOUNT><BILLALLOCATIONS.LIST><NAME>JV/' + $id + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>' + ('{0:0.00}' -f $net) + '</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>'
  }
  $ded = @(
    @('X1', '20261101', $EK, $DUTYK, $NAT1use, $PT.co[0], 150000, 2, 'contract, company, 194C 2%'),
    @('X2', '20261101', $EK, $DUTYK, $NAT1use, $PT.ind[0], 50000, 1, 'contract, individual, 194C 1%'),
    @('X3', '20261102', $EK, $DUTYK, $NAT1use, $PT.huf[0], 40000, 1, 'contract, HUF, 194C 1%'),
    @('X4', '20261102', $EP, $DUTYX, $NAT2use, $PT.firm[0], 80000, 10, 'professional fees, firm, 194J 10%'),
    @('X5', '20261102', $EP, $DUTYX, $NAT2use, $PT.ldc[0], 200000, 1, 'professional fees, lower deduction certificate 1%'))
  foreach ($d in $ded) {
    $x = DedXml $d[0] $d[1] $d[2] $d[3] $d[4] $d[5] $d[6] $d[7] $d[8]
    $k = XImp 'Vouchers' $x "deduction $($d[0])"
    if ($k.c -ne 1) { $k = XImp 'Vouchers' ($x -replace '(?s)<BILLALLOCATIONS\.LIST><NAME>TDS/.*?</BILLALLOCATIONS\.LIST>', '') "deduction $($d[0]) without the TDS bill"; if ($k.c -eq 1) { $made[$d[0]] = 'XML (no TDS bill: refused with it)' } }
    else { $made[$d[0]] = 'XML' }
  }
  # a purchase with TDS (XML)
  $pu = (DedXml 'X6' '20261102' $EK $DUTYK $NAT1use $PT.firm[0] 60000 2 'purchase with TDS 194C') -replace 'VCHTYPE="Journal"', 'VCHTYPE="Purchase"' -replace '<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>', '<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>' -replace 'JV/X6', 'PUR/X6'
  $k = XImp 'Vouchers' $pu 'deduction X6 (Purchase)'; if ($k.c -eq 1) { $made['X6'] = 'XML (Purchase)' }
  $nd = @($made.Keys | Where-Object { $_ -match '^(K1|X\d)$' -and $made[$_] -notmatch 'no entry' }).Count
  HRes $H2 $(if ($nd -ge 5) { 'PASS' } else { 'HARNESS' }) ("{0} deductions made: {1}" -f $nd, (($made.Keys | Where-Object { $_ -match '^(K1|X\d)$' } | ForEach-Object { "$_ $($made[$_])" }) -join '; '))

  Say '---- tdsch: the payment by Stat Payment (keys)'
  $vsA = Vouchers
  $spOk = $false; $spHow = ''
  try {
    $null = TdsGateway 'before the payment'
    $null = TK 'v' 2.5 'sp-vouchers' 'Voucher'
    $null = TK '{F5}' 2.5 'sp-payment' 'Payment'
    $null = TK '{F2}' 1.5 'sp-date-box' 'Date'
    $null = TK '1-12-2026{ENTER}' 2 'sp-date-set'
    $t = TdsScreen 'sp-form'
    # single entry mode (7.1's default for a payment): the Account comes first
    if ($t -match 'Account') { $null = TK ((SK 'HDFC Bank') + '{ENTER}') 2 'sp-account' }
    # run 38147459474 (7.1): Ctrl+F opens "Autofill", its list "Type of Autofill" (Stat Payment ...); the box then has Type
    # of transaction (Stat Payment), Tax Type (GST by default), Type of Payment, Period From / To (the last month)
    $null = TK '^f' 2.5 'sp-autofill'
    $null = TK ((SK 'Stat Payment') + '{ENTER}') 2.5 'sp-type-of-autofill'
    $t = TdsScreen 'sp-box'
    if ($t -match 'Tax Type|Type of transaction|Stat Payment') { $spHow = 'Ctrl+F Autofill, Stat Payment' }
    $null = TK ((SK 'TDS') + '{ENTER}') 2 'sp-taxtype'
    $t = TdsScreen 'sp-taxtype-check'
    if ($t -match 'Spelling Error|Oops') {
      # the cursor stood on "Type of transaction": cleared, kept, then the tax type
      $null = TK '{BACKSPACE}{BACKSPACE}{BACKSPACE}' 1 'sp-bs'; $null = TK '{ENTER}' 1.5 'sp-keep-type'
      $null = TK ((SK 'TDS') + '{ENTER}') 2 'sp-taxtype2'
      $t = TdsScreen 'sp-taxtype-check2'
      if ($t -match 'Spelling Error|Oops') { $null = TK '{BACKSPACE}{BACKSPACE}{BACKSPACE}' 1 'sp-bs2'; $null = TK '{ENTER}' 1.5 'sp-keep2' }
    }
    # the other fields as Tally offers them (type of payment, period, section / nature, deductee status...), defaults kept
    for ($j = 1; $j -le 10; $j++) {
      $t = TdsScreen "sp-box-$j"
      if ($t -match 'Yes or No|Accept \?') { & $script:TdsSend 'y'; Start-Sleep 3; break }
      if ($t -match 'Spelling Error|Oops') { & $script:TdsSend '{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}{BACKSPACE}'; Start-Sleep 1 }
      if ($t -match 'Tax Type|Type of Payment|Period|Section|Nature of Pay|Deductee|Resident') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break }
    }
    $t = TdsScreen 'sp-after-box'
    if ($t -match 'Tax Type|Type of Payment' -and $t -match 'Autofill') { $null = TK '^a' 3 'sp-box-ctrl-a'; $t = TdsScreen 'sp-box-after-ctrl-a'; if ($t -match 'Yes or No|Accept \?') { $null = TK 'y' 3 'sp-box-yes' } }
    $t = TdsScreen 'sp-filled'
    if ($t -match 'Autofill' -and $t -match 'Tax Type') { Info "tdsch: the Stat Payment box did not close: $t" }
    for ($j = 1; $j -le 8; $j++) {
      $null = TK '^a' 2.5 "sp-ctrl-a$j"; $t = TdsScreen "sp-after-accept$j"
      if ($t -match 'Yes or No|Accept \?') { $null = TK 'y' 3 "sp-yes$j"; $t = TdsScreen "sp-after-yes$j" }
      if ($t -match 'Payment No' -and $t -notmatch 'Bank Allocation|Yes or No|Autofill') { break }
    }
    $null = TdsGateway 'after the payment'
  } catch { Write-Host "tdsch payment keys: $_" }
  $vsB = Vouchers
  $sp = @($vsB | Where-Object { "$($_.mid)" -notin @($vsA | ForEach-Object { "$($_.mid)" }) -and $_.type -match 'Payment' })
  if ($sp.Count) { $spOk = $true; $made['SP1'] = "keys ($spHow; mid $($sp[0].mid))" } else { $made['SP1'] = "keys: no payment saved (stat payment key '$spHow')" }
  # PX1 by XML: the challan tags the voucher's schema has (every release's object answer lists them), an interest line,
  # Agst Ref bills and TDS allocations to X4 and X5 (the fallback, and what an import keeps)
  $px1 = '<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261202</DATE><EFFECTIVEDATE>20261202</EFFECTIVEDATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PX1</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>PX1 TDS payment by XML, 194J, November 2026</NARRATION>' +
    '<STATPAYMENTTYPE>TDS</STATPAYMENTTYPE><TAXPAYPERIODFROMDATE>20261101</TAXPAYPERIODFROMDATE><TAXPAYPERIODTODATE>20261130</TAXPAYPERIODTODATE><TDSNATUREOFPAYMENT>' + (LE $NAT2use) + '</TDSNATUREOFPAYMENT><TDSSECTIONNO>194J</TDSSECTIONNO>' +
    '<TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>54321</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>20261231</TAXCHALLANDATE><TAXCHEQUENUMBER>778899</TAXCHEQUENUMBER><TAXCHEQUEDATE>20261201</TAXCHEQUEDATE><TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME><TAXBANKBRANCHNAME>Connaught Place</TAXBANKBRANCHNAME>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTYX + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10000.00</AMOUNT><TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2use) + '</STATNATURENAME>' +
    '<BILLALLOCATIONS.LIST><NAME>TDS/X4</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>-8000.00</AMOUNT></BILLALLOCATIONS.LIST><BILLALLOCATIONS.LIST><NAME>TDS/X5</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>-2000.00</AMOUNT></BILLALLOCATIONS.LIST>' +
    '<TAXOBJECTALLOCATIONS.LIST><NAME>TDS/X4</NAME><CATEGORY>' + (LE $NAT2use) + '</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>' + $PT.firm[0] + '</PARTYLEDGER><REFTYPE>Agst Ref</REFTYPE><TDSCHALLANNUMBER>54321</TDSCHALLANNUMBER><TDSCHALLANDATE>20261231</TDSCHALLANDATE><SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>' + $DUTYX + '</DUTYLEDGER><TAX>-8000.00</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST>' +
    '<TAXOBJECTALLOCATIONS.LIST><NAME>TDS/X5</NAME><CATEGORY>' + (LE $NAT2use) + '</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>' + $PT.ldc[0] + '</PARTYLEDGER><REFTYPE>Agst Ref</REFTYPE><TDSCHALLANNUMBER>54321</TDSCHALLANNUMBER><TDSCHALLANDATE>20261231</TDSCHALLANDATE><SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>' + $DUTYX + '</DUTYLEDGER><TAX>-2000.00</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTYX + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-150.00</AMOUNT><TYPEOFTAXPAYMENT>Interest</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2use) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $DUTYX + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT><TYPEOFTAXPAYMENT>Late Fee</TYPEOFTAXPAYMENT><STATNATURENAME>' + (LE $NAT2use) + '</STATNATURENAME></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10350.00</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261202</DATE><INSTRUMENTDATE>20261201</INSTRUMENTDATE><NAME>PX1</NAME><TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE><INSTRUMENTNUMBER>778899</INSTRUMENTNUMBER><AMOUNT>10350.00</AMOUNT></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $k = XImp 'Vouchers' $px1 'payment PX1 (XML)'
  if ($k.c -ne 1) { $k = XImp 'Vouchers' ($px1 -replace '(?s)<BANKALLOCATIONS\.LIST>.*?</BANKALLOCATIONS\.LIST>', '') 'payment PX1 (XML, no bank allocation)' }
  if ($k.c -eq 1) { $made['PX1'] = 'XML' } else { $made['PX1'] = "XML refused: $($k.line)" }
  HRes $H3 $(if ($spOk) { 'PASS' } elseif ($made['PX1'] -eq 'XML') { 'HARNESS' } else { 'HARNESS' }) ("Stat Payment by keys: {0}; payment by XML: {1}" -f $made['SP1'], $made['PX1'])

  $vsC = Vouchers
  $byNarr = { param($pfx) @($vsC | Where-Object { $_.narr -like "$pfx *" })[0] }
  $ids = [ordered]@{}
  foreach ($id in 'K1', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'SP1', 'PX1') { $e = & $byNarr $id; if ($e) { $ids[$id] = "$($e.mid)" } }
  if (-not $ids['SP1'] -and $sp.Count) { $ids['SP1'] = "$($sp[0].mid)" }
  if (-not $ids['K1'] -and $k1.Count) { $ids['K1'] = "$($k1[0].mid)" }
  Info "tdsch: entries by MasterID: $(($ids.Keys | ForEach-Object { "$_=$($ids[$_])" }) -join ', ')"
  $reqFile = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  $tmpl = if (Test-Path $reqFile) { Get-Content $reqFile -Raw } else { '' }
  if ($tmpl) { Info "tdsch: the entry request of the ref (requests/entry-object.xml, SHA-256 $((Get-FileHash $reqFile -Algorithm SHA256).Hash.ToLower()))" }
  function ObjOf($mid) { if (-not $tmpl) { return '' }; $mid = TdsMid $mid; $null = Post $listCoXml ''; Post ($tmpl.Replace('FinCom Spike Co', $co1).Replace('ID:99999<', "ID:$mid<")) '' 30 }
  $fullFl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, ALLLEDGERENTRIES.TAXBILLALLOCATIONS.*, ALLLEDGERENTRIES.STPYMTDETAILS.*, ALLLEDGERENTRIES.TDSEXPENSEALLOCATIONS.*, LEDGERENTRIES.*'
  function FullOf($mid) { $mid = TdsMid $mid; Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FcFull</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FcFull" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fullFl + '</FETCH><FILTERS>FcFullF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FcFullF">$MasterID = ' + $mid + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60 }
  $chalPat = 'CHALLAN|BSR|TAXCHEQUE|TAXBANK|STATPAYMENT|TAXPAYPERIOD|TYPEOFTAXPAYMENT|STATNATURE|TDSNATUREOFPAYMENT|TDSSECTIONNO|^NAME$|BILLTYPE|REFTYPE|INSTRUMENT|BANKERSDATE'
  if ($ids['SP1']) {
    $o = ObjOf $ids['SP1']; XSave 'obj-SP1-before-challan.xml' $o; XSave 'full-SP1-before-challan.xml' (FullOf $ids['SP1'])
    Info "tdsch: SP1 (the Stat Payment typed) as the entry request answers it, before the challan: $((TagVals "$o" $chalPat) -join ' | ')"
  }

  Say '---- tdsch: the challan details (Challan Reconciliation, keys)'
  $chHow = ''
  $chId = if ($ids['SP1']) { 'SP1' } else { 'PX1' }
  if ($ids[$chId]) {
    $tries = @(
      @('A', @()),
      @('B', @('%s')))
    foreach ($tr in $tries) {
      try {
        $null = TdsGateway "before challan try $($tr[0])"
        $null = TK '%g' 2 "ch$($tr[0])-goto"
        $null = TK (SK 'Challan Reconciliation') 2 "ch$($tr[0])-typed"
        $null = TK '{ENTER}' 3 "ch$($tr[0])-open"
        $t = TdsScreen "ch$($tr[0])-report"
        if ($t -match 'List of|Select|Tax Type|Type of Tax|TDS' -and $t -notmatch 'Challan No') { $null = TK ((SK 'TDS') + '{ENTER}') 3 "ch$($tr[0])-tds" }
        $null = TK '{F2}' 1.5 "ch$($tr[0])-period"
        $t = TdsScreen "ch$($tr[0])-period-box"
        if ($t -match 'Period|From') { $null = TK '1-4-2026{ENTER}' 1; $null = TK '31-3-2027{ENTER}' 3 "ch$($tr[0])-period-set" } else { $null = TK '{ESC}' 1.5 }
        foreach ($k in $tr[1]) { $null = TK $k 2.5 "ch$($tr[0])-key" }
        # distinct values: whatever column each lands in, the stored tag shows which
        foreach ($v in '456789', '12345', '2-12-2026', '0240020', 'HDFC Bank Ltd', '31-12-2026') { $null = TK ((SK $v) + '{ENTER}') 1.5 "ch$($tr[0])-v$($v -replace '\W', '')" }
        $null = TK '^a' 2.5 "ch$($tr[0])-ctrl-a"
        $t = TdsScreen "ch$($tr[0])-accept-q"; if ($t -match 'Yes or No|Accept \?') { $null = TK 'y' 3 "ch$($tr[0])-yes" }
        $null = TdsGateway "after challan try $($tr[0])"
      } catch { Write-Host "tdsch challan try $($tr[0]): $_" }
      $o = ObjOf $ids[$chId]
      if ("$o" -match '>0240020<|>12345<') { $chHow = "keys try $($tr[0]) on $chId"; break }
    }
  }
  $made['challan'] = if ($chHow) { $chHow } else { 'keys made no change; the XML payment PX1 carries the challan tags' }
  if ($ids[$chId]) { $o = ObjOf $ids[$chId]; Info "tdsch: $chId after the challan keys: $((TagVals "$o" $chalPat) -join ' | ')" }
  if ($ids['PX1']) { $o = ObjOf $ids['PX1']; Info "tdsch: PX1 (XML) as the entry request answers it: $((TagVals "$o" $chalPat) -join ' | ')" }
  HRes $H4 $(if ($chHow) { 'PASS' } else { 'HARNESS' }) ("challan details: {0}" -f $made['challan'])

  Say '---- tdsch: the raw answers'
  $kept = @()
  foreach ($id in $ids.Keys) { $o = ObjOf $ids[$id]; XSave "obj-$id.xml" $o; XSave "full-$id.xml" (FullOf $ids[$id]); $kept += "$id $("$o".Length)/$($script:lastMs)ms" }
  foreach ($ym in '202611', '202612') {
    $y = [int]$ym.Substring(0, 4); $mo = [int]$ym.Substring(4, 2); $last = [DateTime]::DaysInMonth($y, $mo)
    XSave "month-$ym.xml" (Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FcDay</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>' + $ym + '01</SVFROMDATE><SVTODATE>' + $ym + $last + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FcDay" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fullFl + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "month $ym" 300)
  }
  # the bridge's ledger list (its own request at the ref: every ledger, MasterID above 0)
  $lq = Join-Path $env:BRIDGE_DIST 'ledreq\ledlist-tail.xml'; if (-not (Test-Path $lq)) { $lq = Join-Path $PSScriptRoot 'ledreq\ledlist-tail.xml' }
  $lr = (Get-Content $lq -Raw).Replace('@@CO@@', (LE $co1)).Replace('111111', '0').Trim()
  $lraw = Post $lr 'FinComLedgers' 120; XSave 'ledlist-raw.xml' $lraw; XSave 'ledlist-request.xml' $lr
  $mx = Post $listAcc 'masters' 300; XSave 'masters.xml' $mx
  $natX2 = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FcNat</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FcNat" ISMODIFY="No"><TYPE>TDSRate</TYPE><FETCH>*, *.*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'natures end' 120
  XSave 'natures-end.xml' $natX2
  $mPat = 'TDS|PAN|INCOMETAX|DEDUCT|LOWER|CERT|THRESH|EXEMPT|SECTION|RATE|LIMIT|APPLICABLE'
  foreach ($ln in @($DUTYK, $DUTYX, $PT.co[0], $PT.ind[0], $PT.huf[0], $PT.firm[0], $PT.ldc[0])) {
    $l = [regex]::Match("$mx", '(?s)<LEDGER NAME="' + [regex]::Escape($ln) + '".*?</LEDGER>').Value
    $lb = [regex]::Match("$lraw", '(?s)<LEDGER NAME="' + [regex]::Escape($ln) + '".*?</LEDGER>').Value
    Info "tdsch: ledger '$ln' in Tally's export: $((TagVals $l $mPat) -join ' | ')"
    Info "tdsch: ledger '$ln' in FinComLedgers' raw answer: $((TagVals $lb '.') -join ' | ')"
  }
  $nOk = ("$natX2" -match '30000|30,000')
  HRes $H1 $(if (($natOk1 -or $natOk2) -and $dkOk) { 'PASS' } else { 'HARNESS' }) ("{0}; threshold 30000 in the TDSRate export: {1}" -f (($made.Keys | Where-Object { $_ -match 'nature|duty|ldc' } | ForEach-Object { "$_ $($made[$_])" }) -join '; '), $nOk)
  HRes $H5 $(if ($kept.Count -and "$lraw" -match '<LEDGER') { 'PASS' } else { 'HARNESS' }) ("object answers (bytes / first ms): {0}; FinComLedgers raw {1} characters; masters {2}; natures {3}" -f ($kept -join ', '), "$lraw".Length, "$mx".Length, "$natX2".Length)
  Set-Content (Join-Path $out 'tds-screen-log.txt') $script:tdsLog -Encoding UTF8
} catch {
  Write-Host "tdsch stopped: $_ $($_.ScriptStackTrace)"
  Set-Content (Join-Path $out 'tds-screen-log.txt') $script:tdsLog -Encoding UTF8
  foreach ($c in @($H1, $H2, $H3, $H4, $H5)) { HRes $c 'HARNESS' "the harness stopped: $_" }
}
