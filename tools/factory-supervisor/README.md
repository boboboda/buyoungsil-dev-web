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
승인된 지시가 있으면 15초 안에 가져가서 `~/dev/factory/<앱이름>/` 에 앱을 만들어요. 동시에 3개까지 만들어요. 몇 개까지 동시에 만들지는 통제실 [설정]의 '동시에 만들 앱 수'(1~4, 정한 적 없으면 3)에서 정하고, 감독 프로그램이 다음 확인 때(보통 15초 안, 재시작 필요 없음) 받아 가요. 줄여도 이미 도는 일감은 끊지 않고 끝나면서 줄어들며, 같은 앱의 일감은 자리가 남아도 하나씩만 돌아요.

## 자동 업데이트 (`update.mjs`)
- 실행기 `~/dev/factory/run-supervisor.sh`(환경변수 `FACTORY_LAUNCHER=1`)로 돌 때만 켜져요. 실행기는 감독 프로그램이 끝나면 30초 뒤 다시 띄워요.
- 10분마다 `git fetch origin main` 해서(일감이 돌아도 확인은 해요), 이 폴더 파일이 바뀐 새 커밋이 있으면 `git pull --ff-only` → `node --check` → 정상 종료(exit 0) → 실행기가 새 코드로 다시 띄워요. 일감이 끝나길 기다리지 않고 "잠깐 멈췄다가 이어서" 해요(아래 「업데이트 때 일시 중지 → 업데이트 → 이어서」).
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
- AI 가 `flutter build apk --release --split-per-abi` 로 만들고 휴대폰용 `app-arm64-v8a-release.apk` 를 `.factory/apk.json`({path, versionName, versionCode})에 남기면, 감독 프로그램이:
  경로 확인(앱 폴더 안의 .apk, 200MB 이하) → ABI 확인(APK 안 `lib/` 가 arm64-v8a 하나뿐이어야 함. 홈페이지가 `release.apk.abi` 를 준 새 일감만, 예전 지시문 일감은 따지지 않음) → `apksigner verify --print-certs`(build-tools 의 apksigner.jar 를 Java 로) → 디버그 키 거절 →
  등록된 키(JKS 는 비밀번호 없이, PKCS12 는 keytool 에 비밀번호를 환경변수로)와 서명 인증서 SHA-256 비교 → 앱 폴더 커밋 →
  `/api/factory/test-apk` 로 정보(크기·SHA-256·버전·빌드 시각·커밋·서명 지문·ABI)를 보내고 홈페이지가 정한 크기(`TEST_APK_CHUNK`, 기본 512KB — nginx `location /` 기본 본문 한도 1MB 아래)의 조각으로 올려요(홈페이지가 크기·SHA-256 다시 확인). 거절되면 상태 코드·조각 크기·응답 본문(nginx 413 HTML 포함)을 실패 사유에 남겨요.
- 단계: key → build → sign(apksigner 확인) → upload. 재시도가 `upload` 면 AI 없이 확인·업로드만 다시 해요. Play 는 건드리지 않아요.
- 홈페이지는 APK 를 DB 에 두고 관리자만 내려받게 해요(앱당 최근 5개). 키 파일·비밀번호는 보내지 않아요.

## 공장 정비 (`maintenance.mjs`)
- 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드예요. 앱 일감과 따로 돌아요(통제실 감독 프로그램 카드, 커넥터 `maintenance_*`).
- 정비 지시가 대기·진행 중이어도 앱·실험 일감은 계속 돌아요(정비는 정비 전용 폴더에서 돌아 앱 폴더와 겹치지 않아요). 겹치면 안 되는 순간은 감독 프로그램 업데이트·재시작과 서버 배포뿐이라 그때만 비켜요(아래 「드레인」).
- 정비 전용 체크아웃 `~/dev/factory/selfdev`(설정 `selfdevDir`)에서 Claude 를 돌려요. 같은 정비의 이어지는 지시는 같은 세션(`--resume`).
  규칙은 `CLAUDE.local.md`(커밋되지 않게 `.git/info/exclude`)에 써요. Claude 는 커밋만 하고 push·배포는 하지 않아요.
- **백그라운드 대기로 턴을 끝내지 않아요.** 정비 AI 는 명령을 백그라운드로 띄우고 "알림이 오면 이어서"라고 턴을 끝내면 안 돼요(이 환경에는 알림이 오지 않아요). 오래 걸리는 시험·빌드도 턴 안에서 끝까지 기다려요(규칙 문서 `RULES` 에 있음).
- **커밋 없이 끝났는데 정비 폴더에 변경이 남아 있으면**(새 파일 포함) 예전처럼 `git stash` 로 숨기고 '완료'로 두지 않아요. 파일은 그대로 두고 결과를 `미완료(이어서 필요)` 실패로 보고해요 → 대기열이 멈추고 통제실 할 일·텔레그램에 '막힘'으로 알려요. 같은 정비 대화에 "이어서 마무리하고 커밋해 줘"라고 지시하면 그 파일 위에서 이어 가요. 다른 정비 대화가 시작될 때 폴더가 지저분하면(`prepare`) 바로 시작하지 않고 "정비 폴더에 커밋 안 된 변경이 있어요"로 멈춘 뒤 알려요. 시험 스크린샷 폴더(`.factory/screenshots/`)는 커밋 대상이 아니라서 `.git/info/exclude` 에 자동으로 넣어요.
- 감독 프로그램이 검사(감독 프로그램 `node --check`, `tsc --noEmit` 오류 0개)를 통과했을 때만 GitHub main 에 올려요. 못 통과하면 커밋은 정비 폴더에 남고 다음 지시에서 이어 해요.
  (대기열 서버에서는 같은 정비 대화가 이어갈 때만. 다른 대화의 지시면 남은 커밋을 `factory-unpushed/<지시 id>` 브랜치로 옮기고 GitHub main 최신에서 시작해요. 어느 대화 것인지는 `.git/factory-unpushed.json`)
- 대기열: 처리 중이어도 지시는 쌓이고, 서버가 보낸 순서대로 한 번에 하나씩 줘요(맨 앞이 승인 대기면 뒤도 기다림). 앞 지시가 실패하면 대기열이 멈추고 사람이 [계속 진행]·[재시도]·[대기열 비우기]를 골라요.
- 서버 코드가 바뀌었으면 "배포 필요". 대기열이 다 끝난 뒤 한 번 안내하고(급하면 통제실 [지금 배포]), 사람이 통제실·텔레그램에서 [배포]를 누르면 가장 최근 정비 커밋(GitHub main 에 있는 것만)을 `deployRemote`(기본 `serverpc:git-server/repo/developWeb.git`)로 push 해요. 서버는 커밋 해시만 보내요. 설정에서 "대기열 끝나면 자동 배포"를 켤 수 있어요(기본 꺼짐).
- 서버가 `maintenance.deployBundling` 을 보내지 않으면(예전 서버) 예전 방식 그대로 해요.

## 실험 일감 (`lab.mjs`, 일감 종류 `lab`)
도구·방식이 되는지 확인하는 테스트 전용입니다(앱 수정 일감으로 돌리면 권한이 맞지 않아 막혀서 따로 만들었어요). 앱 폴더가 아니라 `<workDir>/lab/<일감id>/`에서 돌고, 여러 실험이 다시 쓰는 것(ComfyUI·모델 등)은 `<workDir>/lab/shared/`에 둡니다.
- 대기열: 일감 이름(appSlug)이 고정 `lab`이라 실험은 동시에 1개이고, 앱 일감·정비를 멈추지 않습니다(자리 하나는 차지). 승인은 다른 일감과 같습니다.
- 권한: 공장 안 다른 폴더는 읽기·복사만, `lab/<id>`·`lab/shared`만 쓰기·실행, 명령은 승인 없이, 인터넷 허용.
  - Claude: `--settings` 로 `lab/.settings/<id>.json`(allow: Read 공장 폴더 · Edit 실험 폴더 둘 · Bash, deny: 공장 폴더 안 다른 항목에 Edit · 설정/비밀 파일 Read, additionalDirectories: shared). 허용 도구에서 아무 곳이나 쓰는 `Edit`·`Write` 는 뺍니다.
  - Codex: `sandbox_mode="workspace-write"`, 작업 폴더가 cwd, `writable_roots`=shared, `network_access=true`.
