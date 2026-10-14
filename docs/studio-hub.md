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
- 정리(기존 통제실 스튜디오 기능 제거)는 3-4 에서 계획표로 정리했고(아래 「옛 스튜디오 정리 계획」), 이 초안은 그쪽 3-4 초안으로 이어 쓴다.

## [제작] 탭 (3-2)
- 화면: `components/studio/MakeTab.tsx`, 자료 읽기 `lib/studio/makeData.ts`, 순수 계산 `lib/studio/make.ts`. `/studio/<앱>?tab=make`.
- [생성]: `POST /api/studio/make`(관리자만) → 2-3 `enqueueToolJob`(출처 '스튜디오', `askLimit`). 일·월 비용 한도를 넘으면 409 + `needsConfirm`, 화면이 확인을 받고 `confirmed:true` 로 다시 보낸다(그 일감만 한도 검사를 건너뜀). 승인 규칙은 2-3 설정 그대로(자동 승인은 한도 안일 때만).
- 진행: 도구 일감 목록(대기·진행·완료·실패·확인 필요), 진행 중이면 감독의 마지막 로그 한 줄. `router.refresh()` 를 5초마다 불러 접근 키 사용자도 같은 방식으로 갱신한다.
- 미리보기: 정수배 확대(`pixelScale`)와 `image-rendering: pixelated`, 누르면 라이트박스. 그림마다 카드 이름·판 번호·참고 표시와 `[운영에서 검수]` 링크(`?tab=ops&sub=review&art=<id>`, 3-3에서 연결).
- [배치]: 프로젝트 연결 설정의 배치가 켜져 있을 때만 `sub=batch` 자리(3-4에서 채움).
- Studio 요청 API(regen·split/redraw)는 2-3에서 이미 카드 도구 일감 경로를 쓴다(확인만 함).

## [운영] 탭 (3-3)
- 화면: `components/studio/OpsTab.tsx`, 자료 읽기·쓰기 `lib/studio/opsData.ts`, 순수 계산 `lib/studio/ops.ts`, 서비스 확인표·호출기 `lib/studio/service.ts`, 행동 API `POST /api/studio/ops`(관리자만, 접근 키는 읽기 전용). `/studio/<앱>?tab=ops&sub=review|archive|schedule|service|export`. 하위 메뉴는 프로젝트 연결 설정의 기능 스위치를 따른다(생성 일정=배치, 서비스 운영=서비스 운영).
- **검수함**(`sub=review`): 그림 저장소 전체를 상태·카드·대상(별칭은 대표 이름으로 묶음)·종류로 거른다. 여러 장을 골라(한 번에 50장) 승인·반려·후보로 되돌림(통제실과 같은 `decideArt`), [다시 요청](같은 카드·같은 대상으로 묶어 도구 일감 등록, 비용 한도를 넘으면 409 → [그대로 진행]), [기본 그림으로](승인 그림 한 장 → 그 그림을 만든 카드의 `refRules.defaultArtId`, 카드 판 번호 +1). [제작] 탭의 `art=<id>` 링크는 그 그림을 미리 골라 연다.
- **보관함**(`sub=archive`): 승인 그림만 대상(별칭 포함)별. 그림을 누르면 사용 이력(어떤 카드 몇 판으로 만들었는지 → 승인자 → 내보낸 곳 → 참고 그림으로 고른 일감).
- **내보내기**(`sub=export`): 보낼 곳은 프로젝트 연결 설정(`exportKind`)을 따른다. `folder` = "이 그림 n장을 이 경로에 이 이름으로" 목록을 담은 앱 수정 일감(kind=revision) 하나를 등록한다(앱 폴더를 이 화면이 직접 고치지 않는다. 지시문: 그림 파일만 추가, e2e 스크린샷 없이 빌드만 검사). `upload` = 서비스의 업로드 API가 있으면 그 API, 없으면 '서비스 업로드 미지원'으로 기록(`docs/studio-service-api.md`). 내보낸 기록은 그림마다 `factory_art_exports` 에 남고, 앱 수정 일감이 끝나면 '보냄', 실패·취소면 '실패'로 보인다. 같은 그림·같은 경로는 다시 보내지 않는다.
- **서비스 운영**(`sub=service`, 서비스 운영이 켜진 프로젝트): 서비스 코드·문서를 읽어 만든 API 확인표(`SERVICE_PROFILES`)를 보여 주고, **있는 API만** 연결한다(지금은 한 컷의 `GET /api/review-status` 검수 대기 개수뿐). 없는 기능(생성 일정 켜기·끄기, 지금 실행, 생성 기록, 후보 승인, 업로드)은 '서비스에 API 없음'으로 표시하고 단추를 만들지 않는다. 한 컷 서버를 부를 때 쓰는 키는 서버 보관 키(`REVIEW_STATUS_TOKEN_<앱>`, 관리자 키는 `SERVICE_ADMIN_TOKEN_<앱>`)이고 없으면 '키 등록 필요'로 표시한다. 서비스 DB는 건드리지 않는다. 제안 API는 `docs/studio-service-api.md`.
- **생성 일정**(`sub=schedule`): 카드별 매일 한국 시간 N시에 대상·장 수로 도구 일감을 만든다. 기본 꺼짐. 하루 한 번(먼저 오늘 날짜를 찍고 일감을 만들어 동시에 불러도 한 번), 시각이 지난 뒤 늦게 확인돼도 같은 날 안에 만든다. 확인은 감독 프로그램이 일감을 물으러 올 때(`/api/factory/next`)와 관리자가 운영 탭을 열 때 1분에 한 번만 한다. 비용 한도를 넘는 날은 만들지 않고 이유를 남긴다(승인 규칙은 2-3 설정). 서비스 자체 일정(한 컷: 월 10시 주간 채우기)이 있는 프로젝트는 켤 때 항상 겹침 경고를 보인다(서비스 쪽 켜짐 여부를 읽을 API가 없다).
- DB: `factory_art_exports`(내보낸 기록), `factory_gen_schedules`(일정). 마이그레이션 `20261116090000_studio_ops`(새 표만, 기존 데이터 변경 없음).

