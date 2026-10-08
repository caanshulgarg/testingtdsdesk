# The hang, step 4 (08-Oct-2026): the cause confirmed. Dot-sourced by flowv.ps1 in mode "hang4" after c1-c2.
# MEASUREMENT ONLY: no bridge. Runs 37729166801 / 37734533866's P7a looked the invoice up with
# @(Vouchers | Where-Object ...)[0]; Vouchers gives its list as one object, so the whole list passed and the request's
# filter became "$MasterID = 1 2 3 4 5 6 22 24 23 8 ... 25" (every MasterID, spaces between): the bridge's builders take
# digits only (voucherByMasterRequest / voucherObjectRequest), so they never send that. Here, each probe in a fresh Tally
# (the data put back): a company with 24 sales invoices by XML, then the 2.3.3 envelope (push\fast234-bymaster.xml) with
#   the correct one MasterID; "1 2 3"; "1 ... 10"; "1 ... 24"; run 37734533866's exact list; run 37729166801's exact list;
# and the hanging collection of run 37729166801 with its exact list. Results: versions\hang.csv, results.txt.
Say '---- hang4: the malformed filter of the harness against the correct one, each in a fresh Tally'
$script:hangLib = $true; . (Join-Path $PSScriptRoot 'hangv.ps1')
$mr = Imp 'All Masters' $ms 'hang4 masters'
$inv = ''; for ($i = 1; $i -le 23; $i++) { $inv += (HInv "hang4 invoice $i") }
$r = Imp 'Vouchers' $inv 'hang4 invoices'
Info "hang4: 23 invoices by XML: $(([regex]::Match("$r", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
$all = Vouchers
$first = @($all | Where-Object { $_.narr -eq 'hang4 invoice 1' })[0]
Info "hang4: $($all.Count) entries, MasterIDs $((@($all | ForEach-Object mid)) -join ' ')"
HSave 'h4'
if (-not $first) { Result 'hang4 the invoices' 'HARNESS' 'not in Tally after the import'; return }
$e = [pscustomobject]@{ gst = 'on'; isgston = 'Yes'; kind = 'xml'; how = 'XML import'; mid = $first.mid; vno = $first.vno; date = $first.date }
$lists = [ordered]@{
  'correct-one-id'    = "$($first.mid)"
  'list-3'            = '1 2 3'
  'list-10'           = (1..10) -join ' '
  'list-24'           = (1..24) -join ' '
  'run-37734533866'   = '1 2 3 4 5 6 22 24 23 8 9 10 11 12 13 14 15 16 17 18 19 20 21 25'
  'run-37729166801'   = '1 2 3 4 5 6 23 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 24'
}
foreach ($k in $lists.Keys) { HProbe 'h4' $e "233-envelope-$k" ((Req233 'MIDS' $e.date).Replace('$MasterID = MIDS', '$MasterID = ' + $lists[$k])) }
HProbe 'h4' $e 'hanging-collection-run-37729166801' (HReq $lists['run-37729166801'])
HProbe 'h4' $e 'hanging-collection-correct-one-id' (HReq "$($first.mid)")
Info "hang4: probes with no answer or Tally not answering after: $(if ($script:hHung.Count) { $script:hHung -join ', ' } else { 'none' })"
HStop
Say 'done (hang4)'
