# PDF 민감정보 마스킹 서비스 연결

사이트의 Edge 런타임에서는 Python/PyMuPDF를 직접 실행할 수 없으므로, 제공된 `pii_pdf_masker`를 비공개 HTTPS 서비스로 별도 배포한다.

## 처리 순서

1. 원본 PDF를 비공개 Supabase Storage에 격리 저장한다.
2. 사이트 서버가 마스킹 서비스의 `POST /v1/mask`로 원본을 전달한다.
3. 마스킹 서비스가 민감정보를 PDF 객체에서 물리적으로 제거하고 자체 검증한다.
4. 사이트 서버가 마스킹본을 다시 텍스트 검사한다. 잔존 정보가 있으면 즉시 실패 처리한다.
5. 검증된 마스킹본만 OpenAI Responses API로 전송한다. 요청에는 `store: false`를 사용한다.
6. 추출 텍스트를 다시 검사한 뒤 Supabase 문서와 검색 청크로 저장한다.

마스킹 서버가 없거나 검증에 실패하면 원본 PDF는 OpenAI로 전송되지 않는다.

## 사이트 환경변수

```env
PII_PDF_MASKER_URL=https://마스킹-서비스-주소
PII_PDF_MASKER_API_KEY=마스킹-서비스-인증키
OPENAI_PDF_EXTRACTION_MODEL=gpt-4.1-mini
```

`PII_PDF_MASKER_API_KEY`는 배포한 서비스에 인증을 추가한 경우 Secret으로 등록한다. 제공된 기본 예제에 인증이 없다면 네트워크 접근 제한을 적용하거나 인증 미들웨어를 추가하기 전에는 공개 배포하지 않는다.

## Supabase

SQL Editor에서 `supabase/migrations/202608260001_pdf_redaction_pipeline.sql`을 실행한다. 이 마이그레이션은 마스킹본 경로, 제거 건수, 처리 상태와 오류를 `source_files`에 추가한다.
