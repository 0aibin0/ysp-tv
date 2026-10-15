$ErrorActionPreference='Continue'
$out='D:\Desktop\deepseek-dsh\yangshipin-tv\research'
"=== TEST A: EPG with NO custom headers at all (raw, no Referer) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/yspepg/program/600001859/20261013' -TimeoutSec 30
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
}catch{ "FAIL: $($_.Exception.Response.StatusCode.value__) $($_.Exception.Message)" }

"`n=== TEST B: EPG for a 卫视 (黑龙江卫视 pid=600002498) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/yspepg/program/600002498/20261013' -Headers @{Referer='https://www.yangshipin.cn/'} -TimeoutSec 30
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
  [System.IO.File]::WriteAllBytes("$out\test-weishi-epg.bin",$r.Content)
}catch{ "FAIL: $($_.Exception.Message)" }

"`n=== TEST C: EPG for a FUTURE date (2026-10-15) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/yspepg/program/600001859/20261015' -Headers @{Referer='https://www.yangshipin.cn/'} -TimeoutSec 30
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
  [System.IO.File]::WriteAllBytes("$out\test-future-epg.bin",$r.Content)
}catch{ "FAIL: $($_.Exception.Message)" }

"`n=== TEST D: serverTime (no headers) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://csapi.yangshipin.cn/voapi/omsot/serverTime' -TimeoutSec 30
  "STATUS: $($r.StatusCode) BODY: $($r.Content)"
}catch{ "FAIL: $($_.Exception.Message)" }

"`n=== TEST E: page config PG00000004 (no headers, raw protobuf) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/oms/pc/page/PG00000004' -TimeoutSec 40
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
  [System.IO.File]::WriteAllBytes("$out\test-page-nohdr.bin",$r.Content)
}catch{ "FAIL: $($_.Exception.Message)" }

"`n=== TEST F: page config WITH the yspappid/platform headers ==="
try{
  $r=Invoke-WebRequest -Uri 'https://capi.yangshipin.cn/api/oms/pc/page/PG00000004' -Headers @{yspappid='519748109';platform='109';'app-platform'='pc';'app-version'='1.0.0';Referer='https://www.yangshipin.cn/'} -TimeoutSec 40
  "STATUS: $($r.StatusCode) LEN: $($r.RawContentLength)"
  [System.IO.File]::WriteAllBytes("$out\test-page-hdr.bin",$r.Content)
}catch{ "FAIL: $($_.Exception.Message)" }

"`n=== TEST G: per-channel URL /tv?pid=600001859 (expect 200 SPA shell) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://www.yangshipin.cn/tv?pid=600001859' -MaximumRedirection 0 -TimeoutSec 30
  "STATUS: $($r.StatusCode)"
}catch{ "STATUS: $($_.Exception.Response.StatusCode.value__)" }

"`n=== TEST H: player auth endpoint WITHOUT signature (probe) ==="
try{
  $r=Invoke-WebRequest -Uri 'https://player-api.yangshipin.cn/v1/player/auth' -Method POST -Body 'pid=600001859&appid=ysp_pc' -ContentType 'application/x-www-form-urlencoded;charset=UTF-8' -Headers @{yspappid='519748109';Referer='https://www.yangshipin.cn/'} -TimeoutSec 30
  "STATUS: $($r.StatusCode) BODY: $($r.Content)"
}catch{ "FAIL: $($_.Exception.Message)"; try{ $s=$_.Exception.Response.GetResponseStream(); $sr=New-Object System.IO.StreamReader($s); "ERRBODY: $($sr.ReadToEnd())" }catch{} }
