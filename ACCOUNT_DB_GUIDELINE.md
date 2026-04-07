# 계정 DB 기준서

이 문서는 이청잘 앱 프로젝트의 계정 DB 구조/운영 기준서입니다. 추후 프로젝트 업데이트 시 계정 기준의 기준 문서로 사용합니다.

## 1. 로그인 및 이메일
- login_id: 로그인 전용 아이디
- 규칙: 영문 소문자/숫자만 허용, 4~20자, 저장 시 소문자 정규화
- email: 실제 이메일
- google_email: 구글용 이메일
- 로그인은 login_id만 사용

## 2. 권한 판정 순서
1. 계정상태
2. 권한등급
3. 세부 기능 권한

## 3. 권한등급 기준
- 1등급: 관리자
- 2등급: 부관리자
- 3등급: 중간관리자
- 4등급: 사업자권한
- 5등급: 직원권한
- 6등급: 일반권한
- 7등급: 기타권한

## 4. 소속 유형 판별
직급(position_title) 기준으로 판별합니다.
- 대표/부대표/호점대표 => 사업자
- 팀장/부팀장/직원 => 현장직원
- 본부장/상담실장/상담팀장/상담사원 => 본사직원

## 5. branch 기준
- 사업자: branch 필수
- 실제 branch 미확정 시 TEMP_BRANCH(임시 branch) 허용
- 현장직원/본사직원: branch 없음
- 현장직원은 공용 직원이며 스케줄 배정은 어디든 가능

## 6. 상태 기준
- pending(승인대기): 로그인 불가, 운영현황 제외
- active(사용중): 정상 사용
- suspended(일시정지): 신규 로그인 차단 + 기존 세션/API 차단, 운영현황 제외, 기록 유지
- retired(퇴사/종료): 로그인 불가, 운영현황 제외, 기록 유지
- deleted(계정삭제): 논리삭제, 로그인 불가, 운영현황 제외, 기록 유지

## 7. 운영현황 기준
- 가맹대표: 사업자만
- 현장직원: 현장직원만
- 본사직원: 본사직원만
- 사업자 1명당 가용차량 1대 고정
- TEMP_BRANCH 사업자도 운영현황/자재구매/가용차량 반영

## 8. 권한 부여 규칙
- 권한 부여/변경: 관리자, 부관리자만 가능
- 낮은 권한은 동급/상위 권한 변경 불가
- 자기 자신의 권한 수정: 관리자만 가능
- 관리자: 전체 권한 부여/회수 가능
- 부관리자: 관리자 권한 제외 범위만 부여/회수 가능

## 9. 세부 기능 권한 기본 키
- ACCOUNT_VIEW
- ACCOUNT_EDIT
- PERMISSION_VIEW
- PERMISSION_EDIT
- OPERATIONS_VIEW
- MATERIAL_VIEW
- MATERIAL_REQUEST
- MATERIAL_APPROVE
- SCHEDULE_VIEW
- SCHEDULE_EDIT
- SETTLEMENT_VIEW
- SETTLEMENT_EDIT
- ADMIN_MODE_ACCESS

## 10. DB 반영 컬럼
- users.login_id
- users.email
- users.google_email
- users.account_status
- users.position_title
- users.account_type
- users.branch_code
- users.permission_codes_json

## 11. 구현 메모
- branch_no = -1 인 경우 TEMP_BRANCH로 간주
- branch_code는 TEMP_BRANCH 또는 BRANCH_{번호} 형식으로 관리
- account_type은 business / employee_field / employee_hq / admin / general 값을 사용
