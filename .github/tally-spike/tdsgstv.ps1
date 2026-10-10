# Mode tdsgst (round 43, the owner's TDS and GST proof; TallyPrime 7.1 only; TEST DATA ONLY: a throwaway company in this
# runner's own Tally). Dot-sourced by flowv.ps1 twice:
#   $tgPhase = 'masters' (before the bridge starts): the company's GST and TDS on, the natures of payment, the ledgers and
#     parties (tdsgst/masters.json, made by tests/fixtures/tdsgst-e2e/make.mjs on branch e2e-tdsgst); what Tally took is
#     said in the log and the masters are exported (captures/masters-p0.xml)
#   $tgPhase = 'run' (after the published bridge 2.4.1 is installed, stubg.py as FinCom's cloud: its beat answer carries
#     recorderSource "both", the owner's per-computer choice in FinCom, so the bridge reads Tally's change list beside the
#     add-on: an entry imported by XML reaches FinCom as in production with that choice):
#       1. Update now (the ledger list goes to the cloud, as FinCom's page asks it)
#       2. phase 1: the 39 entries by XML import (tdsgst/vouchers-p1.json); FC/26-27/012 cancelled on the screen (Alt+X)
#       3. the bridge reads them (its lines reach the stub; waited up to 25 minutes: the light check runs every 10)
#       4. Tally's Day Book (April-July 2026, the month by month export the owner uploads) and the masters exported:
#          captures/daybook-p1-<yyyymm>.xml, masters-p1.xml ("as filed")
#       5. phase 2, after "filing": FC/26-27/002 and CN/001 altered, the TDS entry JV/T02 moved to 194J (XML Alter by its
#          GUID), Sigma Landlord's PAN corrected (ledger Alter), FC/26-27/013 deleted on the screen (Alt+D); Update now
#       6. the bridge reads them; Day Book and masters exported again (captures/daybook-p2-*.xml, masters-p2.xml)
#     Every request the bridge sent is kept by the stub (versions/stub-requests.jsonl; captures/stub-requests.jsonl), with
#     the bridge's log and the add-on's recorder files. The figures are judged on Linux (tests/run_e2e_tdsgst.py), not here.
# Result lines: g1 masters and entries made in Tally, g2 the bridge sent every entry (phase 1), g3 the amendments made and
# sent (phase 2), g4 the Day Book and masters exported. A step the harness could not do is HARNESS, never PASS.
$gdir = Join-Path $PSScriptRoot 'tdsgst'
$TG1 = 'g1 masters and entries made in Tally'; $TG2 = 'g2 the bridge sent every entry (phase 1)'; $TG3 = 'g3 the amendments made in Tally and sent (phase 2)'; $TG4 = 'g4 the Day Book and masters exported'
function TgCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; return [pscustomobject]@{ c = 0; a = 0; e = -1; line = ("$r" -replace '\s+', ' ').Substring(0, [Math]::Min(300, ("$r" -replace '\s+', ' ').Length)) } }
function TgSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function TgExportMasters($name) {
  $x = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') "masters $name" 300
  TgSave "masters-$name.xml" $x
  $n = ([regex]::Matches("$x", '<LEDGER NAME=')).Count
  Info "tdsgst: masters exported ($name): $n ledgers, $("$x".Length) characters"
  return $n
}
if ($tgPhase -eq 'masters') {
  Say '---- tdsgst masters (before the bridge)'
  $M = Get-Content (Join-Path $gdir 'masters.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in $M.steps) {
    $r = Imp 'All Masters' $s[1] "tdsgst $($s[0])"
    $k = TgCount $r
    Info "tdsgst masters $($s[0]): created $($k.c), altered $($k.a), errors $($k.e)$(if ($k.line) { "; Tally said: $($k.line)" })"
  }
  # what Tally kept of the company's GST and TDS settings
  $cx = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TgCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TgCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, STATENAME, ISGSTON, ISTDSON, ISTCSON, TANUMBER, INCOMETAXNUMBER, GSTIN, GSTREGISTRATIONTYPE, BOOKSFROM, STARTINGFROM</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'tdsgst company'
  TgSave 'company-p0.xml' $cx
  Info "tdsgst company as Tally keeps it: $((([regex]::Matches("$cx", '<(STATENAME|ISGSTON|ISTDSON|ISTCSON|TANUMBER|INCOMETAXNUMBER|GSTIN|GSTREGISTRATIONTYPE|BOOKSFROM|STARTINGFROM)[^>]*>([^<]*)<') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value)" }) -join ', '))"
  $script:tgLed0 = TgExportMasters 'p0'
  return
}

