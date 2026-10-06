# Versions step 1: the TallyPrime installer of release $env:TALLY_REL from Tally's own download centre only
# (tallymirror.tallysolutions.com/download_centre/Rel.<x>_gold/TP/Full/setup.exe, the pattern 7.1 came from). Never a mirror
# of anyone else. The neighbouring releases are asked too (HEAD only) so the report can name the nearest one that can be had.
# Writes $env:RES\installer.txt (one line per URL tried) and, when the release itself is there, TALLY_SETUP to GITHUB_ENV.
$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$rel = $env:TALLY_REL
New-Item -ItemType Directory -Force $env:RES | Out-Null
$rep = Join-Path $env:RES 'installer.txt'
function Url($r) { "https://tallymirror.tallysolutions.com/download_centre/Rel.${r}_gold/TP/Full/setup.exe" }
function Head($r) {
  $u = Url $r
  try {
    # the first KB only (a ranged GET: some CDNs refuse HEAD); the full size from Content-Range
    $q = [System.Net.HttpWebRequest]::Create($u); $q.Method = 'GET'; $q.UserAgent = $ua; $q.Timeout = 30000; $q.AllowAutoRedirect = $true; $q.AddRange(0, 1023)
    $a = $q.GetResponse(); $code = [int]$a.StatusCode; $len = $a.ContentLength; $lm = $a.Headers['Last-Modified']
    $cr = $a.Headers['Content-Range']; if ($cr -match '/(\d+)$') { $len = [int64]$Matches[1] }; if ($code -eq 206) { $code = 200 }; $a.Close()
    return [pscustomobject]@{ rel = $r; url = $u; code = $code; len = $len; modified = $lm }
  } catch {
    $code = 0; try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
    if (-not $code) { try { $code = [int]$_.Exception.Response.StatusCode } catch {} }
    return [pscustomobject]@{ rel = $r; url = $u; code = $code; len = -1; modified = ''; err = $_.Exception.Message }
  }
}
# the release asked, then its neighbours: the same major's other minors and patch releases, and the next major's .0
$maj, $min = $rel.Split('.')[0..1]
$near = @($rel)
foreach ($m in 0..3) { foreach ($p in @('', '.1', '.2')) { $near += "$maj.$m$p" } }
$near += @("$([int]$maj + 1).0", "$([int]$maj - 1).1", "$([int]$maj - 1).2")
$near = $near | Select-Object -Unique
$heads = foreach ($r in $near) { $h = Head $r; Write-Host ("GET (first KB) Rel.{0}_gold -> {1} len={2} modified={3} {4}" -f $h.rel, $h.code, $h.len, $h.modified, $h.err); $h }
$heads | ForEach-Object { "{0} {1} {2} bytes, Last-Modified {3}: {4}" -f $(if ($_.code -eq 200 -and $_.len -gt 5MB) { 'AVAILABLE' } else { "NO($($_.code))" }), $_.rel, $_.len, $_.modified, $_.url } | Set-Content $rep -Encoding UTF8
$out = "$env:RUNNER_TEMP\TallyPrimeSetup.exe"
$u = Url $rel
try {
  $t0 = Get-Date
  Invoke-WebRequest -Uri $u -UserAgent $ua -UseBasicParsing -OutFile $out -TimeoutSec 900
  $fi = Get-Item $out
  if ($fi.Length -lt 5MB) { throw "too small ($($fi.Length) bytes)" }
  $sha = (Get-FileHash $out -Algorithm SHA256).Hash
  $sig = try { (Get-AuthenticodeSignature $out) } catch { $null }
  $l = "DOWNLOADED Rel.$rel from $u : $($fi.Length) bytes in $([int]((Get-Date) - $t0).TotalSeconds) s, SHA-256 $sha, signature $($sig.Status) $($sig.SignerCertificate.Subject), file version $($fi.VersionInfo.FileVersion) product $($fi.VersionInfo.ProductVersion)"
  Write-Host $l; Add-Content $rep $l -Encoding UTF8
  if ($sig -and $sig.Status -ne 'Valid') { Write-Host "::warning::installer signature is $($sig.Status)" }
  "TALLY_SETUP=$out" | Out-File -Append $env:GITHUB_ENV
  "TALLY_URL_USED=$u" | Out-File -Append $env:GITHUB_ENV
  exit 0
} catch {
  $l = "NOT DOWNLOADABLE Rel.$rel from $u : $($_.Exception.Message)"
  Write-Host $l; Add-Content $rep $l -Encoding UTF8
  $ok = @($heads | Where-Object { $_.code -eq 200 -and $_.len -gt 5MB -and $_.rel -ne $rel })
  Add-Content $rep ("NEAREST available on Tally's download centre: {0}" -f $(if ($ok.Count) { ($ok | ForEach-Object rel) -join ', ' } else { 'none of the neighbours tried: the owner must supply the installer' })) -Encoding UTF8
  Write-Host "::error::TallyPrime $rel cannot be downloaded from Tally's download centre"
  exit 1
}
