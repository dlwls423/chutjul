# 첫줄

안정 개발 브랜치: `codex/search-wide-layout`

현재 개인정보 우선 브라우저 AI 실험 브랜치: `experiment/browser-ai`

민원 자료 검색·답변 작성, 최대 10개의 민원별 작성 탭, 개인 계정 작성 상태 저장, 전체 부서 소관 가능성 비교를 제공합니다. 문서 파싱에는 선택적으로 같은 PC의 kordoc 도우미를 사용합니다.

## 다른 컴퓨터에서 이어 개발하기

Codex에서 대화 맥락까지 복원해 이어서 작업하려면 [Codex 재개 안내](docs/CODEX_CONTINUATION.md)를 사용합니다. 저장소 루트의 `AGENTS.md`가 현재 목표, 승인 경계, 검증 순서를 새 Codex 세션에 자동으로 안내합니다.

Node.js 22.13 이상, Git, pnpm을 준비하고 다음 명령을 실행합니다.

```sh
git clone https://github.com/dlwls423/chutjul.git
cd chutjul
git switch experiment/browser-ai
pnpm install
```

`.env.example`을 참고해 해당 PC의 `.env.local`을 별도로 설정합니다. 실제 Secret은 GitHub에 포함하지 않습니다. 이미 설정 파일이 있다면 덮어쓰지 마세요. 기존 Supabase/OpenAI 등 설정은 안전한 별도 경로로 전달받아 입력해야 합니다. 승인된 개인 계정 기능은 `PUBLIC_TEST_MODE=false` 환경에서 사용할 수 있습니다.

```sh
pnpm dev
```

터미널에 표시된 로컬 주소를 브라우저에서 엽니다. Windows에서 의존성 링크 문제가 발생하면 `pnpm install --node-linker=hoisted`를 사용할 수 있습니다.

## 기능별 설정과 검증

- [인수인계](docs/HANDOFF.md): 최신 브랜치·배포 상태, 브라우저 AI 실험, 남은 검증과 다음 작업.
- [문서 파싱 도우미](docs/kordoc-local-integration.md): 해당 PC에 별도 설치하고 OCR 모델을 준비하는 방법.
- [민원 탭·계정 저장](docs/complaint-workspaces.md): DB 마이그레이션과 개인 계정 저장·복원 검증.
- [전체 부서 소관 분석](docs/department-routing.md): 상대 가능성 계산, 개인정보 집계 기준과 검증 한계.
- [보안·반응형 점검](docs/security-review-2026-10-13.md): 개인정보 경계, 접근 제어, 배포 전 확인사항.

계정 저장에는 기존 마이그레이션에 이어 `supabase/migrations/202610120001_complaint_workspaces.sql` 적용이 필요합니다. DB가 이미 적용된 환경에서는 다시 적용할 필요가 없습니다. 실제 DB 변경 전 해당 환경의 기존 적용 상태를 확인하세요.

```sh
pnpm test:privacy
pnpm test:regression
pnpm test:documents
pnpm test:workspaces
pnpm test:routing
pnpm test:security
pnpm exec tsc --noEmit
pnpm build
```

소관 분석의 퍼센트는 민원 유사도 점수에 따른 상대 추정치이며 확정된 통계적 확률이 아닙니다. 공개 테스트 계정은 개인 계정 저장과 기관 전체 부서 분석에 접근하지 못합니다.

이 브랜치의 GitHub 업로드와 실제 사이트 배포는 별개입니다. 브라우저 종단 검증, 실제 개인 계정 복원, 운영 자료의 소관 정확도·성능 검증은 기능별 문서에 남은 작업으로 기록되어 있습니다.

보안 보완 버전은 `supabase/migrations/202610130001_server_only_data_access.sql`도 검토·적용해야 합니다. 공개 테스트는 자료 변경을 허용하지 않습니다. 안내서·Excel·기타 자료 등록은 PC 로컬 도우미를 사용하며, 파일은 최대 30MiB입니다. 실제 Secret과 기존 원본은 이 작업에서 변경하지 않았습니다.
