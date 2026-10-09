# dsrcv.ps1 - mode "dsrc" (bridge 2.4.1, the owner's approval of 09-Oct-2026): one company in two data folders. dpathv.ps1's
# two-folder setup (the same company folder in $data1 = D:\a\_temp\TallyData\<n> and, copied with Tally closed, in
# $data2 = TallyData2\<n>), the bridge built from the ref (bridge_ref=next-241) with stubds.py as the cloud (it plays
# tally-ingest's data locations: the first own location named is chosen by itself; the harness can choose another) and
# proxy235.py between the bridge and Tally (every request the bridge sends Tally, logged). Dot-sourced by flowv.ps1 twice:
#   $dsPhase = 'seed' (before the bridge is installed): the voucher type 'D4 Manual' (manual numbers, duplicates allowed)
#     by XML; Tally closed; folder 2 copied from folder 1; Tally started again on folder 1; the proxy started
#   $dsPhase = 'run' (after the bridge started):
#   d1  a Receipt by keys in folder 1 (the bridge's own Tally): applied with its body; the add-on's line carries dp= of
#       folder 1 and the stub's line data_id = the data id of folder 1 (sha256 of the case-folded path, 16 hex)
#   d4  item 5, the fallback by number on real vouchers (imported by XML: no add-on line) whose MasterID answer is wrong:
#       the harness writes the add-on's pair of lines (pre / post, folder 1's dp= and w=) with the MasterID of an older
#       entry (below the starting point). Educational mode takes only the 1st, 2nd and 31st of a month, so the vouchers
#       are dated 2-10-2026; the starting point's recorded day in start-point.json is moved back to 1-10-2026 (its numbers
#       kept: the bridge's own) so the request's day is not before the starting day. Before that move, one line shows the
#       guard's own words (item 6). Cases: ONE (one voucher with the number: taken), TWO (two vouchers with the number:
#       held), NONE (no voucher with the number: held); each asked once by FinComVoucherByNumber, answered within 2 s
#   d2  one Tally, one folder at a time: Tally closed and started on folder 2; a Receipt by keys: never fetched (no voucher
#       request for it at the proxy), never applied; the stub gets 'other_source' with folder 2's data id and no body
#   d2b two Tallys at once (a second instance of the install, port 9001, folder 2) beside Tally on folder 1: a Receipt by
#       keys in each; folder 2's as d2, folder 1's applied
#   d3  the owner chooses folder 2 (the stub's choice): the bridge stops reading folder 1; Tally on folder 2: its new saves
#       applied (the stub records a fresh starting point at the first beat that names folder 2 as the bridge's own); Tally
#       on folder 1 again: its save sent as other_source and held, never fetched
#   d3b (MEASURE only) folder 2 chosen, Tally on folder 1 and the second instance on folder 2: what the bridge does with a
#       save in the second instance
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$num = $folder.Name
$data2 = "$env:RUNNER_TEMP\TallyData2"
$f1 = Join-Path $data1 $num; $f2 = Join-Path $data2 $num
function DsNorm([string]$p) { $p.Trim().TrimEnd('\', '/', ' ').ToLowerInvariant() }
function DataId([string]$p) {
  $n = DsNorm $p; if (-not $n) { return '' }
  $h = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($n))
  (($h | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
}
function DsSE([string]$s) { [Security.SecurityElement]::Escape($s) }
function DsIni([string]$cfgDir, [string]$data, [int]$port) {
  $l = @('[Tally]', "Data = $data", "Config = $cfgDir", "LangPath = $cfgDir\lang", 'Client Server = Both', "ServerPort = $port", 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $num", "TDL = $tdl")
  Set-Content -Path (Join-Path $cfgDir 'tally.ini') -Value $l -Encoding ASCII
}
function DsPost([int]$port, [string]$body, [int]$timeout = 30) {
  try { return (Invoke-WebRequest "http://localhost:$port" -Method Post -Body $body -ContentType 'text/xml;charset=utf-8' -UseBasicParsing -TimeoutSec $timeout).Content } catch { Write-Host "[dsrc post $port] $($_.Exception.Message)"; return '' }
}
function DsCoUp([int]$port) { "$(DsPost $port $listCoXml)" -match [regex]::Escape($co1) }
# the start screens (bankv / dpathv's answers), the window of $script:tpid
function DsScreens([string]$tag) {
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10
  for ($s = 0; $s -lt 5; $s++) {
    $t = TdsScreen "$tag-start-$s"
    if ($t -match 'Press any key') { KeysTo '{ENTER}' 3; continue }
    if ($t -match 'Activate License|Serial Number') { KeysTo '{ESC}' 3; continue }
    if ($t -match 'Try It For Free|Welcome to TallyPrime') { KeysTo 't' 8; continue }
    if ($t -match 'Startup Report|Application Startup') { KeysTo '^a' 5; continue }
    if ($t -match 'Internal Error') { KeysTo '{ENTER}' 3; continue }
    break
  }
}
# Tally (port 9000, the bridge's own) started again on a data folder; the proxy stopped first and started after (s235)
function DsTally([string]$data, [string]$tag) {
  if (Get-Command Stop-S235Proxy -ErrorAction SilentlyContinue) { Stop-S235Proxy }
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  DsIni $dir $data 9000
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  $up = $false; for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://127.0.0.1:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; $up = $true; break } catch {} }
  DsScreens "ds-$tag"
  $co = DsCoUp 9000
  $ok = $true; if (Get-Command Start-S235Proxy -ErrorAction SilentlyContinue) { $ok = Start-S235Proxy }
  Info "dsrc ${tag}: Tally (port 9000) started on $data (pid $($script:tpid)): port up $up, '$co1' loaded $co, proxy $ok"
  return ($up -and $co -and $ok)
}
# a second instance of the installed Tally (its own folder and tally.ini, port 9001) on a data folder
$script:t2pid = 0; $dir2 = 'C:\fcspike\tally2'
function DsTally2([string]$data, [string]$tag) {
  if ($script:t2pid) { Stop-Process -Id $script:t2pid -Force -ErrorAction SilentlyContinue; Start-Sleep 3 }
  if (-not (Test-Path (Join-Path $dir2 (Split-Path $exe -Leaf)))) { & robocopy.exe $dir $dir2 /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null }
  DsIni $dir2 $data 9001
  $exe2 = Join-Path $dir2 (Split-Path $exe -Leaf)
  $t = Start-Process -FilePath $exe2 -WorkingDirectory $dir2 -PassThru; $script:t2pid = $t.Id
  $up = $false; for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://127.0.0.1:9001' -UseBasicParsing -TimeoutSec 5 | Out-Null; $up = $true; break } catch {}; if ($t.HasExited) { break } }
  $keep = $script:tpid; $script:tpid = $script:t2pid
  if (-not $t.HasExited) { DsScreens "ds-$tag" }
  $script:tpid = $keep
  $co = DsCoUp 9001
  Info "dsrc ${tag}: a second Tally ($exe2, port 9001) started on $data (pid $($script:t2pid)): exited $($t.HasExited), port up $up, '$co1' loaded $co; Tally on 9000 still up: $(DsCoUp 9000)"
  return ($up -and $co)
}
function DsVAll([int]$port = 9000) {
  $x = DsPost $port ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCDA</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (DsSE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCDA" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, NARRATION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  $l = @()
  try { $d = [xml]($x -replace '&#4;', '')
    foreach ($v in $d.ENVELOPE.BODY.DATA.COLLECTION.VOUCHER) { $l += [pscustomobject]@{ guid = Val $v.GUID; mid = [int](Val $v.MASTERID); aid = [int](Val $v.ALTERID); vno = Val $v.VOUCHERNUMBER; type = Val $v.VOUCHERTYPENAME; date = Val $v.DATE; narr = Val $v.NARRATION } }
  } catch { Write-Host "DsVAll parse: $_" }
  return , $l
}
# a Receipt by keys in the Tally of $tp (its window), the new voucher in that Tally
function DsReceipt([string]$tag, [int]$amt, [int]$port = 9000, [int]$tp = 0) {
  $keep = $script:tpid; if ($tp) { $script:tpid = $tp }
  try {
    $null = TdsGateway "before $tag"
    $b = DsVAll $port
    KeysTo 'v' 4 "ds-$tag-vouchers"; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo '2-10-2026{ENTER}' 3
    KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3; KeysTo "$amt{ENTER}" 3; KeysTo '^a' 0
    $script:dsSaved = Get-Date; $script:dsSavedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Start-Sleep 5; Shot "ds-$tag-saved"
    $null = TdsGateway "after $tag"
    $a = DsVAll $port
  } finally { $script:tpid = $keep }
  $n = @(foreach ($v in $a) { if ("$($v.mid)" -notin @($b | ForEach-Object { "$($_.mid)" })) { $v } })
  if ($n.Count) { Info "dsrc ${tag}: Tally (port $port) made Receipt no $($n[0].vno) of $($n[0].date) mid $($n[0].mid) AlterID $($n[0].aid) guid $($n[0].guid)"; return $n[0] }
  Info "dsrc ${tag}: the keys made no Receipt in Tally (port $port)"; return $null
}
# every FCR1 line of the add-on's files (read with a shared open: Tally may hold a file)
function DsRec {
  $all = @()
  foreach ($f in @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
    for ($t = 0; $t -lt 40; $t++) {
      try { $fs = [IO.FileStream]::new($f.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $sr = [IO.StreamReader]::new($fs, [Text.Encoding]::Unicode, $true); $txt = $sr.ReadToEnd() } finally { $fs.Dispose() }
        $all += @($txt -split "`r?`n" | Where-Object { $_ -like 'FCR1|*' } | ForEach-Object { [pscustomobject]@{ file = $f.Name; l = $_ } }); break
      } catch { Start-Sleep -Milliseconds 50 } }
  }
  return , $all
}
function LF([string]$l, [string]$k) { [regex]::Match($l, "\|$k=([^|]*)").Groups[1].Value }
function DsPostLine($v) { @((DsRec) | Where-Object { $_.l -like 'FCR1|ev=voucher_accept_post|*' -and (LF $_.l 'mid') -eq "$($v.mid)" -and (LF $_.l 'vno') -eq "$($v.vno)" }) | Select-Object -Last 1 }
function DsProxy { if (Test-Path $proxyLog) { return , @(Get-Content $proxyLog -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.t0 }) }; return , @() }
# the stub's answer state of each line id
function DsStates { $m = @{}; foreach ($r in (StubReqs)) { if ($r.kind -eq 'recorder_lines') { foreach ($x in @($r.answer.results)) { if ($x) { $m["$($x.line_id)"] = "$($x.state)" } } } }; return $m }
function DsLineTxt($x, $st) { if (-not $x) { return '(no line)' }; "stub {0} event={1}{2} guid='{3}' mid='{4}' vch={5} data_id='{6}' data_path='{7}' w='{8}' body={9} answer={10}{11}" -f $x.at, $x.ev, $(if ($x.raw.of) { " of=$($x.raw.of)" }), $x.guid, $x.mid, $x.vch, $x.raw.data_id, $x.raw.data_path, $x.raw.w, $(if ($x.xml) { "yes($($x.xml.Length) chars)" } else { 'none' }), $st["$($x.raw.line_id)"], $(if ($x.raw.heldWhy) { " held='$($x.raw.heldWhy)'" }) }
# voucher requests at the proxy for one voucher (its MasterID, or its number by FinComVoucherByNumber) after a time
function DsAsks($v, [int64]$fromMs, [int64]$toMs = [int64]::MaxValue) { @((DsProxy) | Where-Object { [int64]$_.t0 -ge $fromMs -and [int64]$_.t0 -le $toMs -and "$($_.id)" -match 'FinComVoucher' -and ("$($_.mid)" -eq "$($v.mid)" -or ("$($_.id)" -eq 'FinComVoucherByNumber' -and "$($_.vno)" -eq "$($v.vno)")) }) }
function DsData { try { Get-Content (Join-Path $h1 'sync\recorder-data.json') -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
function DsBlog { if (Test-Path $blog) { return , @(Get-Content $blog -Encoding UTF8) }; return , @() }

# ================================================================ seed
if ($dsPhase -eq 'seed') {
  Say '---- dsrc seed: the D4 voucher type, folder 2 copied from folder 1, Tally on folder 1'
  $vt = Imp 'All Masters' '<VOUCHERTYPE NAME="D4 Manual" ACTION="Create"><NAME.LIST><NAME>D4 Manual</NAME></NAME.LIST><PARENT>Journal</PARENT><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD><PREVENTDUPLICATES>No</PREVENTDUPLICATES><ISACTIVE>Yes</ISACTIVE><AFFECTSSTOCK>No</AFFECTSSTOCK></VOUCHERTYPE>' 'dsrc voucher type'
  Info "dsrc: voucher type 'D4 Manual' (manual numbering, duplicates allowed): $(([regex]::Match("$vt", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')$(if ("$vt" -match '<LINEERROR>([^<]*)') { ' ' + $matches[1] })"
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 4
  New-Item -ItemType Directory -Force $data2 | Out-Null
  Copy-Item -Path $f1 -Destination $data2 -Recurse -Force
  Info "dsrc: folder 2 made: $f2 ($(@(Get-ChildItem $f2 -File -ErrorAction SilentlyContinue).Count) files; folder 1 $(@(Get-ChildItem $f1 -File).Count) files); data ids: folder 1 $(DataId $f1), folder 2 $(DataId $f2)"
  . (Join-Path $PSScriptRoot 's235proxy.ps1')
  $script:tpid = 0
  $script:dsUp = DsTally $data1 'seed-f1'
  $seed.TallyHost = '127.0.0.2'; $seed.CloudBeatSec = 5
  return
}

# ================================================================ run
Say '---- dsrc: one company in two data folders (bridge 2.4.1)'
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$script:TdsRestart = { $null = DsTally $script:dsCur 'gw-restart' }
$script:dsCur = $data1
$C1 = 'd1 a save in folder 1 (the bridge''s own Tally): applied, its line with dp= of folder 1'
$C2 = 'd2 a save in folder 2 (one Tally, one folder at a time): never fetched, never applied; other_source with folder 2''s data id, no body'
$C2b = 'd2b a save in folder 2 with two Tallys at once: never fetched, never applied; other_source with folder 2''s data id, no body'
$C3 = 'd3 FinCom chooses folder 2: after a fresh starting point folder 2''s new saves applied, folder 1''s held'
$C4 = 'd4 the fallback by number: asked once, answered within 2 s, taken only when exactly one voucher matches'
$dsDone = @{}
function DRes($c, $st, $ev) { if (-not $dsDone[$c]) { Result $c $st $ev; $dsDone[$c] = $true } }
$id1 = DataId $f1; $id2 = DataId $f2
Info "dsrc: folder 1 $f1 (data id $id1); folder 2 $f2 (data id $id2); bridge $($st.version) on port $bport"
try {
  if ("$($st.version)" -ne '2.4.1') { Info "dsrc: the bridge answers version '$($st.version)' (expected 2.4.1)" }
  # the starting point
  $t = Get-Date; $sp = $false
  while (((Get-Date) - $t).TotalMinutes -lt 5) { if (@((DsBlog) | Where-Object { $_ -match ('Company ' + [regex]::Escape($co1) + ': its starting point is recorded') }).Count) { $sp = $true; break }; Start-Sleep 5 }
  Info "dsrc: the bridge recorded the starting point: $sp"

  # ---------------------------------------------------------------- d1
  $m1 = Mark
  $v1 = DsReceipt 'd1' 711
  if (-not $v1) { DRes $C1 'HARNESS' 'the keys made no Receipt in folder 1' }
  else {
    $w = WaitLine $m1 { $_.guid -eq $v1.guid -and $_.xml } (Get-Date) 120
    Start-Sleep 3
    $pl = DsPostLine $v1; $dp = if ($pl) { LF $pl.l 'dp' } else { '' }
    $sts = DsStates; $x = if ($w.Count) { $w[0] } else { $null }
    $ok = $x -and $pl -and (DsNorm $dp) -eq (DsNorm $f1) -and "$($x.raw.data_id)" -eq $id1 -and $sts["$($x.raw.line_id)"] -eq 'applied'
    DRes $C1 $(if ($ok) { 'PASS' } elseif (-not $pl) { 'HARNESS' } else { 'FAIL' }) ("Receipt no {0} mid {1} guid {2}; the add-on's line: {3}; dp='{4}' (folder 1 '{5}', equal: {6}); {7}; data id expected {8}" -f $v1.vno, $v1.mid, $v1.guid,
      $(if ($pl) { $pl.l.Substring(0, [math]::Min(330, $pl.l.Length)) } else { 'no voucher_accept_post line in the add-on''s files' }), $dp, $f1, ((DsNorm $dp) -eq (DsNorm $f1)), (DsLineTxt $x $sts), $id1)
  }
  # FinCom's choice of folder 1 (the first own location named) reaches the bridge before folder 2 is opened
  $t = Get-Date; $ch1 = ''
  while (((Get-Date) - $t).TotalSeconds -lt 90) { $dd = DsData; if ($dd -and $dd.chosen) { $ch1 = "$(@($dd.chosen.PSObject.Properties | ForEach-Object { $_.Value.id })[0])" }; if ($ch1) { break }; Start-Sleep 3 }
  $cgB = "$(@((StubReqs) | Where-Object { $_.kind -eq 'beat' } | ForEach-Object { @($_.body.dataSources) } | Where-Object { $_ } | ForEach-Object { $_.company_guid }) | Select-Object -Last 1)"
  Info "dsrc: the bridge's recorder-data.json: own / chosen: $((DsData) | ConvertTo-Json -Compress -Depth 4); company GUID in the beat '$cgB'"

  # ---------------------------------------------------------------- d4 (folder 1)
  Say '---- dsrc d4: the fallback by number'
  $all0 = DsVAll 9000
  $old = @($all0 | Where-Object { $_.narr -eq 'renum before the bridge' })[0]
  $tpl = if ($v1) { DsPostLine $v1 } else { $null }
  if (-not $old -or -not $tpl) { DRes $C4 'HARNESS' "no older entry ('renum before the bridge': $([bool]$old)) or no add-on line of d1 to take dp= and w= from ($([bool]$tpl))" }
  else {
    $cg = LF $tpl.l 'cguid'; $dp1 = LF $tpl.l 'dp'; $wu = LF $tpl.l 'w'; $usr = LF $tpl.l 'user'
    $rfile = Join-Path $rec $tpl.file
    function D4Imp([string]$no, [string]$narr) {
      $r = Imp 'Vouchers' ('<VOUCHER VCHTYPE="D4 Manual" ACTION="Create"><DATE>20261002</DATE><VOUCHERTYPENAME>D4 Manual</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>' + $narr + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-41.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>41.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') "d4 $narr"
      $v = @((DsVAll 9000) | Where-Object { $_.narr -eq $narr })[0]
      Info "dsrc d4: '$narr' by XML: $((([regex]::Match("$r", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' '))$(if ("$r" -match '<LINEERROR>([^<]*)') { ' ' + $matches[1] }); in Tally: $(if ($v) { "$($v.type) no '$($v.vno)' of $($v.date) mid $($v.mid) AlterID $($v.aid) guid $($v.guid)" } else { 'none' })"
      return $v
    }
    # the add-on's pair of lines for a new D4 Manual entry with that number on 2-10-2026, the post line with the older
    # entry's MasterID (its GUID as Tally's own for that MasterID): the MasterID answer is "not a change after the starting point"
    function D4Lines([string]$no, [int]$aid) {
      # the times, the date and its form as the add-on wrote them on d1's line (the same day, 2-10-2026)
      $t0 = LF $tpl.l 't0'; $tw = LF $tpl.l 'tw'; $t1 = [regex]::Match($tpl.l, '\|t1=([^|]*)\|src=').Groups[1].Value; $vd = LF $tpl.l 'vdate'
      $g = '{0}-{1:x8}' -f $cg, $old.mid
      $txt = (@(@('voucher_accept_pre', '', '', 0), @('voucher_accept_post', $g, $old.mid, $aid)) | ForEach-Object { "FCR1|ev=$($_[0])|t0=$t0|tw=$tw|dp=$dp1|w=$wu|cguid=$cg|cname=$co1|user=$usr|obj=Voucher|guid=$($_[1])|mid=$($_[2])|aid=$($_[3])|vtype=D4 Manual|vno=$no|vdate=$vd|name=|parent=|narr=|t1=$t1|src=live`r`n" }) -join ''
      [IO.File]::AppendAllText($rfile, $txt, [Text.UnicodeEncoding]::new($false, $false))
      Info "dsrc d4: the add-on's pair of lines written to $($tpl.file) for D4 Manual '$no' of 2-Oct-26 with the older entry's MasterID $($old.mid) (AlterID $($old.aid)), GUID $g"
      return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $mStart = Mark
    # item 6 first: the starting day is today, the request's day 2-10-2026 is before it: refused before sending, its own words
    $vE = D4Imp 'D4-EARLY' 'd4 early'
    $lnE = (DsBlog).Count; $tE = D4Lines 'D4-EARLY' $(if ($vE) { $vE.aid } else { 0 })
    Start-Sleep 40
    $refW = @((DsBlog) | Select-Object -Skip $lnE | Where-Object { $_ -match 'FinComVoucherByNumber refused before sending' })
    $askE = @((DsProxy) | Where-Object { [int64]$_.t0 -ge $tE -and $_.id -eq 'FinComVoucherByNumber' -and "$($_.vno)" -eq 'D4-EARLY' })
    Info "dsrc d4 (item 6): D4-EARLY with the starting day today: FinComVoucherByNumber at the proxy $($askE.Count); the bridge's log: $(if ($refW.Count) { $refW -join ' / ' } else { 'no refusal line' })"
    # the starting point's recorded day moved back to 1-10-2026 (numbers kept), so 2-10-2026 is not before the starting day
    $spf = Join-Path $h1 'sync\start-point.json'; $spTxt = Get-Content $spf -Raw -ErrorAction SilentlyContinue
    $spNew = [regex]::Replace("$spTxt", '"at"\s*:\s*"\d{4}-\d{2}-\d{2}T', '"at":"2026-10-01T')
    [IO.File]::WriteAllText($spf, $spNew, [Text.UTF8Encoding]::new($false))
    Info "dsrc d4: start-point.json before: $("$spTxt".Trim()); after: $("$spNew".Trim())"
    Start-Sleep 5
    $vOne = D4Imp 'D4-ONE' 'd4 one'
    $vTwoA = D4Imp 'D4-TWO' 'd4 two a'; $vTwoB = D4Imp 'D4-TWO' 'd4 two b'
    $cases = @(); $mD4 = Mark
    # Tally's own numbers (a manual type keeps the number given; read back all the same)
    $haveTwo = $vTwoA -and $vTwoB -and "$($vTwoA.vno)" -eq "$($vTwoB.vno)"
    $list = @(@('ONE', $(if ($vOne) { "$($vOne.vno)" } else { 'D4-ONE' }), $vOne, 1)); if ($haveTwo) { $list += , @('TWO', "$($vTwoB.vno)", $vTwoB, 2) }; $list += , @('NONE', 'D4-NONE', $null, 0)
    if (-not $haveTwo) { Info "dsrc d4: no two vouchers with one number (Tally: '$($vTwoA.vno)' / '$($vTwoB.vno)'): case TWO not run" }
    foreach ($cs in $list) {
      $t0 = D4Lines $cs[1] $(if ($cs[2]) { $cs[2].aid } else { 0 })
      Start-Sleep 40
      $cases += [pscustomobject]@{ k = $cs[0]; no = $cs[1]; v = $cs[2]; want = $cs[3]; t0 = $t0 }
    }
    Start-Sleep 20
    $lines = StubLines $mStart; $sts = DsStates; $px = DsProxy
    $ev4 = @(); $bad4 = @()
    foreach ($c in $cases) {
      $asks = @($px | Where-Object { [int64]$_.t0 -ge $c.t0 -and $_.id -eq 'FinComVoucherByNumber' -and "$($_.vno)" -eq $c.no })
      $objAsk = @($px | Where-Object { [int64]$_.t0 -ge $c.t0 -and $_.id -match 'FinComVoucher' -and $_.id -ne 'FinComVoucherByNumber' -and "$($_.mid)" -eq "$($old.mid)" } | Select-Object -First 3)
      $ln = @($lines | Where-Object { "$($_.raw.vch_no)" -eq $c.no -and $_.ev -eq 'created' })
      $taken = @($ln | Where-Object { $_.xml })
      $okT = if ($c.k -eq 'ONE') { $taken.Count -ge 1 -and $c.v -and "$($taken[0].guid)" -eq $c.v.guid -and "$($taken[0].mid)" -eq "$($c.v.mid)" } else { $ln.Count -ge 1 -and -not $taken.Count }
      $okA = $asks.Count -eq 1 -and [int]$asks[0].ms -lt 2000 -and [int]$asks[0].status -eq 200
      $okN = (-not $asks.Count) -or ($null -eq $asks[0].nv) -or ([int]$asks[0].nv -eq $c.want)
      if (-not ($okT -and $okA -and $okN)) { $bad4 += $c.k }
      $ev4 += ("{0} ({1}; Tally has {2} with that number): MasterID asks of {3} at the proxy: {4}; FinComVoucherByNumber asks: {5} [{6}]; the line(s): {7}" -f $c.k, $c.no, $c.want, $old.mid,
          (($objAsk | ForEach-Object { "$($_.id) $($_.ms) ms" }) -join ', '), $asks.Count, (($asks | ForEach-Object { "$($_.vtype)/$($_.vno)/$($_.day) $($_.ms) ms status $($_.status) vouchers in the answer $($_.nv)" }) -join '; '), $(if ($ln.Count) { ($ln | ForEach-Object { DsLineTxt $_ $sts }) -join ' | ' } else { 'none' }))
    }
    $logBy = @((DsBlog) | Where-Object { $_ -match 'FinComVoucherByNumber|by type and number|older entry, not this save|entries with that type and number|Tally gave no D4' } | Select-Object -Last 8)
    DRes $C4 $(if (-not $vOne) { 'HARNESS' } elseif ($bad4.Count) { 'FAIL' } elseif (-not $haveTwo) { 'HARNESS' } else { 'PASS' }) ("{0}; not as expected: {1}; item 6 (starting day today): FinComVoucherByNumber at the proxy for D4-EARLY {2}, the log: {3}; the bridge's log: {4}" -f ($ev4 -join ' || '), $(if ($bad4.Count) { $bad4 -join ', ' } else { 'none' }), $askE.Count, $(if ($refW.Count) { $refW[0] } else { 'no refusal line' }), ($logBy -join ' / '))
  }

  # ---------------------------------------------------------------- d2: one Tally, folder 2
  Say '---- dsrc d2: Tally on folder 2'
  $script:dsCur = $data2; $up2 = DsTally $data2 'd2-f2'
  Start-Sleep 20
  $m2 = Mark
  $v2 = DsReceipt 'd2' 722
  if (-not $up2 -or -not $v2) { DRes $C2 'HARNESS' "Tally on folder 2 up: $up2; the keys made a Receipt: $([bool]$v2)" }
  else {
    $s2 = $script:dsSavedMs
    $w = WaitLine $m2 { $_.ev -eq 'other_source' -and "$($_.raw.vch_no)" -eq "$($v2.vno)" } (Get-Date) 120
    Start-Sleep 60
    $pl = DsPostLine $v2; $dp = if ($pl) { LF $pl.l 'dp' } else { '' }
    $sts = DsStates; $lines = StubLines $m2
    $applied = @($lines | Where-Object { $_.ev -ne 'other_source' -and ($_.guid -eq $v2.guid -or "$($_.raw.vch_no)" -eq "$($v2.vno)") })
    $asks = DsAsks $v2 $s2
    $x = if ($w.Count) { $w[0] } else { $null }
    $okO = $x -and "$($x.raw.data_id)" -eq $id2 -and -not $x.xml -and -not $x.guid -and -not "$($x.raw.master_id)" -and $sts["$($x.raw.line_id)"] -ne 'applied'
    $ok = $okO -and -not $applied.Count -and -not $asks.Count -and (DsNorm $dp) -eq (DsNorm $f2)
    $olog = @((DsBlog) | Where-Object { $_ -match 'another data location' } | Select-Object -Last 2)
    DRes $C2 $(if ($ok) { 'PASS' } elseif (-not $pl) { 'HARNESS' } else { 'FAIL' }) ("folder 2 Receipt no {0} mid {1} guid {2} (folder 1's d1 entry had mid {3}); the add-on's dp='{4}' (folder 2: {5}); {6}; voucher requests for it at the proxy in 180 s: {7}; lines of it sent as an entry: {8}; data id expected {9}; the bridge's log: {10}" -f $v2.vno, $v2.mid, $v2.guid, $(if ($v1) { $v1.mid } else { '-' }), $dp, ((DsNorm $dp) -eq (DsNorm $f2)), (DsLineTxt $x $sts),
        $(if ($asks.Count) { ($asks | ForEach-Object { "$($_.id) mid $($_.mid) $($_.vno)" }) -join ', ' } else { 'none' }), $(if ($applied.Count) { ($applied | ForEach-Object { DsLineTxt $_ $sts }) -join ' | ' } else { 'none' }), $id2, ($olog -join ' / '))
  }

  # ---------------------------------------------------------------- d2b: two Tallys at once
  Say '---- dsrc d2b: Tally on folder 1 and a second Tally on folder 2'
  $script:dsCur = $data1; $upA = DsTally $data1 'd2b-f1'
  $upB = DsTally2 $data2 'd2b-f2'
  $script:twoOk = $upA -and $upB
  if (-not $script:twoOk) { DRes $C2b 'HARNESS' "two Tallys at once not up: Tally on folder 1 (9000) $upA; the second instance on folder 2 (9001) $upB (see the ds-d2b-f2 screens)" }
  else {
    Start-Sleep 20
    $m3 = Mark
    $vB = DsReceipt 'd2b-f2' 733 9001 $script:t2pid; $sB = $script:dsSavedMs
    $vA = DsReceipt 'd2b-f1' 734 9000 $script:tpid
    if (-not $vB) { DRes $C2b 'HARNESS' 'the keys made no Receipt in the second Tally' }
    else {
      $w = WaitLine $m3 { $_.ev -eq 'other_source' -and "$($_.raw.vch_no)" -eq "$($vB.vno)" -and "$($_.raw.data_id)" -eq $id2 } (Get-Date) 120
      $wA = if ($vA) { WaitLine $m3 { $_.guid -eq $vA.guid -and $_.xml } (Get-Date) 120 } else { @() }
      Start-Sleep 45
      $pl = DsPostLine $vB; $dp = if ($pl) { LF $pl.l 'dp' } else { '' }
      $sts = DsStates; $lines = StubLines $m3
      $applied = @($lines | Where-Object { $_.ev -ne 'other_source' -and $_.xml -and "$($_.raw.data_id)" -eq $id2 })
      $asks = @(DsAsks $vB $sB | Where-Object { -not $vA -or "$($_.mid)" -ne "$($vA.mid)" })
      $x = if ($w.Count) { $w[0] } else { $null }; $xa = if ($wA.Count) { $wA[0] } else { $null }
      $ok = $x -and -not $x.xml -and -not $x.guid -and $sts["$($x.raw.line_id)"] -ne 'applied' -and -not $applied.Count -and -not $asks.Count -and (DsNorm $dp) -eq (DsNorm $f2)
      DRes $C2b $(if ($ok) { 'PASS' } elseif (-not $pl) { 'HARNESS' } else { 'FAIL' }) ("second Tally (9001, folder 2) Receipt no {0} mid {1}; dp='{2}'; {3}; voucher requests for it at the proxy: {4}; folder 2 lines sent as an entry: {5}. Beside it, Tally on folder 1 (9000) Receipt {6}: {7}" -f $vB.vno, $vB.mid, $dp, (DsLineTxt $x $sts),
          $(if ($asks.Count) { ($asks | ForEach-Object { "$($_.id) mid $($_.mid) $($_.vno)" }) -join ', ' } else { 'none' }), $(if ($applied.Count) { ($applied | ForEach-Object { DsLineTxt $_ $sts }) -join ' | ' } else { 'none' }),
          $(if ($vA) { "no $($vA.vno) mid $($vA.mid)" } else { '(none made)' }), (DsLineTxt $xa $sts))
    }
    Stop-Process -Id $script:t2pid -Force -ErrorAction SilentlyContinue; Start-Sleep 3
  }

  # ---------------------------------------------------------------- d3: FinCom chooses folder 2
  Say '---- dsrc d3: FinCom chooses folder 2'
  $mC = Mark; $lnC = (DsBlog).Count
  $cgC = if ($cgB) { $cgB } else { "$(LF (DsPostLine $v1).l 'cguid')" }
  $ctl = Invoke-RestMethod 'http://127.0.0.1:8787/' -Method Post -Body (@{ kind = '_ctl'; choose = @{ company_guid = $cgC; data_id = $id2 } } | ConvertTo-Json -Compress) -ContentType 'application/json'
  Info "dsrc d3: the stub's choice set to folder 2 ($id2) for '$cgC': $($ctl | ConvertTo-Json -Compress -Depth 4)"
  $t = Get-Date; $stopL = @()
  while (((Get-Date) - $t).TotalSeconds -lt 60) { $stopL = @((DsBlog) | Select-Object -Skip $lnC | Where-Object { $_ -match 'FinCom reads the company from another data location' }); if ($stopL.Count) { break }; Start-Sleep 3 }
  Info "dsrc d3: the bridge: $(if ($stopL.Count) { $stopL[0] } else { 'no stop line in 60 s' }); recorder-data.json $((DsData) | ConvertTo-Json -Compress -Depth 4)"
  $script:dsCur = $data2; $u3 = DsTally $data2 'd3-f2'
  Start-Sleep 20
  $vA3 = DsReceipt 'd3-f2a' 741
  $wA3 = if ($vA3) { WaitLine $mC { $_.guid -eq $vA3.guid -and $_.xml } (Get-Date) 120 } else { @() }
  $t = Get-Date; $fresh = @()
  while (((Get-Date) - $t).TotalSeconds -lt 90) { $fresh = @((StubReqs) | Select-Object -Skip $mC | Where-Object { $_.kind -eq '_fresh' }); if ($fresh.Count) { break }; Start-Sleep 3 }
  $vB3 = DsReceipt 'd3-f2b' 742
  $wB3 = if ($vB3) { WaitLine $mC { $_.guid -eq $vB3.guid -and $_.xml } (Get-Date) 120 } else { @() }
  $script:dsCur = $data1; $u4 = DsTally $data1 'd3-f1'
  Start-Sleep 20
  $vC3 = DsReceipt 'd3-f1' 743; $sC3 = $script:dsSavedMs
  $wC3 = if ($vC3) { WaitLine $mC { $_.ev -eq 'other_source' -and "$($_.raw.vch_no)" -eq "$($vC3.vno)" -and "$($_.raw.data_id)" -eq $id1 } (Get-Date) 120 } else { @() }
  Start-Sleep 45
  $sts = DsStates; $linesC = StubLines $mC
  $aOk = $wA3.Count -and "$($wA3[0].raw.data_id)" -eq $id2 -and $sts["$($wA3[0].raw.line_id)"] -eq 'applied'
  $bOk = $wB3.Count -and "$($wB3[0].raw.data_id)" -eq $id2 -and $sts["$($wB3[0].raw.line_id)"] -eq 'applied'
  $cx = if ($wC3.Count) { $wC3[0] } else { $null }
  $cAsk = if ($vC3) { @(DsAsks $vC3 $sC3) } else { @() }
  $cApplied = if ($vC3) { @($linesC | Where-Object { $_.ev -ne 'other_source' -and $_.xml -and "$($_.raw.data_id)" -eq $id1 -and $_.i -ge $mC }) } else { @() }
  $cOk = $cx -and -not $cx.xml -and $sts["$($cx.raw.line_id)"] -eq 'held' -and -not $cAsk.Count -and -not $cApplied.Count
  $okD3 = $stopL.Count -and $aOk -and $bOk -and $fresh.Count -and $cOk
  DRes $C3 $(if (-not $u3 -or -not $u4 -or -not $vA3 -or -not $vB3 -or -not $vC3) { 'HARNESS' } elseif ($okD3) { 'PASS' } else { 'FAIL' }) ("the bridge: {0}; folder 2's first save (Receipt {1}): {2}; the stub's fresh starting point: {3}; folder 2's save after it (Receipt {4}): {5}; folder 1's save (Receipt {6} mid {7}): {8}; voucher requests for it at the proxy: {9}; folder 1 lines applied after the choice: {10}" -f `
      $(if ($stopL.Count) { $stopL[0] } else { 'no stop line' }), $(if ($vA3) { "$($vA3.vno) mid $($vA3.mid)" } else { '-' }), $(if ($wA3.Count) { DsLineTxt $wA3[0] $sts } else { 'no line with its body' }),
      $(if ($fresh.Count) { "at $($fresh[0].at) for data id $($fresh[0].body.data_id) (startPoint $($fresh[0].body.startPoint | ConvertTo-Json -Compress -Depth 4))" } else { 'not recorded in 90 s' }),
      $(if ($vB3) { "$($vB3.vno) mid $($vB3.mid)" } else { '-' }), $(if ($wB3.Count) { DsLineTxt $wB3[0] $sts } else { 'no line with its body' }),
      $(if ($vC3) { $vC3.vno } else { '-' }), $(if ($vC3) { $vC3.mid } else { '-' }), (DsLineTxt $cx $sts), $(if ($cAsk.Count) { ($cAsk | ForEach-Object { "$($_.id) mid $($_.mid)" }) -join ', ' } else { 'none' }), $(if ($cApplied.Count) { ($cApplied | ForEach-Object { DsLineTxt $_ $sts }) -join ' | ' } else { 'none' }))

  # ---------------------------------------------------------------- d3b (MEASURE): folder 2 chosen, two Tallys at once
  if ($script:twoOk) {
    Say '---- dsrc d3b: folder 2 chosen; Tally on folder 1 and the second Tally on folder 2'
    if (DsTally2 $data2 'd3b-f2') {
      Start-Sleep 20
      $m5 = Mark
      $vD = DsReceipt 'd3b-f2' 751 9001 $script:t2pid; $sD = $script:dsSavedMs
      Start-Sleep 90
      $sts = DsStates
      $ln = if ($vD) { @((StubLines $m5) | Where-Object { "$($_.raw.vch_no)" -eq "$($vD.vno)" -or $_.guid -eq $vD.guid }) } else { @() }
      $asks = if ($vD) { @(DsAsks $vD $sD) } else { @() }
      $f1v = if ($vD) { @((DsVAll 9000) | Where-Object { $_.mid -eq $vD.mid })[0] } else { $null }
      Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE d3b folder 2 chosen, Tally (9000, the bridge's own) on folder 1, the second Tally (9001) on folder 2: its Receipt {0}; folder 1's entry with that MasterID: {1}; voucher requests at the proxy (to the Tally on folder 1): {2}; the stub's line(s): {3}" -f `
          $(if ($vD) { "no $($vD.vno) mid $($vD.mid) guid $($vD.guid)" } else { '(none made)' }), $(if ($f1v) { "$($f1v.type) no $($f1v.vno) of $($f1v.date) AlterID $($f1v.aid)" } else { 'none' }),
          $(if ($asks.Count) { ($asks | ForEach-Object { "$($_.id) mid $($_.mid) $($_.vno) $($_.ms) ms" }) -join ', ' } else { 'none' }), $(if ($ln.Count) { ($ln | ForEach-Object { DsLineTxt $_ $sts }) -join ' | ' } else { 'none' }))
      Stop-Process -Id $script:t2pid -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Host "dsrc stopped: $_ $($_.ScriptStackTrace)"
  foreach ($c in @($C1, $C4, $C2, $C2b, $C3)) { DRes $c 'HARNESS' "the harness stopped: $_" }
}
Snap 'dsrc-end'
Copy-Item (Join-Path $h1 'sync\*') (New-Item -ItemType Directory -Force (Join-Path $out 'sync-end')).FullName -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $blog (Join-Path $out 'bridge-log-all.txt') -ErrorAction SilentlyContinue
(DsRec) | ForEach-Object { "$($_.file)`t$($_.l)" } | Set-Content (Join-Path $out 'recorder-lines.txt') -Encoding UTF8
Set-Content (Join-Path $out 'tds-screens.log') $script:tdsLog -Encoding UTF8
if ($script:t2pid) { Stop-Process -Id $script:t2pid -Force -ErrorAction SilentlyContinue }
