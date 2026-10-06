# A probe of TallyPrime 7.1 EDU's screens and masters for the owner's scenario list (bridge 2.3.1): run instead of round 4
# when the workflow is dispatched with probe=yes. Nothing is checked: screenshots (r5-*) and Tally's own exports go to
# $env:RES\probe so the keys for each scenario can be written from what Tally shows.
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$data1 = "$env:RUNNER_TEMP\TallyData"; $co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'probe'; New-Item -ItemType Directory -Force $out | Out-Null
function Say($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function Shot($n) { & "$PSScriptRoot\shot.ps1" "r5-$n" }
function K($k, $wait = 2, $n = '') { & "$PSScriptRoot\keys.ps1" '^tally$' $k; Start-Sleep $wait; if ($n) { Shot $n } }
function Post($body, $label = '', $file = '') {
  try { $c = (Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60).Content } catch { $c = "failed: $($_.Exception.Message)" }
  if ($file) { Set-Content (Join-Path $out $file) $c -Encoding UTF8 }
  if ($label) { $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 1500) { $s = $s.Substring(0, 1500) + '...' }; Write-Host "[$label] $s" }
  return $c
}
function Imp($report, $msg, $label) { Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $label }
function Coll($type, $fetch, $file, $filter = '') {
  $f = if ($filter) { "<FILTERS>FCF</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"FCF`">$filter</SYSTEM>" } else { '</COLLECTION>' }
  Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCP</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCP" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "export $type" $file | Out-Null
}
# a GSTIN with its check character (the GSTN mod-36 rule)
function Gstin($first14) {
  $cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; $f = 2; $sum = 0
  for ($i = $first14.Length - 1; $i -ge 0; $i--) { $d = $f * $cs.IndexOf($first14[$i]); $f = if ($f -eq 2) { 1 } else { 2 }; $sum += [math]::Floor($d / 36) + ($d % 36) }
  $first14 + $cs[(36 - ($sum % 36)) % 36]
}

# ---- Tally with the company (as round 4 starts it)
$folder = Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1
Set-Content (Join-Path $dir 'tally.ini') -Encoding ASCII -Value @('[Tally]', "Data = $data1", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $($folder.Name)")
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
$t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
Start-Sleep 5; K 'a' 4; K 't' 10 '00-gateway'

# ---- Tally's own fields: company, the GST registration (tax unit), a ledger, a stock item, voucher types
Say '---- exports of Tally''s own objects (to learn the import tags)'
Coll 'Company' '*' 'company.xml'
foreach ($ty in 'TaxUnit', 'GSTRegistration', 'GST Registration') { Coll $ty '*' ("coll-$($ty -replace ' ', '').xml") }
Coll 'Ledger' '*' 'ledgers.xml'
Coll 'VoucherType' 'Name, Parent, IsActive' 'vouchertypes.xml'
Coll 'TDSNatureOfPayment' '*' 'tdsnature.xml'
Coll 'CostCategory' '*' 'costcategory.xml'

# ---- a GST registration by XML (Delhi, Regular), tried in the shapes Tally may take
$g = Gstin '07AAACF1234A1Z'; Write-Host "company GSTIN to try: $g"
Imp 'All Masters' ('<TAXUNIT NAME="Delhi Registration" ACTION="Create"><NAME.LIST><NAME>Delhi Registration</NAME></NAME.LIST><STATENAME>Delhi</STATENAME><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTREGNUMBER>' + $g + '</GSTREGNUMBER><GSTIN>' + $g + '</GSTIN><TAXTYPE>GST</TAXTYPE><GSTAPPLICABLEDATE>20260401</GSTAPPLICABLEDATE></TAXUNIT>') 'import TAXUNIT' | Out-Null
Imp 'All Masters' ('<GSTREGISTRATION NAME="Delhi Registration 2" ACTION="Create"><NAME>Delhi Registration 2</NAME><STATENAME>Delhi</STATENAME><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTIN>' + $g + '</GSTIN></GSTREGISTRATION>') 'import GSTREGISTRATION' | Out-Null
Coll 'TaxUnit' '*' 'coll-TaxUnit-after.xml'
# GST duty ledgers (Central Tax / State Tax), a 5% and an 18% item, a bank ledger, a cost category / centres
Imp 'All Masters' ('<LEDGER NAME="Probe CGST" ACTION="Create"><NAME.LIST><NAME>Probe CGST</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Central Tax</GSTDUTYHEAD></LEDGER><LEDGER NAME="Probe SGST" ACTION="Create"><NAME.LIST><NAME>Probe SGST</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>State Tax</GSTDUTYHEAD></LEDGER><LEDGER NAME="Probe Bank" ACTION="Create"><NAME.LIST><NAME>Probe Bank</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER><LEDGER NAME="Probe Sales" ACTION="Create"><NAME.LIST><NAME>Probe Sales</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT><AFFECTSSTOCK>Yes</AFFECTSSTOCK></LEDGER><LEDGER NAME="Probe Buyer" ACTION="Create"><NAME.LIST><NAME>Probe Buyer</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><LEDSTATENAME>Delhi</LEDSTATENAME></LEDGER><LEDGER NAME="Probe Vendor" ACTION="Create"><NAME.LIST><NAME>Probe Vendor</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT></LEDGER>') 'import probe ledgers' | Out-Null
Imp 'All Masters' '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>' 'unit' | Out-Null
foreach ($r in @(@('Probe Five', 5, '1006'), @('Probe Eighteen', 18, '8471'))) {
  $h = [double]$r[1] / 2
  Imp 'All Masters' ("<STOCKITEM NAME=`"$($r[0])`" ACTION=`"Create`"><NAME.LIST><NAME>$($r[0])</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY><HSNDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><HSNCODE>$($r[2])</HSNCODE><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS></HSNDETAILS.LIST><GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><HSNCODE>$($r[2])</HSNCODE><TAXABILITY>Taxable</TAXABILITY><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>$h</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>$h</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>$($r[1])</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></STOCKITEM>") "stock item $($r[0])" | Out-Null
}
Coll 'StockItem' '*' 'stockitems.xml'
Imp 'All Masters' '<COSTCATEGORY NAME="Probe Category" ACTION="Create"><NAME.LIST><NAME>Probe Category</NAME></NAME.LIST><ALLOCATEREVENUE>Yes</ALLOCATEREVENUE><ALLOCATENONREVENUE>Yes</ALLOCATENONREVENUE></COSTCATEGORY><COSTCENTRE NAME="Probe Centre A" ACTION="Create"><NAME.LIST><NAME>Probe Centre A</NAME></NAME.LIST><CATEGORY>Probe Category</CATEGORY></COSTCENTRE><COSTCENTRE NAME="Probe Centre B" ACTION="Create"><NAME.LIST><NAME>Probe Centre B</NAME></NAME.LIST><CATEGORY>Probe Category</CATEGORY></COSTCENTRE>' 'cost category / centres' | Out-Null
Coll 'CostCentre' '*' 'costcentres.xml'

