# Claude Code / Codex 통합 운영

기존 앱 공장의 홈페이지·감독 프로그램 안에 AI 선택 경로를 추가했다. Claude 설정, 네이티브 훅, 스케줄러, 기존 체크아웃을 다른 시스템으로 교체하지 않는다. 이 문서의 운영 명령은 배포 후 운영자가 실행하는 절차이며, 구현 과정에서 운영 DB·서버·실행본에 적용하지 않았다.

## 홈페이지에서 선택

- 통제실 또는 `/admin/factory/settings`의 **주사용 AI**에서 기본 AI를 저장한다. 서버 `factory_settings.defaultAiEngine`에 유지되어 새로고침·다른 기기·API/MCP/훅에도 적용된다. 초기값은 Claude Code다. 이미 등록한 작업과 세션은 바꾸지 않는다.
- 수정·출시·정비 입력의 **주사용 AI** 선택은 등록할 때 서버에서 기본값을 결정한다. 기본값을 읽는 동안 등록해도 오래된 Claude 선택을 보내지 않는다. 개별 Claude/Codex 선택은 기본값보다 우선한다.

- `/admin/factory`: 일감 상세의 **작업 AI**를 고른 뒤 승인한다. 새 앱·수정·출시 일감 모두 적용된다. 승인된 대기 일감은 **AI 적용**, 실패한 일감은 AI 선택 후 **다시 시도**를 사용한다.
- **수정 지시 바로 보내기**: AI를 선택해 등록한다. 기존 즉시 승인 옵션은 유지된다.
- **공장 정비**: 지시마다 AI를 선택한다. 아직 시작하지 않은 지시와 실패한 지시는 대화 안의 선택기로 바꿀 수 있다. 실행 중인 지시는 AI를 바꿀 수 없으며, 다음 지시를 다른 AI로 보내 인계한다.
- `/admin/factory/release`: 출시 일감 등록 시 AI를 선택한다. 기존 키 준비·검토 승인·업로드·배포 조건은 유지된다. 실패 일감의 AI 변경은 일반 일감 상세에서 할 수 있다.
- 선택값을 보내지 않은 API/MCP 호출은 홈페이지 주사용 AI를 따른다(설정이 없으면 `claude`). 기존 DB 행은 계속 원래 AI다. 설치·로그인·실행 실패 시 다른 AI로 자동 전환하지 않는다.

## Claude·Codex 지시 훅

`factory-hook.mjs`는 공장 정비 지시를 기존 서버 대기열에 등록한다. AI나 별도 감독을 실행하지 않는다. 기존 스케줄러의 감독이 승인된 지시를 받아 AI별 세션·잠금·부모 검증·결과 보고를 수행한다.

기존 실행본을 업데이트한 뒤 설치한다:

```powershell
node C:\Users\kju90\dev\factory\supervisor-src\tools\factory-supervisor\install-factory-hooks.mjs --dry-run
node C:\Users\kju90\dev\factory\supervisor-src\tools\factory-supervisor\install-factory-hooks.mjs
```

설치기는 기존 `~/.claude/settings.json`과 `~/.codex/hooks.json`을 백업하고 SessionStart·UserPromptSubmit 명령만 추가한다. Claude 상태/백업 훅·인증·Codex config.toml은 유지한다. Codex는 공식 훅 정책에 따라 `/hooks`에서 새 두 훅을 검토·신뢰해야 한다. 훅 신뢰 우회 옵션이나 신뢰 해시 조작은 사용하지 않는다. Claude 설정은 새 CLI 세션에서 확인한다.

두 AI의 일반 입력에서 사용한다(슬래시 명령 해석기와 충돌하지 않는 `공장:` 접두사를 권장):

```text
공장: codex 관리자 화면의 오류 메시지를 수정해 줘
공장: claude 감독 프로그램의 타임아웃 처리를 점검해 줘
공장: 주사용 AI로 이 기능을 점검해 줘
공장: codex --thread <정비ID> 앞 지시 결과를 확인하고 이어서 수정해 줘
공장: status <정비ID>
```

