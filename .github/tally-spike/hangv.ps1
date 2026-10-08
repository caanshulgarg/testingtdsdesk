# The hang of run 37729166801, isolated (the coordinator, 08-Oct-2026: top priority). Dot-sourced by flowv.ps1 in mode
# "hang" after c1-c2 (Tally started with the ref's FinComRecorder.tdl, "FinCom Spike Co" open). MEASUREMENT ONLY: no bridge.
# The hanging request (sharev.ps1 P7a of run 37729166801, every release): a Voucher collection over 2026-27 fetching
# GUID, MASTERID, ALTERID, VOUCHERNUMBER, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.LEDGERNAME
# filtered by $MasterID of an XML-imported sales invoice (accounting, Share Party / Share Sales, 150.00, 2-10-2026) in a
# company with GST off; no answer in 60 s and Tally did not answer again.
# Here, each probe in its OWN fresh Tally (the company's data folder put back from a copy taken before any probe, Tally
# started again), one thing varied at a time from the hanging request:
#   the period (the year; one day), the filter ($MasterID; none), the fields (IRN / IRNACKNO / IRNACKDATE /
#   EWAYBILLDETAILS.BILLNUMBER alone; none of them), the company (GST off; GST on), the entry (by XML; typed on screen),
#   and (beyond the ask) the add-on not loaded, and the request in the same Tally session right after the import (as in
#   run 37729166801);
# and the EXACT bytes of the published 2.3.3 FinComVoucherByMaster (push\fast234-bymaster.xml, byte for byte what
# voucherByMasterRequest builds on origin/tax-accuracy; the entry's date as its one day) and of the new 2.3.4
# FinComVoucherObject (push\fast234-object.xml, byte for byte voucherObjectRequest of origin/next-fastfetch), against the
# same invoices in the GST-off and the GST-on company.
# Per probe: answered or not within 60 s, ms, chars, the entry in the answer; then whether Tally answers (the company list,
# 30 s), again 60 s later (recovers by itself), and after Tally is started again on the same data (recovers on a restart;
# the entry still listed). Results: versions\hang.csv, results.txt (HANG / ANSWERED lines), captures\hang-*.xml.
Say '---- hang: the hanging request of run 37729166801, one thing varied at a time, each probe in a fresh Tally'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x }
$script:TdsCo = $co1
$shareDate = '2-10-2026'
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }
$hcsv = Join-Path $out 'hang.csv'
$fn = $folder.Name
$snap = "$env:RUNNER_TEMP\hangsnap"; New-Item -ItemType Directory -Force $snap | Out-Null

# ---- Tally: stop, start on the data as it is, put a data copy back
function HStop { Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 4 }
function HStart($tag) {
  HStop
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {}; if ($t.HasExited) { break } }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 "hang-$tag-started"
  return HAlive
}
function HAlive { (Post $listCoXml '' 30) -match [regex]::Escape($co1) }
function HSave($name) { HStop; $d = Join-Path $snap $name; if (Test-Path $d) { Remove-Item $d -Recurse -Force }; Copy-Item (Join-Path $data1 $fn) $d -Recurse; Say "hang: data kept as '$name'" }
function HRestore($name) { HStop; Remove-Item (Join-Path $data1 $fn) -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item (Join-Path $snap $name) (Join-Path $data1 $fn) -Recurse }
function GstNow { [regex]::Match((Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>HGst</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="HGst" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><NATIVEMETHOD>ISGSTON</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60), '<ISGSTON[^>]*>([^<]*)<').Groups[1].Value }

# ---- the requests
# the hanging one, byte for byte as sharev.ps1's $coll built it in run 37729166801 (id ShareE), with one part varied
$hRest = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, '
$h4 = 'IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, '
function HReq($mid, [string]$four = $h4, $from = '20260401', $to = '20270331', [bool]$filter = $true) {
  if ($filter) { $mid = TdsMid $mid }
  $fetch = $hRest + $four + 'ALLLEDGERENTRIES.LEDGERNAME'
  $flt = if ($filter) { '<FILTERS>ShareEF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="ShareEF">$MasterID = ' + $mid + '</SYSTEM>' } else { '</COLLECTION>' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ShareE</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>' + $from + '</SVFROMDATE><SVTODATE>' + $to + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="ShareE" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fetch + '</FETCH>' + $flt + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
$tBM = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'push\fast234-bymaster.xml')).Trim()
$tOB = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'push\fast234-object.xml')).Trim()
function Req233($mid, $date) { $mid = TdsMid $mid; $tBM.Replace('@@CO@@', (SE $co1)).Replace('20991231', $date).Replace('987654321', "$mid") }
function Req234($mid) { $mid = TdsMid $mid; $tOB.Replace('@@CO@@', (SE $co1)).Replace('987654321', "$mid") }

