# fast234r.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234r,
# after the light company's setup (features on: payroll; the types' masters: employees PD Emp 001.., pay heads PD Basic
# and PD HRA, PD Salary Payable). The coordinator's re-review of 2.3.4 (08-Oct-2026):
#   M2  an item invoice whose sales ledger is ALSO a direct ledger line (freight booked to Sales): asked three ways
#   L1  a payroll voucher typed on Tally's own Payroll screen (pay heads under each employee): asked three ways
# Each answer kept (captures\r-*.xml) for the bridge's strip, parse.js and the stored rows.
. "$here\fast234.ps1"   # its request templates (it returns before its own run in this mode)
. "$here\v3.ps1"        # the screen route (tdslib.ps1: TK, TdsScreen, TdsGateway, SK)
$script:co = $co
$rD = '20261101'; $rDay = '1-11-2026'
function RV {
  $x = Post (Coll 'FCPRV' 'Voucher' 'GUID, MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION' '$Date = $$Date:"01-11-2026"') '' 120
  $o = @()
  foreach ($m in [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value
    if ($mid -notmatch '^\d+$') { continue }
    $o += [pscustomobject]@{ mid = $mid; type = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value); vno = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value); narr = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<NARRATION[^>]*>([^<]*)').Groups[1].Value) }
  }
  return , $o
}
function R3($kind, $v) {
  if (-not $v) { Say "R ${kind}: not made"; return }
  $forms = [ordered]@{ object = ($tplOBJ.Replace('@@CO@@', (X $co)).Replace('987654321', $v.mid)); bymaster = (ReqBM $rD $v.mid) }
  if ($v.vno -and $v.type) { $forms['bynumber'] = ReqBN $rD $v.type $v.vno }
  $line = @()
  foreach ($f in $forms.Keys) {
    $x = Post $forms[$f] '' 60
    Set-Content (Join-Path $cap "r-$kind-$f.xml") $x -Encoding UTF8
    $line += "$f $($script:lastMs) ms $($x.Length) chars"
  }
  Say "R ${kind}: $($v.type) $($v.vno) MasterID $($v.mid): $($line -join '; ')"
}
try {
  # M2: an item invoice (5 items, CGST and SGST) whose sales ledger also carries a direct line (freight 50 to Sales)
  $its = @(1..5 | ForEach-Object { 'Item T{0:d2}' -f $_ })
  $inv = (SalesXml $rD 'R-M2' 'Template Party' $its 'fast234r sales with a direct Sales line') -replace '<NARRATION>', '<NARRATION>'
  $f = '{0:0.00}'
  # the direct line: Sales credited 50 more; the party debited 50 more (its line and bill)
  $tot = 1000 + 2 * 90 + 50
  $inv = $inv -replace '<AMOUNT>-1180\.00</AMOUNT>', ('<AMOUNT>-' + ($f -f $tot) + '</AMOUNT>')
  $inv = ([regex]'<ALLINVENTORYENTRIES\.LIST>').Replace($inv, '<LEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>50.00</AMOUNT></LEDGERENTRIES.LIST><ALLINVENTORYENTRIES.LIST>', 1)
  $r = Imp 'Vouchers' @($inv) 'M2 invoice with a direct Sales line'
  if ($r.created -lt 1) { Set-Content (Join-Path $cap 'r-m2-import-answer.xml') $r.raw -Encoding UTF8; $r = Imp 'Vouchers' @(($inv -replace '<IRN>.*?</IRNACKDATE>', '')) 'M2 invoice (no IRN)' }
  # the same with a freight ledger used both directly and under the items' sales ledger is the same shape: Sales is enough
  # L1: a payroll voucher typed on the Payroll screen: Ctrl+F4, the date, two employees, each with two pay heads
  $script:tdsTdls = @()
  $null = TdsGateway 'before the payroll entry'
  $null = TK 'v' 2.5 'pr-vouchers' 'Voucher'
  $null = TK '^{F4}' 3 'pr-payroll' 'Payroll|Pay'
  $null = TK '{F2}' 1.5 'pr-date-box' 'Date'
  $null = TK ((SK $rDay) + '{ENTER}') 2 'pr-date'
  $t = TdsScreen 'pr-first-field'
  if ($t -match 'Account') { $null = TK ((SK 'PD Salary Payable') + '{ENTER}') 2 'pr-account' }
  foreach ($e in 'PD Emp 001', 'PD Emp 002') {
    $null = TK ((SK $e) + '{ENTER}') 2.5 "pr-emp-$e"
    foreach ($ph in @(@('PD Basic', '1000'), @('PD HRA', '400'))) {
      $null = TK ((SK $ph[0]) + '{ENTER}') 2 "pr-ph-$e-$($ph[0])"
      $null = TK ($ph[1] + '{ENTER}') 2 "pr-amt-$e-$($ph[0])"
      $t = TdsScreen "pr-after-$e-$($ph[0])"
      if ($t -match 'Cost Centre|Cost Allocations|Category') { $null = TK '^a' 2 "pr-cc-$e" }
    }
    $null = TK '{ENTER}' 2 "pr-emp-done-$e"
  }
  $null = TK '{ENTER}' 2 'pr-emps-done'
  $t = TdsScreen 'pr-before-narr'
  if ($t -match 'Narration') { $null = TK ((SK 'fast234r payroll typed on the screen') + '{ENTER}') 2 'pr-narr' }
  for ($a = 1; $a -le 3; $a++) {
    $t = TdsScreen "pr-accept-q$a"
    if ($t -match 'Accept \?|Yes or No') { $null = TK 'y' 3 "pr-accepted$a"; break }
    $null = TK '^a' 3 "pr-ctrl-a$a"
  }
  $null = TdsGateway 'after the payroll entry'
  Set-Content (Join-Path $out 'pr-screen-log.txt') $script:tdsLog -Encoding UTF8
  $all = RV
  Say "1-Nov-2026 holds: $(($all | ForEach-Object { "$($_.type) $($_.vno) ($($_.mid)) '$($_.narr)'" }) -join '; ')"
  R3 'm2-sales-direct-line' @($all | Where-Object { $_.narr -like 'fast234r sales*' })[0]
  R3 'payroll-screen' @($all | Where-Object { $_.type -eq 'Payroll' })[0]
} catch { Say "HARNESS: fast234r stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Say 'done (fast234 fast234r)'