일반 대화는 전송하지 않는다. 감독이 실행 중인 하위 AI에서는 훅 등록을 건너뛰어 재귀 일감을 만들지 않는다. 지시 등록·결과 조회 뒤 현재 프롬프트를 차단해 같은 지시를 지금 세션에서도 실행하는 중복을 막는다. 실패해도 현재 세션에서 대신 실행하지 않는다. 등록된 훅 지시는 통제실·텔레그램 승인 전까지 `awaiting_approval`이며, 기본 AI 설정 변경·승인·배포를 요청할 수 없다.

네이티브 훅 신뢰 전에도 실행기를 직접 사용할 수 있다. 지시 본문은 stdin으로만 전달하고 설정 토큰은 출력하지 않는다:

```powershell
'관리자 화면의 오류 메시지를 점검해 줘' | node tools/factory-supervisor/factory-hook.mjs submit --ai codex
node tools/factory-supervisor/factory-hook.mjs status <정비ID>
```

`FACTORY_CONFIG` 또는 기존 `~/dev/factory/supervisor.config.json`의 HTTPS 서버 주소·작업 PC 토큰을 재사용한다. `/api/factory/hooks`는 작업 PC 인증·요청 수 제한·본문 크기 제한을 적용한다. 서버의 요청 ID로 재시도를 중복 제거하고 새 대화·지시를 하나의 DB 트랜잭션으로 생성한다. Claude 이벤트에 turn ID가 없으면 transcript 파일 메타데이터, 없으면 60초의 로컬 receipt를 사용한다. 동일 이벤트 재시도는 같은 지시가 되며, 반복해서 별도 지시를 보낼 때는 새 턴 또는 명시적 요청 ID를 사용한다. `/factory`와 `factory:` 접두사도 어댑터에서 처리하지만 CLI의 슬래시 명령 인식은 별개다.

이 훅은 공장 정비용이다. 새 앱·앱 수정·출시는 홈페이지 및 기존 앱 MCP 등록 경로를 사용하며, 그곳도 주사용 AI 기본값을 따른다.

공식 동작 참고: https://learn.chatgpt.com/docs/hooks (비관리 훅의 정의별 사용자 신뢰 검토).

## 서버 계약과 구버전 보호

`FactoryJob.aiEngine`과 `FactoryMaintenanceMessage.aiEngine`은 `claude | codex`이다. 추가 마이그레이션에는 기존 데이터 삭제가 없다. `FactoryMaintenance.sessionId`는 계속 Claude 세션이고, `codexSessionId`만 Codex에 사용한다.

새 감독 프로그램은 `/api/factory/next`에 `aiEngines=claude,codex`를 보낸다. 이 값을 보내지 않는 예전 감독 프로그램에는 Claude 일감만 내려간다. 정비 대기열도 지원하지 않는 AI의 맨 앞 지시를 건너뛰지 않는다. 정비 시작 API는 선택 AI를 조건부 갱신에 포함하여, 가져간 뒤 홈페이지에서 AI가 바뀌었으면 오래된 실행을 거부한다.

## 터미널

저장소에서 실행하거나 `ai.cmd`의 전체 경로를 사용한다. 전역 PATH를 자동 변경하지 않았다.

```powershell
.\tools\factory-supervisor\ai.cmd run claude --project C:\Users\kju90\dev\buyoungsil-dev-web
.\tools\factory-supervisor\ai.cmd run codex --project C:\Users\kju90\dev\buyoungsil-dev-web
.\tools\factory-supervisor\ai.cmd switch codex --project C:\Users\kju90\dev\buyoungsil-dev-web --prompt "이전 결과를 확인하고 다음 작업을 이어서 해줘"
.\tools\factory-supervisor\ai.cmd status --project C:\Users\kju90\dev\buyoungsil-dev-web
.\tools\factory-supervisor\ai.cmd verify --project C:\Users\kju90\dev\buyoungsil-dev-web
```

대화형 모드에서는 `/switch claude`, `/switch codex`, `/verify`, `/exit`를 입력한다. 한 번 실행은 `--prompt` 또는 stdin을 사용한다. `--stack`은 `flutter`, `nextjs`, `nestjs`, `kotlin-compose`, `swift-swiftui`이다. 자동 탐지는 Flutter와 Node 프로젝트만 지원한다. 터미널 실행기 자체는 commit·push·배포를 수행하지 않는다. AI의 작업 범위는 프로젝트 지침과 사용자가 준 지시를 따른다.