# ---- one probe
$script:hHung = @(); $script:hObs = 0
function HProbe($snapName, $ent, $form, $body, [switch]$noAddon, [switch]$same) {
  $tag = "$($ent.gst)-$($ent.kind)-$form"
  $fresh = $true
  if (-not $same) {
    HRestore $snapName
    Write-TallyIni $(if ($noAddon) { $null } else { $tdl }) $fn
    $fresh = HStart $tag
  }
  $x = if ($fresh) { Post $body '' 60 } else { '' }; $ms = $script:lastMs
  $hit = $x -match "<MASTERID[^>]*>\s*$($ent.mid)\s*<"
  $err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|Unknown Request[^<]*').Value
  $alive = if ($fresh) { HAlive } else { $false }
  $later = $alive; $cpu = ''
  $obs = $fresh -and -not $alive -and $script:hObs -lt 3
  if ($fresh -and -not $alive) { $script:hObs++; Shot "hang-$tag-hung" }
  if ($obs) {
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $c0 = if ($p) { $p.CPU } else { $null }
    Start-Sleep 60
    $later = HAlive
    $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
    $cpu = if ($p -and $null -ne $c0) { '{0:0.0} s cpu in the 90 s after' -f ($p.CPU - $c0) } elseif (-not $p) { 'Tally exited' } else { '' }
    Shot "hang-$tag-later"
  }
  # started again on the same data (not put back): does it answer, is the entry still listed
  $again = ''; $listed = ''
  if ($obs -and -not $later) {
    $again = HStart "$tag-again"
    $listed = if ($again) { $lv = Vouchers; [bool]@($lv | Where-Object { $_.mid -eq [int]$ent.mid }).Count } else { '' }
    Shot "hang-$tag-again"
  }
  if ($noAddon) { Write-TallyIni $tdl $fn }
  if ($x) { Set-Content (Join-Path $cap "hang-$tag.xml") $x -Encoding UTF8 }
  $row = [pscustomobject]@{ rel = $rel; gst = $ent.gst; isgston = $ent.isgston; entry = $ent.kind; made = $ent.how; mid = $ent.mid; vno = $ent.vno; form = $form; addon = (-not $noAddon); same_session = [bool]$same
    fresh_up = $fresh; answered = [bool]$x; ms = $ms; chars = $x.Length; has_entry = $hit; err = $err; alive_after = $alive; alive_60s_later = $later; cpu = $cpu; restart_answers = $again; entry_listed_after_restart = $listed }
  $row | Export-Csv $hcsv -Append -NoTypeInformation -Encoding UTF8
  $state = if (-not $fresh) { 'HARNESS' } elseif ($x -and $alive) { 'ANSWERED' } else { 'HANG' }
  if ($state -eq 'HANG') { $script:hHung += $tag }
  Result "hang $tag" $state ("GST {0} (ISGSTON '{1}'), {2} ({3}, MasterID {4}, {5}), {6}{7}: {8} in {9} ms, {10} chars, the entry {11}{12}; Tally answers after it: {13}; 60 s later: {14} {15}; started again: {16}, the entry listed: {17}" -f
      $ent.gst, $ent.isgston, $ent.kind, $ent.how, $ent.mid, $ent.vno, $form, $(if ($noAddon) { ' (add-on NOT loaded)' } elseif ($same) { ' (same Tally session as the import)' } else { '' }),
      $(if ($x) { 'answered' } else { 'NO ANSWER' }), $ms, $x.Length, $(if ($hit) { 'in it' } else { 'not in it' }), $(if ($err) { " ($err)" } else { '' }), $alive, $later, $cpu, $again, $listed)
}

# ---- the data: masters (as sharev.ps1), then per GST state the XML invoice of run 37729166801 and one typed on screen
$bw = '<ISBILLWISEON>Yes</ISBILLWISEON>'
function SLed($n, $p, $x = '') { '<LEDGER NAME="' + (SE $n) + '" ACTION="Create"><NAME.LIST><NAME>' + (SE $n) + '</NAME></NAME.LIST><PARENT>' + (SE $p) + '</PARENT>' + $x + '</LEDGER>' }
$ms = '<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>' +
  (SLed 'Spike Income' 'Indirect Incomes') + (SLed 'Share Party' 'Sundry Debtors' $bw) + (SLed 'Share Sales' 'Sales Accounts') +
  '<STOCKITEM NAME="Share Item" ACTION="Create"><NAME.LIST><NAME>Share Item</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE> 100 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-5000.00</OPENINGVALUE></STOCKITEM>'
