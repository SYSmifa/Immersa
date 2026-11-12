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
$online = (curl.exe -s https://app.immersavr.com/ | Select-String -Pattern 'assets/index-[^"]*\.js').Matches.Value
Write-Host "Build:  $local"
Write-Host "Online: $online"
if ($local -eq $online) { Write-Host 'OK: the site is up to date.' } else { Write-Warning 'The site still shows another build: wait a minute and run the curl check again.' }
