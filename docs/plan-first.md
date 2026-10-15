# 계획 먼저 승인 + 변경 내용(diff) 보기 (5-1)

## 계획 먼저 승인 (선택형)

앱 일감(새 앱·수정)을 승인할 때 **바로 시작**(기본)과 **계획 먼저** 중에서 고른다. 출시·실험·도구 일감은 늘 바로 시작.

- 기본값은 통제실 [설정] → 실행·동시성 → "승인 방식"(`planFirstDefault`, 기본 꺼짐). 승인 줄·일감 상세의 `📝 계획 먼저` 체크로 일감마다 바꾼다(체크를 안 건드리면 설정 기본값).
- 텔레그램 승인 알림에는 `✅ 승인(기본 모델)`(설정 기본값), `📝 계획 먼저`(`ap:`) 단추가 있다. 묶음 승인(`approve-group`)은 계획 단계 없이 바로 시작한다.

### 흐름

```
승인(계획 먼저) → planStatus=requested → 감독 프로그램이 읽기 전용 계획 턴(running)
  → ready: 통제실 할 일 + 텔레그램에 계획과 [이대로 진행]·[수정 지시]·[취소]
      이대로 진행 → approved → 평소 대기열(지시문 끝에 계획을 붙여 작업자에게)
      수정 지시(말) → requested(이전 계획+말을 넣어 다시, 최대 5번)
      취소 → 일감 취소
  → failed(계획을 못 만듦): [계획 없이 진행]·[다시 계획]·[취소]
```

- 일감 `status` 는 늘리지 않았다. 계속 `approved` 이고 `planFirst`/`planStatus`/`planText`/`planNote`/`planInfo` 칸만 쓴다(`lib/factory/planFirst.ts`).
- 계획 선택을 기다리는 일감은 가져가지 않고(`pickClaims` 의 `blocked`), **같은 앱의 뒤 일감도 새치기하지 못한다**. 다른 앱은 그대로 돈다. 계획 먼저 일감은 지휘자 자동 묶기에서 빠진다.
- 계획 턴(`tools/factory-supervisor/planturn.mjs`): 지휘자와 같은 읽기 전용 정의(`agents/conductor.json` C1: Read·Glob·Grep만, 가벼운 모델 = 통제실 설정의 지휘자 모델)로 한 번 돈다. 끝난 뒤 `git status`·HEAD 가 달라졌으면 읽기 전용 위반으로 계획을 버린다. 앱 폴더가 아직 없는 새 앱은 빈 임시 폴더에서 지시문만 보고 낸다. 같은 앱 폴더에서 단독 일감이 돌고 있으면 `skip`(차례만 되돌림). 공장 동시 실행 수에는 세지 않고 동시에 1개.
- 서버 주소: `GET /api/factory/next?plan=1` 응답의 `planTask`, 결과는 `POST /api/factory/plan`. 계획이 8분 넘게 안 오면 다시 내준다. `plan` 을 안 보내는 예전 감독 프로그램은 계획을 못 만들므로 계획 대기에 머문다(통제실에서 계획 없이 진행 가능).
- 승인된 계획은 `claimJobs` 가 내려 주는 지시문 끝에만 붙는다(DB 의 기획서는 그대로).

## 변경 내용(diff) 보기

- 앱 일감이 `done` 으로 끝나기 직전에 감독 프로그램이 `startHead..HEAD` 범위의 변경을 `POST /api/factory/diff` 로 보낸다(완료 보고의 64KB 한도 밖, 본문 최대 700KB). 서버가 한 번 더 정리해 `diffInfo` 에 저장한다(`lib/factory/diffReport.ts`).
- 한도: 파일 100개, 파일별 diff 20,000자, 전체 300,000자, 한 파일이 추가+삭제 2,000줄을 넘으면 "큰 파일"(줄 수만). 바이너리는 줄 수만. 한도를 넘으면 `truncated`/`budget` 표시.
- **키·비밀 파일**(`.env*`, `*.pem`·`*.key`·`*.jks`·`*.keystore`·`*.p12`, `key.properties`, `secrets*`, `id_rsa*`, `credentials*`, `service-account*.json`, `google-services.json`, `local.properties`, `.ssh/`·`.aws/`·`secrets/` 폴더 등)는 **내용을 읽지 않고** 이름과 줄 수만 보낸다. 서버·화면도 같은 패턴으로 다시 가린다(감독 프로그램 `diffreport.mjs` 와 `diffReport.ts` 의 패턴은 시험이 비교). 평범한 파일 안의 `password=`·`api_key=`·`token=` 줄·개인 키 블록은 값을 `***` 로 가린다.
- 통제실 일감 상세: "🧾 변경 내용" 접이식 — 파일 트리(폴더별 줄 수), 파일을 누르면 색칠된 diff, 큰 파일·바이너리·비밀 파일은 요약만.
- 채팅 커넥터 `get_factory_job`: `변경_내용`(파일 수·추가/삭제 줄 수·파일별 줄 수 30개까지, 본문 없음), 계획 먼저를 쓴 일감은 `계획_단계`.

## 시험

`npm run test:plan-first` (`tests/plan-first.test.mjs`): 계획 단계 흐름, 읽기 전용 계획 턴(가짜 claude), diff 크기 제한(임시 git 저장소), 비밀 파일 숨김, 화면, 마이그레이션(칸 추가만).
