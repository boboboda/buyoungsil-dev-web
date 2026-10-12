# 앱 공장 감독 프로그램

Claude Code / Codex 선택과 공통 터미널 사용법은 [통합 운영 문서](../../docs/ai-harness.md), 다음 Claude 세션에 전달할 내용은 [인계문](../../docs/CLAUDE_CODE_HANDOFF.md)을 보세요. 기존 일감은 계속 Claude Code로 실행됩니다.

내 PC에서 돌립니다. 홈페이지 통제실에서 **승인된** 지시를 가져와 앱 폴더를 만들고 Claude Code 로 앱을 만든 뒤, 진행 상황·스크린샷·결과를 홈페이지로 보고해요.
홈페이지로 나가는 요청만 있고, 홈페이지가 이 PC로 들어오는 일은 없어요.

## 준비물
- Node.js 18 이상 (`node -v`)
- Claude Code 설치 + 로그인 완료 (`claude --version`)
- git, 그리고 만들 앱 종류(stack)에 맞는 도구:

| stack | 필요한 것 | 비고 |
|---|---|---|
| flutter | Flutter SDK | 기본값 |
| kotlin-compose | JDK 17 이상, Android SDK | gradle 명령은 없어도 돼요(Claude 가 gradlew 를 만들어요) |
| swift-swiftui | (Windows 에서는 없음) | 코드와 XcodeGen `project.yml` 까지만. 빌드는 Mac 에서 |
| nextjs | Node.js, npm | |
| nestjs | Node.js, npm | |

종류별 작업 규칙은 `supervisor.mjs` 의 `stackRules()` 에 있어요. 서버의 `lib/factory/jobs.ts` `STACKS` 와 맞춰야 해요.

## 처음 한 번 (Git Bash)
```bash
# 1. 코드 받기 (이미 있으면 git pull)
git clone git@github.com:boboboda/buyoungsil-dev-web.git ~/dev/buyoungsil-dev-web
cd ~/dev/buyoungsil-dev-web/tools/factory-supervisor

# 2. 설정 만들기: 홈페이지 주소, 토큰(통제실 '작업 PC 연결'에서 발급), PC 이름을 물어봐요
node supervisor.mjs init

# 3. 연결 확인
node supervisor.mjs check
```
`check` 에서 `연결 OK` 가 나오면 통제실 '작업 PC 연결'에 **연결됨**으로 바뀌어요.

설정은 `~/dev/factory/supervisor.config.json` 에 저장돼요(토큰이 들어 있으니 git 에 올리지 마세요).

## 실행
```bash
node supervisor.mjs      # 끄려면 Ctrl+C
```
승인된 지시가 있으면 15초 안에 가져가서 `~/dev/factory/<앱이름>/` 에 앱을 만들어요. 동시에 2개까지 만들어요(설정 `slots`).

## 자동 업데이트 (`update.mjs`)
- 실행기 `~/dev/factory/run-supervisor.sh`(환경변수 `FACTORY_LAUNCHER=1`)로 돌 때만 켜져요. 실행기는 감독 프로그램이 끝나면 30초 뒤 다시 띄워요.
- 돌고 있는 일감이 0개일 때 10분마다 `git fetch origin main` 해서, 이 폴더 파일이 바뀐 새 커밋이 있으면 `git pull --ff-only` → `node --check` → 정상 종료(exit 0) → 실행기가 새 코드로 다시 띄워요.
- 건너뛰는 경우(로그만 남김): 작업 트리에 커밋 안 된 변경, main 이 아님, origin/main 과 갈라짐, 이 폴더 변경 없음, 전에 실패한 커밋.
- 문법 검사에 실패하거나 새 버전이 시작 후 30초 안에 꺼지면 이전 커밋으로 `git reset --hard` 하고, 그 커밋은 다시 받지 않아요.
- 상태 파일: `~/dev/factory/supervisor-update.json` (시험 중인 업데이트, 건너뛸 커밋 목록)
- 통제실에서 끄면 `/api/factory/next` 응답에 `autoUpdate: false` 가 와서 업데이트하지 않아요(필드가 없으면 켜짐).