- 사후 검사: 시작 전에 공장 안 저장소들(`.git` 있는 직속 폴더 + game-toolkit·app-kit·selfdev)의 `git status --porcelain -uall`(파일 크기·수정 시각 포함)을 찍어 두고 끝난 뒤 비교합니다. 달라졌으면 일감을 `failed`(failStage `lab-check`)로 보고하고 저장소·파일을 로그와 `labResult`에 남깁니다(텔레그램 실패 알림). 자동 되돌리기는 하지 않습니다. 실험 동안 다른 앱 일감이 만진 저장소는 비교에서 빼고 이유를 적습니다.
- 결과: `outputs/` 의 png·webp·gif·mp4, `report.md`(실험 폴더 또는 outputs), 지시문이 지정한 실험 폴더 안 파일을 8MB 조각으로 `PUT /api/factory/lab-file` 에 올립니다(파일 50MB·실험 200MB·40개, 넘으면 올리지 않고 목록만).
- 폴더 지우기: 통제실 [폴더 지우기] → `/next` 의 `labCleanup` → 해당 `lab/<id>` 만 삭제(shared 제외) → `POST /api/factory/lab`. 자동 삭제는 없습니다.

## 작업 후 컨텍스트 정리 (`compact.mjs`)
- 일감·정비가 성공으로 끝나면(검증·커밋·push 뒤, 완료 보고 전) 감독 프로그램이 이어 쓸 Claude 세션에 `claude -p --resume <세션>` 으로 `/compact` 를 걸어 맥락을 요약해요. 정비는 완료 보고 전에 끝나므로 다음 지시보다 먼저 끝나요.
- Claude 세션만, 다시 이어 쓸 세션만(정비 대화, 이전 세션을 이어받은 일감). 지금 앱 일감은 새 세션으로 시작해서 건너뛰어요. 실패한 작업·Codex 는 건드리지 않아요.
- 2분 안에 안 끝나거나 실패해도 작업은 실패가 아니에요. 일감 로그·정비 결과에 "컨텍스트 정리(/compact) 완료" 또는 "컨텍스트 정리 건너뜀: 사유" 한 줄만 남겨요.
- 끄기: 통제실 감독 프로그램 카드의 "작업 후 컨텍스트 정리"(FactorySetting `compactAfterJob`, 기본 켜짐) 또는 PC 환경변수 `FACTORY_COMPACT_AFTER_JOB=0`.

## 서버 설정 도구 (`serverctl.mjs`, 공장 정비 전용)
- 정비 Claude 는 서버 설정(nginx, 서버 `.env.local`, 재빌드)을 이 도구로만 바꿔요. 이 PC 의 docker·sudo·nginx·systemctl 직접 호출, sftp·rsync, `~/.ssh` 읽기, 실행 폴더 수정은 `--settings` 권한 규칙으로 막혀 있어요. 서버 접속(ssh·scp·git)은 아래 「서버 접근 규칙」을 따라요.

## 서버 접근 규칙 (`serveraccess.mjs`, `ssh-guard.mjs`)
- 공장 AI 세션(정비·앱 new/revision·출시·실험)은 `~/.ssh/config` 의 우리 서버 두 대(`serverpc` 서버1, `serverpc2` 서버2)로만 ssh·scp·git 접속을 할 수 있어요. 다른 호스트, `-J`·`-F`·`ProxyCommand`·터널 옵션, sftp·rsync 는 막혀요.
- 계속 막는 것: 서버에서 `rm -rf`(예외: `~/studio-upload/<이름>` 바로 아래 한 단계 폴더만, 목록은 serveraccess.mjs 의 RM_RF_ALLOWED_PARENTS)·`git-server` 아래 저장소 삭제/이름 변경, 강제 push(`--force`·`-f`·`--force-with-lease`·`+`refspec)·원격 브랜치 삭제·서버 저장소 `git reset --hard`, 배포 저장소(`git-server/repo/`)로 push, `docker compose down`·`docker rm`·prune·`systemctl stop/disable`·`reboot`·`shutdown`, nginx 설정 수정·`.env`·인증서/키·`~/.ssh`·crontab 수정. 표준입력으로 보낸 스크립트·eval·base64 디코드처럼 검사할 수 없는 원격 명령도 막아요.
- Claude Code 는 권한 규칙(prefix)으로 호스트를 가릴 수 없어서, 감독 프로그램이 일감마다 만드는 `--settings` 에 PreToolUse 훅(`node "<실행 폴더>/tools/factory-supervisor/ssh-guard.mjs"`)을 넣어 Bash 명령을 실행 전에 판정해요. 훅은 실행 전용 체크아웃(`supervisor-src`)의 사본이라 AI 가 고칠 수 없어요.
- 이 훅은 명령 문자열을 읽는 안전장치예요. 스크립트 파일이나 다른 언어 안에서 ssh 를 띄우는 우회까지 막는 격리 장치는 아니에요.
- Codex 는 정비·앱·출시에서 샌드박스 네트워크가 꺼져 있어 ssh 가 되지 않아요(실험만 네트워크 켜짐, 훅 없음 — 규칙 문서로만 안내).
- 실행한 ssh·scp 명령은 일감·정비 로그에 줄이지 않고 남아요(최대 2000자). 막아야 할 일이 꼭 필요하면 AI 는 명령과 이유를 결과에 적고 멈춰요(사람이 실행).
- 정비 Claude 는 실행 폴더(`supervisor-src`)의 사본만 써요(정비 폴더 사본은 Claude 가 고칠 수 있어서).
- 서브커맨드: `env-keys`, `env-set KEY`(값은 `SERVERCTL_VALUE` 나 stdin 으로만), `env-unset KEY`, `nginx-show`, `nginx-set-directive NAME VALUE [LOCATION]`(허용 지시어만), `nginx-apply FILE`, `rebuild`, `restore TIMESTAMP`, `backups`.
- 바꾸기 전 백업(`~/env-backups/developWeb`, `~/nginx-backups`, 600/700, 최근 20개, 작업 폴더 밖) → nginx 는 `nginx -t` 통과 시에만 reload, 헬스체크 실패 시 자동 복원 / `.env` 는 rebuild 전 이미지 `rollback-<시각>` 태그, 실패 시 `.env` 백업·이미지로 되돌림.
- 값은 어디에도 출력하지 않아요. 바꿀 때마다 정비 대화와 텔레그램에 무엇을·백업·검증 결과가 남아요.

## 정비 보호 규칙·시험 격리 (`pcguard.mjs`, `maintenance-guard.mjs`, `testmode.mjs`)

10-14 정비 중 시험용 감독과 `taskkill //IM node.exe` 가 진짜 감독을 6번 꺼서 진행 중 일감이 끊긴 일의 재발 방지예요.