# ---------------------------------------------------------------- run
Say '---- tdsgst: the entries, the bridge, the amendments'
$tgDone = @{}
function TgRes($c, $st, $ev) { if (-not $tgDone[$c]) { Result $c $st $ev; $tgDone[$c] = $true } }
function TgAll {
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TgVA</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TgVA" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, ISOPTIONAL, NARRATION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60
  $l = @()
  try { $d = [xml]($x -replace '&#4;', '')
    foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $n = Val $v.NARRATION
      $l += [pscustomobject]@{ id = ($n -split ' ', 2)[0]; guid = Val $v.GUID; vchkey = "$($v.VCHKEY)"; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); cancelled = ((Val $v.ISCANCELLED) -eq 'Yes'); optional = ((Val $v.ISOPTIONAL) -eq 'Yes'); vno = Val $v.VOUCHERNUMBER; type = Val $v.VOUCHERTYPENAME; date = Val $v.DATE; narr = $n } }
  } catch { Write-Host "TgAll parse: $_"; TgSave "vouchers-unparsed-$(Get-Date -Format HHmmss).xml" $x }
  return , $l
}
function TgDayBook($n, $d) { KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 4; KeysTo '{F2}' 3; KeysTo "$d{ENTER}" 4 "tg-$n-daybook" }
function TgUpdateNow($why) {
  $m0 = Mark
  $r = Bridge POST '/keep' @{ company = $co1; now = $true } 60
  Info "tdsgst: Update now ($why): $(if ($r) { 'asked' } else { 'the bridge did not answer' })"
  $until = (Get-Date).AddSeconds(240); $got = $null
  while ((Get-Date) -lt $until) { $rq = StubReqs; for ($i = $m0; $i -lt $rq.Count; $i++) { if ($rq[$i].kind -in 'ledger_list', 'ledgers', 'groups') { $got = $rq[$i].kind } }; if ($got) { break }; Start-Sleep 5 }
  Info "tdsgst: after Update now ($why): $(if ($got) { "the ledger list reached the stub ($got)" } else { 'no ledger list in 240 s' })"
}
# the lines the stub holds for a GUID: the latest with Tally's entry (a body), by AlterID
function TgLine($guid) { $m = @((StubLines 0) | Where-Object { $_.guid -eq $guid }); return , $m }
function TgWaitLines($want, $label, $min = 25) {
  # $want: [{id, guid, aid, ev}] each wanted as a line of that GUID: a body at that AlterID (created / altered / imported), or
  # the event (cancelled / deleted)
  $until = (Get-Date).AddMinutes($min); $miss = $want
  while ((Get-Date) -lt $until) {
    $sl = StubLines 0
    $miss = @($want | Where-Object { $w = $_
      $mine = @($sl | Where-Object { $_.guid -eq $w.guid })
      if ($w.ev -in 'cancelled', 'deleted') { -not @($mine | Where-Object { $_.ev -eq $w.ev -or ($w.ev -eq 'cancelled' -and $_.xml -match '<ISCANCELLED[^>]*>\s*Yes') }).Count }
      else { -not @($mine | Where-Object { $_.xml -and [int]$_.aid -ge $w.aid }).Count } })
    if (-not $miss.Count) { break }
    Write-Host "[tdsgst] $label waiting for $($miss.Count) of $($want.Count): $(($miss | ForEach-Object { $_.id }) -join ', ')"
    Start-Sleep 20
  }
  return , $miss
}
function TgDayBookExport($tag) {
  # Tally's Day Book report answers the day its screen last showed (31-5-2026, set by the keys) whatever period is asked (run
  # 38060636032); so each month's entries are exported as Tally stores them: a voucher collection of the month with every
  # stored field of the entry and of its lists (the fields the owner's Day Book export carries)
  $tot = 0
  $fl = '*, ALLLEDGERENTRIES.*, ALLLEDGERENTRIES.BILLALLOCATIONS.*, ALLLEDGERENTRIES.RATEDETAILS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.*, LEDGERENTRIES.*, ALLINVENTORYENTRIES.*'
  foreach ($ym in '202604', '202605', '202606', '202607') {
    $y = [int]$ym.Substring(0, 4); $mo = [int]$ym.Substring(4, 2); $last = [DateTime]::DaysInMonth($y, $mo)
    $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TgDay</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>' + $ym + '01</SVFROMDATE><SVTODATE>' + $ym + $last + '</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TgDay" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>' + $fl + '</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') "daybook $tag $ym" 300
    TgSave "daybook-$tag-$ym.xml" $x
    $ds = @([regex]::Matches("$x", '<VOUCHER [\s\S]*?<DATE[^>]*>(\d{8})</DATE>') | ForEach-Object { $_.Groups[1].Value })
    $n = $ds.Count; $tot += $n; $out = @($ds | Where-Object { $_.Substring(0, 6) -ne $ym }).Count
    Info "tdsgst: entries of $tag $ym exported: $n entries ($out outside the month), $("$x".Length) characters"
  }
  return $tot
}
try {
  $V1 = Get-Content (Join-Path $gdir 'vouchers-p1.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $O2 = Get-Content (Join-Path $gdir 'ops-p2.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Start-Sleep 30; Snap 'tg-start'
  TgUpdateNow 'the masters'
  # ---- phase 1: the entries
  $made = @(); $bad = @()
  foreach ($v in $V1.vouchers) {
    $r = Imp 'Vouchers' $v.xml "tdsgst $($v.id)"; $k = TgCount $r
    if ($k.c -ne 1 -and $v.xml -match 'TAXOBJECTALLOCATIONS') {
      # Tally refused the TDS allocation (its nature may not be in Tally): the entry again without it, said in the log
      $x2 = $v.xml -replace '(?s)<TAXOBJECTALLOCATIONS\.LIST>.*?</TAXOBJECTALLOCATIONS\.LIST>', ''
      $r = Imp 'Vouchers' $x2 "tdsgst $($v.id) (no TDS allocation)"; $k2 = TgCount $r
      Info "tdsgst $($v.id): refused with its TDS allocation ($($k.line)); without it: created $($k2.c), errors $($k2.e) $($k2.line)"; $k = $k2
    }
    if ($k.c -eq 1) { $made += $v.id } else { $bad += "$($v.id) (created $($k.c), errors $($k.e): $($k.line))" }
  }
  Info "tdsgst phase 1: $($made.Count) of $($V1.vouchers.Count) entries made by XML; refused: $(if ($bad.Count) { $bad -join '; ' } else { 'none' })"
  $all1 = TgAll
  # FC/26-27/012 cancelled on the screen (Day Book of 31-5-2026: it is the first entry of that day)
  $s12 = @($all1 | Where-Object { $_.id -eq 'S12' })[0]
  $nw0 = $script:noWindow
  if ($s12) { TgDayBook 'cancel' '31-5-2026'; KeysTo '{HOME}' 2; KeysTo '%x' 3; KeysTo 'y' 4 'tg-cancelled' }
  $all1 = TgAll; $s12b = @($all1 | Where-Object { $_.id -eq 'S12' })[0]
  $cancelHow = if ($s12b -and $s12b.cancelled) { 'by keys (Alt+X)' } else { '' }
  if ($s12b -and -not $s12b.cancelled) {
    $r = Imp 'Vouchers' ('<VOUCHER DATE="20260531" TAGNAME="Voucher Number" TAGVALUE="FC/26-27/012" VCHTYPE="Sales" ACTION="Cancel"><DATE>20260531</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>FC/26-27/012</VOUCHERNUMBER></VOUCHER>') 'tdsgst S12 cancel by XML'
    $all1 = TgAll; $s12b = @($all1 | Where-Object { $_.id -eq 'S12' })[0]
    if ($s12b -and $s12b.cancelled) { $cancelHow = 'by XML (ACTION Cancel; the keys did not)' }
  }
  Info "tdsgst: FC/26-27/012 cancelled: $(if ($cancelHow) { $cancelHow } else { 'NOT cancelled' })"
  $all1 | ForEach-Object { Write-Host ("  tally {0} {1}/{2}/{3} mid {4} aid {5} guid {6} cancelled {7} optional {8}" -f $_.id, $_.type, $_.vno, $_.date, $_.mid, $_.aid, $_.guid, $_.cancelled, $_.optional) }
  $all1 | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'tally-vouchers-p1.json') -Encoding UTF8
  $okMade = ($made.Count -eq $V1.vouchers.Count) -and [bool]$cancelHow
  TgRes $TG1 $(if ($okMade) { 'PASS' } else { 'HARNESS' }) ("{0} of {1} entries made by XML, FC/26-27/012 cancelled {2}; refused: {3}; the company's GST/TDS settings and the masters as Tally kept them in company-p0.xml / masters-p0.xml" -f $made.Count, $V1.vouchers.Count, $(if ($cancelHow) { $cancelHow } else { 'not' }), $(if ($bad.Count) { $bad -join '; ' } else { 'none' }))
  # ---- the bridge reads phase 1
  $want1 = @($all1 | Where-Object { $_.id -match '^[A-Z]+\d+$' } | ForEach-Object { [pscustomobject]@{ id = $_.id; guid = $_.guid; aid = $_.aid; ev = $(if ($_.cancelled) { 'cancelled' } else { 'body' }) } })
  $t0 = Get-Date
  $miss1 = TgWaitLines $want1 'phase 1'
  Snap 'tg-p1'
  TgRes $TG2 $(if (-not $want1.Count) { 'HARNESS' } elseif (-not $miss1.Count) { 'PASS' } else { 'FAIL' }) ("{0} entries in Tally; the bridge's lines with Tally's entry reached the stub for {1} in {2} min; not reached: {3}" -f $want1.Count, ($want1.Count - $miss1.Count), [math]::Round(((Get-Date) - $t0).TotalMinutes, 1), $(if ($miss1.Count) { ($miss1 | ForEach-Object { "$($_.id) ($($_.ev))" }) -join ', ' } else { 'none' }))
  $d1 = TgDayBookExport 'p1'; $m1 = TgExportMasters 'p1'
  # ---- phase 2: the amendments after "filing"
  # which XML form alters an entry in place in this Tally (run 38064141905: the REMOTEID form and the voucher-number form
  # with a yyyymmdd date each made a NEW entry): tried on a throwaway journal of 1-10-2026 (no tax, outside the months the
  # returns read); the first form that keeps its MasterID, raises its AlterID and leaves one entry is used for the amendments
  function TgForm($m, $c, $type, $dateDmy) {
    switch ($m) {
      'remoteid-vchkey' { return '<VOUCHER REMOTEID="' + $c.guid + '" VCHKEY="' + $c.vchkey + '" VCHTYPE="' + $type + '" ACTION="Alter">' }
      'number-dmy' { return '<VOUCHER DATE="' + $dateDmy + '" TAGNAME="Voucher Number" TAGVALUE="' + $c.vno + '" VCHTYPE="' + $type + '" ACTION="Alter">' }
      'masterid-tag' { return '<VOUCHER TAGNAME="MasterID" TAGVALUE="' + $c.mid + '" VCHTYPE="' + $type + '" ACTION="Alter">' }
      'guid-tag' { return '<VOUCHER TAGNAME="GUID" TAGVALUE="' + $c.guid + '" VCHTYPE="' + $type + '" ACTION="Alter">' }
      'inner-ids' { return '<VOUCHER VCHTYPE="' + $type + '" ACTION="Alter"><GUID>' + $c.guid + '</GUID><MASTERID>' + $c.mid + '</MASTERID>' }
    }
  }
  function TgBody($x) { return ($x -replace '^<VOUCHER [^>]*>', '') }
  $probe = '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261001</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>PROBE/1</VOUCHERNUMBER><NARRATION>PROBE alter probe</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-10.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $null = Imp 'Vouchers' $probe 'tdsgst alter probe'
  $script:tgForm = ''; $tried = @()
  function TgAllP { $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TgVP</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20261001</SVFROMDATE><SVTODATE>20261001</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TgVP" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, VOUCHERNUMBER, NARRATION</FETCH><FILTERS>TgPr</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="TgPr">$Narration CONTAINS "PROBE"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 60
    $l = @(); try { $d = [xml]($x -replace '&#4;', ''); foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $l += [pscustomobject]@{ guid = Val $v.GUID; vchkey = "$($v.VCHKEY)"; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); vno = Val $v.VOUCHERNUMBER; narr = Val $v.NARRATION } } } catch {}
    return , $l }
  # the forms naming the entry by an id of its own first: run 38066717288's number form altered ANOTHER entry for CN1 (number
  # 1 on 2-5-2026 is also a receipt's and a debit note's: Tally numbers each type from 1 and did not keep the given numbers)
  foreach ($m in 'guid-tag', 'masterid-tag', 'inner-ids', 'remoteid-vchkey', 'number-dmy') {
    $pl = TgAllP; $c = @($pl | Where-Object { $_.narr -like 'PROBE alter probe*' } | Sort-Object mid)[0]
    if (-not $c) { $tried += "${m}: no probe"; break }
    $nar = "PROBE alter probe $m"
    $x = (TgForm $m $c 'Journal' '1-Oct-2026') + ((TgBody $probe) -replace 'PROBE alter probe', $nar -replace '-10\.00', '-20.00' -replace '>10\.00<', '>20.00<')
    $r = Imp 'Vouchers' $x "tdsgst alter probe $m"; $k = TgCount $r
    $pl2 = TgAllP; $same = @($pl2 | Where-Object { $_.mid -eq $c.mid })[0]
    $good = $same -and $same.aid -gt $c.aid -and $same.narr -eq $nar -and $pl2.Count -eq $pl.Count
    $tried += "${m}: created $($k.c), altered $($k.a), errors $($k.e) $($k.line) -> $(if ($good) { 'altered in place' } else { "not in place (probes $($pl.Count) -> $($pl2.Count))" })"
    if ($good) { $script:tgForm = $m; break }
  }
  Info "tdsgst: the alteration forms tried on the probe journal: $($tried -join ' | '); used: $(if ($script:tgForm) { $script:tgForm } else { 'none: the amendments are made by keys' })"
  $ops = @()
  foreach ($o in $O2.ops) {
    $allNow = TgAll; $cur = @($allNow | Where-Object { $_.id -eq $o.id })[0]
    if ($o.op -eq 'alter') {
      if (-not $cur) { $ops += "$($o.id): not in Tally"; continue }
      $how = ''
      if ($script:tgForm) {
        $dmy = [datetime]::ParseExact($o.date, 'yyyyMMdd', $null).ToString('d-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture)
        $x = (TgForm $script:tgForm $cur $o.type $dmy) + (TgBody $o.xml)
        $r = Imp 'Vouchers' $x "tdsgst alter $($o.id)"; $k = TgCount $r
        $how = "$($script:tgForm): created $($k.c), altered $($k.a), errors $($k.e) $($k.line)"
      } else { $how = 'no XML form alters in place on this Tally' }
      $allNow = TgAll; $aft = @($allNow | Where-Object { $_.id -eq $o.id })
      $ok = $aft.Count -eq 1 -and $aft[0].aid -gt $cur.aid -and $aft[0].mid -eq $cur.mid -and $aft[0].narr -eq $o.narr
      $ops += "$($o.id) altered: $ok (mid $($cur.mid), AlterID $($cur.aid) -> $(($aft | ForEach-Object { $_.aid }) -join '/'), entries with this id $($aft.Count); $how)"
    } elseif ($o.op -eq 'ledger') {
      $r = Imp 'All Masters' $o.xml "tdsgst ledger $($o.id)"; $k = TgCount $r
      $ops += "$($o.id) ledger altered: $($k.a -eq 1) (altered $($k.a), errors $($k.e) $($k.line))"
    } elseif ($o.op -eq 'delete-keys') {
      if (-not $cur) { $ops += "$($o.id): not in Tally"; continue }
      TgDayBook 'delete' $o.day; KeysTo '{END}' 2; KeysTo '%d' 3; KeysTo 'y' 4 'tg-deleted'
      $allNow = TgAll; $gone = -not @($allNow | Where-Object { $_.id -eq $o.id }).Count
      if (-not $gone) {
        $r = Imp 'Vouchers' ('<VOUCHER DATE="20260531" TAGNAME="Voucher Number" TAGVALUE="' + $cur.vno + '" VCHTYPE="' + $cur.type + '" ACTION="Delete"><DATE>20260531</DATE><VOUCHERTYPENAME>' + $cur.type + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + $cur.vno + '</VOUCHERNUMBER></VOUCHER>') "tdsgst delete $($o.id) by XML"
        $allNow = TgAll; $gone = -not @($allNow | Where-Object { $_.id -eq $o.id }).Count
        $ops += "$($o.id) deleted: $gone (the keys did not; by XML ACTION Delete)"
      } else { $ops += "$($o.id) deleted: True (by keys, Alt+D)" }
      $script:tgDel = $cur
    }
  }
  Info "tdsgst phase 2: $($ops -join ' | ')"
  TgUpdateNow 'the PAN corrected'
  $all2 = TgAll
  $all2 | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap 'tally-vouchers-p2.json') -Encoding UTF8
  $want2 = @()
  foreach ($o in $O2.ops) {
    if ($o.op -eq 'alter') { $a = @($all2 | Where-Object { $_.id -eq $o.id })[0]; if ($a) { $want2 += [pscustomobject]@{ id = $o.id; guid = $a.guid; aid = $a.aid; ev = 'body' } } }
    if ($o.op -eq 'delete-keys' -and $script:tgDel) { $want2 += [pscustomobject]@{ id = $o.id; guid = $script:tgDel.guid; aid = 0; ev = 'deleted' } }
  }
  $t0 = Get-Date
  $miss2 = TgWaitLines $want2 'phase 2'
  Snap 'tg-p2'
  $opsOk = -not @($ops | Where-Object { $_ -match ': False|not in Tally' }).Count
  TgRes $TG3 $(if (-not $opsOk -or -not $want2.Count) { 'HARNESS' } elseif (-not $miss2.Count) { 'PASS' } else { 'FAIL' }) ("{0}; the bridge's lines for {1} of {2} in {3} min; not reached: {4}" -f ($ops -join ' | '), ($want2.Count - $miss2.Count), $want2.Count, [math]::Round(((Get-Date) - $t0).TotalMinutes, 1), $(if ($miss2.Count) { ($miss2 | ForEach-Object { "$($_.id) ($($_.ev))" }) -join ', ' } else { 'none' }))
  $d2 = TgDayBookExport 'p2'; $m2 = TgExportMasters 'p2'
  TgRes $TG4 $(if ($d1 -gt 0 -and $d2 -gt 0 -and $m1 -gt 0 -and $m2 -gt 0) { 'PASS' } else { 'HARNESS' }) ("Day Book April-July 2026: {0} entries (phase 1), {1} (phase 2); masters: {2} and {3} ledgers" -f $d1, $d2, $m1, $m2)
} catch {
  Write-Host "tdsgst stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($TG1, $TG2, $TG3, $TG4)) { TgRes $c 'HARNESS' "the harness stopped: $_" }
}
# ---- what is kept
Snap 'tg-end'
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
foreach ($f in @(Get-ChildItem (Split-Path $blog) -Filter 'tds-bridge*.log' -ErrorAction SilentlyContinue)) { Copy-Item $f.FullName (Join-Path $out "bridge-full-$($f.Name)") -ErrorAction SilentlyContinue }
$cf = Get-Content "$h1\tds-bridge.config.json" -Raw | ConvertFrom-Json; $cf.Key = '(kept out)'; if ($cf.CloudKey) { $cf.CloudKey = '(kept out)' }
$cf | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'bridge-settings.json')