if (-not $script:hangLib) { $mr = Imp 'All Masters' $ms 'hang masters'; Info "hang masters: $(([regex]::Match("$mr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')" }
function HInv($narr) {
  '<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>SH-E1</VOUCHERNUMBER><PARTYLEDGERNAME>Share Party</PARTYLEDGERNAME><NARRATION>' + $narr + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-150.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>SH-E1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-150.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Share Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>150.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
function HSubs($tag) {
  for ($j = 1; $j -le 4; $j++) {
    $t = TdsScreen "$tag-sub$j"
    if ($t -match 'Bill-wise|Bill wise|Type of Ref') { return }
    if ($t -match 'Cost Centre|Cost Category|Dispatch|Receipt Details|Party Details|Buyer|Statutory|GST Details|Tax Details|Tax Analysis') { $null = TK '^a' 2 "$tag-sub-accept"; continue }
    return
  }
}
# an item invoice typed on the screen (sharev.ps1's ShareInvoice: Ctrl+H Item Invoice, the party, the sales ledger, one row,
# Ctrl+A; the bill-wise screen at the save gets New Ref SH-T1)
function HScreenInvoice($tag) {
  $null = TdsGateway "before $tag"
  $t0s = TdsScreen "$tag-start"
  if ($t0s -notmatch 'cher Creati') { if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher|ucher')) { return } }
  $null = TK '{F8}' 2.5 "$tag-type"
  $null = TK '^h' 2 "$tag-mode" 'Mode|Invoice|Voucher'
  $null = TK 'Item Invoice{ENTER}' 2 "$tag-item-mode"
  $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'
  $null = TK ((SK $shareDate) + '{ENTER}') 2 "$tag-date"
  $null = TK ((SK 'Share Party') + '{ENTER}') 2.5 "$tag-party"
  HSubs "$tag-party"
  $null = TK ((SK 'Share Sales') + '{ENTER}') 2 "$tag-ledger"
  HSubs "$tag-ledger"
  $null = TK 'Share Item{ENTER}' 2 "$tag-item"
  HSubs "$tag-item"
  $null = TK '2{ENTER}' 1.5 "$tag-qty"; $null = TK '75{ENTER}' 1.5 "$tag-rate"; $null = TK '{ENTER}' 1.5 "$tag-amount"
  HSubs "$tag-item-b"
  $null = TK '{ENTER}' 1.5 "$tag-items-done"
  for ($a = 1; $a -le 4; $a++) {
    $null = TK '^a' 3 "$tag-accept$a"
    $t = TdsScreen "$tag-after$a"
    if ($t -match 'Bill-wise|Bill wise|Type of Ref') { $null = TK 'New Ref{ENTER}' 2 "$tag-reftype"; $null = TK 'SH-T1{ENTER}' 2 "$tag-refname"; $null = TK '{ENTER}' 1.5 "$tag-due"; $null = TK '{ENTER}' 2 "$tag-refamt"; continue }
    if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }
    if ($t -match 'Dispatch|Receipt Details|Party Details|Buyer|Statutory|GST Details|Tax Details') { continue }
    if ($t -match 'Voucher Creati|Voucher Alterati|ccounting Voucher') { continue }
    break
  }
  $null = TdsGateway "after $tag"
}

if ($script:hangLib) { return }   # hang2v.ps1: the functions only
HSave 'base'
$ents = @{}
foreach ($gst in 'off', 'on') {
  HRestore 'base'; Write-TallyIni $tdl $fn
  if (-not (HStart "setup-$gst")) { Result "hang setup GST $gst" 'HARNESS' 'the company did not open'; continue }
  $before = GstNow
  $null = Imp 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><ISGSTON>' + $(if ($gst -eq 'on') { 'Yes' } else { 'No' }) + '</ISGSTON></COMPANY>') "company GST $gst"
  $isg = GstNow
  Info "hang GST ${gst}: ISGSTON before '$before', now '$isg'"
  $r = Imp 'Vouchers' (HInv 'share e-invoice') "xml invoice GST $gst"
  Info "hang GST $gst XML invoice: $(([regex]::Match("$r", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
  try { HScreenInvoice "scr-$gst" } catch { Say "HARNESS: screen invoice: $_" }
  $all = Vouchers
  $vx = @($all | Where-Object { $_.narr -eq 'share e-invoice' })[0]
  $vs = @($all | Where-Object { $_.type -eq 'Sales' -and $_.date -eq '20261002' -and $_.narr -ne 'share e-invoice' })[0]
  if ($vx) { $ents["$gst-xml"] = [pscustomobject]@{ gst = $gst; isgston = $isg; kind = 'xml'; how = 'XML import, accounting sales as run 37729166801'; mid = $vx.mid; vno = $vx.vno; date = $vx.date } } else { Result "hang setup GST $gst xml" 'HARNESS' 'the XML invoice is not in Tally' }
  if ($vs) { $ents["$gst-screen"] = [pscustomobject]@{ gst = $gst; isgston = $isg; kind = 'screen'; how = 'typed: item invoice, keys'; mid = $vs.mid; vno = $vs.vno; date = $vs.date } } else { Result "hang setup GST $gst screen" 'HARNESS' 'the keys made no sales invoice (see tds-*-scr-* screenshots)' }
  Set-Content (Join-Path $out "tds-screen-log-$gst.txt") $script:tdsLog -Encoding UTF8
  HSave "gst$gst"
}
foreach ($k in $ents.Keys) { Info "hang entry ${k}: MasterID $($ents[$k].mid), number $($ents[$k].vno), $($ents[$k].date)" }

# ---- the probes: the published requests first (the High question), then the hanging request per company and entry, then
# its parts one at a time on the run-37729166801 case (GST off, by XML)
$order = @('off-xml', 'on-xml', 'off-screen', 'on-screen')
foreach ($k in $order) {
  $e = $ents[$k]; if (-not $e) { continue }
  HProbe "gst$($e.gst)" $e 'published-233-FinComVoucherByMaster' (Req233 $e.mid $e.date)
  HProbe "gst$($e.gst)" $e 'new-234-FinComVoucherObject' (Req234 $e.mid)
  HProbe "gst$($e.gst)" $e 'hanging' (HReq $e.mid)
}
$e = $ents['off-xml']
if ($e) {
  HProbe 'gstoff' $e 'hanging-one-day' (HReq $e.mid $h4 '20261002' '20261002')
  HProbe 'gstoff' $e 'hanging-no-filter' (HReq $e.mid $h4 '20260401' '20270331' $false)
  HProbe 'gstoff' $e 'hanging-IRN-only' (HReq $e.mid 'IRN, ')
  HProbe 'gstoff' $e 'hanging-IRNACKNO-only' (HReq $e.mid 'IRNACKNO, ')
  HProbe 'gstoff' $e 'hanging-IRNACKDATE-only' (HReq $e.mid 'IRNACKDATE, ')
  HProbe 'gstoff' $e 'hanging-EWAYBILL-only' (HReq $e.mid 'EWAYBILLDETAILS.BILLNUMBER, ')
  HProbe 'gstoff' $e 'hanging-none-of-the-four' (HReq $e.mid '')
  HProbe 'gstoff' $e 'hanging-no-addon' (HReq $e.mid) -noAddon
  # as in run 37729166801: the request in the same Tally session right after the import (a second invoice, its MasterID)
  HRestore 'gstoff'; Write-TallyIni $tdl $fn
  if (HStart 'same') {
    $null = Imp 'Vouchers' (HInv 'share e-invoice 2') 'xml invoice 2'
    $l2 = Vouchers; $v2 = @($l2 | Where-Object { $_.narr -eq 'share e-invoice 2' })[0]
    if ($v2) {
      $e2 = [pscustomobject]@{ gst = 'off'; isgston = $e.isgston; kind = 'xml2'; how = 'XML import, then the request in the same session'; mid = $v2.mid; vno = $v2.vno; date = $v2.date }
      HProbe 'gstoff' $e2 'hanging-same-session' (HReq $e2.mid) -same
      HRestore 'gstoff'; Write-TallyIni $tdl $fn
      if (HStart 'same233') {
        $null = Imp 'Vouchers' (HInv 'share e-invoice 2') 'xml invoice 2 (233)'
        $l3 = Vouchers; $v3 = @($l3 | Where-Object { $_.narr -eq 'share e-invoice 2' })[0]
        if ($v3) { $e3 = [pscustomobject]@{ gst = 'off'; isgston = $e.isgston; kind = 'xml2'; how = 'XML import, then the request in the same session'; mid = $v3.mid; vno = $v3.vno; date = $v3.date }
          HProbe 'gstoff' $e3 'published-233-same-session' (Req233 $e3.mid $e3.date) -same }
      }
    } else { Result 'hang off-xml2-hanging-same-session' 'HARNESS' 'the second XML invoice is not in Tally' }
  } else { Result 'hang off-xml2-hanging-same-session' 'HARNESS' 'the company did not open' }
}
Info "hang: probes with no answer or Tally not answering after: $(if ($script:hHung.Count) { $script:hHung -join ', ' } else { 'none' })"
HStop
Say 'done (hang)'
