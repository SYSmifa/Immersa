# Rebuilds, signs and installs the Immersa APK. Run it inside the APK project folder (the one with gradlew.bat and
# android.keystore): powershell -ExecutionPolicy Bypass -File <path>\rebuild-apk.ps1
# (bubblewrap build fails with "spawn EINVAL" on recent Node, so Gradle is called directly.)
$ErrorActionPreference = 'Stop'
# The signing key: in this folder, or (default) in the first APK project folder.
$ks = if (Test-Path .\android.keystore) { (Resolve-Path .\android.keystore).Path } else { Join-Path $env:USERPROFILE 'Documents\immersa-apk\android.keystore' }
$env:JAVA_HOME = (Get-ChildItem "$env:USERPROFILE\.bubblewrap\jdk" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$env:USERPROFILE\.bubblewrap\android_sdk"

.\gradlew.bat assembleRelease
if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }

$bt = (Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory | Sort-Object Name | Select-Object -Last 1).FullName
& "$bt\zipalign.exe" -p -f 4 app\build\outputs\apk\release\app-release-unsigned.apk app-release-aligned.apk
Write-Host 'Signing: type the keystore password when asked.'
& "$bt\apksigner.bat" sign --ks $ks --ks-key-alias android --out app-release-signed.apk app-release-aligned.apk

adb devices
adb install -r app-release-signed.apk