## 잠금과 인계

- 홈페이지 감독 프로그램과 터미널은 기본 `~/dev/factory/.ai-locks/`를 공유한다. 실제 작업 폴더 경로를 정규화하여 원자적으로 잠금을 생성한다. 다른 프로젝트는 계속 병렬 작업할 수 있다.
- 소유 PID·자식 PID·고유 토큰을 기록한다. 잠금을 조용히 덮어쓰거나 자동으로 오래된 잠금을 지우지 않는다.
- 종료된 소유자만 `ai recover --project <폴더>`로 복구한다. PID가 재사용되어도 살아 있는 PID면 복구를 거부한다. 강제 종료 후에는 남은 프로세스 트리와 변경 파일도 운영자가 확인한다.
- `.factory/ai-state.json`에 AI·세션·작업·결과·검증·Git 상태를, `ai-sessions.json`에 터미널의 엔진별 세션 ID를 기록한다. 네이티브 원본 세션은 원래 AI 저장소에 그대로 남는다.
- `ai-events.jsonl`은 엔진 공통 실행·검증·종료 이벤트 기록이다. 프롬프트와 비밀값을 담지 않는다.
- 공통 파일은 Git에서 제외한다. 정비·터미널은 `git info/exclude`를 사용하며 기존 지침은 유지한다.
- 다음 실행에는 현재 HEAD·변경 목록·이전 결과를 함께 전달한다. 원시 diff는 출력하지 않고 digest만 저장한다. 코드 상태가 달라졌거나 확인할 수 없으면 `verificationCurrent=false`로 표시하고 이전 검사 결과를 재사용하지 않는다.
- 잠금은 관리 실행 경로의 약속이다. 직접 실행한 CLI, 다른 편집기, 다른 PC까지 OS 수준에서 막는 장치는 아니다. 같은 폴더를 수정하는 작업은 공통 실행기를 사용한다.

## 실행·권한·검증

`ai-runner.mjs`에서 Claude 명령·이벤트 계약은 유지하고 Codex JSONL을 기존 `system / assistant / result` 계약으로 변환한다. Codex는 별도 모델 설정만 사용하고 Claude 모델 이름을 상속하지 않는다. Windows npm 설치는 Node 런처를 직접 실행하여 PowerShell 정책과 TOML 인자 인용 문제를 피한다.

Codex는 `workspace-write`, `approval_policy=never`, 셸 네트워크 차단으로 실행하며 full-access 우회를 사용하지 않는다. 승인할 수 없는 명령은 실패한다. **이 정책은 Claude의 도구별 deny 규칙과 동일한 정책이 아니다.** 특히 보호 파일 읽기·명령 필터·serverctl 접근의 동등성을 인증하지 않았다. Codex로 서버 설정을 수정하려고 권한을 확대하지 말고 기존 승인된 관리 경로를 사용한다.

일반 앱 작업은 부모 프로세스가 Flutter analyze, Node 프로젝트 타입 검사, Android 단위 검사 등의 해당 검증을 실행한다. 실패하면 완료·산출물 후속 반영·커밋으로 진행하지 않는다. 이는 최소 게이트이며 모든 플랫폼의 전체 빌드/e2e 시험을 대체하지 않는다. Windows Swift 작업은 비어 있지 않은 Swift 소스와 XcodeGen 구성만 확인하며 컴파일·앱 실행은 Mac에서 별도로 해야 한다.

정비는 기존 감독 스크립트 문법 검사·타입 검사를 유지한다. Codex가 Git 메타데이터를 쓰지 못해 변경만 남기면 감독 프로그램이 작업 트리를 검사한 뒤 로컬 커밋한다. 원격 rebase로 HEAD가 바뀌면 다시 검사한다. 검사 실패 파일은 보존하고 같은 정비 대화에서 수정할 수 있다. 키 파일이 커밋에 포함되면 중단한다. GitHub push와 서버 배포는 기존 감독 프로그램·승인 흐름이 담당한다.

## Skills, Subagents, MCP, Hooks 범위

