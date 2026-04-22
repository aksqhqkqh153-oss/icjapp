param(
    [string]$Zip = "C:\Users\icj24\Downloads\icj2424app_20260422_soomgo_xpath_id_fallback_cf_token_fix.zip",
    [string]$Project = "C:\Users\icj24\Downloads\icjapp",
    [string]$Branch = "main",
    [string]$CommitMessage = "update: fix soomgo review xpath id fallback and cf token deploy",
    [string]$PagesProject = "icjapp-frontend",
    [Parameter(Mandatory = $true)][string]$CloudflareApiToken,
    [Parameter(Mandatory = $true)][string]$CloudflareAccountId
)

$ErrorActionPreference = "Stop"

$frontend = Join-Path $Project "frontend"
$dist = Join-Path $frontend "dist"
$backendStatic = Join-Path $Project "backend\static"

if (!(Test-Path $Project)) { throw "프로젝트 폴더가 없습니다: $Project" }
if (!(Test-Path $Zip)) { throw "ZIP 파일이 없습니다: $Zip" }
if (!(Test-Path $frontend)) { throw "frontend 폴더가 없습니다: $frontend" }
if ([string]::IsNullOrWhiteSpace($CloudflareApiToken)) { throw "CloudflareApiToken 값이 비어 있습니다." }
if ([string]::IsNullOrWhiteSpace($CloudflareAccountId)) { throw "CloudflareAccountId 값이 비어 있습니다." }

$env:CLOUDFLARE_API_TOKEN = $CloudflareApiToken
$env:CLOUDFLARE_ACCOUNT_ID = $CloudflareAccountId

Write-Host "1) ZIP 덮어쓰기"
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force

Write-Host "2) Git 최신화"
Set-Location $Project
git checkout $Branch
$changes = git status --porcelain
if ($changes) {
    git add -A
    git commit -m $CommitMessage
    git push origin $Branch
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

Write-Host "5) Cloudflare Pages 업로드"
& npx --yes wrangler@4 pages deploy $dist --project-name $PagesProject
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages 업로드에 실패했습니다." }

Write-Host "완료되었습니다."
