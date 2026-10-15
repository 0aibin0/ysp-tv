cd D:\Desktop\deepseek-dsh\yangshipin-tv\research\js
"===== feedModuleList across all ====="
Get-ChildItem *.js | ForEach-Object { $c=Get-Content -Raw $_.FullName; $n=([regex]::Matches($c,'feedModuleList')).Count; if($n -gt 0){"$($_.Name): $n"} }
"===== getPagePage context ====="
node ..\scan\g.js app.40ff9730.js 'getPagePage' 600 4
"===== getPcAppConfigModel context ====="
node ..\scan\g.js app.40ff9730.js 'getPcAppConfigModel' 600 4