## 감독 재시작 (`restart.mjs`, `/next` 의 `restart`)
- 통제실(/admin/factory) 감독 프로그램 상태 영역의 [🔄 감독 재시작], 또는 커넥터 `supervisor_control` 의 `action=restart`.
  홈페이지에 신호가 남고, 감독 프로그램이 다음 확인(15초 안) 때 `{ jobs: [], restart: true }` 로 받아 가요(그 응답에는 일감·신호를 싣지 않아요).
- 받으면 새 일감 받기를 멈추고 `/next` 에 `hold=1` 을 붙여요. 홈페이지는 hold 동안 일감·정비 지시·1회성 신호(지금 업데이트·업로드 시험·키 점검 등)를
  하나도 넘기지 않아요(유실 없음, 다시 켜진 뒤 받아 감). 진행 중인 앱 일감·정비가 끝나면 `~/dev/factory/supervisor-restart.json` 을 남기고 exit 0 →
  실행기(`run-supervisor.sh`)가 30초 뒤 다시 띄워요.
- 끄기 전에 점검: 실행기 안(`FACTORY_LAUNCHER=1`)인지, 실행기 표시 파일(`~/dev/factory/run-supervisor.pid`)이 있는지, 띄운 프로세스가 살아 있는지.
  하나라도 아니면 끄지 않고 이유를 `restartFail` 로 알려요(통제실 빨간 글씨·텔레그램).
- 실행기·작업 스케줄러는 로그온 때 PATH 를 쥐고 있으므로, 감독 프로그램이 시작할 때마다 레지스트리(HKLM 시스템·HKCU 사용자)의 Path 를 다시 읽어
  빠진 폴더를 PATH 뒤에 붙여요(`pcenv.mjs`). Claude·ffmpeg 같은 자식 프로세스도 이 PATH 를 물려받아요. 실행기 파일은 바꿀 필요 없어요.
- 다시 켜지면 `started`(시작 시각)·`boot=restart` 를 보내 통제실에 "시작 시각 … · 재시작됨"이 보이고 텔레그램으로 알려요.
  재시작 요청을 받아 간 뒤 3분 넘게 응답도 새 시작도 없으면 홈페이지가 실패로 표시하고 텔레그램으로 한 번 알려요(통제실·커넥터 상태를 볼 때 판단).
- 시험용 환경변수: `FACTORY_RESTART_STATE`(표시 파일), `FACTORY_LAUNCHER_LOCK`(실행기 표시 파일).

## ffmpeg·ffprobe 찾기 (`pcenv.mjs`)
- 찾는 순서: ① 프로세스 PATH(`where`) ② 레지스트리 사용자/시스템 Path ③ `%LOCALAPPDATA%\Microsoft\WinGet\Links`
  ④ `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin`(이름이 큰 버전 먼저) ⑤ `%USERPROFILE%\tools\ffmpeg\bin`
- 찾으면 그 경로를 이후 호출에 계속 쓰고, PATH 에 없던 폴더면 PATH 에도 붙여요. 못 찾으면 1분 뒤 다시 찾아요(그 사이 설치했을 수 있음).
- 업로드 시험 영상, 검토 영상 줄이기, 스토어 자료 지시문의 PC 환경이 모두 이 결과를 써요.
- 통제실 감독 프로그램 상태와 `supervisor_control` status 에 "버전 | 경로"(없으면 "없음")가 보여요(`/next` 의 `ffmpeg`·`ffprobe`).

## 출시 준비 일감 (`release.mjs`)
- 통제실 "출시 패키지"에서 보내는 `kind=release` 일감이에요. 완성된 앱 폴더에서 `RELEASE_REQUEST.md` 를 보고 출시 자료를 만들어요.
- Claude 는 결과를 `.factory/outbox/project.json`(홈페이지 프로젝트 빈 항목), `.factory/outbox/release.json`(스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·방침 초안·AAB 정보)에 저장해요.
- 일감이 끝나면 감독 프로그램이 이 두 파일만 정해진 주소(`/api/factory/project`, `/api/factory/release`)로 보내고 `outbox/sent/` 로 옮겨요. 다른 파일·주소는 없어요.
- AAB 는 PC 에만 두고, 경로·크기·버전·빌드 시각만 보내요(크기·시각은 감독 프로그램이 실제 파일로 채움).
- 배포 계정의 키 파일 경로가 통제실에 등록돼 있으면, 감독 프로그램이 그 파일이 "있는지"만 확인해 알려요(내용은 읽지 않음, .jks/.keystore/.json 만).
- 서명 비밀번호는 `secrets.env` 의 `RELEASE_<계정>_KEYSTORE_PASSWORD`, `RELEASE_<계정>_KEY_PASSWORD` 에 넣어요.
- 출시 일감 종류(`job.release.kind`): `first`(첫 출시) / `store`(스토어 자료 수정, release.json·project.json) / `project`(프로젝트 업데이트, project.json 만). 종류마다 보낼 수 있는 outbox 파일을 서버가 정해 줘요.
- 업로드 키(첫 출시만): 앱 폴더에 `android/key.properties`(또는 `key.properties`)가 있으면 그대로 쓰고 건드리지 않아요. 없으면 앱별 다른 키 또는 배포 계정 공용 키를
  `FACTORY_KEYSTORE_PATH`·`FACTORY_KEY_ALIAS`·`FACTORY_KEYSTORE_PASSWORD`·`FACTORY_KEY_PASSWORD` 환경변수로 Claude 에 넘겨요. 공용 키 파일이 없을 때만 keytool 로 한 번 만들고, 있으면 절대 덮어쓰지 않아요.
