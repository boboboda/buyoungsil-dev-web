#!/usr/bin/env node
// 공장 정비 전용 서버 설정 도구. 정비 Claude 는 서버 설정을 이 도구로만 바꾼다(ssh·docker·.env 직접 접근 금지).
// 정해진 서브커맨드만 있고, 임의 명령 실행 옵션은 없다. ssh 는 이 도구 안에서만(BatchMode, 고정 호스트·경로) 쓴다.
//
//   env-keys                         .env.local 의 키 이름만(값은 절대 출력하지 않음)
//   env-set KEY                      값은 환경변수 SERVERCTL_VALUE 또는 stdin 으로만(명령줄·로그에 값 없음). 반영은 rebuild 로
//   env-set <작업폴더…> [--gen-shared KEY]… [--gen KEY]… [--put KEY] [--host H]
//                                    비밀값을 서버 안에서 만들어 .env.local 에 넣음(값은 어디에도 출력 안 함, 결과는 변수 이름만).
//                                    --gen-shared: 한 번 만든 같은 값을 나열한 모든 폴더에, --gen: 폴더마다 따로(이미 있으면 건너뜀).
//                                    --put KEY: 사람이 정한 값(SERVERCTL_VALUE 환경변수나 stdin 으로만)을 모든 폴더에 넣음(이미 있으면 바꿈).
//                                    폴더에 .env.local 이 없으면 .env 를 씀(한 컷 등)
//                                    폴더마다 백업(~/env-backups/<폴더>/), 권한 600, 하나라도 실패하면 모두 되돌림
//   env-unset KEY
//   nginx-show                       대상 사이트 설정 파일 내용
//   nginx-set-directive NAME VALUE [LOCATION]   허용된 지시어만. LOCATION 이 없으면 https server 블록 바로 아래
//   nginx-apply FILE                 통째 교체(검증 후)
//   rebuild                          .env 반영용 재빌드(배포 훅과 같은 방식). 실패하면 .env·이미지 되돌림
//   restore TIMESTAMP                백업으로 복원(nginx 면 검증·reload, .env 면 rebuild 필요)
//   backups                          백업 목록
//
// 새 사이트 만들기(서버 작업 권한을 공장에 넘긴 뒤, 2026-10-15). 대상 서버는 --host serverpc(기본)·serverpc2 만:
//   site-init NAME --from SRC        ~/git-server/repo/NAME.git(bare) + SRC 의 post-receive 훅 복사(이름 4곳 치환) + work/NAME clone. 이미 있으면 멈춤
//   env-clone SRC_WORK DST_WORK [--set KEY=VALUE]… [--gen KEY]…
//                                    서버 안에서만 .env.local 복사(600). --set 은 같은 이름 줄을 지우고 새로, --gen 은 서버에서 openssl rand -hex 32.
//                                    값은 서버 밖으로 나오지 않고, 결과는 변수 이름만. 대상이 있으면 백업 후 진행
//   nginx-site NAME --domain D --port P [--body 300m]
//                                    sites-available/NAME 새로 만들고 링크 → nginx -t → reload → 헬스체크, 실패하면 지움. 기존 사이트 파일은 고치지 않음
//   cert DOMAIN                      certbot --nginx --redirect(사이트 파일 백업, 실패하면 복원). 인증서 내용은 출력하지 않음
//   deploy-push APP_DIR REMOTE URL   작업 PC 앱 폴더에 배포 원격을 추가하고 main push → 서버 배포 로그 끝·컨테이너 확인
//   app-update NAME [--host H] [--probe PATH]… [--domain D]
//                                    배포 훅이 없는 앱(한 컷): 서버 작업 폴더에서 origin main 을 ff-only 로 받고 compose up -d --build → 컨테이너·경로 응답 확인.
//                                    실패하면 이전 이미지·커밋으로 되돌림. 경로는 토큰 없이 부른 응답 코드만 보고(기본 /health). --domain 이면 공개 주소도 확인
//   web-release APP_DIR [--site NAME] [--host H] [--domain D]
//                                    새싹 허브 /preview/ 같은 정적 웹: APP_DIR/build/preview(+.gz)와 tools/web/server 설정 4개를 서버 작업 폴더(기본 saessak-hub-web)에 올림.
//                                    새 nginx 설정은 임시 컨테이너로 먼저 검사, 바꾸기 전 백업, 실패하면 설정·링크 되돌림, /preview/ 와 / 200·헤더 확인
//   service-token NAME --env-key KEY --secret SERVICE_ADMIN_TOKEN_<앱> [--host H] [--probe PATH]… [--domain D]
//                                    서비스 관리자 토큰 짝 맞추기(한 컷): 이 PC 프로세스 메모리에서 32바이트 값을 한 번 만들어
//                                    ① 서버 작업 폴더 .env(.local) 의 KEY 에 넣고(백업·600) ② 홈페이지 키 보관함(/api/factory/service-token, 감독 토큰)에 저장
//                                    ③ 컨테이너를 다시 만들어(compose up -d --force-recreate) 새 값을 읽게 하고 첫 경로 200·나머지 경로(토큰 없이) 401 확인.
//                                    어느 단계든 실패하면 둘 다 되돌림(.env 백업 복원, 보관함 이전 값 복원 또는 삭제, 컨테이너 재시작). 값은 출력·로그·파일·인자에 남지 않음
//
// 안전 절차: 바꾸기 전에 백업(작업 폴더 밖, 최근 20개) → 바꾸고 검증(nginx -t, reload, 헬스체크 / rebuild, 헬스체크)
//           → 실패하면 자동 되돌림. 바꿀 때마다 정비 대화와 텔레그램에 "무엇을·백업·검증 결과"를 남긴다(값 제외).
//           새 사이트 명령은 서버의 ~/serverctl-actions.log 에도 한 줄씩 남긴다(값 제외).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

// 정비 보호 훅(pcguard.mjs)도 이 목록으로 "신뢰된 serverctl 호출"을 가린다
export const SUBCOMMANDS = ["env-keys", "env-set", "env-unset", "nginx-show", "nginx-set-directive", "nginx-apply", "rebuild", "restore", "backups", "site-init", "env-clone", "nginx-site", "cert", "deploy-push", "app-update", "web-release", "service-token"];
const HOST = "serverpc";
const HOSTS = ["serverpc", "serverpc2"]; // 우리 서버 두 대만(serveraccess.mjs 의 SERVER_HOSTS 와 같게)
// 시험 모드(FACTORY_TEST_MODE=1)에서만 가짜 ssh·가짜 홈페이지 주소를 쓴다. 진짜 실행에서는 환경변수로 바꿀 수 없다
const TEST = process.env.FACTORY_TEST_MODE === "1";
const SITE_URL = (TEST && process.env.SERVERCTL_SITE_URL) || "https://www.buyoungsilcoding.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const TS_RE = /^\d{8}-\d{6}$/;
const NGINX_DIRECTIVES = {
  client_max_body_size: /^\d{1,5}[kKmMgG]?$/,
  client_body_timeout: /^\d{1,5}[smh]?$/,
  proxy_read_timeout: /^\d{1,6}[smh]?$/,
  proxy_connect_timeout: /^\d{1,5}[smh]?$/,
  proxy_send_timeout: /^\d{1,6}[smh]?$/,
  send_timeout: /^\d{1,5}[smh]?$/,
  keepalive_timeout: /^\d{1,5}[smh]?$/,
};
const LOCATION_RE = /^(=\s|~\s|\^~\s)?\/[A-Za-z0-9_\-./]*$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/; // 저장소·작업 폴더·nginx 사이트 이름
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const BODY_RE = /^\d{1,4}[kKmMgG]?$/;
const REMOTE_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;
const DEPLOY_URL_RE = /^(serverpc|serverpc2):git-server\/repo\/([A-Za-z][A-Za-z0-9_-]{0,40})\.git$/;
const home = os.homedir();
const STATE = (TEST && process.env.SERVERCTL_STATE) || path.join(home, "dev", "factory", "serverctl-state.json");
// 감독 설정(홈페이지 주소·감독 토큰): 보고와 service-token 의 보관함 저장에 쓴다.
// 시험 모드는 임시 설정(FACTORY_CONFIG)만 쓰고 진짜 설정으로 되돌아가지 않는다(시험이 진짜 홈페이지에 닿지 않게)
const CONFIG = TEST ? process.env.FACTORY_CONFIG || "" : path.join(home, "dev", "factory", "supervisor.config.json");

