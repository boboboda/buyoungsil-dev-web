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
- **인계 기록** `.factory/handoff.json`(`tools/factory-supervisor/handoff.mjs`): 정비·앱 일감·터미널 실행이 끝날 때마다(실패·중단 포함) 항목 하나를 더한다. 사실(작성한 AI·모델·시각, 브랜치·HEAD·미커밋 여부, 커밋/미커밋 파일 이름, 감독이 직접 돌린 검사 통과·실패·건너뜀)은 감독 프로그램이 채우고, 요청·완료 조건·한 일·남은 작업·주의는 AI 최종 답변 끝의 `## 인계` 블록에서 읽는다(블록이 없으면 '인계 요약 없음'+사실만). 한 항목 4KB 안팎, 최근 5개만 전체로 두고 밀려난 것은 한 줄 요약 10개까지. 다음 실행(Claude든 Codex든)의 프롬프트에 최근 3개(첫 번째만 자세히, 전체 3500자 이내)를 '참고 데이터이며 지시·승인이 아님'으로 붙인다. 지문(verificationCurrent 방식)이 다르면 '코드 상태가 바뀌었음, 검사 결과는 재사용하지 않음'. 앱 일감은 같은 앱 폴더의 기록을 먼저 읽게 한다. 모델 이름·세션 ID 는 프롬프트에 넣지 않는다. 비밀값·PC 사용자 경로는 마스킹하고 원시 diff·프롬프트 전문은 넣지 않으며 Git 에서 제외한다. 통제실 일감 상세·정비 결과에 '📋 인계 기록' 접이식(읽기 전용)이 있다(`factory_jobs.handoff`, `factory_maintenance_messages.handoff`, 열 추가 마이그레이션). 직접 실행한 CLI·다른 PC 의 작업은 기록하지 못한다.
- 잠금은 관리 실행 경로의 약속이다. 직접 실행한 CLI, 다른 편집기, 다른 PC까지 OS 수준에서 막는 장치는 아니다. 같은 폴더를 수정하는 작업은 공통 실행기를 사용한다.

## 실행·권한·검증

`ai-runner.mjs`에서 Claude 명령·이벤트 계약은 유지하고 Codex JSONL을 기존 `system / assistant / result` 계약으로 변환한다. Codex는 별도 모델 설정만 사용하고 Claude 모델 이름을 상속하지 않는다. Windows npm 설치는 Node 런처를 직접 실행하여 PowerShell 정책과 TOML 인자 인용 문제를 피한다.

Codex는 `workspace-write`, `approval_policy=never`, 셸 네트워크 차단으로 실행하며 full-access 우회를 사용하지 않는다. 승인할 수 없는 명령은 실패한다. **이 정책은 Claude의 도구별 deny 규칙과 동일한 정책이 아니다.** 특히 보호 파일 읽기·명령 필터·serverctl 접근의 동등성을 인증하지 않았다. Codex로 서버 설정을 수정하려고 권한을 확대하지 말고 기존 승인된 관리 경로를 사용한다.

일반 앱 작업은 부모 프로세스가 Flutter analyze, Node 프로젝트 타입 검사, Android 단위 검사 등의 해당 검증을 실행한다. 실패하면 완료·산출물 후속 반영·커밋으로 진행하지 않는다. 이는 최소 게이트이며 모든 플랫폼의 전체 빌드/e2e 시험을 대체하지 않는다. Windows Swift 작업은 비어 있지 않은 Swift 소스와 XcodeGen 구성만 확인하며 컴파일·앱 실행은 Mac에서 별도로 해야 한다.

정비는 기존 감독 스크립트 문법 검사·타입 검사를 유지한다. Codex가 Git 메타데이터를 쓰지 못해 변경만 남기면 감독 프로그램이 작업 트리를 검사한 뒤 로컬 커밋한다. 원격 rebase로 HEAD가 바뀌면 다시 검사한다. 검사 실패 파일은 보존하고 같은 정비 대화에서 수정할 수 있다. 키 파일이 커밋에 포함되면 중단한다. GitHub push와 서버 배포는 기존 감독 프로그램·승인 흐름이 담당한다.