- 키 비밀번호: 통제실에서 입력하면 서버가 암호화해 잠깐 보관 → `/next` 의 `keyPasswordsPending` 을 보고 `/api/factory/key-passwords` 에서 받아 `secrets.env` 에
  `RELEASE_KEY_<구분값>_STORE_PASSWORD`/`_KEY_PASSWORD` 로 저장 → 저장했다고 알리면 서버 값은 지워져요. 값은 로그에 남기지 않아요.
- 진행 단계는 `.factory/phase.txt`(key, build, sign, store, upload, homepage), 실패는 Claude 가 `.factory/fail.json`({stage, reason})으로 알려요. outbox 가 거절되면 `homepage` 단계 실패.
  재시도(`job.release.resumeFrom`)가 `homepage` 면 Claude 없이 남은 outbox 만 다시 보내요. 로그·실패 이유의 비밀번호는 가려요(`maskText`).
- 키 보관함(`keyvault.mjs`, `/next` 의 `keyTasks`): 결과는 `/api/factory/key-vault` 로 보내요.
  - `check`: 지정한 키 파일 하나를 직접 확인(확장자 없어도 됨, 1MB 이하 일반 파일만, 심볼릭 링크는 따라가지 않음). 형식·별칭·SHA-1(JKS 는 비밀번호 없이),
    secrets.env 에 비밀번호가 있으면 keytool 로 비밀번호·별칭 확인(PKCS12 는 이때만 지문, 없으면 형식만). 작업 폴더의 앱 폴더 안이고 git 추적 중이면 경고.
  - `create`: [새 공용 키 만들기]. keytool 로 JKS·RSA 2048·10000일. 경로에 무엇이든 있으면 덮어쓰지 않고 '이미 있어요'. 비밀번호가 아직 없으면 `pending`.
  - `untrack`: [커밋에서 빼기]. 그 앱 폴더 git 에서 기록 조사(커밋 해시 7자리·날짜·메시지, 원격·브랜치 이름) → `git rm --cached` →
    `.gitignore` 보강(*.jks·*.keystore·*.p12·*.pfx·그 파일) → 임시 인덱스로 그 두 경로만 로컬 커밋(다른 스테이징은 섞지 않음) → 다시 조회.
    파일은 읽거나 지우거나 옮기지 않고, push·기록 삭제는 하지 않아요.
  - 출시 일감은 키를 만들지 않아요(`job.release.key.generate` 가 false 면 파일이 없을 때 `missingMessage` 로 키 단계 실패).
- 키 파일 커밋 막기(`keyguard.mjs`): 일감마다 앱 폴더 `.gitignore` 에 `*.jks`·`*.keystore`·`*.p12`·`*.pfx`·`key.properties`·`secrets.env` 가 없으면 덧붙이고,
  앱 폴더를 커밋하기 전에 들어갈 파일 중 키 파일(이름 패턴, 확장자 없는 파일은 머리가 JKS/JCEKS/PKCS12)이 있으면 커밋을 멈추고 결과에 상대 경로만 알려요.
- 키 파일 후보 찾기(보조, `/next` 의 `keyScan` + `keyScanApps`): 그 앱 폴더에서 .jks·.keystore·.p12 와 확장자 없는 JKS(2KB~100KB, 매직 0xFEEDFEED),
  key.properties 를 찾아 경로(`abs` 포함)·별칭·SHA-1·git 추적 여부만 `/api/factory/key-report` 로 보내요(폴더가 없으면 `missing: true`).