- **실행기(`run-supervisor.sh`, 작업 스케줄러) 변경은 정비에서 하지 않는다. 필요하면 바꿀 내용만 보고하고 멈춘다(사람이 로컬에서 적용).**
- 정비 `--settings` 의 PreToolUse 훅은 `maintenance-guard.mjs`(서버 접근 규칙 + `pcguard.mjs`)예요. 앱·실험 일감은 계속 `ssh-guard.mjs` 만 써요(앱 일감 권한은 그대로).
- 막는 것: 실행기 실행(`run-supervisor.sh/.cmd/.ps1`)·작업 스케줄러 명령, 진짜 감독의 잠금·상태 파일(`supervisor-src` 아래, `run-supervisor.pid`, `supervisor-update.json`, `serverctl-state.json`, `supervisor-restart.json`, 공장 루트의 `.locks`·`.ai-locks`·설정·로그) 쓰기·삭제, `kill`·`pkill`·`killall`·`taskkill`·`Stop-Process` 와 `node -e`·`python -c` 안의 프로세스 종료, 시험 모드 없이 `node supervisor.mjs` 직접 실행. 정비 권한 설정(`maintenanceSettings`)에도 같은 deny 규칙이 있어요.
- 한계: 명령줄에 드러난 것만 봐요. 스크립트 파일·히어독 본문 안의 동작은 못 봐서, 규칙 문서(정비 `CLAUDE.local.md`)와 아래 시험 모드 거부가 겹쳐서 막아요.
- **시험 모드**: 감독을 시험으로 띄울 때는 `FACTORY_TEST_MODE=1` 과 임시 폴더의 `FACTORY_CONFIG`(설정·상태·잠금 파일, `HOME`·`USERPROFILE` 모두 임시)와 가짜 토큰, `127.0.0.1` 의 가짜 홈페이지 주소를 써요. 이 모드에서 진짜 주소·진짜 토큰·`~/dev/factory` 안의 상태/잠금/작업 폴더가 들어오면 감독은 아무것도 하기 전에(자동 업데이트 시험 기록 전에) 이유를 찍고 종료 코드 2 로 시작을 거부해요. `worktree-e2e.test.mjs` 도 이 모드로 띄워요. 시험: `npm run test:pc-guard`.
- 참고: `run-supervisor.sh` 의 "종료(코드 N)" 로그는 `$(date)` 뒤에 `$?` 를 써서 항상 0 으로 찍히는 듯해요[추정](실행기 수정은 정비 범위 밖이라 사람이 확인·수정할 것).

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
- 자리가 꽉 차 있어도 감독 프로그램은 15초마다 확인해요(`slots=0`: 일감은 안 받고 신호·설정만). 그래서 '동시에 만들 앱 수'를 늘리면 바로 다음 확인에 더 가져가요.
- 동시에 돌 때 부딪힐 수 있는 것: 앱 폴더는 폴더마다 잠금 파일(`.ai-locks`)로 막고, `secrets.env` 쓰기는 한 줄로 세워 차례로 하고, 도구 중계 한도는 일감마다, 한도(ai-limits) 수집은 60초 최소 간격으로 PC 전체가 공유해요. 그래도 Claude/Codex 한도와 PC 메모리·CPU 는 돌리는 개수만큼 빨리 써요.
- 정비가 도는 동안에도 앱·실험 일감은 계속 받아요. 새 일감을 멈추는 건 아래 드레인뿐이에요.

### 드레인 (병렬화 단계 A)
- 감독 프로그램 업데이트(자동 업데이트·`update_now`·정비가 감독 코드를 push 한 뒤): 1-2 D-2 부터 진행 중 일감이 끝나길 기다리지 않고 AI 를 잠깐 멈췄다가 새 버전에서 이어 줘요(아래 「업데이트 때 일시 중지 → 업데이트 → 이어서」). 받기로 한 동안에는 새 일감·새 정비 지시를 받지 않아요(`/next?slots=0&drain=update&drainJobs=N`).
- 재시작(`restart`): 예전처럼 `hold=1` 로 새 일감을 멈추고 진행 중인 것이 끝나면 종료.
- 서버 배포([배포]): 서버 응답으로 배포 요청을 받아도 진행 중인 앱·실험 일감과 정비 지시가 있으면 "배포 대기"(`drain=deploy`)로 기다렸다가 모두 끝난 다음 응답에서 시작해요. 배포 중에는 홈페이지 컨테이너가 바뀌어 일감의 보고·업로드가 끊기므로, 보고를 다시 보내는 방식보다 겹치지 않게 비키는 쪽을 골랐어요(큰 영상 업로드·도구 중계·그림 등록은 재전송을 보장하기 어려워요). 이번 응답으로 방금 받은 일감도 진행 중으로 세어 배포와 겹쳐 시작하지 않아요.
- 통제실에 "업데이트 중(...)"·"배포 대기(진행 중 일감 N개 끝나면)"가 보여요.
- 앱 일감 Claude 는 `~/dev/factory/app-claude-settings.json` 으로 정비 폴더(`selfdev`, `supervisor-src`)와 공장 설정·비밀 파일을 고치거나 읽지 못하게 막아요(파일 도구 기준).

## 같은 앱 일감 병행 실행 (병렬화 단계 C-1: `worktree.mjs`, `merge.mjs`, `applock.mjs`)

겹치지 않는 수정 일감은 한 앱에서도 같이 돌리고, 끝난 순서대로 합치면서 서로 충돌하는지 마지막까지 점검해요. 겹침을 판단하는 지휘자는 C-2에서 만들고, 지금은 사람이 통제실 [앱별 대기열]에서 일감을 체크해 **[같이 돌리기]**로 묶어요(`parallelGroup`).

- **언제**: 일감이 `kind=revision` 이고 `parallelGroup` 이 있을 때만. 그 밖(새 앱·출시·실험, 그룹 없음)은 예전 그대로 앱당 1개예요. 서버는 같은 앱·같은 그룹의 승인된 수정 일감을 설정 '같은 앱에서 같이 돌릴 수'(기본 2, 1~4)까지 같이 내줘요. 공장 전체 동시 수는 기존 '동시에 만들 앱 수'(기본 3)이고 병행 일감도 하나씩 세요.
- **작업 사본**: 앱 폴더(기본 브랜치에 있어야 해요)에서 `git worktree add -b factory/job-<id> <작업 폴더>/.worktrees/<앱>-<id> <main|master>`. 커밋 안 된 변경은 단독 일감처럼 먼저 '수정 전 저장'으로 커밋해요. `node_modules` 는 앱 폴더와 연결(junction)하고 `local.properties` 는 복사해요. AI 는 그 사본 안에서만 일해요. 임시 브랜치는 **로컬에만** 있고 어디에도 push 하지 않아요. 외부 저장소(`prod` 원격)와 git 이 아닌 폴더는 병행하지 않고 "같이 돌리기를 풀고 다시" 라는 안내로 실패해요.
- **앱 단위 잠금** (`<작업 폴더>/.locks/<앱>.<이름>.lock`, 앱마다 따로): `build`(Flutter/Gradle 빌드) · `emulator`(에뮬레이터) · `port`(고정 포트) · `merge`(기본 브랜치에 합치기). 감독 프로그램의 검사는 `build`, 합치기는 `merge`(순서: merge → build)를 직접 잡아요. AI 는 작업 규칙의 안내대로 `node applock.mjs <build|emulator|port> -- <명령>` 으로 감싸 실행해요(AI 가 안 감싸면 잠금이 없는 것과 같아요 — 규칙으로 안내하는 방식이라 강제는 못 해요). 잠금을 쥔 프로세스가 죽으면 낡은 잠금으로 보고 치워요. 기다리는 동안은 일감 로그에 `⏳ 잠금 대기: 빌드 …`/`▶ 잠금 얻음`이 남고 통제실 카드에 `잠금 대기: 빌드`가 보여요(`parallel.lockWait`).
- **합치기**: AI 가 끝나면 사본 변경을 커밋하고(공장 파일 `PLAN.md`·`CHANGE_REQUEST.md`·`CLAUDE.md` 는 빼요 — 사본마다 달라 충돌만 만들어요), `merge` 잠금 안에서 한 일감씩: 앱 폴더가 기본 브랜치에 있고 깨끗한지 확인 → 사본에 최신 기본 브랜치를 합쳐 넣기 → 합친 상태로 그 앱의 기존 검사(`verifyWorkspace`) → 통과하면 기본 브랜치를 `git merge --ff-only` 로 앞으로 감기. 합칠 때마다 검사해요. 이미 합쳐진 다른 일감의 커밋은 건드리지 않아요.
- **다시 맞추기**: 글자 충돌(충돌 표시를 사본에 남겨 둬요)이나 검사 실패면 같은 일감 AI 에게 "최신 기본 브랜치 기준으로 다시 맞추기" 지시를 새 턴으로 보내요(최대 2회, `merge.mjs fixPrompt`). 그래도 안 되면 그 일감만 `failed`·`failStage=merge`("합치기 실패")로 보고해요 → 서버가 텔레그램으로 알리고 통제실에 빨간 "합치기 실패" 표시가 남아요([다시 시도]·[그룹 풀기]). 앱 폴더가 더럽거나 기본 브랜치가 아니면 AI 에게 보내지 않고 바로 같은 방식으로 실패해요(사람이 정리). 실패한 작업은 사본을 지우기 전에 `.factory/history/<id>.merge-failed.patch` 로 남겨요.
- **정리**: 일감이 끝나거나 실패하면 `git worktree remove --force`(연결을 먼저 풀고) + `git worktree prune` + `git branch -D`(로컬). `rm -rf` 는 쓰지 않아요. **재시작**: 감독 프로그램이 켜질 때 지난 실행이 남긴 `factory/job-*` 사본·브랜치와 잠금 파일을 이어받지 않고 정리해요(서버가 임대 만료로 그 일감을 대기열로 되돌려 처음부터 다시 실행). 업데이트·재시작·배포 드레인은 병행 일감이 모두 끝난 뒤에 해요(병행 일감도 `running` 에 하나씩 세요).
- **그룹 완료 요약**: 그룹의 일감이 모두 합쳐져 완료되면 서버가 합친 순서·다시 맞추기 횟수·검사 결과를 통제실 대기열 아래와 각 일감 로그에 남겨요.
- 인계 기록·작업 메모리는 사본이 아니라 앱 폴더에 남겨요(사본은 사라지므로).

