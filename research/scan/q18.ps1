cd D:\Desktop\deepseek-dsh\yangshipin-tv\research
$u = (node -e "console.log(require('./capture4/m3u8.json').m3u8.url)")
"Testing whether the OLD captured m3u8 URL still works (token lifetime check)..."
"captured at ~06:56 UTC; now: $((Get-Date).ToUniversalTime().ToString('HH:mm:ss')) UTC"
try{
  $r = Invoke-WebRequest -Uri $u -TimeoutSec 30
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
  ($r.Content -split "`n" | Select-Object -First 6) -join "`n"
}catch{ "FAIL: $($_.Exception.Response.StatusCode.value__) $($_.Exception.Message)" }