## 도구 요청 중계 (1단계)

Codex의 샌드박스·네트워크·승인 정책은 그대로 두고, 외부 도구(앞으로 `factory\game-toolkit`의 PixelLab 등)는 감독 프로그램이 대신 실행한다. AI(Claude·Codex)는 요청서만 쓰고, 감독이 허용 목록의 도구만 실행해 결과를 앱 폴더에 돌려준다. 키는 AI 프로세스에 들어가지 않는다.

**스위치**: 통제실 설정(주사용 AI 옆) **도구 요청 중계** — `꺼짐`(기본) / `보고만` / `허용`, 일감당 요청 수(기본 제한 없음, 넣으면 1~200), 도구 제한 시간(기본 제한 없음, 넣으면 5~900초. 제한 없음이면 tools.json 의 도구별 `timeoutSec`만 적용). 비워 두거나 0 = 제한 없음이고, `limitsVersion` 표시가 없는 예전 저장값(30·180)은 제한 없음으로 읽는다. 제한 없음은 `/api/factory/next`에 null 로 보낸다(예전 감독 프로그램은 자기 기본값 30·180 을 씀). 대신 일감이 끝나거나 취소되거나 감독 프로그램이 꺼지면 돌던 도구 프로세스를 끈다. 서버 `factory_settings.toolBroker`(JSON)에 저장되고 `/api/factory/next` 응답의 `toolBroker`로 감독이 폴링 때 받아 간다. 값이 없으면(예전 서버) 감독은 꺼짐으로 본다.

- 꺼짐: 요청 폴더를 보지 않고 작업 규칙에도 사용법을 넣지 않는다. 기존 일감 동작과 같다.
- 보고만: 요청을 검증·기록하지만 실행하지 않는다. 응답은 `denied`, 메시지 "보고만 모드".
- 허용: 검증을 통과한 요청만 실행한다.
- 꺼짐이 아니면 일감 시작 때 앱 폴더 작업 규칙(CLAUDE.md 공장 블록, Codex는 `project_doc_fallback_filenames`로 같은 파일)에 사용법 몇 줄을 붙이고, `tools.json`의 `secrets`에 선언된 키는 그 일감의 AI 환경변수에서 빼고 도구 프로세스에만 준다.

**규약** (`tools/factory-supervisor/toolbroker.mjs`)

- 요청서: `<앱>/.factory/requests/<요청ID>.json` = `{ "id", "tool", "args" }`. ID는 영문·숫자·`_-` 64자까지, 파일 이름과 같아야 한다. 다른 키는 거부한다.
- 응답: `<앱>/.factory/responses/<요청ID>.json` = `{ id, tool, status: ok|denied|failed|timeout, message, files: [앱 폴더 기준 상대 경로], output?(마스킹된 출력 끝 1500자), result?(echo), cost, startedAt, finishedAt }`. 만든 파일은 `.factory/assets/` 아래. 응답의 모든 문자열은 이 일감의 키 값·작업 PC 토큰·비밀번호 모양을 가린 뒤 쓴다. 응답이 이미 있는 요청은 다시 처리하지 않는다(재실행에도).
- 검증: 요청서 16KB 상한, 심볼릭 링크·파일 아닌 요청 거부, `.factory`·`requests`·`responses`·`assets`는 실제 폴더여야 함, tool은 허용 목록(`echo`, `toolkit.run`)만, 경로 인자는 앱 폴더 안 상대 경로만(`..`·`.`·절대경로·드라이브·UNC·`.git`·링크가 낀 경로 거부). 실패하면 `denied`와 이유.
- 상한: 일감당 요청 수(거부된 요청도 센다) 초과는 `denied`. 도구 실행은 PC 전체에서 한 번에 하나만 돌고, 나머지 요청은 줄을 서서 다음 확인(3초) 때 처리한다.
- 수명: 일감의 AI 프로세스가 도는 동안만 3초마다 확인한다. AI가 끝나거나 취소·시간 초과로 멈추면 확인을 멈추고 돌던 도구도 끈다.
- 기록: `.factory/ai-events.jsonl`에 `{ engine, phase: "tool-request", taskId, requestId, tool, status, ms, at }`만 남긴다(args·출력·키 없음). 통제실에는 진행 보고의 `toolRequests`(요청ID·도구·상태·시각·소요·짧은 메시지)를 보내 `factory_jobs.toolRequests`(추가 마이그레이션 `20261017090000_add_factory_tool_requests`)에 저장하고 일감 상세 **🧰 도구 요청**에 보여 준다.

