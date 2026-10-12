# Mode payroll (MEASURE ONLY; TEST DATA ONLY: a throwaway company in this runner's own Tally). Dot-sourced by flowv.ps1
# after c2; no bridge is installed, nothing of the bridge, the add-on, the cloud or the app is changed. What Tally keeps for
# payroll (salary TDS, Form 24Q / Form 16, payroll reports) and which small requests would bring it, timed:
#   1. the company: payroll and statutory payroll on (ISPAYROLLON and every payroll / PF / ESI / PT / income-tax switch the
#      company object has, each set by its own XML alter and read back)
#   2. masters by XML: attendance types, 2 employee groups, 3 employees (every field of the employee object whose name looks
#      like PAN / Aadhaar / UAN / PF / ESI / dates / gender / designation / bank / tax regime / declarations, each set by its
#      own alter so one refusal does not hide the rest; the lists probed with one element, then their own fields filled), pay
#      heads (Basic, HRA, Special Allowance, PF employee and employer, ESI, Professional Tax, Income Tax)
#   3. entries by XML: attendance and payroll (PaySlip form) for November and December 2026, employer PF, one salary
#      payment and one TDS-on-salary payment (Educational mode: days 1, 2 and 31 only)
#   4. kept: the object export of every master (all fields, with types), each entry as FinComVoucherObject of the ref answers
#      it and in full; Tally's List of Accounts; the ref's FinComLedgers answer
#   5. 500 employees with the same fields and one payroll of 500; every candidate request timed 5 times, one at a time
# Judged on Linux from the captures. Here: y1-y5, PASS (made / kept / timed) or HARNESS (the harness could not).
$Y1 = 'y1 payroll and statutory payroll on (company switches read back)'
$Y2 = 'y2 payroll masters by XML (attendance types, groups, 3 employees with details, pay heads)'
$Y3 = 'y3 payroll entries by XML (attendance, payroll x2 months, employer PF, salary payment, TDS on salary)'
$Y4 = 'y4 raw answers kept (object exports, FinComVoucherObject, full entries, List of Accounts, FinComLedgers)'
$Y5 = 'y5 500 employees: candidate requests timed (one at a time, 5 each)'
$yDone = @{}
function YRes($c, $st, $ev) { if (-not $yDone[$c]) { Result $c $st $ev; $yDone[$c] = $true } }
function XSave($name, $text) { [IO.File]::WriteAllText((Join-Path $cap $name), "$text", [Text.UTF8Encoding]::new($false)) }
function SE([string]$s) { [Security.SecurityElement]::Escape($s) }
function XCount($r) { $m = [regex]::Match("$r", '(?s)<CREATED>(\d+)</CREATED>\s*<ALTERED>(\d+)</ALTERED>.*?<ERRORS>(\d+)</ERRORS>'); if ($m.Success) { return [pscustomobject]@{ c = [int]$m.Groups[1].Value; a = [int]$m.Groups[2].Value; e = [int]$m.Groups[3].Value; line = (([regex]::Matches("$r", '<LINEERROR>([^<]*)</LINEERROR>') | ForEach-Object { $_.Groups[1].Value }) -join ' | ') } }; $f = ("$r" -replace '\s+', ' '); return [pscustomobject]@{ c = 0; a = 0; e = -1; line = $f.Substring(0, [Math]::Min(300, $f.Length)) } }
$script:impLog = New-Object System.Collections.Generic.List[string]
function XImp($report, $msg, $label, [switch]$quiet, [int]$tmo = 60) {
  $r = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>' + $report + '</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">' + $msg + '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>') $(if ($quiet) { '' } else { $label }) $tmo
  $k = XCount $r
  $l = "{0}: created {1}, altered {2}, errors {3}{4}" -f $label, $k.c, $k.a, $k.e, $(if ($k.line) { "; Tally said: $($k.line)" } else { '' })
  $script:impLog.Add($l); if (-not $quiet) { Info "payroll $l" } else { Write-Host "[payroll] $l" }
  return $k
}
function Coll([string]$id, [string]$type, [string]$fetch, [string]$filter = '', [string]$extra = '', [int]$tmo = 120) {
  $f = if ($filter) { '<FILTERS>' + $id + 'F</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="' + $id + 'F">' + (SE $filter) + '</SYSTEM>' } else { '</COLLECTION>' }
  Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $extra + $f + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>') '' $tmo
}
# the object export of one master by name, every field (the form mhook's MhStored used); the subtype tried as given, then without spaces
function Obj([string]$sub, [string]$name) {
  foreach ($s in (@($sub, ($sub -replace ' ', '')) | Select-Object -Unique)) {
    $o = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>' + $s + '</SUBTYPE><ID TYPE="Name">' + (SE $name) + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST><FETCH>*</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>') '' 60
    if ("$o" -match ('NAME="' + [regex]::Escape((SE $name)) + '"')) { return "$o" }
  }
  return "$o"
}
# the object's own element (the one with NAME="name") parsed; control characters Tally writes (&#4;) taken out
function ObjNode([string]$x, [string]$name) {
  try { $d = [xml](($x -replace '&#(?:[0-8]|1[0-9]|2[0-9]|3[01]);', '') -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', '') } catch { Write-Host "[payroll] object not parsed: $_"; return $null }
  foreach ($n in $d.SelectNodes('//*[@NAME]')) { if ($n.GetAttribute('NAME') -eq $name) { return $n } }
  return $null
}
# every field of a node as path|type|value (lists by their path; their fields under them)
function Fields($node, [string]$prefix = '') {
  $o = @()
  if (-not $node) { return , $o }
  foreach ($c in $node.ChildNodes) {
    if ($c.NodeType -ne 'Element') { continue }
    $p = if ($prefix) { "$prefix/$($c.Name)" } else { $c.Name }
    $kids = @($c.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
    if ($c.Name -like '*.LIST' -or $kids.Count) { $o += "$p|LIST|"; $o += Fields $c $p }
    else { $o += ("{0}|{1}|{2}" -f $p, $c.GetAttribute('TYPE'), ($c.InnerText.Trim() -replace '\|', '/')) }
  }
  return , $o
}
function Filled($fl) { @($fl | Where-Object { $_ -notmatch '\|LIST\|$' -and ($_ -split '\|', 3)[2] -ne '' -and ($_ -split '\|', 3)[2] -notmatch '^(No|0|0\.00)$' }) }
$script:tm = [ordered]@{}
# a request timed $n times one after another (Tally's answer each time; the company list asked between, as the bridge's gate does)
function TimeIt([string]$label, [string]$req, [int]$n = 5, [int]$tmo = 60) {
  $ms = @(); $bytes = 0; $ans = ''
  for ($i = 0; $i -lt $n; $i++) { $ans = Post $req '' $tmo; $ms += $script:lastMs; $bytes = "$ans".Length; $null = Post $listCoXml '' }
  $s = @($ms | Sort-Object); $med = $s[[int][math]::Floor(($s.Count - 1) / 2)]; $worst = $s[-1]
  $script:tm[$label] = "median $med ms, worst $worst ms, $bytes characters, runs $($ms -join '/')"
  Info "payroll time $label`: median $med ms, worst $worst ms, $bytes characters (runs $($ms -join '/') ms)"
  XSave ("time-" + ($label -replace '[^\w-]', '_') + '.xml') $ans
  XSave ("time-" + ($label -replace '[^\w-]', '_') + '.request.xml') $req
  return [pscustomobject]@{ med = $med; worst = $worst; bytes = $bytes; ans = "$ans" }
}

$PRCAT = 'Primary Cost Category'
$G1 = 'FC Staff Office'; $G2 = 'FC Staff Factory'
$E = @('FC Emp One', 'FC Emp Two', 'FC Emp Three')
$EG = @($G1, $G1, $G2)
$PH = [ordered]@{
  basic = @('FC Basic', 'Indirect Expenses', 'Earnings for Employees', '', @('Basic Salary', 'Basic'))
  hra = @('FC HRA', 'Indirect Expenses', 'Earnings for Employees', '', @('House Rent Allowance', 'HRA'))
  spl = @('FC Special Allowance', 'Indirect Expenses', 'Earnings for Employees', '', @('Special Allowance', 'Others', 'Other Allowances', 'Taxable Allowance'))
  pfe = @('FC PF Employee', 'Current Liabilities', "Employees' Statutory Deductions", 'PF Account (A/c No. 1)', @())
  pfr = @('FC PF Employer', 'Indirect Expenses', "Employer's Statutory Contributions", 'PF Account (A/c No. 1)', @())
  esi = @('FC ESI Employee', 'Current Liabilities', "Employees' Statutory Deductions", 'Employee State Insurance', @())
  pt = @('FC Professional Tax', 'Current Liabilities', "Employees' Statutory Deductions", 'Professional Tax', @())
  it = @('FC Income Tax', 'Current Liabilities', "Employees' Statutory Deductions", 'Income Tax', @())
}
$PAY = 'FC Salary Payable'; $PFPAY = 'FC PF Payable'; $BANK = 'FC Salary Bank'
$made = [ordered]@{}
try {
  Say '---- payroll: the company'
  $co0 = Obj 'Company' $co1; XSave 'company-object-before.xml' $co0
  $cn = ObjNode $co0 $co1; $cf = Fields $cn
  Info "payroll: company object fields: $($cf.Count)"
  $coPat = 'PAYROLL|STATUTORY|PAYSTAT|PF|EPF|(^|[^DR])ESI|PROFTAX|PROFESSIONAL|PTAX|LWF|NPS|GRATUITY|INCOMETAX|ITAX|EMPLOYEE|SALARY|PAYSLIP|ATTEND'
  $coCand = @($cf | Where-Object { ($_ -split '\|')[0] -notmatch '/' -and ($_ -split '\|')[0] -match $coPat })
  Info "payroll: company payroll-like fields before: $(($coCand | Select-Object -First 120) -join ' ; ')"
  $null = XImp 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><ISPAYROLLON>Yes</ISPAYROLLON><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY>') 'company ISPAYROLLON, ISCOSTCENTRESON'
  # each logical switch of that kind set Yes by its own alter (a refusal of one does not stop the rest)
  foreach ($f in $coCand) {
    $p = $f -split '\|', 3
    if ($p[1] -ne 'Logical' -or $p[2] -eq 'Yes') { continue }
    if ($p[0] -notmatch '^(IS|USE|ENABLE|HAS|MAINTAIN|SET|SHOW)') { continue }
    if ($p[0] -match 'SEPARATE|BRANCH|ALTER|OVERRIDE|SKIP|IGNORE|DELETE|AUDIT|SHOW') { continue }
    $null = XImp 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><' + $p[0] + '>Yes</' + $p[0] + '></COMPANY>') "company $($p[0])=Yes" -quiet
  }
  # the company's statutory numbers (PF code, ESI code, PT registration) where the object has a string field of that kind
  foreach ($f in $coCand) {
    $p = $f -split '\|', 3
    if ($p[1] -ne 'String' -or $p[2]) { continue }
    $v = if ($p[0] -match 'ESI') { '31000123450000999' } elseif ($p[0] -match 'PF|EPF') { 'DLCPM0012345000' } elseif ($p[0] -match 'PROF|PT') { 'PTREG0012345' } elseif ($p[0] -match 'LWF') { 'LWF0012345' } else { '' }
    if (-not $v -or $p[0] -notmatch 'CODE|NUMBER|NO$|REG|ACCOUNT|ID$') { continue }
    $null = XImp 'All Masters' ('<COMPANY NAME="' + (SE $co1) + '" ACTION="Alter"><NAME>' + (SE $co1) + '</NAME><' + $p[0] + '>' + $v + '</' + $p[0] + '></COMPANY>') "company $($p[0])=$v" -quiet
  }
  $co2 = Obj 'Company' $co1; XSave 'company-object-after.xml' $co2
  $cf2 = Fields (ObjNode $co2 $co1)
  $coOn = @($cf2 | Where-Object { ($_ -split '\|')[0] -match $coPat -and ($_ -split '\|', 3)[2] -ne '' -and ($_ -split '\|', 3)[2] -ne 'No' })
  Info "payroll: company payroll-like fields after: $($coOn -join ' ; ')"
  $payOn = ($cf2 -match '^ISPAYROLLON\|[^|]*\|Yes$').Count -gt 0
  YRes $Y1 $(if ($payOn) { 'PASS' } else { 'HARNESS' }) ("ISPAYROLLON Yes: {0}; switches and numbers now set: {1}" -f $payOn, (($coOn | ForEach-Object { ($_ -split '\|', 3)[0] + '=' + ($_ -split '\|', 3)[2] }) -join ', '))

  Say '---- payroll: attendance types'
  foreach ($at in @(@('FC Present', 'Attendance / Leave with Pay'), @('FC Absent', 'Leave without Pay'), @('FC Overtime Hrs', 'Attendance / Leave with Pay'))) {
    $ok = $false
    foreach ($v in @($at[1], ($at[1] -replace ' / ', '/'))) {
      if ($ok) { break }
      $k = XImp 'All Masters' ('<ATTENDANCETYPE NAME="' + $at[0] + '" ACTION="Create"><NAME.LIST><NAME>' + $at[0] + '</NAME></NAME.LIST><PARENT/><ATTENDANCEPRODUCTIONTYPE>' + $v + '</ATTENDANCEPRODUCTIONTYPE><ATTENDANCEPERIOD>Days</ATTENDANCEPERIOD></ATTENDANCETYPE>') "attendance type $($at[0]) ($v)"
      if ($k.c -eq 1) { $ok = $true }
    }
    $made["att $($at[0])"] = $ok
  }
  $atx = Coll 'FcAt' 'AttendanceType' 'NAME, PARENT, GUID, MASTERID, ALTERID' '' '<NATIVEMETHOD>*</NATIVEMETHOD>'; XSave 'attendance-types.xml' $atx
  $ao = Obj 'Attendance Type' 'FC Present'; XSave 'obj-attendance-FC_Present.xml' $ao
  Info "payroll: attendance type FC Present, filled fields: $((Filled (Fields (ObjNode $ao 'FC Present'))) -join ' ; ')"

  Say '---- payroll: ledgers and pay heads'
  $null = XImp 'All Masters' ('<LEDGER NAME="' + $PAY + '" ACTION="Create"><NAME.LIST><NAME>' + $PAY + '</NAME></NAME.LIST><PARENT>Current Liabilities</PARENT></LEDGER>' +
    '<LEDGER NAME="' + $PFPAY + '" ACTION="Create"><NAME.LIST><NAME>' + $PFPAY + '</NAME></NAME.LIST><PARENT>Current Liabilities</PARENT></LEDGER>' +
    '<LEDGER NAME="' + $BANK + '" ACTION="Create"><NAME.LIST><NAME>' + $BANK + '</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>') 'salary payable, PF payable, bank'
  foreach ($k in $PH.Keys) {
    $h = $PH[$k]
    $base = '<LEDGER NAME="' + $h[0] + '" ACTION="Create"><NAME.LIST><NAME>' + $h[0] + '</NAME></NAME.LIST><PARENT>' + (SE $h[1]) + '</PARENT><PAYTYPE>' + (SE $h[2]) + '</PAYTYPE><FORPAYROLL>Yes</FORPAYROLL><AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><SHOWINPAYSLIP>Yes</SHOWINPAYSLIP><PAYSLIPNAME>' + $h[0] + '</PAYSLIPNAME><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>'
    $r = XImp 'All Masters' ($base + $(if ($h[3]) { '<PAYSTATTYPE>' + (SE $h[3]) + '</PAYSTATTYPE>' }) + '</LEDGER>') "pay head $($h[0]) with its statutory type"
    if ($r.c -ne 1) { $r = XImp 'All Masters' ($base + '</LEDGER>') "pay head $($h[0]) without the statutory type"; $made["ph $k"] = "created without PAYSTATTYPE: $($r.c)" } else { $made["ph $k"] = 'created' }
    if ($h[3]) { $null = XImp 'All Masters' ('<LEDGER NAME="' + $h[0] + '" ACTION="Alter"><NAME.LIST><NAME>' + $h[0] + '</NAME></NAME.LIST><PAYSTATTYPE>' + (SE $h[3]) + '</PAYSTATTYPE></LEDGER>') "pay head $($h[0]) PAYSTATTYPE alter" -quiet }
    # the income-tax component: the candidates in turn until Tally keeps one
    foreach ($ic in $h[4]) {
      $null = XImp 'All Masters' ('<LEDGER NAME="' + $h[0] + '" ACTION="Alter"><NAME.LIST><NAME>' + $h[0] + '</NAME></NAME.LIST><ITCOMPONENT>' + (SE $ic) + '</ITCOMPONENT></LEDGER>') "pay head $($h[0]) ITCOMPONENT=$ic" -quiet
      $po = Obj 'Ledger' $h[0]
      if ($po -match ('<ITCOMPONENT[^>]*>' + [regex]::Escape((SE $ic)) + '<')) { $made["ph $k itc"] = $ic; break }
    }
  }
  $phSum = @()
  foreach ($k in $PH.Keys) {
    $n = $PH[$k][0]; $po = Obj 'Ledger' $n; XSave ("obj-payhead-" + ($n -replace '\W', '_') + '.xml') $po
    $pf = Filled (Fields (ObjNode $po $n))
    $sel = @($pf | Where-Object { ($_ -split '\|')[0] -match 'PAY|CALC|STAT|ITCOMP|INCOMETAX|TAX|ATTEND|LEAVE|SLAB|GRATU|ROUND|AFFECT|FORPAYROLL|ESI|PF|COMPUT|PARENT|SALARY|PERIOD' })
    Info "payroll: pay head '$n' filled fields: $($sel -join ' ; ')"
    $phSum += "$n=$(@($sel | Where-Object { $_ -match '^(PAYTYPE|PAYSTATTYPE|ITCOMPONENT)\|' }) -join ',')"
  }

  Say '---- payroll: employee groups and employees'
  foreach ($g in @($G1, $G2)) { $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $g + '" ACTION="Create"><NAME.LIST><NAME>' + $g + '</NAME></NAME.LIST><PARENT/><CATEGORY>' + $PRCAT + '</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>') "employee group $g" }
  for ($i = 0; $i -lt 3; $i++) { $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $E[$i] + '" ACTION="Create"><NAME.LIST><NAME>' + $E[$i] + '</NAME></NAME.LIST><PARENT>' + $EG[$i] + '</PARENT><CATEGORY>' + $PRCAT + '</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>' + @('20250401', '20250402', '20250501')[$i] + '</DATEOFJOIN></COSTCENTRE>') "employee $($E[$i]) (minimal)" }
  $go = Obj 'Cost Centre' $G1; XSave 'obj-group-before.xml' $go
  $eo = Obj 'Cost Centre' $E[0]; XSave 'obj-employee-schema.xml' $eo
  $ef = Fields (ObjNode $eo $E[0])
  XSave 'employee-schema.txt' ($ef -join "`n")
  Info "payroll: employee object fields: $($ef.Count) ($(@($ef | Where-Object { $_ -match '\|LIST\|$' }).Count) lists)"
  # the values: distinct per employee, in the form each kind of number has
  function EmpVal([string]$f, [string]$t, [int]$n) {
    $u = $f.ToUpper()
    if ($t -eq 'Logical') {
      if ($u -match 'ISEMPLOYEEGROUP|FORPAYROLL|DELETED|ISUPDATING|FORJOBCOSTING|REVENUE|ISDEEMED|AUDIT|SYSTEM|ISCOSTCENTRE|ISOPTIONAL|ISACTIVE|INACTIVE|RESIGN|LEFT') { return $null }
      if ($u -match 'REGIME|NEWTAX|115BAC|TAX|DISAB|HANDICAP|SENIOR|METRO|PF|(^|[^DR])ESI|PROFTAX|LWF|NPS|GRATU|DEDUCT|EXEMPT|PAN|RESIDEN|FOREIGN|INTERNATIONAL|EXCESS|ELIGIBLE') { return $(if ($n -eq 1) { 'Yes' } else { 'No' }) }
      return $null
    }
    if ($t -eq 'Date') {
      if ($u -match 'BIRTH|DOB') { return @('19900101', '19850201', '19980731')[$n - 1] }
      if ($u -match 'JOIN') { return @('20250401', '20250501', '20260601')[$n - 1] }
      if ($u -match 'PASSPORT|VISA|PERMIT|CONTRACT') { return '20300131' }
      if ($u -match 'REGIME|DECL|TAX|PF|ESI|UAN|EFFECT|APPLICABLE|FROM') { return '20260401' }
      return $null
    }
    if ($t -eq 'Number' -or $t -eq 'Amount' -or $t -eq 'Quantity') {
      if ($u -match 'PREV|PREVIOUS|RENT|LTA|80C|80D|DEDUCT|EXEMPT|DECL|INVEST|INCOME|SALARY|TAX') { return @('150000', '50000', '0')[$n - 1] }
      return $null
    }
    if ($t -ne 'String' -and $t -ne '') { return $null }
    if ($u -match '^REMOTE|WORKPERMIT|VISA|PASSPORT|COUNTRYISD|VIRTUALPAYMENT|DISPENS') { return $null }
    if ($u -match 'AADHA|AADHAR|ADHAR|UIDAI') { return '99990000100' + $n }
    if ($u -match '(^|[^A-Z])PAN|INCOMETAXNUMBER|ITNUMBER|PERMANENTACC') { return @('ABCPE1001A', 'ABCPE1002B', 'ABCPE1003C')[$n - 1] }
    if ($u -match 'UAN|UNIVERSAL') { return '10020030040' + $n }
    if ($u -match 'DESIG') { return @('Accounts Manager', 'Accountant', 'Machine Operator')[$n - 1] }
    if ($u -match '(^|[^DR])ESI') { return '310012345' + $n }
    if ($u -match 'PRAN|NPS') { return '11002003004' + $n }
    if ($u -match 'PRACC|PRACCOUNT|PFACC|PFACCOUNT|PFNUM|PFNO|EPF') { return 'DL/CPM/0012345/000/000100' + $n }
    if ($u -match 'IFSC') { return 'HDFC000100' + $n }
    if ($u -match 'BANK.*(ACC|NO|NUM)|ACCOUNTNO|ACCOUNTNUMBER|ACCNO') { return '5010012345678' + $n }
    if ($u -match 'BANKNAME|^BANK$|BANKERNAME') { return 'HDFC Bank Ltd' }
    if ($u -match 'BRANCH') { return 'Connaught Place' }
    if ($u -match 'GENDER|SEX') { return @('Male', 'Female', 'Male')[$n - 1] }
    if ($u -match 'BLOOD') { return 'O+' }
    if ($u -match 'DESIG') { return @('Accounts Manager', 'Accountant', 'Machine Operator')[$n - 1] }
    if ($u -match 'FUNCTION|DEPART') { return @('Finance', 'Finance', 'Production')[$n - 1] }
    if ($u -match 'LOCATION|CITY') { return @('Delhi', 'Delhi', 'Gurugram')[$n - 1] }
    if ($u -match 'EMAIL') { return "emp$n@example.com" }
    if ($u -match 'MOBILE|PHONE|CONTACT') { return '981000000' + $n }
    if ($u -match 'FATHER|SPOUSE|NOMINEE|GUARDIAN') { return "Relative of employee $n" }
    if ($u -match 'REGIME') { return @('New Regime', 'Old Regime', 'New Regime')[$n - 1] }
    if ($u -match 'PASSPORT|VISA|PERMIT') { return "P100000$n" }
    if ($u -match 'EMPLOYEENUMBER|EMPNO|EMPID|EMPLOYEEID|EMPLOYEECODE|EMPCODE') { return "EMP-00$n" }
    if ($u -match 'PINCODE|PIN$') { return '11000' + $n }
    if ($u -match 'STATE') { return 'Delhi' }
    if ($u -match 'COUNTRY') { return 'India' }
    if ($u -match 'TAX|PF|(^|[^DR])ESI|PROFTAX|LWF|STAT|DECL|EXEMPT|DEDUCT|RESIDEN|DISAB|SALARY|PAYMENT|TRANSFER|MODE|ADDRESS|DISPENS|ACCOUNTHOLDER|PAYEE') { return "E$n $($f.Substring(0, [Math]::Min(20, $f.Length)))" }
    return $null
  }
  $skip = '^(NAME|PARENT|CATEGORY|GUID|MASTERID|ALTERID|ALTEREDON|ENTEREDBY|ALTEREDBY|RESERVEDNAME|LANGUAGENAME|SORTPOSITION|UPDATEDDATETIME|.*TIME|.*AUDIT.*|OLDAUDIT.*|REQUESTORRULE|ISDELETED|FORPAYROLL|ISEMPLOYEEGROUP|DATEOFJOIN)$'
  $setOk = @{}; $setBad = @{}
  for ($n = 1; $n -le 3; $n++) {
    foreach ($f in $ef) {
      $p = $f -split '\|', 3
      if ($p[1] -eq 'LIST' -or $p[0] -match '/' -or $p[0] -match $skip) { continue }
      $v = EmpVal $p[0] $p[1] $n
      if ($null -eq $v) { continue }
      $k = XImp 'All Masters' ('<COSTCENTRE NAME="' + $E[$n - 1] + '" ACTION="Alter"><NAME.LIST><NAME>' + $E[$n - 1] + '</NAME></NAME.LIST><' + $p[0] + '>' + (SE $v) + '</' + $p[0] + '></COSTCENTRE>') "employee $n $($p[0])=$v" -quiet
      if ($k.a -ge 1 -or $k.c -ge 1) { $setOk[$p[0]] = "$($p[1])" } else { $setBad[$p[0]] = "$($k.line)" }
    }
    if ($n -eq 1) { $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $E[0] + '" ACTION="Alter"><NAME.LIST><NAME>' + $E[0] + '</NAME></NAME.LIST><ADDRESS.LIST><ADDRESS>12 Test Street</ADDRESS><ADDRESS>New Delhi 110001</ADDRESS></ADDRESS.LIST></COSTCENTRE>') 'employee 1 address' }
  }
  Info "payroll: employee fields altered without error: $(($setOk.Keys | Sort-Object) -join ', ')"
  Info "payroll: employee fields refused: $(($setBad.Keys | Sort-Object | ForEach-Object { "$_ ($($setBad[$_]))" }) -join '; ')"
  # the lists: one element with candidate field names (Tally drops a name it does not have), then the list's own fields read
  # from the object and filled; lists of that kind only
  $listPat = 'BANK|PAY|DECL|TAX|ITC|EXEMPT|DEDUCT|REGIME|PREV|SALARY|STAT|NOMINEE|LEAVE|RENT|LTA|PF|ESI|UAN|AADH|IDENT|PROOF|INVEST|INCOME|LOAN|PERQ|EMPLOY'
  $lists = @($ef | Where-Object { $_ -match '\|LIST\|$' -and ($_ -split '\|')[0] -notmatch '/' -and ($_ -split '\|')[0] -match $listPat -and ($_ -split '\|')[0] -notmatch 'AUDIT|LANGUAGENAME|NAME\.LIST' } | ForEach-Object { ($_ -split '\|')[0] })
  Info "payroll: employee lists probed: $($lists -join ', ')"
  $cand = '<DATE>20260401</DATE><FROMDATE>20260401</FROMDATE><TODATE>20270331</TODATE><APPLICABLEFROM>20260401</APPLICABLEFROM><EFFECTIVEDATE>20260401</EFFECTIVEDATE><NAME>FC probe</NAME><AMOUNT>12345.00</AMOUNT><VALUE>12345</VALUE><ITCOMPONENT>Life Insurance Premium</ITCOMPONENT><TAXCOMPONENT>80C</TAXCOMPONENT><COMPONENT>80C</COMPONENT><DECLAREDAMOUNT>12345.00</DECLAREDAMOUNT><ACTUALAMOUNT>12345.00</ACTUALAMOUNT><PROOFAMOUNT>12345.00</PROOFAMOUNT><TAXREGIME>New Regime</TAXREGIME><REGIME>New Regime</REGIME><BANKNAME>HDFC Bank Ltd</BANKNAME><ACCOUNTNUMBER>501001234567801</ACCOUNTNUMBER><ACCOUNTNO>501001234567801</ACCOUNTNO><IFSCODE>HDFC0001001</IFSCODE><IFSCCODE>HDFC0001001</IFSCCODE><TRANSACTIONTYPE>Inter Bank Transfer</TRANSACTIONTYPE><PAYHEADNAME>FC Basic</PAYHEADNAME><EMPLOYEENAME>' + $E[0] + '</EMPLOYEENAME>'
  $listInfo = @()
  foreach ($l in $lists) {
    $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $E[0] + '" ACTION="Alter"><NAME.LIST><NAME>' + $E[0] + '</NAME></NAME.LIST><' + $l + '>' + $cand + '</' + $l + '></COSTCENTRE>') "employee 1 list $l (candidates)" -quiet
  }
  $eo2 = Obj 'Cost Centre' $E[0]; XSave 'obj-employee-after-lists.xml' $eo2
  $ef2 = Fields (ObjNode $eo2 $E[0])
  foreach ($l in $lists) {
    $sub = @($ef2 | Where-Object { $_ -like "$l/*" })
    $listInfo += "$l -> $(@($sub | ForEach-Object { ($_ -split '\|', 3)[0] -replace '^[^/]*/', '' }) -join ',')"
    # each field found under the list, filled by its kind (one alter per field, the list element given whole each time)
    foreach ($s in $sub) {
      $p = $s -split '\|', 3; $fn = $p[0] -replace '^[^/]*/', ''
      if ($p[1] -eq 'LIST' -or $fn -match '/') { continue }
      $v = EmpVal $fn $p[1] 1
      if ($null -eq $v -and $p[1] -eq 'Date') { $v = '20260401' }
      if ($null -eq $v -and ($p[1] -eq 'Amount' -or $p[1] -eq 'Number')) { $v = '12345' }
      if ($null -eq $v -and $p[1] -eq 'String') { $v = "E1 $fn" }
      if ($null -eq $v) { continue }
      $null = XImp 'All Masters' ('<COSTCENTRE NAME="' + $E[0] + '" ACTION="Alter"><NAME.LIST><NAME>' + $E[0] + '</NAME></NAME.LIST><' + $l + '><' + $fn + '>' + (SE $v) + '</' + $fn + '></' + $l + '></COSTCENTRE>') "employee 1 $l/$fn=$v" -quiet
    }
  }
  Info "payroll: employee lists and their fields: $($listInfo -join ' ; ')"
  $empFilled = @{}
  for ($n = 1; $n -le 3; $n++) {
    $o = Obj 'Cost Centre' $E[$n - 1]; XSave "obj-employee-$n.xml" $o
    $ff = Filled (Fields (ObjNode $o $E[$n - 1])); $empFilled[$n] = $ff
    Info "payroll: employee $n ($($E[$n - 1])) filled fields: $($ff -join ' ; ')"
  }
  $go2 = Obj 'Cost Centre' $G1; XSave 'obj-group.xml' $go2
  Info "payroll: employee group '$G1' filled fields: $((Filled (Fields (ObjNode $go2 $G1))) -join ' ; ')"
  $empOk = ($empFilled[1].Count -gt 3)
  YRes $Y2 $(if ($empOk -and $made['ph basic'] -and $made['att FC Present']) { 'PASS' } else { 'HARNESS' }) ("attendance: {0}; pay heads: {1}; employee 1 filled fields {2}; refused fields {3}" -f (($made.Keys | Where-Object { $_ -like 'att *' } | ForEach-Object { "$_ $($made[$_])" }) -join ', '), ($phSum -join '; '), $empFilled[1].Count, $setBad.Count)

  Say '---- payroll: entries'
  $vs0 = Vouchers
  # the month's figures: [employee, @(@(payhead key, amount)...)] earnings positive, deductions positive; the sign is set below
  $earn = @('basic', 'hra', 'spl'); $ded = @('pfe', 'esi', 'pt', 'it')
  $NOV = @(@(@('basic', 50000), @('hra', 20000), @('spl', 15000), @('pfe', 1800), @('pt', 200), @('it', 8000)),
           @(@('basic', 30000), @('hra', 12000), @('spl', 8000), @('pfe', 1800), @('pt', 200), @('it', 2500)),
           @(@('basic', 12000), @('hra', 4800), @('spl', 2000), @('pfe', 1440), @('esi', 141)))
  $DEC = @(@(@('basic', 50000), @('hra', 20000), @('spl', 15000), @('pfe', 1800), @('pt', 200), @('it', 9000)),
           @(@('basic', 30000), @('hra', 12000), @('spl', 8000), @('pfe', 1800), @('pt', 200), @('it', 2500)),
           @(@('basic', 12000), @('hra', 4800), @('spl', 2000), @('pfe', 1440), @('esi', 141)))
  function PayslipXml([string]$no, [string]$date, [string]$narr, $rows, [string]$party, [string[]]$emps, [string]$vtype = 'Payroll') {
    $tot = 0.0; $ce = ''
    for ($i = 0; $i -lt $rows.Count; $i++) {
      $ea = 0.0; $pa = ''; $so = 0
      foreach ($r in $rows[$i]) {
        $so++; $isE = ($earn -contains $r[0]) -or ($r[0] -eq 'pfr'); $a = if ($isE) { - [double]$r[1] } else { [double]$r[1] }; $ea += $a
        $pa += '<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>' + $PH[$r[0]][0] + '</PAYHEADNAME><ISDEEMEDPOSITIVE>' + $(if ($isE) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>' + $so + '</PAYHEADSORTORDER><AMOUNT>' + ('{0:0.00}' -f $a) + '</AMOUNT></PAYHEADALLOCATIONS.LIST>'
      }
      $tot += $ea
      $ce += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + $emps[$i] + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + ($i + 1) + '</EMPLOYEESORTORDER><AMOUNT>' + ('{0:0.00}' -f $ea) + '</AMOUNT>' + $pa + '</EMPLOYEEENTRIES.LIST>'
    }
    return '<VOUCHER VCHTYPE="' + $vtype + '" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>' + $date + '</DATE><EFFECTIVEDATE>' + $date + '</EFFECTIVEDATE><VOUCHERTYPENAME>' + $vtype + '</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + $party + '</PARTYLEDGERNAME><PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW><ASPAYSLIP>Yes</ASPAYSLIP><VCHENTRYMODE>Payslip</VCHENTRYMODE><NARRATION>' + $narr + '</NARRATION>' +
      '<LEDGERENTRIES.LIST><LEDGERNAME>' + $party + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>' + ('{0:0.00}' -f (- $tot)) + '</AMOUNT></LEDGERENTRIES.LIST>' +
      '<CATEGORYENTRY.LIST><CATEGORY>' + $PRCAT + '</CATEGORY>' + $ce + '</CATEGORYENTRY.LIST></VOUCHER>'
  }
  # the same figures as an accounting voucher (bigv's form: pay heads as ledger lines with the employees as cost centres), the fallback
  function AcctXml([string]$no, [string]$date, [string]$narr, $rows, [string]$party, [string[]]$emps) {
    $by = [ordered]@{}; $tot = 0.0
    for ($i = 0; $i -lt $rows.Count; $i++) { foreach ($r in $rows[$i]) { $isE = ($earn -contains $r[0]) -or ($r[0] -eq 'pfr'); $a = if ($isE) { - [double]$r[1] } else { [double]$r[1] }; if (-not $by[$r[0]]) { $by[$r[0]] = @() }; $by[$r[0]] += , @($emps[$i], $a); $tot += $a } }
    $x = '<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>' + $date + '</DATE><EFFECTIVEDATE>' + $date + '</EFFECTIVEDATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><VOUCHERNUMBER>' + $no + '</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>' + $narr + '</NARRATION>'
    foreach ($k in $by.Keys) {
      $s = 0.0; $cc = ''; foreach ($e in $by[$k]) { $s += $e[1]; $cc += '<COSTCENTREALLOCATIONS.LIST><NAME>' + $e[0] + '</NAME><AMOUNT>' + ('{0:0.00}' -f $e[1]) + '</AMOUNT></COSTCENTREALLOCATIONS.LIST>' }
      $x += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $PH[$k][0] + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + $(if ($s -lt 0) { 'Yes' } else { 'No' }) + '</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f $s) + '</AMOUNT><CATEGORYALLOCATIONS.LIST><CATEGORY>' + $PRCAT + '</CATEGORY>' + $cc + '</CATEGORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>'
    }
    return $x + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $party + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f (- $tot)) + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  }
  function PayEntry([string]$id, [string]$date, $rows, [string]$party, [string[]]$emps) {
    $k = XImp 'Vouchers' (PayslipXml $id $date "$id payroll by XML (PaySlip form)" $rows $party $emps) "payroll $id (PaySlip form)" -tmo 300
    if ($k.c -eq 1) { $made[$id] = 'XML PaySlip form'; return }
    $k = XImp 'Vouchers' (AcctXml $id $date "$id payroll by XML (accounting form)" $rows $party $emps) "payroll $id (accounting form, the PaySlip form refused)" -tmo 300
    $made[$id] = if ($k.c -eq 1) { 'XML accounting form (PaySlip refused)' } else { "refused: $($k.line)" }
  }
  # attendance: candidate forms (the field names Tally does not have are dropped), the first one Tally makes kept
  function AttXml([string]$id, [string]$date, [int]$form, [int[]]$days) {
    $x = '<VOUCHER VCHTYPE="Attendance" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>' + $date + '</DATE><EFFECTIVEDATE>' + $date + '</EFFECTIVEDATE><VOUCHERTYPENAME>Attendance</VOUCHERTYPENAME><VOUCHERNUMBER>' + $id + '</VOUCHERNUMBER><NARRATION>' + $id + ' attendance by XML (form ' + $form + ')</NARRATION>'
    $val = { param($t, $v) '<ATTENDANCETYPE>' + $t + '</ATTENDANCETYPE><NAME>' + $t + '</NAME><ATTDTYPEVALUE>' + $v + '</ATTDTYPEVALUE><ATTENDANCEVALUE>' + $v + '</ATTENDANCEVALUE><ATTDTYPETYPEVALUE>' + $v + '</ATTDTYPETYPEVALUE><VALUE>' + $v + '</VALUE><ATTDVALUE>' + $v + '</ATTDVALUE>' }
    if ($form -eq 1) {
      $x += '<CATEGORYENTRY.LIST><CATEGORY>' + $PRCAT + '</CATEGORY>'
      for ($i = 0; $i -lt 3; $i++) { $x += '<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>' + $E[$i] + '</EMPLOYEENAME><EMPLOYEESORTORDER>' + ($i + 1) + '</EMPLOYEESORTORDER><ATTENDANCEENTRIES.LIST>' + (& $val 'FC Present' $days[$i]) + '</ATTENDANCEENTRIES.LIST><ATTENDANCEENTRIES.LIST>' + (& $val 'FC Absent' (30 - $days[$i])) + '</ATTENDANCEENTRIES.LIST></EMPLOYEEENTRIES.LIST>' }
      $x += '</CATEGORYENTRY.LIST>'
    } else {
      for ($i = 0; $i -lt 3; $i++) { $x += '<ATTENDANCEENTRIES.LIST><EMPLOYEENAME>' + $E[$i] + '</EMPLOYEENAME>' + (& $val 'FC Present' $days[$i]) + '</ATTENDANCEENTRIES.LIST><ATTENDANCEENTRIES.LIST><EMPLOYEENAME>' + $E[$i] + '</EMPLOYEENAME>' + (& $val 'FC Absent' (30 - $days[$i])) + '</ATTENDANCEENTRIES.LIST>' }
    }
    return $x + '</VOUCHER>'
  }
  foreach ($a in @(@('ATT-NOV', '20261101', @(30, 28, 26)), @('ATT-DEC', '20261201', @(30, 30, 27)))) {
    $done = $false
    foreach ($form in 1, 2) {
      if ($done) { break }
      $k = XImp 'Vouchers' (AttXml $a[0] $a[1] $form $a[2]) "attendance $($a[0]) (form $form)"
      if ($k.c -eq 1) { $done = $true; $made[$a[0]] = "XML form $form" }
    }
    if (-not $done) { $made[$a[0]] = 'refused' }
  }
  PayEntry 'PR-NOV' '20261101' $NOV $PAY $E
  PayEntry 'PR-DEC' '20261201' $DEC $PAY $E
  PayEntry 'PF-NOV' '20261101' @(@(, @('pfr', 1800)), @(, @('pfr', 1800)), @(, @('pfr', 1440))) $PFPAY $E
  # the salary payment (November's net) and the TDS on salary (November's income tax), each with its tags first, plain after
  $netNov = 0.0; foreach ($r in $NOV) { foreach ($x in $r) { if ($earn -contains $x[0]) { $netNov += $x[1] } else { $netNov -= $x[1] } } }
  $sp = '<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261202</DATE><EFFECTIVEDATE>20261202</EFFECTIVEDATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>SAL-PAY-NOV</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>SAL-PAY-NOV salary payment for November by XML</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $PAY + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f (- $netNov)) + '</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $BANK + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f $netNov) + '</AMOUNT>@@BANK@@</ALLLEDGERENTRIES.LIST></VOUCHER>'
  $bk = ''; $i = 0; foreach ($r in $NOV) { $net = 0.0; foreach ($x in $r) { if ($earn -contains $x[0]) { $net += $x[1] } else { $net -= $x[1] } }; $bk += '<BANKALLOCATIONS.LIST><DATE>20261202</DATE><INSTRUMENTDATE>20261202</INSTRUMENTDATE><NAME>SAL-' + ($i + 1) + '</NAME><TRANSACTIONTYPE>Inter Bank Transfer</TRANSACTIONTYPE><BANKEMPLOYEENAME>' + $E[$i] + '</BANKEMPLOYEENAME><PAYMENTFAVOURING>' + $E[$i] + '</PAYMENTFAVOURING><ACCOUNTNUMBER>5010012345678' + ($i + 1) + '</ACCOUNTNUMBER><IFSCODE>HDFC000100' + ($i + 1) + '</IFSCODE><BANKNAME>HDFC Bank Ltd</BANKNAME><AMOUNT>' + ('{0:0.00}' -f $net) + '</AMOUNT></BANKALLOCATIONS.LIST>'; $i++ }
  $k = XImp 'Vouchers' $sp.Replace('@@BANK@@', $bk) 'salary payment SAL-PAY-NOV (bank details per employee)'
  if ($k.c -ne 1) { $k = XImp 'Vouchers' $sp.Replace('@@BANK@@', '') 'salary payment SAL-PAY-NOV (plain)'; $made['SAL-PAY-NOV'] = if ($k.c -eq 1) { 'XML plain (bank details refused)' } else { "refused: $($k.line)" } } else { $made['SAL-PAY-NOV'] = 'XML with bank details per employee' }
  $itNov = 0.0; foreach ($r in $NOV) { foreach ($x in $r) { if ($x[0] -eq 'it') { $itNov += $x[1] } } }
  $tp = '<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261202</DATE><EFFECTIVEDATE>20261202</EFFECTIVEDATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>TDS-SAL-NOV</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>TDS-SAL-NOV TDS on salary for November by XML</NARRATION>@@STAT@@' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $PH.it[0] + '</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f (- $itNov)) + '</AMOUNT>@@LINE@@</ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + $BANK + '</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>' + ('{0:0.00}' -f $itNov) + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
  $stat = '<STATPAYMENTTYPE>Income Tax</STATPAYMENTTYPE><TAXPAYPERIODFROMDATE>20261101</TAXPAYPERIODFROMDATE><TAXPAYPERIODTODATE>20261130</TAXPAYPERIODTODATE><TDSSECTIONNO>192</TDSSECTIONNO><TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>11223</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>20261202</TAXCHALLANDATE><TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME>'
  $line = '<TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT>'
  $k = XImp 'Vouchers' $tp.Replace('@@STAT@@', $stat).Replace('@@LINE@@', $line) 'TDS on salary TDS-SAL-NOV (Income Tax stat payment tags)'
  if ($k.c -ne 1) { $k = XImp 'Vouchers' $tp.Replace('@@STAT@@', '').Replace('@@LINE@@', '') 'TDS on salary TDS-SAL-NOV (plain)'; $made['TDS-SAL-NOV'] = if ($k.c -eq 1) { 'XML plain (stat payment tags refused)' } else { "refused: $($k.line)" } } else { $made['TDS-SAL-NOV'] = 'XML with stat payment tags' }
  $vs1 = Vouchers
  $ids = [ordered]@{}
  foreach ($id in 'ATT-NOV', 'ATT-DEC', 'PR-NOV', 'PR-DEC', 'PF-NOV', 'SAL-PAY-NOV', 'TDS-SAL-NOV') { $e = @($vs1 | Where-Object { $_.vno -eq $id -or $_.narr -like "$id *" })[0]; if ($e) { $ids[$id] = "$($e.mid)" } }
  Info "payroll: entries made: $(($made.Keys | Where-Object { $_ -match '^(ATT|PR|PF|SAL|TDS)-' } | ForEach-Object { "$_ $($made[$_]) (mid $($ids[$_]))" }) -join '; ')"
  YRes $Y3 $(if ($ids['PR-NOV'] -and $ids['PR-DEC'] -and $ids['SAL-PAY-NOV'] -and $ids['TDS-SAL-NOV']) { 'PASS' } else { 'HARNESS' }) ("{0}" -f (($made.Keys | Where-Object { $_ -match '^(ATT|PR|PF|SAL|TDS)-' } | ForEach-Object { "$_ $($made[$_])" }) -join '; '))

  Say '---- payroll: the raw answers'
  $reqFile = Join-Path $env:BRIDGE_DIST 'requests\entry-object.xml'
  $tmpl = if (Test-Path $reqFile) { Get-Content $reqFile -Raw } else { '' }
  if ($tmpl) { Info "payroll: the entry request of the ref (requests/entry-object.xml, SHA-256 $((Get-FileHash $reqFile -Algorithm SHA256).Hash.ToLower()))" }
  function ObjOf($mid) { if (-not $tmpl) { return '' }; $s = "$mid".Trim(); if ($s -notmatch '^\d{1,18}$') { return '' }; Post ($tmpl.Replace('FinCom Spike Co', (SE $co1)).Replace('ID:99999<', "ID:$s<")) '' 60 }
  $fullFl = '*, ALLLEDGERENTRIES.*, LEDGERENTRIES.*, LEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.BANKALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.*, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.*, CATEGORYENTRY.*, CATEGORYENTRY.EMPLOYEEENTRIES.*, CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.*, CATEGORYENTRY.EMPLOYEEENTRIES.ATTENDANCEENTRIES.*, ATTENDANCEENTRIES.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.SUMMARYALLOCS.*'
  $vchPat = 'EMPLOYEE|PAYHEAD|ATTD|ATTEND|CATEGORY|^NAME$|^AMOUNT$|BANKEMPLOYEE|STATPAYMENT|TAXPAY|CHALLAN|TDSSECTION|TYPEOFTAXPAYMENT|PAYSLIP|VCHENTRYMODE'
  $objMs = @()
  foreach ($id in $ids.Keys) {
    $o = ObjOf $ids[$id]; XSave "obj-$id.xml" $o; $objMs += "$id $("$o".Length) chars $($script:lastMs) ms"
    $fx = Coll 'FcFull' 'Voucher' $fullFl ('$MasterID = ' + $ids[$id]) '<NATIVEMETHOD>*</NATIVEMETHOD>' 120; XSave "full-$id.xml" $fx
    $vn = $null; try { $vd = [xml](("$o" -replace '&#(?:[0-8]|1[0-9]|2[0-9]|3[01]);', '') -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ''); $vn = $vd.SelectSingleNode('//VOUCHER') } catch {}
    $vf = Filled (Fields $vn 'VOUCHER')
    Info "payroll: $id as FinComVoucherObject answers it: $(@($vf | Where-Object { (($_ -split '\|')[0] -split '/')[-1] -match $vchPat }) -join ' ; ')"
  }
  # a month in the Day Book form (Tally's own report export, harness only: what a Day Book upload would carry)
  $db = Post ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY><SVFROMDATE>20261101</SVFROMDATE><SVTODATE>20261130</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>') 'day book Nov' 120
  XSave 'daybook-202611.xml' $db
  $listAcc = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
  $mx = Post $listAcc 'masters' 300; XSave 'masters.xml' $mx
  $lq = Join-Path $env:BRIDGE_DIST 'ledreq\ledlist-tail.xml'; if (-not (Test-Path $lq)) { $lq = Join-Path $PSScriptRoot 'ledreq\ledlist-tail.xml' }
  $lr = (Get-Content $lq -Raw).Replace('@@CO@@', (SE $co1)).Replace('111111', '0').Trim()
  $lraw = Post $lr 'FinComLedgers' 120; XSave 'ledlist-raw.xml' $lraw; XSave 'ledlist-request.xml' $lr
  foreach ($k in $PH.Keys) { $n = $PH[$k][0]; $lb = [regex]::Match("$lraw", '(?s)<LEDGER NAME="' + [regex]::Escape($n) + '".*?</LEDGER>').Value; Info "payroll: pay head '$n' in FinComLedgers' answer: $(($lb -replace '\s+', ' ').Substring(0, [Math]::Min(400, ($lb -replace '\s+', ' ').Length)))" }
  # every other master type Tally lists with a payroll-like name (income-tax declarations may be kept outside the employee)
  $tcount = Post ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>') ''
  XSave 'cmpinfo.xml' $tcount
  # run 38236438871: a Collection of a type Tally does not have (PayrollITDeclaration, with NATIVEMETHOD *) got no answer and
  # Tally answered nothing more on 3.0, 5.1 and 7.1: no such probe here; the object types Tally has are in cmpinfo.xml
  YRes $Y4 $(if ($ids.Count -and "$lraw" -match '<LEDGER') { 'PASS' } else { 'HARNESS' }) ("object answers: {0}; masters {1} characters; FinComLedgers {2}; Day Book {3}" -f ($objMs -join ', '), "$mx".Length, "$lraw".Length, "$db".Length)

  Say '---- payroll: 500 employees and the candidate requests'
  # every employee field that was taken for employee 1 (leaf fields; the bank / declaration lists of employee 1 copied whole)
  $fill = @($empFilled[1] | Where-Object { ($_ -split '\|')[0] -notmatch '/' -and ($_ -split '\|')[0] -notmatch $skip })
  $tplF = ''; foreach ($f in $fill) { $p = $f -split '\|', 3; $tplF += '<' + $p[0] + '>' + (SE $p[2]) + '</' + $p[0] + '>' }
  $lx = @(); if ($lists.Count) { $lx = @([regex]::Matches($eo2, '(?s)<(' + (($lists | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')>.*?</\1>') | ForEach-Object { $_.Value -replace ' TYPE="[A-Za-z]+"', '' }) }
  $tplL = ($lx -join '')
  $null = XImp 'All Masters' ('<COSTCENTRE NAME="FC Bulk Staff" ACTION="Create"><NAME.LIST><NAME>FC Bulk Staff</NAME></NAME.LIST><PARENT/><CATEGORY>' + $PRCAT + '</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>') 'group FC Bulk Staff'
  $bulkOk = 0
  for ($b = 0; $b -lt 5; $b++) {
    $m = ''
    for ($j = 1; $j -le 100; $j++) {
      $n = $b * 100 + $j; $nm = 'FC Bulk Emp {0:d3}' -f $n
      $pan = 'ABCPB{0:d4}Z' -f $n
      $x = $tplF -replace 'ABCPE1001A', $pan -replace '999900001001', ('9999{0:d8}' -f $n) -replace '100200300401', ('1002{0:d8}' -f $n)
      $m += '<COSTCENTRE NAME="' + $nm + '" ACTION="Create"><NAME.LIST><NAME>' + $nm + '</NAME></NAME.LIST><PARENT>FC Bulk Staff</PARENT><CATEGORY>' + $PRCAT + '</CATEGORY><FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>20250401</DATEOFJOIN>' + $x + $tplL + '</COSTCENTRE>'
    }
    $k = XImp 'All Masters' $m "500 employees, batch $($b + 1)" -tmo 300; $bulkOk += $k.c
    if ($k.c -lt 100) { $m2 = $m -replace [regex]::Escape($tplL), ''; if ($tplL) { $k = XImp 'All Masters' ($m2 -replace 'ACTION="Create"', 'ACTION="Create"') "500 employees, batch $($b + 1) without the lists"; $bulkOk += $k.c } }
  }
  $bulkE = @(1..500 | ForEach-Object { 'FC Bulk Emp {0:d3}' -f $_ })
  $bulkRows = @(1..500 | ForEach-Object { , @(@('basic', 30000 + $_), @('hra', 12000), @('spl', 8000), @('pfe', 1800), @('esi', 141), @('pt', 200), @('it', 2500)) })
  $sw = [Diagnostics.Stopwatch]::StartNew()
  PayEntry 'PR-BULK-500' '20261031' $bulkRows $PAY $bulkE
  Info "payroll: the 500-employee payroll: $($made['PR-BULK-500']), $([int]$sw.Elapsed.TotalSeconds) s to import"
  $vs2 = Vouchers
  $bulkMid = "$(@($vs2 | Where-Object { $_.vno -eq 'PR-BULK-500' })[0].mid)"
  $allCc = Coll 'FcCc' 'CostCentre' 'NAME, MASTERID, ALTERID' '' '' 120
  $ccMids = @([regex]::Matches("$allCc", '<MASTERID[^>]*>\s*(\d+)\s*<') | ForEach-Object { [int64]$_.Groups[1].Value } | Sort-Object)
  $ccAlts = @([regex]::Matches("$allCc", '<ALTERID[^>]*>\s*(\d+)\s*<') | ForEach-Object { [int64]$_.Groups[1].Value } | Sort-Object)
  Info "payroll: cost centres in Tally: $($ccMids.Count) (MasterIDs $($ccMids[0])..$($ccMids[-1]), AlterIDs $($ccAlts[0])..$($ccAlts[-1])); 500 made: $bulkOk"

  # the candidate requests, in the bridge's own form (fcCollection: id, the company, the type, FETCH, a MasterID / AlterID filter)
  function FcReq([string]$id, [string]$type, [string]$fetch, [string]$filter) {
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>' + $id + '</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + (SE $co1) + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="' + $id + '" ISMODIFY="No"><TYPE>' + $type + '</TYPE><FETCH>' + $fetch + '</FETCH>' + $(if ($filter) { '<FILTERS>' + $id + 'Only</FILTERS>' }) + '</COLLECTION>' + $(if ($filter) { '<SYSTEM TYPE="Formulae" NAME="' + $id + 'Only">' + (SE $filter) + '</SYSTEM>' }) + '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
  }
  # the employee fields asked by name: the stored fields that carried data for employee 1 (leaf), with the ids and the group
  $empNamed = @('GUID', 'MASTERID', 'ALTERID', 'NAME', 'PARENT', 'CATEGORY', 'FORPAYROLL', 'ISEMPLOYEEGROUP', 'DATEOFJOIN') + @($fill | ForEach-Object { ($_ -split '\|')[0] }) | Select-Object -Unique
  $empLists = @($lists | ForEach-Object { "$_.*" })
  $empFetch = (@($empNamed) + $empLists) -join ', '
  Info "payroll: the candidate employee FETCH ($(@($empNamed).Count) fields, $($empLists.Count) lists): $empFetch"
  $r1 = TimeIt 'C1 FinComEmployees named fields, MasterID > 0 (all cost centres)' (FcReq 'FinComEmployees' 'CostCentre' $empFetch '$MasterID > 0')
  $r1b = TimeIt 'C1b FinComEmployees FETCH * (every stored field, the upper bound)' (FcReq 'FinComEmployees' 'CostCentre' '*' '$MasterID > 0') 3 120
  $r1c = TimeIt 'C1c FinComEmployees named fields, payroll only ($ForPayroll)' (FcReq 'FinComEmployees' 'CostCentre' $empFetch '$MasterID > 0 AND $ForPayroll')
  if ($ccMids.Count) { $mid = $ccMids[[int][math]::Floor($ccMids.Count / 2)]; $null = TimeIt 'C1d FinComEmployees named fields, half the MasterIDs' (FcReq 'FinComEmployees' 'CostCentre' $empFetch ('$MasterID > 0 AND $MasterID <= ' + $mid)) }
  if ($ccAlts.Count) { $a0 = [math]::Max(0, $ccAlts[-1] - 200); $null = TimeIt 'C2 FinComEmployeeChanges named fields, a window of 200 AlterIDs' (FcReq 'FinComEmployeeChanges' 'CostCentre' $empFetch ('$AlterID > ' + $a0 + ' AND $AlterID <= ' + $ccAlts[-1])) }
  $null = TimeIt 'C3 one employee by name, named fields' (FcReq 'FinComEmployeeByName' 'CostCentre' $empFetch '$Name = "FC Bulk Emp 250"')
  $phFetch = 'PAYTYPE, PAYSTATTYPE, CALCULATIONTYPE, CALCULATIONPERIOD, ITCOMPONENT, AFFECTSNETSALARY, FORPAYROLL, ATTENDANCETYPE, LEAVETYPE, USEFORGRATUITY, USEFORESIELIGIBILITY'
  $lfetch = [regex]::Match($lr, '<FETCH>([^<]*)</FETCH>').Groups[1].Value
  $r4 = TimeIt 'C4 FinComLedgers (the ref) with the pay-head fields added' ($lr.Replace("<FETCH>$lfetch</FETCH>", "<FETCH>$lfetch, $phFetch</FETCH>"))
  $null = TimeIt 'C4ref FinComLedgers as the ref sends it' $lr
  $null = TimeIt 'C5 FinComAttendanceTypes' (FcReq 'FinComAttendanceTypes' 'AttendanceType' 'GUID, MASTERID, ALTERID, NAME, PARENT, ATTENDANCEPRODUCTIONTYPE, ATTENDANCEPERIOD, BASEUNITS' '$MasterID > 0')
  if ($bulkMid -match '^\d+$') { $r6 = TimeIt 'C6 FinComVoucherObject (the ref) on the 500-employee payroll' ($tmpl.Replace('FinCom Spike Co', (SE $co1)).Replace('ID:99999<', "ID:$bulkMid<")) 5 120; XSave 'obj-PR-BULK-500.xml' $r6.ans }
  if ($ids['PR-NOV']) { $null = TimeIt 'C6b FinComVoucherObject (the ref) on the 3-employee payroll' ($tmpl.Replace('FinCom Spike Co', (SE $co1)).Replace('ID:99999<', "ID:$($ids['PR-NOV'])<")) }
  $pingMs = @(); for ($i = 0; $i -lt 3; $i++) { $null = Post $listCoXml ''; $pingMs += $script:lastMs }
  Info "payroll: Tally answering after the timings: company list $($pingMs -join '/') ms"
  $over = @($script:tm.Keys | Where-Object { [int]([regex]::Match($script:tm[$_], 'worst (\d+) ms').Groups[1].Value) -ge 2000 })
  YRes $Y5 $(if ($script:tm.Count -ge 5 -and $bulkOk -ge 450) { 'PASS' } else { 'HARNESS' }) ("{0} employees made; requests at 2 s or more: {1}; {2}" -f $bulkOk, $(if ($over.Count) { $over -join ', ' } else { 'none' }), (($script:tm.Keys | ForEach-Object { "$_ = $($script:tm[$_])" }) -join '; '))
  XSave 'imports.txt' ($script:impLog -join "`n")
} catch {
  Write-Host "payroll stopped: $_ $($_.ScriptStackTrace)"
  Info "payroll: the harness stopped: $_ at $($_.InvocationInfo.ScriptLineNumber)"
  XSave 'imports.txt' ($script:impLog -join "`n")
  foreach ($c in @($Y1, $Y2, $Y3, $Y4, $Y5)) { YRes $c 'HARNESS' "the harness stopped: $_" }
}