- 스토어 자료 수정·프로젝트 업데이트의 갱신 항목(`job.release.items`): 고른 항목의 단계만 검사하고, Play 에도 고른 것만 올려요(문구를 안 고르면 제목·설명 그대로, 영상 링크만이면 등록정보 PATCH 로 영상만, 이미지를 안 고르면 이미지 그대로). `items` 가 없으면 예전 일감이라 예전처럼 전부.

## 출시 검토 대기·앱 업데이트 (`job.release.review`, 출시 3단계)
- 첫 출시·스토어 수정(`review.required`)은 자료를 만든 뒤 검사하고, 검토에 필요한 것만 올린 뒤 `status: "review"` 로 보고해요(작업 PC 는 놓아줌):
  스토어 이미지(검토 화면용), 스토어 자료 결과, `release.json`(+ project.json 의 방침을 `privacyPolicyDraft` 로), 검토 영상(`/api/factory/store-video`, mp4 원본 바이트를 흘려 보냄 →
  홈페이지가 이미지와 같은 업로드 서버 `/upload/single` 에 전달. 120MB 가 넘으면 ffmpeg 로 줄인 `review-preview.mp4`, ffmpeg 가 없거나 그래도 크면 'PC 에서 직접 확인'.
  업로드 서버에 삭제 API 가 없어 검토 영상은 서버에 남아요(주소를 아는 사람만 접근). 홈페이지가 아직 store-video 를 모르면 예전 방식 `/api/factory/review-video`(8MB 조각, 50MB)).
  project.json 은 보내지 않고 PC 에 둬요.
- `review.approved` 가 true 일 때만 반영 단계(Play 업로드·홈페이지·완료)를 해요. 서버가 upload 부터라고 줘도 승인 전이면 검토 대기로만 보내요.
- `review.redoNote`(다시 만들기 메모)는 RELEASE_REQUEST.md 끝에 붙여 그 항목만 다시 만들어요(.factory/store/status.json 은 남김).
- 검토가 있는 첫 출시는 Play 에 올리지 않아요(최초 AAB 는 사람이 Console 에). 승인 뒤 홈페이지 빈 칸 채우기와 AAB 위치 안내.
- 홍보 영상: 갱신 항목 `video`(홍보 영상 만들기)는 mp4 만 만들고 Play 영상은 건드리지 않아요. 서버가 `videoLinkWait: true` 를 주면 반영 뒤 완료 대신
  `status: "linkwait"`(영상 링크 대기)로 보고해요. 사람이 링크를 넣으면 `resumeFrom: "videolink"` 로 다시 와서 Play 등록정보 영상만 PATCH 하고 완료(문구·이미지·홈페이지는 그대로).
  `videoLink`(홍보 영상 링크만 반영)는 Claude·검토 없이 upload 부터 영상만 반영해요. 예전 서버(`videoLinkWait` 없음)에서는 `video` 가 예전 뜻(저장된 링크 반영)이에요.
- 앱 업데이트(`kind: "update"`): 키 준비 → Claude 가 코드 수정·시험·버전·서명 AAB → AAB 를 비공개 테스트 트랙에(출시 노트 포함) → `build` 결과 보고.
  홈페이지 반영(`overwriteProject`)을 고르지 않았으면 project.json 을 보내지 않아요.

## 업로드 시험 (`uploadtest.mjs`, `/next` 의 `uploadTest`)
- 통제실 [영상/이미지/큰 파일 시험]을 누르면 `uploadTest: { id, kind }` 가 한 번 와요. 운영과 같은 함수(`store.mjs` 의 `postVideoFile`·`postImageFile`)로
  `/api/factory/upload-test` 에 올리고(홈페이지가 store-video·store-image 와 같은 코드로 업로드 서버에 전달), 결과를 `/api/factory/upload-test-report` 로 보내요.
- 영상: ffmpeg 가 있으면 2초 색 막대 영상, 없으면 mp4 머리만 맞는 1MB 합성 파일. 이미지: 64x64 PNG. 큰 파일: 10·50·120MB 합성 mp4, 처음 실패에서 멈춤.
- 실패 구간: 홈페이지가 `stage`(receive·upstream)를 주면 그대로, 아니면(nginx 등 홈페이지 앞) `pc`. 시험 파일은 PC 임시 폴더에서 지워요(업로드 서버에는 남음).

