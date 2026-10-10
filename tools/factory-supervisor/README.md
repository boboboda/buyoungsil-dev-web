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
