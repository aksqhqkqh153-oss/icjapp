param(
    [string]$Zip = "C:\Users\icj24\Downloads\icj2424app_20260422_soomgo_rating_visible_dist_fix.zip",
    [string]$Project = "C:\Users\icj24\Downloads\icjapp",
    [string]$Branch = "main",
    [string]$CommitMessage = "update: show soomgo rating slot and keep review text clean",
    [string]$PagesProject = "icjapp-frontend"
)

$ErrorActionPreference = "Stop"

$frontend = Join-Path $Project "frontend"
$dist = Join-Path $frontend "dist"

if (!(Test-Path $Project)) { throw "프로젝트 폴더가 없습니다: $Project" }
if (!(Test-Path $Zip)) { throw "ZIP 파일이 없습니다: $Zip" }
if (!(Test-Path $frontend)) { throw "frontend 폴더가 없습니다: $frontend" }

$token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
if ([string]::IsNullOrWhiteSpace($token)) { $token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "Machine") }
if ([string]::IsNullOrWhiteSpace($token)) { throw "Cloudflare API Token 환경변수(CLOUDFLARE_API_TOKEN)가 없습니다." }

$accountId = [Environment]::GetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", "User")
if ([string]::IsNullOrWhiteSpace($accountId)) { $accountId = [Environment]::GetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", "Machine") }
if ([string]::IsNullOrWhiteSpace($accountId)) { throw "Cloudflare Account ID 환경변수(CLOUDFLARE_ACCOUNT_ID)가 없습니다." }

Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
$env:CLOUDFLARE_API_TOKEN = $token
$env:CLOUDFLARE_ACCOUNT_ID = $accountId

Write-Host "1) ZIP 덮어쓰기"
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force

Write-Host "2) Git 최신화"
Set-Location $Project
git fetch origin
git checkout $Branch

Write-Host "3) Git 반영 / push"
git add -A
$changes = git status --porcelain
if ($changes) {
    git commit -m $CommitMessage
    git pull --rebase origin $Branch
    git push origin $Branch
} else {
    Write-Host "변경된 파일이 없어 commit 은 생략합니다."
    git pull --rebase origin $Branch
}

Write-Host "4) Cloudflare Pages 수동 업로드"
if (!(Test-Path $dist)) { throw "dist 폴더가 없습니다: $dist" }
Set-Location $frontend
& npx --yes wrangler@4 pages deploy .\dist --project-name $PagesProject
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages 업로드에 실패했습니다." }

Write-Host "완료되었습니다."
