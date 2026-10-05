# Step 1: find the TallyPrime installer link from tallysolutions.com, download it, record size/SHA-256/version
$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$pages = @(
  'https://tallysolutions.com/download/',
  'https://tallysolutions.com/download-tallyprime/',
  'https://tallysolutions.com/tally-prime-download/',
  'https://tallysolutions.com/tallyprime/download/',
  'https://tallysolutions.com/download/support-files/',
  'https://tallysolutions.com/global/download/',
  'https://help.tallysolutions.com/tally-prime/installation-and-licensing/install-tallyprime/'
)
$links = New-Object System.Collections.Generic.List[string]
foreach ($p in $pages) {
  try {
    $r = Invoke-WebRequest -Uri $p -UserAgent $ua -UseBasicParsing -TimeoutSec 60 -MaximumRedirection 5
    Write-Host "GET $p -> $($r.StatusCode) len=$($r.Content.Length)"
    $safe = ($p -replace '[^A-Za-z0-9]+','_'); Set-Content -Path "$env:RES\page$safe.html" -Value $r.Content -Encoding UTF8
    [regex]::Matches($r.Content, '(?i)[^"''\s<>()]*\.(exe|zip|msi)\b[^"''\s<>()]*') | ForEach-Object { $_.Value } | Sort-Object -Unique | ForEach-Object { Write-Host "   exe-ish: $_"; if ($_ -match '^https?://') { $links.Add($_) } }
    $found = [regex]::Matches($r.Content, '(?i)https?://[^"''\s<>]+') | ForEach-Object { $_.Value } |
      Where-Object { $_ -match '(?i)\.(exe|zip|msi)(\?|$)|download' } | Sort-Object -Unique
    foreach ($f in $found) { Write-Host "   link: $f"; $links.Add($f) }
  } catch { Write-Host "GET $p FAILED: $($_.Exception.Message)" }
}
$cand = $links | Where-Object { $_ -match '(?i)tally.*\.exe(\?|$)' } | Sort-Object -Unique
Write-Host "Installer candidates:"; $cand | ForEach-Object { Write-Host "  $_" }
$extra = @($env:TALLY_URL) | Where-Object { $_ }
$try = @($extra) + @($cand | Where-Object { $_ -match '(?i)prime' }) + @($cand)
$out = "$env:RUNNER_TEMP\TallyPrimeSetup.exe"
foreach ($u in $try) {
  try {
    Write-Host "Downloading $u"
    Invoke-WebRequest -Uri $u -UserAgent $ua -UseBasicParsing -OutFile $out -TimeoutSec 900
    $fi = Get-Item $out
    if ($fi.Length -lt 5MB) { Write-Host "  too small ($($fi.Length) bytes), next"; continue }
    Write-Host "  OK size=$($fi.Length)"
    Write-Host "  SHA256=$((Get-FileHash $out -Algorithm SHA256).Hash)"
    $fi.VersionInfo | Format-List | Out-String | Write-Host
    try { Get-AuthenticodeSignature $out | Format-List Status, SignerCertificate | Out-String | Write-Host } catch {}
    "TALLY_SETUP=$out" | Out-File -Append $env:GITHUB_ENV
    "TALLY_URL_USED=$u" | Out-File -Append $env:GITHUB_ENV
    exit 0
  } catch { Write-Host "  FAILED: $($_.Exception.Message)" }
}
Write-Host "NO INSTALLER DOWNLOADED"; exit 1