## 스토어 자료·Play 업로드 (`store.mjs`, 출시 2단계)
- 서버가 `job.release.play`({packageName, serviceAccountKeyPath, track, videoUrl, missing})를 줄 때만 동작해요(예전 서버의 일감이면 예전처럼 outbox 만).
- 스토어 자료 수정(`store`): Claude 가 앱 폴더 `.factory/store/` 에 `icon-512.png`, `feature-1024x500.png`, `screenshots/phone-01..08.png|jpg`, `promo.mp4`(HyperFrames),
  `listing.json`, `status.json`(건너뜀 이유·확인한 도구)을 만들어요. 지시문 끝에 이 PC 환경(Android SDK·emulator·adb·AVD·Node·ffmpeg·Chrome)을 붙여 줘요.
- 끝나면 감독 프로그램이 검사해요(크기·비율·알파·용량·글자 수, 영상은 mp4 길이만). 단계: 아이콘·대표 이미지(icon) / 스크린샷(screenshots) / 영상(video) / 문구(listing) / 업로드(upload) / 홈페이지 반영(homepage).
  스크린샷이 없으면 '스크린샷 단계 건너뜀 - 직접 올려야 함', 영상이 없으면 '영상 단계 건너뜀'(실패 아님).
- 홈페이지로는 고정 칸 이미지만 `/api/factory/store-image`(icon, feature, phone-01..08, png/jpg)로, 검사 결과는 `/api/factory/store-assets` 로 보내요. 영상 원본은 보내지 않아요(경로·크기·길이만. 검토 단계가 있으면 검토용 사본만 위처럼).
- Play Developer API: 서비스 계정 JSON 으로 토큰(JWT) → edits 열기 → 언어별 등록정보(제목·짧은/긴 설명·영상 링크) → 이미지 종류별 통째 교체(deleteall → upload) → 커밋.
  커밋은 `changesInReviewBehavior=ERROR_IF_IN_REVIEW`(진행 중인 검토를 취소하지 않음). "자동으로 검토에 보낼 수 없음"이면 `changesNotSentForReview=true` 로 다시 커밋하고 Console 에서 검토 보내기를 하라고 알려요.
- 첫 출시(`first`): 최초 업로드를 마친 앱이면 outbox release.json 의 서명 AAB 를 비공개 테스트 트랙(`alpha`)에 올려요(초안 앱이면 draft). 프로덕션 트랙은 건드리지 않아요.
- 업로드 조건(서비스 계정 키 파일, 패키지 이름, 최초 AAB 업로드 완료)이 모자라면 업로드는 건너뛰고 모자란 것을 알려요. 업로드 거절 이유(버전 코드 중복 등)는 한국어로 바꿔 '업로드' 단계 실패로 알려요.
  재시도가 `upload` 면 Claude 없이 업로드부터 다시 해요. 서비스 계정 키 내용·토큰은 어디에도 쓰지 않아요.
- 시험용: `FACTORY_PLAY_API_BASE` 환경변수로 API 주소를 바꿀 수 있어요(토큰 주소는 서비스 계정 JSON 의 token_uri).

## 시험용 APK (`apk.mjs`, 출시 일감 종류 `apk`)
- 통제실 출시 패키지 카드의 '시험용 APK' 에서 요청해요. 키 준비는 첫 출시와 같아요(앱 자체 key.properties 우선, 없으면 보관함 키를 `FACTORY_KEYSTORE_*` 환경변수로). 키는 만들지 않아요.
- AI 가 `flutter build apk --release` 로 만들고 `.factory/apk.json`({path, versionName, versionCode})을 남기면, 감독 프로그램이:
  경로 확인(앱 폴더 안의 .apk, 200MB 이하) → `apksigner verify --print-certs`(build-tools 의 apksigner.jar 를 Java 로) → 디버그 키 거절 →
  등록된 키(JKS 는 비밀번호 없이, PKCS12 는 keytool 에 비밀번호를 환경변수로)와 서명 인증서 SHA-256 비교 → 앱 폴더 커밋 →
  `/api/factory/test-apk` 로 정보(크기·SHA-256·버전·빌드 시각·커밋·서명 지문)를 보내고 홈페이지가 정한 크기(`TEST_APK_CHUNK`, 기본 512KB — nginx `location /` 기본 본문 한도 1MB 아래)의 조각으로 올려요(홈페이지가 크기·SHA-256 다시 확인). 거절되면 상태 코드·조각 크기·응답 본문(nginx 413 HTML 포함)을 실패 사유에 남겨요.
