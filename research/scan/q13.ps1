$ErrorActionPreference='Continue'
$dir='D:\Desktop\deepseek-dsh\yangshipin-tv\research\js'
"=== download cctvh5-openapi + related scripts ==="
$urls=@(
 'https://s.yangshipin.cn/CCTVVideo/cctvh5-openapi/cctvh5-openapi.min.js?ver=24722',
 'https://www.yangshipin.cn/Library/CMGPlayer.json',
 'https://sapi.yangshipin.cn/assets/2025/wasm/hls.cmg.js?ver=250813'
)
foreach($u in $urls){
  $n=($u -split '\?')[0].Split('/')[-1]
  $o=Join-Path $dir $n
  try{ Invoke-WebRequest -Uri $u -OutFile $o -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' -Headers @{Referer='https://www.yangshipin.cn/tv/home'} -TimeoutSec 60; "OK $n $((Get-Item $o).Length)" }catch{ "FAIL $n $($_.Exception.Message)" }
}
"`n=== probe legacy / jsonp / ipc endpoints ==="
$probes=@(
 'https://www.yangshipin.cn/api/oms/pc/page/PG00000004',
 'https://capi.yangshipin.cn/api/oms/pc/navigation/home_top_nav',
 'https://capi.yangshipin.cn/api/oms/pc/config',
 'https://capi.yangshipin.cn/api/yspepg/program/600001859',
 'https://csapi.yangshipin.cn/voapi/omsot/v2/live/playinfo?pid=600001859',
 'https://csapi.yangshipin.cn/voapi/omsot/live/playinfo?pid=600001859',
 'https://capi.yangshipin.cn/api/oms/pc/live/playinfo?pid=600001859'
)
foreach($p in $probes){
  try{ $r=Invoke-WebRequest -Uri $p -TimeoutSec 25 -Headers @{Referer='https://www.yangshipin.cn/'}; "OK  $($r.StatusCode) len=$($r.RawContentLength) :: $p" }
  catch{ "ERR $($_.Exception.Response.StatusCode.value__) :: $p" }
}