## [배치] 편집기 (3-4)
공용 편집기다. 게임마다 다른 부분은 **프로젝트 연결 설정의 '배치 설정'**(통제실 [스튜디오] > 예전 방식 편집 > 결과물 카드 아래 '프로젝트 연결 설정' > '스튜디오 기능: 배치'를 켜면 나타남)에 둔다.
- 화면: `/studio/<앱>?tab=make&sub=batch` → `components/studio/LayoutEditor.tsx`. 규칙·형식 변환은 순수 파일 `lib/studio/layout.ts`, DB·내보내기는 `lib/studio/layoutData.ts`, 행동 API `POST /api/studio/layout`(관리자만. 접근 키 사용자는 보기만).
- 새싹 허브 조사 결과(읽기만 함): 저장 형식 `{ version:1, room:{cols:36,rows:36}, items:[{id, kind:"prop", name, x, y, flip, fixed}] }`, 칸 32px, 좌표는 그림 왼쪽 위 칸(월드 절대), 층 없음(장식 소품만), 게임은 `assets/layout/hub_layout.json` 을 읽고 app-kit `GET/PUT /p/hub/api/studio-layout`(사람 로그인 경로, `baseVersion` 충돌 검사, 20판 보관)가 Studio 작업본을 저장한다. 게임 규칙에 묶인 시설·길·도로는 놓을 수 없다(금지 구역은 게임 코드가 알고 있어 공용 편집기에는 없음 — 아래 '남은 것').

### 배치 설정 (`factory_app_connections.layoutConfig`)
| 칸 | 뜻 | 새싹 허브 값 |
|---|---|---|
| 칸 크기 / 가로·세로 칸 | 한 칸 픽셀, 맵 크기 | 32px / 36×36 |
| 맵 형태 | 네모 칸 · 쿼터뷰(보기 미리보기만) · 자유(0.25칸 단위) | 네모 칸 |
| 맵 배경 | 없음 · 색 · 그림 주소(https 또는 홈페이지 경로) | 색 |
| 층 목록 | `id:이름` 아래층부터 (바닥·시설·장식 …) | 바닥·시설·장식 |
| 놓을 수 있는 그림 종류 | 보관함 승인 그림의 결과 종류. 비면 모두 | `image-prop` |
| 내보내기 형식·스키마 이름·내보낼 층 | `studio-layout-v1`(공용, 층·회전·겹침 순서 전부) / `hub-layout-v1`(허브 게임 파일 모양) | `hub-layout-v1` · `hub_layout` · 장식 층만 |
| 내보낼 곳 | 앱 폴더 안 파일 경로 또는 서비스 API 경로 | 앱 폴더 `assets/layout/hub_layout.json` |
| 기존 배치 불러올 서비스 API | GET 경로 | `/p/hub/api/studio-layout` |
[새싹 허브 값 채우기] 단추가 위 값을 한 번에 채운다. 설정이 없으면 편집기는 '배치 설정이 아직 없어요'만 보인다.