### 병렬화 C 보완 (승인 전 묶기·승인 직후 대기·앱별 검사 명령)

- **묶음 승인**: 승인 대기(pending) 수정 일감도 [같이 돌리기]로 묶을 수 있고(채팅 `enqueue_app_job` 의 선택 인자 `parallelWith` = 같은 앱의 다른 대기 일감 id 로 등록과 동시에 같은 묶음, `parallelSource=manual`), 묶음 카드의 **[묶음 승인]**(`POST /api/admin/factory/queue` `{ action: "approve-group", jobId }`)으로 묶음 안 승인 대기 일감을 한 번에 승인해요. 묶음에 승인 대기 일감이 남아 있는 동안은 그 묶음의 승인된 일감도 가져가지 않아요(`withoutPartialGroups`). 다른 묶음·묶음이 아닌 일감은 영향이 없어요.
- **승인 직후 대기**: 같은 앱에 승인 대기 수정 일감이 또 있으면 방금 승인된(묶이지 않은) 수정 일감을 마지막 승인 뒤 `approvalWaitSec`(통제실 설정 '승인 직후 기다리는 시간', 기본 60초, 0~300, 0 = 기다리지 않음) 동안 가져가지 않아요. 카드에 '다른 승인 기다림 n초'. 자동 묶기가 꺼져 있거나 같은 앱 동시 수가 1이거나 `conductor` 를 보내지 않는 감독 프로그램이면 기다리지 않아요.
- **앱별 검사 명령**: 통제실 설정 '앱별 합치기·최종 점검 검사 명령'(`factory_settings` 의 `appCheckCommands`, `{ 앱: ["명령", …] }`)이 있으면 `/next` 가 그 앱 일감에 `checkCommands` 를 붙이고, 감독 프로그램은 합치기 검사와 마지막 전체 점검에서 stack 기본 검사 **뒤에** 그 명령들을 앱 폴더에서 셸 없이 더 돌려요(`ai-runner.mjs` `customChecks`/`verifyWorkspace` 의 `ran`). 비어 있으면 stack 기본 검사만(예전과 같음). 돌린 명령은 일감의 합친 뒤 검사 결과와 그룹 요약에 표시돼요. game-toolkit 처음 값: `python -m unittest discover -s tests -q`.

## 지휘자: 겹치지 않는 일감 자동 묶기 (병렬화 단계 C-2: `conductor.mjs`, 서버 `lib/factory/conductor.ts`)

같은 앱에 승인된 수정 일감이 그룹 없이 2개 이상 쌓이면, 서버가 `/next` 응답에 `conductor: { appSlug, key, model, perApp, sharedFiles, jobs }` 를 한 번 실어 판단을 맡겨요(감독 프로그램이 `conductor=1` 을 보낼 때만, 공장 전체 동시에 1개).

- **AI 턴**: 앱 폴더에서 Claude Code 를 읽기 도구(`--tools Read,Glob,Grep`)만 열고 한 번 돌려요. `Bash·Edit·Write·WebFetch·WebSearch` 는 `--disallowedTools` 로 막고, 외부 MCP·세션 저장도 꺼요. 지시문은 표준입력으로만 넘겨요. 모델은 통제실 설정(기본 `haiku`, 허용 목록 별칭만). 끝난 뒤 `git status`·HEAD 가 시작 때와 다르면 **읽기 전용 위반**으로 보고 판단을 쓰지 않아요. 4분 안에 안 끝나면 중단해요. 합치기가 HEAD 를 바꾸지 않게 앱 단위 `merge` 잠금 안에서 돌고, `running`(공장 전체 동시 실행 수)에는 세지 않아요. 앱 폴더에서 단독 일감이 돌고 있으면 `skip`(기록 없이 나중에 다시).
- **입력**: 일감별 id·제목·우선순위·지시문(계획), `git ls-files` 파일 목록(최대 1500줄), 공용 파일 패턴. **출력 JSON**: `{ jobs: [{ id, files[], areas[], confidence: high|medium|low, note }], groups: [{ jobIds[], reason }], sequential: [{ jobIds[], reason }] }`.
- **서버 재검사**(AI 제안을 그대로 믿지 않음): 예상 파일이 하나라도 겹치거나, 확신도가 `high` 가 아니거나, 공용 파일(의존성·빌드 `pubspec.yaml`·`package.json`·잠금 파일·`build.gradle*`·`AndroidManifest.xml`, 라우터·앱 전역 설정, 마이그레이션·스키마, 번역 파일; 통제실 설정에서 고침)을 건드리거나, 의존성 영역이면 묶지 않고 순서대로 두며 이유를 남겨요. 묶음은 우선순위 순으로 이어진 일감이고 `parallelPerApp` 이하예요. 출시·새 앱 일감은 대상이 아니에요(C-1 규칙).
- **결과 보고**: `POST /api/factory/conductor` — `verdict`(AI 판단, 서버가 반영) · `fail`(판단 실패: 순서대로 두고 사유 표시, 공장은 멈추지 않음) · `skip` · `final`(마지막 전체 점검 결과). `usage`(시간·토큰·비용)는 통제실 설정의 '최근 지휘자 판단'에 `[지휘자]` 로 따로 남아요.
- **사람 결정 우선**: 사람이 묶거나 푼 일감은 `parallelSource=manual` 이라 지휘자가 바꾸지 않아요(푼 일감은 다시 자동으로 묶지 않아요). 자동 묶기를 끄면(통제실 설정) C-1 과 똑같이 동작해요.
- **예상과 실제**: 합칠 때 `merge.mjs` 가 실제로 바뀐 파일(`actualFiles`)을 보고하고, 서버가 예상과 비교해 `unexpected`·`overlapFiles`·`overlap` 을 `parallelInfo` 에 기록해요. 예상 밖 파일 때문에 같은 묶음 일감과 실제로 겹쳤으면 그룹 완료 요약에 '예상 빗나감'이 붙어요.
- **마지막 전체 점검**: 지휘자가 묶은 그룹의 마지막 일감까지 합쳐지면 보고 응답에 `finalCheck` 가 실려 와요. 감독 프로그램이 기본 브랜치 최신 상태에서 앱 전체 검사(빌드·시험)를 한 번 더 돌려 `final` 로 알려요. 실패하면 '그룹 최종 점검 실패'로 통제실·텔레그램에 보고하고, 이미 합친 커밋은 되돌리지 않아요. 결과가 30분 안에 오지 않으면 '결과가 오지 않음'으로 요약만 남겨요.

