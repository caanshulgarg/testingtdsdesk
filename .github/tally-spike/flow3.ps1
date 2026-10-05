# Round 3: the real FinCom Bridge 2.2.2 (assets-test/bridge-go/FinComBridge-2.2.2.exe of origin/tax-accuracy) against this
# Tally with the recorder add-on of origin/tax-accuracy, its cloud a local stub (stub.py). Screen steps: create a Receipt,
# alter its amount, duplicate it (Alt+2) with a new amount, cancel one, delete one; ~40 s after each, the bridge's log,
# the stub's received bodies and the recorder lines are kept.
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE; $ini = Join-Path $dir 'tally.ini'
$data = "$env:RUNNER_TEMP\TallyData"; $rec = 'C:\ProgramData\FinCom\recorder'; $co = 'FinCom Spike Co'
$out = Join-Path $env:RES 'round3'; New-Item -ItemType Directory -Force $out | Out-Null
function Shot($n) { & "$PSScriptRoot\shot.ps1" "r3-$n" }
function Keys($k, $wait = 3, $n = '') { & "$PSScriptRoot\keys.ps1" '^tally$' $k; Start-Sleep $wait; if ($n) { Shot $n } }

# ---- the program and the add-on of origin/tax-accuracy (binary-safe: git archive | tar)
$src = "$env:RUNNER_TEMP\ta"; New-Item -ItemType Directory -Force $src | Out-Null
git fetch -q origin tax-accuracy
git -C $env:GITHUB_WORKSPACE log -1 --format='origin/tax-accuracy: %h %s' origin/tax-accuracy | Write-Host
cmd /c "git archive origin/tax-accuracy assets-test/bridge-go/FinComBridge-2.2.2.exe bridge-go/addon/FinComRecorder.tdl | tar -x -C `"$src`""
$bexe = "$src\assets-test\bridge-go\FinComBridge-2.2.2.exe"; $tdl = "$src\bridge-go\addon\FinComRecorder.tdl"
Write-Host "bridge: $((Get-Item $bexe).Length) bytes, SHA256 $((Get-FileHash $bexe).Hash); add-on: $((Get-Item $tdl).Length) bytes"
Remove-Item "$rec\*" -Force -ErrorAction SilentlyContinue

# ---- the stub cloud
$stubLog = Join-Path $out 'stub-requests.jsonl'
$py = (Get-Command python -ErrorAction SilentlyContinue).Source; Write-Host "python: $py"
$stub = Start-Process -FilePath $py -ArgumentList "`"$PSScriptRoot\stub.py`" 8787 `"$stubLog`"" -PassThru -WindowStyle Hidden
Start-Sleep 3
try { Invoke-WebRequest http://127.0.0.1:8787/ -Method Post -Body '{"kind":"ping"}' -UseBasicParsing | Out-Null; Write-Host 'stub answers' } catch { Write-Host "stub: $_" }

# ---- Tally with the add-on and the company
Set-Content -Path $ini -Encoding ASCII -Value @('[Tally]', "Data = $data", "Config = $dir", "LangPath = $dir\lang", 'Client Server = Both', 'ServerPort = 9000', 'Enable ODBC Server = Yes', 'User TDL = Yes', 'Default Companies = Yes', 'Load = 100000', "TDL = $tdl")
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
Start-Process -FilePath $exe -WorkingDirectory $dir | Out-Null
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 3; try { Invoke-WebRequest http://localhost:9000 -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch {} }
Start-Sleep 5; Keys 'a' 4; Keys 't' 10 '00-gateway'
$lx = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Spike Income" ACTION="Create"><NAME.LIST><NAME>Spike Income</NAME></NAME.LIST><PARENT>Indirect Incomes</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
try { Write-Host ('ledger Spike Income: ' + (Invoke-WebRequest http://localhost:9000 -Method Post -Body $lx -UseBasicParsing -TimeoutSec 30).Content) } catch { Write-Host "ledger: $_" }

# ---- the bridge, as a program for this user, its cloud the stub
$home_ = "$env:RUNNER_TEMP\bridge"; New-Item -ItemType Directory -Force $home_ | Out-Null
$conf = Join-Path $home_ 'tds-bridge.config.json'
@{ CloudUrl = 'http://127.0.0.1:8787/'; CloudKey = 'plain:spike-device-key'; TallyPorts = 'auto'; FallbackPorts = @(9000); LogFile = (Join-Path $home_ 'tds-bridge.log') } | ConvertTo-Json | Set-Content -Path $conf -Encoding UTF8
$bridge = Start-Process -FilePath $bexe -ArgumentList "run --config `"$conf`"" -WorkingDirectory $home_ -PassThru
Write-Host "bridge pid $($bridge.Id)"
$blog = Join-Path $home_ 'tds-bridge.log'
for ($i = 0; $i -lt 24; $i++) { Start-Sleep 5; if ((Test-Path $blog) -and (Select-String -Path $blog -Pattern 'starting point|Light check' -Quiet)) { break } }
Start-Sleep 10

$logSeen = 0; $stubSeen = 0
function Snap($step) {
  Write-Host "===== after step '$step' (bridge running: $(-not $bridge.HasExited))"
  if (Test-Path $blog) {
    $l = Get-Content $blog; $new = @($l | Select-Object -Skip $script:logSeen); $script:logSeen = $l.Count
    Set-Content -Path (Join-Path $out "bridge-log-$step.txt") -Value $new -Encoding UTF8
    $new | ForEach-Object { Write-Host "  log: $_" }
  }
  if (Test-Path $stubLog) {
    $s = Get-Content $stubLog -Encoding UTF8; $new = @($s | Select-Object -Skip $script:stubSeen); $script:stubSeen = $s.Count
    foreach ($j in $new) {
      $o = $j | ConvertFrom-Json
      if ($o.kind -ne 'recorder_lines') { Write-Host "  cloud: $($o.at) $($o.kind)"; continue }
      Write-Host "  cloud: $($o.at) recorder_lines company=$($o.body.company) lines=$(@($o.body.lines).Count)"
      foreach ($x in $o.body.lines) { Write-Host ("    LINE event={0} object_guid={1} master_id={2} alter_id={3} vch={4}/{5}/{6} xml={7} heldWhy={8} idsMismatch={9} lineGuid={10}" -f $x.event, $x.object_guid, $x.master_id, $x.alter_id, $x.vch_type, $x.vch_no, $x.vch_date, ([bool]$x.xml), $x.heldWhy, $x.idsMismatch, $x.lineGuid) }
    }
  }
  Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "rec-$step-$($_.Name)") }
}
Snap 'start'

# ---- the screen steps (Receipt dated 2-Oct-2026: EDU allows the 2nd)
Keys 'v' 4 '01-vouchers'
Keys '{F6}' 3 ''
Keys '{F2}' 3 ''
Keys '2-10-2026{ENTER}' 3 ''
Keys 'Cash{ENTER}' 3 ''
Keys 'Spike Income{ENTER}' 3 '02-particular'
Keys '700{ENTER}' 3 ''
Keys '^a' 5 '03-created'
Start-Sleep 40; Snap 'a-create'
function DayBook($n) {
  Keys '%g' 3 ''
  Keys 'Day Book' 2 ''
  Keys '{ENTER}' 4 ''
  Keys '{F2}' 3 ''
  Keys '2-10-2026{ENTER}' 4 "$n-daybook"
}
DayBook '04'
Keys '{END}' 2 ''
Keys '{ENTER}' 4 '05-open'
Keys '{ENTER}' 2 ''; Keys '{ENTER}' 2 ''; Keys '{ENTER}' 2 '06-at-amount'
Keys '800{ENTER}' 2 ''
Keys '^a' 5 '07-altered'
Start-Sleep 40; Snap 'b-alter'
DayBook '07b'
Keys '{END}' 2 ''
Keys '%2' 4 '08-duplicate'
# the duplicate opens with the cursor on Account (round 3a: a third Enter went past the amount to a new line)
Keys '{ENTER}' 2 ''; Keys '{ENTER}' 2 '09-dup-at-amount'
Keys '900{ENTER}' 2 '09b-dup-amount'
Keys '^a' 5 '10-dup-saved'
Start-Sleep 40; Snap 'c-duplicate'
DayBook '10b'
Keys '{HOME}' 2 ''
Keys '%x' 3 ''
Keys 'y' 4 '11-cancelled'
Start-Sleep 40; Snap 'd-cancel'
DayBook '11b'
Keys '{END}' 2 ''
Keys '%d' 3 ''
Keys 'y' 4 '12-deleted'
Start-Sleep 40; Snap 'e-delete'

# what Tally holds now
$vl = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCV</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>' + $co + '</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCV" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ISCANCELLED, AMOUNT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
try { (Invoke-WebRequest http://localhost:9000 -Method Post -Body $vl -UseBasicParsing -TimeoutSec 30).Content | Set-Content (Join-Path $out 'vouchers-end.xml') } catch {}
Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
# the bridge's folder (its log, sync state), never the settings file's key (a made-up one anyway)
Get-ChildItem $home_ -Recurse -File | Where-Object { $_.Length -lt 2MB } | ForEach-Object {
  $rel = $_.FullName.Substring($home_.Length + 1); $dst = Join-Path $out ("bridge-home\" + $rel)
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $_.FullName $dst
}
Write-Host "== round 3 end"
