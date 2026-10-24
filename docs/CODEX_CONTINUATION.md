# 다른 컴퓨터에서 Codex로 이어서 작업하기

Codex의 대화 기억은 다른 컴퓨터로 자동 이전되지 않는다. 대신 GitHub의 코드, 루트 `AGENTS.md`, 인수인계 문서를 새 Codex 세션이 읽도록 하여 작업 맥락을 복원한다.

## 준비

다른 컴퓨터에서 저장소를 준비한다.

```powershell
git clone https://github.com/dlwls423/chutjul.git
cd chutjul
git switch experiment/browser-ai
```

그 폴더를 Codex에서 프로젝트로 연 뒤 아래 문장을 그대로 입력한다.

## Codex 재개 명령

```text
이 저장소의 AGENTS.md와 docs/HANDOFF.md, docs/PROJECT_STATUS.md, docs/TASK_PLAN.md, docs/WORK_LOG.md, docs/LOCAL_AI_EVALUATION.md를 모두 읽어 현재 진행 상황을 복원해줘. 먼저 git status와 최근 커밋을 확인하고 기존 미커밋 변경을 보존해. 현재 experiment/browser-ai 브랜치의 완료 기능, 테스트 사이트 배포 상태, 알려진 문제, 승인 경계를 요약한 다음 TASK_PLAN의 미완료 작업 중 우선순위가 가장 높은 항목부터 구현·테스트해. 운영 브랜치 병합, 운영 사이트 배포, 운영 DB 변경은 내 별도 승인 전에는 하지 마. 작업 후 관련 상태 문서와 WORK_LOG를 갱신해.
```

이 명령을 받으면 Codex는 루트 `AGENTS.md`의 저장소 전용 지침을 자동으로 적용하고, GitHub에 기록된 최신 작업 상태를 기준으로 이어서 진행한다.

## Secret과 환경설정

GitHub에는 `.env.local`과 Secret이 없다. 실행이나 실제 API 검증이 필요하면 기존 컴퓨터의 값을 메신저나 Git으로 보내지 말고 승인된 비밀 전달 방식으로 새 컴퓨터에 별도 등록한다.

환경변수가 없어도 Codex는 코드 분석, 테스트 작성, 문서 갱신부터 진행할 수 있다. 실제 Supabase·OpenAI·국가법령정보 API·Sites 배포 검증이 필요한 시점에만 부족한 값과 등록 위치를 구체적으로 확인한다.
