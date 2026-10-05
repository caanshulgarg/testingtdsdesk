# POST a tiny XML request to Tally's port; prints the answer
param([string]$label = 'xml', [string]$body = '')
if (-not $body) {
  $body = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FCList</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FCList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
try { $g = Invoke-WebRequest -Uri http://localhost:9000 -UseBasicParsing -TimeoutSec 15; Write-Host "[$label] GET -> $($g.StatusCode): $($g.Content)" } catch { Write-Host "[$label] GET failed: $($_.Exception.Message)" }
try {
  $r = Invoke-WebRequest -Uri http://localhost:9000 -Method Post -Body $body -ContentType 'text/xml' -UseBasicParsing -TimeoutSec 30
  $c = $r.Content; if ($c.Length -gt 3000) { $c = $c.Substring(0, 3000) + '...' }
  Write-Host "[$label] POST -> $($r.StatusCode): $c"
} catch { Write-Host "[$label] POST failed: $($_.Exception.Message)" }