// ───────── 서버 쪽 고정 스크립트(인자는 아래에서 형식 검사 후에만 넘긴다) ─────────
const REMOTE = String.raw`
set -u
WORK="$HOME/git-server/work/developWeb"; ENVF="$WORK/.env.local"
NGE=/etc/nginx; NGBIN=/usr/sbin/nginx
# 시험(가짜 ssh)에서만 주는 경로. 진짜 서버에는 ssh 가 이 환경변수를 넘기지 않아 기본값을 쓴다
[ -n "$(printenv SERVERCTL_NGINX_ETC)" ] && NGE=$(printenv SERVERCTL_NGINX_ETC)
[ -n "$(printenv SERVERCTL_NGINX_BIN)" ] && NGBIN=$(printenv SERVERCTL_NGINX_BIN)
ENVB="$HOME/env-backups/developWeb"; NGF="$NGE/sites-enabled/default"; NGB="$HOME/nginx-backups"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$ENVB" "$NGB"; chmod 700 "$HOME/env-backups" "$ENVB" "$NGB"; chmod 600 "$ENVB"/.env.local.bak-* "$NGB"/default.bak-* 2>/dev/null
prune() { ls -1t "$1"/$2.bak-* 2>/dev/null | tail -n +21 | xargs -r rm -f; }
env_backup() { B="$ENVB/.env.local.bak-$TS"; cp "$ENVF" "$B"; chmod 600 "$B"; prune "$ENVB" .env.local; echo "BACKUP $B"; }
ng_backup() { B="$NGB/default.bak-$TS"; sudo -n cat "$NGF" > "$B"; chmod 600 "$B"; prune "$NGB" default; echo "BACKUP $B"; }
ng_put() { sudo -n tee "$NGF" < "$1" > /dev/null; }
ng_test() { OUT=$(sudo -n "$NGBIN" -t 2>&1); R=$?; echo "$OUT" | tail -3; return $R; }
act() { echo "$(date '+%F %T') $*" >> "$HOME/serverctl-actions.log"; }
dom_re() { printf %s "$1" | sed 's/\./\\./g'; }
site_of() { sudo -n grep -RlsE "server_name[^;]*[[:space:]]$(dom_re "$1")([[:space:];]|$)" "$NGE/sites-enabled/" | head -1; }
hook_info() {
  H="$HOME/git-server/repo/$1.git/hooks/post-receive"; [ -f "$H" ] || { echo "NO_HOOK"; exit 2; }
  LF=$(grep -oE '^LOG_FILE="[^"]+"' "$H" | head -1 | cut -d'"' -f2); CN=$(grep -oE 'docker logs [A-Za-z0-9_.-]+' "$H" | head -1 | cut -d' ' -f3)
}
case "$1" in
  env-keys) grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENVF" | sed 's/=$//' ;;
  env-set|env-unset)
    KEY="$2"; V=""; [ "$1" = env-set ] && IFS= read -r V
    env_backup
    T="$ENVB/.tmp-$TS"; FOUND=0; : > "$T"; chmod 600 "$T"
    while IFS= read -r L || [ -n "$L" ]; do
      if [[ "$L" == "$KEY="* ]]; then FOUND=1; [ "$1" = env-set ] && printf '%s=%s\n' "$KEY" "$V" >> "$T"; else printf '%s\n' "$L" >> "$T"; fi
    done < "$ENVF"
    [ "$1" = env-set ] && [ $FOUND = 0 ] && printf '%s=%s\n' "$KEY" "$V" >> "$T"
    cat "$T" > "$ENVF"; rm -f "$T"; V=""
    if [ "$1" = env-set ]; then [ $FOUND = 1 ] && echo "CHANGED $KEY" || echo "ADDED $KEY"; else [ $FOUND = 1 ] && echo "REMOVED $KEY" || echo "ABSENT $KEY"; fi ;;
  env-multi)
    # 인자: 작업 폴더 이름들. 표준입력: "shared<TAB>KEY" / "gen<TAB>KEY" 줄. 전부 준비된 뒤에야 바꾸고, 하나라도 실패하면 되돌린다
    shift; umask 077; PLAN=""; DONE_N=""
    # 환경 파일은 폴더마다 .env.local 이 있으면 그것, 없으면 .env (한 컷처럼 .env 를 쓰는 앱). 줄 종류: shared·gen(서버에서 생성) / val(넘겨받은 값)
    envf() { if [ -f "$HOME/git-server/work/$1/.env.local" ]; then echo .env.local; elif [ -f "$HOME/git-server/work/$1/.env" ]; then echo .env; fi; }
    for N in "$@"; do [ -n "$(envf "$N")" ] || { echo "NO_ENV $N"; exit 2; }; done
    while IFS=$'\t' read -r OP K V0; do
      [ -z "$OP" ] && continue
      V=""
      if [ "$OP" = shared ]; then V=$(openssl rand -hex 32 2>/dev/null); [[ "$V" =~ ^[0-9a-f]{64}$ ]] || { V=""; PLAN=""; echo "GEN_FAIL $K"; exit 3; }; fi
      if [ "$OP" = val ]; then V="$V0"; fi
      PLAN="$PLAN$OP"$'\t'"$K"$'\t'"$V"$'\n'; V=""; V0=""
    done
    cleanup() { for N in "$@"; do F=$(envf "$N"); rm -f "$HOME/git-server/work/$N/$F.serverctl-$TS" "$HOME/git-server/work/$N/$F.serverctl-$TS.n"; done; }
    for N in "$@"; do
      F=$(envf "$N"); D="$HOME/git-server/work/$N/$F"; EB="$HOME/env-backups/$N"; mkdir -p "$EB"; chmod 700 "$HOME/env-backups" "$EB"
      B="$EB/$F.bak-$TS"; cp "$D" "$B" && chmod 600 "$B" || { cleanup "$@"; echo "BACKUP_FAIL $N"; exit 3; }
      prune "$EB" "$F"; echo "BACKUP $B"
      T="$D.serverctl-$TS"; cp "$D" "$T" && chmod 600 "$T" || { cleanup "$@"; echo "COPY_FAIL $N"; exit 3; }
      [ -n "$(tail -c1 "$T")" ] && echo >> "$T"
      while IFS=$'\t' read -r OP K V; do
        [ -z "$OP" ] && continue
        if [ "$OP" = gen ]; then
          if grep -q "^$K=" "$T"; then echo "SKIP $N $K"; continue; fi
          V=$(openssl rand -hex 32 2>/dev/null); [[ "$V" =~ ^[0-9a-f]{64}$ ]] || { V=""; PLAN=""; cleanup "$@"; echo "GEN_FAIL $K"; exit 3; }
        fi
        grep -v "^$K=" "$T" > "$T.n"; cat "$T.n" > "$T"; rm -f "$T.n"
        printf '%s=%s\n' "$K" "$V" >> "$T"; V=""
        echo "SET $OP $N $K"
      done <<< "$PLAN"
    done
    for N in "$@"; do
      F=$(envf "$N"); D="$HOME/git-server/work/$N/$F"
      if ! { mv -f "$D.serverctl-$TS" "$D" && chmod 600 "$D"; }; then
        cleanup "$@"
        for M in $DONE_N; do FM=$(envf "$M"); cat "$HOME/env-backups/$M/$FM.bak-$TS" > "$HOME/git-server/work/$M/$FM"; echo "RESTORED $M"; done
        PLAN=""; echo "MOVE_FAIL $N"; exit 3
      fi
      DONE_N="$DONE_N $N"
    done
    PLAN=""; act "env-multi$(printf ' %s' "$@")"
    for N in "$@"; do echo "MODE $N $(stat -c %a "$HOME/git-server/work/$N/$(envf "$N")")"; done ;;
  env-restore)
    F="$ENVB/.env.local.bak-$2"; [ -f "$F" ] || { echo "NO_BACKUP"; exit 2; }
    env_backup; cat "$F" > "$ENVF"; echo "RESTORED $F" ;;
  nginx-show) sudo -n cat "$NGF" ;;
  nginx-apply)
    ng_backup; N="$NGB/.new-$TS"; cat > "$N"; chmod 600 "$N"; ng_put "$N"; rm -f "$N"
    if ! ng_test; then ng_put "$B"; echo "TEST_FAIL"; ng_test > /dev/null && echo "RESTORED $B"; exit 3; fi
    if ! sudo -n systemctl reload nginx; then ng_put "$B"; sudo -n systemctl reload nginx; echo "RELOAD_FAIL RESTORED $B"; exit 4; fi
    echo "APPLIED $B" ;;
  nginx-restore)
    F="$NGB/default.bak-$2"; [ -f "$F" ] || { echo "NO_BACKUP"; exit 2; }
    ng_backup; ng_put "$F"
    if ! ng_test; then ng_put "$B"; echo "TEST_FAIL"; exit 3; fi
    sudo -n systemctl reload nginx && echo "RESTORED $F" ;;
  backups)
    echo "[.env.local]"; ls -1t "$ENVB"/.env.local.bak-* 2>/dev/null | head -20 | sed 's#.*/##'
    echo "[nginx]"; ls -1t "$NGB"/default.bak-* 2>/dev/null | head -20 | sed 's#.*/##' ;;
  rebuild-start)
    cd "$WORK" || exit 2
    IMG=$(docker inspect developWeb --format '{{.Config.Image}}' | cut -d: -f1)
    docker tag "$IMG:latest" "$IMG:rollback-$TS" && echo "ROLLBACK_TAG rollback-$TS"
    docker images "$IMG" --format '{{.Tag}}' | grep '^rollback-' | sort -r | tail -n +4 | xargs -r -I{} docker rmi "$IMG:{}" > /dev/null 2>&1
    nohup bash -c 'export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 BUILDKIT_PROGRESS=plain; cp .env.local .env.temp && docker-compose build --build-arg ENV_FILE=.env.temp && docker-compose up -d && echo REBUILD_OK; rm -f .env.temp; echo REBUILD_END' > "$HOME/serverctl-rebuild.log" 2>&1 < /dev/null &
    echo "STARTED" ;;
  rebuild-status) grep -aE 'REBUILD_OK|REBUILD_END|Failed to compile|ERROR' "$HOME/serverctl-rebuild.log" | tail -5 ;;
  image-rollback)
    cd "$WORK" || exit 2
    IMG=$(docker inspect developWeb --format '{{.Config.Image}}' | cut -d: -f1)
    docker tag "$IMG:$2" "$IMG:latest" && docker-compose up -d > /dev/null 2>&1 && echo "ROLLED_BACK $2" ;;
  site-init)
    N="$2"; F="$3"; R="$HOME/git-server/repo"; W="$HOME/git-server/work"
    for P in "$R/$N.git" "$W/$N"; do [ -e "$P" ] && { echo "EXISTS $P"; exit 6; }; done
    SH="$R/$F.git/hooks/post-receive"; [ -f "$SH" ] || { echo "NO_SOURCE_HOOK $SH"; exit 2; }
    FL=$(printf %s "$F" | tr 'A-Z' 'a-z'); NL=$(printf %s "$N" | tr 'A-Z' 'a-z'); HT=$(mktemp)
    sed -E -e "s#^REPO_DIR=\"(.*)/git-server/repo/$F\.git\"#REPO_DIR=\"\1/git-server/repo/$N.git\"#" \
      -e "s#^WORK_DIR=\"(.*)/git-server/work/$F\"#WORK_DIR=\"\1/git-server/work/$N\"#" \
      -e "s#^LOG_FILE=\"(.*)/deploy-$FL\.log\"#LOG_FILE=\"\1/deploy-$NL.log\"#" \
      -e "s#docker logs $F( |\$)#docker logs $N\1#" "$SH" > "$HT"
    C=0
    for P in "^REPO_DIR=\"[^\"]*/git-server/repo/$N\.git\"" "^WORK_DIR=\"[^\"]*/git-server/work/$N\"" "^LOG_FILE=\"[^\"]*/deploy-$NL\.log\"" "docker logs $N( |$)"; do grep -qE "$P" "$HT" && C=$((C+1)); done
    LEFT=$(grep -ci "$F" "$HT")
    if [ "$C" != 4 ] || [ "$LEFT" != 0 ]; then rm -f "$HT"; echo "RENAME_FAIL replaced=$C/4 left=$LEFT"; exit 7; fi
    mkdir -p "$W"
    if ! git init -q --bare "$R/$N.git"; then rm -f "$HT"; echo "INIT_FAIL"; exit 8; fi
    cp "$HT" "$R/$N.git/hooks/post-receive"; chmod 755 "$R/$N.git/hooks/post-receive"; rm -f "$HT"
    # 방금 만든 것만 되돌린다(위에서 둘 다 없던 것을 확인했다)
    if ! git clone -q "$R/$N.git" "$W/$N" 2>&1; then rm -rf "$R/$N.git" "$W/$N"; echo "CLONE_FAIL ROLLED_BACK"; exit 8; fi
    act "site-init $N from $F"
    echo "CREATED $R/$N.git"; echo "CLONED $W/$N"
    grep -nE '^(REPO_DIR|WORK_DIR|LOG_FILE)=|docker logs' "$R/$N.git/hooks/post-receive" ;;
  env-clone)
    S="$HOME/git-server/work/$2/.env.local"; DD="$HOME/git-server/work/$3"; D="$DD/.env.local"
    [ -f "$S" ] || { echo "NO_SOURCE"; exit 2; }
    [ -d "$DD" ] || { echo "NO_TARGET_DIR"; exit 2; }
    umask 077
    if [ -e "$D" ]; then
      EB="$HOME/env-backups/$3"; mkdir -p "$EB"; chmod 700 "$HOME/env-backups" "$EB"
      B="$EB/.env.local.bak-$TS"; cp "$D" "$B" && chmod 600 "$B" || { echo "BACKUP_FAIL"; exit 3; }
      prune "$EB" .env.local; echo "BACKUP $B"
    fi
    T="$DD/.env.local.serverctl-$TS"
    cp "$S" "$T" && chmod 600 "$T" || { rm -f "$T"; echo "COPY_FAIL"; exit 3; }
    [ -n "$(tail -c1 "$T")" ] && echo >> "$T"
    DONE=""
    while IFS=$'\t' read -r OP K V; do
      [ -z "$OP" ] && continue
      if [ "$OP" = gen ]; then V=$(openssl rand -hex 32 2>/dev/null); [[ "$V" =~ ^[0-9a-f]{64}$ ]] || { rm -f "$T"; V=""; echo "GEN_FAIL $K"; exit 3; }; fi
      grep -v "^$K=" "$T" > "$T.n"; cat "$T.n" > "$T"; rm -f "$T.n"
      printf '%s=%s\n' "$K" "$V" >> "$T"; V=""
      echo "$(printf %s "$OP" | tr 'a-z' 'A-Z') $K"; DONE="$DONE $OP:$K"
    done
    mv -f "$T" "$D" && chmod 600 "$D" || { rm -f "$T"; echo "MOVE_FAIL"; exit 3; }
    act "env-clone $2 -> $3$DONE"
    echo "MODE $(stat -c %a "$D")"; echo "KEYS"; grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$D" | sed 's/=$//' ;;
  nginx-site)
    N="$2"; DOM="$3"; A="$NGE/sites-available/$N"; E="$NGE/sites-enabled/$N"
    if sudo -n test -e "$A" || sudo -n test -e "$E" || sudo -n test -L "$E"; then echo "EXISTS $N"; exit 6; fi
    [ -n "$(site_of "$DOM")" ] && { echo "DOMAIN_TAKEN $(site_of "$DOM")"; exit 6; }
    NB="$NGB/.site-$N-$TS"; cat > "$NB"; chmod 600 "$NB"
    if ! { sudo -n tee "$A" < "$NB" > /dev/null && sudo -n ln -s "$A" "$E"; }; then sudo -n rm -f "$E" "$A"; rm -f "$NB"; echo "WRITE_FAIL"; exit 3; fi
    rm -f "$NB"
    if ! ng_test; then sudo -n rm -f "$E" "$A"; echo "TEST_FAIL"; ng_test > /dev/null && echo "RESTORED"; exit 3; fi
    if ! sudo -n systemctl reload nginx; then sudo -n rm -f "$E" "$A"; sudo -n systemctl reload nginx; echo "RELOAD_FAIL RESTORED"; exit 4; fi
    act "nginx-site $N $DOM"; echo "APPLIED $A" ;;
  nginx-site-undo)
    # 헬스체크 실패 때: 이 도구가 만든 파일(첫 줄 표시)만 지운다
    N="$2"; A="$NGE/sites-available/$N"; E="$NGE/sites-enabled/$N"
    sudo -n head -1 "$A" | grep -q "^# serverctl nginx-site $N " || { echo "NOT_OURS"; exit 2; }
    sudo -n rm -f "$E" "$A"; ng_test > /dev/null && sudo -n systemctl reload nginx && { act "nginx-site-undo $N"; echo "REMOVED $N"; } ;;
  cert)
    DOM="$2"; F=$(site_of "$DOM"); [ -n "$F" ] || { echo "NO_SITE"; exit 2; }
    RF=$(readlink -f "$F"); BN=$(basename "$RF"); CB="$NGB/$BN.bak-$TS"
    sudo -n cat "$RF" > "$CB" && chmod 600 "$CB" || { echo "BACKUP_FAIL"; exit 3; }
    prune "$NGB" "$BN"; echo "BACKUP $CB"; echo "SITE $BN"
    OUT=$(sudo -n certbot --nginx -d "$DOM" --redirect --non-interactive --agree-tos --keep-until-expiring 2>&1); R=$?
    echo "$OUT" | grep -vE 'BEGIN|END|PRIVATE|-----|^[A-Za-z0-9+/=]{16,}$' | grep -vE '^\s*$' | tail -6
    if [ $R != 0 ] || ! ng_test > /dev/null; then
      sudo -n tee "$RF" < "$CB" > /dev/null; ng_test > /dev/null && sudo -n systemctl reload nginx && echo "RESTORED $CB"
      act "cert $DOM FAILED"; echo "CERT_FAIL"; exit 5
    fi
    sudo -n systemctl reload nginx; act "cert $DOM"; echo "CERT_OK" ;;
  cert-undo)
    F="$NGB/$2.bak-$3"; RF=$(readlink -f "$NGE/sites-enabled/$2"); [ -f "$F" ] && [ -n "$RF" ] || { echo "NO_BACKUP"; exit 2; }
    sudo -n tee "$RF" < "$F" > /dev/null; ng_test > /dev/null && sudo -n systemctl reload nginx && { act "cert-undo $2"; echo "RESTORED $F"; } ;;
  deploy-info)
    hook_info "$2"; echo "LOG $LF"; echo "CONTAINER $CN"
    if [ -f "$LF" ]; then echo "LINES $(wc -l < "$LF")"; else echo "LINES 0"; fi ;;
  deploy-status)
    hook_info "$2"; FROM=$(( $3 + 1 ))
    [ -f "$LF" ] && tail -n +$FROM "$LF" | grep -aqE '^\[[0-9:]+\] === .*\([0-9]+[^)]*\) ===' && echo "LOG_END"
    [ -f "$LF" ] && tail -n +$FROM "$LF" | tail -25 | sed 's/^/| /'
    docker ps --filter "name=^$CN\$" --format 'RUNNING {{.Names}} {{.Status}}' ;;
  *) echo "UNKNOWN"; exit 9 ;;
esac
`;

