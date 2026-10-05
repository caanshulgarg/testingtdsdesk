# Step 3/4: start Tally with a tally.ini (optionally loading a TDL), look at the desktop, test port 9000
param([string]$phase = 'plain', [string]$tdl = '')
$ErrorActionPreference = 'Continue'
$dir = $env:TALLY_DIR; $exe = $env:TALLY_EXE
$ini = Join-Path $dir 'tally.ini'
if (Test-Path $ini) { Write-Host "== original tally.ini"; Get-Content $ini | Write-Host; if (-not (Test-Path "$ini.orig")) { Copy-Item $ini "$ini.orig" } }
$data = "$env:RUNNER_TEMP\TallyData"; New-Item -ItemType Directory -Force $data | Out-Null
$lines = @(
  '[Tally]', 'User TDL = Yes', "Data = $data", 'Default Companies = No',
  'Client Server = Both', 'Port = 9000', 'ServerPort = 9000', 'ODBC = Yes', 'ODBC Server = Yes', 'Language = 2'
)
if ($tdl) { $lines += @('TDL = Yes', "TDL = $tdl") } else { $lines += 'TDL = No' }
Set-Content -Path $ini -Value $lines -Encoding ASCII
Write-Host "== tally.ini used ($phase)"; Get-Content $ini | Write-Host
Get-Process tally -ErrorAction SilentlyContinue | Stop-Process -Force
$p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
Write-Host "started tally pid $($p.Id)"
foreach ($s in 5, 15, 30, 60) {
  Start-Sleep -Seconds ($s - ($script:last | ForEach-Object { $_ }))
  $script:last = $s
  & "$PSScriptRoot\shot.ps1" "$phase-$($s)s"
  Get-Process | Where-Object { $_.MainWindowTitle } | Format-Table Id, ProcessName, MainWindowTitle -AutoSize | Out-String | Write-Host
  if ($p.HasExited) { Write-Host "TALLY EXITED code $($p.ExitCode)"; break }
  netstat -ano | Select-String ':9000 ' | ForEach-Object { Write-Host "  netstat: $_" }
}
& "$PSScriptRoot\xml.ps1" "$phase"
