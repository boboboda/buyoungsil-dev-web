# Claude Code 인계문

## 목적과 현재 상태

기존 Claude Code 앱 공장에 홈페이지의 Claude Code/Codex 선택과 공통 터미널 실행기를 추가했다. 개발본 `C:/Users/kju90/dev/buyoungsil-dev-web`에 구현했다. 사용자는 운영 반영 진행도 승인했다. 그러나 현재 작업환경의 SSH 차단, 원격 Git의 Win32 접근 거부, Codex 격리 실행의 접근 거부로 운영 단계가 막혀 있다. 운영 DB 마이그레이션, 홈페이지 배포, Git 원격 push, 감독 실행본 업데이트는 하지 않았다.

사용자 요청은 기존 Claude 기능을 보존하고, 홈페이지에서 AI를 선택하며, 터미널에서도 상태를 인계해 같은 프로젝트를 작업하는 것이다. 운영 승인 부족이 아니라 현재 실행환경의 보안 제한이 장애다. 이를 우회하지 말고 정상 운영 터미널에서 `docs/DEPLOYMENT_RUNBOOK.md`의 확인·시험·배포 절차를 재개한다.

## 변경 파일

- `lib/factory/ai.ts`: 공통 엔진 값·표시명·구버전 작업 PC 능력 해석.
- `prisma/schema.prisma`, `prisma/migrations/20261016090000_add_factory_ai_engine/migration.sql`: 일감·정비 지시의 AI 선택과 독립 Codex 정비 세션. 기존 Claude `sessionId` 유지.
- `lib/factory/jobs.ts`, `maintenance.ts`, `approvals.ts`: 지원 AI별 claim, 원자적 승인/선택, 진행 중 변경 거부, 정비 시작 시 AI 일치 확인, 세션 저장 분리.
- `lib/factory/mcp.ts`, `maintenance-mcp.ts`, `release.ts`: MCP의 AI 선택과 출시 조회 표시.
- `app/api/admin/factory/jobs/route.ts`, `jobs/[id]/route.ts`, `maintenance/route.ts`, `release/route.ts`, `app/api/factory/next/route.ts`, `maintenance/route.ts`: 관리자 선택·작업 PC 계약 연결.
- `components/admin/factory/AiEngineSelect.tsx`, `FactoryControl.tsx`, `RevisionSender.tsx`, `MaintenancePanel.tsx`, `ReleasePanel.tsx`, `releaseTypes.ts`: 홈페이지 입력·표시. Codex 결과를 Claude 사용량으로 표시하지 않음.
- `tools/factory-supervisor/ai-runner.mjs`: AI 인자/이벤트 어댑터, 잠금, 인계, 감사 이벤트, 검증, 마스킹.
- `tools/factory-supervisor/ai.mjs`, `ai.cmd`: 공통 터미널 run/switch/status/verify/recover.
- `tools/factory-supervisor/supervisor.mjs`, `maintenance.mjs`: 공통 실행·잠금·검증 연결, Codex 변경의 부모 소유 로컬 커밋.
- `tools/factory-supervisor/swift-source-check.mjs`: Windows Swift 작업의 소스 구성 확인. 컴파일했다고 보고하면 안 됨.
- `tools/factory-supervisor/tests/ai-harness.test.mjs`, `package.json`: 하네스 테스트.
- `AGENTS.md`, `.agents/skills/claude-harness/SKILL.md`, `docs/ai-harness.md`: 공통 규칙·기존 스킬 참조·운영과 롤백.

## 유지해야 할 경계

