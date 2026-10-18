# 배포 환경 검토 및 이전 계획

상태: 현황 파악 완료, 외부 환경 생성·이전은 하지 않음.

## 현재 구조

- 기본/테스트 사이트는 각각 별도 Sites 프로젝트로 배포된다.
- Vinext 빌드는 Cloudflare Workers 호환 산출물을 생성한다.
- API는 Edge 런타임에서 Supabase, OpenAI, 국가법령정보센터를 HTTPS로 호출한다.
- 파일과 DB는 Supabase에 남고, GitHub Actions가 테스트 사이트의 보호된 법령 동기화 API를 하루 한 번 호출한다.

## Vercel 검토 쟁점

- Next.js UI와 일반 HTTPS API는 이전 가능성이 높다.
- Vinext/Cloudflare 전용 설정과 런타임 API는 표준 Next.js 또는 Vercel Functions에 맞춰 검증·수정해야 한다.
- 장시간 문서 처리, 대용량 업로드, 법령 동기화는 서버리스 실행시간·메모리 제한과 충돌할 수 있다.
- 로컬 AI 모델은 일반 Vercel Functions에 넣지 않고 별도 GPU/CPU 추론 서버 또는 기관 내부 서버로 분리해야 한다.
- Supabase Auth/Storage CORS, 콜백 URL, 서비스 역할 키, GitHub Actions 대상 URL을 환경별로 재설정해야 한다.

## 제안 구조

1. 웹/UI/API 게이트웨이: Vercel 후보
2. DB/Auth/Storage: 기존 Supabase 유지
3. AI 추론: 기관 내부 또는 별도 전용 추론 서버
4. 법령 동기화/배치: GitHub Actions 또는 별도 작업 실행기
5. 운영·테스트: 서로 다른 프로젝트와 환경변수 세트, 동일 커밋의 승격 방식

## 이전 절차

1. 테스트용 Vercel 프로젝트만 생성
2. Secret 없이 빌드 호환성 확인
3. 테스트 Supabase와 제한된 환경변수 연결
4. 인증·검색·업로드·답변·법령 동기화 E2E
5. 비용·로그·타임아웃·롤백 검증
6. 사용자에게 새 주소, 비용, 위험, 롤백 방법 보고
7. 승인 후에만 운영 트래픽 전환

기존 Sites 주소는 새 환경의 종단 검증과 사용자 승인이 끝날 때까지 유지한다.