## 작업 메모리 (`memory.mjs`, 폴더의 `.factory/memory/`)

긴 대화로 느려지는 걸 막고, 새 대화로 시작해도 이어서 하게 해요. 일감·정비·터미널이 같은 코드(`makeHandoffEntry`)를 지나고 Claude Code·Codex 가 같은 파일을 읽고 써요. 기존 인계 기록(`handoff.mjs`)을 재사용해요: `current.md` 는 인계 항목에서 그려요.

- `current.md`: 가장 최근 일감 요약(2KB 안팎, 일감마다 통째로 새로 씀, 앞의 것은 `history/` 에 최근 10개). 시작할 때 프롬프트에는 이것만(2.5KB 상한, 참고 데이터·지시 아님) + 한 줄 안내가 들어가요. 없으면 예전 인계 기록을 넣어요.
- `project.md`: 전체 요약(섹션마다 '마지막 확인 커밋'). AI 는 파일을 고치지 않고 최종 답변에 `## 전체 요약 갱신` 블록(`추가/수정/삭제 [섹션]: …`, `색인: 키워드 → 설명 → 위치`)을 써요. 감독 프로그램이 섹션 단위로 반영해요. 20KB 를 넘으면 current.md·통제실에 '요약 정리 필요'만 표시해요(자동 AI 호출 없음).
- `INDEX.md`: 키워드·섹션·최근 일감 색인(3KB 안팎). 블록이 없으면 변경 파일·커밋만 넣고 '요약 갱신 없음'.
- 폴더마다 작은 Git 저장소(프로젝트 저장소와 분리, `.factory/` 는 제외됨). 일감이 끝날 때 커밋하고 서버2 로 푸시해요. 실패해도 일감은 그대로, 다음 일감 때 다시 시도해요. `memoryRemote` 설정(기본 `serverpc2:git-server/memory/factory-memory.git`, 저장소 하나에 폴더 이름 브랜치. `{folder}` 를 쓰면 폴더마다 저장소, `""` 이면 로컬에만). 주소에 `github.com` 이 있으면 연결도 푸시도 안 해요. 서버의 저장소는 사람이 한 번 만들어요(자동 ssh 생성 없음).
- 통제실: 인계 기록 칸 안에 현재 일감 요약, [설정]의 AI 도구 상태 칸에 폴더별 메모리 상태(시각·KB·푸시 결과).

## 설정 값 (`supervisor.config.json`)
| 이름 | 기본값 | 뜻 |
|---|---|---|
| slots | 3 | 동시에 만들 앱 수 (1~4). 통제실 [설정]에서 정한 값이 있으면 그 값이 우선이고, 정한 적 없을 때만 이 값을 써요. 예전 기본값 2 를 그대로 둔 PC 는 3 으로 따라가고, 1·4 처럼 따로 정한 값은 통제실에서 저장하기 전까지 유지해요 |
| memoryRemote | serverpc2:git-server/memory/factory-memory.git | 작업 메모리 푸시 주소(서버2 전용, github.com 거부). `{folder}` 가 있으면 폴더마다 저장소, 없으면 저장소 하나에 폴더 이름 브랜치. 빈 값이면 로컬에만 |
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

## 남은 한도 수집 (`ai-limits.mjs`, 감독 프로그램과 별도)

통제실 [사용량] 탭의 "남은 한도" 게이지에 값을 보낸다. 주소·토큰은 상태 훅과 같은 `CLAUDE_STATUS_URL`·`CLAUDE_STATUS_TOKEN`·`CLAUDE_DEVICE_NAME` 를 쓰고, `CLAUDE_STATUS_URL` 뒤에 `/limits` 를 붙여 보낸다(`AI_LIMITS_URL` 로 바꿀 수 있음).

- Claude: `~/.claude/settings.json` 에 `"statusLine": { "type": "command", "command": "node \"C:/Users/kju90/dev/factory/supervisor-src/tools/factory-supervisor/ai-limits.mjs\" statusline" }`. 상태줄에 `5h 23% · 7d 41%` 를 보여주고, 값이 바뀌었거나 5분이 지났을 때만 보낸다. Pro/Max 구독, 세션 첫 응답 이후에만 값이 있다.
- Codex(비공식): `node ai-limits.mjs codex` 가 5분마다 `~/.codex/auth.json` 토큰으로 chatgpt.com 사용량 주소를 읽어 사용률·초기화 시각만 보낸다. `--once` 는 한 번만. 실패·형식 변경 때는 "수집 실패"만 보낸다. 토큰은 서버로 보내거나 출력하지 않는다.
- `node ai-limits.mjs check` 는 필요한 환경변수·auth.json·.credentials.json 이 있는지와 쉬는 중인지만 알려준다(값은 안 보임).

### 화면 없이 5분마다 + 일감·정비가 끝날 때마다 (`ai-limits all --once`)

- `node ai-limits.mjs all --once` 는 Claude 와 Codex 를 한 번에 읽어 보낸다(`codex --once` 는 그대로 쓸 수 있음).
  - Claude 는 비공식 `https://api.anthropic.com/api/oauth/usage` 를 `~/.claude/.credentials.json`(Claude Code 로그인)의 액세스 토큰으로 읽는다. 헤더는 `anthropic-beta: oauth-2025-04-20`.
  - 5시간·7일 사용률, 초기화 시각, 모델별 주간 한도(`seven_day_opus` 같은 키나 `limits[]` 의 `weekly_scoped · Fable`)를 보낸다. 출처는 "자동수집" 이다.
  - 토큰이 만료됐으면 갱신하지 않고 부르지도 않는다. "로그인 필요(Claude Code 를 한 번 쓰면 갱신돼요)" 로 보고한다.
  - 429·401 이면 5분 → 15분 → 30분 쉬고, 성공하면 처음으로 돌아간다. 쉬는 동안은 마지막 값과 상태줄 값을 그대로 쓴다.
  - 서버는 읽은 시각(`measuredAt`)이 더 최근인 값만 남긴다. 그래서 상태줄과 자동수집 중 최신 값이 보인다.
  - 응답 형식이 다르면 "응답 형식이 다름" 만 보내고, 응답 원문은 어디에도 남기지 않는다.
- 동시에 두 번 돌아도 안전하다. 잠금 파일(`%TEMP%\ai-limits.lock`, 2분 넘으면 치움)과 최소 간격 60초(`%TEMP%\ai-limits-state.json`)가 있다.
- 감독 프로그램은 일감·정비가 끝날 때마다(성공·실패 모두) 같은 일을 한 번 한다. 15초를 넘으면 기다리지 않고, 실패해도 일감 결과는 그대로다. 로그에는 `AI 한도 갱신: Claude 성공 · Codex 실패(HTTP 401)` 같은 한 줄만 남는다.
- 일감 출력(`claude -p --output-format stream-json`)에는 `rate_limit_event` 가 있다. 확인한 형식(2.1.x)은 `rate_limit_info.unifiedWindows.five_hour/seven_day.utilization`(0~1)과 `resetsAt`(초)이다.
  - 감독 프로그램이 이 값을 기억해 둔다. 자동수집이 실패하거나 쉬는 중일 때 10분 안의 값이면 출처 "일감 출력" 으로 대신 보낸다.

작업 스케줄러 등록(작업 PC 의 Git Bash, 어느 폴더에서나). 창이 뜨지 않게 `ai-limits-hidden.vbs`(wscript)로 부른다. Git Bash 는 `/SC` 같은 인자를 경로로 바꾸므로 `MSYS_NO_PATHCONV=1` 을 붙인다.

