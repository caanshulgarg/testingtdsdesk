# fast234.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234p
# or fast234m, right after Tally is installed and flow.ps1 made "FinCom Spike Co" (nothing else of pushm.ps1 runs).
# The owner's approval of 07-Oct-2026: a fast request "voucher object by MasterID", one entry per request, read only, the
# SAME fields as the approved entry request (FinComVoucherByMaster of tax-accuracy 2.3.3), nothing added.
#   fast234p  the request's form: candidate forms for ONE voucher on a 4,000-voucher company (no godowns), each asked a
#             warm-up and 3 timed times; every answer kept whole (captures\fast-<target>-<form>.xml) so the returned tags
#             can be compared with today's request on the same voucher
#   fast234m  the chosen form against today's request at 4,000 / 25,000 / 40,000 / 100,000 vouchers (grown in place),
#             a warm-up and 5 timed reps each, median and worst
# Each request is the HTTP round trip from this script to Tally on 127.0.0.1:9000 (no bridge, no proxy).
$fcsv = Join-Path $out 'fast234.csv'; $fsz = Join-Path $out 'fast234-sizes.csv'
$W = "$env:RUNNER_TEMP\fast234"; if (Test-Path $W) { Remove-Item $W -Recurse -Force }; New-Item -ItemType Directory -Force $W | Out-Null
$tplBM = [IO.File]::ReadAllText("$here\fast234-bymaster.xml").Trim()
$tplBN = [IO.File]::ReadAllText("$here\fast234-bynumber.xml").Trim()
$FL = [regex]::Match($tplBM, '<FETCH>([^<]+)</FETCH>').Groups[1].Value
$FLs = @($FL -split ',\s*')
Say "fast234 ($env:PD_MODE) on TallyPrime ${rel}: today's request $($tplBM.Length) chars, $($FLs.Count) fields"
function X([string]$s) { [Security.SecurityElement]::Escape($s) }
function St { '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (X $script:co) + '</SVCURRENTCOMPANY>' }
function Head($type, $id, $sub = '') { '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>' + $type + '</TYPE>' + $sub + '<ID>' + $id + '</ID></HEADER>' }

# ---------------------------------------------------------------- the candidate forms
function ReqBM($date, $mid) { $tplBM.Replace('@@CO@@', (X $script:co)).Replace('20991231', $date).Replace('987654321', "$mid") }
function ReqBN($date, $type, $no) { $tplBN.Replace('@@CO@@', (X $script:co)).Replace('20991231', $date).Replace('@@TYPE@@', (X $type)).Replace('@@NO@@', (X $no)) }
function ObjReq($mid, [string[]]$fetch) {
  $fl = if ($fetch) { '<FETCHLIST>' + (($fetch | ForEach-Object { "<FETCH>$_</FETCH>" }) -join '') + '</FETCHLIST>' } else { '' }
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:' + $mid + '</ID></HEADER><BODY><DESC><STATICVARIABLES>' + (St) + '</STATICVARIABLES>' + $fl + '</DESC></BODY></ENVELOPE>'
}
function CollReq($id, $type, $fetch, $filter, $extra = '', $statics = '') {
  $f = if ($filter) { "<FILTERS>${id}Only</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"${id}Only`">$(X $filter)</SYSTEM>" } else { '</COLLECTION>' }
  (Head 'Collection' $id) + '<BODY><DESC><STATICVARIABLES>' + (St) + $statics + '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE>' + $extra + '<FETCH>' + $fetch + '</FETCH>' + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
# a TDL report over the one voucher (the report's object named by "ID:<MasterID>"), two fields: is the object keyed?
function RptReq($mid, $where) {
  $o = 'Voucher : "ID:' + $mid + '"'
  $rep = '<REPORT NAME="FCPRpt"><FORMS>FCPRpt</FORMS>' + $(if ($where -eq 'report') { "<OBJECT>$(X $o)</OBJECT>" }) + '</REPORT>'
  $prt = '<PART NAME="FCPRpt"><TOPLINES>FCPRpt</TOPLINES>' + $(if ($where -eq 'part') { "<OBJECT>$(X $o)</OBJECT>" }) + '</PART>'
  (Head 'Data' 'FCPRpt') + '<BODY><DESC><STATICVARIABLES>' + (St) + '</STATICVARIABLES><TDL><TDLMESSAGE>' + $rep +
  '<FORM NAME="FCPRpt"><TOPPARTS>FCPRpt</TOPPARTS><XMLTAG>"FCPVCH"</XMLTAG></FORM>' + $prt +
  '<LINE NAME="FCPRpt"><LEFTFIELDS>FCPMid, FCPNarr, FCPType</LEFTFIELDS></LINE>' +
  '<FIELD NAME="FCPMid"><SET>$MasterID</SET><XMLTAG>"MASTERID"</XMLTAG></FIELD>' +
  '<FIELD NAME="FCPNarr"><SET>$Narration</SET><XMLTAG>"NARRATION"</XMLTAG></FIELD>' +
  '<FIELD NAME="FCPType"><SET>$VoucherTypeName</SET><XMLTAG>"VOUCHERTYPENAME"</XMLTAG></FIELD>' +
  '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
function TopNames { $t = @(); foreach ($f in $FLs) { $h = ($f -split '\.')[0]; if ($t -notcontains $h) { $t += $h } }; return $t }
function Forms($t) {
  $o = [ordered]@{}
  $o['bymaster'] = ReqBM $t.date $t.mid
  if ($env:PD_MODE -eq 'fast234m') { $o['objfl'] = ObjReq $t.mid $FLs; return $o }
  $o['bynumber'] = ReqBN $t.date $t.type $t.vno
  $o['objfl'] = ObjReq $t.mid $FLs                     # the object export, today's 61 fields as FETCH (why22's objid)
  $o['objmid'] = ObjReq $t.mid @('MASTERID')            # one field: what an object export always carries
  $o['objtop'] = ObjReq $t.mid (TopNames)               # the top-level names only
  $o['objheads'] = ObjReq $t.mid @('GUID', 'MASTERID', 'DATE', 'VOUCHERTYPENAME', 'VOUCHERNUMBER', 'NARRATION') # heads only, no list
  # a Voucher collection keyed by CHILDOF "ID:<MasterID>" (with today's filter, so the answer is right either way: the
  # time says whether the key was used)
  $o['collchildq'] = CollReq 'FCPChildQ' 'Voucher' $FL "`$MasterID = $($t.mid)" ('<CHILDOF>' + (X "`"ID:$($t.mid)`"") + '</CHILDOF>')
  $o['collchildn'] = CollReq 'FCPChildN' 'Voucher' $FL "`$MasterID = $($t.mid)" ("<CHILDOF>$($t.mid)</CHILDOF>")
  # the voucher's ledger lines as a sub-object collection of the one voucher
  $o['colllines'] = CollReq 'FCPLines' 'AllLedgerEntries : Voucher' 'LEDGERNAME, AMOUNT' '' ('<CHILDOF>' + (X "`"ID:$($t.mid)`"") + '</CHILDOF>')
  # a method of the one voucher reached by its id from a one-object collection (the company)
  $o['collpath'] = CollReq 'FCPPath' 'Company' 'NAME' '$Name = ##SVCurrentCompany' ('<COMPUTE>' + (X "FCPN : `$Narration:Voucher:`"ID:$($t.mid)`"") + '</COMPUTE><COMPUTE>' + (X "FCPM : `$MasterID:Voucher:`"ID:$($t.mid)`"") + '</COMPUTE><FETCH>FCPN, FCPM</FETCH>')
  $o['rptobj'] = RptReq $t.mid 'report'
  $o['rptpart'] = RptReq $t.mid 'part'
  # by number: the type's own voucher list (Vouchers : VoucherType, CHILDOF the type) with today's number filter
  $o['numvtype'] = CollReq 'FCPNumVt' 'Vouchers : VoucherType' $FL "`$VoucherNumber = `"$($t.vno)`"" ('<CHILDOF>' + (X "`"$($t.type)`"") + '</CHILDOF>') "<SVFROMDATE>$($t.date)</SVFROMDATE><SVTODATE>$($t.date)</SVTODATE>"
  # run 37650805764: an object export with NO FETCHLIST got no answer in 120 s on every release, and Tally answered nothing
  # after it: asked last, alone
  $o['objnone'] = ObjReq $t.mid @()
  return $o
}

# ---------------------------------------------------------------- Tally on a data folder
function WIni($data, [string[]]$loads) {
  $l = @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($loads) { $l += 'Default Companies = Yes'; foreach ($x in $loads) { $l += "Load = $x" } } else { $l += 'Default Companies = No' }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
}
$listCo = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID,StartingFrom</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function Cos { $x = Post $listCo '' 60; return @([regex]::Matches($x, '<COMPANY NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) }) }
function StartW($data, [string[]]$loads, $tag, [string[]]$want) {
  Stop-T; WIni $data $loads
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $p.Id
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {}; if ($p.HasExited) { break } }
  Start-Sleep 5
  KeysTo 'a' 4; KeysTo 't' 8 "f-$tag-started"
  $have = @(); $ok = $false
  for ($w = 0; $w -lt 30 -and -not $ok; $w++) {
    $have = Cos; $ok = (@($want | Where-Object { $_ -notin $have }).Count -eq 0)
    if (-not $ok) { if ($w -eq 10 -or $w -eq 20) { KeysTo '{ENTER}' 6 "f-$tag-key-$w" } else { Start-Sleep 3 } }
  }
  Say "Tally started ($tag) in $([math]::Round($sw.Elapsed.TotalSeconds,1)) s; companies open: $($have -join ' | ') -> $ok"
  return $ok
}

# ---------------------------------------------------------------- the company: masters, bulk vouchers (no godown)
$wDates = HeavyDates
function WhyVoucher($k) {
  $nParty = 270; $nExp = 30; $nItem = 300
  $date = $wDates[$k % $wDates.Count]; $party = 'HParty {0:d5}' -f (($k % $nParty) + 1)
  switch ($k % 5) {
    { $_ -in 0, 1 } { $its = @(); for ($j = 0; $j -lt 3; $j++) { $its += ('HItem {0:d5}' -f ((($k * 3 + $j) % $nItem) + 1)) }; return SalesXml $date ('HS-{0:d6}' -f $k) $party $its "heavy sales $k" $false }
    { $_ -in 2, 3 } { return ReceiptXml $date ('HR-{0:d6}' -f $k) $party ('HADV-{0:d6}' -f $k) 500 "heavy receipt $k" $false }
    default { $exp = 'HExpense {0:d4}' -f (($k % $nExp) + 1)
      return '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $date + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>' + ('HJ-{0:d6}' -f $k) + '</VOUCHERNUMBER><NARRATION>heavy journal ' + $k + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $exp + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-75.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>75.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' }
  }
}
function ImpMasters($ms, $label) { for ($i = 0; $i -lt $ms.Count; $i += 1000) { Imp 'All Masters' $ms[$i..([math]::Min($i + 999, $ms.Count - 1))] "$label $i" | Out-Null } }
$script:made = 0
function GrowTo($n) {
  for ($k = $script:made; $k -lt $n; $k += 1000) {
    $hi = [math]::Min($k + 1000, $n); $b = @(); for ($j = $k; $j -lt $hi; $j++) { $b += WhyVoucher $j }
    $r = Imp 'Vouchers' $b "vouchers $k-$($hi - 1)"
    if ($r.created -lt ($hi - $k)) { Say "HARNESS: vouchers $k-$($hi - 1): only $($r.created) made" }
  }
  $script:made = $n
}
# the targets: a rich 3-item sales invoice and a rich receipt (bank details, cost centre) on 1-Oct-2026, where no bulk
# voucher lives; found by their narration
function Targets($tag) {
  $its = @('Item T01', 'Item T02', 'Item T03')
  $s = Imp 'Vouchers' @(SalesXml '20261001' "FS-$tag" 'Template Party' $its "fast234 sales $tag") "target sales $tag"
  if ($s.created -lt 1) { Imp 'Vouchers' @(SalesXml '20261001' "FS-$tag" 'Template Party' $its "fast234 sales $tag" $false) "target sales $tag (plain)" | Out-Null }
  $r = Imp 'Vouchers' @(ReceiptXml '20261001' "FR-$tag" 'Template Party' "FS-$tag" 500 "fast234 receipt $tag") "target receipt $tag"
  if ($r.created -lt 1) { Imp 'Vouchers' @(ReceiptXml '20261001' "FR-$tag" 'Template Party' "FS-$tag" 500 "fast234 receipt $tag" $false) "target receipt $tag (plain)" | Out-Null }
  $x = Post (Coll 'FCPTgt' 'Voucher' 'GUID, MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION' '$Date >= $$Date:"01-10-2026"') '' 600
  $o = @()
  foreach ($k in 'sales', 'receipt') {
    $m = @([regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>') | Where-Object { $_.Value -match "<NARRATION[^>]*>fast234 $k $tag<" } | Select-Object -First 1).Value
    $t = [pscustomobject]@{ name = "$k-$tag"; mid = [regex]::Match("$m", '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; date = [regex]::Match("$m", '<DATE[^>]*>(\d{8})').Groups[1].Value; vno = [regex]::Match("$m", '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value; type = [regex]::Match("$m", '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value }
    Say "target $($t.name): MasterID $($t.mid), date $($t.date), $($t.type) $($t.vno)"
    $o += $t
  }
  return $o
}
function Sizes($case) {
  $x = Post (Coll 'FCPMidV' 'Voucher' 'MASTERID') '' 900
  $ids = @([regex]::Matches($x, '<MASTERID[^>]*>\s*(\d+)') | ForEach-Object { [int64]$_.Groups[1].Value }); $s = $ids | Measure-Object -Maximum
  $tp = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  $o = [pscustomobject]@{ rel = $rel; case = $case; vouchers = $ids.Count; max_mid = $s.Maximum; tally_ws_mb = $(if ($tp) { [math]::Round($tp.WorkingSet64 / 1MB) }) }
  $o | Export-Csv $fsz -Append -NoTypeInformation -Encoding UTF8
  Say "sizes ${case}: $($o.vouchers) vouchers (MasterID up to $($o.max_mid)); Tally $($o.tally_ws_mb) MB"
  return $o.vouchers
}

# ---------------------------------------------------------------- one target: every form, a warm-up and $n timed reps
function FMeasure($case, $t, $nv, $n, [bool]$keep) {
  if (-not $t.mid) { Say "measure ${case}: no target"; return }
  $forms = Forms $t
  if ($keep) { foreach ($f in $forms.Keys) { Set-Content (Join-Path $cap "fast-request-$($t.name)-$f.xml") $forms[$f] -Encoding UTF8 } }
  $res = [ordered]@{}; foreach ($f in $forms.Keys) { $res[$f] = @() }
  $dead = @{}
  for ($r = 0; $r -le $n; $r++) {
    foreach ($f in $forms.Keys) {
      if ($dead[$f]) { continue }
      $x = Post $forms[$f] '' 25; $ms = $script:lastMs
      if (-not $x) {
        # no answer in 25 s: this form is not asked again; Tally is started again if it no longer answers the company list
        $dead[$f] = $true
        [pscustomobject]@{ rel = $rel; case = $case; vouchers = $nv; target = $t.name; mid = $t.mid; form = $f; rep = $r; ms = $ms; bytes = 0; vouchers_in_answer = 0; has_target = $false; err = 'NO ANSWER in 25 s' } | Export-Csv $fcsv -Append -NoTypeInformation -Encoding UTF8
        $alive = (Post $listCo '' 10) -match '<COMPANY'
        Say "form $f ($($t.name)): no answer in 25 s; Tally answers the company list after it: $alive"
        if (-not $alive) { Shot "f-hung-$f"; StartW $script:G @($fA) "after-$f" @($co) | Out-Null }
        continue
      }
      $nvch = ([regex]::Matches($x, '<VOUCHER[ >]')).Count
      $hit = $x -match "<MASTERID[^>]*>\s*$($t.mid)\s*<"
      $err = [regex]::Match($x, '<LINEERROR>[^<]*|<ERRORMSG>[^<]*|Unknown Request[^<]*|Could not[^<]*|<ERROR>[^<]*').Value
      [pscustomobject]@{ rel = $rel; case = $case; vouchers = $nv; target = $t.name; mid = $t.mid; form = $f; rep = $r; ms = $ms; bytes = $x.Length; vouchers_in_answer = $nvch; has_target = $hit; err = $err } | Export-Csv $fcsv -Append -NoTypeInformation -Encoding UTF8
      if ($r -eq 0 -and $keep) { $k = if ($x.Length -gt 3000000) { $x.Substring(0, 3000000) } else { $x }; Set-Content (Join-Path $cap "fast-$($t.name)-$f.xml") $k -Encoding UTF8 }
      if ($r -ge 1) { $res[$f] += $ms }
      Start-Sleep -Milliseconds 200
    }
  }
  $line = foreach ($f in $res.Keys) { $s = @($res[$f] | Sort-Object); if ($s.Count) { "$f median $($s[[int][math]::Floor(($s.Count - 1) / 2)]) worst $($s[-1])" } }
  Say "MEASURE $case $($t.name) ($nv vouchers, MasterID $($t.mid)): $($line -join '; ') ms"
}

# ---------------------------------------------------------------- run
$fA = $script:folder; $script:co = $co
try {
  $G = "$W\grow"; $script:G = $G; Copy-Item $light $G -Recurse
  if (StartW $G @($fA) 'setup' @($co)) {
    ImpMasters @(LightMasters) 'light masters'
    ImpMasters (HeavyMasters 300 300) 'base masters'
    if ($env:PD_MODE -eq 'fast234p') {
      GrowTo 4000; $ts = Targets 'P'
      if (StartW $G @($fA) 'p-4000' @($co)) { $nv = Sizes 'p 4000'; foreach ($t in $ts) { FMeasure 'p4000' $t $nv 3 $true } }
    } else {
      $tsAll = @()
      foreach ($n in 4000, 25000, 40000, 100000) {
        if (-not (Cos)) { if (-not (StartW $G @($fA) "m-$n-reopen" @($co))) { Say "HARNESS: the company did not open at $n"; break } }
        GrowTo $n; $ts = Targets "M$n"
        if (-not (StartW $G @($fA) "m-$n" @($co))) { Say "HARNESS: the company did not open for $n"; break }
        $nv = Sizes "m $n"
        FMeasure "m$n" $ts[0] $nv 5 ($n -eq 4000)
        FMeasure "m$n" $ts[1] $nv 5 ($n -eq 4000)
      }
    }
  }
} catch { Say "HARNESS: fast234 stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
if (Test-Path $W) { Remove-Item $W -Recurse -Force -ErrorAction SilentlyContinue }
Say "done (fast234 $env:PD_MODE)"
