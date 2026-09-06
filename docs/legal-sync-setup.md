# 법령 자동 현행화 설정

1. Supabase SQL Editor에서 `supabase/migrations/202609060001_legal_sources.sql`을 실행한다.
2. 국가법령정보 공동활용 사이트에서 OPEN API 사용을 신청하고 인증값(OC)을 발급받는다.
3. 테스트·운영 사이트에 `LAW_OPEN_API_OC`(Secret), `LEGAL_SYNC_TOKEN`(Secret)을 등록한다.
4. 최초 1회 관리자로 `POST /api/legal/sync`를 호출한다.
5. GitHub 저장소 `Settings → Secrets and variables → Actions`에 동일한 `LEGAL_SYNC_TOKEN`을 Secret으로 등록한다. 포함된 GitHub Actions 작업이 6시간마다 자동 실행된다.

동기화는 기존 버전을 삭제하지 않는다. 새 본문 해시가 발견될 때만 버전을 추가하며, 검색에는 `current` 상태만 사용한다. 시행예정 버전은 저장되지만 시행일까지 검색 결과에 포함되지 않는다.
