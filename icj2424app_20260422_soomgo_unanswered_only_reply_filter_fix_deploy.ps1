$ErrorActionPreference = "Stop"

$Zip = "C:\Users\icj24\Downloads\icj2424app_20260422_soomgo_unanswered_only_reply_filter_fix.zip"
$Project = "C:\Users\icj24\Downloads\icjapp"
$Branch = "main"
$CommitMessage = "update: filter answered soomgo reviews from auto scan"
$PagesProject = "icjapp-frontend"

$frontend = Join-Path $Project "frontend"
$dist = Join-Path $frontend "dist"

if (!(Test-Path $Project)) { throw "프로젝트 폴더가 없습니다: $Project" }
if (!(Test-Path $Zip)) { throw "ZIP 파일이 없습니다: $Zip" }
if (!(Test-Path $frontend)) { throw "frontend 폴더가 없습니다: $frontend" }

Write-Host "1) ZIP 덮어쓰기"
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force

Write-Host "2) Git 최신화"
Set-Location $Project
git fetch origin
git checkout $Branch
git pull --rebase origin $Branch

Write-Host "3) Git 반영 / push"
git add -A
$changes = git status --porcelain
if ($changes) {
    git commit -m $CommitMessage
}
git push origin $Branch

Write-Host "4) 프론트엔드 빌드"
Set-Location $frontend
if (Test-Path $dist) {
    Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "프론트엔드 빌드에 실패했습니다." }
if (!(Test-Path $dist)) { throw "dist 폴더가 생성되지 않았습니다: $dist" }

Write-Host "5) Cloudflare Pages 수동 업로드"
npx wrangler pages deploy .\dist --project-name $PagesProject
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages 업로드에 실패했습니다." }

Write-Host "완료되었습니다."
