# push233.ps1 - branch next-push (input only=push233, bridge_ref next-push): the add-on writes the FULL ENTRY at save (no
# read-back) and the bridge sends it in full with NO entry request to Tally (the owner's decision of 07-Oct-2026). Dot-sourced
# by flow4.ps1 (KeysTo, Post, ListCo, Vouchers, WaitPort, StubReqs, StubLines, WaitLine, Mark, Say, Result, Shot, Snap, $B, $co1,
# $co2, $rec, $out, $resultsFile, $dir, $exe, $data1, $tdl, $tally2, Keys2; scen231's S231TdsScreen; slow232's S2* builders).
# NOT DISPATCHED by its author: the coordinator clears the queue first. Pushed with [skip ci].
#
#   setup (before the bridges start): the masters and one template entry of each kind by XML into $co1 (a receipt, a 50-item
#     sales invoice, a sales invoice in two godowns x two batches); bridge 1 talks to Tally 9000 through the timing proxy
#     (slow232proxy.py on 127.0.0.2:9000: one JSON line per request the bridge sends, so its entry requests are COUNTED at
#     the stand); with P233_BIG (default 100000) a second, large company is built by slow232's generator for item 5.
#   run (after the bridges start), each save on Tally's screen (Day Book, the template, Alt+2, Ctrl+A), so the add-on writes:
#     P1 receipt, P2 50-item invoice, P3 payment with TDS (S231TdsScreen: typed on the screen), P4 item invoice with godowns
#        and batches: the stub gets each as ONE full entry (push, full, push_seq, no AlterID), its GUID by the rule (company
#        GUID + "-" + MasterID in 8 hex digits) and Tally's MasterID (Tally's own export), its ledger lines total zero, the TDS
#        rows on P3; the proxy saw NO FinComVoucherByMaster / FinComVoucherByNumber from bridge 1; the save time recorded
#        (Ctrl+A to the full line in the user's file, an upper bound of Tally's save plus the add-on's)
#     P5 alteration: the receipt opened and saved again: a full entry again, "altered", the same GUID, a later push_seq; P6 the
#        receipt cancelled and the invoice deleted: heads only (no full line), as 2.3.2
#     P7 (item 1) after-save details: the e-way bill number / e-invoice details on the saved invoice, and the bankers date in
#        Bank Reconciliation: per case whether a line is written (full, heads, none) and ALTVCHID before and after
#     P8 (item 2) no save screen: a plain XML import, an XML import tagged as FinCom's posting (TDSDesk:<id>), a ledger rename
#        touching vouchers (by its form), Ctrl+H multi-alter if this release has it: per case full / heads / nothing, ALTVCHID
#        before and after
#     P9 (item 3) automatic numbering: a new receipt's number in its line against Tally's export; a back-dated insert: the
#        inserted receipt's line and every receipt Tally renumbered, against Tally's export afterwards (do they get a line?)
#     P10 (item 5) two Windows users saving at the same moment (user 1's and user 2's Tally, Ctrl+A sent together): each line
#        in its own user's file, none mixed; a company on a network share (\\localhost\p233share); a save on the large company
#        (100,000+ entries): save time and screen freeze (first screen change more than 1 s after Ctrl+A)
# MEASURE / INFO lines carry what the coordinator asked recorded; PASS / FAIL only for what the build claims (P1-P6, P10 users).
$P233 = @{ dir = (Join-Path $out 'push233'); proxyLog = (Join-Path $out 'push233\proxy.jsonl'); ok = $false; loadOk = $false; tpl = @{}; tplBad = @(); saves = @()
  big = [int]$(if ($env:P233_BIG) { $env:P233_BIG } else { 100000 }); bigCo = 'FinCom Big Co'; share = '\\localhost\p233share' }
New-Item -ItemType Directory -Force $P233.dir | Out-Null

