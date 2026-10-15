cd D:\Desktop\deepseek-dsh\yangshipin-tv\research\js
"===== rand_str / signature across bundles ====="
Get-ChildItem *.js | ForEach-Object { $c=Get-Content -Raw $_.FullName; $n=([regex]::Matches($c,'rand_str')).Count; if($n -gt 0){"$($_.Name): rand_str=$n"} }
"--- search app ---"
node ..\scan\g.js app.40ff9730.js 'rand_str' 900 4
"--- search vendors ---"
node ..\scan\g.js chunk-vendors.86ef4b5a.js 'rand_str' 900 3
