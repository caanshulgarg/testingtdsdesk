# Versions step 1: the TallyPrime installer of release $env:TALLY_REL from Tally's own download centre only
# (tallymirror.tallysolutions.com/download_centre/<folder>/TP/Full/setup.exe; 7.1 came from Rel.7.1_gold). Never a mirror
# of anyone else. The other releases are asked too (first KB only) so the report can name the nearest one that can be had.
# Writes $env:RES\installer.txt (one line per URL tried) and, when the release itself is there, TALLY_SETUP to GITHUB_ENV.
$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$rel = $env:TALLY_REL
New-Item -ItemType Directory -Force $env:RES | Out-Null
$rep = Join-Path $env:RES 'installer.txt'
function Url($r) { "https://tallymirror.tallysolutions.com/download_centre/Rel.${r}_gold/TP/Full/setup.exe" }
function Head($u) {
  try {
    # the first KB only (a ranged GET: some CDNs refuse HEAD); the full size from Content-Range
    $q = [System.Net.HttpWebRequest]::Create($u); $q.Method = 'GET'; $q.UserAgent = $ua; $q.Timeout = 30000; $q.AllowAutoRedirect = $true; $q.AddRange(0, 1023)
    $a = $q.GetResponse(); $code = [int]$a.StatusCode; $len = $a.ContentLength; $lm = $a.Headers['Last-Modified']
    $cr = $a.Headers['Content-Range']; if ($cr -match '/(\d+)$') { $len = [int64]$Matches[1] }; if ($code -eq 206) { $code = 200 }; $a.Close()
    return [pscustomobject]@{ url = $u; code = $code; len = $len; modified = $lm }
  } catch {
    $code = 0; try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
    if (-not $code) { try { $code = [int]$_.Exception.Response.StatusCode } catch {} }
    return [pscustomobject]@{ url = $u; code = $code; len = -1; modified = ''; err = $_.Exception.Message }
  }
}
# Tally's own download page lists every TallyPrime release's setup (files_json in DownloadUtility-india.js, the script
# behind tallysolutions.com/download's buttons): the folders differ by release (Rel.3.0_Gold, Rel.4.1, Rel6.2, Rel.7.1_gold),
# so the URL is taken from Tally's own list; the plain pattern Rel.<x>_gold is asked as well, for the record
$list = @()
try {
  $js = (Invoke-WebRequest -Uri 'https://tallysolutions.com/utility/js/DownloadUtility-india.js' -UserAgent $ua -UseBasicParsing -TimeoutSec 60).Content
  $list = @([regex]::Matches($js, 'https:\\?/\\?/tallymirror\.tallysolutions\.com\\?/download_centre\\?/([^"\\/]+)\\?/TP\\?/Full\\?/setup\.exe') | ForEach-Object { [pscustomobject]@{ folder = $_.Groups[1].Value; url = ($_.Value -replace '\\/', '/') } } | Sort-Object url -Unique)
  Add-Content $rep ("Tally's download page lists TallyPrime setups for: " + (($list | ForEach-Object folder) -join ', ')) -Encoding UTF8
} catch { Add-Content $rep "Tally's download page list could not be read: $($_.Exception.Message)" -Encoding UTF8 }
function Norm($f) { (($f -replace '(?i)^(rel|REL)[._]?(TP_)?', '') -replace '(?i)_gold$', '') }
$mine = @($list | Where-Object { (Norm $_.folder) -eq $rel } | Sort-Object { if ($_.folder -match '(?i)gold') { 0 } else { 1 } })
$cands = @((Url $rel)) + @($mine | ForEach-Object url) | Select-Object -Unique
$heads = foreach ($u in $cands) { $h = Head $u; Write-Host ("GET (first KB) {0} -> {1} len={2} modified={3} {4}" -f $u, $h.code, $h.len, $h.modified, $h.err); $h }
$heads | ForEach-Object { "{0} {1} bytes, Last-Modified {2}: {3}" -f $(if ($_.code -eq 200 -and $_.len -gt 5MB) { 'AVAILABLE' } else { "NO($($_.code))" }), $_.len, $_.modified, $_.url } | Add-Content $rep -Encoding UTF8
# the other releases on the list (for the nearest one when this one cannot be had)
$others = foreach ($o in ($list | Where-Object { (Norm $_.folder) -ne $rel -and (Norm $_.folder) -match '^[3-7]\.' })) { $h = Head $o.url; [pscustomobject]@{ rel = (Norm $o.folder); url = $o.url; ok = ($h.code -eq 200 -and $h.len -gt 5MB); len = $h.len } }
$others | ForEach-Object { "{0} other release {1}: {2} ({3} bytes)" -f $(if ($_.ok) { 'AVAILABLE' } else { 'NO' }), $_.rel, $_.url, $_.len } | Add-Content $rep -Encoding UTF8
$out = "$env:RUNNER_TEMP\TallyPrimeSetup.exe"
$ok1 = @($heads | Where-Object { $_.code -eq 200 -and $_.len -gt 5MB })
$u = if ($ok1.Count) { $ok1[0].url } else { Url $rel }
try {
  $t0 = Get-Date
  Invoke-WebRequest -Uri $u -UserAgent $ua -UseBasicParsing -OutFile $out -TimeoutSec 900
  $fi = Get-Item $out
  if ($fi.Length -lt 5MB) { throw "too small ($($fi.Length) bytes)" }
  $sha = (Get-FileHash $out -Algorithm SHA256).Hash
  $sig = try { (Get-AuthenticodeSignature $out) } catch { $null }
  $l = "DOWNLOADED Rel.$rel from $u : $($fi.Length) bytes in $([int]((Get-Date) - $t0).TotalSeconds) s, SHA-256 $sha, signature $($sig.Status) $($sig.SignerCertificate.Subject), file version $($fi.VersionInfo.FileVersion) product $($fi.VersionInfo.ProductVersion)"
  Write-Host $l; Add-Content $rep $l -Encoding UTF8; Write-Host "::notice::$l"
  if ($sig -and $sig.Status -ne 'Valid') { Write-Host "::warning::installer signature is $($sig.Status)" }
  "TALLY_SETUP=$out" | Out-File -Append $env:GITHUB_ENV
  "TALLY_URL_USED=$u" | Out-File -Append $env:GITHUB_ENV
  exit 0
} catch {
  $l = "NOT DOWNLOADABLE Rel.$rel from $u : $($_.Exception.Message)"
  Write-Host $l; Add-Content $rep $l -Encoding UTF8
  $ok = @($others | Where-Object ok)
  Add-Content $rep ("NEAREST available on Tally's download centre: {0}" -f $(if ($ok.Count) { ($ok | ForEach-Object rel) -join ', ' } else { 'none: the owner must supply the installer' })) -Encoding UTF8
  Write-Host "::error::TallyPrime $rel cannot be downloaded from Tally's download centre"
  exit 1
}