프로젝트의 `AGENTS.md`와 `.agents/skills/claude-harness/SKILL.md`는 기존 규칙과 필요한 Claude 스킬 원본을 읽도록 연결한다. 사용자 전역 스킬·플러그인을 복사하거나 자동 활성화하지 않았다. 일반 규칙·참조·로컬 스크립트는 설치된 의존성을 확인해 재사용할 수 있다. Claude 전용 Agent/Task/Workflow, 브라우저·Docs·메모리 도구는 실제 Codex 도구로 대응을 확인해야 하며 정의 파일을 그대로 활성화했다고 주장하지 않는다.

자체 MCP 서버의 앱·출시·정비 등록 도구에는 선택 AI 필드를 추가했다. 승인은 계속 기존 경로가 담당한다. Codex MCP 연결·자격증명은 별도이며 실제 연결·Google OAuth 재인증은 이번 구현에서 실행하지 않았다.

Claude의 기존 상태·Git 백업 훅은 유지한다. 별도의 공장 지시 훅만 두 AI의 SessionStart·UserPromptSubmit에 추가한다. Codex를 Claude 상태/캐시 사용량으로 위장하지 않는다. 공통 필수 검사와 실행 감사는 실행기에서 보장한다. Codex 원격 Git 백업·전용 사용량 대시보드는 아직 연결하지 않았다.

## 설정과 적용 순서

기존 `supervisor.config.json`에 다음 선택 항목을 지원한다. 비밀값은 포함하지 않는다.

```json
{ "codexCmd": "codex.cmd", "codexModel": "", "codexEnabled": true }
```

모델 이름이 비어 있으면 Codex 자신의 기본값을 사용한다. `codexEnabled=false`면 새 Codex 일감을 받지 않는다. 설치·로그인 성공은 별도로 확인한다.

운영 적용은 검토 후 다음 순서다.

1. 신규 일감 접수를 일시 정지하고 진행 중인 작업을 끝낸다. DB·설정·실행 버전을 백업한다.
2. 추가 마이그레이션과 Prisma Client 생성이 포함된 서버 버전을 배포한다. 실제 DB 적용은 운영 승인 후 수행한다.
3. 기존 업데이트 절차로 `supervisor-src`가 새 버전을 받게 한다. 실행본·정비본을 직접 일괄 덮어쓰지 않는다.
4. 운영 PC에서 아래 시험의 건너뛴 항목을 실행하고, 승인된 격리 프로젝트에서 양쪽 CLI의 실제 세션·취소·재개를 확인한다.
5. Claude 기존 작업 회귀 확인 후 Codex 일감 하나로 홈페이지 선택→실행→검증→결과를 확인하고 접수를 재개한다.

## 검증 결과와 미확인 사항

구현 환경에서 TypeScript 전체 검사, 모든 감독 `.mjs` 문법 검사, Prisma 스키마 검증을 수행한다. 테스트 명령은 `npm run test:ai-harness`이며 설치된 Node 테스트 API와 TypeScript/React를 사용한다.

자식 프로세스 생성이 `EPERM`으로 차단되는 이 환경에서는 실제 가짜 CLI·Git·컴파일러 실행 시험 4개를 명시적으로 건너뛴다. API 조건·SQL 바인딩·세션 분리·잠금·인계·마스킹·selector와 가짜 프로세스 스트림·검증 실패·타임아웃 시험은 실행한다. 운영 DB 동시성·실제 AI 인증·MCP 연결·브라우저 화면·스케줄러·배포·자동 업데이트의 실환경 시험은 별도다.

## 롤백

새 일감을 일시 정지하고 관리 세션이 모두 끝난 뒤 Codex 선택을 끈다. 대기 중인 Codex 일감·정비는 관리자가 Claude로 변경하거나 취소한다. 새 서버를 유지하면 구버전 감독 프로그램도 Claude 작업만 받는다. 서버까지 구버전으로 되돌릴 때는 **남아 있는 Codex 일감이 없어야 한다**. 예전 서버는 AI 필터를 모르기 때문이다.

추가 DB 열은 남겨 두어 기존 Claude 세션과 데이터를 보존한다. 작업 파일·실패 변경·커밋·인계 파일을 삭제하거나 `reset --hard`로 정리하지 않는다. 기존 `.claude` 파일과 스케줄러가 보존되어 있어 기존 실행 경로로 복귀할 수 있다.
