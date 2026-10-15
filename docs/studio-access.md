# Studio 접근 키

새싹 허브의 Prop Studio 같은 검토 도구(`/studio/`)를 집 밖에서도 열 수 있게 하되, 키가 있는 사람만 열게 하는 장치다.
키 발급·폐기는 통제실(관리자)에서만 하고, 서버1 nginx 는 요청마다 홈페이지에 "이 키가 맞나요?"만 물어본다.

이 문서에는 실제 키·비밀값·해시 예시를 적지 않는다.

## 구조

```
브라우저 ──(https, Authorization: Basic …)──▶ 서버1 nginx  location ^~ /studio
                                              │
                                              │ auth_request /_studio_auth  (요청마다, 본문 없이)
                                              ▼
                                   홈페이지 GET /api/studio-auth/verify
                                     X-Studio-App: <앱 이름>  ← nginx 가 고정값으로 넣음
                                     Authorization: Basic …   ← 브라우저 것을 그대로 전달
                                              │
                         204 = 통과 → nginx 가 /studio/ 내용을 돌려줌
                         401 = 키 없음/틀림/폐기/없는 앱(구별 안 함) → 브라우저가 키 입력 창
                         429 = 한 주소에서 10분에 10번 틀림 → 15분 막힘
```

- 키는 `Authorization: Basic` 의 **비밀번호 칸**이다. 아이디 칸은 무시하므로 아무거나 넣으면 된다. URL 쿼리로는 받지 않는다(주소 기록에 남으므로).
- 홈페이지는 키 원문을 저장하지 않는다. DB 표 `studio_access_keys` 에는 `HMAC-SHA256(서버 비밀값, 키)` 만 둔다.
- 앱 이름별로 유효한 키는 하나다. 새로 발급하면 같은 앱의 이전 키는 즉시 무효가 된다.
- 검증 응답은 모두 `Cache-Control: no-store` 다.

## 통제실에서 할 일

1. **키 발급**: [설정] 탭 → 'Studio 접근 키' 카드에서 앱 이름(영어 소문자·숫자·하이픈 3~40자, 예: 새싹 허브라면 nginx 설정의 `X-Studio-App` 과 같은 이름)을 넣고 **[키 발급]만 누르면 된다**.
   키는 **그 화면에서 한 번만** 보인다. [복사] 해서 비밀번호 관리자에 넣어 두고, Studio 입력 창의 비밀번호 칸에 넣는다.
2. **키를 잃어버렸을 때**: 같은 카드에서 그 앱의 [새로 발급]. 이전 키는 바로 무효다.
3. **키가 새었다고 의심될 때**: [폐기]. 그 앱은 새로 발급할 때까지 아무도 못 연다.

키 해시용 서버 비밀값은 따로 등록하지 않아도 된다. 정하는 순서:

- 서버 환경변수 또는 '외부 서비스 키'에 `STUDIO_KEY_PEPPER`(32자 이상)가 있으면 그것을 쓴다(예전 방식 그대로).
- 없으면 홈페이지가 이미 가진 로그인용 서버 시크릿에서 이 용도 전용 값을 HKDF-SHA256 으로 유도해 쓴다(원래 시크릿을 그대로 쓰지 않는다).
- 둘 다 없을 때만 카드에 "먼저 비밀값을 등록하세요" 가 뜨고 발급이 막힌다.
- 유도에 쓴 서버 시크릿이 바뀌면(또는 `STUDIO_KEY_PEPPER` 를 새로 넣거나 바꾸면) 이미 발급한 키는 모두 무효가 되므로 다시 발급해야 한다.

발급·폐기·거절은 홈페이지 로그에 `[studio]` 로 앱 이름·관리자·시각만 남는다(키·해시·헤더 값은 남기지 않는다).

## 서버1 nginx 설정 (사람이 직접 적용)

정비에서는 서버 설정을 고치지 않는다. 아래는 서버1에서 사람이 적용할 조각이다.
`<홈페이지 내부 주소>` 는 서버1 안에서 홈페이지 컨테이너로 가는 주소(지금 구성은 `http://127.0.0.1:5000`), `<앱 이름>` 은 통제실에서 발급한 앱 이름이다.

