# dpathv.ps1 - mode "dpath" (the owner's approval of 09-Oct-2026, bridge 2.4.1): the add-on FinComRecorder.tdl writes, on
# each line, the data folder the loaded company was opened from, so FinCom can tell apart two Tallys that have the same
# company (same GUID) open from different data folders. MEASUREMENT ONLY, nothing here ships; no request the bridge sends
# changes (no bridge runs in this mode). Dot-sourced by flowv.ps1 after c1-c2 (Tally started with the ref's
# FinComRecorder.tdl, the company open from $data1).
#   D0  the company's own methods as Tally exports them (Company, NATIVEMETHOD *): every one whose value holds the data
#       folder or the company number folder (each later probed inside the add-on's events too)
#   D1  probe files (harness only), each its own file so a construct a release does not know drops only that file. Each
#       file evaluates its candidate formula(s) and writes one line per candidate to C:\fcspike\dpath\probe.txt:
#         FCDP|f=<file>|ev=<event>|cg=<company GUID>|mid=|aid=|vt=|vno=|k=<candidate>|v=<value>|end
#       "<file>-pre.tdl" (listed BEFORE the add-on in tally.ini: [#Form: Voucher] On : Form Accept before Tally's save,
#       the add-on's voucher_accept_pre) and "<file>.tdl" (listed AFTER: On : Form Accept after the save = the add-on's
#       voucher_accept_post; Before / After Delete Object and Before / After Cancel Object, as the add-on's own events)
#   P1  folder 1 ($data1\<n>): Tally started with the probe files; by keys on 2-10-2026: a Receipt created, altered, an
#       Alt+2 duplicate created, the first cancelled, the last deleted; then each single candidate asked by XML (COMPUTE)
#   P2  folder 2: the SAME company folder copied (Tally closed) to $data2\<n>, Tally started on it; the same steps on
#       1-10-2026
#   D2  per candidate: the value in each context (created / altered / cancelled / deleted, pre and post), empty anywhere,
#       different between the folders, the company number folder in it, equal to the folder Tally opened
#   D3  save time: the ref's add-on against the same file with the chosen formula written on each line ("|dpath=", after
#       cname); 1 warm + 5 saves (Day Book, the last entry, Alt+2, Ctrl+A, timed to the add-on's voucher_accept_post
#       line, bigv.ps1's method) of a receipt and of a 50-item sales invoice; arms: current, with the field, current again
Say '---- dpath: the data folder of the loaded company inside the add-on''s events'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$num = $folder.Name
$data2 = "$env:RUNNER_TEMP\TallyData2"
$f1 = Join-Path $data1 $num; $f2 = Join-Path $data2 $num
$pd = Join-Path $fc 'dpath'; New-Item -ItemType Directory -Force $pd | Out-Null
$probeTxt = Join-Path $pd 'probe.txt'; Remove-Item $probeTxt -Force -ErrorAction SilentlyContinue
Info "dpath: company folder number $num; folder 1 $f1; folder 2 $f2 (a copy made with Tally closed)"
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }

# ---- Tally started on a data folder with a list of TDL files (bankv.ps1's restart: the start screens read and answered)
function DpIni([string]$data, [string[]]$tdls) {
  $l = @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'Ignore TCP Timeout = Yes', 'User TDL = Yes', 'Default Companies = Yes', "Load = $num")
  foreach ($f in $tdls) { $l += "TDL = $f" }
  Set-Content -Path (Join-Path $dir 'tally.ini') -Value $l -Encoding ASCII
  Info "tally.ini: Data = $data; TDL files: $(($tdls | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')"
}
$script:dpStartNotes = @()
function DpStart([string]$tag) {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; $null = TdsScreen "$tag-start-1"; KeysTo 'a' 4; KeysTo 't' 10
  for ($s = 0; $s -lt 6; $s++) {
    $t = TdsScreen "$tag-start-$($s + 2)"
    if ($t -match 'ignore the TDLs') { $script:dpStartNotes += "${tag}: Tally said 'TallyPrime will ignore the TDLs that have errors'"; Info "${tag}: at start Tally said: TallyPrime will ignore the TDLs that have errors" }
    if ($t -match 'Internal Error') { $script:dpStartNotes += "${tag}: Internal Error at start"; Info "${tag}: at start Tally showed an Internal Error" }
    if ($t -match 'Press any key') { KeysTo '{ENTER}' 3; continue }
    if ($t -match 'Activate License|Serial Number') { KeysTo '{ESC}' 3; continue }
    if ($t -match 'Try It For Free|Welcome to TallyPrime') { KeysTo 't' 8; continue }
    if ($t -match 'Startup Report|Application Startup') { KeysTo '^a' 5; continue }
    if ($t -match 'Internal Error') { KeysTo '{ENTER}' 3; continue }
    break
  }
  $c = Post $listCoXml "$tag companies" 30
  $ok = ($c -match [regex]::Escape($co1)) -and [bool](Get-Process -Id $script:tpid -ErrorAction SilentlyContinue)
  Info "${tag}: Tally started (pid $($script:tpid)); '$co1' loaded: $ok"
  return $ok
}
$script:TdsRestart = { $null = DpStart 'restart' }

