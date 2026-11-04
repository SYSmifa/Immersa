# Makes the Immersa APK a "boundaryless app" (Meta's documented feature): the system does not show or ask for the Guardian
# while the app runs. It edits the manifest of the APK project, then rebuilds, signs and installs (rebuild-apk.ps1).
# Meta's docs (Unity / Unreal "Boundaryless"): <uses-feature android:name="com.oculus.feature.BOUNDARYLESS_APP" android:required="true"/>,
# for 6DOF apps without immersive (VR) content, standalone from an APK. The older CONTEXTUAL_BOUNDARYLESS_APP flag is removed:
# Meta says the two are mutually exclusive.
# Usage (from the web project folder):
#   powershell -ExecutionPolicy Bypass -File .\docs\enable-boundaryless.ps1 -Project C:\Users\loren\Documents\immersa-apk2
# To undo: copy AndroidManifest.xml.bak (the original) over AndroidManifest.xml and run rebuild-apk.ps1.
param(
  [string]$Project = (Join-Path $env:USERPROFILE 'Documents\immersa-apk')
)
$ErrorActionPreference = 'Stop'
$manifest = Join-Path $Project 'app\src\main\AndroidManifest.xml'
if (-not (Test-Path $manifest)) { throw "Manifest not found: $manifest (is -Project the folder with gradlew.bat?)" }
if (-not (Test-Path "$manifest.bak")) { Copy-Item $manifest "$manifest.bak" }

$text = Get-Content $manifest -Raw
# drop the older "contextual" flag, if an earlier run added it
$text = [regex]::Replace($text, '[ \t]*<uses-feature[^>]*CONTEXTUAL_BOUNDARYLESS_APP[^>]*/>\s*', '')
if ($text -match 'com\.oculus\.feature\.BOUNDARYLESS_APP') {
  Write-Host 'BOUNDARYLESS_APP is already in the manifest.'
} else {
  $at = $text.IndexOf('<application')
  if ($at -lt 0) { throw 'No <application> tag in the manifest.' }
  $feature = '<uses-feature android:name="com.oculus.feature.BOUNDARYLESS_APP" android:required="true" />' + "`r`n    "
  $text = $text.Insert($at, $feature)
  Write-Host 'Added BOUNDARYLESS_APP (required=true).'
}
Set-Content -Path $manifest -Value $text -NoNewline -Encoding UTF8

Set-Location $Project
& (Join-Path $PSScriptRoot 'rebuild-apk.ps1')
