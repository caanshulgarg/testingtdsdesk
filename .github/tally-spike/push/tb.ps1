# tb.ps1 - MEASUREMENT ONLY (branch selfcheck-tb, workflow selfcheck-tb.yml), dot-sourced by pushm.ps1 when PD_MODE=tb
# (07-Oct-2026, next release item e: the nightly self-check; docs/selfcheck-requests-for-approval.md on next-selfcheck).
# The owner asked for the trial-balance requests to be timed on the 30,004-voucher company before deciding. Nothing here
# is built into the bridge. On the heavy company (30,000 heavy vouchers + the light company's 4), with no add-on and no
# bridge, each request is sent 5 times with the freeze probe of v3.ps1 (FetchProbe: a key sent to Tally 120 ms after the
# request left, the time until Tally's screen changed):
#   closings-<a>-<b>  FinComLedgerClosings: the closing balance of the ledgers with MasterID in (a, b], 200 a request,
#                     the books' period (20260401-20261007), exactly the XML of the document's section 8.1
#   byname-<ledger>   FinComLedgerClosingByName (8.2): one ledger, for the busiest ledgers and one party
#   tb-report         Tally's Trial Balance report in one request (8.3, not recommended)
# Outputs: tb.csv (one row per request and repetition), tb-summary.txt (median and worst per request kind), captures\tb-*.
$tbF = Join-Path $out 'tb.csv'; $tbS = Join-Path $out 'tb-summary.txt'
$tbFrom = '20260401'; $tbTo = '20261007'
function TbStatics { '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + [Security.SecurityElement]::Escape($co) + '</SVCURRENTCOMPANY><SVFROMDATE>' + $tbFrom + '</SVFROMDATE><SVTODATE>' + $tbTo + '</SVTODATE>' }
function TbColl($id, $filter) {
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES>' + (TbStatics) +
  '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, NAME, CLOSINGBALANCE</FETCH><FILTERS>' + $id + 'Only</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="' + $id + 'Only">' + $filter + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
function TbClosings($a, $b) { TbColl 'FinComLedgerClosings' ('$MasterID &gt; ' + $a + ' AND $MasterID &lt;= ' + $b) }
function TbByName($n) { TbColl 'FinComLedgerClosingByName' ('$Name = &#34;' + [Security.SecurityElement]::Escape($n) + '&#34;') }
function TbReport { '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Trial Balance</ID></HEADER><BODY><DESC><STATICVARIABLES>' + (TbStatics) + '<EXPLODEFLAG>Yes</EXPLODEFLAG><ISLEDGERWISE>Yes</ISLEDGERWISE></STATICVARIABLES></DESC></BODY></ENVELOPE>' }
function Med($a) { $s = @($a | Sort-Object); if (-not $s.Count) { return '' }; if ($s.Count % 2) { return $s[[int](($s.Count - 1) / 2)] }; return [math]::Round(($s[$s.Count / 2 - 1] + $s[$s.Count / 2]) / 2, 1) }

function TbOne($kind, $name, $body, $reps = 5) {
  $rows = @()
  for ($i = 1; $i -le $reps; $i++) {
    Focus | Out-Null
    $file = Join-Path $cap "tb-$name.xml"
    $p = FetchProbe $body $file
    $x = [IO.File]::ReadAllText($file)
    $r = [pscustomobject]@{ rel = $rel; kind = $kind; name = $name; rep = $i; ms = $p.ms; probe_ms = $p.probe_ms; probe_during = $p.overlap; bytes = $x.Length
      ledgers = ([regex]::Matches($x, '<LEDGER[ >]')).Count; closings = ([regex]::Matches($x, '<CLOSINGBALANCE[^>]*>[^<]+<')).Count
      tb_lines = ([regex]::Matches($x, '<DSPACCNAME>')).Count; over2s = ($p.ms -gt 2000); err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|FAILED[^\r\n]*').Value }
    $r | Export-Csv $tbF -Append -NoTypeInformation -Encoding UTF8
    $rows += $r
    Start-Sleep -Milliseconds 500
  }
  $ms = @($rows | ForEach-Object { [double]$_.ms }); $pr = @($rows | Where-Object { $_.probe_during } | ForEach-Object { [double]$_.probe_ms })
  Say ("tb {0} {1}: median {2} ms, worst {3} ms over {4}; {5} B, {6} ledgers, {7} closings, {8} TB lines; probe during the request: median {9} ms, worst {10} ms ({11} of {4} overlapped) {12}" -f
    $kind, $name, (Med $ms), ($ms | Measure-Object -Maximum).Maximum, $reps, $rows[0].bytes, $rows[0].ledgers, $rows[0].closings, $rows[0].tb_lines, (Med $pr), $(if ($pr.Count) { ($pr | Measure-Object -Maximum).Maximum } else { '' }), $pr.Count, $rows[0].err)
  return , $rows
}

function TbStage {
  if (-not $heavyOk) { Say 'tb: no heavy company: nothing measured'; return }
  if (-not (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)) { Say 'HARNESS: Start-ThreadJob missing: no tb stage'; return }
  if (-not (Start-T $heavy @() 'tb-heavy')) { Say 'HARNESS: tb heavy did not open'; return }
  $nv = Count 'Voucher'; $nl = Count 'Ledger'
  Say "tb: heavy company open: $nv vouchers, $nl ledgers (TallyPrime $rel)"
  Focus | Out-Null; Shot 'tb-gateway'
  $idle = @(1..5 | ForEach-Object { $x = [PdUi]::KeyLatency($script:probeKey, $false, 5000); $script:probeKey = if ($script:probeKey -eq 0x28) { 0x26 } else { 0x28 }; Start-Sleep -Milliseconds 300; [math]::Round($x, 1) })
  Say "tb: the probe key on an idle Tally: $($idle -join ', ') ms"
  $mx = Post (Coll 'FCPLedMids' 'Ledger' 'MASTERID') '' 300
  $mids = @([regex]::Matches($mx, '<MASTERID[^>]*>\s*(\d+)') | ForEach-Object { [int64]$_.Groups[1].Value })
  $top = ($mids | Measure-Object -Maximum).Maximum
  Say "tb: ledger MasterIDs: $($mids.Count), highest $top"
  $all = @()
  $sweep = @{}
  for ($a = 0; $a -lt $top; $a += 200) {
    $rows = TbOne 'closings' "$a-$($a + 200)" (TbClosings $a ($a + 200))
    $all += $rows
    foreach ($r in $rows) { $sweep[$r.rep] = [double]$sweep[$r.rep] + [double]$r.ms }
  }
  foreach ($n in @('HDFC Bank', 'Spike Income', 'HParty 00001')) { $all += TbOne 'byname' ($n -replace '\W', '_') (TbByName $n) }
  $all += TbOne 'report' 'tb-report' (TbReport)
  # the summary: per kind, the median and the worst single request; the closings' whole sweep per repetition
  $lines = @("TallyPrime $rel, heavy company: $nv vouchers, $nl ledgers; period $tbFrom-$tbTo; probe on an idle Tally: $($idle -join ', ') ms")
  foreach ($k in 'closings', 'byname', 'report') {
    $ms = @($all | Where-Object { $_.kind -eq $k } | ForEach-Object { [double]$_.ms }); $pr = @($all | Where-Object { $_.kind -eq $k -and $_.probe_during } | ForEach-Object { [double]$_.probe_ms })
    $o2 = @($all | Where-Object { $_.kind -eq $k -and $_.over2s }).Count
    $lines += ("{0}: {1} requests, median {2} ms, worst {3} ms, over 2 s: {4}; screen probe during them: median {5} ms, worst {6} ms ({7} overlapped)" -f $k, $ms.Count, (Med $ms), ($ms | Measure-Object -Maximum).Maximum, $o2, (Med $pr), $(if ($pr.Count) { ($pr | Measure-Object -Maximum).Maximum } else { '-' }), $pr.Count)
  }
  $sw = @($sweep.Values)
  $lines += ("closings, the whole ledger list ($([math]::Ceiling($top / 200)) requests of 200) per repetition: median {0} ms, worst {1} ms" -f (Med $sw), ($sw | Measure-Object -Maximum).Maximum)
  Set-Content $tbS $lines -Encoding UTF8
  $lines | ForEach-Object { Say "tb summary: $_" }
  Stop-T
}