```nginx
# Studio 가 있는 server { } 블록 안
location ^~ /studio {
    auth_request /_studio_auth;

    # 401: auth_request 는 검증 주소의 WWW-Authenticate 를 그대로 브라우저에 넘긴다(그래서 키 입력 창이 뜬다).
    #      401 에 error_page 를 따로 걸면 이 헤더가 사라지므로, 걸어야 한다면 아래처럼 받아서 다시 붙인다.
    auth_request_set $studio_auth_www $upstream_http_www_authenticate;
    auth_request_set $studio_auth_status $upstream_status;

    # 429·503 등 2xx/401/403 이 아닌 답은 nginx 가 500 으로 바꾼다. 막힘(429)을 그대로 알려 주려면:
    error_page 500 = @studio_auth_error;

    # … 기존 Studio 설정(proxy_pass 또는 root) …
}

location = /_studio_auth {
    internal;
    proxy_pass <홈페이지 내부 주소>/api/studio-auth/verify;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Studio-App "<앱 이름>";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For "";   # 브라우저가 보낸 값을 넘기지 않는다(홈페이지가 연결 주소로 채움)
}

location @studio_auth_error {
    if ($studio_auth_status = 429) {
        return 429;
    }
    return 503;
}

# (선택) 401 에 직접 error_page 를 거는 경우에만:
# location @studio_401 {
#     add_header WWW-Authenticate $studio_auth_www always;
#     return 401;
# }
```

- 주소 판단: 홈페이지는 `X-Real-IP` 를 **연결 주소가 같은 PC·사설망(도커 브리지 포함)일 때만** 믿고, 아니면 연결 주소로 센다.
  그래서 `/_studio_auth` 에서 `X-Forwarded-For` 를 비워야 한다(비우지 않으면 브라우저가 보낸 값이 연결 주소처럼 보인다).
- 권장: 홈페이지의 공개 server 블록에서 `/api/studio-auth/` 를 막는다. nginx 의 `auth_request` 는 내부 주소로 바로 부르므로 영향이 없고,
  밖에서 이 주소를 직접 두드리며 `X-Real-IP` 를 꾸미는 길이 사라진다.
  ```nginx
  location ^~ /api/studio-auth/ { return 404; }
  ```
- 적용 순서: 통제실에서 키 발급 → nginx 조각 적용 → `nginx -t` → reload → 시크릿 창에서 `/studio/` 열어 키 입력 창이 뜨는지, 틀린 키는 다시 묻는지, 맞는 키는 열리는지 확인.
- 여러 게임: 게임마다 `location ^~ /studio-<게임>` 과 `location = /_studio_auth_<게임>` 을 따로 두고 `X-Studio-App` 만 바꾼다.

## Studio 요청 입구 (POST /api/studio-requests)

Studio 에서 소품을 눌러 "이상해요, 다시 요청"을 하거나 소품·책상 배치를 고쳐 "게임에 적용"을 누르면, 홈페이지가 **승인 대기** 앱 일감(kind=revision)을 만든다.
승인은 지금처럼 통제실에서 한다(**자동 승인 없음**). 새 비밀값은 필요 없고, 위의 Studio 접근 키(앱 이름 `studio`)로 인증한다.

- 호출하는 쪽: 브라우저가 아니라 **app-kit 서버**. 사용자의 `Authorization` 헤더를 그대로 전달한다. CORS 는 열지 않는다(OPTIONS 없음).
- 인증: `Authorization: Basic base64(아무이름:키)`. `/api/studio-auth/verify` 와 같은 검증(해시 비교, 한 주소 10분에 10번 틀리면 15분 429). 실패는 이유 구별 없이 401(`WWW-Authenticate` 없음). 성공하면 `lastUsedAt` 갱신.
- 모든 응답은 `Cache-Control: no-store`. 에러 본문은 한국어 한 줄이고 키·해시·스택이 없다.

요청 본문(JSON, 전체 64KB 이하):

```json
{
  "kind": "regen",
  "appSlug": "saessak-hub",
  "engine": "codex",
  "propName": "shelf_2",
  "note": "선반이 비스듬하게 나옴"
}
```

```json
{
  "kind": "layout",
  "appSlug": "saessak-hub",
  "layout": { "floor": { "w": 10, "h": 8 }, "props": [{ "name": "shelf_2", "x": 3, "y": 2 }] }
}
```

