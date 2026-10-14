# 공용 스튜디오 (/studio)

모든 프로젝트가 같이 쓰는 스튜디오. 홈페이지 안 `/studio`(프로젝트 목록)와 `/studio/<앱>`(프로젝트 화면)이다.
관리는 스튜디오에서, 실행과 키는 공장(통제실)에서 한다. **스튜디오 화면은 키 값을 읽지도 보여 주지도 않는다**(키 이름과 등록 여부만).

세 구역:

| 구역 | 내용 | 3-1 상태 |
| --- | --- | --- |
| 제작 | 카드를 골라 생성 | '준비 중' 자리 |
| 운영 | 검수 · 생성 일정 · 서비스 운영 · 내보내기 | '준비 중' 자리 (하위 메뉴만 있음) |
| 구성 | 도구 블록 연결, 카드 옵션, 키 상태, 대시보드 | 구현 |

## 접근

- 관리자 로그인: 모든 화면. 카드 만들기·고치기·끄기 가능.
- Studio 접근 키(`docs/studio-access.md`): **그 키가 발급된 앱의 `/studio/<앱>` 한 화면만**, **읽기 전용**. 키의 앱 이름 = 주소의 `<앱>`(영어 소문자·숫자·하이픈 3~40자)과 같아야 한다. `/studio` 목록은 관리자만.
- 그 밖(로그인 없음, 일반 회원, 틀린 키)은 모두 거부. 이유는 구별해서 알려 주지 않는다.
- 구현: `middleware.ts` → `lib/studio/gate.ts`(첫 관문, DB 없음: 관리자 통과 / `/studio` 는 관리자만 / `/studio/<앱>` 은 Authorization 헤더가 없으면 401 + 키 입력 창) →
  각 화면의 `lib/studio/pageAccess.ts`(관리자 세션 또는 DB 로 키 확인). 카드를 고치는 API(`/api/admin/factory/cards`)는 원래 관리자만이라 키로는 못 쓴다.
- 공개 사이트 네비바·푸터·채팅 버튼은 `/studio` 에서 숨긴다(`PublicChromeOnly`, `channelTalkManager`).

## 화면

### `/studio`
프로젝트 목록. 스튜디오 분류(게임 → 앱 → 미분류, 통제실 [스튜디오] 탭의 `studioProjects`)별로 묶고 프로젝트마다 보여 준다.
- 카드 수(켜짐 수), 검수 대기(후보 그림 수), 최근 생성(마지막 그림이 올라온 시각), 비용(최근 30일 PixelLab 호출 수).
- 도구·플랫폼으로 정한 앱(`appRoles`)은 목록에서 접고 이름만 보인다.

### `/studio/<앱>?tab=config|make|ops`
- 탭 [구성] [제작] [운영].
- [운영] 하위 메뉴는 프로젝트 연결 설정(`factory_app_connections`)의 스튜디오 기능에 따른다: `studioBatch` 꺼짐 → '생성 일정' 숨김, `studioService` 꺼짐 → '서비스 운영' 숨김. 기능 스위치는 통제실 카드 패널의 '프로젝트 연결 설정'에서 바꾼다.

### [구성]
1. **대시보드**: 카드 수, 경고, 키 상태, 검수 대기, 툴킷 판.
2. **도구 블록 연결**: 프로젝트 → 결과물 카드 → 도구 → 방법을 블록과 선으로 그린다.
   - 카드 블록: 판 번호, 경고 수, 꺼짐.
   - 도구 블록: 설명서 출처(`file`/`fallback`), 툴킷 판(보고된 커밋).
   - 방법 블록: 필요한 키가 등록됐는지(등록됨/없음 n개/필요 없음, 값 없이).
   - 블록을 누르면 오른쪽 패널(좁은 화면은 아래)에 상세: 카드 = 옵션·참고 규칙·이력, 도구 = 설명서 입력 항목과 한계, 방법 = 키 이름·등록 여부·한계·비용.
