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

1. **서버 비밀값 등록(처음 한 번)**: 통제실 [설정] 탭 → '외부 서비스 키' 에 이름 `STUDIO_KEY_PEPPER`, 값은 32자 이상의 난수로 등록한다.
   이 이름은 작업 PC 로 보내지지 않고 홈페이지 서버에 암호화되어 보관된다(서버 환경변수 `STUDIO_KEY_PEPPER` 가 있으면 그것이 먼저 쓰인다).
   비밀값을 바꾸거나 지우면 이미 발급한 키는 모두 맞지 않게 되므로 다시 발급해야 한다.
2. **키 발급**: [설정] 탭 → 'Studio 접근 키' 카드에서 앱 이름(영어 소문자·숫자·하이픈 3~40자, 예: 새싹 허브라면 nginx 설정의 `X-Studio-App` 과 같은 이름)을 넣고 [키 발급].
   키는 **그 화면에서 한 번만** 보인다. [복사] 해서 비밀번호 관리자에 넣어 둔다.
3. **키를 잃어버렸을 때**: 같은 카드에서 그 앱의 [새로 발급]. 이전 키는 바로 무효다.
4. **키가 새었다고 의심될 때**: [폐기]. 그 앱은 새로 발급할 때까지 아무도 못 연다.

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
- 적용 순서: 통제실에서 비밀값 등록 → 키 발급 → nginx 조각 적용 → `nginx -t` → reload → 시크릿 창에서 `/studio/` 열어 키 입력 창이 뜨는지, 틀린 키는 다시 묻는지, 맞는 키는 열리는지 확인.
- 여러 게임: 게임마다 `location ^~ /studio-<게임>` 과 `location = /_studio_auth_<게임>` 을 따로 두고 `X-Studio-App` 만 바꾼다.

## 실패할 때의 동작

- 홈페이지가 멈추거나 DB 를 못 읽으면 검증 주소가 답하지 못하므로 nginx 는 `/studio/` 를 열지 않는다(안전한 쪽으로 실패).
- 집 안 주소(서버1 nginx 의 이 location 을 거치지 않는 내부 접속)는 이 장치의 영향을 받지 않는다.
- 막힘(429)은 홈페이지 프로세스 메모리에 있다. 홈페이지를 다시 시작하면 풀린다. 앱 전체로 실패가 10분에 30번을 넘으면 실패 응답을 1.5초씩 늦춘다.

## 관련 코드

- `lib/studio/access.ts` — 키 생성·해시·검증·실패 제한
- `app/api/studio-auth/verify/route.ts` — nginx 가 부르는 검증 주소(로그인 없이 열린 유일한 Studio 경로, `/api` 는 미들웨어 대상이 아님)
- `app/api/admin/factory/studio-keys/route.ts` — 통제실 발급·폐기·목록(관리자, 같은 사이트 요청만)
- `components/admin/factory/StudioAccessKeys.tsx` — 통제실 [설정] 탭 카드
- `prisma/migrations/20261024090000_add_studio_access_keys` — 표 추가
- 시험: `npm run test:studio-access`