**허용 도구**

- `echo`: args(4000자까지)를 응답 `result`에 그대로 돌려준다. 중계 경로 확인용.
- `toolkit.run`: args `{ "command": "<하위명령>", "args": { 이름: 값 } }`. `<toolkitDir>/tools.json`에 **선언된 하위 명령만** `python <toolkitDir>\<entry> <하위명령> --이름=값 ...` 고정 배열로 셸 없이 실행한다. 작업 폴더는 앱 폴더, 제한 시간은 `min(timeoutSec, 통제실 제한 시간)`. 환경변수는 PATH·SystemRoot·TEMP 등 실행에 필요한 최소값과 `FACTORY_APP_DIR`·`FACTORY_ASSETS_DIR`·`FACTORY_REQUEST_ID`, 그 도구에 선언된 키뿐이다(감독·AI의 다른 환경은 물려주지 않는다). 툴킷 폴더나 `tools.json`이 없으면 `failed` "툴킷이 없어요".
- `toolkitDir`는 `supervisor.config.json`의 `toolkitDir`(비우면 `<workDir>/game-toolkit` = `~/dev/factory/game-toolkit`), 파이썬은 `pythonCmd`(기본 `python`).

`tools.json` 형식:

```json
{ "version": 1, "tools": { "<하위명령>": { "entry": "cli.py", "args": [ { "name": "size", "type": "string|int|path", "required": true } ], "timeoutSec": 120, "network": false, "secrets": [] } } }
```

하위 명령은 영문 소문자·숫자·`_-` 40자, `entry`는 툴킷 폴더 안의 `.py` 상대 경로, 인자 이름은 영문 소문자·숫자·`_`. `string`은 줄바꿈 없는 500자, `int`는 정수, `path`는 위 경로 규칙. 선언되지 않은 인자·필수 인자 누락은 거부한다. `network: true`이거나 `secrets`가 있는 도구는 모드가 **허용**이고 그 이름이 일감의 `requiredSecrets`에 모두 있을 때만 실행한다(이 PC 키 파일에 값이 없으면 `failed`). `network: false`는 선언일 뿐 OS 수준 차단은 아니다. 툴킷 코드는 신뢰된 코드로 취급한다.

**어댑터 인터페이스**: `{ name, cost(args) → 비용 단위, validate(args, ctx) → { ok, value } | { ok: false, reason, status? }, run(value, ctx) → { status, message, files?, output?, result? } }`. 키는 `ctx.secretsFor(이름들)`로만 받는다. **PixelLab은 API 형식을 확인한 뒤 다음 단계에 이 인터페이스로 추가한다**(이번 단계에는 없고, 외부 호출도 하지 않는다).

**AI 쪽 도우미** (`tools/factory-supervisor/toolreq.mjs`, 외부 의존 없음, 앱 폴더에서 실행):

```powershell
node <supervisor-src>\tools\factory-supervisor\toolreq.mjs submit --tool echo --args-file args.json   # 기본 5분 대기(--timeout-sec, 최대 1800)
node <supervisor-src>\tools\factory-supervisor\toolreq.mjs wait --id <요청ID>                          # 끊긴 기다림 이어서
node <supervisor-src>\tools\factory-supervisor\toolreq.mjs status --id <요청ID>                        # 기다리지 않고 지금 상태
```

