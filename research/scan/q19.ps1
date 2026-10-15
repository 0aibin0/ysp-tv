$ErrorActionPreference='Continue'
$out='D:\Desktop\deepseek-dsh\yangshipin-tv\research'
"=== JSONP / IPC check in bundles ==="
cd $out\js
node ..\scan\g.js app.40ff9730.js 'jsonp|callback=' 200 6
node ..\scan\g.js chunk-vendors.86ef4b5a.js 'callback=\?|jsonpCallback' 200 4

"`n=== END-TO-END from plain PowerShell: 6 channels, EPG + now-playing ==="
$st = Invoke-WebRequest -Uri 'https://csapi.yangshipin.cn/voapi/omsot/serverTime' -TimeoutSec 20
$now = [int][double]::Parse((Get-Date -UFormat %s))
"serverTime epoch: $now"
$pids=@{'CCTV1'='600001859';'CCTV13'='600001811';'CCTV17'='600001810';'北京卫视'='600002309';'湖南卫视'='600002475';'新疆卫视'='600152138'}
foreach($k in $pids.Keys){
  $p=$pids[$k]
  $url="https://capi.yangshipping.cn/api/yspepg/program/$p/20261013"
  $url="https://capi.yangshipin.cn/api/yspepg/program/$p/20261013"
  try{
    $r=Invoke-WebRequest -Uri $url -TimeoutSec 25
    [System.IO.File]::WriteAllBytes("$out\verify-$p.bin",$r.Content)
    "OK $k pid=$p len=$($r.RawContentLength)"
  }catch{ "FAIL $k pid=$p : $($_.Exception.Message)" }
}