// 배포 훅이 없는 앱 업데이트용 원격 스크립트(REMOTE 가 윈도우 ssh 명령줄 한도에 가까워 따로 둔다)
const REMOTE_APP = String.raw`
set -u
TS=$(date +%Y%m%d-%H%M%S)
act() { echo "$(date '+%F %T') $*" >> "$HOME/serverctl-actions.log"; }
case "$1" in
  app-update-start)
    # 배포 훅이 없는 앱(한 컷): 작업 폴더가 가진 origin(서버의 배포 저장소)의 main 을 fast-forward 로만 받고, compose 로 다시 빌드·실행한다
    N="$2"; D="$HOME/git-server/work/$N"; LF="$HOME/serverctl-app-$N.log"
    [ -d "$D/.git" ] && [ -f "$D/docker-compose.yml" ] || { echo "NO_WORK $N"; exit 2; }
    cd "$D" || exit 2
    CN=$(docker compose ps -q </dev/null 2>/dev/null | head -1); OLD=$(git rev-parse HEAD); IMGN=""; TAG=""
    if [ -n "$CN" ]; then
      IMGN=$(docker inspect "$CN" --format '{{.Config.Image}}'); IID=$(docker inspect "$CN" --format '{{.Image}}')
      TAG="serverctl-rollback/$N:$TS"; docker tag "$IID" "$TAG" || TAG=""
    fi
    git fetch -q origin main </dev/null 2>&1 || { echo "FETCH_FAIL"; exit 3; }
    git merge --ff-only -q origin/main </dev/null 2>&1 || { echo "MERGE_FAIL"; exit 3; }
    echo "OLD $(git rev-parse --short "$OLD")"; echo "NEW $(git rev-parse --short HEAD)"; echo "OLDFULL $OLD"; echo "IMAGE_NAME $IMGN"; echo "ROLLBACK_TAG $TAG"
    nohup bash -c 'docker compose up -d --build && echo UPDATE_OK; echo UPDATE_END' > "$LF" 2>&1 < /dev/null &
    act "app-update $N $(git rev-parse --short HEAD)"; echo "STARTED" ;;
  app-update-status)
    LF="$HOME/serverctl-app-$2.log"
    [ -f "$LF" ] && tail -n 12 "$LF" | sed 's/^/| /'
    grep -q '^UPDATE_END' "$LF" 2>/dev/null && echo "UPDATE_END"
    grep -q '^UPDATE_OK' "$LF" 2>/dev/null && echo "UPDATE_OK"; true ;;
  app-health)
    # 인자: 작업 폴더, 확인할 경로들(토큰 없이 부른 응답 코드만 본다)
    N="$2"; shift 2; cd "$HOME/git-server/work/$N" || exit 2
    CN=$(docker compose ps -q </dev/null 2>/dev/null | head -1); [ -n "$CN" ] || { echo "NO_CONTAINER"; exit 2; }
    A=$(docker port "$CN" 2>/dev/null | head -1 | sed 's/.*-> //; s/^0\.0\.0\.0/127.0.0.1/; s/^\[::\]/127.0.0.1/')
    [ -n "$A" ] || { echo "NO_PORT"; exit 2; }
    FIRST=1
    for P in "$@"; do
      C=000
      # 첫 경로(/health)는 컨테이너가 뜰 때까지 기다리고, 나머지는 한 번만 부른다
      for _ in 1 2 3 4 5 6 7 8 9 10; do C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://$A$P"); [ "$C" = 200 ] && break; [ $FIRST = 1 ] || break; sleep 4; done
      FIRST=0; echo "PROBE $P $C"
    done ;;
  app-update-rollback)
    N="$2"; OLD="$3"; TAG="$4"; IMGN="$5"; cd "$HOME/git-server/work/$N" || exit 2
    git reset --keep -q "$OLD" 2>&1 || echo "GIT_RESET_FAIL"
    if [ -n "$TAG" ] && [ -n "$IMGN" ]; then docker tag "$TAG" "$IMGN" || { echo "TAG_FAIL"; exit 3; }; fi
    docker compose up -d --no-build </dev/null 2>&1 | tail -3
    act "app-update-rollback $N $OLD"; echo "ROLLED_BACK" ;;
  app-restart)
    # .env 를 바꾼 뒤 컨테이너가 새 값을 읽게 다시 만든다(빌드 없음). service-token 이 쓴다
    N="$2"; D="$HOME/git-server/work/$N"; LF="$HOME/serverctl-app-$N.log"
    [ -d "$D/.git" ] && [ -f "$D/docker-compose.yml" ] || { echo "NO_WORK $N"; exit 2; }
    cd "$D" || exit 2
    if docker compose up -d --force-recreate --no-build </dev/null > "$LF" 2>&1; then act "app-restart $N"; echo "RESTARTED"; else tail -n 5 "$LF" | sed 's/^/| /'; echo "RESTART_FAIL"; exit 3; fi ;;
  env-restore-work)
    # service-token 되돌리기: env-multi 가 남긴 백업(시각 $3)으로 작업 폴더의 .env.local(없으면 .env)을 되돌린다
    N="$2"; D="$HOME/git-server/work/$N"; F=.env.local; [ -f "$D/.env.local" ] || F=.env
    B="$HOME/env-backups/$N/$F.bak-$3"; [ -f "$B" ] || { echo "NO_BACKUP"; exit 2; }
    cat "$B" > "$D/$F" && chmod 600 "$D/$F" || { echo "RESTORE_FAIL"; exit 3; }
    act "env-restore-work $N $3"; echo "RESTORED $B" ;;
  *) echo "UNKNOWN"; exit 9 ;;
esac
`;

