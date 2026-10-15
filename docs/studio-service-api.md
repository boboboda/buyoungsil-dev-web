# 서비스 운영 API 확인표와 제안 (스튜디오 [운영] → 서비스 운영, 3-3)

스튜디오가 서비스(지금은 한 컷 `one-tiny-frame`, 서버2 `one-tiny-frame-api`)를 다루려면 **홈페이지 서버가 토큰으로 부를 수 있는 JSON API**가 필요하다.
아래는 서비스 앱 폴더의 코드·문서를 읽기만 해서 확인한 결과다(2026-10-15, `server/src/*.ts`, `docs/api.md`, `docs/deploy.md`). 서비스 DB는 건드리지 않았다.
확인표 원본은 `lib/studio/service.ts` 의 `SERVICE_PROFILES` 이고, 서비스 코드가 바뀌면 같이 고친다.

## 지금 상태 (스튜디오 ↔ 서비스 연결 정비)

- 홈페이지 서버가 서비스 호출을 **항상 대신** 한다. 관리자 세션(통제실 로그인)이면 스튜디오 [운영] → 서비스 운영의 기능을 전부 쓸 수 있고, 키(`SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME`)는 키 보관함(서버 보관 키)에서 서버 안에서만 읽는다. 브라우저·응답·로그·기록에 값이 없다. 앱별 Studio 접근 키(외부 열람용) 사용자는 읽기 전용 그대로다.
- `SERVICE_PROFILES`(`lib/studio/service.ts`)의 `api` 는 이제 **홈페이지가 부를 경로**로 모두 채워져 있다(아래 제안과 같은 경로·모양). 서비스에 그 경로가 아직 없으면 404 → 화면은 **서비스에 API 없음**으로 보여 주고 버튼을 끈다(오류로 화면이 깨지지 않는다).
- 서비스 앱 일감(`cmv93sccm0015ll20nihj575h`)이 `/api/admin/*` 를 추가하면 코드 수정 없이 버튼이 켜진다.

| 기능 | 홈페이지가 부르는 경로 | 서비스에 없으면 |
|---|---|---|
| 연결 확인 | `GET /api/admin/health` | 서비스에 API 없음 |
| 일정·실행 상태 읽기 | `GET /api/admin/pipeline` | 서비스에 API 없음 |
| 생성 일정 켜기·끄기 | `POST /api/admin/pipeline/auto` `{ on }` | 서비스에 API 없음 |
| 지금 실행 | `POST /api/admin/pipeline/run` `{ kind, lines? }` | 서비스에 API 없음 |
| 생성 기록 | `GET /api/admin/gen-log?limit=50` | 서비스에 API 없음 |
| 후보 목록 | `GET /api/admin/candidates?status=review\|held\|pending` (항목에 `imageUrl`) | 서비스에 API 없음 |
| 후보 승인·반려·다시 | `POST /api/admin/cuts/:id/approve\|reject\|retry` | 서비스에 API 없음 |
| 서비스 업로드 | `POST /api/admin/art-upload` | 서비스 업로드 미지원(기록 남김) |
| 검수 대기 개수 | `GET /api/review-status` + `REVIEW_STATUS_TOKEN` | (이미 있음) |

기존 `/admin/*` 화면(쿠키 로그인 `ADMIN_TOKEN` 입력, 리다이렉트 응답)은 스튜디오가 부르지 않는다. 서비스 DB는 건드리지 않는다.

## 연결 상태 표시와 알림

서비스마다 [구성] 대시보드·[운영] 서비스 운영·통제실 스튜디오 탭 표에 같은 정보가 나온다. 확인은 [지금 확인] 버튼과 **10분 캐시**(마지막 결과는 `factory_settings` 의 `serviceHealth:<앱>` 한 줄)로 한다.

- 도메인 응답 여부와 응답 시간(어떤 HTTP 응답이든 서버가 답하면 '응답함', 5xx 는 오류)
- HTTPS 인증서 만료일과 남은 날수: **14일 이하 경고(노랑), 만료는 빨강**. 인증서 검증을 끄고 만료일만 읽는다(데이터는 보내지 않음).
- 키 등록 여부: `REVIEW_STATUS_TOKEN_*`, `SERVICE_ADMIN_TOKEN_*` (이름과 등록 여부만)
- `GET /api/admin/health` 결과(없으면 '서비스 API 없음'). 응답에서 `ok·status·version·commit·db·uptime·time·env` 짧은 값만 화면에 보인다.
- 마지막 확인 시각(한국 시간)
- **인증서 만료가 7일 이하(이미 만료 포함)로 남으면** 통제실 할 일(`get_inbox`, '막힘')과 텔레그램에 **한 번** 알린다(같은 인증서 만료일이면 한 번만, 갱신하면 새로 알림).

## 키 등록 순서 (사람이 할 일)

1. (서비스 쪽) 한 컷 앱 일감이 끝나 서버에 배포되면 `/api/admin/*` 가 생긴다. 서비스 환경변수 `ADMIN_API_TOKEN` 같은 별도 값(쿠키 `ADMIN_TOKEN` 과 분리)을 정한다. 이 정비는 서비스 코드·DB·nginx·.env 를 고치지 않는다.
2. 통제실 [설정] → 외부 서비스 키(서버 보관 키)에 `SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME` 으로 같은 값을 등록한다. (검수 대기 개수용 `REVIEW_STATUS_TOKEN_ONE_TINY_FRAME` 은 이미 있으면 그대로.)
3. 스튜디오 [구성]의 서비스 연결 상태에서 [지금 확인] → 키 등록 '등록됨', 서비스 API '정상'이 되면 [운영] → 서비스 운영의 버튼이 켜진다.
4. 서비스 서버의 HTTPS 인증서가 만료됐다면(`certificate has expired`) 서버에서 갱신한다(이 정비가 인증서·nginx 를 고치지 않는다).

