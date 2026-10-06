# The owner's real-Tally checks for bridge 2.3.1 (S1..S10), dot-sourced by flow4.ps1 (its functions and variables: KeysTo,
# Post, Vouchers, DayBook, WaitLine, StubLines, StubReqs, Mark, Result, Shot, $B, $co1, $out, $resultsFile). Each entry is
# imported by XML (scen231.mjs: the harness's ground truth), then opened on Tally's screen and saved with Ctrl+A so the add-on
# writes its line (an XML import over HTTP writes none: run 37402702702) and the bridge asks Tally for it with its own entry
# request. Each scenario is checked with the cloud's parse.js on the body the stub received, against Tally's own export of
# the entry (read by tallyxml.mjs, never through the bridge) and what the harness entered (parsecheck.mjs s231).
#   S231Masters     before the bridges start: the masters, the bill S4 pays (a journal of 1-10-2026)
#   S231AfterStart  after bridge 1's first light check (its starting point): S9's GSTIN altered, Tally's ALTMSTID before / after
#   S231Run         after checks 1-8: S1-S7 and S10, then S8 right after a light check, S9's ledger_changes, the checks
# The real XML Tally gives to the bridge's own requests (built by the bridge's code at the ref, the build job) is kept in
# $out\captures231 and copied to bridge-go\testdata\real-tally-7.1\231 for the bridge's tests.
$s231 = @{ dir = Join-Path $out 'scen231'; cap = Join-Path $out 'captures231'; req = Join-Path $env:BRIDGE_DIST 'requests'; ent = @{}; manifest = [ordered]@{} }
New-Item -ItemType Directory -Force $s231.dir, $s231.cap | Out-Null

