param(
    [Parameter(Mandatory = $true)]
    [string]$Zip,
    [string]$Repo = "C:\Users\icj24\Downloads\icjapp",
    [string]$Branch = "main",
    [string]$CommitMessage = "update: railway disposal db primary sync",
    [string]$PagesProjectName = "icjapp-frontend"
)

$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed. exit code=$LASTEXITCODE"
    }
}

function Invoke-Wrangler {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & npx --yes wrangler@4 @Args
    return $LASTEXITCODE
}

if (!(Test-Path $Repo)) { throw "Repo folder not found: $Repo" }
if (!(Test-Path $Zip)) { throw "ZIP file not found: $Zip" }
if (!(Test-Path (Join-Path $Repo ".git"))) { throw ".git folder not found under repo: $Repo" }

$frontend = Join-Path $Repo "frontend"
$dist = Join-Path $frontend "dist"
$backendStatic = Join-Path $Repo "backend\static"
$stashCreated = $false

Write-Host "1) Stop running processes"
Get-Process python,node,npm,uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
taskkill /F /IM python.exe /T *> $null
taskkill /F /IM node.exe /T *> $null
taskkill /F /IM npm.cmd /T *> $null
taskkill /F /IM uvicorn.exe /T *> $null

Write-Host "2) Overwrite project from ZIP"
Expand-Archive -LiteralPath $Zip -DestinationPath $Repo -Force

Set-Location $Repo

Write-Host "3) Sync git first to avoid push reject"
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
        throw "git stash pop failed. Resolve conflicts in repo, then rerun from build step."
    }
}

Write-Host "4) Frontend install/build"
Set-Location $frontend
if (!(Test-Path (Join-Path $frontend "node_modules"))) {
    npm install
    Assert-LastExitCode "npm install"
}
npm run build
Assert-LastExitCode "npm run build"
if (!(Test-Path $dist)) { throw "dist folder not found after build: $dist" }

Write-Host "5) Mirror dist to backend/static"
if (!(Test-Path $backendStatic)) {
    New-Item -ItemType Directory -Path $backendStatic | Out-Null
}
cmd /c robocopy "$dist" "$backendStatic" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed while mirroring dist to backend/static. exit code=$LASTEXITCODE"
}

Write-Host "6) Commit and push"
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
} else {
    Write-Host "No git changes to commit. Skipping commit/push."
}

Write-Host "7) Cloudflare Pages login check and deploy"
Set-Location $frontend
Invoke-Wrangler whoami > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Invoke-Wrangler login
    Assert-LastExitCode "wrangler login"
}
Invoke-Wrangler pages deploy $dist --project-name $PagesProjectName
Assert-LastExitCode "wrangler pages deploy"

Write-Host "Done"
