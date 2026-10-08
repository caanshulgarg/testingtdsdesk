# Mode renum (branch next-renumber, the owner's decision of 08-Oct-2026 "renumbering yes"): a receipt inserted, then one
# deleted, on Tally's own screens with the Receipt type set to renumber (P9r of sharev.ps1: Tally then renumbers every later
# receipt with no line for them and no AlterID moved). Dot-sourced by flowv.ps1 after the bridge (built from the ref) is set
# up with stubr.py as FinCom's cloud: stubr.py keeps FinCom's copy of the entries (seeded with Tally's receipts before the
# insert, as from a Day Book upload; then changed only by the bridge's recorder lines) and answers tally-ingest's
# renumber_list as the cloud does. Checks:
#   r1 insert with renumbering on: after the insert, FinCom's copy holds Tally's number for every receipt (the renumbered
#      ones included), within 4 minutes
#   r2 delete with renumbering on: the same after a receipt in the middle is deleted
# Evidence per check: each renumbered receipt (old -> new number, AlterID, FinCom's number at the end), the bridge's
# renumber_list asks and its altered lines (source "renumber"), the bridge log's "Renumbering:" lines. Keys that made no
# insert / delete, or a Tally that renumbered nothing: HARNESS, never PASS.
Say '---- renum: an insert and a delete with renumbering on; FinCom ends with Tally''s numbers'
. (Join-Path $PSScriptRoot 'tdslib.ps1')
$script:TdsSend = { param([string]$k) KeysTo $k 0 }
$script:TdsPost = { param([string]$x) Post $x }
$script:TdsCo = $co1
$script:TdsRestart = {
  Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
  $t = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru; $script:tpid = $t.Id
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; try { Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
  Start-Sleep 5; KeysTo 'a' 4; KeysTo 't' 10 'renum-restarted'
}
function RSubs($tag) {
  for ($j = 1; $j -le 4; $j++) {
    $t = TdsScreen "$tag-sub$j"
    if ($t -match 'Cost Centre|Cost Category|Bank Allocation|Bank Details|Transaction Type|Dispatch|Receipt Details|Party Details') { $null = TK '^a' 2 "$tag-sub-accept"; continue }
    return
  }
}
function RAccept($tag) {
  for ($a = 1; $a -le 3; $a++) {
    $null = TK '^a' 3 "$tag-accept$a"
    $t = TdsScreen "$tag-after$a"
    if ($t -match 'Accept \?|Yes or No') { & $script:TdsSend 'y'; Start-Sleep 3; continue }
    if ($t -match 'Voucher Creati|Voucher Alterati|ccounting Voucher|Bank Allocation') { continue }
    break
  }
  $null = TdsGateway "after $tag"
}
# the Day Book of a date, receipts only, at its first receipt
function RDayBook($tag, $date) {
  $null = TdsGateway "before $tag"
  $null = TK '%g' 2 "$tag-goto"; $null = TK 'Day Book' 1.5; $null = TK '{ENTER}' 3 "$tag-daybook" 'Day Book'
  $null = TK '{F2}' 1.5 "$tag-db-date"; $null = TK ((SK $date) + '{ENTER}') 3 "$tag-db-dated"
  $null = TK '{F4}' 2 "$tag-db-type"; $null = TK 'Receipt{ENTER}' 3 "$tag-db-typed"
  $null = TK '{HOME}' 1.5 "$tag-db-first"
}
$tg = { param($x, $t) [System.Net.WebUtility]::HtmlDecode([regex]::Match("$x", "<$t(?:\s[^>]*)?>([^<]*)</$t>").Groups[1].Value).Trim() }
function Receipts {
  $x = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>RenR</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="RenR" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, VOUCHERNUMBER, DATE, VOUCHERTYPENAME</FETCH><FILTERS>RenRF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="RenRF">$VoucherTypeName = "Receipt"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>')
  return , @(foreach ($v in [regex]::Matches("$x", '(?s)<VOUCHER [^>]*>.*?</VOUCHER>')) { [pscustomobject]@{ guid = (& $tg $v.Value 'GUID'); mid = [int64]('0' + (& $tg $v.Value 'MASTERID')); vno = (& $tg $v.Value 'VOUCHERNUMBER'); aid = [int64]('0' + (& $tg $v.Value 'ALTERID')); day = (& $tg $v.Value 'DATE'); type = (& $tg $v.Value 'VOUCHERTYPENAME') } })
}
# (run 37765133379: Invoke-RestMethod's JSON array came back as ONE object holding the array, so every receipt "differed";
# the array is read as text and its items taken one by one)
function StubCopy { try { $j = (Invoke-WebRequest 'http://127.0.0.1:8787/copy' -UseBasicParsing -TimeoutSec 20).Content; return , @(($j | ConvertFrom-Json) | ForEach-Object { $_ }) } catch { return , @() } }
function StubPost($o) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/' -Method Post -Body ($o | ConvertTo-Json -Depth 6 -Compress) -ContentType 'application/json' -TimeoutSec 20 } catch { Write-Host "stub: $_" } }
function RList($rs) { ($rs | Sort-Object day, mid | ForEach-Object { "mid $($_.mid) no $($_.vno) of $($_.day) AlterID $($_.aid)" }) -join '; ' }
$altv = { [int64]('0' + [regex]::Match((Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>RenAlt</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="RenAlt" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, ALTVCHID</FETCH><FILTERS>RenAltF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="RenAltF">$Name = "' + $co1 + '"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') ''), '<ALTVCHID[^>]*>\s*(\d+)').Groups[1].Value) }

try {
  # 0. the bridge's starting point first (its first light check): the receipts made after it are above it, so the bridge
  # may name them (security M1: nothing at or below the starting point is ever sent)
  $spSeen = $false
  for ($i = 0; $i -lt 60 -and -not $spSeen; $i++) { if (Test-Path $blog) { $spSeen = [bool](Select-String -Path $blog -Pattern 'starting point (is )?recorded' -Quiet) }; if (-not $spSeen) { Start-Sleep 3 } }
  Info "renum: the bridge's starting point recorded before the receipts: $spSeen"
  # 1. the Receipt type renumbers (P9r: NUMBERINGSUBMETHOD 'Auto Renumber', checked by exporting the type again)
  $vtq = { Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>RenVT</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co1 + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="RenVT" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>*</FETCH><FILTERS>RenVTF</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="RenVTF">$Name = "Receipt"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' }
  $sub = { param($x) [regex]::Match("$x", '(?s)<VOUCHERNUMBERSERIES\.LIST>.*?<NUMBERINGSUBMETHOD[^>]*>([^<]*)<').Groups[1].Value.Trim() }
  $vt0 = & $vtq; $sm0 = & $sub $vt0
  $null = Imp 'All Masters' '<VOUCHERTYPE NAME="Receipt" ACTION="Alter"><NAME.LIST><NAME>Receipt</NAME></NAME.LIST><VOUCHERNUMBERSERIES.LIST><NAME>Default</NAME><NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD><NUMBERINGSUBMETHOD>Auto Renumber</NUMBERINGSUBMETHOD></VOUCHERNUMBERSERIES.LIST></VOUCHERTYPE>' 'renum sub-method'
  $vt1 = & $vtq; $sm1 = & $sub $vt1
  Set-Content (Join-Path $cap 'renum-vouchertype-after.xml') $vt1 -Encoding UTF8
  Info "renum: the Receipt type's numbering sub-method '$sm0' -> '$sm1'"
  # 2. five receipts by XML (Educational mode takes the 1st, 2nd and 31st only): 1-10 (2), 2-10 (2), 31-10 (1)
  $rv = { param($d, $no, $amt) '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>' + $d + '</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><NARRATION>renum seed ' + $no + '</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' }
  $ir = Imp 'Vouchers' ((& $rv '20261001' '1' 101) + (& $rv '20261001' '2' 102) + (& $rv '20261002' '3' 103) + (& $rv '20261002' '4' 104) + (& $rv '20261031' '5' 105)) 'renum receipts'
  Info "renum: five receipts by XML: $(([regex]::Match("$ir", '<CREATED>\d+</CREATED>.*?<ERRORS>\d+</ERRORS>', 'Singleline').Value) -replace '\s+', ' ')"
  Start-Sleep 20
  $r0 = Receipts
  # FinCom holds them (as from a Day Book upload): the copy seeded with Tally's own list
  $null = StubPost @{ kind = '_seed'; entries = @($r0 | ForEach-Object { @{ mid = $_.mid; guid = $_.guid; day = $_.day; no = $_.vno; alter = $_.aid; type = 'Receipt' } }) }
  Info "renum: Tally's receipts (FinCom's copy seeded with them): $(RList $r0)"
  Snap 'renum-seeded'

  foreach ($step in 'insert', 'delete') {
    $tag = if ($step -eq 'insert') { 'r1' } else { 'r2' }
    $check = "$tag $step with renumbering on"
    $r0 = Receipts; $a0 = & $altv; $m0 = Mark
    RDayBook "$tag-db" '2-10-2026'
    if ($step -eq 'insert') {
      # Alt+I at the first receipt of 2-10-2026: a receipt inserted before it, numbered in its place
      $null = TK '%i' 3 "$tag-insert" 'Receipt|Creation|Insert'
      $null = TK 'Cash{ENTER}' 2 "$tag-account"; RSubs "$tag-acc"
      $null = TK 'Spike Income{ENTER}' 2 "$tag-ledger"; RSubs "$tag-led"
      $null = TK '70{ENTER}' 2 "$tag-amount"; RSubs "$tag-amt"
      $null = TK '{ENTER}' 2 "$tag-rows-done"; RSubs "$tag-done"
      $null = TK 'renum insert{ENTER}' 2 "$tag-narr"
      RAccept $tag
    } else {
      # the second receipt of 2-10-2026 (one in the middle) deleted
      $null = TK '{DOWN}' 1.5 "$tag-down"
      $null = TK '%d' 3 "$tag-delete-q"; $t = TdsScreen "$tag-delete-ask"; if ($t -match 'Yes or No|Delete') { & $script:TdsSend 'y'; Start-Sleep 3 }
      $null = TdsGateway "after $tag"
    }
    $t0 = Get-Date
    $r1 = Receipts; $a1 = & $altv
    $mx = (@($r0 | ForEach-Object mid) + 0 | Measure-Object -Maximum).Maximum
    $did = if ($step -eq 'insert') { @($r1 | Where-Object { $_.mid -gt $mx }).Count -eq 1 } else { $r1.Count -eq $r0.Count - 1 }
    $ren = @($r1 | Where-Object { $o = $_; $p0 = @($r0 | Where-Object mid -eq $o.mid)[0]; $p0 -and $p0.vno -ne $o.vno })
    # FinCom's copy until it holds Tally's number for every receipt (4 minutes at most)
    $cp = @(); $miss = @($r1)
    $until = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $until) {
      $cp = StubCopy
      $miss = @($r1 | Where-Object { $o = $_; $c = @($cp | Where-Object { $_.guid -eq $o.guid })[0]; -not $c -or $c.no -ne $o.vno })
      $gone = @($cp | Where-Object { $_.type -eq 'Receipt' -and $_.guid -notin @($r1 | ForEach-Object guid) })
      if ($did -and -not $miss.Count -and -not $gone.Count) { break }
      Start-Sleep 5
    }
    $sec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 0)
    Snap "renum-$tag"
    $reqs = @(StubReqs | Select-Object -Skip $m0)
    $asks = @($reqs | Where-Object kind -eq 'renumber_list')
    $alt = @($reqs | Where-Object kind -eq 'recorder_lines' | ForEach-Object { @($_.body.lines) } | Where-Object { $_.source -eq 'renumber' })
    $logl = @(Get-Content (Join-Path $out "bridge-log-renum-$tag.txt") -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Renumbering:' })
    $each = @(foreach ($o in $ren) { $p0 = @($r0 | Where-Object mid -eq $o.mid)[0]; $c = @($cp | Where-Object { $_.guid -eq $o.guid })[0]
      "mid $($o.mid) $($p0.vno) -> $($o.vno) (AlterID $($p0.aid) -> $($o.aid)), FinCom's number $(if ($c) { $c.no } else { '(none)' })" })
    $st = if (-not $did -or -not $ren.Count) { 'HARNESS' } elseif ($miss.Count -or $gone.Count) { 'FAIL' } else { 'PASS' }
    Result $check $st ("the {0} {1}; ALTVCHID {2} -> {3}; Tally renumbered {4}: {5}; FinCom's copy {6} after {7} s{8}; renumber_list asked {9} time(s); {10} altered line(s) from the bridge (source renumber): {11}; bridge log: {12}" -f
      $step, $(if ($did) { 'made' } else { 'NOT made by the keys' }), $a0, $a1, $ren.Count, $(if ($each.Count) { $each -join '; ' } else { '-' }),
      $(if ($miss.Count -or $gone.Count) { "differs from Tally for $($miss.Count) receipt(s) ($(RList $miss))$(if ($gone.Count) { " and holds $($gone.Count) receipt(s) Tally has not" })" } else { "holds Tally's number for every receipt ($($r1.Count))" }), $sec,
      '', $asks.Count, $alt.Count, (($alt | ForEach-Object { "mid $($_.master_id) no $($_.vch_no)" }) -join ', '), $(if ($logl.Count) { ($logl | ForEach-Object { ($_ -replace '^.*?Renumbering: ', '') }) -join ' | ' } else { '(no Renumbering line)' }))
    StubCopy | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap "renum-$tag-fincom-copy.json") -Encoding UTF8
    $r1 | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cap "renum-$tag-tally.json") -Encoding UTF8
  }
} catch { Result 'r1 insert with renumbering on' 'HARNESS' "the harness stopped: $_" }
Copy-Item $blog (Join-Path $out 'bridge-full.log') -ErrorAction SilentlyContinue
Copy-Item $stubLog (Join-Path $cap 'stub-requests.jsonl') -ErrorAction SilentlyContinue
Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $cap "recorder-file-$($_.Name)") }
