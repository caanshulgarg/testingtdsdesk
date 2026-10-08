# fast234g.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234g,
# (run 37735320482: the screen invoice was not made: an Enter after the date put the party into the dispatch details;
# the keys now follow the push helper's ShareInvoice exactly: the party right after the date)
# right after Tally is installed and flow.ps1 made "FinCom Spike Co" (nothing else of pushm.ps1 runs).
# The coordinator, 08-Oct-2026: the push helper's run 37729166801 hung TallyPrime on all five releases with a Voucher
# collection over the year (2026-27) fetching IRN, IRNACKNO, IRNACKDATE and EWAYBILLDETAILS.BILLNUMBER, filtered by
# $MasterID, on an XML-imported sales invoice in a company without GST; Tally did not recover, even after a restart.
# Here: the 2.3.4 entry request (FinComVoucherObject, the bridge's own XML) and FinComVoucherByNumber on sales invoices
#   in a GST-ON and a GST-OFF copy of the company (ISGSTON set by an XML alteration and read back), each invoice made
#   by XML (an item invoice; an accounting sales voucher as the helper's; the same with its IRN and e-way bill written
#   back by an XML alteration) and on Tally's screen (an item invoice typed with keys);
#   each probe in a FRESH Tally (started again before it), 30 s at most; then whether Tally still answers (the company
#   list, 30 s), and whether a fresh start answers again. The helper's own collection last, per company, as the reference
#   (it may leave Tally dead). Results: fast234g.csv, captures\g-*.xml, summary.txt.
. "$here\fast234.ps1"   # its request templates and helpers (it returns before its own run in this mode)
. "$here\..\tdslib.ps1"
$gcsv = Join-Path $out 'fast234g.csv'
$script:co = $co
$script:gcur = $light
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 60 }
$script:TdsCo = $co
$script:TdsRestart = { Start-T $script:gcur @() 'g-restart' | Out-Null }
$gDate = '20261002'; $gDay = '2-10-2026'
function GVch {
  $x = Post (Coll 'FCPGV' 'Voucher' 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION') '' 120
  $o = @()
  foreach ($m in [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $o += [pscustomobject]@{ mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; aid = [regex]::Match($v, '<ALTERID[^>]*>\s*(\d+)').Groups[1].Value; date = [regex]::Match($v, '<DATE[^>]*>(\d{8})').Groups[1].Value
      type = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value); vno = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value)
      narr = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<NARRATION[^>]*>([^<]*)').Groups[1].Value); guid = [regex]::Match($v, '<GUID[^>]*>([^<]*)').Groups[1].Value }
  }
  return , $o
}
function GstOn { [regex]::Match((Post (Coll 'FCPGst' 'Company' 'NAME' '' '<NATIVEMETHOD>ISGSTON</NATIVEMETHOD>') '' 60), '<ISGSTON[^>]*>([^<]*)<').Groups[1].Value }
function Alive { (Post $listCo '' 30) -match '<COMPANY' }

# ---------------------------------------------------------------- the invoices
function AcctSales($no, $narr, $extra = '') {
  '<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>' + $gDate + '</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PARTYLEDGERNAME>Template Party</PARTYLEDGERNAME>' + $extra + '<NARRATION>' + $narr + '</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Template Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-150.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>' + $no + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-150.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>150.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
}
$irn = '<IRN>IRN-G-0001</IRN><IRNACKNO>ACK-G-1</IRNACKNO><IRNACKDATE>' + $gDate + '</IRNACKDATE><EWAYBILLDETAILS.LIST><BILLDATE>' + $gDate + '</BILLDATE><BILLNUMBER>381101234299</BILLNUMBER><DOCUMENTTYPE>Tax Invoice</DOCUMENTTYPE></EWAYBILLDETAILS.LIST>'
function GSubs($tag) {
  for ($j = 1; $j -le 4; $j++) {
    $t = TdsScreen "$tag-sub$j"
    if ($t -match 'Cost Centre|Cost Category|Bank Allocation|Dispatch|Receipt Details|Party Details|Supplier Details|Buyer|Statutory|GST Details|Tax Details|Bill-wise|Type of Ref') { $null = TK '^a' 2 "$tag-sub-accept"; continue }
    return
  }
}
# an item invoice typed on the screen (as the push helper's ShareInvoice): Gateway > Vouchers > F8, Ctrl+H Item Invoice,
# the date, the party, the sales ledger, one item row, Ctrl+A (and Yes when asked)
function ScreenInvoice($tag, $narr) {
  $null = TdsGateway "before $tag"
  $t0s = TdsScreen "$tag-start"
  if ($t0s -notmatch 'cher Creati') { if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher|ucher')) { return } }
  $null = TK '{F8}' 2.5 "$tag-type"
  $null = TK '^h' 2 "$tag-mode" 'Mode|Invoice|Voucher'
  $null = TK 'Item Invoice{ENTER}' 2 "$tag-item-mode"
  $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'
  $null = TK ((SK $gDay) + '{ENTER}') 2 "$tag-date"
  $null = TK ((SK 'Template Party') + '{ENTER}') 2.5 "$tag-party"
  GSubs "$tag-party"
  $null = TK ((SK 'Sales') + '{ENTER}') 2 "$tag-ledger"
  $null = TK ((SK 'Item T03') + '{ENTER}') 2 "$tag-item"
  GSubs "$tag-item"
  $null = TK '2{ENTER}' 1.5 "$tag-qty"; $null = TK '100{ENTER}' 1.5 "$tag-rate"; $null = TK '{ENTER}' 1.5 "$tag-amount"
  GSubs "$tag-item-b"
  $null = TK '{ENTER}' 1.5 "$tag-items-done"
  # (run 37737309045: the narration typed here went into a second item row: none typed; the entry is found as the new Sales of the day)
  for ($a = 1; $a -le 3; $a++) {
    $null = TK '^a' 3 "$tag-accept$a"
    $t = TdsScreen "$tag-after$a"
    if ($t -match 'Bill-wise|Bill wise|Type of Ref') { $null = TK 'New Ref{ENTER}' 2 "$tag-reftype"; $null = TK '{ENTER}' 2 "$tag-refname"; $null = TK '{ENTER}' 1.5 "$tag-due"; $null = TK '{ENTER}' 2 "$tag-refamt"; $null = TK '^a' 2 "$tag-bills-accept"; continue }
    if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }
    if ($t -match 'Dispatch|Receipt Details|Party Details|Buyer|Statutory') { continue }
    if ($t -match 'Voucher Creati|Voucher Alterati|ccounting Voucher') { continue }
    break
  }
  $null = TdsGateway "after $tag"
}

# ---------------------------------------------------------------- one probe in a fresh Tally
function GProbe($gst, $t, $form, $body) {
  $fresh = Start-T $script:gcur $script:gtdls "g-$gst-$($t.kind)-$form"
  $x = if ($fresh) { Post $body '' 30 } else { '' }; $ms = $script:lastMs
  $alive = Alive
  $again = $alive
  if (-not $alive) { Shot "g-hung-$gst-$($t.kind)-$form"; $again = Start-T $script:gcur $script:gtdls "g-$gst-$($t.kind)-$form-again" }
  $hit = $x -match "<MASTERID[^>]*>\s*$($t.mid)\s*<"
  $err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|Unknown Request[^<]*|<ERROR>[^<]*').Value
  [pscustomobject]@{ rel = $rel; tdl = $script:gtv; gst = $gst; isgston = $script:gstNow; kind = $t.kind; made = $t.how; type = $t.type; vno = $t.vno; mid = $t.mid; form = $form; fresh = $fresh
    answered = [bool]$x; ms = $ms; bytes = $x.Length; has_target = $hit; alive_after = $alive; restart_answers = $again; err = $err } | Export-Csv $gcsv -Append -NoTypeInformation -Encoding UTF8
  if ($x) { Set-Content (Join-Path $cap "g-$($script:gtv)-$gst-$($t.kind)-$form.xml") $(if ($x.Length -gt 3000000) { $x.Substring(0, 3000000) } else { $x }) -Encoding UTF8 }
  Say ("G [$($script:gtv)] {0} {1} ({2} {3} {4}, MasterID {5}) {6}: {7}, {8} ms, {9} chars, the entry {10}; Tally answers after it: {11}; a fresh start answers: {12} {13}" -f $gst, $t.kind, $t.how, $t.type, $t.vno, $t.mid, $form,
      $(if ($x) { 'ANSWERED' } else { 'NO ANSWER in 30 s' }), $ms, $x.Length, $(if ($hit) { 'in it' } else { 'NOT in it' }), $alive, $again, $err)
  return $again
}

# ---------------------------------------------------------------- run
$W = "$env:RUNNER_TEMP\fast234g"
try {
  if (Test-Path $W) { Remove-Item $W -Recurse -Force }
  New-Item -ItemType Directory -Force $W | Out-Null
  foreach ($gst in 'on', 'off') {
    $d = "$W\$gst"; Copy-Item $light $d -Recurse; $script:gcur = $d
    Say "---- fast234g: GST $gst ($d)"
    if (-not (Start-T $d @() "g-$gst-setup")) { Say "HARNESS: GST $gst company did not open"; continue }
    $before = GstOn
    Imp 'All Masters' @('<COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME><ISGSTON>' + $(if ($gst -eq 'on') { 'Yes' } else { 'No' }) + '</ISGSTON></COMPANY>') "company GST $gst" | Out-Null
    $script:gstNow = GstOn
    Say "GST ${gst}: ISGSTON before '$before', after the alteration '$($script:gstNow)'"
    Imp 'All Masters' (LightMasters) 'light masters' | Out-Null
    $r = Imp 'Vouchers' @(SalesXml $gDate 'GX-I1' 'Template Party' @('Item T01', 'Item T02') 'g xml item invoice') 'xml item invoice'
    if ($r.created -lt 1) { Imp 'Vouchers' @(SalesXml $gDate 'GX-I1' 'Template Party' @('Item T01', 'Item T02') 'g xml item invoice' $false) 'xml item invoice (plain)' | Out-Null }
    Imp 'Vouchers' @(AcctSales 'GX-A1' 'g xml accounting sales') 'xml accounting sales' | Out-Null
    Imp 'Vouchers' @(AcctSales 'GX-A2' 'g xml accounting sales irn') 'xml accounting sales (IRN to come)' | Out-Null
    $a2 = @((GVch) | Where-Object { $_.narr -eq 'g xml accounting sales irn' })[0]
    if ($a2) {
      $alt = (AcctSales 'GX-A2' 'g xml accounting sales irn' $irn) -replace '<VOUCHER VCHTYPE="Sales" ACTION="Create"', ('<VOUCHER REMOTEID="' + $a2.guid + '" VCHTYPE="Sales" ACTION="Alter"')
      $null = Imp 'Vouchers' @($alt) 'IRN and e-way bill written back (alter)'
    }
    try { ScreenInvoice "g-$gst-screen" 'g screen item invoice' } catch { Say "HARNESS: screen invoice: $_" }
    Set-Content (Join-Path $out "tds-screen-log-$gst.txt") $script:tdsLog -Encoding UTF8
    $all = GVch
    $ts = @()
    foreach ($k in @(@('xml-item', 'g xml item invoice', 'XML'), @('xml-acct', 'g xml accounting sales', 'XML'), @('xml-acct-irn', 'g xml accounting sales irn', 'XML, then IRN by an XML alteration'), @('screen-item', 'g screen item invoice', 'screen keys'))) {
      $v = @($all | Where-Object { $_.narr -eq $k[1] })[0]
      if (-not $v -and $k[0] -eq 'screen-item') { $v = @($all | Where-Object { $_.date -eq $gDate -and $_.type -eq 'Sales' -and $_.narr -notlike 'g xml*' })[0] }
      if (-not $v) { Say "HARNESS: GST $gst $($k[0]): not made"; continue }
      $ts += [pscustomobject]@{ kind = $k[0]; how = $k[2]; mid = $v.mid; date = $v.date; type = $v.type; vno = $v.vno }
      Say "GST $gst $($k[0]): MasterID $($v.mid), $($v.type) $($v.vno) of $($v.date)"
    }
    # 08-Oct-2026 07:40Z (run 37740175973: every probe answered with no TDL loaded): each probe again with the FinCom add-on
    # loaded (FinComRecorder.tdl, as on a client's Tally and in the push helper's run)
    $tdlSrc = if ($env:BRIDGE_DIST -and (Test-Path (Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl'))) { Join-Path $env:BRIDGE_DIST 'FinComRecorder.tdl' } else { Join-Path $env:GITHUB_WORKSPACE 'bridge-go\addon\FinComRecorder.tdl' }
    $gtdl = "$W\FinComRecorder.tdl"; Copy-Item $tdlSrc $gtdl -Force
    foreach ($tv in 'none', 'addon') {
    $script:gtv = $tv; $script:gtdls = if ($tv -eq 'addon') { @($gtdl) } else { @() }
    $ok = $true
    foreach ($t in $ts) {
      if ($ok) { $ok = GProbe $gst $t 'object' ($tplOBJ.Replace('@@CO@@', (X $co)).Replace('987654321', "$($t.mid)")) }
      if ($ok -and $t.vno) { $ok = GProbe $gst $t 'bynumber' (ReqBN $t.date $t.type $t.vno) }
      if (-not $ok) { Say "HARNESS: GST $gst Tally does not answer after a fresh start: the probes of this company stop" }
    }
    # the push helper's collection (run 37729166801), the reference, last: it may leave Tally dead
    $f7 = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.LEDGERNAME'
    foreach ($t in @($ts | Where-Object { $_.kind -like 'xml-acct*' })) {
      if (-not $ok) { break }
      $ok = GProbe $gst $t 'helper-collection' (CollReq 'FCPHelperP7' 'Voucher' $f7 "`$MasterID = $($t.mid)" '' '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE>')
    }
    }
    Stop-T
  }
} catch { Say "HARNESS: fast234g stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Say 'done (fast234 fast234g)'
