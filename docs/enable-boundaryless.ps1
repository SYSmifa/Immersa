# Adds Meta's "contextual boundaryless" feature to the manifest of the Immersa APK project, rebuilds, signs and installs it.
# With it the system should not show the Guardian in an app that runs on passthrough (EXPERIMENT: to be checked on the headset).
# Usage (from the web project folder): powershell -ExecutionPolicy Bypass -File .\docs\enable-boundaryless.ps1
# Options: -Project <APK project folder> (default Documents\immersa-apk), -Required true|false (default false: try "true" if
# the Guardian still shows up). To undo: copy AndroidManifest.xml.bak back over AndroidManifest.xml and run rebuild-apk.ps1.
param(
  [string]$Project = (Join-Path $env:USERPROFILE 'Documents\immersa-apk'),
  [string]$Required = 'false'
)
$ErrorActionPreference = 'Stop'
$manifest = Join-Path $Project 'app\src\main\AndroidManifest.xml'
if (-not (Test-Path $manifest)) { throw "Manifest not found: $manifest (is -Project the folder with gradlew.bat?)" }

$text = Get-Content $manifest -Raw
if ($text -match 'CONTEXTUAL_BOUNDARYLESS_APP') {
  Write-Host 'The feature is already in the manifest: only rebuilding.'
} else {
  Copy-Item $manifest "$manifest.bak" -Force
  $feature = '<uses-feature android:name="com.oculus.feature.CONTEXTUAL_BOUNDARYLESS_APP" android:required="' + $Required + '" />' + "`r`n    "
  $at = $text.IndexOf('<application')
  if ($at -lt 0) { throw 'No <application> tag in the manifest.' }
  Set-Content -Path $manifest -Value $text.Insert($at, $feature) -NoNewline -Encoding UTF8
  Write-Host "Added to $manifest (backup: AndroidManifest.xml.bak)"
}

Set-Location $Project
& (Join-Path $PSScriptRoot 'rebuild-apk.ps1')
