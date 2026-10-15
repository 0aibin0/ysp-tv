# Build, align and sign the yangshipin TV APK.
#
# Uses the Android SDK build-tools directly (aapt2 / d8 / zipalign / apksigner)
# so there is no Gradle dependency and the build is fast and reproducible.
#
#   pwsh -File tools/build.ps1
#
$ErrorActionPreference = 'Stop'

$JBR    = "C:\Program Files\JetBrains\PyCharm Community Edition 2023.3.2\jbr"
$JAVAC  = Join-Path $JBR "bin\javac.exe"
$KEYTOOL= Join-Path $JBR "bin\keytool.exe"

# The SDK batch wrappers (d8.bat) and apksigner need a discoverable JDK.
$env:JAVA_HOME = $JBR
$env:PATH = (Join-Path $JBR "bin") + ";" + $env:PATH

$SDK        = "D:\Android\sdk"
$BT         = Join-Path $SDK "build-tools\34.0.0"
$ANDROID_JAR= Join-Path $SDK "platforms\android-34\android.jar"
$AAPT2      = Join-Path $BT "aapt2.exe"
$D8         = Join-Path $BT "d8.bat"
$ZIPALIGN   = Join-Path $BT "zipalign.exe"
$APKSIGNER_JAR = Join-Path $BT "lib\apksigner.jar"

$PROJ     = "D:\Desktop\deepseek-dsh\yangshipin-tv"
$APP      = Join-Path $PROJ "app"
$SRC      = Join-Path $APP "src\main"
$BUILD    = Join-Path $PROJ "build"
$DIST     = Join-Path $PROJ "dist"
$KS       = Join-Path $PROJ "keystore\ysptv.jks"

$KS_PASS  = "ysptv2026"
$KS_ALIAS = "ysptv"
$KS_DNAME = "CN=YSP TV, OU=Personal, O=Personal, L=Shenzhen, ST=Guangdong, C=CN"

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }

# ---------------------------------------------------------------- toolchain
Step "Checking toolchain"
foreach ($t in @($JAVAC, $KEYTOOL, $AAPT2, $D8, $ZIPALIGN, $APKSIGNER_JAR, $ANDROID_JAR)) {
    if (-not (Test-Path $t)) { throw "Missing required tool: $t" }
    Ok (Split-Path $t -Leaf)
}

# ------------------------------------------------------------------- clean
Step "Preparing build directories"
foreach ($d in @("$BUILD\res", "$BUILD\gen", "$BUILD\classes", "$BUILD\dex", $DIST, (Split-Path $KS))) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Remove-Item "$BUILD\res\*"     -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$BUILD\gen\*"     -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$BUILD\classes\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$BUILD\dex\*"     -Recurse -Force -ErrorAction SilentlyContinue
Ok "clean"

# ------------------------------------------------------------------ keystore
Step "Signing key"
if (-not (Test-Path $KS)) {
    & $KEYTOOL -genkeypair -v `
        -keystore $KS -alias $KS_ALIAS `
        -keyalg RSA -keysize 2048 -validity 10950 `
        -storepass $KS_PASS -keypass $KS_PASS `
        -dname $KS_DNAME 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
    Ok "created $KS"
} else {
    Ok "reusing $KS"
}

# --------------------------------------------------------------- resources
Step "Compiling resources (aapt2 compile)"
$resOut = "$BUILD\res.zip"
& $AAPT2 compile --dir "$SRC\res" -o $resOut 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }
Ok "compiled -> $((Get-Item $resOut).Length) bytes"

Step "Linking resources + assets (aapt2 link)"
$unsigned = "$BUILD\unsigned.apk"
& $AAPT2 link `
    -o $unsigned `
    -I $ANDROID_JAR `
    --manifest "$SRC\AndroidManifest.xml" `
    -A "$SRC\assets" `
    --java "$BUILD\gen" `
    --min-sdk-version 21 `
    --target-sdk-version 34 `
    --version-code 1 --version-name "1.0" `
    $resOut 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }
Ok "linked -> $((Get-Item $unsigned).Length) bytes"

# ------------------------------------------------------------------- javac
Step "Compiling Java"
$javaFiles = Get-ChildItem -Path "$SRC\java", "$BUILD\gen" -Filter *.java -Recurse |
             Select-Object -ExpandProperty FullName
Write-Host "    $($javaFiles.Count) source files"
& $JAVAC -nowarn -encoding UTF-8 --release 8 `
    -classpath $ANDROID_JAR `
    -d "$BUILD\classes" `
    $javaFiles 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "javac failed" }
Ok "classes compiled"

# --------------------------------------------------------------------- d8
Step "Dexing (d8)"
$classFiles = Get-ChildItem -Path "$BUILD\classes" -Filter *.class -Recurse |
              Select-Object -ExpandProperty FullName
& $D8 --min-api 21 --lib $ANDROID_JAR --output "$BUILD\dex" $classFiles 2>&1 |
    ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }
$dex = "$BUILD\dex\classes.dex"
if (-not (Test-Path $dex)) { throw "classes.dex not produced" }
Ok "classes.dex -> $((Get-Item $dex).Length) bytes"

# ------------------------------------------------------- assemble final zip
Step "Assembling APK"
Copy-Item $unsigned "$BUILD\assembled.apk" -Force
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open("$BUILD\assembled.apk", 'Update')
try {
    foreach ($f in Get-ChildItem "$BUILD\dex" -Filter *.dex) {
        $entry = $zip.GetEntry($f.Name)
        if ($entry) { $entry.Delete() }
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $f.FullName, $f.Name, [System.IO.Compression.CompressionLevel]::Optimal)
        Ok "added $($f.Name)"
    }
} finally { $zip.Dispose() }
Ok "assembled -> $((Get-Item "$BUILD\assembled.apk").Length) bytes"

# ----------------------------------------------------------------- align
Step "Aligning (zipalign)"
$aligned = "$BUILD\aligned.apk"
if (Test-Path $aligned) { Remove-Item $aligned -Force }
& $ZIPALIGN -f -p 4 "$BUILD\assembled.apk" $aligned 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }
Ok "aligned"

# ------------------------------------------------------------------ sign
Step "Signing (apksigner)"
$final = "$DIST\YspTv-live.apk"
if (Test-Path $final) { Remove-Item $final -Force }
& "$JBR\bin\java.exe" -jar $APKSIGNER_JAR sign `
    --ks $KS --ks-key-alias $KS_ALIAS `
    --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" `
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
    --out $final $aligned 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

Step "Verifying signature"
& "$JBR\bin\java.exe" -jar $APKSIGNER_JAR verify --verbose --print-certs $final 2>&1 |
    ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

Step "Result"
$fi = Get-Item $final
Write-Host ("  APK    : " + $fi.FullName)
Write-Host ("  Size   : {0:N0} bytes ({1:N2} MB)" -f $fi.Length, ($fi.Length / 1MB))
Write-Host ("  SHA256 : " + (Get-FileHash $final -Algorithm SHA256).Hash)
Write-Host ""
Write-Host "DONE" -ForegroundColor Green
