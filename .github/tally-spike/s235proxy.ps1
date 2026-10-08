# Mode s235: proxy235.py between the bridge (TallyHost 127.0.0.2) and Tally (127.0.0.1:9000). Dot-sourced by flowv.ps1
# before the bridge's setup. Started only while Tally holds its port (it binds 127.0.0.2:9000 beside Tally's listener);
# stopped whenever Tally is closed, so a closed Tally leaves nothing on the bridge's port (check s5).
$script:proxy = $null
$proxyLog = Join-Path $out 'proxy.jsonl'
$proxyCtl = 'C:\fcspike\proxy-ctl.json'
function Stop-S235Proxy { if ($script:proxy) { Stop-Process -Id $script:proxy.Id -Force -ErrorAction SilentlyContinue; $script:proxy = $null; Start-Sleep 1 } }
function Start-S235Proxy {
  Stop-S235Proxy
  Remove-Item $proxyCtl -Force -ErrorAction SilentlyContinue
  $script:proxy = Start-Process -FilePath $py -ArgumentList "`"$PSScriptRoot\proxy235.py`" 9000 `"$proxyLog`" `"$proxyCtl`"" -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $out "proxy-stderr-$(Get-Date -Format HHmmss).txt")
  Start-Sleep 2
  $code = 0; try { $code = (Invoke-WebRequest 'http://127.0.0.2:9000' -UseBasicParsing -TimeoutSec 10).StatusCode } catch { Write-Host "proxy check: $($_.Exception.Message)" }
  $ok = (-not $script:proxy.HasExited) -and $code -eq 200
  Write-Host "[$(Get-Date -Format HH:mm:ss)] proxy 127.0.0.2:9000 -> Tally: $ok (HTTP $code, pid $($script:proxy.Id))"
  return $ok
}