### 편집·저장
- 놓기: 보관함 승인 그림을 끌어다 놓기(터치는 그림을 누른 뒤 맵을 누름), 또는 이름으로 놓기. 그림 크기÷칸 크기(올림)가 차지하는 칸 수.
- 칸 맞춤(끄면 0.25칸), 회전(90도씩), 뒤집기, 겹침 순서(맨 위·위로·아래로·맨 아래, 같은 층 안), 층 전환(옮겨 간 층의 맨 위), 잠금, 지우기, 되돌리기/다시(100단계), 방향키·R·Delete·Ctrl+Z. 같은 층에서 칸이 겹치면 빨간 테두리(막지는 않음).
- 저장할 때마다 `factory_layout_boards` 에 판이 쌓인다(판 번호 1부터, 같은 내용은 판을 올리지 않음, 다른 곳에서 먼저 저장했으면 409로 거절, 100판까지 보관). 옛 판으로 되돌리기는 새 판으로 저장한다(이력은 지우지 않음).

### 불러오기 · 내보내기 · 왕복
- 불러오기: 설정한 서비스 API(GET)에서 읽거나 JSON 을 붙여 넣어 **새 판**으로 저장한다(서비스 쪽은 읽기만). 허브 형식의 소품은 '장식' 층, `fixed`·`flip` 유지. 서비스 호출은 3-3 과 같은 안전 규칙(https만, 사설망 금지, 서버 보관 키 `SERVICE_ADMIN_TOKEN_<앱>`, 응답 96KB 제한).
- 내보내기: 설정한 형식으로 바꾼 뒤 3-3 과 같은 길로 보낸다. 앱 폴더면 **앱 수정 일감 1건**(파일 한 개를 이 내용으로 쓰기, 빌드/해당 시험만, e2e 없음), 서비스 API 면 `GET`(서비스 판 번호) 뒤 `PUT { layout, baseVersion }`. API 가 없으면 '서비스 API 미지원', 키가 없으면 '키 등록 필요: 이름'으로 판 이력에 남긴다. 형식에 못 담는 항목(한글 이름·소수 위치·회전)은 빼고 경고로 알린다.
- 왕복 시험(`tests/studio-layout.test.mjs`): 허브 배치 파일 → 공용 배치판 → hub 형식 내보내기가 app-kit 저장 입구(`cleanLayout`)가 받는 모양과 같고(멱등), 실제 `saessak-hub/assets/layout/hub_layout.json` 로도 같다.
- **실제 허브 서버에서 불러오기가 되려면**: app-kit 의 `/p/hub/api/studio-layout` 은 사람 로그인(`X-Appkit-Proxy`)만 받아서 홈페이지가 서비스 키(Bearer)로는 403 을 받는다. 지금은 JSON 붙여 넣기(허브 파일 내용)로 첫 판을 만든다. 기계용 읽기 경로가 필요하면 앱 일감 초안 ③을 쓴다.
- 마이그레이션 `20261117090000_studio_layout`: 열 하나(`layoutConfig`)와 새 표(`factory_layout_boards`)만 추가, 기존 데이터는 그대로.

### 남은 것
- 게임 규칙 금지 구역(길·도로·문 줄)과 게임 쪽 소품 이름 목록은 게임 코드가 알고 있어 공용 편집기에 없다. 허브는 내보낼 때 게임이 건너뛴 소품을 경고로 알린다. 필요하면 설정에 '금지 칸 목록'을 넣는 확장을 따로 한다.
- 쿼터뷰는 보기(미리보기)만 되고 그 상태에서는 끌기가 꺼진다.

