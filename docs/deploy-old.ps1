# Publishes an OLD commit to production (app.immersavr.com) to test whether a problem was already there, then returns to your branch.
# Usage:  powershell -ExecutionPolicy Bypass -File .\docs\deploy-old.ps1 <commit>
# Afterwards publish the current build again with docs\deploy.ps1.
param([Parameter(Mandatory = $true)][string]$Commit)
$ErrorActionPreference = 'Stop'
$prod = 'ccr-9d20ed4e-a2qxlt'
$branch = (git branch --show-current).Trim()
if ($branch -eq '') { throw 'not on a branch: go back to your branch first (git checkout <branch>)' }
if ((git status --porcelain).Length -gt 0) { throw 'there are uncommitted changes: commit or stash them first' }
git fetch origin
Write-Host "Building $Commit (branch $branch stays untouched, you come back to it at the end)"
git checkout --detach $Commit
try {
  npm install
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
  if (Test-Path dist\models) { Remove-Item -Recurse -Force dist\models }
  npx wrangler pages deploy dist --project-name immersa --branch $prod
  if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }
  Write-Host "OK: $Commit is online (give the CDN a few minutes, then close and reopen Immersa in the headset)."
} finally {
  git checkout $branch
  npm install
  Write-Host "Back on $branch. To put the current build online again: docs\deploy.ps1"
}
