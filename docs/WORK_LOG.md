# 작업 이력

## 2026-10-18 — 지속 개선 착수 및 신용정보법 검색 1차 구현

### 분석

- Git 작업 폴더가 깨끗한 `codex/search-wide-layout`임을 확인했다.
- 운영·테스트 Sites 체크아웃이 기준 브랜치보다 각각 2~3개 커밋 앞서 있음을 확인했다.
- 법령 수집·버전·조문 테이블, 일일 동기화, 키워드 검색, OpenAI 답변 생성 경로를 점검했다.
- 신용정보법과 시행령은 이미 초기 목록에 있었지만 시행규칙·감독규정은 없었다.

### 수정 파일

- `lib/legal-query.ts`: 법령 질의 정규화, 신용정보법 별칭, 조문번호, 자연어 개념 확장
- `lib/legal-search.ts`: 조문번호 필터, 직접 일치/확장 일치 구분, 법령명 가중치, 저관련 결과 억제
- `app/page.tsx`, `app/globals.css`: 법령 상세에서 조문 본문·시행일·공포번호·공식 출처를 한 화면에 표시
- `supabase/migrations/202610180001_credit_information_legal_sources.sql`: 시행규칙·감독규정 추가 및 기존 신용정보법 계열 메타데이터 갱신
- `scripts/regression-legal-query.mjs`, `package.json`: 검색 질의 회귀 검사
- `tsconfig.json`: 실제 프로젝트 밖의 복제·빌드 산출물을 타입 검사에서 제외

### 검증

- `pnpm test:legal`: 통과
- `pnpm exec tsc --noEmit`: 통과
- `pnpm test:regression`: 통과
- `pnpm test:privacy`: 242/242 통과, 탐색 결함 0/3
- `pnpm test:documents`, `test:workspaces`, `test:routing`, `test:security`: 모두 통과
- `pnpm build`: Vinext 프로덕션 빌드 통과

### 미적용 항목

- Supabase 마이그레이션 실행 안 함
- 국가법령정보센터 실제 동기화 호출 안 함
- 기본·테스트 사이트 배포 안 함
