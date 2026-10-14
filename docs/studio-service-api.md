# 서비스 운영 API 확인표와 제안 (스튜디오 [운영] → 서비스 운영, 3-3)

스튜디오가 서비스(지금은 한 컷 `one-tiny-frame`, 서버2 `one-tiny-frame-api`)를 다루려면 **홈페이지 서버가 토큰으로 부를 수 있는 JSON API**가 필요하다.
아래는 서비스 앱 폴더의 코드·문서를 읽기만 해서 확인한 결과다(2026-10-15, `server/src/*.ts`, `docs/api.md`, `docs/deploy.md`). 서비스 DB는 건드리지 않았다.
확인표 원본은 `lib/studio/service.ts` 의 `SERVICE_PROFILES` 이고, 서비스 코드가 바뀌면 같이 고친다.

## 확인 결과

| 기능 | 결과 | 근거 |
|---|---|---|
| 생성 일정 켜기·끄기 | 서비스에 API 없음 | `POST /admin/pipeline/auto`(form `on=1/0`)는 있지만 관리자 화면 전용: 쿠키 로그인(`ADMIN_TOKEN` 입력) 필요, 응답은 리다이렉트. 켜짐 여부를 읽는 API도 없다. |
| 지금 실행 | 서비스에 API 없음 | `POST /admin/pipeline/request`(form `kind`·`lines`)도 같은 이유. 실행 중 여부(`jobState`)를 읽는 API 없음. |
| 생성 기록(gen_log) | 서비스에 API 없음 | `gen_log` 표와 `recentLogs()`는 있으나 `/admin` 화면에만 그린다. |
| 후보 승인 | 서비스에 API 없음 | `POST /admin/cuts/:id/approve·reject·retry`는 관리자 화면 전용. 후보 목록을 읽는 API도 없다. `/worker/*`는 작업 PC 전용 토큰. |
| 검수 대기 개수 | **있음** | `GET /api/review-status` + `Authorization: Bearer REVIEW_STATUS_TOKEN` → `{ review, held, pending, updatedAt }`. 읽기 전용, 이미 출시 카드가 쓴다. 스튜디오는 이것만 연결했다. |
| 서비스 업로드(그림 받기) | 서비스에 API 없음 | 그림을 받는 API가 없다. `/worker/rounds/:id/upload`는 로컬 채점 라운드 전용. |

추가로 확인한 것:
- `/admin` 전체는 `ADMIN_TOKEN`을 폼으로 받아 `admin` 쿠키(30일)를 주는 방식이다. `Authorization: Bearer` 로는 받지 않는다. nginx에서도 `/admin`은 내부망만 허용한다(`docs/deploy.md`).
- 서비스 자체 일정: 매주 월요일 10:00 KST에 재고를 채운다(`server/src/jobs.ts`, `WEEKLY`). 관리자 화면의 '자동 실행'(`pipeline_auto` 설정)이 켜져 있을 때만 돈다. 이 값을 읽는 API가 없어서 스튜디오는 켜져 있는지 모른다 → 스튜디오 생성 일정과 겹칠 수 있다고 항상 경고한다.
- 관리자 키: 홈페이지 키 보관에 `SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME`(서버 보관 키) 이름을 받을 수 있게 했다. 아직 등록돼 있지 않아 화면에는 '키 등록 필요'로 나온다. 위 관리자 API가 JSON 토큰 방식이 되기 전에는 이 키를 쓸 곳이 없다.

## 한 컷 앱에 추가를 제안하는 API

모두 `Authorization: Bearer <SERVICE_ADMIN_TOKEN>`(서비스 환경변수 `ADMIN_API_TOKEN` 같은 별도 값, 쿠키/`ADMIN_TOKEN`과 분리), JSON 응답, 쓰기는 분당 횟수 제한. 값은 응답·로그에 내지 않는다. **실제 추가는 나중에 앱 일감으로 따로 한다.**

1. `GET /api/admin/pipeline` → `{ auto: boolean, running: { kind, startedAt, by } | null, weekly: { weekday: 1, hour: 10 } }`
2. `POST /api/admin/pipeline/auto` `{ on: boolean }` → 위 상태
3. `POST /api/admin/pipeline/run` `{ kind: "request"|"draw"|"weekly", lines?: number }` → `202 { started: true }` / `409 { error: "busy" }`
4. `GET /api/admin/gen-log?limit=50&before=<id>` → `{ items: [{ id, at, step, cutId, ok, detail }] }` (`detail`은 프롬프트·키 없는 요약만)
5. `GET /api/admin/candidates?status=review|held|pending` → `{ items: [{ id, line, image, status, days }] }`, `POST /api/admin/cuts/:id/approve|reject|retry` → JSON 응답
6. `POST /api/admin/art-upload` — 스튜디오 [내보내기]의 '서비스 업로드'가 부르는 모양:
   요청 `{ items: [{ url, subject, kind, fileName }] }`(스튜디오가 승인한 그림의 주소, 서비스가 받아 가서 저장), 응답 `200 { saved: number, skipped: [{ fileName, reason }] }`. 이 API가 열리면 `lib/studio/service.ts` 의 `upload` 항목에 `api: { method: "POST", path: "/api/admin/art-upload", auth: "admin" }` 를 넣는 것만으로 연결된다.

API가 추가되면 `SERVICE_PROFILES`의 해당 항목 `api`를 채우고, 화면의 버튼·기록 표를 그 API에 연결한다.