function P3Esc([string]$s) { [Security.SecurityElement]::Escape($s) }
function P3Imp($co, $report, [string[]]$objs, $label) { S2Imp $co $report $objs $label }
function P3Coll($id, $type, $fetch, $filter = '', $co = $co1) {
  $f = if ($filter) { '<FILTERS>P3F</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="P3F">' + $filter + '</SYSTEM>' } else { '</COLLECTION>' }
  Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (P3Esc $co) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
}
# Tally's change counter for a company (the light check's FinComCompany form: a Company collection)
function P3Alt($co = $co1) { $x = P3Coll 'P3Alt' 'Company' 'NAME, ALTVCHID, ALTMSTID' ('$Name = "' + $co + '"') $co; [pscustomobject]@{ vch = [int64]('0' + [regex]::Match("$x", '<ALTVCHID[^>]*>\s*(\d+)').Groups[1].Value); mst = [int64]('0' + [regex]::Match("$x", '<ALTMSTID[^>]*>\s*(\d+)').Groups[1].Value) } }
function P3CGuid($co = $co1) { [regex]::Match((ListCo 9000), '(?s)NAME="' + [regex]::Escape($co) + '".*?<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value }
function P3Proxy { if (Test-Path $P233.proxyLog) { @(Get-Content $P233.proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }) } else { @() } }
function P3EntryAsks([int]$from = 0) { @(P3Proxy | Select-Object -Skip $from | Where-Object { $_.id -in 'FinComVoucherByMaster', 'FinComVoucherByNumber' }) }
# the user's own recorder file lines (UTF-16), and the new ones since a count
function P3RecLines { @(Get-ChildItem $rec -File -Filter '*-runneradmin.txt' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' }) }
function P3Kinds($lines) { (($lines | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value }) | Group-Object | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', ' }
function P3What($lines) { if (@($lines | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' }).Count) { 'full line' } elseif (@($lines).Count) { "heads only ($(P3Kinds $lines))" } else { 'nothing' } }
function DayBookAt($date, $shot = '') { KeysTo 9000 '%g' 2; KeysTo 9000 'Day Book' 1; KeysTo 9000 '{ENTER}' 3; KeysTo 9000 '{F2}' 2; KeysTo 9000 "$date{ENTER}" 3 $shot }

# the templates (one of each kind) by XML; their numbers and dates chosen so the Day Book of the date shows it last. Dates:
# only the 1st, 2nd and 31st of a month (TallyPrime's Educational mode, as S2Dates; run 37653875217: "Voucher date is
# missing" for the 7th); each its own day, none of scen231's (Aug, Oct, Jan) nor P9's 1-11-2026
function P3Templates {
  $m = @('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
  $m += S2Led 'P233 Party' 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>'; $m += S2Led 'P233 Bank' 'Bank Accounts'
  $m += S2Led 'P233 Sales' 'Sales Accounts' '<AFFECTSSTOCK>Yes</AFFECTSSTOCK>'; $m += S2Led 'Output CGST' 'Duties & Taxes'; $m += S2Led 'Output SGST' 'Duties & Taxes'
  # the ledgers slow232's S2Receipt and S2Sales name (run 37653875217: "Ledger 'HDFC Bank' does not exist!"); S2Led escapes
  # the parent itself (that run: "Group 'Duties &amp;amp; Taxes' does not exist!")
  $m += S2Led 'HDFC Bank' 'Bank Accounts'; $m += S2Led 'Sales' 'Sales Accounts'
  foreach ($g in 'P233 Main', 'P233 Annex') { $m += '<GODOWN NAME="' + $g + '" ACTION="Create"><NAME.LIST><NAME>' + $g + '</NAME></NAME.LIST><PARENT/><HASNOSPACE>No</HASNOSPACE></GODOWN>' }
  # the 50 items with opening stock in P233 Main (run 37658127942: with godowns in the company, an item line without its
  # godown allocation is refused, EXCEPTIONS 1; the stock keeps the screen save free of a negative-stock question)
  for ($i = 1; $i -le 50; $i++) { $n = 'P233 Item {0:d2}' -f $i; $m += '<STOCKITEM NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE> 1000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-50000.00</OPENINGVALUE><BATCHALLOCATIONS.LIST><GODOWNNAME>P233 Main</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE> 1000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-50000.00</OPENINGVALUE></BATCHALLOCATIONS.LIST></STOCKITEM>' }
  foreach ($n in 'P233 Bat A', 'P233 Bat B') {
    $x = '<STOCKITEM NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS><ISBATCHWISEON>Yes</ISBATCHWISEON><HASMFGDATE>No</HASMFGDATE><ISPERISHABLEON>No</ISPERISHABLEON>'
    foreach ($g in 'P233 Main', 'P233 Annex') { foreach ($b in 'B1', 'B2') { $x += '<BATCHALLOCATIONS.LIST><GODOWNNAME>' + $g + '</GODOWNNAME><BATCHNAME>' + $b + '</BATCHNAME><OPENINGBALANCE> 1000 Nos</OPENINGBALANCE><OPENINGRATE>50.00/Nos</OPENINGRATE><OPENINGVALUE>-50000.00</OPENINGVALUE></BATCHALLOCATIONS.LIST>' } }
    $m += $x + '</STOCKITEM>'
  }
  $null = P3Imp $co1 'All Masters' $m 'push233 masters'
  $items = @(); for ($i = 1; $i -le 50; $i++) { $items += ('P233 Item {0:d2}' -f $i) }
  $P233.tpl.receipt = @{ date = '20261102'; dmy = '2-11-2026'; xml = ((S2Receipt '20261102' 'P233-R1' 'P233 Party' 1180 'push233 receipt') -replace 'HDFC Bank', 'P233 Bank') }   # P7 reconciles P233 Bank
  $P233.tpl.sales50 = @{ date = '20261201'; dmy = '1-12-2026'; xml = ((S2Sales '20261201' 'P233-S50' 'P233 Party' $items 'push233 50 items') -replace '<LEDGERNAME>Sales</LEDGERNAME>', '<LEDGERNAME>P233 Sales</LEDGERNAME>' -replace '<ACCOUNTINGALLOCATIONS\.LIST>', '<BATCHALLOCATIONS.LIST><GODOWNNAME>P233 Main</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY></BATCHALLOCATIONS.LIST><ACCOUNTINGALLOCATIONS.LIST>') }   # run 37656269159: with slow232's plain 'Sales' Tally answered EXCEPTIONS 1; the godown invoice with P233 Sales (affects stock) was created
  # the godown invoice: two batch items, each in two godowns x two batches
  $gx = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>20261202</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>P233-G1</VOUCHERNUMBER><PARTYLEDGERNAME>P233 Party</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>push233 godowns and batches</NARRATION>'
  $gx += '<LEDGERENTRIES.LIST><LEDGERNAME>P233 Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-944.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>P233-G1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-944.00</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
  foreach ($t in 'Output CGST', 'Output SGST') { $gx += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>72.00</AMOUNT></LEDGERENTRIES.LIST>' }
  foreach ($it in 'P233 Bat A', 'P233 Bat B') {
    $gx += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + $it + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>400.00</AMOUNT><ACTUALQTY> 4 Nos</ACTUALQTY><BILLEDQTY> 4 Nos</BILLEDQTY>'
    foreach ($g in 'P233 Main', 'P233 Annex') { foreach ($b in 'B1', 'B2') { $gx += '<BATCHALLOCATIONS.LIST><GODOWNNAME>' + $g + '</GODOWNNAME><BATCHNAME>' + $b + '</BATCHNAME><AMOUNT>100.00</AMOUNT><ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>' } }
    $gx += '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>P233 Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'
  }
  $P233.tpl.godown = @{ date = '20261202'; dmy = '2-12-2026'; xml = ($gx + '</VOUCHER>') }
  foreach ($k in 'receipt', 'sales50', 'godown') {
    $r = P3Imp $co1 'Vouchers' @($P233.tpl[$k].xml) "push233 template $k"
    Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO push233 template ${k}: created $($r.created), errors $($r.errors)"
    if ($r.created -lt 1) { $P233.tplBad += @($k) }
  }
}

# ---- L0, first of all: the new FinComRecorder.tdl LOADS on this release ($$StringLength and the "neg" formula are new to a
# real Tally): no TDL error on the screen or in Tally's files, and one save on the screen writes the heads lines AND the full
# entry. Before the bridges start (the recorder folder is emptied after it, so they never see this save)
function P3LoadCheck {
  Say '---- push233 L0: does the new FinComRecorder.tdl load on this release?'
  $tdlText = Get-Content $tdl -Raw -ErrorAction SilentlyContinue
  $hasFull = "$tdlText" -match 'FCRLiveFull'
  Shot 'p233-L0-start'
  $png = Join-Path $env:SHOTS 'p233-L0-start.png'
  $ocr = if (Test-Path $png) { ((& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ocr.ps1" $png 2>&1 | Out-String) -replace '\s+', ' ').Trim() } else { 'NO-SHOT' }
  $errScreen = $ocr -match 'Error in TDL|TDL Error|Unknown Function|Invalid Function|Could not load|errors? in (the )?TDL'
  $errFiles = @(Get-ChildItem $dir, $data1, (Join-Path $dir 'logs') -Recurse -File -Include 'tdlerr*', '*.tdlerr', 'tdl*.log' -ErrorAction SilentlyContinue)
  $errFiles | ForEach-Object { Copy-Item $_.FullName (Join-Path $P233.dir "L0-$($_.Name)") -ErrorAction SilentlyContinue }
  $errText = (($errFiles | ForEach-Object { Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue }) -join ' ') -replace '\s+', ' '
  if ($P233.tplBad.Count) {
    Result 'push233 setup (harness)' $false ("the template(s) {0} were not imported (see round4.log, '[slow232 import] push233 template'): no save can be made; the add-on is not judged" -f ($P233.tplBad -join ', ')) $true
    Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue; return
  }
  $r = P3Save 'receipt'
  if ($r.alt0 -eq $r.alt1 -and -not @($r.lines).Count) {
    Result 'push233 setup (harness)' $false ("L0's receipt was not saved: Tally's ALTVCHID {0} -> {1}, nothing in the recorder file (see the p233-receipt screenshots); the add-on is not judged" -f $r.alt0, $r.alt1) $true
    Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue; return
  }
  $ev = @($r.lines | ForEach-Object { [regex]::Match($_, '^FCR1\|ev=([^|]+)').Groups[1].Value })
  $full = @($r.lines | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match '\|end=1\|t1=[^|]*\|src=live$' })
  $lenOk = $full.Count -and $full[0] -match '\|narr=' -and $full[0] -match '~neg=(Yes|No)' -and $full[0] -match '\|len=\d+\|end=1\|'
  $heads = ('voucher_accept_pre' -in $ev) -and ('voucher_accept_post' -in $ev)
  $P233.loadOk = $hasFull -and $heads -and $full.Count -ge 1 -and -not $errScreen
  if ($full.Count) { Set-Content (Join-Path $P233.dir 'L0-full-line.txt') $full -Encoding UTF8 }
  Result 'push233 L0 the new add-on loads and writes the full entry' $P233.loadOk ("the TDL from the ref has FCRLiveFull: {0}; the screen after Tally started: {1}; Tally's TDL error files: {2}; one receipt saved on the screen: the add-on wrote {3}; heads (pre and post): {4}; full line(s) ending |end=1|t1=..|src=live: {5}; the narration, neg and the part's length read: {6}; save {7} ms" -f `
      $hasFull, $(if ($errScreen) { 'A TDL ERROR: ' + $ocr.Substring(0, [Math]::Min(300, $ocr.Length)) } else { 'no TDL error seen' }), $(if ($errFiles.Count) { ($errFiles | ForEach-Object Name) -join ', ' + ': ' + $errText.Substring(0, [Math]::Min(300, $errText.Length)) } else { 'none' }), $(P3Kinds $r.lines), $heads, $full.Count, [bool]$lenOk, $r.ms_fullline)
  if (-not $heads) { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO push233 L0: no heads line either: the whole add-on did not load (a function or formula this release does not know stops the file); the run stops here' }
  elseif (-not $full.Count) { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO push233 L0: the heads lines were written but no full line: FCRLiveFull failed at run time on this release' }
  Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue   # the bridges start on an empty recorder folder
  $P233.saves = @()
}

# ---- setup, before the bridges start
function Push233Setup {
  Say '---- push233 setup: the templates by XML, the new add-on''s load check, the timing proxy beside Tally 9000, the large company (item 5)'
  P3Templates
  P3LoadCheck
  if (-not $P233.loadOk) { Say 'push233: the add-on did not load or wrote no full entry: no large company, no run'; return }
  if ($P233.big -gt 0) {
    # the large company by slow232's generator, extended to $P233.big entries (its own time budget)
    $Slow232St.co = $P233.bigCo; $Slow232St.vch = $P233.big; $Slow232St.budget = [int]$(if ($env:P233_BIG_MIN) { $env:P233_BIG_MIN } else { 150 })
    $Slow232St.proxyLog = $P233.proxyLog
    try { Slow232Setup } catch { Write-Host "push233 large company: $_" }
    Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO push233 large company '$($P233.bigCo)': $($Slow232St.made) entries made by XML in $($Slow232St.importMin) min (asked $($P233.big))"
    if ($Slow232St.proxy) { $P233.proxy = $Slow232St.proxy; $P233.ok = $Slow232St.ok }
  }
  if (-not $P233.ok) {
    $P233.proxy = Start-Process python -ArgumentList "`"$PSScriptRoot\slow232proxy.py`"", '9000', "`"$($P233.proxyLog)`"" -PassThru -WindowStyle Hidden
    Start-Sleep 3
    $g = try { (Invoke-WebRequest 'http://127.0.0.2:9000' -UseBasicParsing -TimeoutSec 10).Content } catch { "failed: $($_.Exception.Message)" }
    $P233.ok = "$g" -match 'TallyPrime'
    if (-not $P233.ok) { Result 'push233 setup: the timing proxy beside Tally' $false "127.0.0.2:9000 answered: $g" $true }
  }
}

# one save on the screen: the template of that day, Alt+2 (a new entry) or Enter (the template altered), Ctrl+A timed to the
# full line in the user's file
# Esc rule: at most ONE Esc after a step (every next step starts with Alt+G, Go To, which works from any screen). From
# the Day Book a second Esc puts up Tally's own Quit question and the "y" of the next "Day Book" answers it (runs 37659738263
# and 37667984727: Tally 9000 quit after P5 and after P1).
# Tally 9000's window (gone: it quit or crashed; run 37659738263: Esc keys on an empty screen reached the Gateway's Quit
# question and the "y" of the next "Day Book" answered it)
function P3Alive { $p = Get-Process -Id $script:tallyPids[9000] -ErrorAction SilentlyContinue; [bool]($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) }
# the company Tally's screens work in (an export without SVCURRENTCOMPANY reads Tally's current company)
function P3CurCo {
  $x = Post 9000 ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P3Cur</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="P3Cur" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><FILTERS>P3CurF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="P3CurF">$Name = ##SVCurrentCompany</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''
  [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", '<NAME[^>]*>([^<]+)</NAME>').Groups[1].Value).Trim()
}
# the screens back on the small company (run 37659738263: the large company, loaded last, was current, so every save of
# P1-P6 went to its empty Day Book): F3 (Company) from the Gateway, its name, Enter, as slow232 opens one
function P3UseCo($co = $co1) {
  $cur0 = P3CurCo
  if ($cur0 -ne $co) { KeysTo 9000 '{F3}' 4 'p233-co-list'; KeysTo 9000 $co 2 'p233-co-typed'; KeysTo 9000 '{ENTER}' 6 'p233-co-chosen' }
  $cur1 = P3CurCo
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("INFO push233 the screens' company: {0} -> {1} (wanted {2})" -f $(if ($cur0) { $cur0 } else { '?' }), $(if ($cur1) { $cur1 } else { '?' }), $co)
  return ($cur1 -eq $co -or -not $cur1)   # an empty answer: not told; the saves' own checks judge
}

# one save on the large company timed as P3Save times it (Ctrl+A to a new line in a file): the add-on's full line, or with
# $stampFile a stamp-only TDL's line (item 5); Alt+2 of the last entry of 1-4-2026
function P3TimeBig($label, $stampFile) {
  if (-not (P3Alive)) { throw "Tally 9000 has no window before the timed save $label" }
  DayBookAt $P233.tpl.big.dmy "p233-t-$label-daybook"; KeysTo 9000 '{END}' 1; KeysTo 9000 '%2' 4 "p233-t-$label-dup"
  $c0 = if ($stampFile) { @(Get-Content $stampFile -Encoding Unicode -ErrorAction SilentlyContinue).Count } else { @(P3RecLines).Count }
  $p = Get-Process -Id $script:tallyPids[9000] -ErrorAction SilentlyContinue
  [W32F4]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W32F4]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500
  $sw = [Diagnostics.Stopwatch]::StartNew(); [System.Windows.Forms.SendKeys]::SendWait('^a'); $ms = -1
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    if ($stampFile) { if (@(Get-Content $stampFile -Encoding Unicode -ErrorAction SilentlyContinue).Count -gt $c0) { $ms = [int]$sw.Elapsed.TotalMilliseconds; break } }
    elseif (@(P3RecLines | Select-Object -Skip $c0 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -like '*|end=1|t1=*' }).Count) { $ms = [int]$sw.Elapsed.TotalMilliseconds; break }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep 2; Shot "p233-t-$label-saved"; KeysTo 9000 '{ESC}' 1
  return $ms
}
function P3Save($kind, [switch]$alter, $co = $co1, [switch]$noList) {
  if (-not (P3Alive)) { throw "Tally 9000 has no window (it quit or crashed) before the $kind save: the steps after this are not run" }
  $t = $P233.tpl[$kind]; $before = P3RecLines; $alt0 = P3Alt $co; $vs0 = if ($noList) { @() } else { Vouchers 9000 $co }
  DayBookAt $t.dmy "p233-$kind-daybook"
  if (-not (P3Alive)) { throw "Tally 9000 has no window (it quit or crashed) while the Day Book for the $kind save opened: the steps after this are not run" }
  if ($alter) { KeysTo 9000 '{END}' 1; KeysTo 9000 '{ENTER}' 4 "p233-$kind-open" } else { KeysTo 9000 '{END}' 1; KeysTo 9000 '%2' 4 "p233-$kind-dup" }
  $p = Get-Process -Id $script:tallyPids[9000] -ErrorAction SilentlyContinue
  [W32F4]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W32F4]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500
  $sw = [Diagnostics.Stopwatch]::StartNew(); [System.Windows.Forms.SendKeys]::SendWait('^a'); $sent = $sw.Elapsed.TotalMilliseconds
  $full = $null
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    $new = @(P3RecLines | Select-Object -Skip $before.Count)
    if (@($new | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -like '*|end=1|t1=*' }).Count) { $full = $sw.Elapsed.TotalMilliseconds; break }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep 2; Shot "p233-$kind-saved"; KeysTo 9000 '{ESC}' 1
  $new = @(P3RecLines | Select-Object -Skip $before.Count); $alt1 = P3Alt $co
  # Tally's entry: the one with the MasterID the full line names (else, for a new one, the MasterID Tally has now and had not)
  $lm = [regex]::Match((@($new | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' })[0]), '\|mid=(\d+)\|').Groups[1].Value
  $vs1 = if ($noList) { @() } else { Vouchers 9000 $co }
  $nv = @($vs1 | Where-Object { "$($_.mid)" -eq $lm })[0]
  if (-not $nv -and -not $alter) { $nv = @($vs1 | Where-Object { $_.mid -notin @($vs0 | ForEach-Object mid) })[0] }
  $s = [pscustomobject]@{ kind = $kind; alter = [bool]$alter; ms_sendwait = [int]$sent; ms_fullline = $(if ($null -ne $full) { [int]$full } else { -1 }); lines = $new; what = (P3What $new); alt0 = $alt0.vch; alt1 = $alt1.vch; v = $nv }
  $P233.saves += $s
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 save {0}{1}: Ctrl+A to the full line in the user's file {2} ms (Tally's save and the add-on, an upper bound); SendWait {3} ms; the add-on wrote: {4}; ALTVCHID {5} -> {6}; Tally's entry mid {7} guid {8} no {9}" -f $kind, $(if ($alter) { ' (alter)' } else { '' }), $s.ms_fullline, $s.ms_sendwait, $s.what, $s.alt0, $s.alt1, $nv.mid, $nv.guid, $nv.vno)
  return $s
}

# the stub's line for a save checked: one full entry, its GUID by the rule and Tally's, Tally's MasterID, no AlterID, ledger lines
# totalling zero (Tally's signed AMOUNTs of the entry's ledger lines), TDS rows when asked; and no entry request at the stand
# each ledger line of an entry as "ledger|amount" (Tally's sign), sorted: the line's own AMOUNT, its lists (bills, bank,
# cost centres, TDS) left out. For the bridge's XML and for Tally's own export of the same voucher (read here, on Tally's
# port directly, never through bridge 1's proxy: the harness's own read, not the bridge's)
function P3Ledgers($xml) {
  @(foreach ($m in [regex]::Matches("$xml", '(?s)<ALLLEDGERENTRIES\.LIST>(.*?)</ALLLEDGERENTRIES\.LIST>')) {
    $top = [regex]::Replace($m.Groups[1].Value, '(?s)<([A-Z][A-Z0-9.]*)\.LIST(?:\s[^>]*)?>.*?</\1\.LIST>', '')
    $n = [regex]::Match($top, '<LEDGERNAME[^>]*>([^<]*)</LEDGERNAME>').Groups[1].Value
    $a = [regex]::Match($top, '<AMOUNT[^>]*>([^<]*)</AMOUNT>').Groups[1].Value
    if ($n -and $a) { '{0}|{1:0.00}' -f [System.Net.WebUtility]::HtmlDecode($n).Trim(), [decimal]$a }
  }) | Sort-Object
}
# a MasterID for a request: digits only (1 to 18) or the step stops loudly before anything is sent (tally-versions runs
# 37729166801 / 37734533866: a whole list piped as one object made '$MasterID = 1 2 3 ...', which hung Tally)
function P3Mid($mid) {
  $s = "$mid".Trim()
  if ($s -notmatch '^\d{1,18}$') { $m = "HARNESS GUARD: a MasterID that is not digits only was refused before it reached Tally: '$s'"; Write-Host "::error::$m"; throw $m }
  return $s
}
function P3TallyLedgers($mid, $co = $co1) { P3Ledgers (P3Coll 'P3Led' 'Voucher' 'MASTERID, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT' ('$MasterID = ' + (P3Mid $mid)) $co) }

function P3Check($label, $s, $m0, $p0, [switch]$tds, $ev = 'created') {
  if (-not $s.v) { Result "push233 $label" $false 'Tally has no new entry after the save (see the p233 screenshots)' $true; return }
  $cg = P3CGuid; $rule = '{0}-{1:x8}' -f $cg, [int64]$s.v.mid
  $g = $s.v.guid
  $hit = @(WaitLine $m0 ({ $_.guid -eq $g -and $_.xml -and $_.ev -eq $ev }.GetNewClosure()) 120)
  $l = $hit | Select-Object -Last 1
  $raw = @((StubReqs) | Select-Object -Skip $m0 | Where-Object kind -eq 'recorder_lines' | ForEach-Object { @($_.body.lines) } | Where-Object { $_.object_guid -eq $g -and $_.event -eq $ev }) | Select-Object -Last 1
  $sum = 0.0; $nl = 0
  foreach ($m in [regex]::Matches("$($l.xml)", '(?s)<ALLLEDGERENTRIES\.LIST>.*?</ALLLEDGERENTRIES\.LIST>')) {
    $a = [regex]::Match($m.Value, '<AMOUNT[^>]*>([^<]*)</AMOUNT>').Groups[1].Value
    if ($a) { $sum += [double]$a; $nl++ }
  }
  $tdsOk = -not $tds -or ("$($l.xml)" -match '(?s)<TAXOBJECTALLOCATIONS\.LIST>.*?<CATEGORY[^>]*>[^<]+</CATEGORY>' -and "$($l.xml)" -match '<SUBCATEGORYALLOCATION\.LIST>')
  $asks = @(P3EntryAsks $p0 | Where-Object { $_.company -eq $co1 })
  # the bridge's ledger lines as Tally's own, line by line with Tally's sign (run 37611204899: a form's amounts carry none)
  $mine = @(P3Ledgers $l.xml); $theirs = @(P3TallyLedgers $s.v.mid)
  $same = $mine.Count -ge 2 -and ($mine -join ';') -eq ($theirs -join ';')
  $ok = $same -and $l -and $raw.push -eq $true -and $raw.full -eq $true -and $null -eq $raw.alter_id -and [int64]$raw.push_seq -gt 0 -and $g -eq $rule -and "$($raw.master_id)" -eq "$($s.v.mid)" -and $nl -ge 2 -and [math]::Abs($sum) -lt 0.005 -and $tdsOk -and $asks.Count -eq 0
  Result "push233 $label" $ok ("Tally mid {0} guid {1} (the rule: {2}); the stub: {3}; push={4} full={5} alter_id={6} push_seq={7}; {8} ledger lines totalling {9:0.00}; TDS rows: {10}; entry requests from bridge 1 at the stand since the save: {11}{12}; save {13} ms; ledger lines as Tally's: {14} (bridge {15}; Tally {16})" -f `
      $s.v.mid, $g, $rule, (Ev $l), $raw.push, $raw.full, $raw.alter_id, $raw.push_seq, $nl, $sum, $(if ($tds) { $tdsOk } else { 'not asked' }), $asks.Count, $(if ($asks.Count) { ' e.g. ' + ($asks[0] | ConvertTo-Json -Compress) } else { '' }), $s.ms_fullline, $same, ($mine -join '; '), ($theirs -join '; '))
  # the fields Tally sets as it stores the entry (run 37677491784: the full line is the FORM at Form Accept; a non-invoice
  # entry made new had no party there, and an Alt+2 copy's bill "New Ref" was stored "Agst Ref"): the bridge's party and
  # bill types against Tally's stored entry, reported on their own
  if ($l) {
    $tx = P3Coll 'P3Stored' 'Voucher' 'MASTERID, PARTYLEDGERNAME, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE' ('$MasterID = ' + (P3Mid $s.v.mid))
    $pick = { param($x) [pscustomobject]@{ party = [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", '<PARTYLEDGERNAME[^>]*>([^<]*)</PARTYLEDGERNAME>').Groups[1].Value).Trim(); bills = (@([regex]::Matches("$x", '<BILLTYPE[^>]*>([^<]*)</BILLTYPE>') | ForEach-Object { $_.Groups[1].Value.Trim() }) -join ',') } }
    $mineS = & $pick $l.xml; $theirsS = & $pick $tx
    Result "push233 $label party and bill types as Tally stored them" ($mineS.party -eq $theirsS.party -and $mineS.bills -eq $theirsS.bills) ("party: bridge '{0}', Tally '{1}'; bill types: bridge [{2}], Tally [{3}]" -f $mineS.party, $theirsS.party, $mineS.bills, $theirsS.bills)
  }
  if ($l) { Set-Content (Join-Path $P233.dir "$label.xml") $l.xml -Encoding UTF8 }
  Set-Content (Join-Path $P233.dir "$label.lines.txt") $s.lines -Encoding UTF8
  return $raw
}

# ---- the run, after the bridges start
function Push233 {
  Say '---- push233: the full entry at save (branch next-push)'
  if (-not $P233.loadOk) { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO push233: not run (L0: the add-on did not load or wrote no full entry)'; return }
  if (-not $P233.ok) { Result 'push233' $false 'the setup did not finish (the proxy or the templates)' $true; return }
  Start-Sleep 30   # bridge 1's first light check: its starting point (nothing is taken before it)
  if (-not (P3UseCo)) { Result 'push233 setup (harness)' $false "the screens could not be put on '$co1' (see the p233-co screenshots): no save is judged" $true; return }
  $p0 = @(P3Proxy).Count; $m0 = Mark
  # P1-P4
  $r = P3Save 'receipt'; $x1 = P3Check 'P1 receipt' $r $m0 $p0
  $r = P3Save 'sales50'; $null = P3Check 'P2 50-item invoice' $r $m0 $p0
  $r = P3Save 'godown'; $x4 = P3Check 'P4 item invoice in two godowns x two batches' $r $m0 $p0
  if ($r.v) { $x = Get-Content (Join-Path $P233.dir 'P4 item invoice in two godowns x two batches.xml') -Raw -ErrorAction SilentlyContinue
    Result 'push233 P4 godowns and batches in the entry' ("$x" -match 'P233 Annex' -and "$x" -match '<BATCHNAME[^>]*>B2<') "godown P233 Annex: $("$x" -match 'P233 Annex'); batch B2: $("$x" -match '<BATCHNAME[^>]*>B2<')" }
  # P3: TDS typed on the screen (scen231's S5 route: masters, the nature of payment on its form, the journal by keys)
  try {
    S231Later
    $before = P3RecLines; $vs0 = Vouchers 9000 $co1; $mt = Mark; $pt = @(P3Proxy).Count
    $sw = [Diagnostics.Stopwatch]::StartNew(); $s5 = S231TdsScreen; $el = $sw.Elapsed.TotalMilliseconds
    $nv = @((Vouchers 9000 $co1) | Where-Object { $_.mid -notin @($vs0 | ForEach-Object mid) })[0]
    $new = @(P3RecLines | Select-Object -Skip $before.Count)
    $s = [pscustomobject]@{ kind = 'tds'; ms_fullline = -1; lines = $new; what = (P3What $new); v = $nv }
    # (S231TdsScreen sends the bridge's entry request itself, to Tally's own port, for its comparison: not through the proxy)
    $null = P3Check 'P3 payment with TDS (typed on the screen)' $s $mt $pt -tds
  } catch { Result 'push233 P3 payment with TDS' $false "the harness stopped: $_" $true }
  # P5: the receipt altered (opened and saved again): a full entry again, "altered", the same GUID, a later push_seq
  $m5 = Mark; $p5 = @(P3Proxy).Count
  $r = P3Save 'receipt' -alter
  $x5 = P3Check 'P5 receipt altered: a full entry again' $r $m5 $p5 -ev 'altered'
  if ($x1 -and $x5) { Result 'push233 P5 the alteration follows the entry' ($x5.object_guid -eq $x1.object_guid -and [int64]$x5.push_seq -gt [int64]$x1.push_seq) "created push_seq $($x1.push_seq), altered $($x5.push_seq), GUID $($x1.object_guid) / $($x5.object_guid)" }
  # P6: cancel the receipt (Alt+X), delete the godown invoice (Alt+D): heads only, as 2.3.2
  $m6 = Mark; $before = P3RecLines
  DayBookAt $P233.tpl.receipt.dmy 'p233-cancel-daybook'; KeysTo 9000 '{END}' 1; KeysTo 9000 '%x' 3 'p233-cancel-q'; KeysTo 9000 'y' 3 'p233-cancelled'; KeysTo 9000 '{ESC}' 1
  DayBookAt $P233.tpl.godown.dmy 'p233-delete-daybook'; KeysTo 9000 '{END}' 1; KeysTo 9000 '%d' 3 'p233-delete-q'; KeysTo 9000 'y' 3 'p233-deleted'; KeysTo 9000 '{ESC}' 1
  Start-Sleep 5
  $new = @(P3RecLines | Select-Object -Skip $before.Count)
  $hc = @(WaitLine $m6 { $_.ev -in 'cancelled', 'deleted' } 120)
  Result 'push233 P6 cancel and delete: heads only' (@($new | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' }).Count -eq 0 -and @($new | Where-Object { $_ -match '^FCR1\|ev=after_(cancel|delete)\|' }).Count -ge 1) ("the add-on wrote: {0}; the stub: {1}" -f (P3Kinds $new), (($hc | ForEach-Object { Ev $_ }) -join ' | '))

  # P7 (item 1): details set after the save. Run 37688178377's keys made nothing (Alt+E is Tally's Export menu; this company
  # has no GST, so its invoices have no e-way bill / e-invoice fields on the form; the bank-date keys opened a ledger's
  # vouchers). By the routes this company has, each change MADE and checked in Tally's stored entry, then judged by what
  # FinCom got (the stub, 120 s):
  #   P7a the IRN and e-way bill written back after the save by a tool (an XML alteration of the saved invoice, as e-invoice
  #       and e-way bill utilities write them back): no form, so no line is expected from the add-on
  #   P7b that invoice saved again on its form: the full line's irn / irnack / irnackdt / ewb against the stored values
  #   P7c the bank date set in Bank Reconciliation (the user's own screen)
  . (Join-Path $PSScriptRoot 'tdslib.ps1')
  $script:TdsSend = { param([string]$k) KeysTo 9000 $k 0 | Out-Null }
  $script:TdsPost = { param([string]$x) Post 9000 $x }
  $script:TdsRestart = { Stop-Process -Id $script:tallyPids[9000] -Force -ErrorAction SilentlyContinue; Start-Sleep 4
    $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tallyPids[9000] = $t.Id
    $null = WaitPort 9000; Start-Sleep 5; KeysTo 9000 'a' 4; KeysTo 9000 't' 10; $null = P3UseCo }
  $script:TdsCo = $co1
  $f7 = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, DATE, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, LEDGERENTRIES.LEDGERNAME'
  $tg = { param($x, $t) [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", "<$t(?:\s[^>]*)?>([^<]*)</$t>").Groups[1].Value).Trim() }
  $nLed = { param($x) [regex]::Matches("$x", '<LEDGERNAME[^>]*>[^<]+</LEDGERNAME>').Count }
  $got = { param($from, $guid, $pat) @((StubLines $from) | Where-Object { $_.guid -eq $guid -and "$($_.xml)" -match $pat }) }
  try {
    # P7a
    $sv0 = P3Coll 'P3Seven' 'Voucher' $f7 '$VoucherNumber = "P233-S50"'
    $g7 = & $tg $sv0 'GUID'; $aid70 = & $tg $sv0 'ALTERID'; $nl0 = & $nLed $sv0
    $irnTags = '<IRN>IRN-P233-0001</IRN><IRNACKNO>ACK-P233-1</IRNACKNO><IRNACKDATE>20261201</IRNACKDATE><EWAYBILLDETAILS.LIST><BILLDATE>20261201</BILLDATE><BILLNUMBER>381101234233</BILLNUMBER><DOCUMENTTYPE>Tax Invoice</DOCUMENTTYPE></EWAYBILLDETAILS.LIST>'
    $b = P3RecLines; $a0 = P3Alt; $m7 = Mark; $how = 'neither form of XML alteration took'; $sv1 = $sv0
    foreach ($hdr in @(('<VOUCHER REMOTEID="' + $g7 + '" VCHTYPE="Sales" ACTION="Alter"'), '<VOUCHER DATE="20261201" TAGNAME="Voucher Number" TAGVALUE="P233-S50" VCHTYPE="Sales" ACTION="Alter"')) {
      $ax = ($P233.tpl.sales50.xml -replace '<VOUCHER VCHTYPE="Sales" ACTION="Create"', $hdr) -replace '<NARRATION>', ($irnTags + '<NARRATION>')
      $null = P3Imp $co1 'Vouchers' @($ax) 'p7a IRN and e-way bill by a tool'
      $sv1 = P3Coll 'P3Seven' 'Voucher' $f7 '$VoucherNumber = "P233-S50"'
      if ((& $tg $sv1 'IRN') -eq 'IRN-P233-0001') { $how = $hdr -replace '^<VOUCHER ', ''; break }
    }
    Set-Content (Join-Path $P233.dir 'p7a-stored.xml') $sv1 -Encoding UTF8
    $made7a = (& $tg $sv1 'IRN') -eq 'IRN-P233-0001' -and (& $tg $sv1 'BILLNUMBER') -eq '381101234233' -and (& $nLed $sv1) -eq $nl0
    Start-Sleep 120
    $a1 = P3Alt; $n = @(P3RecLines | Select-Object -Skip $b.Count); $hit = & $got $m7 $g7 'IRN-P233-0001'
    if (-not $made7a) { Result 'push233 P7a IRN and e-way bill written back after the save by a tool' $false ("not made: {0}; stored IRN '{1}' e-way bill '{2}', ledger names {3} -> {4}" -f $how, (& $tg $sv1 'IRN'), (& $tg $sv1 'BILLNUMBER'), $nl0, (& $nLed $sv1)) $true }
    else { Result 'push233 P7a IRN and e-way bill written back after the save by a tool' ($hit.Count -ge 1) ("made by an XML alteration ({0}): Tally stored IRN '{1}', ack '{2}' {3}, e-way bill '{4}', AlterID {5} -> {6}; the add-on wrote {7}; ALTVCHID {8} -> {9}; FinCom got the IRN for that entry within 120 s: {10}{11}" -f `
        $how, (& $tg $sv1 'IRN'), (& $tg $sv1 'IRNACKNO'), (& $tg $sv1 'IRNACKDATE'), (& $tg $sv1 'BILLNUMBER'), $aid70, (& $tg $sv1 'ALTERID'), (P3What $n), $a0.vch, $a1.vch, $hit.Count, $(if ($hit.Count) { ' (' + (Ev $hit[-1]) + ')' } else { ' (an alteration with no form writes no line; FinCom has it from the Day Book only)' })) }
    # P7b
    if ($made7a) {
      $b = P3RecLines; $m7b = Mark
      $null = TdsGateway 'p7b'
      DayBookAt '1-12-2026' 'p233-p7b-daybook'; $null = TK '{HOME}' 1.5 'p7b-first'; $null = TK '{ENTER}' 3 'p7b-open' 'Alteration'
      for ($i = 1; $i -le 3; $i++) { $null = TK '^a' 3 "p7b-accept$i"; $t = TdsScreen "p7b-after$i"; if ($t -match 'Bill-wise|Type of Ref|Dispatch|Party Details|Receipt Details') { continue }; if ($t -match 'Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }; break }
      $null = TdsGateway 'after p7b'
      Start-Sleep 5
      $n = @(P3RecLines | Select-Object -Skip $b.Count); $fl = @($n | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$(& $tg $sv1 'MASTERID')\|" })
      $lf = { param($k) if ($fl.Count) { [regex]::Match($fl[0], "\|$k=([^|]*)").Groups[1].Value } else { $null } }
      $ackd = & $lf 'irnackdt'; $ackd8 = try { [datetime]::ParseExact($ackd, @('d-MMM-yy', 'd-MMM-yyyy'), [Globalization.CultureInfo]::InvariantCulture, 0).ToString('yyyyMMdd') } catch { $ackd }
      $ok7b = $fl.Count -and (& $lf 'irn') -eq 'IRN-P233-0001' -and (& $lf 'irnack') -eq 'ACK-P233-1' -and $ackd8 -eq '20261201' -and (& $lf 'ewb') -eq '381101234233'
      $hb = & $got $m7b $g7 'IRN-P233-0001'
      Result 'push233 P7b IRN and e-way bill in the full line of the form save' $ok7b ("the add-on wrote {0}; the line: irn '{1}' irnack '{2}' irnackdt '{3}' ewb '{4}'; Tally stored IRN-P233-0001 / ACK-P233-1 / 20261201 / 381101234233; FinCom got it: {5}" -f (P3What $n), (& $lf 'irn'), (& $lf 'irnack'), $ackd, (& $lf 'ewb'), $(if ($hb.Count) { Ev $hb[-1] } else { 'no' }))
    }
    # P7c
    $b = P3RecLines; $a0 = P3Alt; $m7c = Mark
    $bf = 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE'
    $bx0 = P3Coll 'P3Brs' 'Voucher' $bf '$VoucherTypeName = "Receipt"'
    $null = TdsGateway 'p7c'
    $null = TK '%g' 2 'p7c-goto'; $null = TK 'Bank Reconciliation' 1.5 'p7c-typed'; $null = TK '{ENTER}' 3 'p7c-select' 'Bank|Ledger|Select|List'
    $null = TK 'P233 Bank{ENTER}' 3 'p7c-brs' 'Reconcil|Bank Date|Bankers'
    $null = TK '2-11-2026{ENTER}' 2 'p7c-date'
    $null = TK '^a' 3 'p7c-accept'; $t = TdsScreen 'p7c-after'; if ($t -match 'Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3 }
    $null = TdsGateway 'after p7c'
    $bx1 = P3Coll 'P3Brs' 'Voucher' $bf '$VoucherTypeName = "Receipt"'
    Set-Content (Join-Path $P233.dir 'p7c-before.xml') $bx0 -Encoding UTF8; Set-Content (Join-Path $P233.dir 'p7c-after.xml') $bx1 -Encoding UTF8
    $dated = @(foreach ($v in [regex]::Matches("$bx1", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) { if ($v.Value -match '<BANKERSDATE[^>]*>\s*20261102\s*<') { [pscustomobject]@{ guid = (& $tg $v.Value 'GUID'); mid = (& $tg $v.Value 'MASTERID'); aid = (& $tg $v.Value 'ALTERID'); vno = (& $tg $v.Value 'VOUCHERNUMBER') } } })
    $was = @(foreach ($v in [regex]::Matches("$bx0", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) { if ($v.Value -match '<BANKERSDATE[^>]*>\s*20261102\s*<') { & $tg $v.Value 'GUID' } })
    $newDated = @($dated | Where-Object { $_.guid -notin $was })
    Start-Sleep 120
    $a1 = P3Alt; $n = @(P3RecLines | Select-Object -Skip $b.Count)
    $hc = if ($newDated.Count) { & $got $m7c $newDated[0].guid '20261102' } else { @() }
    if (-not $newDated.Count) { Result 'push233 P7c bank date set in Bank Reconciliation' $false 'not made: no receipt has the bank date 2-11-2026 after the keys (see tds-*-p7c-* screenshots)' $true }
    else { Result 'push233 P7c bank date set in Bank Reconciliation' ($hc.Count -ge 1) ("made: receipt {0} (mid {1}, AlterID now {2}) has bank date 20261102; the add-on wrote {3}; ALTVCHID {4} -> {5}; FinCom got the bank date for that entry within 120 s: {6}" -f $newDated[0].vno, $newDated[0].mid, $newDated[0].aid, (P3What $n), $a0.vch, $a1.vch, $(if ($hc.Count) { Ev $hc[-1] } else { 'no (Bank Reconciliation is not a voucher form: no line; FinCom has it from the Day Book only)' })) }
  } catch { Result 'push233 P7' $false "the harness stopped in P7: $_" $true }

  # P8 (item 2): entries with no save screen
  $cases = @(
    @{ n = 'a plain XML import'; f = { $null = P3Imp $co1 'Vouchers' @((S2Receipt '20261231' 'P233-X1' 'P233 Party' 10 'push233 plain import')) 'p8 import' } },
    @{ n = "an XML import tagged as FinCom's posting (TDSDesk:p233x2)"; f = { $null = P3Imp $co1 'Vouchers' @((S2Receipt '20261231' 'P233-X2' 'P233 Party' 20 'push233 posting | TDSDesk:p233x2')) 'p8 posting' } },
    @{ n = 'a ledger renamed on its form (it is on saved entries)'; f = { KeysTo 9000 '%g' 2; KeysTo 9000 'Alter Ledger' 1; KeysTo 9000 '{ENTER}' 3; KeysTo 9000 'P233 Party{ENTER}' 3 'p233-p8-ledger'; KeysTo 9000 '^a' 1; KeysTo 9000 '{HOME}' 1; KeysTo 9000 '+{END}' 1; KeysTo 9000 'P233 Party Renamed{ENTER}' 2; KeysTo 9000 '^a' 3 'p233-p8-renamed'; KeysTo 9000 '{ESC}' 1 } },
    @{ n = 'multi-alter (Ctrl+H on the Day Book, where this release offers it)'; f = { DayBookAt $P233.tpl.sales50.dmy 'p233-p8-multi-daybook'; KeysTo 9000 '^h' 3 'p233-p8-ctrlh'; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 '^a' 3 'p233-p8-multi-saved'; KeysTo 9000 '{ESC}' 1 } })
  foreach ($c in $cases) {
    $b = P3RecLines; $a0 = P3Alt; & $c.f; Start-Sleep 4; $a1 = P3Alt; $n = @(P3RecLines | Select-Object -Skip $b.Count)
    Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 P8 {0}: the add-on wrote {1}; ALTVCHID {2} -> {3}; ALTMSTID {4} -> {5}" -f $c.n, (P3What $n), $a0.vch, $a1.vch, $a0.mst, $a1.mst)
  }

  # P9 (item 3): automatic numbering, on receipts typed on the screen (run 37688178377: the copy picked the receipt P6 had
  # cancelled, and the insert's keys typed into the wrong fields). P9a a new receipt: its number in its line against
  # Tally's. P9b a receipt inserted before the first receipt of 2-11-2026 (Day Book, Alt+I): Tally renumbers the receipts
  # after it without a form; each renumbered entry's number in FinCom (the stub's last line for it, 120 s) against Tally's
  try {
    if (-not $script:TdsSend) { . (Join-Path $PSScriptRoot 'tdslib.ps1') }
    $rx = { P3Coll 'P3Rcpt' 'Voucher' 'GUID, MASTERID, ALTERID, VOUCHERNUMBER, DATE' '$VoucherTypeName = "Receipt"' }
    $rv = { param($x) @(foreach ($v in [regex]::Matches("$x", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) { [pscustomobject]@{ guid = (& $tg $v.Value 'GUID'); mid = [int64]('0' + (& $tg $v.Value 'MASTERID')); vno = (& $tg $v.Value 'VOUCHERNUMBER'); date = (& $tg $v.Value 'DATE') } }) }
    $typeReceipt = { param($tag, $amount)
      if (-not (TK 'v' 2.5 "$tag-vouchers" 'Voucher')) { return }
      $null = TK '{F6}' 2.5 "$tag-receipt" 'Receipt'
      $null = TK '{F2}' 1.5 "$tag-date-box" 'Date'; $null = TK '2-11-2026{ENTER}' 2 "$tag-date"
      $null = TK 'Cash{ENTER}' 2 "$tag-account"; $null = TK 'Spike Income{ENTER}' 2 "$tag-ledger"; $null = TK "$amount{ENTER}" 2 "$tag-amount"
      $null = TK '{ENTER}' 2 "$tag-rows-done"; $null = TK "push233 $tag{ENTER}" 2 "$tag-narr"
      for ($i = 1; $i -le 3; $i++) { $null = TK '^a' 3 "$tag-accept$i"; $t = TdsScreen "$tag-after$i"; if ($t -match 'Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }; if ($t -match 'Cost Centre|Bill-wise') { continue }; break }
    }
    # P9a
    $null = TdsGateway 'p9a'; $r0 = & $rv (& $rx); $b = P3RecLines
    & $typeReceipt 'p9a' 50
    $null = TdsGateway 'after p9a'; Start-Sleep 3
    $r1 = & $rv (& $rx); $nv = @($r1 | Where-Object { $_.mid -gt (@($r0 | ForEach-Object mid) + 0 | Measure-Object -Maximum).Maximum } | Sort-Object mid -Descending)[0]
    $n = @(P3RecLines | Select-Object -Skip $b.Count); $fl = if ($nv) { @($n | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' -and $_ -match "\|mid=$($nv.mid)\|" }) } else { @() }
    $lv = if ($fl.Count) { [regex]::Match($fl[0], '\|part=1\|.*?\|vno=([^|]*)\|').Groups[1].Value } else { '' }
    if (-not $nv) { Result 'push233 P9a a new receipt''s number in its line' $false 'not made by the keys (see tds-*-p9a-* screenshots)' $true }
    else { Result 'push233 P9a a new receipt''s number in its line' ($lv -eq $nv.vno) ("Tally made receipt {0} (mid {1}); the line's number '{2}'; the add-on wrote {3}" -f $nv.vno, $nv.mid, $lv, (P3What $n)) }
    # P9b
    $r0 = & $rv (& $rx); $b = P3RecLines; $m9 = Mark; $a0 = P3Alt
    $null = TdsGateway 'p9b'
    DayBookAt '2-11-2026' 'p233-p9b-daybook'; $null = TK '{F4}' 2 'p9b-type'; $null = TK 'Receipt{ENTER}' 3 'p9b-receipts'; $null = TK '{HOME}' 1.5 'p9b-first'
    $null = TK '%i' 3 'p9b-insert' 'Receipt|Creation|Insert'
    $null = TK 'Cash{ENTER}' 2 'p9b-account'; $null = TK 'Spike Income{ENTER}' 2 'p9b-ledger'; $null = TK '60{ENTER}' 2 'p9b-amount'
    $null = TK '{ENTER}' 2 'p9b-rows-done'; $null = TK 'push233 p9b insert{ENTER}' 2 'p9b-narr'
    for ($i = 1; $i -le 3; $i++) { $null = TK '^a' 3 "p9b-accept$i"; $t = TdsScreen "p9b-after$i"; if ($t -match 'Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }; break }
    $null = TdsGateway 'after p9b'
    $r1 = & $rv (& $rx)
    $ins = @($r1 | Where-Object { $_.mid -gt (@($r0 | ForEach-Object mid) + 0 | Measure-Object -Maximum).Maximum })[0]
    $ren = @($r1 | Where-Object { $o = $_; $p = @($r0 | Where-Object mid -eq $o.mid)[0]; $p -and $p.vno -ne $o.vno })
    Start-Sleep 120
    $a1 = P3Alt; $n = @(P3RecLines | Select-Object -Skip $b.Count)
    $sl = StubLines 0
    $fin = @(foreach ($e in $ren) { $last = @($sl | Where-Object { $_.guid -eq $e.guid -and $_.xml } | Select-Object -Last 1)[0]; $fv = if ($last) { [regex]::Match("$($last.xml)", '<VOUCHERNUMBER[^>]*>([^<]*)<').Groups[1].Value } else { '(none)' }
      [pscustomobject]@{ mid = $e.mid; was = @($r0 | Where-Object mid -eq $e.mid)[0].vno; now = $e.vno; fincom = $fv } })
    if (-not $ins) { Result 'push233 P9b back-dated insert: the renumbered entries in FinCom' $false 'not made: no receipt inserted (see tds-*-p9b-* screenshots)' $true }
    elseif (-not $ren.Count) { Result 'push233 P9b back-dated insert: the renumbered entries in FinCom' $false ("receipt {0} (mid {1}) inserted; Tally renumbered none (this release's numbering kept the others' numbers); the add-on wrote {2}" -f $ins.vno, $ins.mid, (P3What $n)) $true }
    else { Result 'push233 P9b back-dated insert: the renumbered entries in FinCom' (@($fin | Where-Object { $_.fincom -ne $_.now }).Count -eq 0) ("receipt {0} (mid {1}) inserted; Tally renumbered {2}; the add-on wrote {3}; ALTVCHID {4} -> {5}; each renumbered entry: {6}" -f $ins.vno, $ins.mid, $ren.Count, (P3What $n), $a0.vch, $a1.vch, (($fin | ForEach-Object { "mid $($_.mid) $($_.was) -> $($_.now), FinCom '$($_.fincom)'" }) -join '; ')) }
  } catch { Result 'push233 P9' $false "the harness stopped in P9: $_" $true }

  # P10 (item 5): two Windows users saving at the same moment (user 2's Tally saves a ledger: the per-user file is the point)
  if ($tally2) {
    $b1 = P3RecLines
    Keys2 'c' 3 ''; Keys2 'Ledger{ENTER}' 3; Keys2 'P233 Both U2{ENTER}' 2; Keys2 '{ENTER}' 2; Keys2 'Sundry Debtors{ENTER}' 2
    DayBookAt $P233.tpl.receipt.dmy ''; KeysTo 9000 '{END}' 1; KeysTo 9000 '%2' 3
    KeysTo 9000 '^a' 0; Keys2 '^a' 0; Start-Sleep 5
    $f2 = @(Get-ChildItem $rec -File | Where-Object { $_.Name -match "-$u2\.txt$" })
    $l2 = @($f2 | ForEach-Object { Get-Content $_.FullName -Encoding Unicode } | Where-Object { $_ -like 'FCR1|*' })
    $l1 = @(P3RecLines | Select-Object -Skip $b1.Count)
    $mixed = @($l1 | Where-Object { $_ -notmatch '\|w=[^|]*runneradmin\|' }).Count + @($l2 | Where-Object { $_ -notmatch "\|w=[^|]*$u2\|" }).Count
    Result 'push233 P10 two Windows users at the same moment' (@($l1 | Where-Object { $_ -like 'FCR1|ev=voucher_full|*' }).Count -ge 1 -and @($l2 | Where-Object { $_ -match 'P233 Both U2' }).Count -ge 1 -and $mixed -eq 0) ("user 1 wrote {0}; user 2's file has {1} line(s) naming P233 Both U2; lines in the wrong user's file: {2}" -f (P3Kinds $l1), @($l2 | Where-Object { $_ -match 'P233 Both U2' }).Count, $mixed)
  } else { Add-Content -Path $resultsFile -Encoding UTF8 -Value 'INFO push233 P10 two users: user 2''s Tally is not running in this run' }
  # the large company: a save there, its time and freeze (first screen change later than 1 s after Ctrl+A: a freeze)
  if ($Slow232St.made -gt 0) {
    $P233.tpl.big = @{ date = '20260401'; dmy = '1-4-2026'; xml = '' }
    KeysTo 9000 '{F3}' 3; KeysTo 9000 $P233.bigCo 2; KeysTo 9000 '{ENTER}' 6 'p233-big-selected'
    $r = P3Save 'big' -co $P233.bigCo -noList
    Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 P10 a save on the large company ({0} entries): Ctrl+A to the full line {1} ms; the add-on wrote {2}; the bridge's entry requests for it at the stand: {3}" -f $Slow232St.made, $r.ms_fullline, $r.what, @(P3EntryAsks | Where-Object company -eq $P233.bigCo).Count)
    # item 5 (the owner, 08-Oct-2026): the add-on's own share of a save on the large company, by the same method (Ctrl+A to
    # a new line in a file): 5 saves with the add-on (Ctrl+A to its full line), then Tally started again with a stamp-only
    # TDL (one line written right after Tally's own Form Accept, nothing else: MEASUREMENT ONLY, never shipped) and 5 saves
    # (Ctrl+A to the stamp line). The add-on's share is the difference of the medians
    try {
      $tAdd = @(); for ($i = 1; $i -le 4; $i++) { $tAdd += P3TimeBig "addon$i" '' }
      $tAdd = @($r.ms_fullline) + $tAdd
      $stampFile = 'C:\fcspike\p233-stamp.txt'; Remove-Item $stampFile -Force -ErrorAction SilentlyContinue
      $stampTdl = 'C:\fcspike\P233Stamp.tdl'
      Set-Content $stampTdl -Encoding ASCII -Value @(
        ';; P233Stamp.tdl - MEASUREMENT ONLY (tally-real push233, item 5): one line right after Tally''s own Form Accept',
        '[#Form: Voucher]', '    On : Form Accept : Yes : Form Accept', '    On : Form Accept : Yes : Call : P233Stamp', '',
        '[Function: P233Stamp]', '    01 : OPEN FILE : "C:\fcspike\p233-stamp.txt" : Text : Write : Unicode', '    02 : IF : NOT $$LastResult',
        '    03 :    RETURN', '    04 : END IF', '    05 : WRITE FILE LINE : "d"', '    06 : CLOSE TARGET FILE')
      $folders = @(Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object { "Load = $($_.Name)" })
      $null = S2StartTally (S2Ini $stampTdl $folders)
      KeysTo 9000 '{F3}' 3; KeysTo 9000 $P233.bigCo 2; KeysTo 9000 '{ENTER}' 6 'p233-t-stamp-big'
      $tStamp = @(); for ($i = 1; $i -le 5; $i++) { $tStamp += P3TimeBig "stamp$i" $stampFile }
      $med = { param($a) $s = @($a | Where-Object { $_ -ge 0 } | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { -1 } }
      $mA = & $med $tAdd; $mS = & $med $tStamp
      Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 item 5 the large company ({0} entries), Ctrl+A to a new line in a file: with the add-on (its full line) {1} ms, median {2}; without it (a stamp-only TDL right after Tally's own Form Accept) {3} ms, median {4}; the add-on's own share: {5} ms" -f `
          $Slow232St.made, ($tAdd -join ', '), $mA, ($tStamp -join ', '), $mS, $(if ($mA -ge 0 -and $mS -ge 0) { $mA - $mS } else { '-' }))
      # Tally back with the add-on, the small company current
      $null = S2StartTally (S2Ini $tdl $folders); $null = P3UseCo
    } catch { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO push233 item 5 timing: the harness stopped: $_" }
    KeysTo 9000 '{F3}' 3; KeysTo 9000 $co1 2; KeysTo 9000 '{ENTER}' 6
  }
  # a company on a network share: Tally 9000 started on \\localhost\p233share holding a copy of the small company's folder
  try {
    $sh = Join-Path $env:RUNNER_TEMP 'p233share'; New-Item -ItemType Directory -Force $sh | Out-Null
    & net.exe share "p233share=$sh" '/GRANT:Everyone,FULL' 2>&1 | ForEach-Object { Write-Host "  net share: $_" }
    $c1 = @(Get-ChildItem $data1 -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1)[0].Name
    & robocopy.exe (Join-Path $data1 $c1) (Join-Path $sh $c1) /E /R:0 /W:0 /NFL /NDL /NJH /NP | Out-Null
    $null = S2StartTally ((S2Ini $tdl @("Load = $c1")) -replace [regex]::Escape("Data = $data1"), "Data = $($P233.share)")
    $r = P3Save 'receipt'
    Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 P10 a company on a network share ({0}): Ctrl+A to the full line {1} ms; the add-on wrote {2}" -f $P233.share, $r.ms_fullline, $r.what)
  } catch { Add-Content -Path $resultsFile -Encoding UTF8 -Value "INFO push233 P10 network share: the harness stopped: $_" }
  # the saves' times together
  $ms = @($P233.saves | Where-Object { $_.ms_fullline -ge 0 } | ForEach-Object ms_fullline | Sort-Object)
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE push233 saves: {0} timed; Ctrl+A to the full line median {1} ms, worst {2} ms (Tally's own save included: the add-on's own part was measured by the push-design run, 49-57 ms median on 50 items)" -f $ms.Count, $(if ($ms.Count) { $ms[[int]($ms.Count / 2)] } else { '-' }), $(if ($ms.Count) { $ms[-1] } else { '-' }))
  $P233.saves | Select-Object kind, alter, ms_sendwait, ms_fullline, what, alt0, alt1 | Export-Csv (Join-Path $P233.dir 'saves.csv') -NoTypeInformation -Encoding UTF8
  Snap 'push233'
}