## 도구 일감 참고 그림 점검

공장 그림 저장소의 그림은 이미 홈페이지 업로드 서버에 있으므로 따로 복사하지 않는다.

감독 프로그램 도구 일감은 시작 전에 참고 그림 주소마다 접속해 본다(`tools/factory-supervisor/refcheck.mjs`). 카드 규칙 `pinDefault` 로 **고정된 기본 그림**이 실패하면 일감을 실패로 끝내고 이유에 '기본 그림 주소 접속 실패(인증서 만료)'와 고칠 곳을 적는다. 고정이 아닌 그림은 빼고 진행한다.

## 처음 확인 결과 (2026-10-15, 서비스 코드를 읽기만 해서 확인)

| 기능 | 결과 | 근거 |
|---|---|---|
| 생성 일정 켜기·끄기 | 서비스에 API 없음 | `POST /admin/pipeline/auto`(form `on=1/0`)는 있지만 관리자 화면 전용: 쿠키 로그인(`ADMIN_TOKEN` 입력) 필요, 응답은 리다이렉트. 켜짐 여부를 읽는 API도 없다. |
| 지금 실행 | 서비스에 API 없음 | `POST /admin/pipeline/request`(form `kind`·`lines`)도 같은 이유. 실행 중 여부(`jobState`)를 읽는 API 없음. |
| 생성 기록(gen_log) | 서비스에 API 없음 | `gen_log` 표와 `recentLogs()`는 있으나 `/admin` 화면에만 그린다. |
| 후보 승인 | 서비스에 API 없음 | `POST /admin/cuts/:id/approve·reject·retry`는 관리자 화면 전용. 후보 목록을 읽는 API도 없다. `/worker/*`는 작업 PC 전용 토큰. |
| 검수 대기 개수 | **있음** | `GET /api/review-status` + `Authorization: Bearer REVIEW_STATUS_TOKEN` → `{ review, held, pending, updatedAt }`. 읽기 전용, 이미 출시 카드가 쓴다. |
| 서비스 업로드(그림 받기) | 서비스에 API 없음 | 그림을 받는 API가 없다. `/worker/rounds/:id/upload`는 로컬 채점 라운드 전용. |

추가로 확인한 것:
- `/admin` 전체는 `ADMIN_TOKEN`을 폼으로 받아 `admin` 쿠키(30일)를 주는 방식이다. `Authorization: Bearer` 로는 받지 않는다. nginx에서도 `/admin`은 내부망만 허용한다(`docs/deploy.md`).
- 서비스 자체 일정: 매주 월요일 10:00 KST에 재고를 채운다(`server/src/jobs.ts`, `WEEKLY`). 관리자 화면의 '자동 실행'(`pipeline_auto` 설정)이 켜져 있을 때만 돈다. 이 값을 읽는 API가 없어서 스튜디오는 켜져 있는지 모른다 → 스튜디오 생성 일정과 겹칠 수 있다고 항상 경고한다. (`GET /api/admin/pipeline` 이 생기면 읽을 수 있다.)

## 한 컷 앱에 추가를 제안하는 API

(`GET /api/admin/health` 와 `GET /api/admin/candidates` 항목의 `imageUrl` 이 추가된다.) 모두 `Authorization: Bearer <SERVICE_ADMIN_TOKEN>`(서비스 환경변수 `ADMIN_API_TOKEN` 같은 별도 값, 쿠키/`ADMIN_TOKEN`과 분리), JSON 응답, 쓰기는 분당 횟수 제한. 값은 응답·로그에 내지 않는다. **실제 추가는 나중에 앱 일감으로 따로 한다.**

1. `GET /api/admin/pipeline` → `{ auto: boolean, running: { kind, startedAt, by } | null, weekly: { weekday: 1, hour: 10 } }`
2. `POST /api/admin/pipeline/auto` `{ on: boolean }` → 위 상태
3. `POST /api/admin/pipeline/run` `{ kind: "request"|"draw"|"weekly", lines?: number }` → `202 { started: true }` / `409 { error: "busy" }`
4. `GET /api/admin/gen-log?limit=50&before=<id>` → `{ items: [{ id, at, step, cutId, ok, detail }] }` (`detail`은 프롬프트·키 없는 요약만)
5. `GET /api/admin/candidates?status=review|held|pending` → `{ items: [{ id, line, image, status, days }] }`, `POST /api/admin/cuts/:id/approve|reject|retry` → JSON 응답
6. `POST /api/admin/art-upload` — 스튜디오 [내보내기]의 '서비스 업로드'가 부르는 모양:
   요청 `{ items: [{ url, subject, kind, fileName }] }`(스튜디오가 승인한 그림의 주소, 서비스가 받아 가서 저장), 응답 `200 { saved: number, skipped: [{ fileName, reason }] }`. 이 API가 열리면 `lib/studio/service.ts` 의 `upload` 항목에 `api: { method: "POST", path: "/api/admin/art-upload", auth: "admin" }` 를 넣는 것만으로 연결된다.

0. `GET /api/admin/health` → `{ ok: true, version?, db?, time? }` (화면에는 `ok·status·version·commit·db·uptime·time·env` 의 짧은 값만 나온다. 키·토큰은 응답에 넣지 않는다)

`SERVICE_PROFILES`의 `api` 는 위 경로로 이미 채워져 있고, 서비스에 경로가 생기면 버튼이 켜진다.
