# Publishes the web app to PRODUCTION (app.immersavr.com) from whatever git branch is checked out.
# Cloudflare Pages decides production or preview from the branch name wrangler passes: only `ccr-9d20ed4e-a2qxlt` is production,
# so a plain `wrangler pages deploy` from any other branch (e.g. the Unity branch) makes a preview and the site does not change.
# Usage (from the web project folder):  powershell -ExecutionPolicy Bypass -File .\docs\deploy.ps1
$ErrorActionPreference = 'Stop'
$prod = 'ccr-9d20ed4e-a2qxlt'
$branch = (git branch --show-current).Trim()
Write-Host "Git branch: $branch  ->  published as: $prod (production)"

git pull --rebase origin $branch
if ($LASTEXITCODE -ne 0) { throw 'git pull --rebase failed: fix it (git status) before publishing' }

npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }

# public\models holds test models: they must not go online
if (Test-Path dist\models) { Remove-Item -Recurse -Force dist\models }

npx wrangler pages deploy dist --project-name immersa --branch $prod
if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }

# What is online now (the file names must be the ones of dist\index.html)
$local = (Get-Content dist\index.html | Select-String -Pattern 'assets/index-[^"]*\.js').Matches.Value
Write-Host "Build:  $local"
# The CDN cache can serve the old page for a while: retry up to ~2 minutes (cache-busting query string)
$online = ''
for ($i = 0; $i -lt 12; $i++) {
  $online = (curl.exe -s -H 'Cache-Control: no-cache' "https://app.immersavr.com/?v=$([guid]::NewGuid().ToString('N'))" | Select-String -Pattern 'assets/index-[^"]*\.js').Matches.Value
  if ($local -eq $online) { break }
  Write-Host "Online: $online (still the old build, waiting 10 s...)"
  Start-Sleep -Seconds 10
}
if ($local -eq $online) { Write-Host 'OK: the site is up to date. Close and reopen Immersa in the headset.' }
else { Write-Host 'Deploy complete. The CDN cache is just slow: in a few minutes the headset will load the new build. Nothing else to do.' }
