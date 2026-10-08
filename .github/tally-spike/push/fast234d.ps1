# fast234d.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234d,
# right after Tally is installed and flow.ps1 made "FinCom Spike Co". Run 37741662830 found Tally's Voucher collection
# (FinComVoucherByMaster, FinComVoucherByNumber) gives a bill-wise party's line with no bill an "On Account" bill of the
# whole amount, where the object export (FinComVoucherObject) has none. Which does Tally's own Day Book export give (the
# path FinCom read before the recorder, and still reads on a Day Book upload)? The same entries asked four ways: the Day
# Book export of the day, the Voucher collection by MasterID, by number, and the object export. captures\d-*.xml
. "$here\fast234.ps1"   # its request templates (it returns before its own run in this mode)
$script:co = $co
$dD = '20261101'
function DLine($led, $pos, $amt, $inner = '') { '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + (Esc $led) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $(if ($pos) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><AMOUNT>' + $amt + '</AMOUNT>' + $inner + '</ALLLEDGERENTRIES.LIST>' }
function DVch($type, $narr, $body) { '<VOUCHER VCHTYPE="' + $type + '" ACTION="Create"><DATE>' + $dD + '</DATE><VOUCHERTYPENAME>' + $type + '</VOUCHERTYPENAME><NARRATION>' + $narr + '</NARRATION>' + $body + '</VOUCHER>' }
function DayBookReqD($date) { '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (X $co) + '</SVCURRENTCOMPANY><SVFROMDATE>' + $date + '</SVFROMDATE><SVTODATE>' + $date + '</SVTODATE><SVCURRENTDATE>' + $date + '</SVCURRENTDATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>' }
try {
  if (-not (Start-T $light @() 'd-setup')) { Say 'HARNESS: the company did not open'; return }
  Imp 'All Masters' (LightMasters) 'light masters' | Out-Null
  Imp 'All Masters' @((LedgerXml 'D Party BW' 'Sundry Debtors' '<ISBILLWISEON>Yes</ISBILLWISEON>'), (LedgerXml 'D Party NB' 'Sundry Debtors' '<ISBILLWISEON>No</ISBILLWISEON>')) 'd parties' | Out-Null
  $vs = [ordered]@{
    'journal-billwise-nobill' = DVch 'Journal' 'd journal bw no bill' ((DLine 'D Party BW' $true '-100.00') + (DLine 'Spike Income' $false '100.00'))
    'journal-notbillwise' = DVch 'Journal' 'd journal not bw' ((DLine 'D Party NB' $true '-100.00') + (DLine 'Spike Income' $false '100.00'))
    'journal-billwise-newref' = DVch 'Journal' 'd journal bw new ref' ((DLine 'D Party BW' $true '-100.00' '<BILLALLOCATIONS.LIST><NAME>DJ-1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-100.00</AMOUNT></BILLALLOCATIONS.LIST>') + (DLine 'Spike Income' $false '100.00'))
    'receipt-billwise-nobill' = DVch 'Receipt' 'd receipt bw no bill' ((DLine 'D Party BW' $false '50.00') + (DLine 'HDFC Bank' $true '-50.00'))
  }
  foreach ($k in $vs.Keys) { Imp 'Vouchers' @($vs[$k]) "d $k" | Out-Null }
  $x = Post (Coll 'FCPD' 'Voucher' 'MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION' '$Date = $$Date:"01-11-2026"') '' 60
  $db = Post (DayBookReqD $dD) '' 120; Set-Content (Join-Path $cap 'd-daybook.xml') $db -Encoding UTF8
  foreach ($m in [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; $narr = [regex]::Match($v, '<NARRATION[^>]*>([^<]*)').Groups[1].Value
    $type = [regex]::Match($v, '<VOUCHERTYPENAME[^>]*>([^<]*)').Groups[1].Value; $vno = [regex]::Match($v, '<VOUCHERNUMBER[^>]*>([^<]*)').Groups[1].Value
    $k = @($vs.Keys | Where-Object { $vs[$_] -match [regex]::Escape("<NARRATION>$narr</NARRATION>") })[0]
    if (-not $k -or -not $mid) { continue }
    $ob = Post ($tplOBJ.Replace('@@CO@@', (X $co)).Replace('987654321', $mid)) '' 30; Set-Content (Join-Path $cap "d-$k-object.xml") $ob -Encoding UTF8
    $bm = Post (ReqBM $dD $mid) '' 30; Set-Content (Join-Path $cap "d-$k-bymaster.xml") $bm -Encoding UTF8
    $bn = Post (ReqBN $dD $type $vno) '' 30; Set-Content (Join-Path $cap "d-$k-bynumber.xml") $bn -Encoding UTF8
    $dv = @([regex]::Matches($db, '(?s)<VOUCHER[ >].*?</VOUCHER>') | Where-Object { $_.Value -match "<NARRATION[^>]*>$([regex]::Escape($narr))<" })[0].Value
    $cnt = { param($s) "$(([regex]::Matches("$s", '<BILLTYPE[^>]*>On Account<')).Count) On Account, $(([regex]::Matches("$s", '<BILLALLOCATIONS\.LIST>\s*<[A-Z]')).Count) filled bill lists" }
    Say "D ${k} (MasterID $mid, $type $vno): Day Book $(& $cnt $dv); collection by MasterID $(& $cnt $bm); by number $(& $cnt $bn); object $(& $cnt $ob)"
  }
} catch { Say "HARNESS: fast234d stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Say 'done (fast234 fast234d)'