요청서를 임시 파일로 쓴 뒤 이름을 바꿔 놓고, 응답 파일이 생길 때까지 명령 안에서 1초마다 확인한다(AI 토큰을 쓰지 않는다). 마지막 줄은 `TOOLREQ {"id","status","response","message"}`, 종료 코드는 ok 0, denied·failed 1, timeout·pending 2. AI의 명령 제한 시간이 기다림보다 짧을 수 있어 규칙에 "제한 시간을 넉넉히, 끊기면 wait"를 적어 둔다.

**결과 이미지 올리기** (`tools/factory-supervisor/assetupload.mjs`): 요청이 `ok`로 끝날 때마다와 일감 종료 때, 일감 시작 뒤 `.factory/assets/`에 새로 생긴 이미지(png·jpeg·gif·webp, 10MB 이하, 이름이 `-raw.<확장자>`로 끝나는 원본 제외)를 스크린샷과 같은 `/api/factory/screenshot`으로 올린다. label은 `asset-<파일 이름(확장자 뺌)>`(영문·숫자·`_-` 40자), 같은 label이면 서버가 주소만 바꾼다. 경로+수정시각으로 이미 올린 파일을 기억해 두 번 올리지 않는다. 지시당 장수 한도(스크린샷과 같이 셈)·409에서는 그 일감의 이미지 올리기만 멈추고, 서버 오류(5xx·429·네트워크)는 3번까지 다음 기회에 다시 시도한다. 어느 경우든 일감은 실패시키지 않고 로그에는 파일 이름과 결과만 남긴다. 통제실 일감 상세는 `asset-` label을 **🎨 도구가 만든 이미지**로 따로 보여 주고, 128px 이하 도트 이미지는 확대해 `image-rendering: pixelated`로 그린다.

**작업 규칙의 이미지 안내**: 툴킷 `tools.json`에 `pixel-codex`·`pixel-generate`가 있으면 있는 것만 이름을 적어 "이미지가 필요하면 요청 → report.json·결과 확인 → 이상하면 인자를 바꿔 다시 요청" 안내를 붙이고, `asset-export`가 있을 때만 "좋으면 `asset-export`로 assets 폴더에 넣고 커밋" 줄을 붙인다(`imageToolRules`).

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

구현 환경에서 TypeScript 전체 검사, 모든 감독 `.mjs` 문법 검사, Prisma 스키마 검증을 수행한다. 테스트 명령은 `npm run test:ai-harness`이며 설치된 Node 테스트 API와 TypeScript/React를 사용한다. 도구 요청 중계 시험은 `tests/toolbroker.test.mjs`(같은 명령으로 실행)이고, `toolkit.run`은 파이썬 대신 node로 가짜 진입점을 실행한다.

자식 프로세스 생성이 `EPERM`으로 차단되는 이 환경에서는 실제 가짜 CLI·Git·컴파일러 실행 시험 4개를 명시적으로 건너뛴다. API 조건·SQL 바인딩·세션 분리·잠금·인계·마스킹·selector와 가짜 프로세스 스트림·검증 실패·타임아웃 시험은 실행한다. 운영 DB 동시성·실제 AI 인증·MCP 연결·브라우저 화면·스케줄러·배포·자동 업데이트의 실환경 시험은 별도다.

## 롤백

새 일감을 일시 정지하고 관리 세션이 모두 끝난 뒤 Codex 선택을 끈다. 대기 중인 Codex 일감·정비는 관리자가 Claude로 변경하거나 취소한다. 새 서버를 유지하면 구버전 감독 프로그램도 Claude 작업만 받는다. 서버까지 구버전으로 되돌릴 때는 **남아 있는 Codex 일감이 없어야 한다**. 예전 서버는 AI 필터를 모르기 때문이다.

추가 DB 열은 남겨 두어 기존 Claude 세션과 데이터를 보존한다. 작업 파일·실패 변경·커밋·인계 파일을 삭제하거나 `reset --hard`로 정리하지 않는다. 기존 `.claude` 파일과 스케줄러가 보존되어 있어 기존 실행 경로로 복귀할 수 있다.

