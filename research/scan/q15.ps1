$ErrorActionPreference='Continue'
$ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
$H=@{'Referer'='https://www.yangshipin.cn/';'Origin'='https://www.yangshipin.cn';'User-Agent'=$ua}

function Try-Req($label,$uri,$method,$body,$ct,$extra){
  $h=@{}
  $H.GetEnumerator()|ForEach-Object{$h[$_.Key]=$_.Value}
  if($extra){$extra.GetEnumerator()|ForEach-Object{$h[$_.Key]=$_.Value}}
  try{
    if($method -eq 'POST'){
      $r=Invoke-WebRequest -Uri $uri -Method POST -Body $body -ContentType $ct -Headers $h -TimeoutSec 30
    } else { $r=Invoke-WebRequest -Uri $uri -Headers $h -TimeoutSec 30 }
    "$label => OK $($r.StatusCode) len=$($r.RawContentLength)  $($r.Content.ToString().Substring(0,[Math]::Min(200,$r.Content.ToString().Length)))"
  }catch{
    $code=$_.Exception.Response.StatusCode.value__
    $eb=''
    try{ $s=$_.Exception.Response.GetResponseStream(); $sr=New-Object System.IO.StreamReader($s); $eb=$sr.ReadToEnd() }catch{}
    "$label => ERR $code $eb"
  }
}

"=== 1) h5access open/token (NO login, vappid/vsecret are hardcoded in bundle) ==="
$guid='testguid'+ (Get-Random -Maximum 999999)
$ts=[int][double]::Parse((Get-Date -UFormat %s))
Try-Req 'open/token' "https://h5access.yangshipin.cn/web/open/token?yspappid=519748109&guid=$guid&vappid=59306155&vsecret=b42702bf7309a179d102f3d51b1add2fda0bc7ada64cb801&raw=1&version=v1&ts=$($ts)000&rnd=abcdef0123456789abcdef0123456789" 'GET' $null $null $null

"`n=== 2) player/auth with NO signature ==="
Try-Req 'auth-nosig' 'https://player-api.yangshipin.cn/v1/player/auth' 'POST' "pid=600001859&guid=$guid&appid=ysp_pc" 'application/x-www-form-urlencoded;charset=UTF-8' @{yspappid='519748109'}

"`n=== 3) player/auth with GARBAGE signature ==="
Try-Req 'auth-badsig' 'https://player-api.yangshipin.cn/v1/player/auth' 'POST' "pid=600001859&guid=$guid&appid=ysp_pc&rand_str=ABCDEFGHIJ&signature=00000000000000000000000000000000" 'application/x-www-form-urlencoded;charset=UTF-8' @{yspappid='519748109'}

"`n=== 4) player/auth with NO yspappid header but with sig ==="
Try-Req 'auth-nohdr' 'https://player-api.yangshipin.cn/v1/player/auth' 'POST' "pid=600001859&guid=$guid&appid=ysp_pc&rand_str=ABCDEFGHIJ&signature=00000000000000000000000000000000" 'application/x-www-form-urlencoded;charset=UTF-8' $null

"`n=== 5) get_live_info with no auth headers ==="
Try-Req 'live-nohdr' 'https://player-api.yangshipin.cn/v1/player/get_live_info' 'POST' '{"cnlid":"2024078201","livepid":"600001859","stream":"2"}' 'application/json;charset=UTF-8' @{yspappid='519748109'}
