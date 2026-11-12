# Adds the "relaunch" activity to the Immersa APK project, then rebuilds, signs and installs (rebuild-apk.ps1).
# The web app asks it (through intent://relaunch...) to start the app again from scratch; see docs/android-relaunch/README.md.
# Usage (from the web project folder):
#   powershell -ExecutionPolicy Bypass -File .\docs\enable-relaunch.ps1 -Project C:\Users\loren\Documents\immersa-apk2
# To undo: add -Undo (restores the manifest, removes the Java file, rebuilds).
param(
  [string]$Project = (Join-Path $env:USERPROFILE 'Documents\immersa-apk'),
  [switch]$Undo
)
$ErrorActionPreference = 'Stop'
# Files are written as UTF-8 WITHOUT the byte order mark: PowerShell 5's -Encoding UTF8 adds one, and javac refuses a .java file that starts with it.
$utf8 = New-Object System.Text.UTF8Encoding $false
$manifest = Join-Path $Project 'app\src\main\AndroidManifest.xml'
$gradle = Join-Path $Project 'app\build.gradle'
if (-not (Test-Path $manifest)) { throw "Manifest not found: $manifest (is -Project the folder with gradlew.bat?)" }
if (-not (Test-Path $gradle)) { throw "build.gradle not found: $gradle" }

# The package of the app: applicationId in build.gradle, else the package attribute of the manifest.
$g = Get-Content $gradle -Raw
$m = [regex]::Match($g, 'applicationId\s*=?\s*["'']([^"'']+)["'']')
if (-not $m.Success) { $m = [regex]::Match((Get-Content $manifest -Raw), 'package\s*=\s*"([^"]+)"') }
if (-not $m.Success) { throw 'Cannot find the package name (applicationId) of the app.' }
$pkg = $m.Groups[1].Value
Write-Host "Package: $pkg"
$javaDir = Join-Path $Project ('app\src\main\java\' + ($pkg -replace '\.', '\'))
$javaFile = Join-Path $javaDir 'RelaunchActivity.java'
$backup = "$manifest.relaunch.bak"

if ($Undo) {
  if (Test-Path $backup) { Copy-Item $backup $manifest -Force; Write-Host 'Manifest restored.' }
  if (Test-Path $javaFile) { Remove-Item $javaFile; Write-Host 'RelaunchActivity.java removed.' }
} else {
  # 1. the Java class (the package name goes into the template)
  New-Item -ItemType Directory -Force -Path $javaDir | Out-Null
  $template = Get-Content (Join-Path $PSScriptRoot 'android-relaunch\RelaunchActivity.java') -Raw
  [System.IO.File]::WriteAllText($javaFile, $template.Replace('__PACKAGE__', $pkg), $utf8)
  Write-Host "Written: $javaFile"

  # 2. the activity in the manifest, with the link the page opens: immersa://relaunch
  if (-not (Test-Path $backup)) { Copy-Item $manifest $backup }
  $text = Get-Content $manifest -Raw
  if ($text -match 'RelaunchActivity') {
    Write-Host 'RelaunchActivity is already in the manifest.'
  } else {
    $activity = @"
        <activity
            android:name="$pkg.RelaunchActivity"
            android:exported="true"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="immersa" android:host="relaunch" />
            </intent-filter>
        </activity>

"@
    $at = $text.LastIndexOf('</application>')
    if ($at -lt 0) { throw 'No </application> tag in the manifest.' }
    $text = $text.Insert($at, $activity)
    [System.IO.File]::WriteAllText($manifest, $text, $utf8)
    Write-Host 'Added RelaunchActivity to the manifest.'
  }
  # The system's loading screen of the app (the black seconds while it starts) over passthrough instead of black.
  $text = Get-Content $manifest -Raw
  if ($text -notmatch 'com\.oculus\.ossplash\.background') {
    $meta = '        <meta-data android:name="com.oculus.ossplash.background" android:value="passthrough-contextual" />' + "`n"
    $at = $text.LastIndexOf('</application>')
    $text = $text.Insert($at, $meta)
    [System.IO.File]::WriteAllText($manifest, $text, $utf8)
    Write-Host 'Added the passthrough loading screen (ossplash.background) to the manifest.'
  }
}

Set-Location $Project
& (Join-Path $PSScriptRoot 'rebuild-apk.ps1')