3. **카드 옵션**: 카드 만들기·고치기·끄기/켜기. 2-2 의 `/api/admin/factory/cards`(POST/PUT)를 그대로 쓰므로 설명서 한계 검사를 통과해야 저장되고 판 번호·이력이 남는다. 도구·방법을 고르면 입력칸이 설명서에서 생긴다. 기본 그림은 그림 저장소의 승인 그림 중에서 고른다. 설정 묶음(고급 JSON)은 여기서 안 다룬다(고칠 때 보내지 않아 유지됨. 고치려면 통제실 카드 패널).
4. **키 상태**: 카드가 쓰는 방법별 키 이름·등록 여부.
5. **사용량 요약**: 카드별 최근 30일 생성 수·승인 수·비용(그림 요약의 PixelLab 호출 수 합)·마지막 시각. 그림 저장소에 올라온 그림 기준이라 카드 없이 만든 그림은 세지 않는다.

### 구현 위치
- 계산(순수): `lib/studio/dashboard.ts` (탭·메뉴, 블록 배치 `buildBlockGraph`, 사용량 `summarizeUsage`)
- 읽기: `lib/studio/data.ts`
- 화면: `app/studio/**`, `components/studio/**` (선은 SVG 로 직접 그리고 블록은 HTML 버튼. React Flow 등 새 라이브러리는 쓰지 않음)
- 시험: `tests/studio-hub.test.mjs` (`npm run test:studio-hub`)

## 나중에 studio.buyoungsilcoding.com 을 옮길 때 (nginx 초안 — 사람이 적용)

지금 `studio.buyoungsilcoding.com` 은 서버2 app-kit 으로 연결돼 있다. 3-1 에서는 **건드리지 않았다**. 홈페이지의 `/studio` 로 옮길 때 서버1 nginx 에 쓸 블록 초안이다
(`<홈페이지 내부 주소>` 는 서버1 안에서 홈페이지 컨테이너로 가는 주소, 현재 구성은 `http://127.0.0.1:5000`. 인증서·`listen` 줄은 기존 설정을 그대로 가져온다).

```nginx
server {
    listen 443 ssl;
    server_name studio.buyoungsilcoding.com;
    # ssl_certificate / ssl_certificate_key 는 기존 studio 서버 블록의 것을 그대로

    # 첫 화면은 프로젝트 목록(관리자 로그인 필요)으로
    location = / {
        return 302 /studio;
    }

    # 홈페이지가 직접 인증한다(관리자 로그인 쿠키 또는 Authorization: Basic 접근 키).
    # 그래서 auth_request 는 쓰지 않는다. Authorization 헤더와 쿠키는 기본 설정 그대로 홈페이지에 전달된다.
    location /studio {
        proxy_pass <홈페이지 내부 주소>;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 화면이 쓰는 정적 파일과 API
    location ~ ^/(_next|api)/ {
        proxy_pass <홈페이지 내부 주소>;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

주의:
- 로그인 쿠키(`__Secure-authjs.session-token`)는 홈페이지 도메인 것이라, 다른 도메인(studio.…)에서는 로그인이 안 이어진다. 관리자 로그인으로 쓰려면 홈페이지 도메인의 `/studio` 를 쓰거나, 쿠키 도메인 설정을 따로 정해야 한다. 접근 키(Basic)는 도메인과 무관하다.
- 기존 `docs/studio-access.md` 의 `location ^~ /studio { auth_request … }`(app-kit 앞 인증)와 이 블록은 같은 서버 블록에 함께 둘 수 없다. 옮기는 순간 app-kit 쪽 `/studio` 주소가 바뀌므로 먼저 `studioUrl`(통제실 [스튜디오] 탭의 바로가기)을 점검한다.
- 정리(기존 통제실 스튜디오 기능 제거)는 3-4 에서 한다.
