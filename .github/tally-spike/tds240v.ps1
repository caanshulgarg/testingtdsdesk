# Mode tds240 (2.4.0's gate, next-tds: "TDS details: the whole TDS list"; migration 62). Dot-sourced by flowv.ps1 after the
# bridge's setup (stubv.py as FinCom's cloud). A TDS payment typed on Tally's own screens (push design v3's S5 keys, each
# screen read by OCR, tdslib.ps1): the company's TDS on and its TAN (XML), the nature of payment 194C on its own form, the
# party / expense / TDS ledgers (XML), then a Journal: Dr the expense 100000, To the TDS ledger (Tally's own 2,000), To the
# party 98000. The bridge's line for it reaches the stub with Tally's entry; that body read by the cloud's parser at the ref
# (tdscheck.mjs, parse.js parseDay):
#   t1 the TDS details carried: FinCom's TDS list has the nature, the party, the assessable amount and the tax Tally stored
#      (Tally's own export of the entry, by its narration), and the section where Tally's bill-wise detail has one
#   t2 the rate: where Tally stored 0 on a line NOT marked exempt, worked out (tax / assessable x 100) and marked
#      rateWorkedOut; a line Tally marked exempt (EXEMPTED Yes) keeps Tally's rate and is never marked worked out; a rate
#      Tally stored is kept as stored. Which case each line was is said in the evidence.
Say '---- tds240: a TDS payment typed on the screen, its TDS details in FinCom'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x '' 30 }
$script:TdsCo = $co1
$script:TdsRestart = {
  if ($script:tpid) { Stop-Process -Id $script:tpid -Force -ErrorAction SilentlyContinue }; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'tds-restarted'
}
$CT1 = 't1 TDS typed on the screen: the TDS details carried to FinCom'; $CT2 = 't2 TDS rate: worked out only where Tally stores 0, never on an exempt line'
$tdDone = @{}
function TdRes($c, $st, $ev) { if (-not $tdDone[$c]) { Result $c $st $ev; $tdDone[$c] = $true } }
$N = [ordered]@{ nature = 'GT Contract Work'; party = 'GT TDS Contractor'; exp = 'GT Contract Exp'; tds = 'GT TDS Payable' }
$narr = 'GT240 TDS typed on the screen'
function Num($s) { $x = "$s" -replace '[^\d.\-]', ''; if ($x -match '^-?\d+(\.\d+)?$') { [double]$x } else { $null } }
try {
  # masters: the company's TDS and TAN (XML), the nature on its own form, the ledgers (XML), as push design v3
  $c = '<COMPANY NAME="' + $co1 + '" ACTION="Alter"><NAME>' + $co1 + '</NAME><ISTDSON>Yes</ISTDSON><TANUMBER>DELF01234E</TANUMBER><TANREGNO>DELF01234E</TANREGNO><TDSDEDUCTORTYPE>Company</TDSDEDUCTORTYPE></COMPANY>'
  $null = Imp 'All Masters' $c 'tds240: company TDS on, TAN'
  $natOk = $false; try { $natOk = TdsNatureScreen $N.nature '194C' '94C' '1' '2' } catch { Write-Host "tds240 nature form: $_" }
  Info "tds240: the nature '$($N.nature)' as a TDS Rate in Tally: $natOk"
  $led = ('<LEDGER NAME="' + $N.party + '" ACTION="Create"><NAME.LIST><NAME>' + $N.party + '</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><ISBILLWISEON>No</ISBILLWISEON><INCOMETAXNUMBER>AAACP2310K</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><DEDUCTINSAMEVCHRULES.LIST><DATE>20260401</DATE><DEDUCTINSAMEVCH>Yes</DEDUCTINSAMEVCH></DEDUCTINSAMEVCHRULES.LIST></LEDGER>') +
    ('<LEDGER NAME="' + $N.exp + '" ACTION="Create"><NAME.LIST><NAME>' + $N.exp + '</NAME></NAME.LIST><PARENT>Indirect Expenses</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><ISTDSEXPENSE>Yes</ISTDSEXPENSE><TDSAPPLICABLE>' + $N.nature + '</TDSAPPLICABLE><TDSCATEGORYNAME>' + $N.nature + '</TDSCATEGORYNAME><TDSRATENAME>' + $N.nature + '</TDSRATENAME></LEDGER>') +
    ('<LEDGER NAME="' + $N.tds + '" ACTION="Create"><NAME.LIST><NAME>' + $N.tds + '</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><ISCOSTCENTRESON>No</ISCOSTCENTRESON><TAXTYPE>TDS</TAXTYPE><TDSRATENAME>' + $N.nature + '</TDSRATENAME><TDSCATEGORYNAME>' + $N.nature + '</TDSCATEGORYNAME></LEDGER>')
  $lr = Imp 'All Masters' $led 'tds240: party, expense, TDS ledger'
  Info "tds240: ledgers: $(([regex]::Match("$lr", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
  # the Journal on the screen (push design v3's V3Tds keys, each screen read by OCR)
  $v0 = Vouchers; $m0 = Mark
  $null = TdsGateway 'before the TDS entry'
  $null = TK 'v' 2.5 'gt-vouchers' 'Voucher'
  $null = TK '{F7}' 2.5 'gt-journal' 'Journal'
  $null = TK '{F2}' 1.5 'gt-date-box' 'Date'
  $null = TK '2-11-2026{ENTER}' 2 'gt-date-set'
  $null = TK ((SK $N.exp) + '{ENTER}') 2 'gt-r1-ledger'
  $null = TK '100000{ENTER}' 2 'gt-r1-amount'
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "gt-r1-after$j"; if ($t -match 'Cost Centre Alloc|Cost Allocations|Details for|Bill-wise|Assessable|Nature of Pay|Tax Details') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $null = TK 't{ENTER}' 1.5 'gt-r2-to'
  $null = TK ((SK $N.tds) + '{ENTER}') 2.5 'gt-r2-ledger'
  for ($j = 1; $j -le 5; $j++) { $t = TdsScreen "gt-r2-sub$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Deductee|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $t = TdsScreen 'gt-r2-amount-shown'; $byTally = $t -match '2,000|2000'
  if (-not $byTally -and $t -match '\d ?%') { $null = TK '{ENTER}' 2 'gt-r2-pct'; $t = TdsScreen 'gt-r2-amount-shown2'; $byTally = $t -match '2,000|2000' }
  if ($byTally) { $null = TK '{ENTER}' 2 'gt-r2-amount-tally' } else { $null = TK '2000{ENTER}' 2 'gt-r2-amount-typed' }
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "gt-r2-after$j"; if ($t -match 'Details for|Bill-wise|Assessable|Nature of Pay|Nature ef Pay|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $null = TK 't{ENTER}' 1.5 'gt-r3-to'
  $null = TK ((SK $N.party) + '{ENTER}') 2.5 'gt-r3-ledger'
  $t = TdsScreen 'gt-r3-amount-shown'
  if ($t -match '98,000|98000') { $null = TK '{ENTER}' 2 'gt-r3-amount' } else { $null = TK '98000{ENTER}' 2 'gt-r3-amount-typed' }
  for ($j = 1; $j -le 4; $j++) { $t = TdsScreen "gt-r3-after$j"; if ($t -match 'Details for|Bill-wise|Assessable|Party Details|Tax Details|Cost Centre Alloc|Cost Allocations') { & $script:TdsSend '{ENTER}'; Start-Sleep 2 } else { break } }
  $t = TdsScreen 'gt-before-narration'
  if ($t -notmatch 'Narration') { $null = TK '{ENTER}' 2 'gt-rows-done' }
  $null = TK ((SK $narr) + '{ENTER}') 2 'gt-narration'
  $t = TdsScreen 'gt-accept-q'
  if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 'gt-accepted' } else { $null = TK '^a' 3 'gt-ctrl-a'; $t = TdsScreen 'gt-accept-q2'; if ($t -match 'Accept|Yes or No') { $null = TK 'y' 3 'gt-accepted2' } }
  Set-Content (Join-Path $out 'tds-screen-log.txt') $script:tdsLog -Encoding UTF8
  $null = TdsGateway 'after the TDS entry'
  $v1 = Vouchers
  $nv = @(foreach ($v in $v1) { if ("$($v.mid)" -notin @($v0 | ForEach-Object { "$($_.mid)" })) { $v } })
  if (-not $nv.Count) { throw "the keys saved no entry (TDS row amount $(if ($byTally) { 'by Tally' } else { 'typed' }); see the tds-gt-* screens)" }
  $v = $nv[0]; $mid = TdsMid $v.mid
  Info "tds240: the entry saved: $($v.type) no $($v.vno) mid $mid guid $($v.guid); the TDS row's amount $(if ($byTally) { 'put there by Tally' } else { 'typed (2000)' })"
  # Tally's own stored entry (by its narration) and the bridge's line with Tally's entry
  $tx = "$(TdsVoucherExport $narr)"; Set-Content (Join-Path $cap 'tds240-tally-entry.xml') $tx -Encoding UTF8
  $ta = @([regex]::Matches($tx, '(?s)<TAXOBJECTALLOCATIONS\.LIST>(.*?)</TAXOBJECTALLOCATIONS\.LIST>') | ForEach-Object {
      $b = $_.Groups[1].Value; $subs = @([regex]::Matches($b, '(?s)<SUBCATEGORYALLOCATION\.LIST>(.*?)</SUBCATEGORYALLOCATION\.LIST>') | ForEach-Object { $_.Groups[1].Value }); $sub = @($subs | Where-Object { $_ -match '<SUBCATEGORY[^>]*>\s*Income\s*Tax\s*<' })[0]; if (-not $sub) { $sub = @($subs)[0] }; $src = if ($sub) { $sub } else { $b }
      [pscustomobject]@{ nature = [regex]::Match($b, '<CATEGORY[^>]*>([^<]*)<').Groups[1].Value.Trim(); party = [regex]::Match($b, '<PARTYLEDGER[^>]*>([^<]*)<').Groups[1].Value.Trim(); exempt = [regex]::Match($b, '<EXEMPTED[^>]*>([^<]*)<').Groups[1].Value.Trim()
        rate = (Num ([regex]::Match($src, '<TAXRATE[^>]*>([^<]*)<').Groups[1].Value)); base = (Num ([regex]::Match($src, '<ASSESSABLEAMOUNT[^>]*>([^<]*)<').Groups[1].Value)); tax = (Num ([regex]::Match($src, '<TAX[^A-Z>]*>([^<]*)<').Groups[1].Value)) } } | Where-Object { $_.nature })
  $g = $v.guid
  $hit = WaitLine 0 { $_.guid -eq $g -and $_.xml } (Get-Date) 180
  $line = @($hit | Select-Object -Last 1)[0]
  if (-not $line) { $sl = StubLines 0; TdRes $CT1 'FAIL' ("no line with Tally's entry for {0} in 180 s; its lines: {1}" -f $g, ((@($sl | Where-Object { $_.guid -eq $g }) | ForEach-Object { Ev $_ }) -join ' | ')); TdRes $CT2 'FAIL' 'no body to read'; throw 'skip' }
  Set-Content (Join-Path $cap 'tds240-fincom-body.xml') $line.xml -Encoding UTF8
  $pin = Join-Path $out 'tds240-in.json'; $pout = Join-Path $out 'tds240-out.json'
  [IO.File]::WriteAllText($pin, (@{ guid = $g; xml = $line.xml } | ConvertTo-Json -Compress -Depth 3), [Text.UTF8Encoding]::new($false))
  $parseJs = Join-Path $env:BRIDGE_DIST 'cloud\tally-cloud\parse.js'
  if (-not (Test-Path $parseJs)) { throw "no parse.js from the ref in bridge-dist" }
  & node (Join-Path $PSScriptRoot 'tdscheck.mjs') $parseJs $pin $pout 2>&1 | ForEach-Object { Write-Host "  $_" }
  $pr = Get-Content $pout -Raw | ConvertFrom-Json
  if (-not $pr.ok) { throw "parse.js did not read the body: $($pr.error)" }
  $ft = @($pr.tds)
  # t1: each of Tally's TDS allocations in FinCom's list: the nature, the party, the assessable amount, the tax
  $miss = @(); foreach ($a in $ta) {
    $m = @($ft | Where-Object { $_.nature -eq $a.nature -and ($null -eq $a.base -or [math]::Abs([double]$_.base - [math]::Abs($a.base)) -lt 0.01) -and ($null -eq $a.tax -or [math]::Abs([double]$_.tax - [math]::Abs($a.tax)) -lt 0.01) -and (-not $a.party -or $_.party -eq $a.party) })
    if (-not $m.Count) { $miss += "$($a.nature) base $($a.base) tax $($a.tax) party '$($a.party)'" } }
  $desc = { param($x) "nature '$($x.nature)' party '$($x.party)' section '$($x.section)' ($($x.sectionFrom)) base $($x.base) tax $($x.tax) rate $($x.rate)$(if ($x.rateWorkedOut) { ' rateWorkedOut' })$(if ($x.exempt) { ' exempt' })" }
  TdRes $CT1 $(if ($ta.Count -and $ft.Count -and -not $miss.Count) { 'PASS' } elseif (-not $ta.Count) { 'HARNESS' } else { 'FAIL' }) ("Tally stored {0} TDS allocation(s): {1}; FinCom's TDS list from the bridge's line ({2}, {3} chars): {4}; not carried: {5}" -f `
      $ta.Count, (($ta | ForEach-Object { "nature '$($_.nature)' party '$($_.party)' base $($_.base) tax $($_.tax) rate $($_.rate) exempted '$($_.exempt)'" }) -join ' | '), $line.ev, $line.xml.Length, $(if ($ft.Count) { ($ft | ForEach-Object { & $desc $_ }) -join ' | ' } else { 'empty' }), $(if ($miss.Count) { $miss -join ', ' } else { 'none' }))
  # t2: the rate rule, line by line
  $bad = @(); $cases = @()
  foreach ($x in $ft) {
    $tr = @($ta | Where-Object { $_.nature -eq $x.nature })[0]
    $stored = if ($tr) { $tr.rate } else { $null }
    if ($x.exempt) { $cases += "exempt (Tally's rate $stored): kept, not worked out"; if ($x.rateWorkedOut) { $bad += "an exempt line marked worked out: $(& $desc $x)" } }
    elseif (-not $stored) {
      $want = if ($x.base) { [math]::Round([math]::Abs([double]$x.tax / [double]$x.base) * 100, 4) } else { $null }
      $cases += "Tally stored 0: worked out $($x.rate) (tax/base x 100 = $want)"
      if (-not $x.rateWorkedOut -or $null -eq $want -or [math]::Abs([double]$x.rate - $want) -gt 0.0001) { $bad += "Tally stored 0, not worked out right: $(& $desc $x)" } }
    else { $cases += "Tally stored $stored`: kept"; if ($x.rateWorkedOut -or [math]::Abs([double]$x.rate - [double]$stored) -gt 0.0001) { $bad += "Tally's rate $stored not kept: $(& $desc $x)" } }
  }
  $anyEx = @($ft | Where-Object { $_.exempt }).Count
  TdRes $CT2 $(if ($ft.Count -and -not $bad.Count) { 'PASS' } elseif (-not $ft.Count) { 'FAIL' } else { 'FAIL' }) ("{0} TDS line(s): {1}; an exempt line on this release: {2}; wrong: {3}" -f $ft.Count, ($cases -join ' | '), $(if ($anyEx) { "yes ($anyEx)" } else { 'no (Tally did not mark the typed line exempt)' }), $(if ($bad.Count) { $bad -join ' | ' } else { 'none' }))
} catch {
  if ("$_" -ne 'skip') { Write-Host "tds240 stopped: $_ $($_.ScriptStackTrace)" }
  foreach ($c in @($CT1, $CT2)) { TdRes $c 'HARNESS' "the harness stopped: $_" }
}
Snap 'tds240-end'