# ---- F11: the features form, every field in turn (nothing changed), then the form with "Show more features" on
Say '---- F11 company features'
K '{F11}' 3 '10-f11'
for ($i = 1; $i -le 9; $i++) { K '{ENTER}' 1 ("11-f11-enter-{0:d2}" -f $i) }
K '{ESC}' 2 '12-f11-esc'; K 'n' 2 '12b-f11-n'; K '{ESC}' 2 '12c-f11-esc'; K 'y' 2 '12d-f11-y'
K '{F11}' 3 '13-f11-again'
for ($i = 1; $i -le 12; $i++) { K '{UP}' 0 }
Start-Sleep 1; Shot '14-f11-top'
K 'y' 1; K '{ENTER}' 2 '15-f11-show-more'
for ($i = 1; $i -le 45; $i++) { K '{ENTER}' 1 ("16-f11-more-{0:d2}" -f $i) }
K '{ESC}' 2 '17-f11-esc'; K 'y' 2 '17b-f11-y'; K '{ESC}' 2 '17c-esc'

# ---- the company's GST details screen (Set/Alter Company GST Rate and Other Details: Yes), fields in turn, not saved
Say '---- F11: Set/Alter Company GST details'
K '{F11}' 3 '20-f11'
for ($i = 1; $i -le 5; $i++) { K '{ENTER}' 1 }
Shot '21-f11-at-set-alter-gst'
K 'y' 1; K '{ENTER}' 3 '22-gst-details'
for ($i = 1; $i -le 25; $i++) { K '{ENTER}' 1 ("23-gst-details-{0:d2}" -f $i) }
K '{ESC}' 2 '24-esc'; K 'y' 2 '24b-y'; K '{ESC}' 2 '24c-esc'; K 'y' 2 '24d-y'

