# 소설 공장 자동화 (7-1): 웹에서 읽고·메모하고·실행 + 채팅 연결

작업 PC 터미널에 지시를 붙여넣던 일을 없앤다. 웹 [작품] 탭에서 원고를 읽고 줄 메모를 남기고 버튼을 누르면, 감독 프로그램이 작품 폴더의 `cycle.sh` 를 대신 돌리고 결과를 웹에 올린다. 채팅의 Claude 도 같은 정보를 커넥터 도구로 읽고 메모·작업 요청을 보낸다.

## 흐름
1. (작업 PC) 감독 프로그램이 `<novelsDir>/<작품>/chapters/NNN.md`·`reviews/NNN.md` 를 홈페이지에 올린다(시작 때, 이후 작업이 없을 때 10분마다, 바뀐 것만). 공개 본문(`body`)·화 상태·예약 발행은 건드리지 않고 `draft*` 컬럼에만 쓴다. 홈페이지에 없는 작품은 설정 승인 전(setup)·일시 정지로 만든다.
2. (웹) 통제실 [작품] → 작품 → 화 → **원고·검수·실행**: 줄 번호 본문(글자 크기 조절)·줄 탭 메모(필수/권장)·검수 표(필수가 위)·열린 메모·최근 작업·비용.
3. 버튼: **[검수만]**(skipWrite, maxRewrites 0) / **[메모 반영해 수정]**(skipWrite, maxRewrites 2) / **[처음부터 새로 쓰기]**(fresh, maxRewrites 0). 누르면 `pending_approval`, 한 번 더 **[승인]** 으로 시작. 진행 중에는 logTail 을 15초마다 갱신, **[취소]** 가능.
4. (작업 PC) 감독 프로그램이 15초 폴링 때 승인된 작업을 가져온다(`GET /api/novel/jobs/next`, 서버가 원자적으로 running 표시) → 열린 메모를 `reviews/NNN-memo.md` 에 `- (필수|권장) [L줄번호] 내용` 으로 이어 붙임(기존 항목 유지, 같은 줄은 한 번만) → git Bash 로 `./cycle.sh NNN [--fresh|--skip-write] --max-rewrites N` → 표준출력 끝 200줄을 15초마다 보냄 → 끝나면 판정·필수/권장·글자 수·비용(usage.md 에서 이번에 늘어난 행의 `$` 합)·원고·검수를 완료 보고, 메모는 성공했을 때만 applied. git 은 cycle.sh 가 이미 커밋·푸시하므로 감독 프로그램은 건드리지 않는다.
5. 실패(종료 코드≠0·40분 초과·감독 오류)는 failed + 마지막 로그, 텔레그램 알림.

## 규칙
- 비용 한도: 최근 24시간 합계 기본 **$8**(작품 탭 ⚙ 에서 변경). 넘으면 새 작업은 승인 대기에 두고, 승인할 때 한 번 더 확인(`force`). 승인된 작업도 한도가 넘으면 승인 대기로 되돌린다(사람이 한도를 확인하고 승인한 것은 제외).
- 자동 승인(5-3): [검수만]만, 하루 한도 안일 때만. 기본 꺼짐(⚙ 에서 켬). 수정·새로 쓰기는 늘 사람이 승인.
- 한 작품에 도는 작업은 하나(서버가 막음). 같은 화·같은 모드의 대기·진행 작업이 있으면 새로 만들지 않음.
- 작업 한 번 최대 40분. 서버는 소식이 10분 끊기거나 시작 후 45분이 지난 running 을 failed 로 정리한다(감독 하트비트 = 진행 로그 15초).
- 감독 프로그램은 시작할 때 `POST /api/novel/jobs/recover` 로 running 을 failed 로 정리(재시작해도 중복 실행·영원히 running 방지).
- 감독 프로그램은 앱 일감·정비·서버 배포가 돌거나 일시 정지·업데이트 대기·재시작 대기 중이면 소설 작업을 시작하지 않고, 소설이 도는 동안은 앱 일감을 새로 받지 않는다(같은 PC, 동시 실행 금지). 업데이트·재시작은 소설이 끝난 뒤.
- 서버가 아직 새 버전이 아니면(404) 감독 프로그램은 조용히 10분 뒤 다시 본다. 대기열(/next) 확인에는 영향 없음.
- 작품 폴더: 설정 `novelsDir`(기본 `<workDir>/novels`) 아래 `<작품 이름>/` 에 `cycle.sh`. bash 는 설정 `bashCmd`(비우면 Git Bash 를 찾음).

## 커넥터 도구
| 도구 | 설명 |
|---|---|
| `novel_list()` | 작품·화 목록, 상태, 최근 판정, 열린 메모·작업 수, 비용 한도 |
| `novel_get_episode(workSlug, episode, from?, to?)` | `L줄번호: 본문`(한 번에 최대 400줄), 검수 필수/권장, 열린 메모, 최근 작업 |
| `novel_add_note(workSlug, episode, line?, kind, text)` | 메모 추가(kind: 필수\|권장) |
| `novel_enqueue(workSlug, episode, mode)` | mode: check\|revise\|fresh. 만들기만 하고 승인은 관리자가 웹에서 |
| `novel_get_job(id, tail?)` | 상태·판정·비용·로그 끝부분 |

## API
- 관리자(세션): `POST /api/admin/novel/jobs`, `GET|POST /api/admin/novel/jobs/[id]`(approve/cancel/force), `GET|PUT /api/admin/novel/job-settings`, `GET .../works/[slug]/episodes/[number]/draft?from&to`, `POST|DELETE .../episodes/[number]/notes`
- 워커(토큰): `GET /api/novel/jobs/next`, `POST /api/novel/jobs/progress`, `POST /api/novel/jobs/complete`, `GET|POST /api/novel/jobs/notes`(열린 메모 조회·applied), `POST /api/novel/jobs/recover`, `POST /api/novel/jobs/content`
- DB: `novel_jobs`, `novel_notes`, `novel_episodes.draft*`(마이그레이션 `20261119090000_novel_jobs_notes`). 공개 /novel 은 기존대로 approved+예약 시각이 지난 화의 `body` 만 보인다(초안·검수·메모는 관리자·채팅 도구 전용).

시험: `npm run test:novel-jobs` (`tests/novel-jobs.test.mjs`, `tools/factory-supervisor/tests/novelrun.test.mjs`).