```json
{
  "kind": "split",
  "appSlug": "saessak-hub",
  "propName": "lounge",
  "parts": ["소파", "정수기", "러그", "탁자"],
  "method": "redraw",
  "engine": "codex",
  "note": "러그 위에 탁자가 있음"
}
```

| 값 | 규칙 |
| --- | --- |
| `kind` | `regen`(소품 다시 요청), `layout`(배치 적용), `split`(소품 쪼개기) |
| `appSlug` | 영문 소문자·숫자·하이픈 3~40자. 이미 완성(done)된 앱이어야 함 |
| `engine` | regen 일 때 필수, split 은 method=redraw 일 때만 필수(cut 이면 보내지 않는다): `codex` 또는 `pixellab` |
| `propName` | regen·split 일 때 필수: 영문·숫자·`_`·`-` 80자 이하 |
| `parts` | split 일 때 필수: 조각 이름 2~8개, 각 한글·영문·숫자·공백 1~20자, 중복 없음(백틱·줄바꿈·특수문자 400) |
| `method` | split 일 때 필수: `redraw`(조각마다 새로 그림) 또는 `cut`(기존 그림에서 잘라냄) |
| `note` | 선택, 500자 이하 |
| `layout` | layout 일 때 필수: 객체, JSON 40KB 이하, 중첩 12단계 이하 |

응답:

| 상태 | 뜻 | 본문 |
| --- | --- | --- |
| 201 | 승인 대기 일감을 만들었다 | `{"ok":true,"jobId":"…","status":"승인 대기"}` |
| 400 | 값 검사 실패(허용 목록 밖, 완성되지 않은 앱, layout 40KB 초과 등) | `{"ok":false,"error":"…"}` |
| 401 | 키 없음·틀림·폐기됨 | `{"ok":false,"error":"…"}` |
| 409 | 일감을 만들 수 없음(채팅의 enqueue_app_job 과 같은 등록 검사), 승인 대기 Studio 일감이 5개 이상, 승인 대기 일감이 너무 많음 | 같은 형식 |
| 413 | 본문이 64KB 초과 | 같은 형식 |
| 429 | 한 주소가 막힘(`Retry-After`), 또는 키당 분당 10건 초과 | 같은 형식 |

일감 내용(기획서는 서버가 템플릿으로 만든다. 보낸 값은 코드블록 안의 데이터로만 들어간다):

- `source`: "Studio 요청". 통제실 일감 목록의 '등록 경로'로 보인다. 제목: `<앱 이름> (Studio: 소품 다시 요청 <propName>)` `<앱 이름> (Studio: 배치 적용)`, 또는 `<앱 이름> (Studio: 소품 쪼개기 <propName>)`. 직전 완료 일감이 `parentJobId`.
- regen / codex: 해당 소품 그림을 Codex 로 다시 만들어 후보 풀(`assets/raw/...`)에 올리고 **기존 이미지는 교체하지 않는다**(사람이 고름). `aiEngine`=codex.
- regen / pixellab: PixelLab 은 공장 PC 에서 호출 가능한지 확인되지 않아, `tools/pixellab/manifest.json` 에 새 항목(`<propName>2` 식)만 추가하고 Mac 에서 실행할 명령 `python3 tools/pixellab/pixellab_gen.py run <이름> --push` 를 결과에 적게 한다(크레딧 상한 언급). `aiEngine`=claude.
- layout: 보낸 JSON 을 `assets/layout/hub_layout.json` 으로 저장하고 게임이 읽어 반영하게 한다. 파일이 없으면 코드 배치로 되돌아가는 폴백 유지, 겹침·바닥 밖 좌표 검사.
- split: 원본 소품 그림을 먼저 읽고 겹침을 설명한 뒤, 조각마다 투명 PNG 를 `assets/sprites/decor/<propName>_<번호>.png`(번호는 1부터, 조각 이름 순서)로 만들어 장식 소품 목록(`Sprites.decorNames` 등)에 등록하고 32px 타일 단위에 맞춘다. **원본 그림과 이를 쓰는 시설(휴게실 등)은 바꾸지 않는다**(시설을 조각으로 바꿀지는 사람이 정함). 결과에 조각별 미리보기 시트와 원본과의 크기·색 일치 여부를 적고, 채택하지 않은 후보는 `assets/raw/` 아래에 둔다.
  - redraw / codex: 조각마다 원본과 같은 화풍으로 새로 그린다. `aiEngine`=codex.
  - redraw / pixellab: 공장 PC 에서 부르지 않고 `tools/pixellab/manifest.json` 에 조각별 새 항목만 추가, Mac 에서 실행할 `python3 tools/pixellab/pixellab_gen.py run <이름들> --push` 와 크레딧(조각당 약 20 generations)을 결과에 적게 한다. `aiEngine`=claude.
  - cut: 기존 그림에서 `pixel-slice` 같은 기존 도구나 알파 마스크로 잘라낸다. 겹쳐서 깨끗하게 안 잘리는 조각은 억지로 자르지 않고 결과에 적어 그 조각만 redraw 를 권한다. `aiEngine`=claude.