- 단계: key → build → sign(apksigner 확인) → upload. 재시도가 `upload` 면 AI 없이 확인·업로드만 다시 해요. Play 는 건드리지 않아요.
- 홈페이지는 APK 를 DB 에 두고 관리자만 내려받게 해요(앱당 최근 5개). 키 파일·비밀번호는 보내지 않아요.

## 공장 정비 (`maintenance.mjs`)
- 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드예요. 앱 일감과 따로 돌아요(통제실 감독 프로그램 카드, 커넥터 `maintenance_*`).
- 정비 지시가 대기·진행 중이면 서버가 새 앱 일감을 내주지 않고, 감독 프로그램은 돌던 앱 일감이 끝나면 정비를 시작해요.
- 정비 전용 체크아웃 `~/dev/factory/selfdev`(설정 `selfdevDir`)에서 Claude 를 돌려요. 같은 정비의 이어지는 지시는 같은 세션(`--resume`).
  규칙은 `CLAUDE.local.md`(커밋되지 않게 `.git/info/exclude`)에 써요. Claude 는 커밋만 하고 push·배포는 하지 않아요.
- 감독 프로그램이 검사(감독 프로그램 `node --check`, `tsc --noEmit` 오류 0개)를 통과했을 때만 GitHub main 에 올려요. 못 통과하면 커밋은 정비 폴더에 남고 다음 지시에서 이어 해요.
  (대기열 서버에서는 같은 정비 대화가 이어갈 때만. 다른 대화의 지시면 남은 커밋을 `factory-unpushed/<지시 id>` 브랜치로 옮기고 GitHub main 최신에서 시작해요. 어느 대화 것인지는 `.git/factory-unpushed.json`)
- 대기열: 처리 중이어도 지시는 쌓이고, 서버가 보낸 순서대로 한 번에 하나씩 줘요(맨 앞이 승인 대기면 뒤도 기다림). 앞 지시가 실패하면 대기열이 멈추고 사람이 [계속 진행]·[재시도]·[대기열 비우기]를 골라요.
- 서버 코드가 바뀌었으면 "배포 필요". 대기열이 다 끝난 뒤 한 번 안내하고(급하면 통제실 [지금 배포]), 사람이 통제실·텔레그램에서 [배포]를 누르면 가장 최근 정비 커밋(GitHub main 에 있는 것만)을 `deployRemote`(기본 `serverpc:git-server/repo/developWeb.git`)로 push 해요. 서버는 커밋 해시만 보내요. 설정에서 "대기열 끝나면 자동 배포"를 켤 수 있어요(기본 꺼짐).
- 서버가 `maintenance.deployBundling` 을 보내지 않으면(예전 서버) 예전 방식 그대로 해요.

## 작업 후 컨텍스트 정리 (`compact.mjs`)
- 일감·정비가 성공으로 끝나면(검증·커밋·push 뒤, 완료 보고 전) 감독 프로그램이 이어 쓸 Claude 세션에 `claude -p --resume <세션>` 으로 `/compact` 를 걸어 맥락을 요약해요. 정비는 완료 보고 전에 끝나므로 다음 지시보다 먼저 끝나요.
- Claude 세션만, 다시 이어 쓸 세션만(정비 대화, 이전 세션을 이어받은 일감). 지금 앱 일감은 새 세션으로 시작해서 건너뛰어요. 실패한 작업·Codex 는 건드리지 않아요.
- 2분 안에 안 끝나거나 실패해도 작업은 실패가 아니에요. 일감 로그·정비 결과에 "컨텍스트 정리(/compact) 완료" 또는 "컨텍스트 정리 건너뜀: 사유" 한 줄만 남겨요.
- 끄기: 통제실 감독 프로그램 카드의 "작업 후 컨텍스트 정리"(FactorySetting `compactAfterJob`, 기본 켜짐) 또는 PC 환경변수 `FACTORY_COMPACT_AFTER_JOB=0`.