## 옛 스튜디오 정리 계획 (3-4, 이번에는 지우지 않음)
### 정리표
| 옛 기능 | 옛 위치 | 새 스튜디오 | 상태 |
|---|---|---|---|
| 프로젝트 분류(게임/앱/미분류) · 스튜디오 바로가기(주소·이름) | 통제실 [스튜디오] 탭 | `/studio` 목록이 분류를 읽기만 함 | **남음**(편집은 통제실만) |
| 연결 도구 선택 | 통제실 [스튜디오] 탭 | 구성 탭 블록 그림(읽기), 카드가 도구를 정함 | 남음(옛 방식) |
| 결과물 카드 목록·편집 | 통제실 CardsPanel | 구성 탭 카드 만들기·고치기·끄기 | **옮김**(중복) |
| 프로젝트 연결 설정(내보낼 곳·기능 스위치·배치 설정) | 통제실 CardsPanel | 구성 탭은 읽기만 | **남음**(편집은 통제실만) |
| 프로젝트 도구 설정(별칭·비용 한도 등) | 통제실 ProjectToolSettingsCard | 제작·운영이 값을 읽어 씀 | **남음**(편집 화면 없음) |
| 승인 그림 참고 고르기 | 통제실 StudioArtsCard | [운영] 검수함·보관함, 카드 기본 그림 | 옮김(중복) |
| 앱 대기열 | 통제실 AppQueue | 통제실 [일감] 탭에 있음 | 중복(스튜디오 탭에서는 불필요) |
| 일감 보내기: 이미지 다시 만들기 | 통제실 SendJobCard → 옛 Studio 요청 | [제작] 카드 생성, [운영] 다시 요청 | 옮김 |
| 일감 보내기: 배치 적용 | 통제실 SendJobCard | [제작] > [배치] 내보내기(3-4) | **옮김** |
| 일감 보내기: 자유 지시 | 통제실 SendJobCard | 없음(통제실 [일감]/정비에서 가능) | 남음 |
| 소품 이미지 다시 요청(regen)·쪼개기(split) 요청 접수 | app-kit `studio-requests.ts`, 홈페이지 `lib/studio/requests.ts` | regen 은 카드 생성으로 대체. 쪼개기(split)는 없음 | regen 옮김 / **split 남음** |
| 배치 편집(36×36)·서버 저장(20판)·적용 기록 | app-kit `studio-layout.ts`, game-toolkit `layout.dart` | 공용 배치 편집기 + 판 이력 100판 | **옮김**(금지 구역 검사는 남음) |
| 접근 키 인증(`/studio` 열기) | 서버1 nginx `auth_request` + 홈페이지 키 검증 | `/studio/<앱>` 이 같은 키로 직접 인증(3-1) | 옮김 |
| 정적 Studio 서빙(`/p/<앱>/studio/`, 릴리스 폴더) | app-kit `studio.ts` | 없음(Flutter 빌드를 새 스튜디오가 대체하지 않음) | 남음 |
| 소품 값 수정(props.json)·점검 경고·크기 비교·이미지 시트 내보내기·메모 | saessak-hub Prop Studio(`lib/tool/…`, `deploy_studio.sh`) | 없음(허브 고유) | **남음**(새 스튜디오 범위 밖) |

### 이번에 한 것 / 하지 않은 것
- 한 것: 통제실 [스튜디오] 탭을 '새 스튜디오 바로가기 + 프로젝트 요약 표(분류·카드·검수 대기·최근 생성·새 스튜디오/옛 스튜디오 링크)'로 바꾸고, 새 스튜디오에 아직 없는 편집은 '예전 방식 편집'으로 접어 두었다(코드는 지우지 않음. 중복인 카드 목록·그림 카드·앱 대기열·배치 적용 보내기는 다음 정리에서 이 접힌 안에서 먼저 뺀다).
- 하지 않은 것: app-kit·saessak-hub·game-toolkit 코드, nginx, 서버 설정.