1. 사용자 전역 `.claude` 설정·훅·인증·동기화 스킬을 자동 변환하거나 덮어쓰지 마라.
2. 개발본, `factory/supervisor-src` 실행본, `factory/selfdev` 정비본은 다른 체크아웃이다. 감독은 기존 작업 스케줄러 소유이며 대화 세션의 백그라운드로 띄우지 마라.
3. AI 선택 누락은 Claude다. 선택 실패를 다른 AI로 몰래 대체하지 마라. 예전 작업 PC에 Codex 일감을 주지 마라.
4. Claude `sessionId`와 `codexSessionId`를 섞지 마라. 전환 시 현재 파일·Git 상태·이전 결과를 참고 데이터로 넘긴다.
5. 정비 AI는 push/배포하지 않는다. 감독의 검사 후 push와 기존 출시 검토·배포 승인을 유지한다.
6. 관리 실행 경로는 `~/dev/factory/.ai-locks`를 공유한다. 살아 있는 PID의 잠금을 강제로 해제하지 마라.
7. Codex workspace-write를 Claude deny 정책과 동일하다고 설명하지 마라. full-access 우회·임의 권한 확대를 하지 마라.
8. 기존 Claude 전용 플러그인/브라우저/메모리/Workflow의 자동 이식은 하지 않았다. 카탈로그 파일 존재는 활성 상태가 아니다.

## 검증과 제약

실행할 명령:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false -p .
npm run test:ai-harness
node --check <감독 프로그램의 각 .mjs>
```

구현 환경의 Node 자식 프로세스 생성 제한 때문에 실프로세스 시험 4개는 명시적으로 SKIP한다. 가짜 프로세스를 사용하는 스트림·검증 실패·타임아웃과 실제 파일시스템을 사용하는 잠금·상태 마스킹 시험은 수행한다. API 테스트는 모의 Prisma로 조건과 계약을 확인했으며 운영 PostgreSQL과 연결하지 않았다.

Prisma Client는 기존 설치 파일을 지정해 오프라인 생성했다. `next-env.d.ts`가 없어서 표준 Next 참조 파일을 로컬에 생성했다(기존 gitignore 대상). 패키지 설치·업데이트를 하지 않았다.

최신 로컬 하네스 테스트 결과: 전체 25개 중 21개 통과, 4개는 위 환경 제한으로 SKIP, 실패 0개. 실패한 정비가 남긴 새 파일이 다른 정비 대화에 섞이지 않는 소유권 시험을 추가했다. Prisma 스키마 검증과 `.mjs` 문법 검사를 통과했다. 운영 검증과 구분해서 보고해야 한다.

운영 진행 승인 후 실제 CLI 격리 시험도 시도했다. Claude와 Codex 모두 exit 1·예상 응답 없음이며, 접근 거부/연결 오류로 성공을 확인하지 못했다. SSH 차단과 원격 Git 조회 실패도 확인했다. 정상 운영 환경에서 재시험해야 한다. 보안 제한을 우회하지 않았고 운영 서버·대기열·DB·감독 실행본은 변경하지 않았다.

일반 앱의 부모 검증은 최소 게이트다. 전체 Next 빌드/e2e나 Mac Swift 컴파일을 대신하지 않는다. Codex의 원격 Git 백업·전용 사용량 표시, 네이티브 훅의 이벤트별 포팅, Google/MCP 재인증은 아직 구현/실환경 확인 범위 밖이다.

## 다음 작업

운영 반영은 이미 승인됐다. 정상 운영 터미널에서 `docs/DEPLOYMENT_RUNBOOK.md`의 절차를 재개하라. 먼저 서버의 추가 마이그레이션·신규 코드 적용, 다음 감독 프로그램 업데이트 순서로 구버전 보호를 유지한다. 운영 PC에서 SKIP 시험과 양쪽 CLI의 격리된 실제 작업·세션 재개·취소를 확인하고, 홈페이지에서 선택한 AI가 실행·검증·보고되는지 시험한다. 그 전까지 운영 적용이나 완전한 기능 동등성을 완료했다고 보고하지 마라.

롤백은 대기 Codex 작업을 Claude로 변경/취소한 뒤 기존 실행 경로로 복귀하는 것이다. 서버까지 구버전으로 되돌릴 때 AI 필터가 사라지는 점을 주의한다. 추가 DB 열·작업 변경·커밋·인계 상태를 삭제하지 마라.