// 정적 웹 릴리스용 원격 스크립트(REMOTE 가 윈도우 ssh 명령줄 한도에 가까워 따로 둔다)
const REMOTE_WEB = String.raw`
set -u
TS=$(date +%Y%m%d-%H%M%S)
act() { echo "$(date '+%F %T') $*" >> "$HOME/serverctl-actions.log"; }
case "$1" in
  web-release)
    # 정적 웹 컨테이너(nginx)에 /preview/ 빌드와 설정을 올린다. 표준입력: tar.gz(site/ = 빌드 결과, conf/ = docker-compose.yml default.conf headers.conf preview-headers.conf)
    # 설정은 임시 컨테이너로 먼저 검사하고, 바꾸기 전 백업. 어느 단계든 실패하면 설정·링크를 되돌린다
    N="$2"; D="$HOME/git-server/work/$N"; umask 022
    [ -f "$D/docker-compose.yml" ] || { echo "NO_SITE $N"; exit 2; }
    cd "$D" || exit 2
    ST="$D/.release-$TS"; BK="$HOME/web-backups/$N/$TS"; CF="docker-compose.yml default.conf headers.conf preview-headers.conf"
    mkdir -p "$ST" && tar -xzf - -C "$ST" || { rm -rf "$ST"; echo "UNTAR_FAIL"; exit 3; }
    [ -f "$ST/site/index.html" ] || { rm -rf "$ST"; echo "NO_INDEX"; exit 3; }
    for F in $CF; do [ -f "$ST/conf/$F" ] || { rm -rf "$ST"; echo "NO_CONF $F"; exit 3; }; done
    if ! docker run --rm -v "$ST/conf/default.conf:/etc/nginx/conf.d/default.conf:ro" -v "$ST/conf/headers.conf:/etc/nginx/headers.conf:ro" -v "$ST/conf/preview-headers.conf:/etc/nginx/preview-headers.conf:ro" nginxinc/nginx-unprivileged:stable-alpine nginx -t -q </dev/null 2>&1; then rm -rf "$ST"; echo "NGINX_TEST_FAIL"; exit 3; fi
    echo "NGINX_TEST_OK"
    mkdir -p "$BK" "$D/public/preview-site"; chmod 700 "$HOME/web-backups" "$HOME/web-backups/$N" "$BK"
    for F in $CF; do [ -f "$D/$F" ] && cp -p "$D/$F" "$BK/$F"; done
    ls -1t "$HOME/web-backups/$N" | tail -n +11 | while read -r O; do rm -rf "$HOME/web-backups/$N/$O"; done
    echo "BACKUP $BK"
    PREV=$(readlink "$D/public/preview-site/preview" 2>/dev/null || true)
    undo() {
      for F in $CF; do [ -f "$BK/$F" ] && cp "$BK/$F" "$D/$F"; done
      if [ -n "$PREV" ]; then ln -sfn "$PREV" "$D/public/preview-site/preview.new" && mv -T "$D/public/preview-site/preview.new" "$D/public/preview-site/preview"; else rm -f "$D/public/preview-site/preview"; fi
      docker compose up -d </dev/null 2>&1 | tail -2; docker compose exec -T web nginx -s reload </dev/null 2>&1 | tail -2
      echo "ROLLED_BACK"
    }
    # cp 는 기존 파일을 제자리에서 덮어써서 컨테이너가 붙잡은 파일(inode)이 그대로라 reload 로 반영된다
    for F in $CF; do cp "$ST/conf/$F" "$D/$F" || { undo; echo "COPY_FAIL $F"; exit 4; }; done
    mkdir -p "$D/public/preview-releases"
    mv "$ST/site" "$D/public/preview-releases/$TS" || { undo; echo "MOVE_FAIL"; exit 4; }
    rm -rf "$ST"; chmod -R a+rX "$D/public"
    ln -sfn "../preview-releases/$TS" "$D/public/preview-site/preview.new" && mv -T "$D/public/preview-site/preview.new" "$D/public/preview-site/preview" || { undo; echo "LINK_FAIL"; exit 4; }
    if ! docker compose up -d </dev/null >/dev/null 2>&1 || ! docker compose exec -T web nginx -t </dev/null >/dev/null 2>&1 || ! docker compose exec -T web nginx -s reload </dev/null >/dev/null 2>&1; then undo; echo "RELOAD_FAIL"; exit 4; fi
    sleep 2
    A=$(docker compose port web 8080 </dev/null 2>/dev/null | head -1 | sed 's/^0\.0\.0\.0/127.0.0.1/')
    [ -n "$A" ] || { undo; echo "NO_PORT"; exit 4; }
    C1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$A/preview/"); C2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$A/")
    echo "CHECK /preview/ $C1"; echo "CHECK / $C2"
    HD=$(curl -sI --max-time 10 "http://$A/preview/")
    echo "$HD" | grep -qi '^x-frame-options' && echo "XFO present" || echo "XFO absent"
    echo "$HD" | grep -io "frame-ancestors[^;\"]*" | head -1 | sed 's/^/HEADER /'
    if [ "$C1" != 200 ] || [ "$C2" != 200 ]; then undo; echo "CHECK_FAIL"; exit 4; fi
    ls -1t "$D/public/preview-releases" | tail -n +4 | while read -r O; do rm -rf "$D/public/preview-releases/$O"; done
    act "web-release $N $TS"; echo "RELEASED $TS" ;;
  *) echo "UNKNOWN"; exit 9 ;;
esac
`;

// 서버에서 고정 스크립트 실행. args 는 호출 전에 형식 검사를 마친 값만. stdin 은 값(.env)·설정 본문 전달에만 쓴다.
// 시험 모드에서만 가짜 ssh(node 스크립트)를 쓴다
const sshCmd = () => (TEST && process.env.SERVERCTL_SSH ? [process.execPath, [process.env.SERVERCTL_SSH]] : ["ssh", []]);
function remote(args, input, host = HOST) {
  const script = /^(app-(update|health|restart)|env-restore-work)/.test(args[0]) ? REMOTE_APP : args[0] === "web-release" ? REMOTE_WEB : REMOTE;
  if (!HOSTS.includes(host)) die(`대상 서버는 ${HOSTS.join("·")} 만이에요: ${host}`);
  // 윈도우 ssh 명령줄은 길면 잘린다(원격 셸이 "unmatched \"" 로 실패) → 스크립트를 gzip 한 뒤 base64 로 보낸다
  const b64 = gzipSync(Buffer.from(script.replace(/\r\n/g, "\n")), { level: 9 }).toString("base64");
  const quoted = args.map((a) => `'${String(a).replace(/'/g, "")}'`).join(" ");
  const [bin, pre] = sshCmd();
  const r = spawnSync(bin, [...pre, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, `LC_ALL=C bash -c "$(echo ${b64} | base64 -d | gunzip)" serverctl ${quoted}`], {
    input: input ?? "",
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  // stdout 은 손대지 않고(설정 파일 끝 줄바꿈까지 그대로) 따로 돌려준다. out 은 사람이 읽을 요약.
  return { code: r.status ?? -1, stdout: r.stdout ?? "", out: `${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim(), error: r.error?.message };
}

// 출력에서 값이 보일 만한 것을 가린다(KEY=값 꼴, 넘겨받은 값)
let secretValue = "";
const mask = (s) => {
  let t = String(s ?? "").replace(/\b([A-Z][A-Z0-9_]{1,63})=(\S+)/g, "$1=***");
  if (secretValue && secretValue.length >= 3) t = t.split(secretValue).join("***");
  return t;
};
const say = (s) => console.log(mask(s));
const die = (s, code = 1) => {
  console.error(mask(`serverctl: ${s}`));
  process.exit(code);
};

// 홈페이지 헬스체크(브라우저 UA 로 200). 몇 번 다시 시도한다.
async function health(tries = 6, gapMs = TEST ? 50 : 10_000) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(SITE_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 200) return { ok: true, detail: "200" };
      last = String(r.status);
    } catch (e) {
      last = e.message;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, gapMs));
  }
  return { ok: false, detail: last };
}

// 정비 대화(진행 중인 지시가 있으면)와 텔레그램에 남긴다. 값은 담지 않는다.
async function report(text) {
  if (TEST) {
    // 시험: 진짜 홈페이지에 보내지 않고, 주어진 파일에만 남긴다(값이 섞이지 않았는지 시험이 본다)
    if (process.env.SERVERCTL_REPORT_FILE) fs.appendFileSync(process.env.SERVERCTL_REPORT_FILE, `${mask(text)}\n---\n`);
    return;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    await fetch(`${String(cfg.serverUrl).replace(/\/+$/, "")}/api/factory/maintenance`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "server_change", turnId: process.env.FACTORY_MAINTENANCE_TURN || undefined, text: mask(text).slice(0, 1500) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* 기록 실패는 작업을 막지 않는다 */
  }
}

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
};
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
const backupOf = (out) => /BACKUP (\S+)/.exec(out)?.[1] ?? "(백업 경로 모름)";
const tsOf = (p) => /bak-(\d{8}-\d{6})/.exec(p)?.[1] ?? null;

// ───────── nginx 설정 고치기(블록 단위) ─────────
function blockEnd(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "#") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = text.indexOf(c, i + 1);
      i = q < 0 ? text.length : q;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

export function setDirective(text, name, value, location) {
  // https server 블록(listen 443)
  const listen = text.search(/^\s*listen\s+443\b/m);
  if (listen < 0) throw new Error("listen 443 server 블록을 찾지 못했어요.");
  const serverOpen = text.lastIndexOf("server", listen);
  const sOpen = text.indexOf("{", serverOpen);
  const sEnd = blockEnd(text, sOpen);
  let open = sOpen;
  let end = sEnd;
  if (location) {
    const esc = location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`^[ \\t]*location\\s+${esc}\\s*\\{`, "m");
    const sub = text.slice(sOpen, sEnd);
    const m = re.exec(sub);
    if (!m) throw new Error(`location ${location} 블록을 찾지 못했어요.`);
    open = sOpen + m.index + m[0].length - 1;
    end = blockEnd(text, open);
  }
  // 블록 바로 안쪽(깊이 1)의 같은 지시어를 찾는다
  const inner = text.slice(open + 1, end);
  let depth = 0;
  let found = -1;
  const lines = inner.split("\n");
  let off = 0;
  for (const line of lines) {
    const code = line.replace(/#.*/, "");
    if (depth === 0 && new RegExp(`^\\s*${name}\\s+[^;]*;`).test(code)) {
      found = off;
      break;
    }
    for (const c of code) depth += c === "{" ? 1 : c === "}" ? -1 : 0;
    off += line.length + 1;
  }
  if (found >= 0) {
    const abs = open + 1 + found;
    const lineEnd = text.indexOf("\n", abs);
    const line = text.slice(abs, lineEnd < 0 ? text.length : lineEnd);
    return text.slice(0, abs) + line.replace(new RegExp(`(${name}\\s+)[^;]*;`), `$1${value};`) + text.slice(lineEnd < 0 ? text.length : lineEnd);
  }
  const indent = location ? "        " : "    ";
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, open + 1) + `${nl}${indent}${name} ${value}; # serverctl` + text.slice(open + 1);
}

async function applyNginx(content, what) {
  if (content.length > 200_000 || !/server\s*\{/.test(content) || !content.includes("buyoungsilcoding.com")) die("nginx 설정 내용이 대상 사이트 설정으로 보이지 않아요.");
  const r = remote(["nginx-apply"], content.replace(/\r\n/g, "\n"));
  const b = backupOf(r.out);
  if (r.code !== 0) {
    const res = /TEST_FAIL/.test(r.out) ? `nginx -t 실패 → 백업으로 자동 복원(${/RESTORED/.test(r.out) ? "복원 확인" : "복원 확인 실패!"})` : `적용 실패(코드 ${r.code})`;
    say(`${what}: ${res}\n백업: ${b}\n${r.out}`);
    await report(`nginx ${what}\n결과: ${res}\n백업: ${b}`);
    process.exit(3);
  }
  const h = await health();
  if (!h.ok) {
    const back = remote(["nginx-restore", tsOf(b)]);
    const h2 = await health();
    const res = `reload 후 헬스체크 실패(${h.detail}) → 백업으로 복원·reload(${back.code === 0 ? "됨" : "실패"}), 복원 후 헬스체크 ${h2.ok ? "200" : `실패(${h2.detail})`}`;
    say(`${what}: ${res}\n백업: ${b}`);
    await report(`nginx ${what}\n결과: ${res}\n백업: ${b}`);
    process.exit(4);
  }
  say(`${what}: 적용됨(nginx -t 통과, reload, 헬스체크 200)\n백업: ${b}`);
  await report(`nginx ${what}\n결과: nginx -t 통과, reload, 헬스체크 200\n백업: ${b}`);
}

async function rebuild() {
  const st = readState();
  const start = remote(["rebuild-start"]);
  if (!/STARTED/.test(start.out)) die(`재빌드를 시작하지 못했어요: ${start.out}`);
  const tag = /ROLLBACK_TAG (\S+)/.exec(start.out)?.[1] ?? null;
  say(`재빌드 시작(되돌림용 이미지 ${tag ?? "없음"}). 끝날 때까지 기다려요(보통 4~5분).`);
  let status = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 10_000));
    status = remote(["rebuild-status"]).out;
    if (/REBUILD_END/.test(status)) break;
  }
  const built = /REBUILD_OK/.test(status);
  const h = built ? await health(12, 10_000) : { ok: false, detail: "빌드 실패" };
  if (built && h.ok) {
    delete st.envBaseline;
    writeState(st);
    say("재빌드 완료, 헬스체크 200");
    await report(`서버 재빌드(.env 반영)\n결과: 빌드 성공, 헬스체크 200${tag ? `\n되돌림용 이미지: ${tag}` : ""}`);
    return;
  }
  // 실패: .env 를 바뀌기 전 백업으로, 이미지는 되돌림용으로
  const notes = [`재빌드 ${built ? `후 헬스체크 실패(${h.detail})` : "실패(빌드 오류)"}`];
  if (st.envBaseline) {
    const er = remote(["env-restore", st.envBaseline]);
    notes.push(`.env.local 을 ${st.envBaseline} 백업으로 복원(${er.code === 0 ? "됨" : "실패"})`);
  }
  if (built && tag) {
    const ir = remote(["image-rollback", tag]);
    notes.push(`이미지를 ${tag} 로 되돌림(${ir.code === 0 ? "됨" : "실패"})`);
  } else if (!built) notes.push("빌드가 실패해서 기존 컨테이너가 그대로 돌고 있어요");
  const h2 = await health();
  notes.push(`되돌린 뒤 헬스체크 ${h2.ok ? "200" : `실패(${h2.detail})`}`);
  delete st.envBaseline;
  writeState(st);
  say(notes.join("\n"));
  await report(`서버 재빌드 실패 → 자동 되돌림\n${notes.join("\n")}`);
  process.exit(5);
}

async function envChange(cmd, key) {
  if (!KEY_RE.test(key ?? "")) die("KEY 는 영문 대문자·숫자·_ 로(대문자로 시작, 64자 이하).");
  let value;
  if (cmd === "env-set") {
    if (process.argv.length > 4) die("값은 명령줄 인자로 받지 않아요(로그에 남아요). SERVERCTL_VALUE 환경변수나 stdin 으로 넘겨 주세요.");
    value = process.env.SERVERCTL_VALUE;
    if (value === undefined) {
      if (process.stdin.isTTY) die("값은 환경변수 SERVERCTL_VALUE 또는 stdin 으로 넘겨 주세요(명령줄 인자 금지).");
      value = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
    }
    if (!value || /[\r\n\0]/.test(value) || value.length > 4096) die("값이 비었거나, 줄바꿈이 있거나, 4096자를 넘어요.");
    secretValue = value;
  }
  const r = remote([cmd, key], cmd === "env-set" ? `${value}\n` : "");
  value = undefined;
  if (r.code !== 0) die(`실패: ${r.out}`);
  const b = backupOf(r.out);
  const what = /CHANGED|ADDED|REMOVED|ABSENT/.exec(r.out)?.[0] ?? "?";
  const st = readState();
  if (!st.envBaseline) {
    st.envBaseline = tsOf(b); // 다음 rebuild 가 실패하면 여기로 되돌린다
    writeState(st);
  }
  const label = { CHANGED: "값 변경됨", ADDED: "새로 추가됨", REMOVED: "삭제됨", ABSENT: "원래 없던 키(변경 없음)" }[what] ?? what;
  say(`${key}: ${label}\n백업: ${b}\n서버에 반영하려면 rebuild 가 필요해요(실패하면 ${st.envBaseline} 백업으로 자동 복원).`);
  await report(`.env.local ${cmd === "env-set" ? "설정" : "삭제"}: ${key} (${label}, 값은 기록하지 않음)\n백업: ${b}\n반영: rebuild 대기`);
}

// ───────── 새 사이트 만들기 ─────────

// 위치 인자와 --옵션 값(--set·--gen 은 여러 번)을 나눈다
export function parseOpts(args, multi = ["set", "gen"]) {
  const pos = [];
  const opts = Object.fromEntries(multi.map((k) => [k, []]));
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(args[i]);
    if (!m) {
      pos.push(args[i]);
      continue;
    }
    const v = m[2] ?? args[++i];
    if (v === undefined) die(`--${m[1]} 에 값이 없어요.`);
    if (multi.includes(m[1])) opts[m[1]].push(v);
    else opts[m[1]] = v;
  }
  return { pos, opts };
}

const hostOpt = (opts) => {
  const h = opts.host ?? HOST;
  if (!HOSTS.includes(h)) die(`대상 서버는 ${HOSTS.join("·")} 만이에요: ${h}`);
  return h;
};

// 서버 작업 폴더 인자 → 이름. ~/git-server/work/X, $HOME/…, 이 PC 셸이 ~ 를 풀어 버린 경로, 이름만 모두 받는다
export function workName(p) {
  const s = String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const m = /(?:^|\/)git-server\/work\/([^/]+)$/.exec(s);
  const name = m ? m[1] : s;
  if (!NAME_RE.test(name)) die(`작업 폴더는 ~/git-server/work/<이름> 꼴이어야 해요: ${p}`);
  return name;
}

const say2 = (what, out) => say(`${what}\n${out}`);
const probe = async (url) => {
  if (TEST) return "시험 모드 생략";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    return String(r.status);
  } catch (e) {
    return `응답 없음(${e.message})`;
  }
};

