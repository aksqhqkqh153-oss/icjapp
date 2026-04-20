param(
    [Parameter(Mandatory = $true)]
    [string]$Zip,
    [string]$Repo = "C:\Users\icj24\Downloads\icjapp",
    [string]$Branch = "main",
    [string]$CommitMessage = "update: disposal settlement range text filter and sort",
    [string]$PagesProjectName = "icjapp-frontend"
)

$ErrorActionPreference = "Stop"

$frontend = Join-Path $Repo "frontend"
$dist = Join-Path $frontend "dist"
$backendStatic = Join-Path $Repo "backend\static"
$buildLog = Join-Path $Repo ("build_log_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")
$stashCreated = $false

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed. exit code=$LASTEXITCODE"
    }
}

function Invoke-Wrangler {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & npx.cmd --yes wrangler@4 @Args
    return $LASTEXITCODE
}

if (!(Test-Path $Repo)) { throw "Project folder not found: $Repo" }
if (!(Test-Path $Zip)) { throw "ZIP file not found: $Zip" }
if (!(Test-Path (Join-Path $Repo ".git"))) { throw ".git folder not found: $Repo" }

Write-Host "1) Overwrite project from ZIP"
Expand-Archive -LiteralPath $Zip -DestinationPath $Repo -Force

Set-Location $Repo

Write-Host "2) Sync git first to avoid push reject"
$gitChanges = git status --porcelain
Assert-LastExitCode "git status"

if ($gitChanges) {
    git stash push --include-untracked -m ("zip-overwrite-before-sync-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    Assert-LastExitCode "git stash push"
    $stashCreated = $true
}

git fetch origin
Assert-LastExitCode "git fetch"

git checkout $Branch
Assert-LastExitCode "git checkout"

git reset --hard ("origin/" + $Branch)
Assert-LastExitCode "git reset --hard"

git clean -fd
Assert-LastExitCode "git clean -fd"

if ($stashCreated) {
    git stash pop
    if ($LASTEXITCODE -ne 0) {
        throw "git stash pop conflict. Run git status, resolve conflicts, then retry."
    }
}

Write-Host "3) Frontend build"
if (!(Test-Path $frontend)) { throw "frontend folder not found: $frontend" }
Set-Location $frontend

Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
& npm.cmd run build 2>&1 | Tee-Object -FilePath $buildLog
$buildExit = $LASTEXITCODE

if ($buildExit -ne 0) {
    Write-Host "- npm build returned non-zero exit code: $buildExit"
    Write-Host "- If dist from ZIP exists, continue with that output"
}

if (!(Test-Path (Join-Path $dist "index.html"))) {
    throw "dist/index.html not found. Build failed and ZIP fallback output is also missing. See log: $buildLog"
}

Write-Host "4) Copy dist to backend/static"
if (!(Test-Path $backendStatic)) {
    New-Item -ItemType Directory -Path $backendStatic | Out-Null
}
Get-ChildItem -Path $backendStatic -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $dist "*") -Destination $backendStatic -Recurse -Force

Write-Host "5) Commit and push"
Set-Location $Repo

git add .
Assert-LastExitCode "git add"

$staged = git diff --cached --name-only
Assert-LastExitCode "git diff --cached"

if ($staged) {
    git commit -m $CommitMessage
    Assert-LastExitCode "git commit"

    git push origin $Branch
    Assert-LastExitCode "git push"
}
else {
    Write-Host "No changes to commit. Skip commit/push"
}

Write-Host "6) Cloudflare Pages deploy"
Set-Location $frontend

Invoke-Wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Wrangler login required. Browser login will open"
    Invoke-Wrangler login
    Assert-LastExitCode "wrangler login"
}

Invoke-Wrangler pages deploy dist --project-name $PagesProjectName
Assert-LastExitCode "wrangler pages deploy"

Write-Host ""
Write-Host "Done"
Write-Host "- ZIP overwrite complete"
Write-Host "- Git sync complete"
Write-Host "- Frontend build complete"
Write-Host "- backend/static copy complete"
Write-Host "- Git push complete"
Write-Host "- Cloudflare Pages deploy complete"
