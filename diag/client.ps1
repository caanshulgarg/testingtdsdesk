# curl and Invoke-WebRequest against the bridge (9100) and the diag mirror (9101), with an Origin
$n = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$o = 'http://localhost:8000'
foreach ($u in "http://127.0.0.1:9100/ping?n=$n", 'http://127.0.0.1:9100/status', 'http://127.0.0.1:9101/inspect?c=curl') {
  "curl $u -> " + ((curl.exe -s -H "Origin: $o" $u) -join ' ')
}
foreach ($u in "http://127.0.0.1:9100/ping?n=$n", 'http://127.0.0.1:9100/status', 'http://127.0.0.1:9101/inspect?c=iwr') {
  try { $r = Invoke-WebRequest $u -Headers @{ Origin = $o } -UseBasicParsing -TimeoutSec 10; "iwr $u -> $($r.StatusCode) $($r.Content)" }
  catch { "iwr $u -> $($_.Exception.Message) $($_.ErrorDetails.Message)" }
}
