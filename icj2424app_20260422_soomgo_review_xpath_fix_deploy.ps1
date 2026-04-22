$ErrorActionPreference = "Stop"

# ===== 고정 경로 =====
$project = "C:\Users\icj24\Downloads\icjapp"
$zip = "C:\Users\icj24\Downloads\icj2424app_20260422_soomgo_review_xpath_fix.zip"
$branch = "main"
$commitMessage = "update: fix soomgo review xpath scan and real-name mapping"
$pagesProject = "icjapp-frontend"
$frontend = Join-Path $project "frontend"
$dist = Join-Path $frontend "dist"
$backendStatic = Join-Path $project "backend\static"

function Invoke-Wrangler {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & npx --yes wrangler@4 @Args
    return $LASTEXITCODE
}

if (!(Test-Path $project)) { throw "프로젝트 폴더가 없습니다: $project" }
if (!(Test-Path $zip)) { throw "ZIP 파일이 없습니다: $zip" }
if (!(Test-Path $frontend)) { throw "frontend 폴더가 없습니다: $frontend" }

Write-Host "1) ZIP 덮어쓰기"
Expand-Archive -LiteralPath $zip -DestinationPath $project -Force

Write-Host "2) Git 최신화"
Set-Location $project
git checkout $branch
$changes = git status --porcelain
if ($changes) {
    git add -A
    git commit -m $commitMessage
    git push origin $branch
} else {
    Write-Host "변경된 파일이 없어 Git commit / push 를 생략합니다."
}

Write-Host "3) 프론트 빌드"
Set-Location $frontend
npm run build

Write-Host "4) backend/static 반영"
if (!(Test-Path $dist)) { throw "dist 폴더가 없습니다: $dist" }
if (!(Test-Path $backendStatic)) { New-Item -ItemType Directory -Path $backendStatic -Force | Out-Null }
Get-ChildItem -LiteralPath $backendStatic -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $dist -Force | Copy-Item -Destination $backendStatic -Recurse -Force

Write-Host "5) Cloudflare Pages 로그인 확인"
$wranglerCode = Invoke-Wrangler whoami
if ($wranglerCode -ne 0) {
    $wranglerCode = Invoke-Wrangler login
    if ($wranglerCode -ne 0) { throw "Cloudflare Wrangler 로그인에 실패했습니다." }
}

Write-Host "6) Cloudflare Pages 업로드"
$wranglerCode = Invoke-Wrangler pages deploy $dist --project-name $pagesProject
if ($wranglerCode -ne 0) { throw "Cloudflare Pages 업로드에 실패했습니다." }

Write-Host "완료되었습니다."