# a request to Tally with its time and size; on a time-out (a modal message of Tally's stops its server: probe run
# 37406443289) a screenshot and Enter to close the message
function PostT([int]$port, [string]$body, [string]$label, [int]$sec = 45) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest "http://localhost:$port" -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $sec
    $sw.Stop(); $c = "$($r.Content)"; $n = [int64]$r.RawContentLength; if ($n -le 0) { $n = [Text.Encoding]::UTF8.GetByteCount($c) }
    $s = $c -replace '\s*\r?\n\s*', ''; if ($s.Length -gt 500) { $s = $s.Substring(0, 500) + '...' }
    Write-Host "[$label :$port] $($sw.ElapsedMilliseconds) ms, $n bytes: $s"
    return [pscustomobject]@{ ok = $true; ms = $sw.ElapsedMilliseconds; bytes = $n; text = $c }
  } catch {
    $sw.Stop(); Write-Host "[$label :$port] failed after $($sw.ElapsedMilliseconds) ms: $($_.Exception.Message)"
    Shot ("s231-stuck-" + ($label -replace '[^\w-]', '')); KeysTo $port '{ENTER}' 3 ''
    return [pscustomobject]@{ ok = $false; ms = $sw.ElapsedMilliseconds; bytes = 0; text = ''; err = $_.Exception.Message }
  }
}
function ImpT([string]$report, [string]$msg, [string]$label) {
  $r = PostT 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $label
  $g = { param($t) $m = [regex]::Match($r.text, "<$t>\s*(-?\d+)"); if ($m.Success) { [int]$m.Groups[1].Value } else { -1 } }
  $why = (([regex]::Matches($r.text, '<LINEERROR>([^<]*)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join ' | ')
  $o = [pscustomobject]@{ ok = $r.ok; created = (& $g 'CREATED'); altered = (& $g 'ALTERED'); errors = (& $g 'ERRORS'); why = $why }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO S231 import {0}: created {1}, altered {2}, errors {3}{4}" -f $label, $o.created, $o.altered, $o.errors, $(if ($why) { " ($why)" } elseif (-not $r.ok) { " (no answer: $($r.err))" } else { '' }))
  return $o
}
function GenText($name) { Get-Content (Join-Path $s231.dir "$name.xml") -Raw -Encoding UTF8 }
function TallyAlt {
  $x = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCAlt</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCAlt" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name, AltMstId, AltVchId</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'change numbers'
  $m = [regex]::Match("$x", '<ALTMSTID[^>]*>\s*(\d+)'); $v = [regex]::Match("$x", '<ALTVCHID[^>]*>\s*(\d+)')
  return [pscustomobject]@{ mst = $(if ($m.Success) { [int64]$m.Groups[1].Value } else { -1 }); vch = $(if ($v.Success) { [int64]$v.Groups[1].Value } else { -1 }) }
}
function LedgerNames {
  $x = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCLN</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCLN" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name, GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $g = @{}; $n = @()
  foreach ($m in [regex]::Matches("$x", '(?s)<LEDGER NAME="([^"]*)"[^>]*>.*?<GUID[^>]*>([^<]*)</GUID>')) { $nm = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value); $n += $nm; $g[$m.Groups[2].Value.Trim()] = $nm }
  if (-not $n.Count) { $n = @([regex]::Matches("$x", '<LEDGER NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) }) }
  return [pscustomobject]@{ names = $n; guids = $g }
}
function LightChecks { if (Test-Path $B[1].log) { @(Get-Content $B[1].log | Where-Object { $_ -match "Light check of $([regex]::Escape($co1))" }).Count } else { 0 } }
# the bridge's own request at the ref (the build job printed it with placeholders); '' when the ref has none
function BridgeReq($name) { $f = Join-Path $s231.req "$name.xml"; if (Test-Path $f) { Get-Content $f -Raw -Encoding UTF8 } else { '' } }
function Keep($file, $text, $what) {
  Set-Content -Path (Join-Path $s231.cap $file) -Value $text -Encoding UTF8 -NoNewline
  $s231.manifest[$file] = $what
}
function Esc([string]$s) { [Security.SecurityElement]::Escape($s) }

function S231Masters {
  Say '---- 2.3.1 scenarios: the masters (stock items with HSN and GST rate, GST, TDS, cost centre, bank and party ledgers)'
  & node (Join-Path $PSScriptRoot 'scen231.mjs') gen $s231.dir 2>&1 | ForEach-Object { Write-Host "  $_" }
  $script:plan231 = Get-Content (Join-Path $s231.dir 'plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($m in $plan231.masters) { $null = ImpT 'All Masters' (GenText $m) $m }
  $null = ImpT 'Vouchers' (GenText $plan231.bill) 'S4 the bill (New Ref S231-BILL-1, a journal)'
  LedgerMasters @($plan231.names.buyer)
  Shot 's231-00-masters'
}
# what Tally kept of the masters: its own full export of each (kept with the run)
function LedgerMasters($list) {
  foreach ($n in $list) {
    $r = PostT 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCLM</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCLM" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>*</FETCH><FILTERS>FCLMOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FCLMOnly">$Name = "' + (Esc $n) + '"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "ledger master $n"
    Set-Content (Join-Path $s231.dir ("ledger-" + ($n -replace '\W', '') + ".full.xml")) $r.text -Encoding UTF8
  }
}
function S231Later {
  Say '---- 2.3.1 scenarios: the company''s TDS and cost centre features, the TDS nature of payment and ledgers'
  foreach ($m in $plan231.later) { $null = ImpT 'All Masters' (GenText $m) $m }
  LedgerMasters @($plan231.names.contractor, $plan231.names.contractExp, $plan231.names.tds)
  $r = PostT 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCSI2</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCSI2" ISMODIFY="No"><TYPE>StockItem</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'stock items'
  Set-Content (Join-Path $s231.dir 'stockitems.full.xml') $r.text -Encoding UTF8
  $c = PostT 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCCO</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCCO" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name, IsTDSOn, IsCostCentresOn, IsGSTOn, IsBillWiseOn</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'company features'
  $feat = ([regex]::Matches($c.text, '<(ISTDSON|ISCOSTCENTRESON|ISGSTON|ISBILLWISEON)[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" }) -join ' '
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO S231 company features after the import: $feat"
}

function S231AfterStart {
  Say '---- S9 first half: after bridge 1''s first light check (its starting point), the GST buyer''s GSTIN altered in Tally'
  for ($i = 0; $i -lt 40 -and (LightChecks) -lt 1; $i++) { Start-Sleep 3 }
  $script:s9 = [ordered]@{ checksBefore = (LightChecks); before = (TallyAlt); at = (Get-Date) }
  $script:s9.imp = ImpT 'All Masters' (GenText $plan231.s9Alter) "S9 $($plan231.names.buyer) GSTIN $($plan231.gstinOld) -> $($plan231.gstinNew)"
  $script:s9.after = TallyAlt
  Write-Host "S9: bridge 1's light checks so far $($s9.checksBefore); Tally's ALTMSTID $($s9.before.mst) -> $($s9.after.mst)"
}

# open the entry of that day on the screen and save it; the stub's line for its GUID with a body (or none)
function S231Resave($s) {
  $m0 = Mark; $g = $s.guid; $pred = { $_.guid -eq $g -and $_.xml }.GetNewClosure()
  DayBook "s231-$($s.id)" $s.day
  KeysTo 9000 '{END}' 2; KeysTo 9000 '{ENTER}' 4 "s231-$($s.id)-open"; KeysTo 9000 '^a' 4 "s231-$($s.id)-saved"
  # an invoice over the e-way bill threshold asks "send voucher details for e-Way Bill generation? Yes or No" (run 37425863775): No
  KeysTo 9000 'n' 4 "s231-$($s.id)-eway-no"
  $hit = WaitLine $m0 $pred 90
  if (-not $hit.Count) { KeysTo 9000 '{ENTER}' 3 "s231-$($s.id)-enter"; KeysTo 9000 '^a' 6 "s231-$($s.id)-saved2"; $hit = WaitLine $m0 $pred 60 }
  # a sub-screen Tally opens on the save (TDS details, cost centres): accepted as it stands
  if (-not $hit.Count) { KeysTo 9000 '^a' 4 "s231-$($s.id)-saved3"; KeysTo 9000 '^a' 4 "s231-$($s.id)-saved4"; KeysTo 9000 'y' 4 "s231-$($s.id)-yes"; $hit = WaitLine $m0 $pred 60 }
  if (-not $hit.Count) { KeysTo 9000 '{ESC}' 2; KeysTo 9000 'y' 3 "s231-$($s.id)-left"; KeysTo 9000 '{ESC}' 2 }
  return , $hit
}
function S231Entry($s, [switch]$noResave) {
  $pre = Vouchers 9000 $co1
  $i = ImpT 'Vouchers' (GenText $s.key) "$($s.id) $($s.label)"
  $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0]
  $e = [ordered]@{ id = $s.id; guid = $(if ($nv) { $nv.guid } else { '' }); mid = $(if ($nv) { $nv.mid } else { 0 }); imp = $i; lines = 0 }
  $s231.ent[$s.id] = $e
  if (-not $nv) { Write-Host "$($s.id): not made in Tally ($($i.why))"; return $e }
  $t = BridgeReq 'entry'
  if ($t) { $r = PostT 9000 ($t.Replace('$MasterID = 99999', "`$MasterID = $($nv.mid)").Replace('20261001', $s.date)) "$($s.id) after the import" 30; Set-Content (Join-Path $s231.dir "$($s.key).after-import.entry.xml") $r.text -Encoding UTF8 }
  if (-not $noResave) { $s | Add-Member -Force guid $nv.guid; $h = S231Resave $s; $e.lines = $h.Count }
  Write-Host "$($s.id): Tally mid $($e.mid) guid $($e.guid); lines with a body at the stub: $($e.lines)"
  return $e
}
# the bridge's entry request for that entry, sent by the harness: Tally's real answer, its size and time
function S231Ask($s, [int]$times = 1) {
  $e = $s231.ent[$s.id]; $t = BridgeReq 'entry'
  if (-not $t -or -not $e.mid) { return $null }
  $q = $t.Replace('$MasterID = 99999', "`$MasterID = $($e.mid)").Replace('20261001', $s.date)
  $tries = @(); for ($k = 0; $k -lt $times; $k++) { $tries += PostT 9000 $q "$($s.id) the bridge's entry request" 30 }
  $last = $tries[-1]
  Keep "$($s.key).entry.xml" $last.text "$($s.id) $($s.label): Tally's answer to the bridge's entry request (FinComVoucherByMaster, MasterID $($e.mid), $($s.date)); $($last.bytes) bytes, $($last.ms) ms"
  $e.ask = @($tries | ForEach-Object { [pscustomobject]@{ ms = $_.ms; bytes = $_.bytes; ok = $_.ok } })
  return $last
}
function S231DayBook($s) {
  $x = Post 9000 ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVCURRENTDATE>' + $s.date + '</SVCURRENTDATE><SVFROMDATE>' + $s.date + '</SVFROMDATE><SVTODATE>' + $s.date + '</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
  $mid = $s231.ent[$s.id].mid
  $fl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, ALLLEDGERENTRIES.RATEDETAILS.*, LEDGERENTRIES.*, ALLINVENTORYENTRIES.*, ALLINVENTORYENTRIES.RATEDETAILS.*, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.*, ALLINVENTORYENTRIES.BATCHALLOCATIONS.*, EWAYBILLDETAILS.*'
  $y = if ($mid) { Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCVA</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>' + $s.date + '</SVFROMDATE><SVTODATE>' + $s.date + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCVA" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fl + '</FETCH><FILTERS>FCVAOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FCVAOnly">$MasterID = ' + $mid + '</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') } else { '' }
  $f = Join-Path $s231.dir "$($s.key).daybook.xml"; Set-Content $f "$x`n<!-- the voucher collection of MasterID $mid -->`n$y" -Encoding UTF8; return $f
}
# the full ledger list (FinComLedgers, the first chunk: MasterID 0..2000) as 2.3.0 (tax-accuracy) and the ref build it, asked
# in turn three times each on the same company (400+ ledgers): time, size, ledger count
function S231LedgerTiming {
  Say '---- FinComLedgers on real Tally: 2.3.0''s request and the ref''s, three times each in turn'
  $v = [ordered]@{ '2.3.0 (tax-accuracy)' = (BridgeReq 'ledger-list-230'); "the ref ($env:BRIDGE_SHA)" = (BridgeReq 'ledger-list') }
  $res = [ordered]@{}
  foreach ($k in $v.Keys) { $res[$k] = @() }
  for ($i = 0; $i -lt 3; $i++) { foreach ($k in $v.Keys) { if ($v[$k]) { $res[$k] += PostT 9000 $v[$k] "FinComLedgers $k" 60 } } }
  foreach ($k in $v.Keys) {
    if (-not $v[$k]) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "HARNESS FinComLedgers timing ${k}: the request was not built (see the build job)"; continue }
    $t = $res[$k][-1].text; $n = ([regex]::Matches($t, '<LEDGER NAME=')).Count; $dt = ([regex]::Matches($t, '<TDSDEDUCTEETYPE[^>]*>[^<]+<')).Count
    $f = if ($k -like '2.3.0*') { 'ledger-list-2.3.0.xml' } else { 'ledger-list-2.3.1.xml' }
    Keep $f $t "Tally's answer to FinComLedgers as $k builds it (MasterID 0..2000): $n ledgers, $($res[$k][-1].bytes) bytes"
    $l = "INFO FinComLedgers timing {0}: {1} ledgers, answer {2} bytes, Tally took {3} (slowest {4} ms){5}; TDSDEDUCTEETYPE with a value on {6} ledger(s)" -f $k, $n, $res[$k][-1].bytes, (($res[$k] | ForEach-Object { "$($_.ms) ms" }) -join ', '), ($res[$k] | Measure-Object ms -Maximum).Maximum, $(if (@($res[$k] | Where-Object { $_.ms -gt 2000 }).Count) { ' - OVER 2 s' } else { '' }), $dt
    Write-Host "######## $l"; Add-Content -Path $resultsFile -Value $l -Encoding UTF8
  }
}

# ---- R1, the retry schedule (bridge 2.3.1, the owner's "never switch off"): Tally held busy for about 3 minutes (eight
# threads asking it the whole year's Day Book and every ledger in turn, so the bridge's entry request waits past its 2 s
# stop) while an entry is saved on the screen and a FinCom posting is queued. Read from bridge 1's log: its tries
# ("did not answer in time ... try N; trying again by itself at ..."), no switch-off words, the posting done, and the entry
# reaching the stub at the first try after Tally answers again
function S231Retry {
  Say '---- R1: the retry schedule while Tally is busy for about 3 minutes'
  $x = '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260801</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><NARRATION>R1 the retry check</NARRATION>' +
       '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>321.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
       '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-321.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $pre = Vouchers 9000 $co1
  $null = ImpT 'Vouchers' $x 'R1 the entry'
  $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0]
  if (-not $nv) { Result 'R1 retry schedule' $false 'the entry was not made in Tally' $true; return }
  $logBefore = @(Get-Content $B[1].log).Count; $m0 = Mark
  $heavy = @(
    ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'),
    ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCBUSY</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCBUSY" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'))
  $until = (Get-Date).AddSeconds(185)
  $jobs = @(for ($j = 0; $j -lt 8; $j++) { Start-ThreadJob -ArgumentList $heavy, $until, $j -ScriptBlock { param($h, $u, $j) $n = 0
      while ((Get-Date) -lt $u) { try { $null = Invoke-WebRequest 'http://localhost:9000' -Method Post -Body $h[($n + $j) % 2] -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 120 } catch {}; $n++ }; $n } })
  Start-Sleep 8
  $lat = PostT 9000 '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>' 'R1 a small request while Tally is busy' 120
  $tSave = Get-Date
  DayBook 'r1' '1-8-2026'; KeysTo 9000 '{END}' 2; KeysTo 9000 '{ENTER}' 4 'r1-open'; KeysTo 9000 '^a' 4 'r1-saved'; KeysTo 9000 'n' 2 'r1-no'
  # a FinCom posting while the reads wait (postings never wait for the retry schedule)
  $pv = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260801</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>R1 posting | TDSDesk:R1P1</NARRATION>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-55.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>55.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $tPost = Get-Date
  $null = Invoke-RestMethod 'http://127.0.0.1:8787/' -Method Post -Body (@{ kind = '_queue_post'; id = 'r1-job-1'; company = $co1; payload = @{ vouchers = @(@{ id = 'R1P1'; xml = $pv }) } } | ConvertTo-Json -Compress -Depth 6) -ContentType 'application/json'
  while ((Get-Date) -lt $until) { Start-Sleep 5 }
  $done = @($jobs | Wait-Job -Timeout 150 | Receive-Job); $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  $tFree = Get-Date
  Write-Host "R1: busy until $($tFree.ToString('HH:mm:ss')), heavy requests answered: $(($done | Measure-Object -Sum).Sum)"
  $g = $nv.guid; $pred = { $_.guid -eq $g -and $_.xml }.GetNewClosure()
  $hit = @(WaitLine $m0 $pred 420)
  $tArr = if ($hit.Count) { $hit[0].at } else { '' }
  $log = @(Get-Content $B[1].log | Select-Object -Skip $logBefore)
  $tries = @($log | ForEach-Object { $m = [regex]::Match($_, 'did not answer in time at (\d\d:\d\d:\d\d) \(([^,]+), try (\d+)\); trying again by itself at (\d\d:\d\d:\d\d)'); if ($m.Success) { [pscustomobject]@{ at = $m.Groups[1].Value; id = $m.Groups[2].Value; n = [int]$m.Groups[3].Value; next = $m.Groups[4].Value } } })
  $back = @($log | Where-Object { $_ -match 'answered in time again' }) | Select-Object -First 1
  $off = @($log | Where-Object { $_ -match 'switch(ed)? off|turned off|is off for|stopped by the bridge itself|stops reading' })
  $gap = { param($a, $b) [int]([datetime]::ParseExact($b, 'HH:mm:ss', $null) - [datetime]::ParseExact($a, 'HH:mm:ss', $null)).TotalSeconds }
  $steps = @(for ($i = 0; $i -lt $tries.Count; $i++) { & $gap $tries[$i].at $tries[$i].next })
  $pu = @(StubReqs | Where-Object { $_.kind -eq 'posts_update' -and $_.body.id -eq 'r1-job-1' } | ForEach-Object { "$($_.at) $($_.body.status) done $($_.body.done)" })
  $pt = @(StubReqs | Where-Object { $_.kind -eq 'posts_take' -and $_.answer.job } | ForEach-Object { $_.at })
  $px = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCR1P</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCR1P" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>Narration, MasterID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $posted = "$px" -match 'TDSDesk:R1P1'
  $firstAfter = @($tries | Where-Object { [datetime]::ParseExact($_.next, 'HH:mm:ss', $null) -ge [datetime]::ParseExact($tFree.ToString('HH:mm:ss'), 'HH:mm:ss', $null) })[0]
  $arrOk = $tArr -and $firstAfter -and [math]::Abs((& $gap $firstAfter.next $tArr)) -le 20
  $want = @(15, 30, 60, 120)
  $stepsOk = $steps.Count -ge 4 -and @(0..3 | Where-Object { [math]::Abs($steps[$_] - $want[$_]) -le [math]::Max(5, $want[$_] * 0.25) }).Count -eq 4
  $txt = "Tally busy {0}..{1} (a small request took {2} ms; the entry saved {3}); bridge 1's tries: {4}; steps {5} s (expected 15, 30, 60, 120, then 300); back to normal: {6}; switch-off words: {7}; posting queued {8}, taken {9}, updates {10}, in Tally: {11}; the entry at the stub {12} (Tally free {13}; the first try after that {14})" -f `
    $tSave.ToString('HH:mm:ss'), $tFree.ToString('HH:mm:ss'), $lat.ms, $tSave.ToString('HH:mm:ss'), $(($tries | ForEach-Object { "try $($_.n) at $($_.at) ($($_.id)) next $($_.next)" }) -join '; '), ($steps -join ', '), $(if ($back) { $back.Substring(0, [Math]::Min(120, $back.Length)) } else { 'not seen' }), $(if ($off.Count) { $off -join ' | ' } else { 'none' }), $tPost.ToString('HH:mm:ss'), ($pt -join ','), ($pu -join '; '), $posted, $(if ($tArr) { $tArr } else { 'NOT arrived' }), $tFree.ToString('HH:mm:ss'), $(if ($firstAfter) { $firstAfter.next } else { 'none' })
  if (-not $tries.Count) { Result 'R1 retry schedule' $false "$txt; Tally was not busy enough to stop the bridge's request (no try in its log)" $true }
  else { Result 'R1 retry schedule' ($stepsOk -and $off.Count -eq 0 -and $posted -and $arrOk) $txt }
}


# ---- S5 by Tally's own screens (the import kept no TDS): Tally 9000 started again (at the Gateway, the company loaded), the
# masters made by keys as probes 37443895060..37452140499 found the forms (Create -> TDS Nature of Payments: Name, Section,
# Payment code, Remittance code, rate for individuals/HUF, rate for others, zero rated, threshold; a Sundry Creditors ledger:
# bill-by-bill, Is TDS Deductable, Deductee type, Deduct TDS in Same Voucher; a Duties & Taxes ledger: Type of Duty/Tax TDS,
# Nature of payment), then a journal with Tally's Stat Adjustment (Alt+J) for the TDS deduction. Screenshots s5k-*
function S231TdsKeys {
  Say '---- S5 by keys: Tally started again; the TDS masters and a journal on the screen'
  Stop-Process -Id $script:tallyPids[9000] -Force -ErrorAction SilentlyContinue; Start-Sleep 4
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tallyPids[9000] = $t.Id
  $null = WaitPort 9000; Start-Sleep 5; KeysTo 9000 'a' 4; KeysTo 9000 't' 10 's5k-00-gateway'
  $clear = '{BACKSPACE}' * 24
  KeysTo 9000 'c' 3 's5k-01-create'
  KeysTo 9000 $clear 1; KeysTo 9000 'TDS Nature of Payments' 2; KeysTo 9000 '{ENTER}' 3 's5k-10-nature'
  foreach ($k in 'S5K 194C Contractors{ENTER}', '194C{ENTER}', '94C{ENTER}', '{ENTER}', '1{ENTER}', '2{ENTER}', '{ENTER}') { KeysTo 9000 $k 1 }
  KeysTo 9000 '{ENTER}' 3 's5k-11-nature-saved'; KeysTo 9000 '{ESC}' 3; KeysTo 9000 'y' 3 's5k-12-list'
  KeysTo 9000 $clear 1; KeysTo 9000 'Ledger' 2; KeysTo 9000 '{ENTER}' 3 's5k-20-party'
  foreach ($k in 'S5K Contractor{ENTER}', '{ENTER}', 'Sundry Creditors{ENTER}', 'n', '{ENTER}', 'y', '{ENTER}', 'Company - Resident', '{ENTER}', 'y', '{ENTER}') { KeysTo 9000 $k 1 }
  KeysTo 9000 '^a' 3 's5k-21-party-accept'; KeysTo 9000 '{ESC}' 3; KeysTo 9000 'y' 3 's5k-22-list'
  KeysTo 9000 $clear 1; KeysTo 9000 'Ledger' 2; KeysTo 9000 '{ENTER}' 3 's5k-30-duty'
  foreach ($k in 'S5K TDS 194C{ENTER}', '{ENTER}', 'Duties & Taxes{ENTER}', 'TDS', '{ENTER}', 'S5K 194C Contractors', '{ENTER}') { KeysTo 9000 $k 1 }
  KeysTo 9000 '^a' 3 's5k-31-duty-accept'; KeysTo 9000 '{ESC}' 3; KeysTo 9000 'y' 3 's5k-32-list'
  KeysTo 9000 $clear 1; KeysTo 9000 'Ledger' 2; KeysTo 9000 '{ENTER}' 3 's5k-40-exp'
  foreach ($k in 'S5K Contract Work{ENTER}', '{ENTER}', 'Indirect Expenses{ENTER}') { KeysTo 9000 $k 1 }
  KeysTo 9000 '^a' 3 's5k-41-exp-accept'; KeysTo 9000 '{ESC}' 3; KeysTo 9000 'y' 3; KeysTo 9000 '{ESC}' 3 's5k-42-gateway'
  $lm = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCS5K</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCS5K" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  Set-Content (Join-Path $s231.dir 's5k-ledgers.full.xml') "$lm" -Encoding UTF8
  $made = @('S5K Contractor', 'S5K TDS 194C', 'S5K Contract Work' | Where-Object { "$lm" -match [regex]::Escape("NAME=`"$_`"") })
  $dt = [regex]::Match("$lm", '(?s)<LEDGER NAME="S5K Contractor".*?<TDSDEDUCTEETYPE[^>]*>([^<]*)<').Groups[1].Value
  $nat = [regex]::Match("$lm", '(?s)<LEDGER NAME="S5K TDS 194C".*?<TDSRATENAME[^>]*>([^<]*)<').Groups[1].Value
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO S5 by keys: ledgers made: $($made -join ', '); deductee type '$dt'; the TDS ledger's nature '$nat'"
  # the journal: Stat Adjustment (Alt+J) for TDS, then Dr the expense, To the TDS ledger, To the party
  $pre = Vouchers 9000 $co1; $m0 = Mark
  KeysTo 9000 'v' 3 's5k-50-vouchers'; KeysTo 9000 '{F7}' 3 's5k-51-journal'; KeysTo 9000 '{F2}' 2; KeysTo 9000 '2-8-2026{ENTER}' 2 's5k-52-date'
  KeysTo 9000 '%j' 3 's5k-53-stat-adj'; KeysTo 9000 'TDS' 1; KeysTo 9000 '{ENTER}' 2 's5k-54-type'
  KeysTo 9000 '{ENTER}' 2 's5k-55-nature-adj'; KeysTo 9000 '{DOWN}' 1 's5k-55b-down'; KeysTo 9000 '{UP}' 1; KeysTo 9000 '{ENTER}' 2 's5k-56'; KeysTo 9000 '{ENTER}' 2 's5k-57'; KeysTo 9000 '^a' 3 's5k-58-adj-accept'
  KeysTo 9000 'S5K Contract Work' 1; KeysTo 9000 '{ENTER}' 2 's5k-60-exp'; KeysTo 9000 '100000' 1; KeysTo 9000 '{ENTER}' 2 's5k-61-amt'
  KeysTo 9000 't' 1; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 'S5K TDS 194C' 1; KeysTo 9000 '{ENTER}' 3 's5k-62-tds'
  KeysTo 9000 '{DOWN}' 1 's5k-63-tds-list'; KeysTo 9000 '{UP}' 1
  for ($i = 1; $i -le 6; $i++) { KeysTo 9000 '{ENTER}' 2 ("s5k-64-tds-{0:d2}" -f $i) }
  KeysTo 9000 't' 1; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 'S5K Contractor' 1; KeysTo 9000 '{ENTER}' 3 's5k-65-party'
  for ($i = 1; $i -le 4; $i++) { KeysTo 9000 '{ENTER}' 2 ("s5k-66-party-{0:d2}" -f $i) }
  KeysTo 9000 '^a' 4 's5k-67-accept'; KeysTo 9000 '^a' 4 's5k-68-accept-2'
  $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($pre | ForEach-Object mid) })[0]
  $s = [pscustomobject]@{ id = 'S5'; key = 's5-payment-tds-keys'; label = 'TDS entered on the screen'; kind = 'tds'; day = '2-8-2026'; date = '20260802' }
  if (-not $nv) { Result 'S5 TDS entered on the screen' $false "masters made by keys: $($made -join ', ') (deductee type '$dt', TDS ledger nature '$nat'); no journal saved: see the s5k-* screenshots" $true; return }
  $s231.ent['S5K'] = [ordered]@{ id = 'S5K'; guid = $nv.guid; mid = $nv.mid; lines = 0 }
  $g = $nv.guid; $hit = @(WaitLine $m0 ({ $_.guid -eq $g -and $_.xml }.GetNewClosure()) 120)
  $s231.ent['S5'] = $s231.ent['S5K']
  $a = S231Ask $s
  $db = S231DayBook ([pscustomobject]@{ id = 'S5'; key = 's5-payment-tds-keys'; date = '20260802' })
  $d = Get-Content $db -Raw
  $tx = [regex]::Match($d, '(?s)<TAXOBJECTALLOCATIONS\.LIST>(.*?)</TAXOBJECTALLOCATIONS\.LIST>').Groups[1].Value
  $tv = { param($t) [regex]::Match($tx, "<$t[^>]*>([^<]+)<").Groups[1].Value }
  $fx = if ($hit.Count) { $hit[-1].xml } else { '' }
  $ft = [regex]::Match($fx, '(?s)<TAXOBJECTALLOCATIONS\.LIST>(.*?)</TAXOBJECTALLOCATIONS\.LIST>').Groups[1].Value
  $fv = { param($t) [regex]::Match($ft, "<$t[^>]*>([^<]+)<").Groups[1].Value }
  $sec = [regex]::Match($d, '<TDSDEDUCTEESECTIONNUMBER[^>]*>([^<]+)<').Groups[1].Value
  $txt = "Tally mid $($nv.mid); nature: Tally '$(& $tv 'CATEGORY')' / FinCom body '$(& $fv 'CATEGORY')'; rate: Tally '$(& $tv 'TAXRATE')' / FinCom '$(& $fv 'TAXRATE')'; assessable: Tally '$(& $tv 'ASSESSABLEAMOUNT')' / FinCom '$(& $fv 'ASSESSABLEAMOUNT')'; TDS: Tally '$(& $tv 'TAX')' / FinCom '$(& $fv 'TAX')'; section: Tally '$sec' (nature master 194C); deductee type: Tally ledger '$dt'; the bridge's line: $(if ($hit.Count) { "$($hit[-1].ev) at $($hit[-1].at), body $($fx.Length) chars" } else { 'none' })"
  if (-not $tx.Trim()) { Result 'S5 TDS entered on the screen' $false "$txt; Tally kept no TDS details on the saved journal (see s5k-* screenshots)" $true }
  else { Result 'S5 TDS entered on the screen' ((& $tv 'TAX') -and (& $tv 'TAX') -eq (& $fv 'TAX') -and (& $tv 'CATEGORY') -eq (& $fv 'CATEGORY')) $txt }
}

function RowText($r) { "{0}: Tally {1} / FinCom {2}{3}{4}" -f $r.what, $r.tally, $r.fincom, $(if ($null -ne $r.entered) { " / entered $($r.entered)" } else { '' }), $(if ($r.status -eq 'fail') { ' NO' } elseif ($r.status -eq 'harness') { ' (not in Tally: harness)' } else { '' }) }

function S231Run {
  Say '---- 2.3.1 scenarios S1-S7 and S10: each imported, opened on the screen and saved, its body checked'
  if (-not $script:s9) { $script:s9 = [ordered]@{ checksBefore = 0; before = [pscustomobject]@{ mst = -1; vch = -1 }; after = [pscustomobject]@{ mst = -1; vch = -1 }; at = (Get-Date).AddMinutes(-13); imp = [pscustomobject]@{ altered = -1; errors = -1 } } }
  S231Later
  $mark231 = Mark
  $sc = @{}; foreach ($s in $plan231.scenarios) { $sc[$s.id] = $s }
  S231LedgerTiming
  foreach ($id in 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S10', 'S11', 'S12', 'S13', 'S14') { $null = S231Entry $sc[$id] }
  foreach ($id in 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S11', 'S12', 'S13', 'S14') { $null = S231Ask $sc[$id] }
  $a10 = S231Ask $sc['S10'] 3

  # ---- S9: the ledger_changes the bridge sends when the master counter moved (the light check every 10 minutes)
  Say '---- S9: Tally''s master counter moved; the ledger request and the stub''s ledger_changes'
  $buyer = $plan231.names.buyer; $gNew = $plan231.gstinNew
  $lc = BridgeReq 'ledger-changes'
  if ($lc -and $s9.before.mst -ge 0 -and $s9.after.mst -gt $s9.before.mst) {
    $r = PostT 9000 ($lc.Replace('77777', "$($s9.before.mst)").Replace('88888', "$($s9.after.mst)")) 'S9 the bridge''s ledger changes request'
    Keep 's9-ledger-changes.xml' $r.text "S9: Tally's answer to the bridge's ledger changes request (FinComLedgerChanges, AlterID $($s9.before.mst)..$($s9.after.mst)); $($r.bytes) bytes, $($r.ms) ms"
    $s9.reqGstin = if ($r.text -match [regex]::Escape($gNew)) { $gNew } else { (([regex]::Matches($r.text, '<(?:PARTYGSTIN|GSTIN)[^>]*>([^<]+)<') | ForEach-Object { $_.Groups[1].Value }) -join ',') }
  }
  $findLc = { @(StubReqs | Where-Object { $_.kind -eq 'ledger_changes' -and $_.body.company -eq $co1 } | ForEach-Object { $q = $_; @($q.body.ledgers) | Where-Object { "$($_[3])" -eq $buyer } | ForEach-Object { [pscustomobject]@{ at = $q.at; why = $q.body.why; after = $q.body.after; upto = $q.body.upto; gstin = "$($_[6])"; alter = $_[2] } } }) }
  $until = $s9.at.AddMinutes(12.5)
  while ((Get-Date) -lt $until -and -not @(& $findLc | Where-Object gstin -eq $gNew).Count) { Start-Sleep 10 }
  $lcs = @(& $findLc); $hitLc = @($lcs | Where-Object gstin -eq $gNew)[0]
  $s9txt = "Tally ALTMSTID {0} -> {1} (import: altered {2}, errors {3}); Tally GSTIN (the bridge's ledger request) {4} / FinCom (stub ledger_changes) {5}; entered {6}; bridge 1 light checks {7} -> {8}" -f $s9.before.mst, $s9.after.mst, $s9.imp.altered, $s9.imp.errors, $(if ($s9.reqGstin) { $s9.reqGstin } else { '(not asked)' }), $(if ($hitLc) { "$($hitLc.gstin) at $($hitLc.at) (why $($hitLc.why), AlterID span $($hitLc.after)..$($hitLc.upto))" } elseif ($lcs.Count) { "only $(($lcs | ForEach-Object { $_.gstin }) -join ',')" } else { '(no ledger_changes)' }), $gNew, $s9.checksBefore, (LightChecks)
  if (-not $lc) { $l9 = "EXPECTED S9 GSTIN altered: $s9txt - the bridge at this ref has no ledger requests (b-231's masters part): expected to fail before b-231 is in"; Write-Host "######## $l9"; Add-Content -Path $resultsFile -Value $l9 -Encoding UTF8 }
  elseif ($s9.after.mst -le $s9.before.mst) { Result 'S9 GSTIN altered' $false "$s9txt; Tally's master counter did not move (the import did not alter the ledger)" $true }
  elseif (-not $hitLc -and (Get-Date) -ge $until) { Result 'S9 GSTIN altered' $false "$s9txt; timed out waiting 12.5 minutes for the stub's ledger_changes" $true }
  else { Result 'S9 GSTIN altered' ([bool]$hitLc -and $s9.reqGstin -eq $gNew) $s9txt }

  # ---- S8: a new party ledger, made and used at once, right after a light check (so the counter does not bring it first)
  Say '---- S8: the stub''s ledger book seeded from Tally; a new party ledger made and used at once, after a light check'
  $ln = LedgerNames
  $seed = Invoke-RestMethod 'http://127.0.0.1:8787/' -Method Post -Body (@{ kind = '_seed_ledgers'; company = $co1; names = $ln.names; guids = $ln.guids } | ConvertTo-Json -Compress -Depth 4) -ContentType 'application/json'
  $script:oldGuid = @($ln.guids.Keys | Where-Object { $ln.guids[$_] -eq $plan231.names.oldName })[0]
  Write-Host "stub ledger book seeded with $($seed.seeded) ledger(s) of $co1 ($($ln.guids.Count) GUIDs; $($plan231.names.oldName) $oldGuid)"
  $lcN = LightChecks; $until = (Get-Date).AddMinutes(11)
  while ((Get-Date) -lt $until -and (LightChecks) -le $lcN) { Start-Sleep 5 }
  Write-Host "S8 after light check $(LightChecks) at $(Get-Date -Format HH:mm:ss)"
  $s8 = $sc['S8']; $newP = $plan231.names.newParty
  $m8 = Mark
  $li = ImpT 'All Masters' (GenText $plan231.s8Ledger) "S8 ledger $newP"
  $e8 = S231Entry $s8 -noResave
  $hold = $null; $wanted = $null; $res = $null
  if ($e8.mid) {
    $s8 | Add-Member -Force guid $e8.guid
    $h = S231Resave $s8; $e8.lines = $h.Count
    $until = (Get-Date).AddMinutes(6)
    while ((Get-Date) -lt $until) {
      $ls = @((StubLines $m8) | Where-Object { $_.guid -eq $e8.guid })
      $hold = @($ls | Where-Object { $_.state -eq 'held' -and $_.why -like 'waiting for the ledger*' })[0]
      $wanted = @(StubReqs | Select-Object -Skip $m8 | Where-Object { $_.kind -eq 'ledger_changes' -and @($_.body.ledgers | Where-Object { "$($_[3])" -eq $newP }).Count })[0]
      $res = @($ls | Where-Object { $_.lid -like '*:resolved' -and $_.state -eq 'applied' })[0]
      if ($res -or (-not $hold -and @($ls | Where-Object { $_.state -eq 'applied' }).Count)) { break }
      Start-Sleep 10
    }
    $null = S231Ask $s8
  }
  $lb = BridgeReq 'ledger-by-name'
  if ($lb) { $r = PostT 9000 ($lb.Replace('FCSPIKENAME', (Esc $newP))) 'S8 the bridge''s ledger by name request'; Keep 's8-ledger-by-name.xml' $r.text "S8: Tally's answer to the bridge's ledger by name request (FinComLedgerByName, $newP); $($r.bytes) bytes, $($r.ms) ms"
    # the TDS deductee party through the same request (2.3.1 asks for TDSDEDUCTEETYPE)
    $ct = $plan231.names.contractor; $r = PostT 9000 ($lb.Replace('FCSPIKENAME', (Esc $ct))) 'the bridge''s ledger by name request, TDS deductee'
    Keep 'ledger-by-name-tds-deductee.xml' $r.text "Tally's answer to the bridge's ledger by name request (FinComLedgerByName, $ct, a TDS deductee 'Company - Resident'); $($r.bytes) bytes, $($r.ms) ms" }
  $wantedAsked = @(StubReqs | Select-Object -Skip $m8 | Where-Object { $_.kind -eq 'beat' -and $_.answer.ledgersWanted }).Count
  $ls8 = @((StubLines $m8) | Where-Object { $_.guid -eq $e8.guid })
  $s8txt = "ledger import created {0}; entry Tally mid {1} guid {2}; stub lines for it: {3}; held: {4}; beats answering ledgersWanted: {5}; ledger_changes with {6}: {7}; applied: {8}" -f $li.created, $e8.mid, $e8.guid, $(($ls8 | ForEach-Object { "$($_.lid.Substring([Math]::Max(0, $_.lid.Length - 18))) $($_.ev) $($_.at) $($_.state)" }) -join ', '), $(if ($hold) { "$($hold.at) '$($hold.why)'" } else { 'no' }), $wantedAsked, $newP, $(if ($wanted) { "$($wanted.at) why=$($wanted.body.why)" } else { 'none' }), $(if ($res) { "$($res.at) as $($res.lid.Substring([Math]::Max(0, $res.lid.Length - 18)))" } else { 'no' })
  if (-not $lb) { $l8 = "EXPECTED S8 new party ledger used at once: $s8txt - the bridge at this ref has no ledger requests (b-231's masters part): expected to stay held before b-231 is in"; Write-Host "######## $l8"; Add-Content -Path $resultsFile -Value $l8 -Encoding UTF8 }
  elseif (-not $e8.mid) { Result 'S8 new party ledger used at once' $false "$s8txt; the entry was not made in Tally" $true }
  elseif (-not $ls8.Count) { Result 'S8 new party ledger used at once' $false "$s8txt; timed out: no line for the entry reached the stub" $true }
  elseif (-not $hold) { Result 'S8 new party ledger used at once' $false "$s8txt; the entry was applied without waiting (the ledger came first by the counter?)" $true }
  else { Result 'S8 new party ledger used at once' ([bool]$wanted -and [bool]$res -and [string]$wanted.at -le [string]$res.at) $s8txt }

  # ---- S15: a party FinCom holds renamed in Tally and used under its new name at once
  Say '---- S15: a party FinCom holds, renamed in Tally, used under its new name'
  $s15 = $sc['S15']; $oldN = $plan231.names.oldName; $newN = $plan231.names.newName
  $m15 = Mark
  $ri = ImpT 'All Masters' (GenText $plan231.s15Rename) "S15 $oldN renamed $newN"
  $e15 = S231Entry $s15 -noResave
  $hold15 = $null; $want15 = $null; $res15 = $null; $wb15 = $null
  if ($e15.mid) {
    $s15 | Add-Member -Force guid $e15.guid
    $h = S231Resave $s15; $e15.lines = $h.Count
    $until = (Get-Date).AddMinutes(6)
    while ((Get-Date) -lt $until) {
      $ls = @((StubLines $m15) | Where-Object { $_.guid -eq $e15.guid })
      $hold15 = @($ls | Where-Object { $_.state -eq 'held' -and $_.why -like 'waiting for the ledger*' })[0]
      $want15 = @(StubReqs | Select-Object -Skip $m15 | Where-Object { $_.kind -eq 'ledger_changes' -and @($_.body.ledgers | Where-Object { "$($_[3])" -eq $newN }).Count })[0]
      $res15 = @($ls | Where-Object { $_.lid -like '*:resolved' -and $_.state -eq 'applied' })[0]
      if ($res15 -or (-not $hold15 -and @($ls | Where-Object { $_.state -eq 'applied' }).Count)) { break }
      Start-Sleep 10
    }
    $wb15 = @(StubReqs | Select-Object -Skip $m15 | Where-Object { $_.kind -eq 'beat' -and @($_.answer.ledgersWanted | Where-Object { $_.name -eq $newN }).Count })[0]
    $null = S231Ask $s15
  }
  if ($lb) { $r = PostT 9000 ($lb.Replace('FCSPIKENAME', (Esc $newN))) 'S15 the bridge''s ledger by name request'; Keep 's15-ledger-by-name.xml' $r.text "S15: Tally's answer to the bridge's ledger by name request (FinComLedgerByName, $newN, renamed from $oldN); $($r.bytes) bytes, $($r.ms) ms" }
  $row15 = if ($want15) { @($want15.body.ledgers | Where-Object { "$($_[3])" -eq $newN })[0] } else { $null }
  $ls15 = @((StubLines $m15) | Where-Object { $_.guid -eq $e15.guid })
  $seq = @()
  $seq += "rename import altered $($ri.altered) errors $($ri.errors)"
  $seq += "entry Tally mid $($e15.mid) guid $($e15.guid)"
  $seq += $(if ($hold15) { "1. held $($hold15.at): '$($hold15.why)'" } else { '1. held: NO' })
  $seq += $(if ($wb15) { "2. beat $($wb15.at) answered ledgersWanted '$newN'" } else { '2. ledgersWanted: none' })
  $seq += $(if ($want15) { "3. ledger_changes $($want15.at) why=$($want15.body.why) row '$($row15[3])' GUID $($row15[0]) (FinCom holds '$oldN' as GUID ${oldGuid}: $(if ("$($row15[0])" -eq "$oldGuid") { 'same' } else { 'DIFFERENT' })); the stub's answer kept: $(@($want15.answer.kept) -join ' | ')" } else { '3. ledger_changes with the new name: none' })
  $seq += $(if ($res15) { "4. applied $($res15.at) as $($res15.lid.Substring([Math]::Max(0, $res15.lid.Length - 18))): '$($res15.why)'" } else { "4. applied: no (lines: $(($ls15 | ForEach-Object { "$($_.ev) $($_.at) $($_.state)" }) -join ', '))" })
  $t15 = $seq -join '; '
  if (-not $lb) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "EXPECTED S15 renamed party: $t15 - no ledger requests at this ref" }
  elseif (-not $e15.mid) { Result 'S15 renamed party used under its new name' $false "$t15; the entry was not made in Tally" $true }
  elseif (-not $ls15.Count) { Result 'S15 renamed party used under its new name' $false "$t15; timed out: no line for the entry reached the stub" $true }
  elseif (-not $hold15) { Result 'S15 renamed party used under its new name' $false "$t15; applied without waiting (the counter brought the rename first?)" $true }
  else { Result 'S15 renamed party used under its new name' ([bool]$wb15 -and [bool]$want15 -and "$($row15[0])" -eq "$oldGuid" -and [bool]$res15 -and $res15.why -like "*'$oldN'*" -and [string]$want15.at -le [string]$res15.at) $t15 }

  # ---- the checks of S1-S7, S10 (and S8's body): parse.js on the stub's body, against Tally's own export and the entry
  Say '---- 2.3.1 scenarios: parse.js (bridge ref) against Tally''s own export and what the harness entered'
  $parseJs = Join-Path $env:BRIDGE_DIST 'cloud\tally-cloud\parse.js'
  $all = StubLines $mark231
  $ins = @(); $tagFiles = @()
  foreach ($id in 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S10', 'S11', 'S12', 'S13', 'S14', 'S8', 'S15') {
    $s = $sc[$id]; $e = $s231.ent[$id]; if (-not $e) { continue }
    $db = S231DayBook $s
    $g = $e.guid
    $ins += [pscustomobject]@{ id = $id; key = $s.key; kind = $s.kind; notesOnly = [bool]$s.notesOnly; label = $s.label; guid = $g; truth = $s.truth; tally = $db; entry = (Join-Path $s231.cap "$($s.key).entry.xml")
      ledger = (Join-Path $s231.dir ("ledger-" + ($plan231.names.contractor -replace '\W', '') + ".full.xml"))
      lines = @($all | Where-Object { $g -and $_.guid -eq $g } | ForEach-Object { [pscustomobject]@{ ev = $_.ev; at = $_.at; xml = $_.xml; state = $_.state; why = $_.why } }) }
    $tagFiles += [pscustomobject]@{ label = "Tally's own Day Book export ($id)"; file = $db }
    $tagFiles += [pscustomobject]@{ label = "the bridge's entry request answer ($id)"; file = (Join-Path $s231.cap "$($s.key).entry.xml") }
  }
  $tagFiles += [pscustomobject]@{ label = "Tally's ledger master export ($($plan231.names.contractor), FETCH *)"; file = (Join-Path $s231.dir ("ledger-" + ($plan231.names.contractor -replace '\W', '') + ".full.xml")) }
  foreach ($f in 's15-ledger-by-name.xml', 's8-ledger-by-name.xml', 's9-ledger-changes.xml', 'ledger-by-name-tds-deductee.xml', 'ledger-list-2.3.1.xml', 'ledger-list-2.3.0.xml') { $tagFiles += [pscustomobject]@{ label = "the bridge's ledger request answer ($f)"; file = (Join-Path $s231.cap $f) } }
  $pin = Join-Path $s231.dir 'check-in.json'; $pout = Join-Path $s231.dir 'check.json'
  ConvertTo-Json -InputObject @{ scenarios = $ins; tags = $tagFiles } -Depth 12 | Set-Content $pin -Encoding UTF8
  & node (Join-Path $PSScriptRoot 'parsecheck.mjs') s231 $parseJs $pin $pout 2>&1 | ForEach-Object { Write-Host "  $_" }
  $ck = $null; try { $ck = Get-Content $pout -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Write-Host "S231 check output: $_" }
  foreach ($o in @($ck.scenarios)) {
    if ($o.id -in 'S8', 'S15') { foreach ($n in @($o.notes)) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO $($o.id) body: $n" }; Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO $($o.id) body: " + ((@($o.rows) | ForEach-Object { RowText $_ }) -join '; ')); continue }
    $s = $sc[$o.id]; $e = $s231.ent[$o.id]
    $txt = ((@($o.rows) | Where-Object { -not $_.quiet } | ForEach-Object { RowText $_ }) -join '; ')
    $fl = @(@($all) | Where-Object { $e.guid -and $_.guid -eq $e.guid -and $_.xml } | ForEach-Object { "$($_.full)" })
    $hdr = "Tally mid $($e.mid), $(if ($o.line) { "the bridge's $($o.line.ev) line at $($o.line.at), body $($o.line.xmlChars) chars, full=$($fl -join '/')" } else { 'no line with a body' })"
    foreach ($n in @($o.notes)) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO $($o.id) $n" }
    $timedOut = $e.mid -and -not $e.lines
    if (-not $e.mid) { Result "$($o.id) $($s.label)" $false "the entry was not made in Tally (import: $($e.imp.why)); $txt" $true }
    elseif ($timedOut -and -not $o.fincomFound) { Result "$($o.id) $($s.label)" $false "$hdr; timed out: no line with a body for it reached the stub after the save on the screen; $txt" $true }
    else { Result "$($o.id) $($s.label)" ($o.status -eq 'pass') "$hdr; $txt" ($o.status -eq 'harness') }
  }
  # ---- S10's size and time: the bridge's entry request for the 50-item invoice against this real Tally
  $e10 = $s231.ent['S10']
  if ($e10.ask) {
    $mx = ($e10.ask | Measure-Object ms -Maximum).Maximum; $flag = if (@($e10.ask | Where-Object { $_.ms -gt 2000 }).Count) { ' - OVER 2 s: FLAG (the bridge turns the body fetch off for the company at 2 s)' } else { ' - under 2 s' }
    $l10 = "INFO S10 size and time: the bridge's entry request for the 50-item invoice (MasterID $($e10.mid)) against real Tally: answer $($e10.ask[0].bytes) bytes; Tally took $(($e10.ask | ForEach-Object { "$($_.ms) ms" }) -join ', ') (3 asks; slowest $mx ms)$flag"
    Write-Host "######## $l10"; Add-Content -Path $resultsFile -Value $l10 -Encoding UTF8
  } else { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'HARNESS S10 size and time: the 50-item invoice was not asked (not made in Tally, or no entry request at the ref)' }
  $slow = @(Get-Content $B[1].log | Where-Object { $_ -match '2 s rule|2-second|took \d+(\.\d+)? s|turned off' } | Select-Object -Last 5)
  foreach ($l in $slow) { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO bridge 1 log (timing): $l" }
  # ---- the tag names, as real Tally gives them
  foreach ($t in @($ck.tags)) {
    $wv = @(@($t.seen) | Where-Object { $_.count -gt 0 }); $we = @(@($t.seen) | Where-Object { $_.count -eq 0 })
    $w = if ($wv.Count) { 'WITH A VALUE in ' + (($wv | ForEach-Object { "$($_.label) x$($_.count) '$($_.value)'" }) -join '; ') } else { 'NOT SEEN WITH A VALUE in any answer of this run' }
    if ($we.Count) { $w += "; only empty in: $(($we | ForEach-Object { $_.label }) -join ', ')" }
    Add-Content -Path $resultsFile -Encoding UTF8 -Value "TAG $($t.tag): $w"
  }
  try { S231Retry } catch { Result 'R1 retry schedule' $false "the harness stopped: $_" $true }
  try { S231TdsKeys } catch { Result 'S5 TDS entered on the screen' $false "the harness stopped: $_" $true }
  # ---- the captures: kept with the run and copied for the bridge's tests
  $s231.manifest['_run'] = "run $env:GITHUB_RUN_ID, bridge $env:BRIDGE_SHA, TallyPrime 7.1 Educational on $env:RUNNER_OS, $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  $s231.manifest | ConvertTo-Json | Set-Content (Join-Path $s231.cap 'manifest.json') -Encoding UTF8
  $td = Join-Path $env:GITHUB_WORKSPACE 'bridge-go\testdata\real-tally-7.1\231'
  New-Item -ItemType Directory -Force $td | Out-Null; Get-ChildItem $td -File -ErrorAction SilentlyContinue | Remove-Item -Force
  Copy-Item (Join-Path $s231.cap '*') $td -Force
  Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO S231 captures: $((Get-ChildItem $td -File | ForEach-Object { "$($_.Name) ($($_.Length) bytes)" }) -join ', ') -> bridge-go/testdata/real-tally-7.1/231/"
}
