# why22.ps1 - MEASUREMENT ONLY (branch why22), dot-sourced by pushm.ps1 when PD_MODE=why22, right after Tally is
# installed and flow.ps1 made "FinCom Spike Co" (nothing else of pushm.ps1 runs). The owner's question of 07-Oct-2026:
# why does one entry take 2.2 s on NWS144 (GARG SHEKHAR & COMPANY, MasterIDs up to ~25,700, a second company of 40,000+
# entries open in the same Tally, data on \\nws144\data$) when a small company took 0.07 s on the test machine?
# Each case: Tally started on that data, then the three requests for ONE voucher, round-robin, a warm-up (rep 0) and
# $reps timed reps each, from this script (HTTP round trip to 127.0.0.1:9000, no bridge, no proxy):
#   bymaster  the bridge's FinComVoucherByMaster byte for byte (why22-bymaster.xml: voucherByMasterRequest of
#             origin/tax-accuracy b1e5858, dumped by a Go test; only company, date and MasterID substituted)
#   objid     the object export, ID "ID:<MasterID>" (the keyed lookup of run 37591395905), the bridge's field list
#   daybook   the Day Book report for the voucher's day (Export Data)
# The target is a 3-item sales invoice dated 1-Oct-2026, imported last (the newest voucher, alone on its day with the other
# targets: the bulk vouchers live on April-September dates). Factors:
#   F1 one company, N vouchers (N = 500, 4,000, 10,000, 25,000 grown in place; 300 ledgers + 300 items); 4,000 + 20,000
#      extra masters; and the 40,000-voucher second company on its own
#   F2 the 4,000 company alone / with the 40,000-voucher company also loaded (second Load line)
#   F3 the 4,000 company's folder: local / \\localhost\why22 (New-SmbShare) / a drive letter mapped to it / the share
#      with another process holding every company file open read-write through the share (a stand-in for a second user)
#   MasterID: counts and MasterID ranges of masters and vouchers; a ledger created after the vouchers; a voucher deleted
#      and one created (is a MasterID reused?)
# Outputs in $out: why22.csv (every request), why22-sizes.csv, why22-mid.txt, summary.txt.
$wcsv = Join-Path $out 'why22.csv'; $wsz = Join-Path $out 'why22-sizes.csv'; $wmid = Join-Path $out 'why22-mid.txt'
$W = "$env:RUNNER_TEMP\why22"; if (Test-Path $W) { Remove-Item $W -Recurse -Force }; New-Item -ItemType Directory -Force $W | Out-Null
$coA = $co; $coB = 'VMS Big Co'
$tplBM = [IO.File]::ReadAllText("$here\why22-bymaster.xml").Trim()
$bmFetch = [regex]::Match($tplBM, '<FETCH>([^<]+)</FETCH>').Groups[1].Value
Say "why22 on TallyPrime ${rel}: reps $reps; the bridge's request template $($tplBM.Length) chars, $(($bmFetch -split ',').Count) fields"

