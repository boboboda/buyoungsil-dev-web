#!/usr/bin/env node
// 공장 정비 전용 서버 설정 도구. 정비 Claude 는 서버 설정을 이 도구로만 바꾼다(ssh·docker·.env 직접 접근 금지).
// 정해진 서브커맨드만 있고, 임의 명령 실행 옵션은 없다. ssh 는 이 도구 안에서만(BatchMode, 고정 호스트·경로) 쓴다.
//
//   env-keys                         .env.local 의 키 이름만(값은 절대 출력하지 않음)
//   env-set KEY                      값은 환경변수 SERVERCTL_VALUE 또는 stdin 으로만(명령줄·로그에 값 없음). 반영은 rebuild 로
//   env-unset KEY
//   nginx-show                       대상 사이트 설정 파일 내용
//   nginx-set-directive NAME VALUE [LOCATION]   허용된 지시어만. LOCATION 이 없으면 https server 블록 바로 아래
//   nginx-apply FILE                 통째 교체(검증 후)
//   rebuild                          .env 반영용 재빌드(배포 훅과 같은 방식). 실패하면 .env·이미지 되돌림
//   restore TIMESTAMP                백업으로 복원(nginx 면 검증·reload, .env 면 rebuild 필요)
//   backups                          백업 목록
//
// 안전 절차: 바꾸기 전에 백업(작업 폴더 밖, 최근 20개) → 바꾸고 검증(nginx -t, reload, 헬스체크 / rebuild, 헬스체크)
//           → 실패하면 자동 되돌림. 바꿀 때마다 정비 대화와 텔레그램에 "무엇을·백업·검증 결과"를 남긴다(값 제외).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST = "serverpc";
const SITE_URL = "https://www.buyoungsilcoding.com/";
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
const home = os.homedir();
const STATE = path.join(home, "dev", "factory", "serverctl-state.json");
const CONFIG = path.join(home, "dev", "factory", "supervisor.config.json");

// ───────── 서버 쪽 고정 스크립트(인자는 아래에서 형식 검사 후에만 넘긴다) ─────────
const REMOTE = String.raw`
set -u
WORK="$HOME/git-server/work/developWeb"; ENVF="$WORK/.env.local"
ENVB="$HOME/env-backups/developWeb"; NGF=/etc/nginx/sites-enabled/default; NGB="$HOME/nginx-backups"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$ENVB" "$NGB"; chmod 700 "$HOME/env-backups" "$ENVB" "$NGB"; chmod 600 "$ENVB"/.env.local.bak-* "$NGB"/default.bak-* 2>/dev/null
prune() { ls -1t "$1"/$2.bak-* 2>/dev/null | tail -n +21 | xargs -r rm -f; }
env_backup() { B="$ENVB/.env.local.bak-$TS"; cp "$ENVF" "$B"; chmod 600 "$B"; prune "$ENVB" .env.local; echo "BACKUP $B"; }
ng_backup() { B="$NGB/default.bak-$TS"; sudo -n cat "$NGF" > "$B"; chmod 600 "$B"; prune "$NGB" default; echo "BACKUP $B"; }
ng_put() { sudo -n tee "$NGF" < "$1" > /dev/null; }
ng_test() { OUT=$(sudo -n /usr/sbin/nginx -t 2>&1); R=$?; echo "$OUT" | tail -3; return $R; }
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
  *) echo "UNKNOWN"; exit 9 ;;
esac
`;

// 서버에서 고정 스크립트 실행. args 는 호출 전에 형식 검사를 마친 값만. stdin 은 값(.env)·설정 본문 전달에만 쓴다.
function remote(args, input) {
  const b64 = Buffer.from(REMOTE.replace(/\r\n/g, "\n")).toString("base64");
  const quoted = args.map((a) => `'${String(a).replace(/'/g, "")}'`).join(" ");
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, `LC_ALL=C bash -c "$(echo ${b64} | base64 -d)" serverctl ${quoted}`], {
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
async function health(tries = 6, gapMs = 10_000) {
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

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "env-keys": {
      const r = remote(["env-keys"]);
      if (r.code !== 0) die(r.out);
      return say(r.out.split("\n").filter((k) => KEY_RE.test(k) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).join("\n"));
    }
    case "env-set":
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
    default:
      die("서브커맨드: env-keys | env-set KEY | env-unset KEY | nginx-show | nginx-set-directive NAME VALUE [LOCATION] | nginx-apply FILE | rebuild | restore TIMESTAMP | backups", 2);
  }
}

// 다른 파일이 setDirective 만 가져다 시험할 때는 실행하지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((e) => die(e.message));
}
