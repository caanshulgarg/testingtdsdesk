# Step 2: silent install attempts, logging exit codes and where tally.exe lands
$ErrorActionPreference = 'Continue'
$setup = $env:TALLY_SETUP
function Find-Tally {
  $roots = @("$env:ProgramFiles", "${env:ProgramFiles(x86)}", 'C:\', "$env:LOCALAPPDATA", "$env:ProgramData")
  foreach ($r in $roots) {
    Get-ChildItem -Path $r -Filter tally.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
  }
}
Write-Host "== 7-Zip view of the installer (is it an archive?)"
& 7z l $setup 2>&1 | Select-Object -First 80 | Out-String | Write-Host
$switches = @('/S', '/silent', '/verysilent /suppressmsgboxes /norestart', '/quiet', '/s /v/qn')
$i = 0
foreach ($sw in $switches) {
  $i++
  Write-Host "== Attempt $i : $setup $sw"
  $p = Start-Process -FilePath $setup -ArgumentList $sw -PassThru
  $done = $p.WaitForExit(30000)
  & "$PSScriptRoot\shot.ps1" "install-$i-30s"
  if (-not $done) { $done = $p.WaitForExit(120000) }
  if ($done) { Write-Host "  exit code: $($p.ExitCode)" } else {
    Write-Host "  still running after 150 s; windows:"
    Get-Process | Where-Object { $_.MainWindowTitle } | Format-Table Id, ProcessName, MainWindowTitle -AutoSize | Out-String | Write-Host
    & "$PSScriptRoot\shot.ps1" "install-$i-150s"
    Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  $t = Find-Tally | Select-Object -First 1
  if ($t) {
    Write-Host "  FOUND tally.exe at $($t.FullName) after attempt $i ($sw)"
    "TALLY_EXE=$($t.FullName)" | Out-File -Append $env:GITHUB_ENV
    "TALLY_DIR=$($t.DirectoryName)" | Out-File -Append $env:GITHUB_ENV
    Get-ChildItem $t.DirectoryName | Format-Table Name, Length -AutoSize | Out-String | Write-Host
    $t.VersionInfo | Format-List | Out-String | Write-Host
    exit 0
  }
}
Write-Host "== No tally.exe after silent attempts; trying 7z extraction"
& 7z x $setup "-o$env:RUNNER_TEMP\tallyx" -y 2>&1 | Select-Object -Last 15 | Out-String | Write-Host
$t = Get-ChildItem "$env:RUNNER_TEMP\tallyx" -Filter tally.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($t) {
  Write-Host "  FOUND by extraction: $($t.FullName)"
  "TALLY_EXE=$($t.FullName)" | Out-File -Append $env:GITHUB_ENV
  "TALLY_DIR=$($t.DirectoryName)" | Out-File -Append $env:GITHUB_ENV
  exit 0
}
Get-ChildItem "$env:RUNNER_TEMP\tallyx" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 60 FullName, Length | Out-String | Write-Host
exit 1
