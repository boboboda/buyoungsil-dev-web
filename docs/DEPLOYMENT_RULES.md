# 배포 규칙

확인된 사실만 정리한다. 실행 절차의 상세는 `docs/DEPLOYMENT_RUNBOOK.md`를 따른다.
비밀번호·키·환경변수 값은 이 문서를 포함해 일감 계획서, 정비 지시, 문서, 로그, 커밋 어디에도 쓰지 않는다.

## 서버 역할

| 구분 | SSH 별칭 | 역할 |
| --- | --- | --- |
| 서버1 | `serverpc` | 실제 서비스가 도는 서버. nginx, Docker. 배포용 저장소 `~/git-server/repo/<이름>.git`과 `post-receive` 훅 |
| 서버2 | `serverpc2` | 코드 저장소 `~/git-server/repo/<이름>.git` |

서버를 따로 말하지 않으면 서버2가 기본이다.

## 리모트와 브랜치

- `origin` = 서버2 저장소, `prod` = 서버1 배포용 저장소.
- 브랜치는 `main` 하나다. 별도 브랜치는 만들지 않는다.

## 웹 서비스 배포

- `prod`에 푸시하면 서버1의 `post-receive` 훅이 Docker 이미지를 빌드해 띄운다. 웹 서비스 배포는 이 방식으로만 한다.
- 서버1에서 손으로 `docker compose up`을 하지 않는다.

## nginx·인증서·DNS

- 서비스(도메인)마다 별도 server 블록 파일을 `sites-available`에 둔다. 와일드카드 server 블록은 없다.
- 수정 전에 백업하고, `nginx -t`로 검사한 뒤 reload한다.
- 인증서는 도메인별로 certbot으로 따로 발급한다.
- DNS는 `*.buyoungsilcoding.com`이 이미 서버1로 연결돼 있다.

새 서비스를 추가한 예: `cosysoft-site` → 서버1 포트 3101, 도메인 `cosysoft.buyoungsilcoding.com`.

## DB

- `prisma/migrations`의 마이그레이션은 컨테이너가 시작할 때 자동 적용된다. 기존 데이터를 지우는 마이그레이션은 만들지 않는다.
- 스키마 변경이 있는 배포는 배포 전 DB 백업.

## SSH

- 앱 일감은 작업 PC의 `serverpc`, `serverpc2` 별칭으로 비밀번호 없이 접속된다(`cosysoft-site`에서 실제로 성공함).
- 정비 환경은 `ssh`가 `.sbx-denybin/ssh.bat`로 막혀 서버에 접속할 수 없다(`DEPLOYMENT_RUNBOOK.md`에 기록).
- 따라서 서버 접속이 필요한 일(nginx, 인증서, 훅, 저장소 만들기)은 정비가 아니라 앱 일감 안에서 처리한다.
- 정비는 홈페이지·감독 프로그램 코드까지만 고친다. 막힌 SSH를 다른 경로로 우회하지 않는다.

## 배포 승인

- 정비 결과의 서버 배포는 통제실이나 텔레그램에서 관리자가 [배포]를 눌러야 한다.
- 채팅에서는 배포하지 않는다.