async function siteInit(args) {
  const { pos, opts } = parseOpts(args);
  const [name] = pos;
  const from = opts.from;
  const host = hostOpt(opts);
  if (!NAME_RE.test(name ?? "") || !NAME_RE.test(from ?? "")) die("site-init <이름> --from <원본 이름> (영문·숫자·_- 로, 영문으로 시작)");
  if (name.toLowerCase() === from.toLowerCase()) die("원본과 같은 이름은 쓸 수 없어요.");
  const r = remote(["site-init", name, from], "", host);
  if (/EXISTS/.test(r.out)) {
    say2(`site-init ${name}: 이미 있어서 아무것도 바꾸지 않았어요.`, r.out);
    process.exit(6);
  }
  if (r.code !== 0) {
    say2(`site-init ${name}: 실패(코드 ${r.code}). 만든 것은 되돌렸어요.`, r.out);
    await report(`서버 site-init ${name} (${host}, 원본 ${from})\n결과: 실패(${r.out.split("\n").pop()})`);
    process.exit(r.code || 1);
  }
  say2(`site-init ${name}: ${host} 에 배포 저장소·훅·작업 폴더를 만들었어요(원본 ${from}, 이름 4곳 치환, 원본 이름 남은 곳 0).`, r.out);
  await report(`서버 site-init ${name} (${host}, 원본 ${from})\n결과: bare 저장소 + post-receive 훅(이름 4곳 치환) + 작업 폴더 clone`);
}

async function envClone(args) {
  const { pos, opts } = parseOpts(args);
  if (pos.length !== 2) die("env-clone <원본 작업폴더> <대상 작업폴더> [--set KEY=VALUE]… [--gen KEY]…");
  const host = hostOpt(opts);
  const src = workName(pos[0]);
  const dst = workName(pos[1]);
  if (src === dst) die("원본과 대상이 같아요.");
  const lines = [];
  const names = [];
  for (const kv of opts.set) {
    const i = kv.indexOf("=");
    const k = i > 0 ? kv.slice(0, i) : "";
    const v = i > 0 ? kv.slice(i + 1) : "";
    if (!KEY_RE.test(k)) die(`--set 은 KEY=VALUE 꼴이에요(KEY 는 영문 대문자·숫자·_): ${k || "(없음)"}`);
    if (!v || /[\t\r\n\0]/.test(v) || v.length > 4096) die(`${k} 값이 비었거나, 탭·줄바꿈이 있거나, 4096자를 넘어요.`);
    lines.push(`set\t${k}\t${v}`);
    names.push(k);
  }
  for (const k of opts.gen) {
    if (!KEY_RE.test(k)) die(`--gen KEY 형식이 올바르지 않아요: ${k}`);
    lines.push(`gen\t${k}`);
    names.push(k);
  }
  if (new Set(names).size !== names.length) die("같은 KEY 를 두 번 지정했어요.");
  // 값은 ssh 인자가 아니라 표준입력으로만 넘긴다(서버 프로세스 목록·로그에 남지 않게)
  const r = remote(["env-clone", src, dst], lines.join("\n") + "\n", host);
  const b = /BACKUP (\S+)/.exec(r.out)?.[1] ?? null;
  if (r.code !== 0) {
    say2(`env-clone ${src} → ${dst}: 실패(코드 ${r.code}). 대상 .env.local 은 바뀌지 않았어요.`, r.out);
    await report(`서버 .env.local 복사 ${src} → ${dst} (${host})\n결과: 실패, 대상은 그대로${b ? `\n백업: ${b}` : ""}`);
    process.exit(r.code || 1);
  }
  // 결과는 변수 이름만 보여 준다(KEYS 아래 줄 중 이름 꼴만)
  const keys = r.out.split("KEYS").pop().split("\n").map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  const mode = /MODE (\d+)/.exec(r.out)?.[1] ?? "?";
  const done = [...opts.set.map((kv) => `${kv.split("=")[0]}(설정)`), ...opts.gen.map((k) => `${k}(새로 생성, 값은 서버에만)`)];
  say(`env-clone ${src} → ${dst}: 완료(권한 ${mode})${b ? `\n백업: ${b}` : "\n대상에 원래 .env.local 이 없었어요(백업 없음)"}\n바꾼 변수: ${done.join(", ") || "없음"}\n변수 이름 ${keys.length}개: ${keys.join(", ")}`);
  await report(`서버 .env.local 복사 ${src} → ${dst} (${host}, 값은 서버 밖으로 나가지 않음)\n바꾼 변수: ${done.join(", ") || "없음"}\n백업: ${b ?? "없음(새 파일)"}`);
}

export function siteConfig(name, domain, port, body, ts = "") {
  return `# serverctl nginx-site ${name} ${ts}
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    client_max_body_size ${body};

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
`;
}

