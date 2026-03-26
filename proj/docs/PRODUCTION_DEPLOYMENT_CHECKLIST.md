# icj2424app 운영 배포 체크리스트

## 아키텍처
- 프런트엔드: Cloudflare Pages (`https://www.icj2424app.com`)
- 정책 페이지: Cloudflare Pages 정적 페이지 (`/privacy-policy`, `/account-deletion`)
- 백엔드: Railway Hobby (`https://api.icj2424app.com`)
- DB: Railway PostgreSQL
- 이미지/파일: Cloudflare R2 (`https://img.icj2424app.com`)
- DNS/SSL/CDN: Cloudflare
- 도메인 등록처: 가비아

## 1. 가비아
1. `icj2424app.com` 구매
2. Cloudflare에서 안내한 네임서버 2개를 가비아 도메인 관리에서 변경

## 2. Cloudflare
1. 도메인 온보딩
2. Pages 프로젝트 생성 (GitHub 연결)
3. Pages 빌드 설정
   - Root directory: `frontend`
   - Build command: `npm ci && npm run build`
   - Output directory: `dist`
4. Pages 환경변수 등록
   - `VITE_API_BASE_URL=https://api.icj2424app.com`
5. Pages 사용자 지정 도메인 연결
   - `www.icj2424app.com`
6. 필요하면 Apex(`icj2424app.com`) → `www` 301 리다이렉트
7. R2 버킷 생성
   - 버킷명 예시: `icj2424app-prod`
8. R2 사용자 지정 도메인 연결
   - `img.icj2424app.com`
9. R2 API 토큰 생성 후 Railway 환경변수에 입력

## 3. Railway
1. GitHub 저장소 연결
2. 앱 서비스 생성 (루트 `Dockerfile` 사용)
3. PostgreSQL 추가
4. 앱 서비스 Public Networking에서 Railway 도메인 생성
5. Custom Domain 추가
   - `api.icj2424app.com`
6. 환경변수 입력
   - `APP_ENV=production`
   - `APP_PUBLIC_URL=https://www.icj2424app.com`
   - `API_PUBLIC_URL=https://api.icj2424app.com`
   - `POLICY_URL=https://www.icj2424app.com/privacy-policy`
   - `ACCOUNT_DELETION_URL=https://www.icj2424app.com/account-deletion`
   - `ALLOWED_ORIGINS=https://www.icj2424app.com,https://icj2424app.com,https://api.icj2424app.com`
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `SEED_DEMO_DATA=0`
   - `EMAIL_DEMO_MODE=0`
   - `LOG_LEVEL=INFO`
   - `R2_ACCOUNT_ID=...`
   - `R2_ACCESS_KEY_ID=...`
   - `R2_SECRET_ACCESS_KEY=...`
   - `R2_BUCKET=icj2424app-prod`
   - `R2_PUBLIC_BASE_URL=https://img.icj2424app.com`
7. 배포 후 `/api/health` 확인

## 4. DB 초기화 / 마이그레이션
- 새 운영 DB로 시작: `SEED_DEMO_DATA=0` 상태에서 첫 배포
- 기존 SQLite 데이터를 옮길 경우:
  1. 로컬에서 `DATABASE_URL` 을 Railway PostgreSQL 값으로 지정
  2. `python backend/scripts/migrate_sqlite_to_postgres.py`

## 5. 백업 / 점검
- 수동/정기 백업: `python backend/scripts/backup_database.py`
- GitHub Actions 수동 백업 워크플로: `.github/workflows/manual-db-backup.yml`
- 운영 점검 URL: `https://api.icj2424app.com/api/health`

## 6. Google Play 준비
- Play Console 정책 등록 URL: `https://www.icj2424app.com/privacy-policy`
- 계정 삭제 URL: `https://www.icj2424app.com/account-deletion`
- 웹앱을 Android 패키징할 경우 기존 Capacitor/웹뷰 구조에 동일 URL 반영
