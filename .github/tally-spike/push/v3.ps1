# v3.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE=v3 (the owner's
# ask of 07-Oct-2026, on the 30,004-voucher company):
#   V3TdsMasters  light setup: the company's TDS details, the nature of payment, the deductee party, the expense and the
#                 TDS ledger (the S5 masters of tally-real-spike scen231.ps1, masters-0/3/5), by XML; the nature on its
#                 form by keys when the import made none
#   V3Pre         heavy company, no TDL, no bridge: the GUID rule over every voucher; a voucher imported with a foreign
#                 GUID (a sync); one entry asked of Tally in each keyed form (f.csv) with the freeze probe
#   V3Main        heavy company saves (a.csv; ui_first_ms is the freeze detector of run 37464758500): no add-on, stamps,
#                 heads-only with the bridge stopped / running, full entry with no read-back, full entry with the
#                 read-back with the bridge stopped / running; the save timed from outside by the company's AltVchID
#                 (p.csv); then the TDS entry typed on the light company with the full-entry add-on (captures\tds-*)
$v3f = Join-Path $out 'f.csv'; $v3p = Join-Path $out 'p.csv'
function SK([string]$s) { ($s.ToCharArray() | ForEach-Object { if ('+^%~(){}[]'.Contains($_)) { '{' + $_ + '}' } else { "$_" } }) -join '' }
$script:tdsN = [ordered]@{ nature = 'PD Contract Work'; party = 'PD TDS Contractor'; exp = 'PD Contract Exp'; tds = 'PD TDS Payable' }

