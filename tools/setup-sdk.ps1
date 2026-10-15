$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$JBR = "C:\Program Files\JetBrains\PyCharm Community Edition 2023.3.2\jbr"
$env:JAVA_HOME = $JBR
$Root = "D:\Android"
$Sdk  = "$Root\sdk"
$Dl   = "$Root\dl"

New-Item -ItemType Directory -Force -Path $Dl, $Sdk | Out-Null

$zip = "$Dl\cmdline-tools.zip"
if (-not (Test-Path $zip)) {
    Write-Host "Downloading commandlinetools..."
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip -UseBasicParsing
}
Write-Host "Downloaded: $((Get-Item $zip).Length) bytes"

$tmp = "$Dl\cmdline-extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force

# Official layout requires <sdk>/cmdline-tools/latest/bin
$dest = "$Sdk\cmdline-tools\latest"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Move-Item "$tmp\cmdline-tools" $dest
Remove-Item $tmp -Recurse -Force

$sdkmanager = "$dest\bin\sdkmanager.bat"
Write-Host "sdkmanager: $sdkmanager (exists=$(Test-Path $sdkmanager))"

# Accept licenses non-interactively
$yes = ("y`r`n" * 100)
$yes | & $sdkmanager --sdk_root=$Sdk --licenses 2>&1 | Select-Object -Last 5 | Out-String | Write-Host

Write-Host "Installing platform-tools, platforms;android-34, build-tools;34.0.0 ..."
& $sdkmanager --sdk_root=$Sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | Select-Object -Last 20 | Out-String | Write-Host

Write-Host "=== RESULT ==="
Get-ChildItem "$Sdk\platforms" -Name -ErrorAction SilentlyContinue
Get-ChildItem "$Sdk\build-tools" -Name -ErrorAction SilentlyContinue
Test-Path "$Sdk\build-tools\34.0.0\aapt2.exe"
Test-Path "$Sdk\build-tools\34.0.0\lib\apksigner.jar"
Test-Path "$Sdk\platforms\android-34\android.jar"
Write-Host "DONE"
