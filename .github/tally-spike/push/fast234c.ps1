# fast234c.ps1 - MEASUREMENT ONLY (push-design, branch tally-versions), dot-sourced by pushm.ps1 when PD_MODE is fast234c,
# right after Tally is installed and flow.ps1 made "FinCom Spike Co" (A). The 2.3.4 re-review 2, L-d (08-Oct-2026): what does
# the bridge's entry request (FinComVoucherObject, its own XML) answer when the company named in SVCURRENTCOMPANY is CLOSED
# while another company (B, "FinCom Other Co") is loaded? With a MasterID that is a voucher of B only, of A only, of neither.
# If Tally answers "Could not find Voucher:ID:n" for A's own voucher with A closed, a delete could be "proven" by a closed
# company. Every answer kept whole: captures\c-<case>.xml; one "C <case>" line each in the summary.
. "$here\fast234.ps1"   # its request templates and helpers (it returns before its own run in this mode)
$script:co = $co
$coA = $co; $coB = 'FinCom Other Co'
$cDate = '20261002'
function CAsk($coName, $mid, $case) {
  $q = $tplOBJ.Replace('@@CO@@', (X $coName)).Replace('987654321', "$mid")
  $a = Post $q '' 30
  Set-Content (Join-Path $cap "c-$case.xml") $a -Encoding UTF8
  $s = ($a -replace '\s+', ' ').Trim(); if ($s.Length -gt 400) { $s = $s.Substring(0, 400) + '...' }
  $vm = [regex]::Match($a, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; $vn = [regex]::Match($a, '<NARRATION[^>]*>([^<]*)').Groups[1].Value
  Say ("C {0}: SVCURRENTCOMPANY '{1}' ID:{2} -> {3} chars in {4} ms; voucher MasterID '{5}' narration '{6}'; {7}" -f $case, $coName, $mid, "$a".Length, $script:lastMs, $vm, $vn, $(if ("$a".Length -lt 400) { "answer: $s" } else { "starts: $($s.Substring(0, 200))" }))
  return $a
}
function CVch($coName) {
  $keep = $co; Set-Variable -Name co -Value $coName -Scope Script
  try { $x = Post (Coll 'FCPCV' 'Voucher' 'MASTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION') '' 120 } finally { Set-Variable -Name co -Value $keep -Scope Script }
  $o = @()
  foreach ($m in [regex]::Matches($x, '(?s)<VOUCHER[ >].*?</VOUCHER>')) {
    $v = $m.Value
    $o += [pscustomobject]@{ mid = [regex]::Match($v, '<MASTERID[^>]*>\s*(\d+)').Groups[1].Value; narr = [Net.WebUtility]::HtmlDecode([regex]::Match($v, '<NARRATION[^>]*>([^<]*)').Groups[1].Value) }
  }
  return , $o
}
function CImp($coName, $report, [string[]]$msgs, $label) {
  $keep = $co; Set-Variable -Name co -Value $coName -Scope Script
  try { return Imp $report $msgs $label } finally { Set-Variable -Name co -Value $keep -Scope Script }
}
function Folders { @(Get-ChildItem $light -Directory | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object Name) }
try {
  $fA = $script:folder; $before = Folders
  Say "fast234c on TallyPrime ${rel}: company A '$coA' in folder $fA; folders: $($before -join ', ')"
  # 1. company B: by XML first (flow.ps1 step B), else by keys from Tally's company list (flow.ps1 step C, slow232's F3 path)
  $null = StartW $light @() 'c-create' @()
  $coXml = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="' + $coB + '" ACTION="Create"><NAME>' + $coB + '</NAME><BASICCOMPANYFORMALNAME>' + $coB + '</BASICCOMPANYFORMALNAME><STARTINGFROM>20250401</STARTINGFROM><BOOKSFROM>20250401</BOOKSFROM><COUNTRYNAME>India</COUNTRYNAME><STATENAME>Delhi</STATENAME></COMPANY></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  $null = Post $coXml 'c-company-xml' 60
  $newF = { @(Folders | Where-Object { $_ -notin $before }) }
  $tries = @(
    @('Create Company', '{ENTER}'),
    @('{ESC}', '{F3}', 'Create Company', '{ENTER}'),
    @('%k', 'c')
  )
  $t = 0
  foreach ($path in $tries) {
    if ((& $newF).Count) { break }
    $t++
    foreach ($k in $path) { KeysTo $k 4 '' }
    Shot "c-create-$t-form"
    KeysTo $coB 2 "c-create-$t-name"; KeysTo '^a' 8 "c-create-$t-accept"
    foreach ($k in @('y', '^a', '{ENTER}', 'y', '{ESC}', 'y')) { if ((& $newF).Count) { break }; KeysTo $k 6 '' }
    KeysTo '^a' 5 "c-create-$t-after"
    if (-not (& $newF).Count) { foreach ($k in @('{ESC}', '{ESC}', 'y', '{ESC}')) { KeysTo $k 2 '' } }
  }
  $fB = @(& $newF)[0]
  if (-not $fB) { Say "HARNESS: fast234c: company B was not made (no new folder in $light; screens c-create-*)"; Stop-T; return }
  Say "company B '$coB' made in folder $fB (key path $t)"
  # 2. both open: B's ledgers and three journals; the vouchers of each
  if (-not (StartW $light @($fA, $fB) 'c-both' @($coA, $coB))) { Say "HARNESS: fast234c: A and B not both open ($(Cos -join ' | '))" }
  $null = CImp $coB 'All Masters' @((LedgerXml 'C Party' 'Sundry Debtors' ''), (LedgerXml 'C Income' 'Indirect Incomes' '')) 'B ledgers'
  $jv = @(1..3 | ForEach-Object { '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + $cDate + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>fast234c B journal ' + $_ + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>C Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-' + (10 * $_) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>C Income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + (10 * $_) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' })
  $null = CImp $coB 'Vouchers' $jv 'B journals'
  $vA = CVch $coA; $vB = CVch $coB
  $mA = @($vA | ForEach-Object mid); $mB = @($vB | ForEach-Object mid)
  Say "A's vouchers: $($vA.Count) (MasterIDs $(($mA | Select-Object -First 20) -join ','))"
  Say "B's vouchers: $($vB.Count) (MasterIDs $($mB -join ','))"
  $aOnly = @($mA | Where-Object { $_ -notin $mB })[0]; $bOnly = @($mB | Where-Object { $_ -notin $mA })[0]; $both = @($mA | Where-Object { $_ -in $mB })[0]
  $none = '987654'
  Say "cases: A only $aOnly; B only $bOnly; both $(if ($both) { $both } else { '(none)' }); neither $none"
  if (-not $aOnly -or -not $bOnly) { Say 'HARNESS: fast234c: no MasterID of one company only' }
  Say "both open: Tally's company list: $(Cos -join ' | ')"
  $null = CAsk $coA $aOnly 'open-A-aonly'; $null = CAsk $coA $bOnly 'open-A-bonly'; $null = CAsk $coB $bOnly 'open-B-bonly'; $null = CAsk $coB $aOnly 'open-B-aonly'; $null = CAsk $coA $none 'open-A-none'
  if ($both) { $null = CAsk $coA $both 'open-A-both'; $null = CAsk $coB $both 'open-B-both' }
  # 3. A closed (not loaded), B open: the same asks naming A
  if (-not (StartW $light @($fB) 'c-bonly' @($coB))) { Say "HARNESS: fast234c: B not open alone ($(Cos -join ' | '))" }
  Say "A closed: Tally's company list: $(Cos -join ' | ')"
  $null = CAsk $coA $aOnly 'closedA-A-aonly'; $null = CAsk $coA $bOnly 'closedA-A-bonly'; $null = CAsk $coA $none 'closedA-A-none'
  if ($both) { $null = CAsk $coA $both 'closedA-A-both' }
  $null = CAsk 'FinCom No Such Co' $aOnly 'closedA-nosuch-aonly'; $null = CAsk 'FinCom No Such Co' $bOnly 'closedA-nosuch-bonly'
  $null = CAsk $coB $bOnly 'closedA-B-bonly'
  # 4. A open alone (B closed): the asks naming B (the mirror)
  if (-not (StartW $light @($fA) 'c-aonly' @($coA))) { Say "HARNESS: fast234c: A not open alone ($(Cos -join ' | '))" }
  $null = CAsk $coB $bOnly 'closedB-B-bonly'; $null = CAsk $coB $aOnly 'closedB-B-aonly'; $null = CAsk $coA $aOnly 'closedB-A-aonly'
  # 5. no company open at all
  $null = StartW $light @() 'c-none' @()
  Say "none open: Tally's company list: $(Cos -join ' | ')"
  $null = CAsk $coA $aOnly 'noneopen-A-aonly'; $null = CAsk $coA $none 'noneopen-A-none'
} catch { Say "HARNESS: fast234c stopped: $_ $($_.ScriptStackTrace)" }
Stop-T
Say 'done (fast234 fast234c)'
