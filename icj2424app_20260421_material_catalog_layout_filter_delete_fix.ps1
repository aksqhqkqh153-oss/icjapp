$ErrorActionPreference = "Stop"

# ===== 고정 경로 =====
$project = "C:\Users\icj24\Downloads\icjapp"
$zip = "C:\Users\icj24\Downloads\icj2424app_20260421_material_catalog_layout_filter_delete_fix.zip"
$branch = "main"
$commitMsg = "update: refine materials catalog table layout and delete flow"
$pagesProject = "icjapp-frontend"
$frontend = Join-Path $project "frontend"
$frontendDist = Join-Path $frontend "dist"
$backendStatic = Join-Path $project "backend\static"

function Invoke-Wrangler {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & npx --yes wrangler@4 @Args
    return $LASTEXITCODE
}

if (!(Test-Path $project)) { throw "프로젝트 폴더가 없습니다: $project" }
if (!(Test-Path $zip)) { throw "ZIP 파일이 없습니다: $zip" }
if (!(Test-Path (Join-Path $project ".git"))) { throw ".git 폴더가 없습니다: $project" }
if (!(Test-Path $frontend)) { throw "frontend 폴더가 없습니다: $frontend" }
if (!(Test-Path $backendStatic)) { throw "backend\static 폴더가 없습니다: $backendStatic" }

Write-Host "1) ZIP 덮어쓰기"
Expand-Archive -LiteralPath $zip -DestinationPath $project -Force

Write-Host "2) Git 최신화"
Set-Location $project
git checkout $branch
git fetch origin $branch

git add .
$hasChanges = $true
try {
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { $hasChanges = $false }
} catch {
    $hasChanges = $true
}

if ($hasChanges) {
    git commit -m $commitMsg
} else {
    Write-Host "커밋할 변경사항이 없습니다."
}

git pull --rebase origin $branch
git push origin $branch

Write-Host "3) 프론트 빌드"
Set-Location $frontend
npm run build

if (!(Test-Path $frontendDist)) { throw "프론트 빌드 결과(dist)가 없습니다: $frontendDist" }

Write-Host "4) backend/static 반영"
robocopy $frontendDist $backendStatic /MIR /NFL /NDL /NJH /NJS /NC /NS | Out-Null
if ($LASTEXITCODE -gt 7) { throw "backend/static 반영(robocopy) 중 오류가 발생했습니다. exitcode=$LASTEXITCODE" }

Write-Host "5) Cloudflare Pages 로그인 상태 확인"
Invoke-Wrangler whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Wrangler 로그인 세션이 없어 브라우저 로그인으로 전환합니다."
    Invoke-Wrangler login
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare Wrangler 로그인에 실패했습니다." }

    Invoke-Wrangler whoami | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cloudflare Wrangler 로그인 확인에 실패했습니다. 로그인 완료 후 다시 실행해 주세요."
    }
}

Write-Host "6) Cloudflare Pages 업로드"
Set-Location $frontend
Invoke-Wrangler pages deploy dist --project-name $pagesProject
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages 배포에 실패했습니다." }

Write-Host "완료되었습니다."
