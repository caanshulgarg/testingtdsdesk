# Versions copy of install.ps1: tally.exe looked for wherever this release puts it (older releases may differ).
# Step 2: the TallyPrime setup has no working silent switch (/S, /silent kept the GUI "TallyPrime Setup Manager" open);
# drive its GUI: it shows "C: Configure / O: More Actions / I: Install", so press I.
$ErrorActionPreference = 'Continue'
$setup = $env:TALLY_SETUP
$dest = $null; $dests = @("C:\Program Files\TallyPrime", "C:\Program Files\Tally\TallyPrime", "C:\Program Files (x86)\TallyPrime")
function Find-Tally { foreach ($d in $dests) { if (Test-Path "$d\tally.exe") { return $d } }; $f = Get-ChildItem "C:\Program Files", "C:\Program Files (x86)" -Filter tally.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1; if ($f) { return $f.DirectoryName }; return $null }
$p = Start-Process -FilePath $setup -PassThru
for ($t = 0; $t -lt 60; $t++) { Start-Sleep 2; if (Get-Process | Where-Object { $_.MainWindowTitle -match 'Setup Manager' }) { break } }
Start-Sleep 3
& "$PSScriptRoot\shot.ps1" 'install-a-window'
Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { Write-Host "  setup window: $($_.ProcessName) '$($_.MainWindowTitle)'" }
& "$PSScriptRoot\keys.ps1" 'Setup Manager|TallyPrimeSetup|TallyPrime Setup' 'i'
$found = $false
for ($s = 0; $s -lt 40; $s++) {
  Start-Sleep 10
  if ($s % 3 -eq 0) { & "$PSScriptRoot\shot.ps1" ("install-b-{0:d3}s" -f (($s + 1) * 10)) }
  Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { Write-Host "  [$(($s+1)*10)s] window: $($_.ProcessName) '$($_.MainWindowTitle)'" }
  if ($p.HasExited) { Write-Host "setup exited with code $($p.ExitCode)"; break }
  $dest = Find-Tally
  if ($dest -and -not $found) { $found = $true; Write-Host "tally.exe appeared after ~$(($s+1)*10)s" }
  if ($found -and $s -ge 3) { Write-Host "stopping the wait: setup shows 'Installation Successful' (S: Start TallyPrime) by now"; break }
}
& "$PSScriptRoot\shot.ps1" 'install-c-end'
$dest = Find-Tally
if ($dest) {
  "TALLY_EXE=$dest\tally.exe" | Out-File -Append $env:GITHUB_ENV
  "TALLY_DIR=$dest" | Out-File -Append $env:GITHUB_ENV
  Get-ChildItem $dest | Format-Table Name, Length, LastWriteTime -AutoSize | Out-String -Width 200 | Write-Host
  (Get-Item "$dest\tally.exe").VersionInfo | Format-List FileVersion, ProductVersion, ProductName | Out-String | Write-Host
  if (Test-Path "$dest\tally.ini") { Write-Host "== tally.ini as installed"; Get-Content "$dest\tally.ini" | Write-Host }
  Get-Process tally, TallyPrimeSetup -ErrorAction SilentlyContinue | Stop-Process -Force
  exit 0
}
Write-Host "NO tally.exe found under Program Files"; Get-ChildItem 'C:\Program Files' | Out-String | Write-Host
exit 1
