cd D:\Desktop\deepseek-dsh\yangshipin-tv\research
"=== what does www.yangshipin.cn/api/oms/pc/page/PG00000004 return? (first 200 chars) ==="
$r = Invoke-WebRequest -Uri 'https://www.yangshipin.cn/api/oms/pc/page/PG00000004' -TimeoutSec 25
$r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))
"`nCT: $($r.Headers['Content-Type'])"
"`n=== config (15 bytes hex) ==="
$c = Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/oms/pc/config' -TimeoutSec 25
($c.Content | ForEach-Object { [System.BitConverter]::ToString($_) })
"`n=== live/playinfo 23 bytes ==="
$l = Invoke-WebRequest -Uri 'https://csapi.yangshipin.cn/voapi/omsot/live/playinfo?pid=600001859' -TimeoutSec 25
$bytes = $l.Content
[System.Text.Encoding]::UTF8.GetString($bytes)
"`n=== cctvh5-openapi: search for jsonp/ipc/endpoint ==="
node .\scan\g.js .\js\cctvh5-openapi.min.js 'jsonp|callback|ipc|postMessage|getSignature' 300 8