# ---- TDS: Enable TDS Yes, its screen, fields in turn, not saved
Say '---- F11: Enable TDS'
K '{F11}' 3 '30-f11'
for ($i = 1; $i -le 6; $i++) { K '{ENTER}' 1 }
Shot '31-f11-at-tds'
K 'y' 1; K '{ENTER}' 3 '32-tds'
for ($i = 1; $i -le 20; $i++) { K '{ENTER}' 1 ("33-tds-{0:d2}" -f $i) }
K '{ESC}' 2 '34-esc'; K 'y' 2 '34b-y'; K '{ESC}' 2 '34c-esc'; K 'y' 2 '34d-y'

# ---- a party ledger's alteration form, every field in turn (the GSTIN's place), not saved
Say '---- ledger alteration: Probe Buyer'
K '{ESC}' 1; K 'a' 3 '40-alter'; K 'Ledger{ENTER}' 3 '41-ledger-list'; K 'Probe Buyer{ENTER}' 3 '42-ledger-form'
for ($i = 1; $i -le 30; $i++) { K '{ENTER}' 1 ("43-ledger-{0:d2}" -f $i) }
K '{ESC}' 2 '44-esc'; K 'y' 2 '44b-y'; K '{ESC}' 2 '44c-esc'; K '{ESC}' 2 '44d-esc'

# ---- a bank payment: Payment, Probe Bank, Probe Vendor 1000, each screen it opens, not saved
Say '---- bank payment'
K 'v' 3 '50-vouchers'; K '{F5}' 3 '51-payment'; K '{F2}' 2; K '1-10-2026{ENTER}' 2 '52-date'
K 'Probe Bank{ENTER}' 3 '53-account'; K 'Probe Vendor{ENTER}' 3 '54-particular'; K '1000{ENTER}' 3 '55-amount'
for ($i = 1; $i -le 14; $i++) { K '{ENTER}' 1 ("56-payment-{0:d2}" -f $i) }
K '{ESC}' 2 '57-esc'; K 'y' 2 '57b-y'

# ---- a GST sales invoice: the 5% and the 18% item, then Probe CGST / Probe SGST: do the duties work out themselves?
Say '---- GST sales invoice'
K 'v' 3; K '{F8}' 3 '60-sales'; K '^h' 2; K 'Item Invoice{ENTER}' 2; K '{F2}' 2; K '1-10-2026{ENTER}' 2 '61-date'
K 'Probe Buyer{ENTER}' 3 '62-party'; K '^a' 3 '63-dispatch'; K '^a' 3 '64-party-details'; K 'Probe Sales{ENTER}' 3 '65-ledger'
K 'Probe Five{ENTER}' 2; K '4{ENTER}' 1; K '100{ENTER}' 1; K '{ENTER}' 1; K '{ENTER}' 2 '66-item1'
K 'Probe Eighteen{ENTER}' 2; K '2{ENTER}' 1; K '500{ENTER}' 1; K '{ENTER}' 1; K '{ENTER}' 2 '67-item2'
K '{ENTER}' 2 '68-items-done'; K 'Probe CGST{ENTER}' 3 '69-cgst'; K '{ENTER}' 2 '70-cgst-enter'; K 'Probe SGST{ENTER}' 3 '71-sgst'; K '{ENTER}' 2 '72-sgst-enter'
K '{ENTER}' 2 '73-after'; K '^a' 4 '74-ctrl-a'; K '^a' 4 '75-ctrl-a-2'
Post ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY><SVFROMDATE>20261001</SVFROMDATE><SVTODATE>20261001</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 'daybook' 'daybook-20261001.xml' | Out-Null
Coll 'Company' '*' 'company-end.xml'
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Say '== probe end'
