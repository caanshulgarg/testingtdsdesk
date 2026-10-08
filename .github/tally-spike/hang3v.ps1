# The hang, step 3 (08-Oct-2026). Dot-sourced by flowv.ps1 in mode "hang3" after c1-c2. MEASUREMENT ONLY: no bridge.
# Run 37738875649 (hang2): on the share company's data in a FRESH Tally nothing hung (the 2.3.3 and 2.3.4 bytes for every
# entry, the hanging collection, GST on and truly off, the 2.3.3 bytes right after a typed save): the hang of runs
# 37729166801 / 37734533866 needs the session in which sharev.ps1's cases were typed.
# Here: that session (sharev.ps1's masters, bills, payroll and typed cases, the same keys; P7 / P9 not run), the XML
# invoice of run 37729166801 imported after the masters, and after the masters and after EVERY case, in the session:
#   the 2.3.4 FinComVoucherObject bytes (30 s), then the 2.3.3 FinComVoucherByMaster bytes (60 s), on that invoice;
# the first step after which one gets no answer names the trigger. Then Tally is asked the company list (30 s), started
# again (as sharev.ps1 does) and asked the 2.3.3 bytes again (recovers on a restart?), and the cases go on (recurs?).
# Last, run 37729166801's own order: a second XML invoice imported, Tally's voucher list, the 2.3.3 bytes and the hanging
# collection for it. Results: versions\hang3.csv, results.txt (STEP lines), captures\hang3-*.xml.
Say '---- hang3: the share session, the published requests after every step'
$script:hangLib = $true; . (Join-Path $PSScriptRoot 'hangv.ps1')
$h3csv = Join-Path $out 'hang3.csv'
$script:h3inv = $null; $script:h3n = 0; $script:h3first = ''
function H3Ask($step, $form, $body, $sec) {
  $x = Post $body '' $sec; $ms = $script:lastMs
  $hit = $script:h3inv -and ($x -match "<MASTERID[^>]*>\s*$($script:h3inv.mid)\s*<")
  if ($x) { Set-Content (Join-Path $cap "hang3-$($script:h3n)-$step-$form.xml") $(if ($x.Length -gt 200000) { $x.Substring(0, 200000) } else { $x }) -Encoding UTF8 }
  return [pscustomobject]@{ ok = [bool]$x; ms = $ms; chars = $x.Length; hit = $hit }
}
$script:hangStep = {
  param($step)
  $script:h3n++
  if (-not $script:h3inv) {
    $null = Imp 'Vouchers' (HInv 'share e-invoice') 'hang3 xml invoice'
    $l = Vouchers; $script:h3inv = @($l | Where-Object { $_.narr -eq 'share e-invoice' })[0]
    if (-not $script:h3inv) { Result 'hang3 the XML invoice' 'HARNESS' 'not in Tally after the import'; $script:hangStep = $null; return }
    Info "hang3: the XML invoice MasterID $($script:h3inv.mid), $($script:h3inv.type) $($script:h3inv.vno) of $($script:h3inv.date)"
  }
  $m = $script:h3inv.mid; $d = $script:h3inv.date
  $o = H3Ask $step 'new-234' (Req234 $m) 30
  $b = if ($o.ok) { H3Ask $step 'published-233' (Req233 $m $d) 60 } else { [pscustomobject]@{ ok = $false; ms = 0; chars = 0; hit = $false } }
  $alive = if ($o.ok -and $b.ok) { $true } else { HAlive }
  $again = ''; $after = ''
  if (-not ($o.ok -and $b.ok)) {
    Shot "hang3-$step-hung"
    if (-not $script:h3first) { $script:h3first = $step }
    & $script:TdsRestart
    $again = HAlive
    if ($again) { $r = H3Ask "$step-restarted" 'published-233' (Req233 $m $d) 60; $after = "$($r.ok) ($($r.ms) ms)"; if (-not $r.ok) { Shot "hang3-$step-restart-hung"; & $script:TdsRestart } }
  }
  [pscustomobject]@{ rel = $rel; n = $script:h3n; step = $step; obj234 = $o.ok; obj234_ms = $o.ms; obj234_entry = $o.hit; bm233 = $b.ok; bm233_ms = $b.ms; bm233_entry = $b.hit; alive_after = $alive; restart_answers = $again; bm233_after_restart = $after } | Export-Csv $h3csv -Append -NoTypeInformation -Encoding UTF8
  Result "hang3 step $($script:h3n) $step" $(if ($o.ok -and $b.ok) { 'ANSWERED' } else { 'HANG' }) ("after {0}: 2.3.4 object {1} ({2} ms, the entry {3}); 2.3.3 by master {4} ({5} ms, the entry {6}); Tally answers after: {7}; started again: {8}; 2.3.3 after the restart: {9}" -f $step,
      $(if ($o.ok) { 'answered' } else { 'NO ANSWER in 30 s' }), $o.ms, $(if ($o.hit) { 'in it' } else { 'not in it' }), $(if ($b.ok) { 'answered' } elseif (-not $o.ok) { 'not sent' } else { 'NO ANSWER in 60 s' }), $b.ms, $(if ($b.hit) { 'in it' } else { 'not in it' }), $alive, $again, $after)
}
$script:shareCasesOnly = $true; . (Join-Path $PSScriptRoot 'sharev.ps1')
$script:hangStep = $null
# run 37729166801's own order after the cases
$null = Imp 'Vouchers' (HInv 'share e-invoice 2') 'hang3 xml invoice 2'
$l = Vouchers; $v2 = @($l | Where-Object { $_.narr -eq 'share e-invoice 2' })[0]
if ($v2) {
  $b = Post (Req233 $v2.mid $v2.date) '' 60; $bm = $script:lastMs
  $h = if ($b) { Post (HReq $v2.mid) '' 60 } else { '' }; $hm = $script:lastMs
  Result 'hang3 run-37729166801 order' $(if ($b -and $h) { 'ANSWERED' } else { 'HANG' }) ("a second XML invoice (MasterID {0}) imported after the cases, Tally's list, then the 2.3.3 bytes: {1} ({2} ms); the hanging collection: {3} ({4} ms); Tally answers after: {5}" -f $v2.mid, $(if ($b) { 'answered' } else { 'NO ANSWER' }), $bm, $(if ($h) { 'answered' } elseif (-not $b) { 'not sent' } else { 'NO ANSWER' }), $hm, (HAlive))
} else { Result 'hang3 run-37729166801 order' 'HARNESS' 'the second XML invoice is not in Tally' }
Info "hang3: the first step after which a request got no answer: $(if ($script:h3first) { $script:h3first } else { 'none' })"
HStop
Say 'done (hang3)'