```bash
S="C:/Users/kju90/dev/factory/supervisor-src/tools/factory-supervisor"
node "$S/ai-limits.mjs" check            # 환경변수·로그인 파일이 '있음' 인지
node "$S/ai-limits.mjs" all --once       # 한 번 직접: "AI 한도 갱신: Claude 성공" 이 나오면 됨
# 등록(5분마다, 창 없음)
MSYS_NO_PATHCONV=1 schtasks /Create /F /SC MINUTE /MO 5 /TN "FactoryAiLimits" /TR "wscript.exe //B //Nologo \"C:\Users\kju90\dev\factory\supervisor-src\tools\factory-supervisor\ai-limits-hidden.vbs\""
# 확인: 다음 실행 시각·마지막 결과(0 이면 정상)
MSYS_NO_PATHCONV=1 schtasks /Query /TN "FactoryAiLimits" /V /FO LIST | grep -E "다음 실행|마지막 결과|Next Run|Last Result"
MSYS_NO_PATHCONV=1 schtasks /Run /TN "FactoryAiLimits"   # 지금 한 번 돌려 보기
# 삭제
MSYS_NO_PATHCONV=1 schtasks /Delete /TN "FactoryAiLimits" /F
```

## 서버 배포 중에도 일감이 멈추지 않게 (1-1 D-1)

- 서버 배포([배포])는 진행 중인 앱·실험 일감이 있어도 시작하고, 새 일감 가져가기도 막지 않는다. 기다리는 건 ① 돌고 있는 정비 지시 ② 큰 파일 업로드(영상·스크린샷 묶음·실험 결과)가 진행 중일 때 그 업로드가 끝날 때까지(최대 10분, 넘으면 배포하고 업로드는 다시 시도)뿐이다. 감독 프로그램 업데이트·재시작 대기(드레인)는 예전 그대로다.
- 배포로 홈페이지가 3~5분 응답하지 않는 동안의 보고·로그·하트비트·완료 보고·스크린샷/그림 등록은 `outbox.mjs` 의 재전송 대기열이 쌓았다가 순서대로 다시 보낸다(일감마다 순서 보존, 하트비트는 일감마다 하나). 보고마다 `X-Request-Id` 를 붙이고 다시 보낼 때도 같은 번호를 써서 홈페이지(`lib/factory/requestSeen.ts`)가 같은 보고를 두 번 처리하지 않는다. 대기열은 메모리에만 있고(감독을 끄면 사라짐) 100MB 를 넘으면 쌓지 않는다.
- 홈페이지는 배포 구간(`factory_deploys` 의 시작~끝)을 빼고 "20분(정비 지시)·10분(앱 일감 임대) 보고 없음"을 센다(`lib/factory/deployWindow.ts`). 끝이 안 찍힌 배포는 30분까지만 구간으로 본다.
- 통제실 현황에 "배포 중 · 재전송 대기 N개"가 보인다(/next 의 `outbox`, `deploying` 값).

## 업데이트 때 일시 중지 → 업데이트 → 이어서 (1-2 D-2: `pause.mjs`, `update.mjs`)

예전에는 새 감독 버전이 있으면 진행 중인 일감이 모두 끝날 때까지 공장 전체가 기다렸다(일감 하나 때문에 1시간 넘게 멈춘 적이 있다). 지금은 "잠깐 멈췄다가 이어서"다.

1. **언제 받나(묶기)**: 공장이 비어 있으면 새 버전을 바로 받는다. 일감이 돌고 있으면 새 커밋을 처음 본 때부터 최대 N분(통제실 [설정] → 감독 업데이트, 0~180분, 기본 60, 0 = 바로) 모았다가 한 번에 받는다. 모으는 동안은 아무것도 막지 않는다("업데이트 대기(묶는 중, 남은 n분)"). 모으는 도중 공장이 비면 그 순간 받는다. 통제실 [지금 업데이트]는 기다리지 않고 바로 2~4 로 간다.
2. **일시 중지**: 받기로 하면 새 일감 받기를 멈추고(`drain=update`), 합치기·검증·정비 배포처럼 멈출 수 없는 단계가 끝나길 먼저 기다린 뒤(지금 업데이트는 기다리지 않고 바로 멈추기 시작) 진행 중인 AI 일감(앱 일감 new·revision)과 정비 턴을 **안전한 지점 = 지금 실행 중인 명령(도구 호출)이 끝난 직후**에서 멈춘다(그 순간 프로세스를 끈다). 남은 명령이 5분을 넘을 것 같거나(Bash 제한 시간 기준) 멈추라고 한 지 5분이 지나도 안 끝나면 그 명령을 끊고 멈춘다(로그에 "끝나지 않은 명령을 끊었어요"). 합치기 잠금 안(병행 일감의 다시 맞추기 턴)은 잠금이 풀리고 일감이 끝난 뒤에 처리한다. 멈추는 동안에도 하트비트·로그 보고는 계속 보내 임대(10분)를 이어 간다.
3. **저장**: 멈춘 단위마다 세션 id·작업 폴더(worktree 포함)·단계(phase)·남은 시간 한도·일감 정보를 `~/dev/factory/supervisor-paused.json`(`FACTORY_PAUSE_STATE`)에 쓴다. 못 보낸 보고(재전송 대기열은 메모리뿐)가 있으면 최대 5분 전달을 기다린다.
4. **업데이트**: 기존 방식 그대로(`git pull --ff-only` → `node --check` → exit 0 → 실행기가 다시 띄움). 실행기는 건드리지 않는다. pull·문법 검사·저장이 실패하면 받지 않고 멈췄던 일감을 **같은 프로세스에서 그대로 이어 준다**(자동 업데이트를 끈 경우도 같다).
5. **이어서**: 새 감독은 시작할 때 저장 파일을 읽고(작업 사본·잠금은 지우지 않는다. 30분 넘은 기록은 서버가 임대를 거뒀을 수 있어 버린다), 홈페이지 대기열 확인(/next)이 처음 성공하면 저장된 일감·정비 턴을 같은 세션으로 이어 준다: Claude `--resume <세션>`, Codex `exec resume <세션>`. 이어 줄 때 AI 에게 하는 말은 "공장 업데이트로 잠시 멈췄다. 파일은 그대로다. 멈추기 직전 명령이 끊겼다면 다시 실행하고 이어서 진행해." 이다. 폴더 준비(앱: prepareDir·작업 사본 만들기, 정비: fetch·병합·보관)와 서버에 `start` 알리기는 다시 하지 않는다. 일감 시간 한도는 일한 시간만 센다(멈춰 있던 시간은 빠짐). 새 버전이 첫 /next 에 실패해 이전 버전으로 되돌려지면 이어 주기는 하지 않는다(서버가 임대 만료로 대기열에 되돌려 처음부터 다시 한다).
6. **이어서 하기 실패**: 이어 준 프로세스가 90초 안에 아무 일도 못 하고 오류로 끝나면(세션을 못 찾음 등) 실패가 아니라 "다시 시작 필요"로 한 번 보고한다(앱 일감: `failStage=resume`, 사유가 "다시 시작 필요:"로 시작 → 통제실 카드는 경고 색, 텔레그램은 "⏸ 다시 시작 필요" 한 번. 정비: 결과가 "다시 시작 필요:"). 파일은 그대로 두고 사람이 [다시 시도]/다시 지시한다.
7. **멈출 수 없는 것**: 병행 일감의 합치기·검증·완료 보고 단계, 정비의 검사·푸시·배포 단계, 출시 일감(`release`), 실험(`lab`: 사후 검사가 시작 전 상태를 메모리에 들고 있다), 지휘자 판단은 멈추지 않는다. 이것들이 있으면 끝나길 기다린 뒤 멈춘다(예전과 같은 기다림).
8. **통제실**: "업데이트로 일시 중지 N개"(`/next` 의 `pausedJobs`), "업데이트 대기(묶는 중, 남은 n분)"(`bundleLeft`), 설정 `updateBundleMin`(응답에 실려 온다).

시험: `npm run test:update-pause` (순수 부분 `tests/pause.test.mjs`, 묶기·받기 `tests/update.test.mjs`, 정비 턴 `tests/pause-maint.test.mjs`, 진짜 감독 + 가짜 Claude + 가짜 실행기 `tests/pause-e2e.test.mjs`, 서버 쪽 `tests/update-pause.test.mjs`).

