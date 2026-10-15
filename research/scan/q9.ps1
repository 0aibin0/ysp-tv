cd D:\Desktop\deepseek-dsh\yangshipin-tv\research
"===== tail of CCTV1 EPG (look for updateTime field 4) ====="
node .\scan\pb.js ".\capture2\bin\05_https_capi_yangshipin_cn_api_yspepg_program_600001859_20261013.bin" 6 400 2>&1 | Select-Object -Last 22
"`n===== decoded weishi EPG from plain Invoke-WebRequest ====="
node .\scan\pb.js ".\test-weishi-epg.bin" 6 20 2>&1 | Select-Object -First 22
"`n===== decoded FUTURE date EPG (2026-10-15) ====="
node .\scan\pb.js ".\test-future-epg.bin" 6 20 2>&1 | Select-Object -First 22