### 앱 일감으로 보낼 지시문 초안 (보내지 않음. 사람이 확인 뒤 등록)
① **app-kit (kind=revision, appSlug `app-kit`)** — "옛 Studio 정적 서빙·요청 접수 정리": `src/studio-requests.ts` 의 regen 접수는 새 스튜디오가 대신하므로 요청 종류에서 regen 을 deprecated 로 표시(삭제 X)하고 응답에 안내 문구를 넣는다. `src/studio.ts`(정적 서빙)와 `/p/:slug/api/studio-layout` 은 허브 Studio 가 쓰므로 **지우지 않는다**. 새 스튜디오 이전 완료(nginx 전환) 뒤에 별도 일감으로 `studio-layout` 읽기 전용화를 검토한다고 `docs/` 에 기록. 검사: 기존 단위·e2e 시험 통과.
② **saessak-hub (kind=revision, appSlug `saessak-hub`)** — "Prop Studio 안내 정리": `docs/studio-guide.md` 에 '배치·이미지 요청은 새 스튜디오(`/studio/saessak-hub`)에서 한다'를 적고, 값 수정·점검·시트 내보내기만 Prop Studio 에 남긴다. 코드(`lib/tool/…`)는 바꾸지 않는다. `assets/layout/hub_layout.json` 은 새 스튜디오 [배치] 내보내기 일감이 바꾸는 파일이므로 직접 고치지 않는다는 문구 추가.
③ **saessak-hub / app-kit (kind=revision)** — "배치 읽기 기계 경로": 홈페이지 서버가 서비스 키(Bearer)로 최신 배치를 읽을 수 있게 `GET /p/hub/api/machine/studio-layout`(읽기 전용, `SERVICE_ADMIN_TOKEN_SAESSAK_HUB` 해시 검사, 응답은 기존 `GET studio-layout` 과 같은 모양)을 app-kit 에 추가. 서비스 키는 서버 보관 키로 사람이 등록.
④ **game-toolkit (kind=revision)** — "Studio 배치 탭 안내": `studio_kit` 배치 탭 위에 '새 스튜디오에서 편집해요' 링크 한 줄만 추가(동작 변경 없음). 새 스튜디오가 금지 구역을 쓰려면 게임 코드의 `walkRects` 를 JSON 으로 내보내는 단계가 따로 필요하다고 `docs/studio-kit.md` 에 적는다.

### studio.buyoungsilcoding.com 을 새 `/studio` 로 옮기는 nginx 변경 초안 (적용은 사람)
이 PC 에서는 실제 nginx 설정을 읽을 수 없었다(`serverctl nginx-show` 를 정비 보호 훅이 막음). 아래는 3-1 초안을 허브가 쓰는 경로까지 살려 이어 쓴 것이다. **적용 전에 사람이 `serverctl nginx-show` 로 현재 `studio.buyoungsilcoding.com` 블록을 보고 아래와 맞는지 확인한다.**
1. 지금 이 도메인은 서버2 app-kit(허브 Studio 정적 화면 `/p/hub/studio/`, 요청/배치 API `/p/hub/api/…`)로 가고 있다. 전환 중에도 **`/p/` 는 app-kit 으로 계속 보낸다**(허브 Studio 가 쓰므로). 새로 `/studio` 만 홈페이지로 보낸다.
2. 초안(서버1 nginx, 기존 `listen`·인증서 줄은 그대로):
```nginx
server {
    listen 443 ssl;
    server_name studio.buyoungsilcoding.com;
    # ssl_certificate / ssl_certificate_key: 기존 블록 그대로

    location = / { return 302 /studio; }

    # 새 공용 스튜디오: 홈페이지가 직접 인증(관리자 쿠키는 이 도메인에서 이어지지 않으므로 접근 키 Basic 사용)
    location /studio {
        proxy_pass <홈페이지 내부 주소>;          # 현재 구성 http://127.0.0.1:5000
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ~ ^/(_next|api)/ {
        proxy_pass <홈페이지 내부 주소>;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 허브 Studio(Flutter)와 그 API 는 당분간 기존대로 app-kit(서버2)로: 기존 블록의 `location ^~ /p/` 계열을 그대로 둔다.
    # location ^~ /p/ { auth_request … ; proxy_pass <app-kit 주소>; … }   # ← 기존 설정 복사
}
```
3. 순서: ① 새 스튜디오를 홈페이지 도메인(`/studio`)에서 먼저 써 본다(관리자 로그인) → ② 접근 키로 `studio.buyoungsilcoding.com/studio` 가 열리는지 확인 → ③ 위 블록 적용(`serverctl nginx-apply FILE`: 검증·reload·헬스체크·자동 되돌림) → ④ 옛 주소(`/p/hub/studio/`)가 계속 열리는지 확인. 되돌리기는 `serverctl restore TIMESTAMP`.
4. 주의: `docs/studio-access.md` 의 `auth_request` 블록(`/studio/` 를 app-kit 앞에서 막던 것)과 `location /studio` 는 같은 서버 블록에 함께 둘 수 없다. 기존 `auth_request` 위치가 `/p/…/studio/` 로 바뀌어 있는지 `nginx-show` 로 먼저 확인한다. 로그인 쿠키는 홈페이지 도메인 것이라 이 도메인에서는 접근 키(Basic)로만 열린다.