## 일감 시간 낭비 막기 (1-3: `loopguard.mjs`)
앱 일감(new·revision)이 같은 시험을 되풀이하며 공장을 오래 붙잡지 않게 한다. 실험·출시·정비는 대상이 아니다.
- **반복 감지**: AI 의 Bash 명령(Claude `tool_use`, Codex `command_execution`)을 보고 e2e·스크린샷·측정 명령을 같은 명령끼리 센다(cd·파이프 뒤·리다이렉션은 무시). 기본 3회를 넘어 4번째가 시작될 때, 직전 같은 명령 이후 바뀐 파일(`git status` 기준)이 2개 이하이거나 직전 결과가 같으면 그 명령을 끊고 같은 세션에 "같은 시험을 반복 중이다. 지금 상태로 정리하고 막힌 점을 보고하라"를 **한 번** 보낸다(경고). 그 뒤에도 같은 시험이 또 시작되면 일감을 `failed`(`failStage=stuck`, 사유 "막힘: …")로 끝낸다. 작업 파일은 그대로 둔다. 빌드·린트·단위 시험은 고치며 되풀이하는 게 정상이라 기준이 두 배(7번째)이고 "결과가 같을 때"만 본다.
- **스크린샷 단계 상한**: `.factory/phase.txt` 가 `screenshots` 가 된 때부터 15분이 지나면 찍힌 것까지만 올리고(보고에 같이 올라간다) 같은 세션에 "더 만들지 말고 마무리하라"를 한 번 보낸다.
- **작업 규칙**: 앱 일감 규칙(`rulesFor`·서버 `DEFAULT_RULES.common`)에 "중간 확인은 빌드·린트·단위 시험… 스크린샷 e2e는 마지막에 한 번만… 측정·시뮬레이션은 지시문이 요구할 때만" 한 줄이 들어 있다.
- **설정**: 통제실 [설정] → 실행·동시성 → '일감 시간 낭비 막기'(켜기/끄기, 판정 any·result·count, 반복 횟수 2~20, 바뀐 파일 0~50개, 스크린샷 상한 1~120분). 서버가 `/next` 의 `loopGuard` 로 내려 주고, 값이 없으면(예전 서버) 설정 파일의 `loopGuard` 객체, 그것도 없으면 기본값을 쓴다.
- **승인 화면**: 지시문 길이(수정 2500자·새 앱 7500자 이상)·항목 수(12개 이상)·측정/스크린샷 요구로 '예상 큼'을 표시하고 "측정·조사는 실험 일감으로 나누기"를 안내한다(`lib/factory/jobSize.ts`). 안내만 하고 승인은 막지 않는다.
- 시험: `npm run test:loop-guard`. 시험 모드에서만 `FACTORY_TEST_SCREENSHOT_SEC` 로 스크린샷 상한을 초 단위로 줄인다.

## AI 환경·서버 접속 제한 (envfilter.mjs)
- 정비·지휘자·앱 일감·실험이 AI 에게 넘기는 환경변수는 공통 함수 `safeEnv` 로 TOKEN·PASSWORD·SECRET·API_KEY·PRIVATE_KEY 모양 이름을 뺀다. 감독이 정한 FACTORY_* 허용 목록과 앱 일감 requiredSecrets 키만 더한다.
- 앱 일감 권한 설정에 `Read(~/.ssh/**)`·`Read(~/.aws/**)` 금지가 있다(ssh 명령 자체는 서버 접근 훅 규칙대로).
- Codex 는 ssh-guard 훅이 없어서 `startAi` 가 PATH 앞에 안내 스크립트(ssh·scp·rsync·sftp 등)를 둔다. 서버 작업은 "Claude Code 로 다시 보내세요"로 실패한다. 시험: `tests/envfilter.test.mjs`.

## 오래된 사본 표시 (1-5)
- 작업 폴더 아래 `buyoungsil-dev-web`(예전 개발용 사본, `.git` 있음)이 있으면 `/next` 에 `staleCopies=<이름>` 만 붙인다(1회 `existsSync` 한 번, 지우지 않음). 서버가 이름 모양을 걸러 상태(`staleCopies`)에 싣고 통제실 감독 카드에 "오래된 사본(정리 필요)"로 보인다. 감독·일감은 이 폴더를 쓰지 않는다(실행은 `supervisor-src`, 정비는 `selfdev`).
- 전체 시험은 `npm test`(`scripts/run-all-tests.mjs`: 시험 파일을 모두 찾아 돌리고 표로 요약, `--jobs=4` 로 동시에, 이름 일부를 주면 그것만). 개별 `test:*` 스크립트는 그대로 있다.

## 앱별 배포·저장소 연결 보고 (1-6: `projectlinks.mjs`)
- 하루 1번(시작 20초 뒤 포함)과 통제실 [새로 읽기] 때 `POST /api/factory/project-links` 로 보고한다. 읽기만 한다.
  - 작업 폴더 바로 아래 폴더마다 `git remote -v`, `git symbolic-ref --short -q HEAD`, 종류(파일로 짐작). 제외: lab, supervisor-src, selfdev, buyoungsil-dev-web. git 이 아닌 폴더도 `isGit:false` 로 보낸다.
  - 서버1·서버2 컨테이너 이름: 서버 접속 명령으로 `docker ps --format '{{.Names}}'` 한 줄만(BatchMode). 못 읽으면 `unknown`(그러면 통제실이 '컨테이너를 못 찾았다'고 말하지 않는다).
  - 원격 주소의 자격 증명(`user:pass@`)은 보내기 전에 지운다(서버도 한 번 더). git 원격 추가·삭제·이름 변경, 컨테이너 조작, nginx 읽기는 하지 않는다.
- 서버 쪽: `lib/factory/projectLinks.ts`(순수) · `projectLinksDb.ts`(DB), 표 `factory_app_connections`(도메인·배포 방법·컨테이너·서비스·비고, 현황 조사 초기값), 보고는 `factory_settings.projectLinksReport`.
- 통제실 설정 > 프로젝트·규칙 > "앱별 배포·저장소 연결", 채팅 커넥터 `get_project_links`(읽기 전용). 시험: `npm run test:project-links`.

## 도구 설명서 보고·키 결정 (2-1b: `toolmanifest.mjs`)
- 툴킷의 `tools/manifests/<도구>.json`(형식 `schemas/tool-manifest.schema.json`)을 읽어 `POST /api/factory/tool-manifests` 로 보고한다(읽기만, 도구·파이썬은 실행하지 않는다). 시작 12초 뒤 한 번, 그 뒤 1분마다 **툴킷 커밋(`git rev-parse` 읽기 전용)이나 설명서 내용이 바뀌었는지** 보고 바뀌었을 때만(안 바뀌면 6시간마다) 다시 보낸다. 실패하면 30초부터 10분까지 늦춰 다시 시도하고 폴링·일감에는 영향이 없다(옛 서버의 404 포함).
- 설명서 파일이 없는 도구는 `tools.json`(도구함 정보)으로 최소 설명서를 만들어 같이 보낸다(`source:"fallback"`: 방법은 기본 하나 + `optionalSecrets` 가 가리키는 방법). 본문이 60KB 를 넘으면 최소 설명서부터 뺀다. 구현 안 한 제안 메모(`proposals`)는 보내지 않는다. 키는 이름만 다룬다.
- **방법 → 필요한 키는 `secretsForMethod` 한 곳**에서 정한다: 설명서 파일의 그 방법 `secrets` + `tools.json` 의 `optionalSecrets` 중 `OPTIONAL_SECRET_METHODS` 가 그 방법으로 가리키는 것(PixelLab). 도구 중계(`toolbroker.mjs`)가 이 함수로 호출마다 필요한 키를 정하고, 설명서에만 적힌 키도 도구 전용 키(AI 환경에서 뺌)로 친다. 일감에 키를 자동으로 넣는 쪽은 서버(`enqueue_app_job` 이 지시문이 부르는 방법의 키를 `requiredSecrets` 에 더함).
- 사람이 직접 보기: `node tools/factory-supervisor/toolmanifest.mjs once [툴킷폴더]`. 시험: `npm run test:tool-manifests`.

