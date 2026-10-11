# 앱 공장 감독 프로그램

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

## 출시 준비 일감 (`release.mjs`)
- 통제실 "출시 패키지"에서 보내는 `kind=release` 일감이에요. 완성된 앱 폴더에서 `RELEASE_REQUEST.md` 를 보고 출시 자료를 만들어요.
- Claude 는 결과를 `.factory/outbox/project.json`(홈페이지 프로젝트 빈 항목), `.factory/outbox/release.json`(스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·방침 초안·AAB 정보)에 저장해요.
- 일감이 끝나면 감독 프로그램이 이 두 파일만 정해진 주소(`/api/factory/project`, `/api/factory/release`)로 보내고 `outbox/sent/` 로 옮겨요. 다른 파일·주소는 없어요.
- AAB 는 PC 에만 두고, 경로·크기·버전·빌드 시각만 보내요(크기·시각은 감독 프로그램이 실제 파일로 채움).
- 배포 계정의 키 파일 경로가 통제실에 등록돼 있으면, 감독 프로그램이 그 파일이 "있는지"만 확인해 알려요(내용은 읽지 않음, .jks/.keystore/.json 만).
- 서명 비밀번호는 `secrets.env` 의 `RELEASE_<계정>_KEYSTORE_PASSWORD`, `RELEASE_<계정>_KEY_PASSWORD` 에 넣어요.

## 공장 정비 (`maintenance.mjs`)
- 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드예요. 앱 일감과 따로 돌아요(통제실 감독 프로그램 카드, 커넥터 `maintenance_*`).
- 정비 지시가 대기·진행 중이면 서버가 새 앱 일감을 내주지 않고, 감독 프로그램은 돌던 앱 일감이 끝나면 정비를 시작해요.
- 정비 전용 체크아웃 `~/dev/factory/selfdev`(설정 `selfdevDir`)에서 Claude 를 돌려요. 같은 정비의 이어지는 지시는 같은 세션(`--resume`).
  규칙은 `CLAUDE.local.md`(커밋되지 않게 `.git/info/exclude`)에 써요. Claude 는 커밋만 하고 push·배포는 하지 않아요.
- 감독 프로그램이 검사(감독 프로그램 `node --check`, `tsc --noEmit` 오류 0개)를 통과했을 때만 GitHub main 에 올려요. 못 통과하면 커밋은 정비 폴더에 남고 다음 지시에서 이어 해요.
- 서버 코드가 바뀌었으면 "배포 필요". 사람이 통제실·텔레그램에서 [배포]를 누르면 그 커밋(GitHub main 에 있는 것만)을 `deployRemote`(기본 `serverpc:git-server/repo/developWeb.git`)로 push 해요. 서버는 커밋 해시만 보내요.

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

## 앱 폴더 안에서 일어나는 일
- `PLAN.md`(새 앱) 또는 `CHANGE_REQUEST.md`(수정)와 `CLAUDE.md`(작업 규칙)를 만들어 Claude 에게 읽혀요.
- Claude 가 `.factory/phase.txt` 에 단계(scaffold, code, build, screenshots, done)를 쓰면 통제실에 단계로 보여요.
- Claude 가 `.factory/screenshots/` 에 png 를 저장하면 자동으로 올려요.
- 끝나면 앱 폴더에 git 커밋을 남겨요. 수정 지시는 시작 전에 현재 상태를 먼저 커밋해 둬요.

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