## 서버 설정 도구 (`serverctl.mjs`, 공장 정비 전용)
- 정비 Claude 는 서버 설정(nginx, 서버 `.env.local`, 재빌드)을 이 도구로만 바꿔요. ssh·scp·docker·sudo·nginx·systemctl 직접 호출, `~/.ssh` 읽기, 실행 폴더 수정은 `--settings` 권한 규칙으로 막혀 있어요.
- 정비 Claude 는 실행 폴더(`supervisor-src`)의 사본만 써요(정비 폴더 사본은 Claude 가 고칠 수 있어서).
- 서브커맨드: `env-keys`, `env-set KEY`(값은 `SERVERCTL_VALUE` 나 stdin 으로만), `env-unset KEY`, `nginx-show`, `nginx-set-directive NAME VALUE [LOCATION]`(허용 지시어만), `nginx-apply FILE`, `rebuild`, `restore TIMESTAMP`, `backups`.
- 바꾸기 전 백업(`~/env-backups/developWeb`, `~/nginx-backups`, 600/700, 최근 20개, 작업 폴더 밖) → nginx 는 `nginx -t` 통과 시에만 reload, 헬스체크 실패 시 자동 복원 / `.env` 는 rebuild 전 이미지 `rollback-<시각>` 태그, 실패 시 `.env` 백업·이미지로 되돌림.
- 값은 어디에도 출력하지 않아요. 바꿀 때마다 정비 대화와 텔레그램에 무엇을·백업·검증 결과가 남아요.

## 실행 전용 체크아웃
- 실행기는 `~/dev/factory/supervisor-src/tools/factory-supervisor` 에서 돌려요(GitHub main 의 별도 clone). 자동 업데이트만 여기를 pull 해요.
- 개발은 `~/dev/buyoungsil-dev-web` 에서 하고 GitHub 에 push 하면 감독 프로그램이 받아 가요(두 폴더가 섞이지 않게).
- Windows 작업 스케줄러 `AppFactorySupervisor` 가 로그온 때 실행기를 창 없이 띄워요(`conhost --headless`). 실행기는 하나만 돌아요(`~/dev/factory/run-supervisor.pid`).

## 외부 서비스 키
`~/dev/factory/secrets.env` 에 한 줄에 하나씩 적어요. 이 파일은 이 PC에만 있고 홈페이지로 보내지 않아요.
```
PIXELLAB_TOKEN=여기에값
```
기획서에 필요한 키 이름이 적힌 지시만, 그 키만 Claude 에게 환경변수로 넘겨요. 로그와 결과 요약에 키 값이 나오면 `***` 로 가려요. 키 파일에 없으면 시작하지 않고 실패로 알려 줘요.

통제실 설정의 **외부 서비스 키(환경변수)** 에서도 넣고·바꾸고·지울 수 있어요(`secrets.mjs`). 서버가 암호화해 잠깐 보관 → `/next` 의 `secretsPending` 을 보고
`/api/factory/secrets` 에서 받아 `secrets.env` 의 그 이름 줄만 추가·교체·삭제(다른 줄·주석은 그대로, 바꾸기 전 `secrets.env.bak` 하나, 임시 파일 → 이름 바꾸기) →
다 쓴 뒤에만 확인(ack)해서 서버 값을 지워요. 쓰기에 실패하면 확인하지 않아 다음에 다시 해요. 로그에는 이름과 이유만 남겨요.
반영 뒤와 1시간마다 `secrets.env` 의 **이름만**(값 없음, `RELEASE_`·`FACTORY_` 등 예약 이름 제외) 서버에 알려 통제실 상태와 `list_secret_names` 에 써요.
같은 영역의 AI 도구 상태는 1시간마다 `claude --version`·`claude auth status --json`(loggedIn 만)·`codex --version`·`codex login status`(종료 코드만) 결과로 만들어요. 자격 파일은 읽지 않아요.