function V3TdsMasters {
  $N = $script:tdsN
  $c = '<COMPANY NAME="' + $co + '" ACTION="Alter"><NAME>' + $co + '</NAME><ISTDSON>Yes</ISTDSON><TANUMBER>DELF01234E</TANUMBER><TANREGNO>DELF01234E</TANREGNO><TDSDEDUCTORTYPE>Company</TDSDEDUCTORTYPE></COMPANY>'
  Imp 'All Masters' @($c) 'tds: company TDS on, TAN' | Out-Null
  $nat = '<TAXCLASSIFICATION NAME="' + $N.nature + '" ACTION="Create"><NAME.LIST><NAME>' + $N.nature + '</NAME></NAME.LIST><TAXTYPE>TDS</TAXTYPE><SECTIONNUMBER>194C</SECTIONNUMBER><PAYMENTCODE>94C</PAYMENTCODE><TDSRATEDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><DEDUCTEETYPE>Company - Resident</DEDUCTEETYPE><TDSRATE>2</TDSRATE><SURCHARGERATE>0</SURCHARGERATE><EDUCESSRATE>0</EDUCESSRATE></TDSRATEDETAILS.LIST></TAXCLASSIFICATION>'
  Imp 'All Masters' @($nat) 'tds: nature of payment (TAXCLASSIFICATION)' | Out-Null
  $tr = Post (Coll 'FCPTdsRate' 'TDSRate' 'NAME' '' '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 60
  if ($tr -notmatch [regex]::Escape($N.nature)) {
    # the nature on its form (tdslib.ps1 TdsNatureScreen, keys without the OCR): Create > TDS Nature of Payments
    Say 'tds: the import made no TDS Rate: the nature typed on its form'
    KeysTo '{ESC}' 1; KeysTo 'c' 3 'tds-nat-0'; KeysTo 'TDS Nature of Payments' 2; KeysTo '{ENTER}' 3 'tds-nat-1'
    foreach ($k in ((SK $N.nature) + '{ENTER}'), '194C{ENTER}', '94C{ENTER}', '{ENTER}', '1{ENTER}', '2{ENTER}', '{ENTER}', '{ENTER}') { KeysTo $k 1.5 }
    Shot 'tds-nat-2'; KeysTo '^a' 3 'tds-nat-3'; KeysTo '{ESC}' 2; KeysTo '{ESC}' 2
    $tr = Post (Coll 'FCPTdsRate' 'TDSRate' 'NAME' '' '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 60
  }
  Set-Content (Join-Path $cap 'tds-nature-tdsrate.xml') $tr -Encoding UTF8
  Say "tds: nature '$($N.nature)' as a TDS Rate in Tally: $($tr -match [regex]::Escape($N.nature))"
  $led = @(
    ('<LEDGER NAME="' + $N.party + '" ACTION="Create"><NAME.LIST><NAME>' + $N.party + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><ISBILLWISEON>No</ISBILLWISEON><INCOMETAXNUMBER>AAACP2310K</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><DEDUCTINSAMEVCHRULES.LIST><DATE>20260401</DATE><DEDUCTINSAMEVCH>Yes</DEDUCTINSAMEVCH></DEDUCTINSAMEVCHRULES.LIST></LEDGER>'),
    ('<LEDGER NAME="' + $N.exp + '" ACTION="Create"><NAME.LIST><NAME>' + $N.exp + '</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><ISTDSEXPENSE>Yes</ISTDSEXPENSE><TDSAPPLICABLE>' + $N.nature + '</TDSAPPLICABLE><TDSCATEGORYNAME>' + $N.nature + '</TDSCATEGORYNAME><TDSRATENAME>' + $N.nature + '</TDSRATENAME></LEDGER>'),
    ('<LEDGER NAME="' + $N.tds + '" ACTION="Create"><NAME.LIST><NAME>' + $N.tds + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>TDS</TAXTYPE><TDSRATENAME>' + $N.nature + '</TDSRATENAME><TDSCATEGORYNAME>' + $N.nature + '</TDSCATEGORYNAME><TAXCLASSIFICATIONNAME>' + $N.nature + '</TAXCLASSIFICATIONNAME></LEDGER>'))
  $r = Imp 'All Masters' $led 'tds: party, expense, TDS ledger'
  if ($r.created -lt 3) { Imp 'All Masters' ($led | ForEach-Object { $_ -replace 'ACTION="Create"', 'ACTION="Alter"' }) 'tds: ledgers again (alter)' | Out-Null }
  Post (Coll 'FCPTdsLed' 'Ledger' 'NAME' '$Name CONTAINS "PD TDS" OR $Name = "PD Contract Exp"' '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 60 | Set-Content (Join-Path $cap 'tds-ledgers.xml') -Encoding UTF8
}

# ---------------------------------------------------------------- the requests for one entry
function Statics($date) { '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY>' + $(if ($date) { "<SVFROMDATE>$date</SVFROMDATE><SVTODATE>$date</SVTODATE>" }) }
function CollReq($id, $type, $date, $filter, $childOf = '', $fetch = $fetch231) {
  $flt = if ($filter) { "<FILTERS>${id}Only</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"${id}Only`">$([Security.SecurityElement]::Escape($filter))</SYSTEM>" } else { '</COLLECTION>' }
  $ch = if ($childOf) { '<CHILDOF>' + [Security.SecurityElement]::Escape($childOf) + '</CHILDOF>' } else { '' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES>' + (Statics $date) + '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE>' + $ch + '<FETCH>' + $fetch + '</FETCH>' + $flt + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
function ObjReq($idType, $idVal, $star = $false) {
  $fl = if ($star) { '<FETCH>*</FETCH><FETCH>ALLLEDGERENTRIES.*</FETCH><FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*</FETCH><FETCH>ALLINVENTORYENTRIES.*</FETCH>' } else { ($fetch231 -split ',\s*' | ForEach-Object { "<FETCH>$_</FETCH>" }) -join '' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="' + $idType + '">' + [Security.SecurityElement]::Escape($idVal) + '</ID></HEADER><BODY><DESC><STATICVARIABLES>' + (Statics '') + '</STATICVARIABLES><FETCHLIST>' + $fl + '</FETCHLIST></DESC></BODY></ENVELOPE>'
}
function DayBookReq($date) { '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES>' + (Statics $date) + "<SVCURRENTDATE>$date</SVCURRENTDATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>" }
function FetchForms($t) {
  $o = [ordered]@{}
  $o['bymaster-bridge'] = CollReq 'FinComVoucherByMaster' 'Voucher' $t.date "`$MasterID = $($t.mid)"
  $o['bynumber-bridge'] = CollReq 'FinComVoucherByNumber' 'Voucher' $t.date "`$VoucherNumber = `"$($t.vno)`" AND `$VoucherTypeName = `"$($t.type)`""
  # MasterID only: if the period does not bound a voucher collection this answers every voucher in the company
  $o['day-collection-nofilter-midonly'] = CollReq 'FCPDayAll' 'Voucher' $t.date '' '' 'MASTERID'
  $o['obj-name-guid'] = ObjReq 'Name' $t.guid
  $o['obj-name-guid-star'] = ObjReq 'Name' $t.guid $true
  $o['obj-masterid'] = ObjReq 'MasterID' "$($t.mid)"
  $o['obj-name-id:mid'] = ObjReq 'Name' "ID:$($t.mid)"
  $o['obj-guid-type'] = ObjReq 'GUID' $t.guid
  if ($t.party) { $o['ledger-vouchers-childof-party'] = CollReq 'FCPLedVch' 'Vouchers : Ledger' $t.date "`$MasterID = $($t.mid)" $t.party }
  $o['vtype-vouchers-childof-type'] = CollReq 'FCPTypVch' 'Vouchers : VoucherType' $t.date "`$MasterID = $($t.mid)" $t.type
  $o['daybook-export-data'] = DayBookReq $t.date
  return $o
}
function Flags($x, $mid) {
  $vs = [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')
  $mine = @($vs | Where-Object { $_.Value -match "<MASTERID[^>]*>\s*$mid\s*<" })
  $v = if ($mine.Count) { $mine[0].Value } else { '' }
  [pscustomobject]@{ bytes = $x.Length; vouchers = $vs.Count; has_entry = [bool]$v
    ledger_lines = ([regex]::Matches($v, '<LEDGERNAME[^>]*>[^<]+<')).Count; items = ([regex]::Matches($v, '<STOCKITEMNAME[^>]*>[^<]+<')).Count
    taxobj_filled = ([regex]::Matches($v, '<TAXOBJECTALLOCATIONS\.LIST>\s*<[A-Z]')).Count
    err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|Unknown Request[^<]*|Could not[^<]*').Value }
}
# one request, Tally's screen probed while it runs: a key (Down / Up on the Gateway menu) sent 120 ms after the request
# left, the time until the screen changed (the freeze probe); the request itself in a thread job, timed inside it
$script:probeKey = 0x28
function FetchProbe($body, $file) {
  $j = Start-ThreadJob -ScriptBlock {
    param($b, $f)
    $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $sw = [Diagnostics.Stopwatch]::StartNew()
    try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($b)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 300).Content } catch { $c = "FAILED $($_.Exception.Message)" }
    $ms = $sw.Elapsed.TotalMilliseconds; [IO.File]::WriteAllText($f, $c); return @($t0, $ms)
  } -ArgumentList $body, $file
  Start-Sleep -Milliseconds 120
  $k0 = NowMs; $lat = [PdUi]::KeyLatency($script:probeKey, $false, 30000); $script:probeKey = if ($script:probeKey -eq 0x28) { 0x26 } else { 0x28 }
  $r = Receive-Job $j -Wait -AutoRemoveJob
  $t0 = [long]$r[0]; $ms = [double]$r[1]
  return [pscustomobject]@{ ms = [math]::Round($ms, 1); probe_ms = [math]::Round($lat, 1); overlap = ($k0 -ge $t0 -and $k0 -le $t0 + $ms) }
}
function FetchStage($tag, $targets) {
  if (-not (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)) { Say 'HARNESS: Start-ThreadJob missing: no fetch stage'; return }
  Focus | Out-Null; Shot "$tag-fetch-gateway"
  $idle = @(1..5 | ForEach-Object { $x = [PdUi]::KeyLatency($script:probeKey, $false, 5000); $script:probeKey = if ($script:probeKey -eq 0x28) { 0x26 } else { 0x28 }; Start-Sleep -Milliseconds 300; [math]::Round($x, 1) })
  Say "fetch ${tag}: the probe key on an idle Tally: $($idle -join ', ') ms"
  foreach ($t in $targets) {
    $forms = FetchForms $t
    foreach ($m in $forms.Keys) {
      for ($i = 1; $i -le 5; $i++) {
        Focus | Out-Null
        $file = Join-Path $cap "fetch-$tag-$($t.name)-$m.xml"
        $p = FetchProbe $forms[$m] $file
        $x = [IO.File]::ReadAllText($file); $fl = Flags $x $t.mid
        $row = [pscustomobject]@{ rel = $rel; company = $tag; target = $t.name; mid = $t.mid; form = $m; rep = $i; ms = $p.ms; probe_ms = $p.probe_ms; probe_during = $p.overlap
          bytes = $fl.bytes; vouchers = $fl.vouchers; has_entry = $fl.has_entry; ledger_lines = $fl.ledger_lines; items = $fl.items; taxobj_filled = $fl.taxobj_filled; err = $fl.err }
        $row | Export-Csv $v3f -Append -NoTypeInformation -Encoding UTF8
        if ($i -eq 1) { Say ("fetch {0} {1} {2}: {3} ms, probe {4} ms (during {5}); {6} B, {7} vouchers, entry {8}, ledger lines {9}, items {10}, TDS allocations {11} {12}" -f $tag, $t.name, $m, $p.ms, $p.probe_ms, $p.overlap, $fl.bytes, $fl.vouchers, $fl.has_entry, $fl.ledger_lines, $fl.items, $fl.taxobj_filled, $fl.err) }
        Start-Sleep -Milliseconds 300
      }
    }
  }
}
function Target($name, $filter) {
  $x = Post (Coll 'FCPTgt' 'Voucher' 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME' $filter) '' 300
  $m = [regex]::Match($x, '(?s)<VOUCHER[ >].*?</VOUCHER>').Value
  $g = { param($t) [regex]::Match($m, "<$t[^>]*>([^<]*)<").Groups[1].Value.Trim() }
  $t = [pscustomobject]@{ name = $name; guid = (& $g 'GUID'); mid = (& $g 'MASTERID'); aid = (& $g 'ALTERID'); date = (& $g 'DATE'); type = (& $g 'VOUCHERTYPENAME'); vno = (& $g 'VOUCHERNUMBER'); party = (& $g 'PARTYLEDGERNAME') }
  Say "fetch target ${name}: mid $($t.mid) guid $($t.guid) date $($t.date) $($t.type) $($t.vno) party '$($t.party)'"
  return $t
}
# the GUID rule: GUID = company GUID + "-" + MasterID as 8 hex digits, over every voucher Tally holds
function GuidRule($tag) {
  $x = Post (Coll 'FCPGuids' 'Voucher' 'GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER') '' 900
  $n = 0; $ok = 0; $bad = @()
  foreach ($m in [regex]::Matches($x, '(?s)<GUID[^>]*>([^<]*)</GUID>.*?<MASTERID[^>]*>\s*(\d+)\s*<.*?<VOUCHERNUMBER[^>]*>([^<]*)<')) {
    $n++; $want = "$cguid-" + ([int64]$m.Groups[2].Value).ToString('x8')
    if ($m.Groups[1].Value.Trim() -ieq $want) { $ok++ } elseif ($bad.Count -lt 20) { $bad += "mid $($m.Groups[2].Value) vno $($m.Groups[3].Value): $($m.Groups[1].Value.Trim()) (rule: $want)" }
  }
  Say "GUID rule ($tag): $ok of $n vouchers have GUID = company GUID + '-' + 8-hex MasterID; exceptions: $($bad -join '; ')"
  Add-Content (Join-Path $out 'guid-rule.txt') "$tag`t$ok`t$n`t$($bad -join ' ; ')" -Encoding UTF8
}

function V3Pre {
  if (-not $heavyOk) { Say 'v3: no heavy company: no fetch stage'; return }
  if (-not (Start-T $heavy @() 'v3-heavy-fetch')) { Say 'HARNESS: v3 heavy did not open'; return }
  GuidRule 'heavy after import'
  Post (Coll 'FCPCoNat' 'Company' 'NAME' '' '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 60 | Set-Content (Join-Path $cap 'company-natives-heavy.xml') -Encoding UTF8
  $ax = Post (AltReq); Say "company ALTVCHID / ALTMSTID by XML: $([regex]::Match($ax, '<ALTVCHID[^>]*>[^<]*').Value) / $([regex]::Match($ax, '<ALTMSTID[^>]*>[^<]*').Value)"
  # a sync: a voucher imported carrying another company's GUID (and REMOTEID)
  $fg = '7a1e0c55-1111-4222-8333-944455556666-0000abcd'
  $sx = '<VOUCHER REMOTEID="' + $fg + '" VCHTYPE="Journal" ACTION="Create"><GUID>' + $fg + '</GUID><DATE>20261101</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>SYNC-1</VOUCHERNUMBER><NARRATION>a voucher from another company (sync)</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  Imp 'Vouchers' @($sx) 'sync-like voucher with a foreign GUID' | Out-Null
  $sv = Post (Coll 'FCPSync' 'Voucher' 'GUID, MASTERID, ALTERID, REMOTEID' '$VoucherNumber = "SYNC-1"') '' 300
  Set-Content (Join-Path $cap 'sync-voucher.xml') $sv -Encoding UTF8
  $sg = [regex]::Match($sv, '<GUID[^>]*>([^<]*)<').Groups[1].Value; $sm = [regex]::Match($sv, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
  Say "sync-like import: Tally's GUID '$sg', MasterID $sm; rule gives '$cguid-$(if ($sm) { ([int64]$sm).ToString('x8') })'"
  $targets = @((Target 'sales50-template' '$VoucherNumber = "TS50-1"'), (Target 'heavy-sales-15000' '$VoucherNumber = "HS-015000"'))
  FetchStage 'heavy' $targets
  Stop-T
}

# the save timed from outside: Ctrl+A sent, then the company's AltVchID asked until it moves (no TDL needed)
function AltReq { Coll 'FCPAlt' 'Company' 'NAME, ALTVCHID, ALTMSTID' }
function PollSaves($cfg, $n) {
  $req = AltReq
  for ($r = 1; $r -le $n; $r++) {
    DayBook '31-10-2026' $(if ($r -eq 1) { "heavy-$cfg-poll-daybook" }); KeysTo '{END}' 1; KeysTo '%2' 4
    Get-ChildItem $pd -Filter 'stamp-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    $base = Post $req; $a0 = [regex]::Match($base, '<ALTVCHID[^>]*>\s*(\d+)').Groups[1].Value
    if (-not $a0) { Say "   poll ${cfg}: Tally's company answer has no ALTVCHID value: the outside timer cannot run ($($base -replace '\s+', ' '))"; KeysTo '{ESC}' 1; KeysTo 'y' 1; return }
    if (-not (Focus)) { continue }
    $sw = [Diagnostics.Stopwatch]::StartNew(); [PdUi]::SendCtrl(0x41); $prevEnd = 0.0; $det = -1.0; $polls = 0; $a1 = ''
    while ($sw.Elapsed.TotalSeconds -lt 60) {
      $polls++
      try { $c = (Invoke-WebRequest 'http://127.0.0.1:9000' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($req)) -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec 60).Content } catch { $c = '' }
      $t = $sw.Elapsed.TotalMilliseconds; $a1 = [regex]::Match($c, '<ALTVCHID[^>]*>\s*(\d+)').Groups[1].Value
      if ($a1 -and $a1 -ne $a0) { $det = $t; break }
      $prevEnd = $t; Start-Sleep -Milliseconds 5
    }
    Start-Sleep 2
    if ($script:lastStamp) { $sw2 = [Diagnostics.Stopwatch]::StartNew(); while (-not (Test-Path "$pd\stamp-$($script:lastStamp).txt") -and $sw2.Elapsed.TotalSeconds -lt 60) { Start-Sleep -Milliseconds 250 } }
    $h = Stamps
    $row = [pscustomobject]@{ rel = $rel; cfg = $cfg; rep = $r; detect_ms = [math]::Round($det, 1); last_unchanged_ms = [math]::Round($prevEnd, 1); polls = $polls; altvchid_before = $a0; altvchid_after = $a1
      stamp_total_ms = $(if ($h.ContainsKey('e')) { D $h 'a' 'e' } else { D $h 'a' 'd' }); stamp_save_ms = (D $h 'b' 'c') }
    $row | Export-Csv $v3p -Append -NoTypeInformation -Encoding UTF8
    Say ("   poll {0} #{1}: AltVchID {2} -> {3} seen at {4} ms (last unchanged answer {5} ms, {6} asks); stamps a..last {7} ms" -f $cfg, $r, $a0, $a1, $row.detect_ms, $row.last_unchanged_ms, $polls, $row.stamp_total_ms)
  }
}

$script:bpath = $null
function BridgeStop { $p = Get-Process FinComBridge -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { $script:bpath = $p.Path; $p | Stop-Process -Force; Start-Sleep 2 }; Say "bridge stopped ($script:bpath)" }
function BridgeStart {
  if (-not (Get-Process FinComBridge -ErrorAction SilentlyContinue) -and $script:bpath) { Start-Process -FilePath $script:bpath | Out-Null }
  $st = $null; for ($i = 0; $i -lt 20 -and -not $st; $i++) { Start-Sleep 3; $st = Bridge GET '/status' }
  Say "bridge running: version $($st.version)"
}
function SaveSet($cfg, $large) {
  SaveBlock $cfg 'heavy' 'receipt' '1-10-2026' $reps 'dup' | Out-Null
  SaveBlock $cfg 'heavy' 'sales5' '2-10-2026' $reps 'dup' | Out-Null
  SaveBlock $cfg 'heavy' 'sales50' '31-10-2026' $reps 'dup' | Out-Null
  SaveBlock $cfg 'heavy' 'sales50' '31-10-2026' ([math]::Max(2, [int]($reps / 2))) 'alter' | Out-Null
  if ($large) {
    foreach ($k in 'payroll200', 'payroll50', 'stockjournal', 'salesbatch') {
      if ($typeOk[$k].created -ge 1) { SaveBlock $cfg 'heavy' $k (DMY $TypeDates[$k]) 3 'dup' | Out-Null } else { Say "   $k skipped: no template" }
    }
  }
  OctVouchers | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap "tally-ids-heavy-$cfg.json") -Encoding UTF8
}
function V3Main {
  $tdlNR = "$fc\FCPFullNR.tdl"; Copy-Item "$here\FCPFullNR.tdl" $tdlNR -Force
  $plan = @(
    @{ cfg = 'none'; tdls = @(); bridge = $false; large = $true; poll = $true },
    @{ cfg = 'stamp'; tdls = @($tdlStamp); bridge = $false; large = $false; poll = $true },
    @{ cfg = 'heads-nobridge'; tdls = @($tdlHeads); bridge = $false; large = $true; poll = $false },
    @{ cfg = 'heads-bridge'; tdls = @($tdlHeads); bridge = $true; large = $false; poll = $false },
    @{ cfg = 'fullnr-nobridge'; tdls = @($tdlNR); bridge = $false; large = $true; poll = $true },
    @{ cfg = 'full-nobridge'; tdls = @($tdlFull); bridge = $false; large = $false; poll = $false },
    @{ cfg = 'full-bridge'; tdls = @($tdlFull); bridge = $true; large = $false; poll = $false })
  if ($heavyOk) {
    foreach ($p in $plan) {
      Remove-Item "$pd\full-*.txt", "$pd\stamp-*.txt", "$rec\*" -Force -ErrorAction SilentlyContinue; $script:fullSeen = @{}; $script:recSeen = @{}
      BridgeStop
      if (-not (Start-T $heavy $p.tdls "heavy-$($p.cfg)")) { Say "HARNESS: heavy / $($p.cfg) did not open"; continue }
      if ($p.bridge) { BridgeStart; Start-Sleep 5; BodyFetchOn }
      SaveSet $p.cfg $p.large
      if ($p.poll) { PollSaves $p.cfg $reps }
      BridgeLog "heavy-$($p.cfg)"
      Get-ChildItem $pd -Filter 'full-*.txt' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "fullfile-heavy-$($p.cfg)-$($_.Name)") }
      Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recfile-heavy-$($p.cfg)-$($_.Name)") }
    }
    BridgeStop
    if (Start-T $heavy @() 'heavy-guid-after') { GuidRule 'heavy after the saves (new by Alt+2, altered, imported)'; OctVouchers | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'tally-ids-heavy-final.json') -Encoding UTF8 }
  }
  try { V3Tds } catch { Say "HARNESS: TDS stage stopped: $_" }
}

# the TDS entry typed on the light company's screen with the full-entry add-on (as S5 of tally-real-spike, scen231.ps1
# S231TdsScreen, keys without the OCR): Gateway > Vouchers, F7 Journal, F2 date; Dr the expense 100000, To the TDS ledger
# 2000, To the party 98000; narration; accepted
function V3Tds {
  $N = $script:tdsN
  Remove-Item "$pd\full-*.txt", "$pd\stamp-*.txt" -Force -ErrorAction SilentlyContinue; $script:fullSeen = @{}
  if (-not (Start-T $light @($tdlFull) 'tds-full')) { Say 'HARNESS: TDS: light did not open'; return }
  $day = '2-11-2026'; $date = '20261102'
  $pre = @(OctVouchers | ForEach-Object mid)
  KeysTo 'v' 3 'tds-01-vouchers'; KeysTo '{F7}' 3 'tds-02-journal'; KeysTo '{F2}' 2; KeysTo "$day{ENTER}" 2 'tds-03-date'
  KeysTo ((SK $N.exp) + '{ENTER}') 2 'tds-04-exp'; KeysTo '100000{ENTER}' 2 'tds-05-amt'
  KeysTo 't{ENTER}' 2; KeysTo ((SK $N.tds) + '{ENTER}') 3 'tds-06-tdsled'
  KeysTo '2000{ENTER}' 2 'tds-07-tdsamt'
  KeysTo 't{ENTER}' 2; KeysTo ((SK $N.party) + '{ENTER}') 3 'tds-08-party'; KeysTo '{ENTER}' 2 'tds-09-partyamt'
  KeysTo '{ENTER}' 2 'tds-10-rows-done'; KeysTo ((SK 'PD TDS 194C typed on the screen') + '{ENTER}') 3 'tds-11-narr'
  KeysTo 'y' 4 'tds-12-accept'
  $sw = [Diagnostics.Stopwatch]::StartNew(); while (-not (Test-Path "$pd\stamp-e.txt") -and $sw.Elapsed.TotalSeconds -lt 20) { Start-Sleep -Milliseconds 250 }
  $nv = @(OctVouchers | Where-Object { $_.mid -notin $pre })
  if (-not $nv.Count) { KeysTo '^a' 3 'tds-13-ctrl-a'; KeysTo 'y' 3 'tds-14-y'; Start-Sleep 3; $nv = @(OctVouchers | Where-Object { $_.mid -notin $pre }) }
  $lines = NewFullLines
  Set-Content (Join-Path $cap 'tds-addon-lines.txt') $lines -Encoding UTF8
  if (-not $nv.Count) { Say 'TDS: no entry saved (see the tds-* screenshots)'; return }
  $v = $nv[0]; Say "TDS: entry saved: mid $($v.mid) $($v.type) $($v.vno) $($v.guid); add-on lines $($lines.Count)"
  $sv = @($lines | Where-Object { $_ -like 'FCF1|ev=voucher_saved*' })[0]
  $tx = @([regex]::Matches("$sv", '\|L\d+T\d+(s\d+)?=[^|]*') | ForEach-Object { $_.Value }); $bl = @([regex]::Matches("$sv", '\|L\d+B\d+=[^|]*') | ForEach-Object { $_.Value })
  Say "TDS: the add-on's line: tax allocations $($tx.Count): $($tx -join ' '); bills: $($bl -join ' ')"
  Post (DayBookReq $date) '' 120 | Set-Content (Join-Path $cap 'tds-tally-daybook.xml') -Encoding UTF8
  Post (CollReq 'FinComVoucherByMaster' 'Voucher' $date "`$MasterID = $($v.mid)") '' 120 | Set-Content (Join-Path $cap 'tds-bridge-bymaster.xml') -Encoding UTF8
  Post (ObjReq 'Name' $v.guid $true) '' 120 | Set-Content (Join-Path $cap 'tds-object-star.xml') -Encoding UTF8
  $all = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*'
  Post (Coll 'FCPTdsAll' 'Voucher' $all "`$MasterID = $($v.mid)") '' 120 | Set-Content (Join-Path $cap 'tds-collection-star.xml') -Encoding UTF8
  Post (Coll 'FCPTdsNat' 'Voucher' 'NAME' "`$MasterID = $($v.mid)" '<NATIVEMETHOD>*</NATIVEMETHOD>') '' 120 | Set-Content (Join-Path $cap 'tds-collection-native.xml') -Encoding UTF8
  foreach ($f in 'tds-tally-daybook.xml', 'tds-bridge-bymaster.xml', 'tds-object-star.xml', 'tds-collection-star.xml', 'tds-collection-native.xml') {
    $x = Get-Content (Join-Path $cap $f) -Raw
    Say ("TDS: {0}: {1} B, filled TAXOBJECTALLOCATIONS {2}, CATEGORY '{3}', TAX '{4}', ASSESSABLEAMOUNT '{5}', TDSDEDUCTEESECTIONNUMBER '{6}'" -f $f, $x.Length, ([regex]::Matches($x, '<TAXOBJECTALLOCATIONS\.LIST>\s*<[A-Z]')).Count, [regex]::Match($x, '<CATEGORY[^>]*>([^<]+)<').Groups[1].Value, [regex]::Match($x, '<TAX[^A-Z>]*>([^<]+)<').Groups[1].Value, [regex]::Match($x, '<ASSESSABLEAMOUNT[^>]*>([^<]+)<').Groups[1].Value, [regex]::Match($x, '<TDSDEDUCTEESECTIONNUMBER[^>]*>([^<]+)<').Groups[1].Value)
  }
  FetchStage 'light-tds' @((Target 'tds-journal' "`$MasterID = $($v.mid)"))
  Stop-T
}
