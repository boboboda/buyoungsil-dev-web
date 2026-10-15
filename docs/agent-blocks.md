# 에이전트 블록 정의 (4-2)

에이전트 종류마다 흩어져 있던 실행 설정(엔진·모델·작업 공간·권한·환경변수·키·끝난 뒤 처리·한도)을 **정의 파일 하나**로 적고,
감독 프로그램이 그 파일을 읽어 실행 설정을 만들게 했다. **동작은 바뀌지 않는다** — 종류마다 예전 코드가 만든 설정과 정의에서 만든 설정이 완전히 같은지 시험이 비교한다.

## 파일

| 위치 | 내용 |
| --- | --- |
| `tools/factory-supervisor/agents/*.json` | 에이전트 종류 하나당 정의 하나 (`type: "agent"`) |
| `tools/factory-supervisor/agents/flows/*.json` | 일감 종류별 블록 순서와 조건 (`type: "flow"`) |
| `tools/factory-supervisor/agentspec.mjs` | 스키마 검사 + 권한 상한 + 흐름 검사 (순수 함수, 홈페이지 서버도 같이 쓴다) |
| `tools/factory-supervisor/agentrun.mjs` | 정의 → 실행 설정(권한 설정 파일·환경·명령 인자·Codex 옵션) |
| `tools/factory-supervisor/tests/fixtures/agent-golden.json` | **정의를 도입하기 전 코드(커밋 2ee39b2)** 가 만든 실행 설정 (기준) |

정의 파일을 `tools/factory-supervisor/` 아래에 둔 이유: 감독 프로그램은 GitHub 에서 이 폴더를 받아 업데이트하고(`update.mjs`), 홈페이지 서버 이미지에도 같이 들어 있어 통제실이 같은 파일을 읽을 수 있다.
형식은 JSON (YAML 파서 의존성을 늘리지 않으려고).

## 종류

| 번호 | 종류 | 정의 파일 | 정의로 실행 |
| --- | --- | --- | --- |
| C1 | 지휘자 | `conductor.json` | 예 |
| L1 | 실험 | `lab.json` | 예 |
| T | 도구 일감 | `tool.json` | 예 (입력 한도만 읽음. 작업 폴더 이름은 고정 값을 시험이 대조) |
| A1 | 새 앱 | `app-new.json` | 예 |
| A2 | 수정 | `app-revision.json` | 예 |
| A3 | 병행(작업 사본) | `app-parallel.json` | 예 |
| A4 | 다시 맞추기·고치기 턴 | `app-realign.json` | 예 |
| R1 | 출시 | `release.json` | 예 |
| M1 | 정비 | `maintenance.json` | **아니오** — 정비 흐름 자체를 바꾸게 되므로 다음에 단독으로. 정의는 기록용(`migrated: false`) |
| H1 | 정리(/compact) | `compact.json` | **아니오** — 부른 일감의 권한 설정 파일을 그대로 쓴다. 정의는 기록용 |

`migrated: false` 인 정의는 감독 프로그램이 읽어 쓰지 않는다 (`agentSpec()` 이 null). 통제실에는 "기록용"으로 보인다.

## AgentSpec 필드

```
schema, type:"agent", id, kind, label, summary, migrated
engine      { allowed:[claude|codex|none], default, model:{ claude: job|task|config|none, codex: … } }   엔진·모델 규칙
workspace   { type: app-folder|app-worktree|lab-folder|tool-folder|maintenance-checkout, root? }          작업 공간 종류
tools       { mode, allow:[…], deny:[…], only?:[…], allowFromConfig }                                        허용·금지 도구
cli         { style: stream|oneshot|none, output?, strictMcp?, noSessionPersistence? }                       명령 인자 모양
paths       { allow:[규칙…], deny:[규칙…], additionalDirectories?, entriesExcept?, settingsFile }          쓰기·읽기 경로 (또는 { managedBy })
network     { codex: on|off, writableRoots? }                                                              네트워크
hooks       [ssh-guard | maintenance-guard]                                                                훅
env         { filter:"safeEnv", set:{ FACTORY_*: "@job.id" | "@dir" | … | 글자 } }                          환경변수 거르기 + 감독이 정하는 값
keys        { decision: none|job-required|job-required+release-key|tool-method }                           키 결정 방식
prompt      { template, rules }                                                                            지시 틀 · 규칙 파일
after       [verify, commit, outbox, compact, merge, …]                                                    끝난 뒤 처리
limits      { timeoutMs? | timeoutFrom:"config.jobTimeoutMin", input? }                                    한도
next        [에이전트 번호 | 단계 이름]                                                                      다음 연결
```

경로 규칙 글자 (`paths.allow/deny`): `edit:`/`read:` + `@factory/<경로>`(공장 폴더) · `@work/<경로>`(작업 폴더) · `@shared/<경로>`(공용 폴더) · `~/<경로>` · `@protected/**`(정비·감독 실행 폴더) · `@entries`(공장 폴더 직속 항목, `entriesExcept` 제외).

### 정의가 실제로 읽히는 필드 / 기록·검증만 하는 필드