## 결과물 카드 (2-2: `toolbroker.mjs` 의 카드 파일 · `artregister.mjs` · `lab.mjs`)
- **카드** = 홈페이지 통제실의 프로젝트별 "이런 결과물을 이렇게 만든다"(도구·방법·옵션·참고 규칙). 일감이 카드를 부르면(`enqueue_app_job` 의 `card`) `/api/factory/next` 가 **카드로 만든 pixel-art 설정**을 `projectToolSettings` 로 내려 주고 `card: { id, name, version, rules, … }` 를 붙인다. 감독은 그 설정을 예전처럼 `.factory/project-settings.json` 으로 쓴다(승인 그림은 `card.rules` 의 같은 대상/같은 종류 규칙에 맞게 합침). 기본 그림 고정은 서버가 `pickedArts` 맨 앞에 넣어 준다.
- **호출의 `card` 인자**: `toolkit.run` 의 `args.args.card`(카드 이름 또는 id)를 주면 중계가 `.factory/cards/<id>.json`(카드 설정 + 승인 그림)을 `--settings` 로 붙이고, 고정 그림을 `--refs` 맨 앞에 붙이고, 카드 방법에 필요한 키(예: pixellab → `PIXELLAB_TOKEN`)를 평소처럼 일감의 `requiredSecrets` 에서 넘긴다. `card` 는 도구 인자가 아니라 중계가 떼어 쓰고, `settings` 와 같이 주면 거절한다. 카드 목록은 스튜디오 도구 호출 직전(20초에 한 번) `GET /api/factory/cards?appSlug=` 로 받아 `.factory/cards/` 에 둔다(옛 서버 404 는 카드 없이 계속).
- **그림에 카드 붙이기**: 후보 그림을 올릴 때 `cardId`·`cardVersion` 을 같이 보낸다(호출에 `card` 를 줬으면 그 카드, 아니면 일감의 카드). 카드 없이 만든 그림은 비어 있다.
- **실험 일감**: 카드를 불렀으면 실험 폴더에 `card-settings.json` 을 쓰고 지시문 머리말에 카드 안내(+고정 그림 주소)를 넣는다.
- 시험: `npm run test:result-cards`.

## 도구 일감: AI 없이 카드로 바로 생성 (2-3: `tooljob.mjs`, 일감 종류 `tool`)
- 서버 `/next?toolSlots=N` 이 앱 슬롯(`slots`)과 따로 도구 일감을 내준다. 동시 실행 수는 서버 설정(기본 2, 응답의 `toolJobs.concurrency`). 같은 카드는 동시에 하나. 업데이트 대기(드레인) 중에는 `toolSlots=0`.
- AI 턴이 없다. `factory/tooljobs/<id>` 임시 폴더에서만 `toolkit.run` 어댑터(`toolbroker.mjs`)로 카드의 도구·방법·옵션을 그대로 부른다. 앱 폴더·정비 폴더는 열지 않는다.
- 참고 그림 점검(`refcheck.mjs`): 시작 전에 참고 그림(picked) 주소마다 접속해 본다(응답 머리만, 본문은 버림). 카드 규칙 `pinDefault` 로 고정된 기본 그림이 실패하면(예: 서비스 서버 인증서 만료) 임시 폴더도 만들지 않고 일감을 실패로 끝내며 이유에 '기본 그림 주소 접속 실패(인증서 만료)'와 주소·원인·고칠 곳(서버 인증서·카드의 기본 그림 교체)을 적는다. 고정이 아닌 그림은 목록에서 빼고 진행하고 결과 요약에 몇 장 뺐는지 적는다.
- 키는 일감의 `requiredSecrets` 이면서 설명서가 정한 이 방법의 키만, 도구를 부르는 순간의 환경변수로만. 감독 프로그램 환경(토큰 등)은 물려주지 않고 값은 로그·보고·파일에 남기지 않는다.
- 만든 그림은 `/api/factory/art` 에 후보로(카드 id·판 번호 포함). 업로드 확인 뒤 `deleteToolJobFolder`(그 폴더 하나만, `rm -rf` 아님)로 정리. 못 올리면 폴더를 남기고 실패 보고.
- 비용 한도에 걸리면 `status: needs_confirmation` 으로 보고(`toolResult` 에 비용·그림·메시지). 사람이 확인한 일감(`toolInput.confirmed`)은 카드 설정의 비용 한도를 건너뛴다.
- AI 턴이 필요한 방법(`AI_TURN_METHODS`)은 「지원 안 함」으로 거절한다. 자세한 규칙: `docs/tool-jobs.md`. 시험: `npm run test:tool-jobs`.

## 실패 단계부터 다시 · 배포 되돌리기 (5-2: `stageresume.mjs`, `revert.mjs`)
- **실패 단계부터 다시**: 새 앱·수정 일감이 실패하면 AI 세션을 `<앱 폴더>/.factory/sessions/<일감id>.json` 에 기억한다(비밀값 없음). 서버가 `/next` 의 `job.stageResume: { from, note, label }` 을 붙이면, 같은 세션·같은 작업 폴더가 남아 있을 때 같은 세션으로 "이 단계에서 실패했다, 이 오류를 고쳐라" 짧은 지시만 넣어 이어서 한다. 세션·폴더가 없거나 AI 가 다르거나 3일이 지났거나 병행(작업 사본) 일감이거나 이어서 하기가 바로 실패하면 기존 재실행(처음부터)으로 대신하고 이유를 일감 로그에 남긴다. 업데이트 뒤 이어받기(`pause.mjs`)·출시 일감과는 섞이지 않는다.
- **배포 되돌리기**: `/next` 의 `maintenanceDeploy.revertTo` 가 있으면 정비 폴더에서 되돌리기 커밋(부모 = 지금 GitHub main, 내용 = 대상 커밋, `tools/factory-supervisor` 는 지금 것 유지)을 만들어 일반 push 로 올리고(force push·reset 없음), `deploy_revert_commit` 으로 서버에 알린 뒤 평소 배포 경로로 그 커밋을 서버 배포 저장소에 push 한다. 대상~지금 사이에 `prisma/migrations` 가 바뀌었거나, 정비 폴더에 커밋 안 된 변경·올리지 못한 로컬 커밋이 있으면 만들지 않고 `deploy_done(ok=false)` 로 이유만 보고한다. 일반 배포는 `prevCommit` 대비 마이그레이션 변경 여부를 `deploy_start.migrations` 로 알린다(서버가 되돌리기 가능 여부를 미리 판단). 자세한 내용: `docs/deploy-revert.md`.
- 시험: `npm run test:stage-revert`, `npm run test:stageresume`, `npm run test:revert`.

## 소설 실행기 (`novelrun.mjs`, 7-1)
- 홈페이지 [작품] 탭·채팅에서 **승인된** 소설 작업을 15초 폴링 때 가져와(`/api/novel/jobs/next`) 작품 폴더(`<novelsDir>/<작품>`, 기본 `<workDir>/novels`)에서 git Bash 로 `./cycle.sh NNN [--fresh|--skip-write] --max-rewrites N` 을 돌리고, 판정·필수/권장·글자 수·비용·원고·검수를 올린다. 자세한 규칙은 [docs/novel-jobs.md](../../docs/novel-jobs.md).
- 실행 전 열린 메모를 `reviews/NNN-memo.md` 에 이어 붙인다. cycle.sh 의 동작·git 커밋·푸시는 건드리지 않는다.
- 앱 일감·정비·서버 배포·일시 정지·업데이트/재시작 대기 중에는 시작하지 않고, 소설이 도는 동안 앱 일감을 새로 받지 않는다. 시작할 때 `recover` 로 running 이던 소설 작업을 failed 로 정리한다. 최대 40분.
- 서버가 아직 구버전이면(404) 조용히 10분 뒤 다시 본다.