남용 방지·감사:

- 키당 분당 10건, 같은 앱에 승인 대기 Studio 일감 5개 이상이면 409.
- 모든 인증된 요청은 `studio_request_logs` 표에 키 id·종류·앱·결과(created/invalid/conflict/rate_limited/error)·일감 id 만 남긴다. 키 원문·해시·본문은 저장하지 않는다.

## 실패할 때의 동작

- 홈페이지가 멈추거나 DB 를 못 읽으면 검증 주소가 답하지 못하므로 nginx 는 `/studio/` 를 열지 않는다(안전한 쪽으로 실패).
- 집 안 주소(서버1 nginx 의 이 location 을 거치지 않는 내부 접속)는 이 장치의 영향을 받지 않는다.
- 막힘(429)은 홈페이지 프로세스 메모리에 있다. 홈페이지를 다시 시작하면 풀린다. 앱 전체로 실패가 10분에 30번을 넘으면 실패 응답을 1.5초씩 늦춘다.

## 관련 코드

- `lib/studio/access.ts` — 키 생성·해시·검증·실패 제한
- `app/api/studio-requests/route.ts`, `lib/studio/requests.ts` — Studio 요청 입구(검사·기획서 템플릿·일감 만들기·감사 기록)
- `app/api/studio-auth/verify/route.ts` — nginx 가 부르는 검증 주소(로그인 없이 열린 Studio 경로(키 확인만), `/api` 는 미들웨어 대상이 아님)
- `app/api/admin/factory/studio-keys/route.ts` — 통제실 발급·폐기·목록(관리자, 같은 사이트 요청만)
- `components/admin/factory/StudioAccessKeys.tsx` — 통제실 [설정] 탭 카드
- `prisma/migrations/20261024090000_add_studio_access_keys` — 표 추가
- `prisma/migrations/20261031090000_add_studio_request_logs` — 요청 감사 표 추가
- 시험: `npm run test:studio-access`, `npm run test:studio-requests`

## 실제 구조(서버1, 2026-10-15 확인)

| 항목 | 위치 | 내용 |
| --- | --- | --- |
| Studio 사이트 파일 | 서버1 `/etc/nginx/sites-enabled/studio`(→ sites-available/studio) | `server_name studio.buyoungsilcoding.com`, 기본 사이트 파일(default)이 아니라 **따로 있는 파일** |
| `auth_request /_studio_auth;` | 같은 파일 `location / {` (67줄) | 통과하면 `proxy_pass http://192.168.0.46:5400`(서버2 app-kit) |
| `location = /_studio_auth` | 같은 파일 43줄 | `proxy_pass http://127.0.0.1:5000/api/studio-auth/verify` ← 블로그(5000) |
| 요청 빈도 제한 | 서버1 `/etc/nginx/conf.d/studio-ratelimit.conf` | `limit_req_zone` 만(proxy_pass 없음) |
| 서버2 | nginx 없음 | 컨테이너만(app-kit 5400 등) |

기본 사이트 파일(default)에는 `auth_request`·`_studio_auth` 가 없다. 5000 → 5100(factory-web) 바꾸기는
`serverctl nginx-set-directive proxy_pass http://127.0.0.1:5100/api/studio-auth/verify "= /_studio_auth" --file studio`
(백업 → nginx -t → reload → 헬스체크 → studio 주소가 5xx 가 아닌지 확인, 실패하면 되돌림). 위치 찾기는 `serverctl nginx-find 'auth_request|_studio_auth' --host serverpc`.
