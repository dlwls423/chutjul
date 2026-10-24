# 첫줄 Codex 작업 지침

이 저장소에서 새 Codex 세션을 시작하면 코드 수정 전에 다음 순서로 현재 상태를 복원한다.

1. `git status --short --branch`, `git log -5 --oneline --decorate`, `git remote -v`를 확인한다.
2. `docs/HANDOFF.md`, `docs/PROJECT_STATUS.md`, `docs/TASK_PLAN.md`, `docs/WORK_LOG.md`를 읽는다.
3. AI 관련 작업이면 `docs/LOCAL_AI_EVALUATION.md`, 개인정보·배포 작업이면 `docs/privacy-release-checklist.md`와 `docs/DEPLOYMENT_PLAN.md`도 읽는다.
4. 기존 미커밋 변경, Secret, 원본 민원, 임시 배포 폴더를 삭제하거나 덮어쓰지 않는다.
5. 문서의 최신 날짜와 현재 Git 상태가 다르면 Git 상태를 우선하고 차이를 사용자에게 보고한다.

## 현재 기준

- 안정 개발 브랜치: `codex/search-wide-layout`
- 현재 실험 브랜치: `experiment/browser-ai`
- 브라우저 AI 기준 커밋: `9a36da5`
- 최신 진행 상황은 이 파일과 `docs/HANDOFF.md` 상단의 날짜를 기준으로 확인한다.
- 테스트 사이트에는 브라우저 AI 답변 실험이 배포되어 있다.
- 운영 사이트에는 브라우저 AI 답변 실험을 병합하거나 배포하지 않았다.
- Sites 배포와 GitHub push는 별개다.

## 현재 작업 목표

민원 원문과 개인정보가 기기 밖 외부 LLM으로 나가지 않도록 다음 구조를 검증·개선한다.

- 브라우저 WebLLM Qwen2.5로 비식별 요약, 근거 선별, 답변 초안을 생성한다.
- 서버는 부서 권한 검색, 승인 봉투, 최종 개인정보·근거·법령·형식 검증만 담당한다.
- WebGPU 실패 시 OpenAI 답변 생성으로 자동 우회하지 않는다.
- OpenAI는 현재 임베딩과 안내서 Q&A 추출에만 남아 있다.

## 다음에 수행할 작업

1. 고정 합성 평가셋을 만들어 OpenAI 기준, Qwen2.5 0.5B, Qwen2.5 1.5B를 같은 입력으로 비교한다.
2. 정확성, 근거 일치, 존재하지 않는 법령·조문 생성, 한국어 문체, 평균/P95 생성 시간을 기록한다.
3. WebGPU 미지원, 낮은 메모리, 모델 다운로드 실패 상황의 안전한 UX와 재시도를 검증한다.
4. 브라우저 생성 결과의 개인정보 누락, 허용 근거 이탈, 법령 환각 회귀 테스트를 추가한다.
5. 임베딩과 안내서 Q&A 추출도 로컬 처리로 바꿀 수 있는지 검색 품질과 함께 평가한다.
6. 결과를 `docs/LOCAL_AI_EVALUATION.md`와 `docs/WORK_LOG.md`에 기록한다.

## 승인 경계

- 브라우저 AI 실험의 안정 브랜치 병합 및 운영 사이트 배포는 사용자 승인 전 수행하지 않는다.
- 운영 DB 마이그레이션, 실제 운영 데이터 재처리, 유료 서비스 도입, 도메인·배포 환경 전환은 사용자 승인 후 수행한다.
- 테스트 사이트 변경은 사용자 요청 범위에서만 수행하고 운영 사이트와 혼동하지 않는다.

## 검증

코드 변경 후 관련 테스트를 먼저 실행하고, 주요 변경이면 다음 전체 검증을 수행한다.

```powershell
pnpm test:privacy
pnpm test:regression
pnpm test:documents
pnpm test:workspaces
pnpm test:routing
pnpm test:legal
pnpm test:security
pnpm exec tsc --noEmit
pnpm build
```

브라우저 AI 변경은 빌드 성공만으로 완료 처리하지 않는다. Chromium 계열 WebGPU 기기에서 모델 최초 다운로드, 재사용, 답변 생성, 근거 재선택을 실제로 확인한다.

## 작업 종료 시

- `docs/PROJECT_STATUS.md`, `docs/TASK_PLAN.md`, `docs/WORK_LOG.md`를 갱신한다.
- 다음 세션이 바로 이어갈 수 있도록 완료 항목, 실패 원인, 미검증 항목, 정확한 다음 작업을 남긴다.
- Secret이나 개인정보가 diff에 포함되지 않았는지 확인한다.
