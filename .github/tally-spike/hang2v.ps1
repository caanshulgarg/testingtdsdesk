# The hang, step 2 (08-Oct-2026). Dot-sourced by flowv.ps1 in mode "hang2" after c1-c2. MEASUREMENT ONLY: no bridge.
# Run 37736071297: in a fresh Tally with little data nothing hung on any release (the 2.3.3 FinComVoucherByMaster bytes,
# the 2.3.4 FinComVoucherObject bytes, the hanging collection and its variants: 110 of 110 answered). Runs 37729166801 and
# 37734533866: after sharev.ps1's typed cases the hanging collection, and the 2.3.3 bytes, hung Tally on all five releases.
# Here: sharev.ps1's masters, bills, payroll and typed cases (the same keys; P7 / P9 not run), the XML invoice of run
# 37729166801 imported in that session, then Tally stopped and its data kept. Then, each probe in a FRESH Tally on that
# data (put back each time):
#   1. on the XML invoice: the 2.3.3 bytes, the 2.3.4 bytes, the hanging collection (data or session?)
#   2. the 2.3.3 bytes for EVERY entry in the company, each on its own date (which entries does 2.3.3 hang on?)
#   3. the 2.3.4 bytes for every entry
#   4. the company with GST truly off (ISGSTON No): the three of 1
#   5. the session: a receipt typed (the add-on writes its lines), then the 2.3.3 bytes on the XML invoice in that session
# Results: versions\hang.csv, results.txt (HANG / ANSWERED lines), captures\hang-*.xml.
Say '---- hang2: the share company, then each probe in a fresh Tally on its data'
$script:hangLib = $true; . (Join-Path $PSScriptRoot 'hangv.ps1')
$script:shareCasesOnly = $true; . (Join-Path $PSScriptRoot 'sharev.ps1')
Write-TallyIni $tdl $fn
$null = Imp 'Vouchers' (HInv 'share e-invoice') 'hang2 xml invoice'
$all = Vouchers
$isg = GstNow
Info "hang2: the share company's ISGSTON '$isg', $($all.Count) entries"
Set-Content (Join-Path $cap 'hang2-entries.txt') @($all | ForEach-Object { "mid=$($_.mid) aid=$($_.aid) $($_.type)/$($_.vno)/$($_.date) narr=$($_.narr)" }) -Encoding UTF8
HSave 'share'
function HEnt($v, $gst, $kind) { [pscustomobject]@{ gst = $gst; isgston = $isg; kind = $kind; how = "$($v.type) $($v.vno) of $($v.date), '$($v.narr)'"; mid = $v.mid; vno = $v.vno; date = $v.date } }
$inv = @($all | Where-Object { $_.narr -eq 'share e-invoice' })[0]
if (-not $inv) { Result 'hang2 the XML invoice' 'HARNESS' 'not in Tally after the import'; HStop; return }
$e = HEnt $inv 'on' 'xml'

# 1
HProbe 'share' $e 'published-233-FinComVoucherByMaster' (Req233 $e.mid $e.date)
HProbe 'share' $e 'new-234-FinComVoucherObject' (Req234 $e.mid)
HProbe 'share' $e 'hanging' (HReq $e.mid)
$hung1 = $script:hHung.Count
# 2 and 3
$each = @($all | Sort-Object mid)
foreach ($v in $each) { HProbe 'share' (HEnt $v 'on' ("mid$($v.mid)-" + ($v.type -replace '\s', ''))) 'published-233' (Req233 $v.mid $v.date) }
foreach ($v in $each) { HProbe 'share' (HEnt $v 'on' ("mid$($v.mid)-" + ($v.type -replace '\s', ''))) 'new-234' (Req234 $v.mid) }
# 4
HRestore 'share'
if (HStart 'gstoff-setup') {
  $null = Imp 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><ISGSTON>No</ISGSTON></COMPANY>') 'company GST off'
  $isg = GstNow; Info "hang2: GST off: ISGSTON now '$isg'"
  HSave 'shareoff'
  $eo = HEnt $inv 'off' 'xml'
  HProbe 'shareoff' $eo 'published-233-FinComVoucherByMaster' (Req233 $eo.mid $eo.date)
  HProbe 'shareoff' $eo 'new-234-FinComVoucherObject' (Req234 $eo.mid)
  HProbe 'shareoff' $eo 'hanging' (HReq $eo.mid)
} else { Result 'hang2 GST off' 'HARNESS' 'the company did not open' }
# 5
$isg = 'Yes'
HRestore 'share'
if (HStart 'session') {
  $l0 = (& $recLines).Count
  try { ShareEntry 'H5' @('{F6}') 'Receipt' 'Cash' @(, @('Spike Income', '900', $null)) 'hang2 session receipt' } catch { Say "HARNESS: session receipt: $_" }
  Info "hang2 session: the add-on wrote $(@(& $recLines).Count - $l0) line(s) for the typed receipt"
  HProbe 'share' (HEnt $inv 'on' 'xml-after-typed-save') 'published-233-same-session' (Req233 $inv.mid $inv.date) -same
} else { Result 'hang2 session' 'HARNESS' 'the company did not open' }
Info "hang2: probes with no answer or Tally not answering after: $(if ($script:hHung.Count) { $script:hHung -join ', ' } else { 'none' })"
HStop
Say 'done (hang2)'