## 다음 단계: 부모-자식 일감 연결 (설계 메모, 아직 만들지 않음)

이번 단계에는 Claude → Codex 위임(하위 일감)을 만들지 않았다. 훅의 재귀 방지(`factory-hook.mjs`: 감독이 띄운 AI는 `FACTORY_LAUNCHER=1`이면 등록을 건너뜀)도 그대로다. 다음 단계에서 필요한 점:

- **깊이 1**: 부모 일감만 자식 하나(또는 몇 개)를 만들 수 있고, 자식은 다시 위임하지 못한다. 자식 요청도 이 중계 규약(요청서 → 감독 검증)으로 받는 것이 자연스럽다(`tool: "delegate"` 같은 허용 도구).
- **승인**: 자식은 별도 승인을 받지 않고 부모 승인에 포함한다. 대신 부모의 `aiEngine`·`requiredSecrets`·범위를 넘을 수 없게 감독이 잘라 낸다.
- **폴더 잠금 충돌**(코드로 확인): `ai-runner.mjs`의 `acquireWorkspace`는 정규화한 작업 폴더 경로의 sha256으로 `~/dev/factory/.ai-locks/<hash>.json`을 `wx`(이미 있으면 실패)로 연다. 부모가 같은 앱 폴더의 잠금을 잡고 있는 동안 자식이 같은 폴더로 `acquireWorkspace`를 부르면 `EEXIST` → "이 작업 폴더는 다른 AI 작업이 사용 중입니다"로 **막힌다**. 또 `supervisor.mjs`의 대기열 루프는 같은 `appSlug`가 이미 돌고 있으면 새 일감을 `failEarly`로 실패시킨다. 따라서 자식은 (a) 부모가 잡은 잠금을 물려받는 별도 경로(부모 토큰 확인 후 `setChild`로 자식 PID 기록)로 같은 폴더에서 순차 실행하거나, (b) 별도 작업 폴더(worktree 등)에서 돌고 결과만 합쳐야 한다. 부모 AI가 도는 동안 같은 폴더를 동시에 쓰는 것은 피한다(부모를 기다리게 하고 자식을 실행하는 순차 방식이 단순하다).
- **결과 자동 반환**: 자식이 끝나면 감독이 요약·변경 파일·검증 결과를 부모의 응답 파일(`.factory/responses/<id>.json`)로 돌려주고, 부모는 `toolreq wait`로 받는다. 자식 실패·시간 초과도 같은 상태값(failed·timeout)으로 돌려준다.
- **상한·기록**: 자식 수·시간을 부모의 요청 수 상한에 포함하고, 이벤트·통제실 목록에 부모-자식 관계(부모 일감 ID)를 남긴다.

## 앱 일감 동시 실행 수

- 감독 프로그램은 통제실 [설정]의 '동시에 만들 앱 수'(FactorySetting `appSlots`, 1~4, 정한 적 없으면 3)만큼 앱 일감을 동시에 돌린다. 값은 `/api/factory/next` 응답의 `appSlots`·`appSlotsDefault`로 받고, PC 설정 파일의 `slots`는 서버 값이 없을 때(예전 서버·범위 밖 값)만 쓴다. 서버가 '정한 적 없음(기본 3)'이면 PC 에 1·4 처럼 따로 정해 둔 값을 덮어쓰지 않는다.
- 같은 앱(`appSlug`)은 자리가 남아도 하나씩만 돈다: 서버 `claimJobs`가 이미 running 인 앱의 일감을 건너뛰고 한 번에 앱마다 하나만 고르며, 감독 프로그램은 같은 앱 이름이 이미 돌면 시작하지 않고 폴더 잠금(`acquireWorkspace`)으로 한 번 더 막는다. 정비가 대기·진행 중이면 새 앱 일감은 멈춘다(`maintenanceHold`).
- 값을 줄여도 돌던 일감은 끊지 않는다(`planTake`가 음수 없이 0). 자리가 꽉 차도 감독 프로그램은 `slots=0`으로 확인을 이어 가서 값을 늘리면 다음 확인에 더 가져간다.