function ReqBM($c, $date, $mid) { $tplBM.Replace('@@CO@@', [Security.SecurityElement]::Escape($c)).Replace('20991231', $date).Replace('987654321', "$mid") }
function ReqObj($c, $mid) {
  $fl = ($bmFetch -split ',\s*' | ForEach-Object { "<FETCH>$_</FETCH>" }) -join ''
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:' + $mid + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + [Security.SecurityElement]::Escape($c) + '</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST>' + $fl + '</FETCHLIST></DESC></BODY></ENVELOPE>'
}
function ReqDay($c, $date) { '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + [Security.SecurityElement]::Escape($c) + "</SVCURRENTCOMPANY><SVFROMDATE>$date</SVFROMDATE><SVTODATE>$date</SVTODATE><SVCURRENTDATE>$date</SVCURRENTDATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>" }

# ---------------------------------------------------------------- Tally on a data folder with these companies loaded
function WIni($data, [string[]]$loads) {
  $l = @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes')
  if ($loads) { $l += 'Default Companies = Yes'; foreach ($x in $loads) { $l += "Load = $x" } } else { $l += 'Default Companies = No' }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  Say "tally.ini: Data $data; Load $(if ($loads) { $loads -join ', ' } else { 'none' })"
}
$listCo = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,GUID,StartingFrom</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
function Cos { $x = Post $listCo '' 60; return @([regex]::Matches($x, '<COMPANY NAME="([^"]*)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) }) }
function StartW($data, [string[]]$loads, $tag, [string[]]$want) {
  Stop-T; WIni $data $loads
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $p.Id
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {}; if ($p.HasExited) { break } }
  Start-Sleep 5
  KeysTo 'a' 4; KeysTo 't' 8 "w-$tag-started"
  $have = @(); $ok = $false
  for ($w = 0; $w -lt 30 -and -not $ok; $w++) {
    $have = Cos; $ok = (@($want | Where-Object { $_ -notin $have }).Count -eq 0)
    if (-not $ok) { if ($w -eq 10 -or $w -eq 20) { KeysTo '{ENTER}' 6 "w-$tag-key-$w" } else { Start-Sleep 3 } }
  }
  Say "Tally started ($tag) in $([math]::Round($sw.Elapsed.TotalSeconds,1)) s; companies open: $($have -join ' | '); wanted all of: $($want -join ' | ') -> $ok"
  return $ok
}
function UseCo($c) { $script:co = $c }

# ---------------------------------------------------------------- the companies' contents
function WhyMasters($nLed, $nItem) { HeavyMasters $nLed $nItem }
function ExtraMasters($n) {
  $m = @(); $h = [int]($n / 2)
  for ($i = 1; $i -le $h; $i++) { $m += LedgerXml ('XLed {0:d5}' -f $i) 'Sundry Creditors' }
  for ($i = 1; $i -le $n - $h; $i++) { $m += ItemXml ('XItem {0:d5}' -f $i) $false }
  return $m
}
$wDates = HeavyDates
# HeavyVoucher without the godown (this company has none)
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
$script:made = @{}
function GrowTo($c, $n) {
  if (-not $script:made.ContainsKey($c)) { $script:made[$c] = 0 }
  for ($k = $script:made[$c]; $k -lt $n; $k += 1000) {
    $hi = [math]::Min($k + 1000, $n); $b = @(); for ($j = $k; $j -lt $hi; $j++) { $b += WhyVoucher $j }
    Imp 'Vouchers' $b "$c vouchers $k-$($hi - 1)" | Out-Null
  }
  $script:made[$c] = $n
}
# the target: a 3-item sales invoice on 1-Oct-2026 (no bulk voucher lives there), the newest voucher
function NewTarget($tag) {
  $narr = "why22 target $tag"
  $r = Imp 'Vouchers' @(SalesXml '20261001' "WT-$tag" 'HParty 00001' @('HItem 00001', 'HItem 00002', 'HItem 00003') $narr $false) "target $tag"
  $script:lastVchId = [regex]::Match($r.raw, '<LASTVCHID>\s*(\d+)').Groups[1].Value
  return FindTarget $tag
}
# run 37614517809: a $Narration filter found nothing; the October vouchers (the filter OctVouchers uses) are read and the
# target picked here by its narration; the import's LASTVCHID is kept beside it
function FindTarget($tag) {
  $x = Post (Coll 'FCPTgt' 'Voucher' 'GUID, MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION' '$Date >= $$Date:"01-10-2026"') '' 600
  $m = @([regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>') | Where-Object { $_.Value -match "<NARRATION[^>]*>why22 target $tag<" } | Select-Object -First 1).Value
  $t = [pscustomobject]@{ tag = $tag; mid = [regex]::Match("$m", '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; date = [regex]::Match("$m", '<DATE[^>]*>(\d{8})').Groups[1].Value; vno = [regex]::Match("$m", '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value }
  Say "target $tag ($script:co): MasterID $($t.mid), date $($t.date), number $($t.vno) (October vouchers in Tally: $(([regex]::Matches($x, '<VOUCHER[ >]')).Count); the import's LASTVCHID $script:lastVchId)"
  if (-not $t.mid -and $script:lastVchId) { $t.mid = $script:lastVchId; $t.date = '20261001'; Say "target ${tag}: MasterID taken from LASTVCHID" }
  return $t
}
# count, lowest and highest MasterID of one object type (the whole collection, MASTERID only)
function MidStats($type) {
  $x = Post (Coll "FCPMid$type" $type 'MASTERID') '' 900
  $ids = @([regex]::Matches($x, '<MASTERID[^>]*>\s*(\d+)') | ForEach-Object { [int64]$_.Groups[1].Value })
  if (-not $ids.Count) { return [pscustomobject]@{ type = $type; n = 0; min = ''; max = '' } }
  $s = $ids | Measure-Object -Minimum -Maximum
  return [pscustomobject]@{ type = $type; n = $ids.Count; min = $s.Minimum; max = $s.Maximum }
}
function Sizes($case, $data) {
  $o = [ordered]@{ rel = $rel; case = $case; company = $script:co }
  foreach ($t in 'Voucher', 'Ledger', 'StockItem', 'Group', 'VoucherType', 'StockGroup', 'Unit', 'CostCentre') { $s = MidStats $t; $o["n_$t"] = $s.n; $o["minmid_$t"] = $s.min; $o["maxmid_$t"] = $s.max }
  $o.folder_mb = try { [math]::Round(((Get-ChildItem $data -Recurse -File -ErrorAction Stop | Measure-Object Length -Sum).Sum) / 1MB, 1) } catch { '' }
  $tp = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $o.tally_ws_mb = if ($tp) { [math]::Round($tp.WorkingSet64 / 1MB) } else { '' }
  [pscustomobject]$o | Export-Csv $wsz -Append -NoTypeInformation -Encoding UTF8
  Say "sizes $case ($script:co): vouchers $($o.n_Voucher) (MasterID $($o.minmid_Voucher)-$($o.maxmid_Voucher)), ledgers $($o.n_Ledger) ($($o.minmid_Ledger)-$($o.maxmid_Ledger)), items $($o.n_StockItem) ($($o.minmid_StockItem)-$($o.maxmid_StockItem)), groups $($o.n_Group) ($($o.minmid_Group)-$($o.maxmid_Group)), voucher types $($o.n_VoucherType) ($($o.minmid_VoucherType)-$($o.maxmid_VoucherType)); folder $($o.folder_mb) MB; Tally $($o.tally_ws_mb) MB"
}

# ---------------------------------------------------------------- one case: the three requests, round-robin
function WMeasure($factor, $case, $t, $nv, $nm) {
  if (-not $t -or -not $t.mid) { Say "measure $factor/${case}: no target: skipped"; return }
  $forms = [ordered]@{ bymaster = (ReqBM $script:co $t.date $t.mid); objid = (ReqObj $script:co $t.mid); daybook = (ReqDay $script:co $t.date) }
  if ($factor -eq 'F1' -and $case -eq '500') { foreach ($f in $forms.Keys) { Set-Content (Join-Path $cap "why22-request-$f.xml") $forms[$f] -Encoding UTF8 } }
  $res = @{}; foreach ($f in $forms.Keys) { $res[$f] = @() }
  for ($r = 0; $r -le $reps; $r++) {
    foreach ($f in $forms.Keys) {
      $tp = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $cpu0 = if ($tp) { $tp.TotalProcessorTime.TotalMilliseconds } else { 0 }
      $x = Post $forms[$f] '' 300; $ms = $script:lastMs
      $tp = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue; $cpu = if ($tp) { [math]::Round($tp.TotalProcessorTime.TotalMilliseconds - $cpu0) } else { '' }
      $nvch = ([regex]::Matches($x, '<VOUCHER[ >]')).Count
      $hit = $x -match "<MASTERID[^>]*>\s*$($t.mid)\s*<"
      $err = [regex]::Match($x, '<LINEERROR>[^<]*|Unknown Request[^<]*|Could not[^<]*').Value
      [pscustomobject]@{ rel = $rel; factor = $factor; case = $case; company = $script:co; vouchers = $nv; masters = $nm; mid = $t.mid; form = $f; rep = $r; ms = $ms; tally_cpu_ms = $cpu; bytes = $x.Length; vouchers_in_answer = $nvch; has_target = $hit; err = $err } | Export-Csv $wcsv -Append -NoTypeInformation -Encoding UTF8
      if ($r -eq 1) { $keep = if ($x.Length -gt 400000) { $x.Substring(0, 400000) } else { $x }; Set-Content (Join-Path $cap "why22-$factor-$case-$f.xml") $keep -Encoding UTF8 }
      if ($r -ge 1) { $res[$f] += $ms }
      Start-Sleep -Milliseconds 300
    }
  }
  $line = foreach ($f in $forms.Keys) { $s = @($res[$f] | Sort-Object); if ($s.Count) { "$f median $($s[[int][math]::Floor(($s.Count - 1) / 2)]) worst $($s[-1]) ms" } }
  Say "MEASURE $factor/$case ($script:co, $nv vouchers, $nm masters, target $($t.mid)): $($line -join '; ')"
}

# ---------------------------------------------------------------- run
$fA = $script:folder
try {
  # ---- F1: one company grown in place
  $G = "$W\grow"; Copy-Item $light $G -Recurse
  UseCo $coA
  if (StartW $G @($fA) 'grow-setup' @($coA)) {
    ImpMasters @(LightMasters) 'light masters'
    ImpMasters (WhyMasters 300 300) 'base masters'
    Sizes 'masters only' $G
    foreach ($n in 0, 500, 4000, 10000, 25000) {
      if (-not (Cos)) { if (-not (StartW $G @($fA) "grow-$n-reopen" @($coA))) { Say "HARNESS: grow company did not open at $n"; break } }
      GrowTo $coA $n; $t = NewTarget "A$n"
      if ($n -eq 500) {
        # MasterID: one counter for masters and vouchers? a ledger made now, a voucher deleted and one made
        $lx = Imp 'All Masters' @(LedgerXml 'Why22 Probe Ledger' 'Sundry Creditors') 'probe ledger after the vouchers'
        $lm = [regex]::Match((Post (Coll 'FCPProbeL' 'Ledger' 'NAME, MASTERID' '$Name = "Why22 Probe Ledger"')), '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
        $before = MidStats 'Voucher'
        $dd = $wDates[4]; $dt = [DateTime]::ParseExact($dd, 'yyyyMMdd', $null)
        $d = Imp 'Vouchers' @('<VOUCHER DATE="' + $dt.ToString('d-MMM-yyyy', [Globalization.CultureInfo]::InvariantCulture) + '" TAGNAME="Voucher Number" TAGVALUE="HJ-000004" VCHTYPE="Journal" ACTION="Delete"><DATE>' + $dd + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>HJ-000004</VOUCHERNUMBER></VOUCHER>') "delete HJ-000004 ($dd)"
        if ($d.errors) { $d = Imp 'Vouchers' @('<VOUCHER DATE="' + $dd + '" TAGNAME="Voucher Number" TAGVALUE="HJ-000004" VCHTYPE="Journal" ACTION="Delete"><DATE>' + $dd + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>HJ-000004</VOUCHERNUMBER></VOUCHER>') "delete HJ-000004 ($dd, yyyymmdd)" }
        $mid1 = MidStats 'Voucher'
        $t2 = NewTarget 'A500b'
        $mid2 = MidStats 'Voucher'
        $txt = @("TallyPrime $rel", "vouchers before: n $($before.n), MasterID $($before.min)-$($before.max); probe ledger made after them: MasterID $lm",
          "delete HJ-000004: Tally said created $($d.created) errors $($d.errors) $([regex]::Match($d.raw, '<DELETED>\d+').Value) $([regex]::Match($d.raw, '<LINEERROR>[^<]*').Value); vouchers after: n $($mid1.n), MasterID $($mid1.min)-$($mid1.max)",
          "a voucher made after that: MasterID $($t2.mid); vouchers now n $($mid2.n), MasterID $($mid2.min)-$($mid2.max)")
        Add-Content $wmid $txt -Encoding UTF8; $txt | ForEach-Object { Say "mid: $_" }
      }
      Stop-T
      if (-not (StartW $G @($fA) "grow-$n" @($coA))) { Say "HARNESS: grow company did not open for $n"; break }
      Sizes "F1 $n" $G
      WMeasure 'F1' "$n" $t $n 600
      if ($n -eq 4000) { Stop-T; New-Item -ItemType Directory -Force "$W\s4k" | Out-Null; Copy-Item "$G\$fA" "$W\s4k\$fA" -Recurse; $tA4 = $t; Say "snapshot of the 4,000 company: $W\s4k\$fA" }
    }
  }
  Stop-T
  if (Test-Path $G) { Remove-Item $G -Recurse -Force -ErrorAction SilentlyContinue }

  # ---- the second company: made on screen in an empty folder, 40,000 vouchers
  $B = "$W\big"; New-Item -ItemType Directory -Force $B | Out-Null
  UseCo $coB
  Stop-T; WIni $B @()
  $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $p.Id
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'w-big-edu'
  KeysTo '{ENTER}' 5 'w-big-create'; KeysTo $coB 2 'w-big-name'; KeysTo '^a' 8 'w-big-ctrla'
  $have = (Cos) -contains $coB; $n = 4
  foreach ($k in @('y', '^a', '{ENTER}', 'y', '{ESC}', 'y')) { if ($have) { break }; KeysTo $k 6 ("w-big-{0}" -f $n); $have = (Cos) -contains $coB; $n++ }
  $fB = (Get-ChildItem $B -Directory | Where-Object { $_.Name -match '^\d+$' } | Select-Object -First 1).Name
  Say "second company '$coB' made on screen: $have; folder $B\$fB"
  if ($have) {
    ImpMasters @(LightMasters) 'B light masters'; ImpMasters (WhyMasters 300 300) 'B base masters'
    GrowTo $coB 40000; $tB = NewTarget 'B40000'
    if (StartW $B @($fB) 'big-alone' @($coB)) { Sizes 'F1 40000 (second company alone)' $B; WMeasure 'F1' '40000-second-co' $tB 40000 600 }
  }
  Stop-T

  # ---- F1: 4,000 vouchers + 20,000 extra masters
  if ($tA4) {
    UseCo $coA
    $M = "$W\m4k"; New-Item -ItemType Directory -Force $M | Out-Null; Copy-Item "$W\s4k\$fA" "$M\$fA" -Recurse
    if (StartW $M @($fA) 'm4k-setup' @($coA)) {
      ImpMasters (ExtraMasters 20000) 'extra masters'
      if (StartW $M @($fA) 'm4k' @($coA)) { Sizes 'F1 4000 + 20000 masters' $M; WMeasure 'F1' '4000+20000masters' $tA4 4000 20600 }
    }
    Stop-T; Remove-Item $M -Recurse -Force -ErrorAction SilentlyContinue

    # ---- F2 / F3 local: the 4,000 company alone
    if (StartW "$W\s4k" @($fA) 's4k-local' @($coA)) { Sizes 'F2/F3 4000 local alone' "$W\s4k"; WMeasure 'F2' '4000-alone' $tA4 4000 600 }
    # ---- F2: with the 40,000 company loaded too (its folder copied in under another number)
    if ($fB) {
      $X = "$W\multi"; New-Item -ItemType Directory -Force $X | Out-Null
      Stop-T; Copy-Item "$W\s4k\$fA" "$X\$fA" -Recurse
      $fB2 = if ($fB -eq $fA) { "$([int]$fA + 1)" } else { $fB }
      Copy-Item "$B\$fB" "$X\$fB2" -Recurse
      Say "multi folder: $fA ($coA), $fB2 ($coB, copied from $fB)"
      if (StartW $X @($fA, $fB2) 'multi' @($coA, $coB)) {
        UseCo $coA; WMeasure 'F2' '4000-with-40000-loaded' $tA4 4000 600
        UseCo $coB; WMeasure 'F2' '40000-with-4000-loaded' $tB 40000 600
        UseCo $coA
      } else {
        # the copy under another number did not open: say what Tally listed, and try the order reversed
        Shot 'w-multi-fail'
        if (StartW $X @($fB2, $fA) 'multi-rev' @($coA, $coB)) { UseCo $coA; WMeasure 'F2' '4000-with-40000-loaded' $tA4 4000 600 }
      }
      Stop-T; Remove-Item $X -Recurse -Force -ErrorAction SilentlyContinue
    }
    UseCo $coA
    # ---- F3: SMB share on this runner
    $sh = $null
    try { & icacls.exe "$W\s4k" /grant 'Everyone:(OI)(CI)F' /T /Q | Out-Null; $sh = New-SmbShare -Name 'why22' -Path "$W\s4k" -FullAccess 'Everyone' -ErrorAction Stop; Say "SMB share \\localhost\why22 -> $W\s4k" } catch { Say "HARNESS: New-SmbShare failed: $_" }
    if ($sh) {
      $unc = '\\localhost\why22'
      Say "share check: $(@(Get-ChildItem "$unc\$fA" -ErrorAction SilentlyContinue).Count) files seen through $unc\$fA"
      if (StartW $unc @($fA) 'smb-unc' @($coA)) { WMeasure 'F3' '4000-smb-unc' $tA4 4000 600; Get-SmbConnection -ErrorAction SilentlyContinue | Out-String | ForEach-Object { Say "smb connection: $($_ -replace '\s+', ' ')" } }
      Stop-T
      & net.exe use W: $unc /persistent:no 2>&1 | ForEach-Object { Say "net use: $_" }
      if (Test-Path 'W:\') { if (StartW 'W:\' @($fA) 'smb-drive' @($coA)) { WMeasure 'F3' '4000-smb-mapped-drive' $tA4 4000 600 } }
      Stop-T; & net.exe use W: /delete /y 2>&1 | Out-Null
      # the share with a second opener: another process holds every company file open read-write through the share
      if (StartW $unc @($fA) 'smb-held' @($coA)) {
        $hs = Join-Path $out 'why22-holder.txt'
        $holdCmd = "`$n=0; `$fs=@(); Get-ChildItem '$unc\$fA' -File | ForEach-Object { try { `$fs += [IO.File]::Open(`$_.FullName, 'Open', 'ReadWrite', 'ReadWrite'); `$n++ } catch { Add-Content '$hs' (`"no: `" + `$_.Exception.Message) } }; Add-Content '$hs' (`"held `" + `$n); Start-Sleep 3600"
        $holder = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList '-NoProfile', '-Command', $holdCmd -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $out 'why22-holder-err.txt')
        for ($i = 0; $i -lt 30 -and -not (Select-String -Path $hs -Pattern '^held' -Quiet -ErrorAction SilentlyContinue); $i++) { Start-Sleep 2 }; Say "holder: $((Get-Content $hs -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' / ')"
        WMeasure 'F3' '4000-smb-unc-second-opener' $tA4 4000 600
        Stop-Process -Id $holder.Id -Force -ErrorAction SilentlyContinue
      }
      Stop-T
      Remove-SmbShare -Name 'why22' -Force -ErrorAction SilentlyContinue
    }
  } else { Say 'HARNESS: no 4,000 company snapshot: F1 masters, F2 and F3 skipped' }
} catch { Say "HARNESS: why22 stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Get-ChildItem $dir -Recurse -File -Include *.log, tdlerr*, *.err -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "tally-$($_.Name)") -ErrorAction SilentlyContinue }
Say 'done (why22)'
