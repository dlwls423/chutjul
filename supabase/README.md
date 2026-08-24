# Supabase 연결

1. Supabase SQL Editor에서 `migrations/202608240001_ingestion_pipeline.sql`을 실행합니다.
2. 배포 환경에 `.env.example`의 변수를 등록합니다. `SUPABASE_SERVICE_ROLE_KEY`와 `OPENAI_API_KEY`는 브라우저에 노출하면 안 됩니다.
3. Supabase Dashboard의 Storage에서 `complaint-originals` 버킷을 직접 만들고 **Public bucket을 끕니다**. 파일 크기 제한은 100MB, 허용 형식은 PDF, XLSX, XLS로 설정합니다.
4. Excel 권장 열: `민원제목`, `민원내용`, `답변내용`, `담당부서`, `대분류`, `중분류`, `소분류`, `PDF파일명`.
5. Excel의 `PDF파일명`과 업로드된 PDF의 실제 파일명이 같으면 원문 연결 정보가 자동 갱신됩니다.

처리 순서: SHA-256 중복 검사 → PDF Storage 저장 → 텍스트 추출 → 질문·답변 분리 → 개인정보 마스킹 → 청킹 → 임베딩 → 검색 테이블 저장.