async function nginxSite(args) {
  const { pos, opts } = parseOpts(args);
  const [name] = pos;
  const host = hostOpt(opts);
  const domain = String(opts.domain ?? "").toLowerCase();
  const port = Number(opts.port);
  const body = opts.body ?? "300m";
  if (!NAME_RE.test(name ?? "") || /^default$/i.test(name)) die("nginx-site <이름> --domain <도메인> --port <포트> [--body 300m]");
  if (!DOMAIN_RE.test(domain)) die(`도메인 형식이 올바르지 않아요: ${opts.domain}`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) die(`포트는 1024~65535 정수예요: ${opts.port}`);
  if (!BODY_RE.test(body)) die(`--body 형식이 올바르지 않아요(예: 300m): ${body}`);
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const r = remote(["nginx-site", name, domain], siteConfig(name, domain, port, body, ts), host);
  const what = `nginx 새 사이트 ${name} (${domain} → 127.0.0.1:${port}, body ${body}, ${host})`;
  if (/EXISTS|DOMAIN_TAKEN/.test(r.out)) {
    say2(`${what}: 이미 있는 사이트·도메인이라 아무것도 바꾸지 않았어요.`, r.out);
    process.exit(6);
  }
  if (r.code !== 0) {
    const res = /TEST_FAIL/.test(r.out) ? `nginx -t 실패 → 새 파일 지움(${/RESTORED/.test(r.out) ? "nginx -t 다시 통과" : "다시 검사 실패!"})` : `적용 실패(코드 ${r.code}) → 새 파일 지움`;
    say2(`${what}: ${res}`, r.out);
    await report(`${what}\n결과: ${res}`);
    process.exit(3);
  }
  // 헬스체크: 기존 사이트(블로그)가 그대로 200 이어야 한다. 새 도메인은 앱이 아직 없을 수 있어 응답만 적는다
  const h = await health();
  if (!h.ok) {
    const back = remote(["nginx-site-undo", name], "", host);
    const h2 = await health();
    const res = `reload 후 헬스체크 실패(${h.detail}) → 새 사이트 지우고 reload(${back.code === 0 && /REMOVED/.test(back.out) ? "됨" : "실패"}), 되돌린 뒤 헬스체크 ${h2.ok ? "200" : `실패(${h2.detail})`}`;
    say(`${what}: ${res}`);
    await report(`${what}\n결과: ${res}`);
    process.exit(4);
  }
  const p = await probe(`http://${domain}/`);
  say(`${what}: 적용됨(nginx -t 통과, reload, 기존 사이트 헬스체크 200). 새 도메인 http 응답: ${p}\n되돌리기: 새로 만든 파일이라 백업 대신 nginx-site-undo 로 지울 수 있어요.`);
  await report(`${what}\n결과: nginx -t 통과, reload, 헬스체크 200, 새 도메인 http ${p}`);
}

async function cert(args) {
  const { pos, opts } = parseOpts(args);
  const host = hostOpt(opts);
  const domain = String(pos[0] ?? "").toLowerCase();
  if (!DOMAIN_RE.test(domain)) die(`cert <도메인>: 도메인 형식이 올바르지 않아요: ${pos[0] ?? ""}`);
  const r = remote(["cert", domain], "", host);
  const b = backupOf(r.out);
  const site = /SITE (\S+)/.exec(r.out)?.[1];
  const what = `인증서 ${domain} (${host})`;
  // 인증서·키 내용은 원래 출력되지 않지만, 혹시 섞이면 PEM 줄을 뺀다
  const out = r.out.split("\n").filter((l) => !/BEGIN|END|PRIVATE|-----|^[A-Za-z0-9+/=]{16,}$/.test(l.trim())).join("\n");
  if (r.code !== 0) {
    const res = /NO_SITE/.test(r.out) ? "이 도메인의 nginx 사이트가 없어요(nginx-site 먼저)" : `certbot 실패 → 사이트 파일 백업으로 복원(${/RESTORED/.test(r.out) ? "됨" : "복원 확인 실패!"})`;
    say2(`${what}: ${res}\n백업: ${b}`, out);
    await report(`${what}\n결과: ${res}\n백업: ${b}`);
    process.exit(5);
  }
  const h = await health();
  if (!h.ok) {
    const back = site ? remote(["cert-undo", site, tsOf(b)], "", host) : { code: 1, out: "" };
    const res = `헬스체크 실패(${h.detail}) → 사이트 파일 백업으로 복원(${back.code === 0 && /RESTORED/.test(back.out) ? "됨" : "실패"})`;
    say(`${what}: ${res}\n백업: ${b}`);
    await report(`${what}\n결과: ${res}\n백업: ${b}`);
    process.exit(4);
  }
  const p = await probe(`https://${domain}/`);
  say2(`${what}: 발급·설치됨(https 리다이렉트, nginx -t 통과, reload, 기존 사이트 헬스체크 200). 새 도메인 https 응답: ${p}\n백업: ${b}`, out);
  await report(`${what}\n결과: certbot --nginx --redirect 성공, 헬스체크 200, https ${p}\n백업: ${b}`);
}

const gitIn = (dir, args, extra = {}) =>
  spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: TEST && process.env.SERVERCTL_SSH ? `"${process.execPath.replace(/\\/g, "/")}" "${process.env.SERVERCTL_SSH.replace(/\\/g, "/")}"` : "ssh -o BatchMode=yes",
    },
    ...extra,
  });

async function deployPush(args) {
  const { pos } = parseOpts(args);
  const [dirArg, remoteName, url] = pos;
  if (pos.length !== 3) die("deploy-push <앱 폴더> <원격 이름> <원격 주소(serverpc:git-server/repo/<이름>.git)>");
  const dir = path.resolve(String(dirArg));
  const um = DEPLOY_URL_RE.exec(url ?? "");
  if (!um) die(`원격 주소는 serverpc:git-server/repo/<이름>.git 또는 serverpc2:… 꼴만이에요: ${url}`);
  const [, host, name] = um;
  if (!REMOTE_NAME_RE.test(remoteName ?? "")) die(`원격 이름 형식이 올바르지 않아요: ${remoteName}`);
  if (!fs.existsSync(dir) || gitIn(dir, ["rev-parse", "--git-dir"]).status !== 0) die(`git 앱 폴더가 아니에요: ${dir}`);
  if (gitIn(dir, ["rev-parse", "--verify", "-q", "refs/heads/main"]).status !== 0) die("앱 폴더에 main 브랜치가 없어요.");
  const cur = gitIn(dir, ["remote", "get-url", remoteName]);
  let added = false;
  if (cur.status === 0) {
    if (cur.stdout.trim() !== url) die(`원격 ${remoteName} 이 이미 다른 주소예요(${cur.stdout.trim()}). 바꾸지 않았어요.`);
  } else {
    if (gitIn(dir, ["remote", "add", remoteName, url]).status !== 0) die(`원격 ${remoteName} 을 추가하지 못했어요.`);
    added = true;
  }
  const info = remote(["deploy-info", name], "", host);
  if (info.code !== 0) {
    if (added) gitIn(dir, ["remote", "remove", remoteName]);
    die(`서버에 배포 저장소 훅이 없어요(site-init 먼저): ${info.out}`);
  }
  const container = /CONTAINER (\S+)/.exec(info.out)?.[1] ?? "?";
  const from = Number(/LINES (\d+)/.exec(info.out)?.[1] ?? 0);
  const head = gitIn(dir, ["rev-parse", "--short", "main"]).stdout.trim();
  say(`deploy-push: ${path.basename(dir)} main(${head}) → ${remoteName}(${url}). 서버 배포 훅이 끝날 때까지 기다려요(보통 5~6분).`);
  // 강제 push 없음. post-receive 훅이 빌드·교체를 마칠 때까지 push 가 끝나지 않는다
  const p = gitIn(dir, ["push", remoteName, "main:main"], { timeout: 40 * 60_000 });
  const full = `${p.stdout ?? ""}\n${p.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  let st = { out: "" };
  for (let i = 0; i < (TEST ? 3 : 90); i++) {
    st = remote(["deploy-status", name, from], "", host);
    if (/LOG_END/.test(st.out) || p.status !== 0) break;
    await new Promise((res) => setTimeout(res, TEST ? 50 : 10_000));
  }
  const logEnd = /LOG_END/.test(st.out);
  const running = new RegExp(`RUNNING ${container}\\b`).test(st.out);
  const failed = /Failed to compile|Type error|\[rejected\]|error: failed to push|ERROR: /i.test(full);
  const ok = p.status === 0 && logEnd && running && !failed;
  if (p.status !== 0 && added && !/->\s+main/.test(full)) gitIn(dir, ["remote", "remove", remoteName]); // 서버까지 가지 못했으면 추가한 원격도 되돌린다
  const tailOf = (s, n) => (s.length > n ? `…${s.slice(-n)}` : s);
  const res = ok
    ? `배포 완료: push 성공, 배포 로그 끝, 컨테이너 ${container} 실행 중`
    : p.status !== 0
      ? `push 실패(코드 ${p.status ?? p.error?.message})`
      : !logEnd
        ? "배포 로그가 끝나지 않았어요(시간 초과)"
        : failed
          ? "서버 빌드 실패(기존 컨테이너가 있으면 그대로)"
          : `컨테이너 ${container} 가 실행 중이 아니에요`;
  say(`deploy-push ${name}: ${res}\n--- 배포 로그 끝부분 ---\n${tailOf(st.out.split("\n").filter((l) => l.startsWith("| ") || l.startsWith("RUNNING")).join("\n"), 2500)}${ok ? "" : `\n--- push 출력 끝부분 ---\n${tailOf(full.trim(), 2500)}`}`);
  await report(`배포 push ${path.basename(dir)} main(${head}) → ${url}\n결과: ${res}`);
  if (!ok) process.exit(5);
}

// env-set <작업폴더…> --gen-shared KEY --gen KEY : 비밀값을 서버 안에서 만들어 넣는다(값은 이 PC 로 오지 않는다)
async function envMulti(args) {
  const { pos, opts } = parseOpts(args, ["gen", "gen-shared", "put"]);
  const host = hostOpt(opts);
  if (!pos.length) die("env-set <작업폴더…> [--gen-shared KEY]… [--gen KEY]…");
  if (!opts.gen.length && !opts["gen-shared"].length && !opts.put.length) die("--gen-shared, --gen, --put 중 하나는 있어야 해요.");
  if (opts.put.length > 1) die("--put 은 한 번만 쓸 수 있어요(값을 하나만 받아요).");
  const dirs = pos.map(workName);
  if (new Set(dirs).size !== dirs.length) die("같은 작업 폴더를 두 번 적었어요.");
  const lines = [];
  const names = [];
  for (const [op, list] of [["shared", opts["gen-shared"]], ["gen", opts.gen], ["val", opts.put]])
    for (const k of list) {
      if (!KEY_RE.test(k)) die("KEY 형식이 올바르지 않아요(영문 대문자·숫자·_): " + k);
      if (/^(NEXTAUTH_SECRET|AUTH_SECRET)$/.test(k)) die(k + " 는 바꾸지 않아요(공장 키 암호화 기준).");
      if (op === "val") {
        let v = process.env.SERVERCTL_VALUE;
        if (v === undefined) {
          if (process.stdin.isTTY) die("--put 의 값은 환경변수 SERVERCTL_VALUE 또는 stdin 으로 넘겨 주세요(명령줄 인자 금지).");
          v = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
        }
        if (!/^[A-Za-z0-9._~+/=:@-]{8,512}$/.test(v)) die("값 형식이 올바르지 않아요(영문·숫자·._~+/=:@- 만, 8~512자).");
        secretValue = v;
        lines.push(op + "\t" + k + "\t" + v);
      } else lines.push(op + "\t" + k);
      names.push(k);
    }
  if (new Set(names).size !== names.length) die("같은 KEY 를 두 번 지정했어요.");
  const r = remote(["env-multi", ...dirs], lines.join("\n") + "\n", host);
  const backups = [...r.out.matchAll(/BACKUP (\S+)/g)].map((m) => m[1]);
  const who = dirs.join(", ");
  if (r.code !== 0) {
    say2("env-set " + who + ": 실패(코드 " + r.code + "). 서버 .env.local 은 바뀌기 전 상태예요.", r.out);
    await report("서버 비밀값 생성 " + who + " (" + host + ")\n결과: 실패, 되돌림" + (backups.length ? "\n백업: " + backups.join(", ") : ""));
    process.exit(r.code || 1);
  }
  const set = [...r.out.matchAll(/^SET (shared|gen|val) (\S+) (\S+)$/gm)].map((m) => m[3] + " → " + m[2] + (m[1] === "shared" ? "(공통 값)" : m[1] === "val" ? "(넘겨받은 값)" : "(폴더별 새 값)"));
  const skip = [...r.out.matchAll(/^SKIP (\S+) (\S+)$/gm)].map((m) => m[2] + " → " + m[1] + "(이미 있어 건너뜀)");
  const modes = [...r.out.matchAll(/^MODE (\S+) (\d+)$/gm)].map((m) => m[1] + "=" + m[2]);
  // developWeb 을 바꿨으면 다음 rebuild 가 실패할 때 이 백업으로 되돌린다
  const own = backups.find((b) => b.includes("/env-backups/developWeb/"));
  if (own) {
    const st = readState();
    if (!st.envBaseline) {
      st.envBaseline = tsOf(own);
      writeState(st);
    }
  }
  const body = "바꾼 변수: " + (set.join(", ") || "없음") + (skip.length ? "\n건너뜀: " + skip.join(", ") : "") + "\n권한: " + modes.join(", ") + "\n백업: " + backups.join(", ");
  say("env-set " + who + " (" + host + "): 완료, 값은 서버에만 있고 출력하지 않았어요\n" + body + (own ? "\n서버(블로그)에 반영하려면 rebuild 가 필요해요." : ""));
  await report("서버 비밀값 생성 " + who + " (" + host + ", 값은 서버 밖으로 나가지 않음)\n" + body);
}

const PROBE_RE = /^\/[A-Za-z0-9_\-./]{0,100}$/;
const publicProbe = async (domain, p, wantHeader) => {
  if (TEST) return "시험 모드 생략";
  try {
    const r = await fetch(`https://${domain}${p}`, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const csp = wantHeader ? /frame-ancestors[^;"]*/.exec(r.headers.get("content-security-policy") ?? "")?.[0] : "";
    return `${r.status}${wantHeader ? ` / X-Frame-Options ${r.headers.get("x-frame-options") ? "있음" : "없음"} / ${csp || "frame-ancestors 없음"}` : ""}`;
  } catch (e) {
    return `응답 없음(${e.message})`;
  }
};