- **읽어서 실행에 쓴다**: `tools`(허용 도구·권한 방식·`--tools`·`--disallowedTools`), `cli`(지휘자 인자), `paths`·`hooks`(권한 설정 파일 `--settings` 내용), `env`(환경변수), `network`(Codex 인터넷·쓰기 폴더), `limits.timeoutMs`(지휘자), `limits.input`(도구 일감 입력 한도), `workspace`(시험이 폴더 이름을 대조), `engine.default` 등은 검사만.
- **기록·검증만 한다** (아직 코드가 정한다): `prompt`(지시문은 `supervisor.mjs` 의 `promptFor`·`rulesFor`), `after`(끝난 뒤 처리 순서), `keys`(키 결정은 `requiredSecrets` 코드), `next`, `limits.timeoutFrom`, 흐름(Flow). 이 필드는 스키마·허용 값 검사와 통제실 표시에는 쓰이지만 실행 순서를 바꾸지 않는다.

## 권한 상한

정의는 감독 훅·deny 상한보다 넓힐 수 없다. 상한은 **코드**(`agentspec.mjs` 의 `CEILING`)에 있고 정의 파일로 바꿀 수 없다. 넓히는 정의는 읽을 때 거절한다.

- 도구: `Bash Edit Write Read Glob Grep WebFetch WebSearch` 밖(Task·Agent·NotebookEdit·MCP)은 열 수 없다. 권한 방식은 `default`·`acceptEdits` 만.
- 훅: Bash 를 쓰는 종류는 `ssh-guard`(정비는 `maintenance-guard`)를 뺄 수 없다.
- 금지 규칙: 정비·감독 실행 폴더 쓰기, 공장 폴더 `*.json`·`*.sh`·키 파일, `supervisor.config.json` 읽기, `~/.ssh`·`~/.aws` 읽기 금지를 뺄 수 없다. 허용 경로는 `read:@factory/**`, `edit:@work/**`, `edit:@shared/**`, `Bash` 뿐.
- 읽기 전용 종류(C1)는 읽기 도구만, 막는 도구(Bash·Edit·Write·…)를 뺄 수 없고 키를 받을 수 없다.
- Codex 인터넷은 실험(L1)만 켠다. 환경변수 거르기(`safeEnv`)는 끌 수 없고 정의가 넘기는 이름은 `FACTORY_*` 이면서 키·토큰 모양이 아니어야 한다.
- 작업 공간 종류와 폴더 이름(`lab`, `tooljobs`, `.worktrees`)은 종류마다 고정. 도구 일감 입력 한도는 서버 한도(8/8/16)보다 클 수 없다.

**거절되면**: 그 정의만 빠지고(오류는 감독 로그에 한 번 경고, 통제실 설정 → 에이전트 정의에 "거절된 정의"로 표시), 그 종류는 **정의가 도입되기 전 코드 그대로** 돈다. 다른 종류는 영향이 없다.

## 스냅샷 시험

`tools/factory-supervisor/tests/agentspec.test.mjs` — 가짜 공장 폴더·환경변수·일감으로 종류마다 비교한다 (기준 파일은 정의 도입 전 코드로 한 번 만든 것).

- 비교 항목: 명령 인자 · 설정 파일 내용 · 환경변수 이름(과 `FACTORY_*` 값) · 작업 폴더 · 훅
- 비교 대상: C1, L1(Claude·Codex), T, A1, A2, A2(Codex), A3, A4(세션 이어받기), R1(출시 키 환경)
- 하나라도 다르면 시험이 실패하므로 **그 종류는 옮기지 않고 그대로 둔다** (`migrated: false`).
- 정의가 없을 때의 예전 코드 경로도 같은 기준 파일과 같다는 것을 확인한다.

## 흐름 (Flow)

`agents/flows/*.json`. 단계는 `agent`(에이전트 번호) 또는 `gate`(승인·합치기 검사·필수 검증·배포·결과 보고) 중 하나, `optional`·`when`(허용된 조건 이름)·`variants`(조건에 따라 다른 에이전트)를 가진다.
예) 수정 = 지휘자(선택: 같은 앱에 승인된 수정이 2개 이상) → 작업자(A2, 묶이면 A3, 다시 맞출 때 A4) → 합치기 검사 → 승인 → 배포.
지금 흐름은 **검사와 통제실 표시용**이다. 실제 일감 순서는 서버·감독 코드가 그대로 정한다.

## 통제실

[설정] → "에이전트 정의" (읽기 전용): 종류별 엔진·작업 공간·허용/막은 도구·네트워크·훅·키 결정·지시 틀·끝난 뒤·다음, 일감 종류별 흐름, 거절된 정의와 이유. 고치는 단추는 없다 — 정의는 코드와 같이 커밋해서 바꾼다.

통제실 [지도](`docs/factory-map.md`)는 정의와 상한·훅을 합친 "실제 적용 권한"(`effectivePermissions`)을 블록 상세로 보여 준다.

## 정의를 바꿀 때

1. 정의 JSON 을 고친다.
2. `npm run test:agents` — 스냅샷이 다르면 의도한 변경인지 확인하고, 의도한 것이면 기준 파일(`agent-golden.json`)을 **의도적으로** 함께 고친다 (동작을 바꾸는 변경이므로 별도 정비로).
3. 상한을 넓히는 변경은 정의가 아니라 `CEILING` 코드를 고쳐야 하고, 훅·deny 쪽 코드 변경과 같이 검토한다.