# ---- masters and the timing entries by XML before the copy (both folders hold the same company); an import fires no
# Form Accept, so the add-on writes nothing for them
function S2Led($name, $parent, $extra = '') { '<LEDGER NAME="' + (SE $name) + '" ACTION="Create"><NAME.LIST><NAME>' + (SE $name) + '</NAME></NAME.LIST><PARENT>' + (SE $parent) + '</PARENT>' + $extra + '</LEDGER>' }
$ms = @('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
$ms += S2Led 'Spike Income' 'Indirect Incomes'; $ms += S2Led 'Sales' 'Sales Accounts'; $ms += S2Led 'Output CGST' 'Duties & Taxes'; $ms += S2Led 'Output SGST' 'Duties & Taxes'
$ms += S2Led 'HDFC Bank' 'Bank Accounts'; $ms += S2Led 'DParty' 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>'
for ($j = 1; $j -le 50; $j++) { $n = 'DItem {0:d2}' -f $j; $ms += '<STOCKITEM NAME="' + $n + '" ACTION="Create"><NAME.LIST><NAME>' + $n + '</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS></STOCKITEM>' }
$mr = Imp 'All Masters' ($ms -join '') 'dpath masters'
Info "dpath masters: $(([regex]::Match("$mr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
$f2d = '{0:0.00}'
$rcx = '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20261101</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>DP-RC1</VOUCHERNUMBER><NARRATION>dpath receipt</NARRATION>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>DParty</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>ADV-DP1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>500.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-500.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
$sub = 200 * 50; $tax = [math]::Round($sub * 0.09, 2); $tot = $sub + 2 * $tax
$sx = '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>20261201</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>DP-S50</VOUCHERNUMBER>' +
  '<PARTYLEDGERNAME>DParty</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>dpath sales 50 items</NARRATION>' +
  '<LEDGERENTRIES.LIST><LEDGERNAME>DParty</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-' + ($f2d -f $tot) + '</AMOUNT>' +
  '<BILLALLOCATIONS.LIST><NAME>DP-S50</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-' + ($f2d -f $tot) + '</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>'
foreach ($t in 'Output CGST', 'Output SGST') { $sx += '<LEDGERENTRIES.LIST><LEDGERNAME>' + $t + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ($f2d -f $tax) + '</AMOUNT></LEDGERENTRIES.LIST>' }
for ($j = 1; $j -le 50; $j++) { $sx += '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>' + ('DItem {0:d2}' -f $j) + '</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' }
$sx += '</VOUCHER>'
$vr1 = Imp 'Vouchers' $rcx 'dpath receipt'; $vr2 = Imp 'Vouchers' $sx 'dpath sales 50'
$setOk = @{ receipt = ("$vr1" -match '<CREATED>1</CREATED>'); sales50 = ("$vr2" -match '<CREATED>1</CREATED>') }
Info "dpath timing entries: receipt (1-11-2026) made $($setOk.receipt); sales invoice of 50 items (1-12-2026) made $($setOk.sales50)"

# ---- D0: the company's methods as Tally exports them
$coX = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DpCo</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DpCo" ISMODIFY="No"><TYPE>Company</TYPE><NATIVEMETHOD>*</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') 'company methods' 60
Set-Content (Join-Path $cap 'dpath-company-methods.xml') $coX -Encoding UTF8
$disc = [ordered]@{}
foreach ($m in [regex]::Matches("$coX", '<([A-Z][A-Z0-9_.]*)(?:\s[^>]*)?>([^<]+)</\1>')) {
  $tag = $m.Groups[1].Value; $val = [System.Net.WebUtility]::HtmlDecode($m.Groups[2].Value).Trim()
  if ($val -like "*$data1*" -or $val -like '*TallyData*' -or $val -eq $num -or $val -like "*\$num" -or $val -like "*\$num\*") { if (-not $disc.Contains($tag)) { $disc[$tag] = $val } }
}
Info "D0 company methods holding the data folder or the number $num ($("$coX".Length) chars exported): $(if ($disc.Count) { ($disc.Keys | ForEach-Object { "$_='$($disc[$_])'" }) -join '; ' } else { 'none' })"

# ---- D1: the candidates and their probe files
# e: one formula; or two (the path, the number) joined with "\" through two variables (no formula parsed across a "+")
$cands = [System.Collections.Generic.List[object]]::new()
function AddC($f, $k, $e) { $cands.Add([pscustomobject]@{ f = $f; k = $k; e = $e }) }
$cnumE = '$CompanyNumber:Company:##SVCurrentCompany'
AddC 'sysdp' 'sysdp' '$$SysInfo:DataPath'
AddC 'svcp' 'svcp' '##SVCurrentPath'
AddC 'dest' 'dest' '$Destination:Company:##SVCurrentCompany'
AddC 'cnum' 'cnum' $cnumE
AddC 'destnum' 'destnum' @('$Destination:Company:##SVCurrentCompany', $cnumE)
AddC 'sysdpnum' 'sysdpnum' @('$$SysInfo:DataPath', $cnumE)
AddC 'svcpnum' 'svcpnum' @('##SVCurrentPath', $cnumE)
foreach ($p in 'CompanyPath', 'CompanyDataPath', 'DataDirectory', 'DataFolder', 'DataDir', 'TallyDataPath', 'DataLocation', 'CurrentDataPath', 'CmpDataPath', 'ApplicationPath', 'ConfigPath', 'ExePath') { AddC 'sysx' "sys_$p" ('$$SysInfo:' + $p) }
foreach ($p in 'Path', 'DataPath', 'CompanyPath', 'Directory', 'DataDirectory', 'Location', 'DataLocation', 'Folder', 'CompanyFolder', 'LoadedPath', 'FullPath') { AddC 'meth' "m_$p" ('$' + $p + ':Company:##SVCurrentCompany') }
$i = 0
foreach ($tag in $disc.Keys) {
  if ($tag -in 'DESTINATION', 'COMPANYNUMBER') { continue }
  $i++; AddC "x$i" "x_$tag" ('$' + $tag + ':Company:##SVCurrentCompany')
  if ($disc[$tag] -ne $num -and $disc[$tag] -notlike "*\$num" -and $disc[$tag] -notlike "*\$num\*") { AddC "x${i}num" "x_${tag}+num" @(('$' + $tag + ':Company:##SVCurrentCompany'), $cnumE) }
}
function DpBody([string]$fn, [object[]]$cs) {
  $b = @("[Function: $fn]", '    Parameter : pEv : String', '    Variable  : vV  : String', '    Variable  : vA  : String', '    Variable  : vB  : String', '    Variable  : vH  : String', '    Returns   : Logical',
    '    000 : SET : vA : $Guid:Company:##SVCurrentCompany',
    ('    001 : SET : vH : "FCDP|f=' + $cs[0].f + '|ev=" + ##pEv + "|cg=" + ##vA + "|mid=" + ($$String:$MasterID) + "|aid=" + ($$String:$AlterID)'),
    '    002 : SET : vH : ##vH + "|vt=" + ($$String:$VoucherTypeName) + "|vno=" + ($$String:$VoucherNumber)',
    ('    003 : OPEN FILE : "' + $probeTxt + '" : Text : Write : Unicode'), '    004 : IF : NOT $$LastResult', '    005 :    RETURN : Yes', '    006 : END IF')
  $n = 10
  foreach ($c in $cs) {
    if ($c.e -is [array]) {
      $b += ('    {0:d3} : SET : vA : {1}' -f $n, $c.e[0]); $n++
      $b += ('    {0:d3} : SET : vB : {1}' -f $n, $c.e[1]); $n++
      $b += ('    {0:d3} : SET : vV : ##vA + "\" + ##vB' -f $n); $n++
    } else { $b += ('    {0:d3} : SET : vV : {1}' -f $n, $c.e); $n++ }
    $b += ('    {0:d3} : WRITE FILE LINE : ##vH + "|k={1}|v=" + ##vV + "|end"' -f $n, $c.k); $n++
  }
  $b += ('    {0:d3} : CLOSE TARGET FILE' -f $n); $n++
  $b += ('    {0:d3} : RETURN : Yes' -f $n)
  return $b
}
$preFiles = @(); $postFiles = @()
foreach ($g in ($cands | Group-Object f)) {
  $f = $g.Name; $cs = @($g.Group); $id = ($f -replace '\W', '')
  $post = @(";; dpath probe $f (tally-versions mode dpath, harness only): after Tally's save and in the delete / cancel events",
    '[#Form: Voucher]', "    On : Form Accept : Yes : Call : FCDPW$id : `"accept_post`"", '',
    '[System: Events]', "    FCDPE${id}a : Before Delete Object : Yes : Call : FCDPW$id : `"before_delete`"", "    FCDPE${id}b : After Delete Object : Yes : Call : FCDPW$id : `"after_delete`"",
    "    FCDPE${id}c : Before Cancel Object : Yes : Call : FCDPW$id : `"before_cancel`"", "    FCDPE${id}d : After Cancel Object : Yes : Call : FCDPW$id : `"after_cancel`"", '') + (DpBody "FCDPW$id" $cs)
  $pre = @(";; dpath probe $f-pre (tally-versions mode dpath, harness only): listed before the add-on: before Tally's save",
    '[#Form: Voucher]', "    On : Form Accept : Yes : Call : FCDPP$id : `"accept_pre`"", '') + (DpBody "FCDPP$id" $cs)
  $pf = Join-Path $pd "dp-$f.tdl"; Set-Content $pf $post -Encoding ASCII; $postFiles += $pf; Copy-Item $pf (Join-Path $cap "dp-$f.tdl")
  $qf = Join-Path $pd "dp-$f-pre.tdl"; Set-Content $qf $pre -Encoding ASCII; $preFiles += $qf; Copy-Item $qf (Join-Path $cap "dp-$f-pre.tdl")
}
Info "D1 candidates: $(($cands | ForEach-Object { "$($_.k)=$(if ($_.e -is [array]) { ($_.e -join ' + \ + ') } else { $_.e })" }) -join '; ')"

# ---- the probe file read with a shared open (Tally holds it while it writes: bigv.ps1's lesson)
function DpLines {
  if (-not [IO.File]::Exists($probeTxt)) { return , @() }
  for ($t = 0; $t -lt 40; $t++) {
    try {
      $fs = [IO.FileStream]::new($probeTxt, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      try { $sr = [IO.StreamReader]::new($fs, [Text.Encoding]::Unicode, $true); $txt = $sr.ReadToEnd() } finally { $fs.Dispose() }
      return , @($txt -split "`r?`n" | Where-Object { $_ })
    } catch { Start-Sleep -Milliseconds 50 }
  }
  return , @()
}
$script:rows = [System.Collections.Generic.List[object]]::new()
$script:seenN = 0
function DpTake([string]$phase, [string]$step) {
  Start-Sleep 2
  $all = DpLines; $new = @($all | Select-Object -Skip $script:seenN); $script:seenN = $all.Count
  foreach ($l in $new) {
    $m = [regex]::Match($l, '^FCDP\|f=([^|]*)\|ev=([^|]*)\|cg=([^|]*)\|mid=([^|]*)\|aid=([^|]*)\|vt=([^|]*)\|vno=([^|]*)\|k=([^|]*)\|v=(.*)\|end$')
    if (-not $m.Success) { Info "dpath ${phase}/${step}: a probe line not read: $l"; continue }
    $script:rows.Add([pscustomobject]@{ phase = $phase; step = $step; f = $m.Groups[1].Value; ev = $m.Groups[2].Value; cg = $m.Groups[3].Value; mid = $m.Groups[4].Value; aid = $m.Groups[5].Value; vt = $m.Groups[6].Value; vno = $m.Groups[7].Value; k = $m.Groups[8].Value; v = $m.Groups[9].Value })
  }
  Info ("dpath {0}/{1}: {2} probe line(s); events {3}" -f $phase, $step, $new.Count, ((@($new | ForEach-Object { [regex]::Match($_, '\|ev=([^|]*)').Groups[1].Value }) | Group-Object | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '))
}

# ---- one phase: the keys steps of flowv.ps1 (c4a create, c4b alter, c5 Alt+2, c4c cancel, c4d delete) on one date
function DpDayBook($n, $d) { KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 4; KeysTo '{F2}' 3; KeysTo "$d{ENTER}" 4 "$n-daybook" }
$script:evid = @()
$script:safeGroups = @('sysdp', 'dest', 'cnum', 'destnum', 'sysdpnum')
function DpPhase([string]$ph, [string]$data, [string]$d) {
  DpIni $data $script:probeIni
  $up = DpStart $ph
  if (-not $up -and $script:probeIni.Count -gt 1) {
    # Tally did not come up with the company: once more with the owner's main candidates only (a construct a release does
    # not know must not cost the whole phase)
    $script:probeIni = @(@($preFiles | Where-Object { (Split-Path $_ -Leaf) -match ('^dp-(' + ($script:safeGroups -join '|') + ')-pre\.tdl$') }) + @($tdl) + @($postFiles | Where-Object { (Split-Path $_ -Leaf) -match ('^dp-(' + ($script:safeGroups -join '|') + ')\.tdl$') }))
    Info "dpath ${ph}: Tally did not come up with the company and the probe files: started again with $($script:safeGroups -join ', ') only"
    $script:dpStartNotes += "${ph}: Tally did not come up with all probe files; again with $($script:safeGroups -join ', ') only"
    DpIni $data $script:probeIni; $up = DpStart "$ph-safe"
  }
  DpTake $ph 'start'
  $null = TdsGateway "$ph steps"
  $v0 = Vouchers
  KeysTo 'v' 4 "dp-$ph-vouchers"; KeysTo '{F6}' 3; KeysTo '{F2}' 3; KeysTo "$d{ENTER}" 3
  KeysTo 'Cash{ENTER}' 3; KeysTo 'Spike Income{ENTER}' 3; KeysTo '700{ENTER}' 3; KeysTo '^a' 0; Start-Sleep 5; Shot "dp-$ph-created"
  $v1 = Vouchers; $a = @($v1 | Where-Object { $_.mid -notin @($v0 | ForEach-Object mid) })[0]
  DpTake $ph 'create'
  DpDayBook "dp-$ph-alt" $d; KeysTo '{END}' 2; KeysTo '{ENTER}' 4 "dp-$ph-open"
  KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '800{ENTER}' 2; KeysTo '^a' 0; Start-Sleep 5; Shot "dp-$ph-altered"
  $v2 = Vouchers; $aNow = if ($a) { @($v2 | Where-Object mid -eq $a.mid)[0] } else { $null }
  DpTake $ph 'alter'
  DpDayBook "dp-$ph-dup" $d; KeysTo '{END}' 2; KeysTo '%2' 4
  KeysTo '{ENTER}' 2; KeysTo '{ENTER}' 2; KeysTo '900{ENTER}' 2; KeysTo '^a' 0; Start-Sleep 5; Shot "dp-$ph-dup"
  $v3 = Vouchers; $b = @($v3 | Where-Object { $_.mid -notin @($v2 | ForEach-Object mid) })[0]
  DpTake $ph 'dup'
  DpDayBook "dp-$ph-can" $d; KeysTo '{HOME}' 2; KeysTo '%x' 3; KeysTo 'y' 0; Start-Sleep 4; Shot "dp-$ph-cancelled"
  $v4 = Vouchers; $c = @($v4 | Where-Object { $_.cancelled -and $_.mid -notin @($v3 | Where-Object cancelled | ForEach-Object mid) })[0]
  DpTake $ph 'cancel'
  DpDayBook "dp-$ph-del" $d; KeysTo '{END}' 2; KeysTo '%d' 3; KeysTo 'y' 0; Start-Sleep 4; Shot "dp-$ph-deleted"
  $v5 = Vouchers; $x = @($v4 | Where-Object { $_.mid -notin @($v5 | ForEach-Object mid) })[0]
  DpTake $ph 'delete'
  $e = "{0} ({1}\{9}, {2}): Tally up with the company {3}; created {4}; altered {5}; Alt+2 created {6}; cancelled {7}; deleted {8}" -f $ph, $data, $d, $up,
    $(if ($a) { "mid $($a.mid) guid $($a.guid)" } else { 'nothing (the keys)' }), $(if ($aNow -and $a -and $aNow.aid -gt $a.aid) { "AlterID $($a.aid) -> $($aNow.aid)" } else { 'nothing (the keys)' }),
    $(if ($b) { "mid $($b.mid)" } else { 'nothing (the keys)' }), $(if ($c) { "mid $($c.mid)" } else { 'nothing (the keys)' }), $(if ($x) { "mid $($x.mid)" } else { 'nothing (the keys)' }), $num
  Info "dpath $e"; $script:evid += $e
  $null = TdsGateway "$ph done"
  # each single formula asked by XML too (outside the events: the company current by SVCURRENTCOMPANY), each its own request
  foreach ($cd in $cands) {
    if ($cd.e -is [array]) { continue }
    $ex = SE $cd.e
    $ans = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DpEv</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DpEv" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH><COMPUTE>FCDPV : ' + $ex + '</COMPUTE></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' 20
    $val = [System.Net.WebUtility]::HtmlDecode([regex]::Match("$ans", '(?i)<FCDPV[^>]*>([^<]*)</FCDPV>').Groups[1].Value).Trim()
    $st = if (-not $ans) { "no answer in $($script:lastMs) ms" } elseif ($ans -notmatch '(?i)<FCDPV') { 'no FCDPV in the answer' } else { "'$val'" }
    $script:rows.Add([pscustomobject]@{ phase = $ph; step = 'xml'; f = $cd.f; ev = 'xml'; cg = ''; mid = ''; aid = ''; vt = ''; vno = ''; k = $cd.k; v = $(if ($ans -match '(?i)<FCDPV') { $val } else { "<$st>" }) })
    if (-not $ans) { Info "dpath ${ph}: the XML ask of $($cd.k) got no answer: Tally started again"; $null = DpStart "$ph-xml-restart" }
  }
}

# ---- P1 / P2
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 4
New-Item -ItemType Directory -Force $data2 | Out-Null
Copy-Item -Path $f1 -Destination $data2 -Recurse -Force
Info "dpath: folder 2 made: $f2 ($(@(Get-ChildItem $f2 -File -ErrorAction SilentlyContinue).Count) files, $([math]::Round(((Get-ChildItem $f2 -File -Recurse | Measure-Object Length -Sum).Sum) / 1KB)) KB; folder 1 $(@(Get-ChildItem $f1 -File).Count) files)"
$script:probeIni = @($preFiles) + @($tdl) + @($postFiles)
DpPhase 'P1' $data1 '2-10-2026'
DpPhase 'P2' $data2 '1-10-2026'
$err = @(Get-ChildItem $dir, $data1, $data2 -Recurse -File -Include *tdl*.log, tdlerr*, *error*.log -ErrorAction SilentlyContinue)
foreach ($f in $err) { Info "Tally file $($f.FullName): $((Get-Content $f.FullName -Tail 12) -join ' | ')"; Copy-Item $f.FullName (Join-Path $cap "tally-$($f.Name)") -ErrorAction SilentlyContinue }
$script:rows | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'dpath-probe-rows.json') -Encoding UTF8
Copy-Item $probeTxt (Join-Path $cap 'dpath-probe.txt') -ErrorAction SilentlyContinue

# ---- D2: per candidate
$ctx = [ordered]@{ 'created-pre' = @('create', 'dup', 'accept_pre'); 'created-post' = @('create', 'dup', 'accept_post'); 'altered-pre' = @('alter', '', 'accept_pre'); 'altered-post' = @('alter', '', 'accept_post')
  'cancel-before' = @('cancel', '', 'before_cancel'); 'cancel-after' = @('cancel', '', 'after_cancel'); 'delete-before' = @('delete', '', 'before_delete'); 'delete-after' = @('delete', '', 'after_delete') }
function Norm([string]$p) { $p.Trim().TrimEnd('\').ToLowerInvariant() }
$verdict = [ordered]@{}
foreach ($cd in $cands) {
  $k = $cd.k; $per = @{}; $desc = @()
  foreach ($ph in 'P1', 'P2') {
    $fold = if ($ph -eq 'P1') { $f1 } else { $f2 }
    $parts = @(); $vals = @(); $noLine = @(); $empty = @()
    foreach ($cn in $ctx.Keys) {
      $s = $ctx[$cn]; $r = @($script:rows | Where-Object { $_.phase -eq $ph -and $_.k -eq $k -and ($_.step -eq $s[0] -or ($s[1] -and $_.step -eq $s[1])) -and $_.ev -eq $s[2] })
      if (-not $r.Count) { $noLine += $cn; continue }
      foreach ($x in $r) { if ($x.v -eq '') { $empty += $cn } else { $vals += $x.v } }
      $parts += "$cn " + ((@($r | ForEach-Object { "'$($_.v)'" }) | Select-Object -Unique) -join '/')
    }
    $xml = @($script:rows | Where-Object { $_.phase -eq $ph -and $_.k -eq $k -and $_.step -eq 'xml' } | ForEach-Object { $_.v })
    $u = @($vals | Select-Object -Unique)
    $per[$ph] = [pscustomobject]@{ vals = $u; noLine = $noLine; empty = @($empty | Select-Object -Unique); folder = $fold; eq = ($u.Count -eq 1 -and (Norm $u[0]) -eq (Norm $fold)); hasNum = ($u.Count -ge 1 -and @($u | Where-Object { $_ -notmatch ('\\' + [regex]::Escape($num) + '\\?$') }).Count -eq 0) }
    $short = if ($u.Count -eq 1 -and -not $noLine.Count -and -not $empty.Count) { "all 8 contexts '$($u[0])'" } else { ($parts -join '; ') + $(if ($noLine.Count) { "; no line: $($noLine -join ', ')" } else { '' }) + $(if ($empty.Count) { "; EMPTY in: $((@($empty | Select-Object -Unique)) -join ', ')" } else { '' }) }
    $desc += "$ph ($fold): $short; XML '$(if ($xml.Count) { $xml[0] } else { '-' })'"
  }
  $p1 = $per['P1']; $p2 = $per['P2']
  $allCtx = -not $p1.noLine.Count -and -not $p2.noLine.Count -and -not $p1.empty.Count -and -not $p2.empty.Count -and $p1.vals.Count -ge 1 -and $p2.vals.Count -ge 1
  $postCtx = (@('created-post', 'altered-post', 'cancel-before', 'cancel-after', 'delete-before', 'delete-after') | Where-Object { $_ -in $p1.noLine -or $_ -in $p2.noLine -or $_ -in $p1.empty -or $_ -in $p2.empty }).Count -eq 0 -and $p1.vals.Count -ge 1 -and $p2.vals.Count -ge 1
  $differ = $p1.vals.Count -ge 1 -and $p2.vals.Count -ge 1 -and (@($p1.vals | Where-Object { (Norm $_) -in @($p2.vals | ForEach-Object { Norm $_ }) }).Count -eq 0)
  $verdict[$k] = [pscustomobject]@{ k = $k; e = $cd.e; all = $allCtx; post = $postCtx; differ = $differ; hasNum = ($p1.hasNum -and $p2.hasNum); eq = ($p1.eq -and $p2.eq); one = ($p1.vals.Count -eq 1 -and $p2.vals.Count -eq 1) }
  $ex = if ($cd.e -is [array]) { "($($cd.e[0])) + `"\`" + ($($cd.e[1]))" } else { $cd.e }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("MEASURE d1 candidate {0} [{1}]: {2}; every context has a value: {3} (all 8 incl. before the save) / {4} (after the save, cancel, delete); differs between the folders: {5}; the company number folder {6} in it: {7}; equals the folder Tally opened: {8}" -f `
      $k, $ex, ($desc -join ' | '), $allCtx, $postCtx, $differ, $num, ($p1.hasNum -and $p2.hasNum), ($p1.eq -and $p2.eq))
}
$verdict.Values | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $cap 'dpath-verdict.json') -Encoding UTF8
# the chosen formula: every context, one value per folder, different between the folders, the number folder in it, equal
# to the folder Tally opened (the owner's list first, in order)
$good = @($verdict.Values | Where-Object { $_.all -and $_.differ -and $_.hasNum -and $_.one } | Sort-Object -Stable { -not $_.eq })
$goodPost = @($verdict.Values | Where-Object { $_.post -and $_.differ -and $_.hasNum -and $_.one } | Sort-Object -Stable { -not $_.eq })
$pick = if ($good.Count) { $good[0] } elseif ($goodPost.Count) { $goodPost[0] } else { $null }
$ws = ($script:evid -join ' || ') + $(if ($script:dpStartNotes.Count) { "; at start: $($script:dpStartNotes -join '; ')" } else { '' })
if ($pick) { Result 'd1 the data folder formula in the add-on''s events' 'PASS' ("{0} [{1}]: every context{2}, one value per folder, different between the folders, the number folder in it, equal to the folder Tally opened: {6}; all that pass: {3}; after-the-save only: {4}; {5}" -f $pick.k, $(if ($pick.e -is [array]) { $pick.e -join ' + \ + ' } else { $pick.e }), $(if ($pick.all) { ' (all 8)' } else { ' after the save, cancel and delete (not before the save)' }), (@($good | ForEach-Object k) -join ', '), (@($goodPost | ForEach-Object k) -join ', '), $ws, $pick.eq) }
else { $why = if (@($script:rows | Where-Object { $_.step -ne 'xml' }).Count -eq 0) { 'HARNESS' } else { 'FAIL' }
  Result 'd1 the data folder formula in the add-on''s events' $why ("no candidate passes; differs between the folders: {0}; number folder in it: {1}; {2}" -f (@($verdict.Values | Where-Object differ | ForEach-Object k) -join ', '), (@($verdict.Values | Where-Object hasNum | ForEach-Object k) -join ', '), $ws) }

# ---- D3: save time, the ref's add-on against the same file with the field
$usePick = if ($pick) { $pick } else { $verdict['destnum'] }
$src = Get-Content $tdl
$var = @(); $ok1 = $false; $ok2 = $false
foreach ($l in $src) {
  $var += $l
  if (-not $ok1 -and $l -match '^\s*Variable\s*:\s*vLine\s*:\s*String') { $var += '    Variable  : vDP    : String'; $var += '    Variable  : vDN    : String'; $ok1 = $true }
  if (-not $ok2 -and $l -match '^\s*17\s*:\s*SET\s*:\s*vLine') {
    if ($usePick.e -is [array]) { $var += "    17a: SET    : vDP   : $($usePick.e[0])"; $var += "    17c: SET    : vDN   : $($usePick.e[1])"; $var += '    17d: SET    : vDP   : ##vDP + "\" + ##vDN' }
    else { $var += "    17a: SET    : vDP   : $($usePick.e)" }
    $var += '    17b: SET    : vLine : ##vLine + "|dpath=" + ##vDP'; $ok2 = $true
  }
}
$varTdl = Join-Path $pd 'FinComRecorder.tdl'; Set-Content $varTdl $var -Encoding ASCII; Copy-Item $varTdl (Join-Path $cap 'dpath-FinComRecorder-with-field.tdl')
Info "D3 the add-on with the field ($($usePick.k)): written $($ok1 -and $ok2) ($varTdl)"
function DpLen { $n = 0L; foreach ($f in @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue)) { $n += $f.Length }; $n }
function DpRec {
  $all = [Collections.Generic.List[string]]::new()
  foreach ($f in @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
    $ok = $false
    for ($t = 0; $t -lt 40 -and -not $ok; $t++) {
      try { $fs = [IO.FileStream]::new($f.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $sr = [IO.StreamReader]::new($fs, [Text.Encoding]::Unicode, $true); $txt = $sr.ReadToEnd() } finally { $fs.Dispose() }
        foreach ($l in ($txt -split "`r?`n")) { if ($l -like 'FCR1|*') { $all.Add($l) } }; $ok = $true
      } catch { Start-Sleep -Milliseconds 25 } }
    if (-not $ok) { return $null }
  }
  return , $all
}
$script:lastPost = ''
function DpSave($label, $day) {
  KeysTo '%g' 3; KeysTo 'Day Book' 2; KeysTo '{ENTER}' 6; KeysTo '{F2}' 3; KeysTo "$day{ENTER}" 8 "dp-$label-daybook"
  KeysTo '{END}' 3; KeysTo '%2' 6 "dp-$label-dup"
  $base = DpRec; if ($null -eq $base) { KeysTo '{ESC}' 2; return -1 }
  $c0 = $base.Count
  $p = Get-Process -Id $script:tpid -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { return -1 }
  [W32V]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W32V]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 500
  $seen = DpLen; $pending = $false; $tDet = -1; $ms = -1
  $sw = [Diagnostics.Stopwatch]::StartNew(); [System.Windows.Forms.SendKeys]::SendWait('^a')
  while ($sw.Elapsed.TotalSeconds -lt 60) {
    $l = DpLen
    if ($l -ne $seen) { $seen = $l; $tDet = [int]$sw.Elapsed.TotalMilliseconds; $pending = $true }
    if ($pending) {
      $now = DpRec
      if ($null -ne $now) {
        $pending = $false
        $new = @($now | Select-Object -Skip $c0 | Where-Object { $_ -like 'FCR1|ev=voucher_accept_post|*' -and $_ -like '*|src=live' })
        if ($new.Count) { $ms = $tDet; $script:lastPost = $new[-1]; break }
      }
    }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep 2; Shot "dp-$label-saved"; KeysTo '{ESC}' 2
  return $ms
}
$sets = @(@('receipt', '1-11-2026', 'receipt'), @('sales50', '1-12-2026', 'sales invoice of 50 items'))
$arms = [ordered]@{}; $armLine = @{}
foreach ($arm in @(@('current', $tdl), @('field', $varTdl), @('current2', $tdl))) {
  if ($arm[0] -eq 'field' -and -not ($ok1 -and $ok2)) { continue }
  DpIni $data2 $arm[1]; $null = DpStart "D3-$($arm[0])"; $null = TdsGateway "D3 $($arm[0])"
  $r = @{}
  foreach ($s in $sets) {
    $r[$s[0]] = @(); if (-not $setOk[$s[0]]) { continue }
    $null = DpSave "$($arm[0])-$($s[0])-warm" $s[1]
    for ($j = 1; $j -le 5; $j++) { $r[$s[0]] += DpSave "$($arm[0])-$($s[0])$j" $s[1] }
  }
  $arms[$arm[0]] = $r; $armLine[$arm[0]] = $script:lastPost
}
$fieldLine = "$($armLine['field'])"; $fv = [regex]::Match($fieldLine, '\|dpath=([^|]*)\|').Groups[1].Value
Info "D3 the last voucher_accept_post line with the field: $(if ($fieldLine) { $fieldLine.Substring(0, [Math]::Min(500, $fieldLine.Length)) } else { '-' })"
$med = { param($a) $s = @($a | Where-Object { $_ -ge 0 } | Sort-Object); if ($s.Count -ge 3) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { -1 } }
foreach ($s in $sets) {
  $a = @(if ($arms.Contains('current')) { $arms['current'][$s[0]] }); $b = @(if ($arms.Contains('field')) { $arms['field'][$s[0]] }); $a2 = @(if ($arms.Contains('current2')) { $arms['current2'][$s[0]] })
  $mA = & $med $a; $mB = & $med $b; $mA2 = & $med $a2
  $base = @(@($mA, $mA2) | Where-Object { $_ -ge 0 }); $mBase = if ($base.Count) { [int](($base | Measure-Object -Average).Average) } else { -1 }
  $d = if ($mB -ge 0 -and $mBase -ge 0) { $mB - $mBase } else { $null }
  $flag = if ($null -eq $d) { '' } elseif ($d -gt 50) { '; OVER 0.05 s' } else { '; within 0.05 s' }
  $st = if ($null -eq $d) { 'HARNESS' } else { 'MEASURE' }
  Add-Content -Path $resultsFile -Encoding UTF8 -Value ("{0} d3 save time {1} ({2}): Ctrl+A to the add-on's voucher_accept_post line: current add-on {3} ms, median {4}; with the field '{5}' {6} ms, median {7}; current again {8} ms, median {9}; the field's share: {10} ms (against the mean of the two current medians, {11} ms; current vs current again: {12} ms){13}; the field written: '{14}'" -f `
      $st, $s[2], $usePick.k, ($a -join ', '), $mA, $(if ($usePick.e -is [array]) { $usePick.e -join ' + \ + ' } else { $usePick.e }), ($b -join ', '), $mB, ($a2 -join ', '), $mA2, $(if ($null -ne $d) { $d } else { '-' }), $mBase, $(if ($mA -ge 0 -and $mA2 -ge 0) { $mA2 - $mA } else { '-' }), $flag, $fv)
}
$fe = (Norm $fv) -eq (Norm $f2)
Result 'd2 the add-on with the field writes the folder' $(if (-not $fieldLine) { 'HARNESS' } elseif ($fe) { 'PASS' } else { 'FAIL' }) ("formula {0}; the add-on's own line on folder 2 carries dpath='{1}' (the folder Tally opened: {2}; equal: {3})" -f $usePick.k, $fv, $f2, $fe)
Set-Content (Join-Path $out 'tds-screens.log') $script:tdsLog -Encoding UTF8
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