// app-update NAME : 배포 훅이 없는 앱을 서버 작업 폴더에서 최신 main 으로 다시 빌드·실행
async function appUpdate(args) {
  const { pos, opts } = parseOpts(args, ["probe"]);
  if (pos.length !== 1) die("app-update <작업 폴더 이름> [--host H] [--probe /경로]… [--domain D]");
  const host = hostOpt(opts);
  const name = workName(pos[0]);
  const probes = opts.probe.length ? opts.probe : ["/health"];
  for (const p of probes) if (!PROBE_RE.test(p)) die(`--probe 경로 형식이 올바르지 않아요: ${p}`);
  if (opts.domain && !DOMAIN_RE.test(opts.domain)) die(`도메인 형식이 올바르지 않아요: ${opts.domain}`);
  const start = remote(["app-update-start", name], "", host);
  if (!/STARTED/.test(start.out)) die(`업데이트를 시작하지 못했어요: ${start.out}`);
  const old = /^OLD (\S+)/m.exec(start.out)?.[1] ?? "?";
  const now = /^NEW (\S+)/m.exec(start.out)?.[1] ?? "?";
  const oldFull = /^OLDFULL ([0-9a-f]{7,40})$/m.exec(start.out)?.[1] ?? "";
  const imgName = /^IMAGE_NAME (\S+)$/m.exec(start.out)?.[1] ?? "";
  const tag = /^ROLLBACK_TAG (\S+)$/m.exec(start.out)?.[1] ?? "";
  say(`app-update ${name} (${host}): ${old} → ${now}. 빌드가 끝날 때까지 기다려요(보통 3~5분).`);
  let status = "";
  for (let i = 0; i < (TEST ? 5 : 120); i++) {
    await new Promise((res) => setTimeout(res, TEST ? 50 : 10_000));
    status = remote(["app-update-status", name], "", host).out;
    if (/UPDATE_END/.test(status)) break;
  }
  const built = /UPDATE_OK/.test(status);
  const hr = built ? remote(["app-health", name, ...probes], "", host) : { out: "", code: 1 };
  const codes = [...hr.out.matchAll(/^PROBE (\S+) (\d{3})$/gm)].map((m) => [m[1], m[2]]);
  const healthy = built && codes.length > 0 && codes[0][1] === "200";
  if (healthy) {
    const pub = opts.domain ? await Promise.all(probes.map(async (p) => `${p} → ${await publicProbe(opts.domain, p)}`)) : [];
    const body = `커밋 ${old} → ${now}\n서버 안 응답(토큰 없이): ${codes.map(([p, c]) => `${p} ${c}`).join(", ")}${pub.length ? `\n공개 주소 ${opts.domain}: ${pub.join(", ")}` : ""}`;
    say(`app-update ${name}: 완료\n${body}`);
    await report(`앱 업데이트 ${name} (${host})\n결과: 빌드·실행 성공\n${body}`);
    return;
  }
  const notes = [built ? `헬스체크 실패(${codes.map(([p, c]) => `${p} ${c}`).join(", ") || hr.out.split("\n")[0]})` : "빌드 실패(기존 컨테이너가 있으면 그대로 돌고 있을 수 있어요)"];
  if (/^[0-9a-f]{7,40}$/.test(oldFull) && (!tag || /^serverctl-rollback\/[A-Za-z0-9_-]+:\d{8}-\d{6}$/.test(tag)) && (!imgName || /^[A-Za-z0-9._/:-]+$/.test(imgName))) {
    const rb = remote(["app-update-rollback", name, oldFull, tag, imgName], "", host);
    notes.push(`이전 커밋·이미지로 되돌림(${/ROLLED_BACK/.test(rb.out) ? "됨" : `실패: ${rb.out.split("\n").slice(-2).join(" ")}`})`);
  }
  say(`app-update ${name}: 실패 → 자동 되돌림\n${notes.join("\n")}\n--- 서버 로그 끝부분 ---\n${status}`);
  await report(`앱 업데이트 ${name} (${host}) 실패 → 자동 되돌림\n${notes.join("\n")}`);
  process.exit(5);
}

const WEB_CONF = ["docker-compose.yml", "default.conf", "headers.conf", "preview-headers.conf"];
const GZ_EXT = /\.(js|wasm|json|html|ttf|otf|css|svg)$/;
const listFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(d, e.name)) : [path.join(d, e.name)]));

// web-release APP_DIR : 정적 웹(/preview/) 빌드와 nginx 설정을 서버 작업 폴더에 올린다
async function webRelease(args) {
  const { pos, opts } = parseOpts(args, []);
  if (pos.length !== 1) die("web-release <앱 폴더> [--site NAME] [--host H] [--domain D]");
  const host = hostOpt(opts);
  const site = workName(opts.site ?? "saessak-hub-web");
  if (opts.domain && !DOMAIN_RE.test(opts.domain)) die(`도메인 형식이 올바르지 않아요: ${opts.domain}`);
  const app = path.resolve(String(pos[0]));
  const build = path.join(app, "build", "preview");
  const confDir = path.join(app, "tools", "web", "server");
  if (!fs.existsSync(path.join(build, "index.html"))) die(`빌드 결과가 없어요(먼저 tools/build_preview.sh): ${build}`);
  for (const f of WEB_CONF) if (!fs.existsSync(path.join(confDir, f))) die(`설정 파일이 없어요: ${path.join(confDir, f)}`);
  // 미리 압축(.gz): nginx gzip_static 이 그대로 보낸다
  let gz = 0;
  for (const f of listFiles(build)) if (f.endsWith(".gz")) fs.rmSync(f);
  for (const f of listFiles(build)) {
    if (!GZ_EXT.test(f) || fs.statSync(f).size <= 1024) continue;
    fs.writeFileSync(`${f}.gz`, gzipSync(fs.readFileSync(f), { level: 9 }));
    gz++;
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "web-release-"));
  try {
    fs.cpSync(build, path.join(stage, "site"), { recursive: true });
    fs.mkdirSync(path.join(stage, "conf"));
    for (const f of WEB_CONF) fs.copyFileSync(path.join(confDir, f), path.join(stage, "conf", f));
    const t = spawnSync("tar", ["-czf", "-", "-C", stage.replace(/\\/g, "/"), "."], { maxBuffer: 400 * 1024 * 1024, windowsHide: true });
    if (t.status !== 0 || !t.stdout?.length) die(`tar 로 묶지 못했어요: ${t.stderr?.toString() ?? t.error?.message}`);
    say(`web-release ${site} (${host}): 빌드 ${listFiles(build).length - gz}개 파일(.gz ${gz}개) + 설정 4개를 올려요(${Math.round(t.stdout.length / 1024 / 1024)}MB).`);
    const r = remote(["web-release", site], t.stdout, host);
    const checks = [...r.out.matchAll(/^CHECK (\S+) (\d{3})$/gm)].map((m) => `${m[1]} ${m[2]}`);
    const hdr = [/^XFO .*$/m.exec(r.out)?.[0], /^HEADER (.*)$/m.exec(r.out)?.[1]].filter(Boolean).join(" / ");
    const backup = backupOf(r.out);
    const rel = /^RELEASED (\S+)/m.exec(r.out)?.[1];
    if (r.code !== 0 || !rel) {
      const why = /(NGINX_TEST_FAIL|UNTAR_FAIL|NO_INDEX|NO_CONF \S+|NO_SITE \S+|COPY_FAIL \S+|MOVE_FAIL|LINK_FAIL|RELOAD_FAIL|NO_PORT|CHECK_FAIL)/.exec(r.out)?.[1] ?? `코드 ${r.code}`;
      const rolled = /ROLLED_BACK/.test(r.out) ? "설정·링크 되돌림" : "서버는 바뀌기 전 상태";
      say(`web-release ${site}: 실패(${why}) — ${rolled}\n${r.out.split("\n").slice(-12).join("\n")}`);
      await report(`웹 릴리스 ${site} (${host}) 실패(${why}) — ${rolled}${backup.startsWith("/") ? `\n백업: ${backup}` : ""}`);
      fs.rmSync(stage, { recursive: true, force: true });
      process.exit(5);
    }
    const pub = opts.domain ? [`/preview/ → ${await publicProbe(opts.domain, "/preview/", true)}`, `/ → ${await publicProbe(opts.domain, "/", false)}`] : [];
    const body = `릴리스 ${rel}\n서버 안 응답: ${checks.join(", ")}\n헤더: ${hdr}\n백업: ${backup}${pub.length ? `\n공개 주소 ${opts.domain}: ${pub.join(", ")}` : ""}`;
    say(`web-release ${site}: 완료\n${body}`);
    await report(`웹 릴리스 ${site} (${host})\n${body}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// ───────── service-token: 서비스 관리자 토큰을 서버 .env 와 홈페이지 키 보관함에 같은 값으로 ─────────

const SERVICE_SECRET_RE = /^SERVICE_ADMIN_TOKEN_[A-Z0-9_]{1,40}$/;

// 감독 설정에서 홈페이지 주소·감독 토큰을 읽는다(값은 출력하지 않는다). 시험 모드는 이 PC 안(127.0.0.1·localhost)만
function supervisorConfig() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    die("감독 설정(supervisor.config.json)을 읽지 못했어요.");
  }
  const url = String(cfg?.serverUrl ?? "").replace(/\/+$/, "");
  // 시험 모드는 이 PC 안(127.0.0.1·localhost)만, 진짜 실행은 https 만
  if (TEST ? !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) : !/^https:\/\/[a-z0-9.-]+$/i.test(url)) die("감독 설정의 홈페이지 주소가 올바르지 않아요.");
  if (typeof cfg.token !== "string" || cfg.token.length < 8) die("감독 설정에 감독 토큰이 없어요.");
  return { url, token: cfg.token };
}

// 홈페이지 키 보관함 쓰기(/api/factory/service-token). 본문은 여기서만 만들고 어디에도 남기지 않는다
async function vaultPost(cfg, body) {
  try {
    const r = await fetch(`${cfg.url}/api/factory/service-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && j?.ok === true, status: r.status, version: j?.version, restored: j?.restored, message: typeof j?.message === "string" ? j.message : "" };
  } catch (e) {
    return { ok: false, status: 0, message: `연결 실패(${e.name || e.code || ""})` };
  }
}