## 앱 폴더 안에서 일어나는 일
- `PLAN.md`(새 앱) 또는 `CHANGE_REQUEST.md`(수정)와 `CLAUDE.md`(작업 규칙)를 만들어 Claude 에게 읽혀요.
- Claude 가 `.factory/phase.txt` 에 단계(scaffold, code, build, screenshots, done)를 쓰면 통제실에 단계로 보여요.
- Claude 가 `.factory/screenshots/` 에 png 를 저장하면 자동으로 올려요.
- 끝나면 앱 폴더에 git 커밋을 남겨요. 수정 지시는 시작 전에 현재 상태를 먼저 커밋해 둬요.
- **외부 저장소**(앱 폴더에 `.factory/external` 이 있거나 `prod` 원격이 있음: 원래 있던 저장소를 가져와 고치는 경우)는 감독 프로그램이 커밋하지 않아요.
  공장 파일(`PLAN.md`, `CHANGE_REQUEST.md`, `RELEASE_REQUEST.md`, `.factory/`, 작업 규칙)은 `.git/info/exclude` 로만 빼고 `.gitignore` 도 건드리지 않아요.
  작업 규칙은 저장소에 `CLAUDE.md` 가 있으면 `CLAUDE.local.md` 에 써요. 코드 커밋은 일감 Claude 가 직접 해서, 배포 브랜치에 공장 문서 커밋이 섞이지 않아요.
- 정비 지시나 정비 배포가 도는 동안에는 새 앱 일감을 받지 않아요(`/next?slots=0`: 신호만 받음). 정비는 돌던 앱 일감이 다 끝난 뒤 시작해요.
- 앱 일감 Claude 는 `~/dev/factory/app-claude-settings.json` 으로 정비 폴더(`selfdev`, `supervisor-src`)와 공장 설정·비밀 파일을 고치거나 읽지 못하게 막아요(파일 도구 기준).

## 설정 값 (`supervisor.config.json`)
| 이름 | 기본값 | 뜻 |
|---|---|---|
| slots | 2 | 동시에 만들 앱 수 (1~4) |
| pollSec | 15 | 대기열 확인 간격(초) |
| jobTimeoutMin | 120 | 앱 하나에 쓸 수 있는 최대 시간(분). 넘기면 실패 처리 |
| permissionMode | acceptEdits | Claude Code 권한 모드 |
| allowedTools | Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch | 사람 확인 없이 쓰게 허용할 도구 |
| model | (비어 있음) | 쓸 모델. 비우면 Claude Code 기본값 |

## 알아둘 것
- 로그인 없이 도는 무인 실행이라 Bash 를 허용해 둬요. 이 PC의 앱 폴더 밖 파일도 이론상 건드릴 수 있으니, 기획서는 내가 확인하고 승인한 것만 돌려요(통제실 승인이 안전장치).
- 감독 프로그램을 끄면 돌던 작업은 멈추고, 서버가 10분 안에 대기열로 되돌려요(시도 횟수가 남았을 때).
- 통제실에서 취소하면 다음 보고(최대 20초) 때 알아채고 바로 멈춰요.
- 토큰 사용량을 앱별로 보려면 Claude Code 상태 훅의 기기 이름(`device`)이 이 PC 이름(`worker`)과 같아야 해요.

## 주사용 AI와 공장 지시 훅

통제실·설정 화면의 주사용 AI는 새 앱·수정·출시·정비 지시의 서버 기본값이다. 개별 지시의 Claude/Codex 선택이 우선하며 기존 일감을 바꾸지 않는다. 감독은 `/next`에서 기본값 변경을 확인하고, 저장된 AI로 일감을 실행한다.

`install-factory-hooks.mjs --dry-run`으로 검토하고 설치하면 기존 Claude 상태/백업 훅에 공장 지시 훅을 추가하고 Codex 훅도 등록한다. Codex의 `/hooks` 신뢰 검토는 사용자가 수행하며 우회하지 않는다.

두 AI의 일반 대화 입력에서 `공장: codex 지시내용`, `공장: claude 지시내용`, `공장: 지시내용`을 보낸다. 훅은 정비 지시를 승인 대기로 등록하고 현재 프롬프트를 차단하여 중복 실행을 막는다. `공장: codex --thread 정비ID 지시내용`으로 이어서, `공장: status 정비ID`로 결과를 조회한다. 감독 하위 AI의 프롬프트는 다시 일감으로 등록하지 않는다.

훅이 등록하는 것은 공장 정비다. 앱 제작·수정·출시는 홈페이지와 기존 앱 MCP를 사용한다. 등록·조회 API는 작업 PC 토큰을 사용하고 훅 자체는 승인·배포·AI 직접 실행을 하지 않는다. 세부 설치·복구 절차는 `docs/ai-harness.md`를 읽는다.