// service-token NAME --env-key KEY --secret SERVICE_ADMIN_TOKEN_<앱> : 값을 한 번 만들어 서버 .env 와 보관함에 같이 넣고, 컨테이너 재시작 → 응답 확인. 실패하면 둘 다 되돌림
async function serviceToken(args) {
  const { pos, opts } = parseOpts(args, ["probe"]);
  if (pos.length !== 1) die("service-token <작업 폴더 이름> --env-key KEY --secret SERVICE_ADMIN_TOKEN_<앱> [--host H] [--probe /경로]… [--domain D]");
  const host = hostOpt(opts);
  const name = workName(pos[0]);
  const envKey = String(opts["env-key"] ?? "");
  const secret = String(opts.secret ?? "");
  if (!KEY_RE.test(envKey)) die(`--env-key 형식이 올바르지 않아요(영문 대문자·숫자·_): ${envKey || "(없음)"}`);
  if (/^(NEXTAUTH_SECRET|AUTH_SECRET)$/.test(envKey)) die(`${envKey} 는 바꾸지 않아요(공장 키 암호화 기준).`);
  if (!SERVICE_SECRET_RE.test(secret)) die(`--secret 은 SERVICE_ADMIN_TOKEN_<앱> 꼴만이에요: ${secret || "(없음)"}`);
  const probes = opts.probe.length ? opts.probe : ["/health", "/api/admin/health"];
  for (const p of probes) if (!PROBE_RE.test(p)) die(`--probe 경로 형식이 올바르지 않아요: ${p}`);
  if (opts.domain && !DOMAIN_RE.test(opts.domain)) die(`도메인 형식이 올바르지 않아요: ${opts.domain}`);
  const cfg = supervisorConfig();
  const who = `${envKey}(${name}@${host}) ↔ ${secret}(홈페이지 보관함)`;
  // 값은 이 프로세스 메모리에만. 출력은 mask 가 가린다
  const value = randomBytes(32).toString("hex");
  secretValue = value;

  // ① 서버 .env
  const r1 = remote(["env-multi", name], `val\t${envKey}\t${value}\n`, host);
  const backup = backupOf(r1.out);
  const ts = tsOf(backup);
  if (r1.code !== 0 || !/^SET val /m.test(r1.out) || !ts) {
    say2(`service-token ${who}: 실패(서버 .env 쓰기). 서버·보관함 모두 바뀌기 전 상태예요.`, r1.out);
    await report(`서비스 토큰 짝 넣기 ${who}\n결과: 서버 .env 쓰기 실패, 아무것도 바뀌지 않음`);
    process.exit(r1.code || 5);
  }
  const undoEnv = () => {
    const u = remote(["env-restore-work", name, ts], "", host);
    return /RESTORED/.test(u.out) ? "됨" : `실패: ${u.out.split("\n").slice(-2).join(" ")}`;
  };

  // ② 홈페이지 키 보관함
  const put = await vaultPost(cfg, { name: secret, value });
  if (!put.ok) {
    const e = undoEnv();
    say(`service-token ${who}: 실패(보관함 저장 ${put.status || "연결 안 됨"} ${put.message}) → 서버 .env 되돌림(${e}). 컨테이너는 그대로(이전 값으로 돌고 있음)`);
    await report(`서비스 토큰 짝 넣기 ${who}\n결과: 보관함 저장 실패(${put.status || "연결 안 됨"}) → 서버 .env 되돌림(${e})\n백업: ${backup}`);
    process.exit(5);
  }
  const version = put.version;
  const undoVault = async () => {
    const rb = await vaultPost(cfg, { name: secret, rollback: true, version });
    return rb.ok ? (rb.restored === "previous" ? "이전 값으로" : "삭제") : `실패(${rb.status} ${rb.message})`;
  };

  // ③ 컨테이너 재시작 → 응답 확인(첫 경로 200, 나머지는 토큰 없이 401)
  const rs = remote(["app-restart", name], "", host);
  let codes = [];
  if (/RESTARTED/.test(rs.out)) {
    const hr = remote(["app-health", name, ...probes], "", host);
    codes = [...hr.out.matchAll(/^PROBE (\S+) (\d{3})$/gm)].map((m) => [m[1], m[2]]);
  }
  const healthy = codes.length === probes.length && codes[0][1] === "200" && codes.slice(1).every(([, c]) => c === "401");
  const codeText = codes.map(([p, c]) => `${p} ${c}`).join(", ") || rs.out.split("\n").slice(-2).join(" ");
  if (!healthy) {
    const v = await undoVault();
    const e = undoEnv();
    const again = remote(["app-restart", name], "", host);
    const notes = `${/RESTARTED/.test(rs.out) ? `응답 확인 실패(${codeText})` : "컨테이너 재시작 실패"} → 보관함 되돌림(${v}), 서버 .env 되돌림(${e}), 컨테이너 다시 시작(${/RESTARTED/.test(again.out) ? "됨" : "실패"})`;
    say(`service-token ${who}: 실패 → 자동 되돌림\n${notes}`);
    await report(`서비스 토큰 짝 넣기 ${who} 실패 → 자동 되돌림\n${notes}\n백업: ${backup}`);
    process.exit(5);
  }
  const pub = opts.domain ? await Promise.all(probes.map(async (p) => `${p} → ${await publicProbe(opts.domain, p)}`)) : [];
  const body = `서버 .env ${envKey} 넣음(백업: ${backup}), 보관함 ${secret} ${put.replaced ? "교체" : "등록"}(version ${version}), 컨테이너 다시 만듦\n서버 안 응답(토큰 없이): ${codeText}${pub.length ? `\n공개 주소 ${opts.domain}: ${pub.join(", ")}` : ""}`;
  say(`service-token ${who}: 완료, 값은 서버·보관함에만 있고 출력하지 않았어요\n${body}`);
  await report(`서비스 토큰 짝 넣기 ${who} (값은 어디에도 기록하지 않음)\n${body}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "env-keys": {
      const r = remote(["env-keys"]);
      if (r.code !== 0) die(r.out);
      return say(r.out.split("\n").filter((k) => KEY_RE.test(k) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).join("\n"));
    }
    case "env-set":
      if (rest.some((a) => a.startsWith("--"))) return envMulti(rest);
      return envChange(cmd, rest[0]);
    case "env-unset":
      return envChange(cmd, rest[0]);
    case "nginx-show": {
      const r = remote(["nginx-show"]);
      if (r.code !== 0) die(r.out);
      return process.stdout.write(mask(r.stdout)); // 파일 그대로(끝 줄바꿈 포함)
    }
    case "nginx-set-directive": {
      const [name, value, ...loc] = rest;
      const location = loc.join(" ").trim() || null;
      if (!NGINX_DIRECTIVES[name]) die(`허용된 지시어만 바꿀 수 있어요: ${Object.keys(NGINX_DIRECTIVES).join(", ")}`);
      if (!NGINX_DIRECTIVES[name].test(value ?? "")) die(`${name} 값 형식이 올바르지 않아요: ${value}`);
      if (location && !LOCATION_RE.test(location)) die(`location 형식이 올바르지 않아요(예: /upload-api/ 또는 "= /api/factory/screenshot"): ${location}`);
      const cur = remote(["nginx-show"]);
      if (cur.code !== 0) die(cur.out);
      let next;
      try {
        next = setDirective(cur.stdout, name, value, location);
      } catch (e) {
        die(e.message);
      }
      return applyNginx(next, `${name} ${value}${location ? ` (location ${location})` : " (server)"}`);
    }
    case "nginx-apply": {
      const file = rest[0];
      if (!file || !fs.existsSync(file)) die("FILE 이 없어요.");
      return applyNginx(fs.readFileSync(file, "utf8"), `파일 통째 교체(${path.basename(file)})`);
    }
    case "rebuild":
      return rebuild();
    case "restore": {
      const ts = rest[0];
      if (!TS_RE.test(ts ?? "")) die("TIMESTAMP 는 YYYYMMDD-HHMMSS 형식이에요(backups 로 확인).");
      const list = remote(["backups"]).out;
      if (list.includes(`default.bak-${ts}`)) {
        const r = remote(["nginx-restore", ts]);
        const h = r.code === 0 ? await health() : { ok: false, detail: "복원 실패" };
        say(`nginx ${ts} 백업으로 복원: ${r.code === 0 ? "nginx -t 통과, reload" : r.out} / 헬스체크 ${h.ok ? "200" : h.detail}`);
        await report(`nginx 복원(${ts})\n결과: ${r.code === 0 ? "nginx -t 통과, reload" : "실패"}, 헬스체크 ${h.ok ? "200" : h.detail}\n백업: ${backupOf(r.out)}`);
        return;
      }
      if (list.includes(`.env.local.bak-${ts}`)) {
        const r = remote(["env-restore", ts]);
        if (r.code !== 0) die(r.out);
        const st = readState();
        if (!st.envBaseline) {
          st.envBaseline = tsOf(backupOf(r.out));
          writeState(st);
        }
        say(`.env.local 을 ${ts} 백업으로 복원했어요(지금 것은 ${backupOf(r.out)} 에 백업). 반영하려면 rebuild 하세요.`);
        await report(`.env.local 복원(${ts})\n백업: ${backupOf(r.out)}\n반영: rebuild 대기`);
        return;
      }
      return die(`그 시각의 백업이 없어요: ${ts}`);
    }
    case "backups":
      return say(remote(["backups"]).out);
    case "site-init":
      return siteInit(rest);
    case "env-clone":
      return envClone(rest);
    case "nginx-site":
      return nginxSite(rest);
    case "cert":
      return cert(rest);
    case "deploy-push":
      return deployPush(rest);
    case "app-update":
      return appUpdate(rest);
    case "web-release":
      return webRelease(rest);
    case "service-token":
      return serviceToken(rest);
    default:
      die(`서브커맨드: ${SUBCOMMANDS.join(" | ")}`, 2);
  }
}

// 다른 파일이 setDirective 만 가져다 시험할 때는 실행하지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((e) => die(e.message));
}
