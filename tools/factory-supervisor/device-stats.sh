#!/usr/bin/env bash
# 서버1·서버2(Linux) 장비 상태를 홈페이지 통제실 '장비 상태' 패널로 보낸다. node 없이 bash·awk·df·curl 만 쓴다.
# 호스트에서 cron 으로 1분마다 돈다(컨테이너 안이 아니라 호스트 /proc·df·docker 를 읽어야 값이 맞다).
#
#   device-stats.sh          읽어서 보낸다(cron 용, 성공하면 조용히 끝남)
#   device-stats.sh print    읽기만 하고 보낼 JSON 을 보여 준다(값 확인용)
#   device-stats.sh check    설정 파일이 있는지·서버가 받는지 확인한다(토큰 값은 출력하지 않음)
#
# 설정(~/.config/device-stats/):
#   env    DEVICE_STATS_DEVICE=server1|server2, DEVICE_STATS_URL=https://…/api/factory/device-stats
#   token  홈페이지 상태 수신 토큰(CLAUDE_STATUS_TOKEN 과 같은 값) 한 줄, 권한 600
# 보내는 값은 숫자(CPU %, RAM·디스크 GB, GPU 사용률·VRAM·온도) + 서버1은 실행 중인 Docker 컨테이너 이름
# + running: docker ps -a 기반 컨테이너별 이름·이미지(태그까지)·상태·가동 시간·재시작 횟수·CPU%·메모리·compose 프로젝트 이름과 멈춘 컨테이너·안 쓰는 이미지·볼륨 수(전부 읽기 전용).
# 호스트 이름·IP·포트·환경변수·명령줄·마운트 경로는 보내지 않는다.
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export LC_ALL=C

CONF_DIR="${DEVICE_STATS_CONF:-$HOME/.config/device-stats}"
[ -f "$CONF_DIR/env" ] && . "$CONF_DIR/env"
DEVICE="${DEVICE_STATS_DEVICE:-}"
URL="${DEVICE_STATS_URL:-}"

# CPU: /proc/stat 첫 줄을 1초 간격으로 두 번 읽은 차이(호스트 전체)
cpu_pct() {
  local a b
  a=$(awk '/^cpu /{i=$5+$6; t=0; for(k=2;k<=NF;k++) t+=$k; print i, t; exit}' /proc/stat)
  sleep 1
  b=$(awk '/^cpu /{i=$5+$6; t=0; for(k=2;k<=NF;k++) t+=$k; print i, t; exit}' /proc/stat)
  echo "$a $b" | awk '{dt=$4-$2; di=$3-$1; if (dt>0) printf "%.1f", (1-di/dt)*100; else printf "null"}'
}

# RAM: MemTotal - MemAvailable (GiB)
ram_json() {
  awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{ if (t>0) printf "{\"usedGb\":%.1f,\"totalGb\":%.1f}", (t-a)/1048576, t/1048576; else printf "null"}' /proc/meminfo
}

# 디스크: 실제 파일 시스템만(tmpfs·overlay·squashfs 등 제외), / 먼저, 나머지는 큰 순서로 최대 4개. 같은 장치는 한 번만
disks_json() {
  df -P -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs -x fuse.snapfuse 2>/dev/null |
    awk 'NR>1 && $2>0 && $6 !~ /^\/(boot|snap|run|proc|sys|dev)(\/|$)/ && $6 !~ /^\/var\/lib\/docker\// {
      if (seen[$1]++) next
      m=$6; gsub(/[^A-Za-z0-9_\/.-]/, "", m); m=substr(m,1,40)
      printf "%d\t%s\t%.1f\t%.1f\n", ($6=="/" ? 1 : 0), m, $3/1073741824, $2/1073741824
    }' |
    sort -t "$(printf '\t')" -k1,1nr -k4,4nr | head -n 4 |
    awk -F '\t' 'BEGIN{printf "["} {printf "%s{\"mount\":\"%s\",\"usedGb\":%s,\"totalGb\":%s}", (NR>1?",":""), $2, $3, $4} END{printf "]"}'
}

# GPU: nvidia-smi 가 없으면 '없음', 있는데 실패하면 '확인 못 함'
gpu_json() {
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    printf '{"state":"none"}'
    return
  fi
  local out
  if ! out=$(timeout 5 nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null) || [ -z "$out" ]; then
    printf '{"state":"unknown"}'
    return
  fi
  echo "$out" | head -n 4 | awk -F', *' '
    function n(v) { return (v ~ /^[0-9.]+$/) ? v : "null" }
    function gb(v) { return (v ~ /^[0-9.]+$/) ? sprintf("%.1f", v/1024) : "null" }
    BEGIN { printf "{\"state\":\"ok\",\"list\":[" }
    { printf "%s{\"utilPct\":%s,\"memUsedGb\":%s,\"memTotalGb\":%s,\"tempC\":%s}", (NR>1?",":""), n($1), gb($2), gb($3), n($4) }
    END { printf "]}" }'
}

# 실행 중인 Docker 컨테이너 이름만(서버1). docker 가 없으면 빼고, 권한이 없으면 '확인 못 함'
containers_json() {
  command -v docker >/dev/null 2>&1 || return 0
  local names
  if ! names=$(timeout 10 docker ps --format '{{.Names}}' 2>/dev/null); then
    printf ',"containers":{"state":"unknown"}'
    return
  fi
  printf '%s\n' "$names" | tr -cd 'A-Za-z0-9_.\n-' | awk 'NF' | sort | head -n 60 |
    awk 'BEGIN{printf ",\"containers\":{\"state\":\"ok\",\"names\":["} {printf "%s\"%s\"", (NR>1?",":""), substr($0,1,60)} END{printf "]}"}'
}

# ── 실행 중인 모든 것(running): docker ps -a 기반, 전부 읽기 전용(종료·삭제·정리 명령 없음) ──
# 컨테이너마다 이름·이미지(태그까지)·상태·가동/정지 시간·재시작 횟수·CPU%·메모리·compose 프로젝트 이름만.
# 환경변수·명령줄·마운트·라벨(compose 프로젝트 이름 하나 빼고)은 읽지 않는다. 실패해도 해당 칸만 null + 이유 한 줄.
RUN_ROWS=""   # 메모리 큰 순으로 정렬된 컨테이너 JSON 객체(한 줄에 하나)
RUN_TOTAL=0   # 컨테이너 수(자르기 전)
RUN_SUM="null"
RUN_ERR=""

collect_running() {
  RUN_ROWS=""; RUN_TOTAL=0; RUN_SUM="null"; RUN_ERR=""
  if ! command -v docker >/dev/null 2>&1; then RUN_ERR="docker 없음"; return 0; fi
  local ps ids insp st dl vl stopped dn db vn
  if ! ps=$(timeout 10 docker ps -a --format '{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null); then
    RUN_ERR="docker 권한 없음 또는 응답 없음"; return 0
  fi
  ps=$(printf '%s\n' "$ps" | awk 'NF' | head -n 200)
  RUN_TOTAL=$(printf '%s\n' "$ps" | awk 'NF' | wc -l | tr -d ' ')
  ids=$(timeout 10 docker ps -aq 2>/dev/null | head -n 200 | tr '\n' ' ')
  insp=""
  [ -n "$ids" ] && insp=$(timeout 15 docker inspect --format '{{.Name}}|{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.RestartCount}}' $ids 2>/dev/null)
  st=$(timeout 8 docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null)
  RUN_ROWS=$({
    printf '%s\n' "$ps" | awk 'NF{print "P|" $0}'
    printf '%s\n' "$insp" | awk 'NF{print "I|" $0}'
    printf '%s\n' "$st" | awk 'NF{print "S|" $0}'
  } | awk -F'|' -v now="$(date +%s)" '
    function ub(s,  n, u) {
      n = s + 0; u = tolower(s); sub(/^[0-9.]+/, "", u); gsub(/[ \t]/, "", u)
      if (u == "b") return n
      if (u == "kb") return n * 1e3
      if (u == "kib") return n * 1024
      if (u == "mb") return n * 1e6
      if (u == "mib") return n * 1048576
      if (u == "gb") return n * 1e9
      if (u == "gib") return n * 1073741824
      return -1
    }
    function ep(s,  y, m, d, H, M, S, era, yoe, doy, doe) {
      if (length(s) < 19) return -1
      y = substr(s, 1, 4) + 0; m = substr(s, 6, 2) + 0; d = substr(s, 9, 2) + 0
      H = substr(s, 12, 2) + 0; M = substr(s, 15, 2) + 0; S = substr(s, 18, 2) + 0
      if (y < 1971) return -1
      if (m <= 2) y -= 1
      era = int(y / 400); yoe = y - era * 400
      doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
      doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
      return (era * 146097 + doe - 719468) * 86400 + H * 3600 + M * 60 + S
    }
    function cl(s, re) { gsub(re, "", s); return s }  # re 는 문자열로 넘긴다(/…/ 로 넘기면 $0 비교가 됨)
    $1 == "P" { nm = cl($2, "[^A-Za-z0-9_.-]"); if (nm == "") next
      names[++cnt] = nm; img[nm] = $3; sta[nm] = $4; stt[nm] = $5; prj[nm] = $6; next }
    $1 == "I" { nm = $2; sub(/^\//, "", nm); sa[nm] = $3; fa[nm] = $4; rc[nm] = $5; next }
    $1 == "S" { cpu[$2] = $3; mem[$2] = $4; next }
    END {
      for (i = 1; i <= cnt; i++) {
        nm = names[i]
        im = img[nm]; sub(/@.*/, "", im); im = substr(cl(im, "[^A-Za-z0-9_./:-]"), 1, 200)
        state = tolower(cl(sta[nm], "[^A-Za-z]")); if (state == "") state = "unknown"
        status = substr(cl(stt[nm], "[^A-Za-z0-9 _.,:()/-]"), 1, 80)
        proj = substr(cl(prj[nm], "[^A-Za-z0-9_.-]"), 1, 60)
        s0 = ep(sa[nm]); f0 = ep(fa[nm])
        up = (state == "running" && s0 > 0 && now >= s0) ? sprintf("%d", now - s0) : "null"
        stp = ((state == "exited" || state == "dead") && f0 > 0 && now >= f0) ? sprintf("%d", now - f0) : "null"
        rs = (rc[nm] ~ /^[0-9]+$/) ? rc[nm] : "null"
        cp = (cpu[nm] != "") ? sprintf("%.1f", cpu[nm] + 0) : "null"
        mb = -1
        if (mem[nm] != "") { split(mem[nm], mm, "/"); b = ub(mm[1]); if (b >= 0) mb = b / 1048576 }
        printf "%.1f\t{\"name\":\"%s\",\"image\":%s,\"state\":\"%s\",\"status\":%s,\"uptimeSec\":%s,\"stoppedSec\":%s,\"restarts\":%s,\"cpuPct\":%s,\"memMb\":%s,\"project\":%s}\n", \
          mb, nm, (im == "" ? "null" : "\"" im "\""), state, (status == "" ? "null" : "\"" status "\""), up, stp, rs, cp, (mb >= 0 ? sprintf("%.1f", mb) : "null"), (proj == "" ? "null" : "\"" proj "\"")
      }
    }' | sort -t "$(printf '\t')" -k1,1nr | cut -f2-)
  # 요약: 멈춘 컨테이너 수, 안 쓰는(dangling) 이미지 수·용량, 볼륨 수. 읽지 못한 칸은 null
  stopped=$(printf '%s\n' "$ps" | awk -F'|' 'NF && $3 != "running"' | wc -l | tr -d ' ')
  dn=null; db=null; vn=null
  if dl=$(timeout 10 docker images -f dangling=true --format '{{.Size}}' 2>/dev/null); then
    dn=$(printf '%s\n' "$dl" | awk 'NF' | wc -l | tr -d ' ')
    db=$(printf '%s\n' "$dl" | awk 'NF { n = $1 + 0; u = tolower($1); sub(/^[0-9.]+/, "", u)
      m = (u == "kb" ? 1e3 : u == "mb" ? 1e6 : u == "gb" ? 1e9 : u == "tb" ? 1e12 : u == "kib" ? 1024 : u == "mib" ? 1048576 : u == "gib" ? 1073741824 : 1); t += n * m }
      END { printf "%d", t }')
  fi
  if vl=$(timeout 10 docker volume ls -q 2>/dev/null); then vn=$(printf '%s\n' "$vl" | awk 'NF' | wc -l | tr -d ' '); fi
  RUN_SUM=$(printf '{"stoppedContainers":%s,"danglingImages":%s,"imageBytes":%s,"volumes":%s}' "$stopped" "$dn" "$db" "$vn")
}

# 컨테이너 상위 n개로 running 조각을 만든다(넘으면 truncated:true)
running_json() {
  local n="$1" rows trunc=false err="null" cont
  [ "$RUN_TOTAL" -gt "$n" ] && trunc=true
  [ -n "$RUN_ERR" ] && err="\"$RUN_ERR\""
  if [ -n "$RUN_ERR" ]; then
    printf ',"running":{"containers":null,"processes":null,"summary":null,"error":%s,"truncated":false}' "$err"
    return
  fi
  rows=$(printf '%s\n' "$RUN_ROWS" | awk 'NF' | head -n "$n" | paste -sd, -)
  printf ',"running":{"containers":[%s],"processes":null,"summary":%s,"error":null,"truncated":%s}' "$rows" "$RUN_SUM" "$trunc"
}

# 8KB 제한(서버 413)보다 작게: 컨테이너를 15 → 10 → 6 → 3 → 0 개로 줄여 가며 맞춘다
build_json() {
  local base cont n out
  base=$(printf '{"device":"%s","measuredAt":%s,"cpuPct":%s,"ram":%s,"gpu":%s,"disks":%s' \
    "$DEVICE" "$(date +%s)" "$(cpu_pct)" "$(ram_json)" "$(gpu_json)" "$(disks_json)")
  cont=$(containers_json)
  collect_running
  for n in 15 10 6 3 0; do
    out="${base}${cont}$(running_json "$n")}"
    [ "${#out}" -le 7600 ] && break
  done
  printf '%s' "$out"
}

send() {
  local tok
  tok=$(head -n 1 "$CONF_DIR/token" 2>/dev/null | tr -d '\r\n ')
  [ -n "$tok" ] || { echo "토큰 파일이 없어요: $CONF_DIR/token" >&2; return 1; }
  # 토큰은 명령줄(ps)에 보이지 않게 프로세스 치환(-H @파일)으로 넘긴다(printf 는 셸 내장이라 ps 에 안 보임)
  build_json | curl -fsS -m 15 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -H @<(printf 'Authorization: Bearer %s\n' "$tok") \
    --data-binary @- "$URL"
}

case "${1:-send}" in
  print)
    build_json
    echo
    ;;
  check)
    echo "설정 파일: $([ -f "$CONF_DIR/env" ] && echo 있음 || echo 없음) · 토큰 파일: $([ -s "$CONF_DIR/token" ] && echo 있음 || echo 없음)"
    echo "장비 이름: ${DEVICE:-없음} · 보낼 주소: $([ -n "$URL" ] && echo 정해짐 || echo 없음)"
    for c in awk df curl; do command -v "$c" >/dev/null 2>&1 || echo "필요한 명령 없음: $c"; done
    code=$(send 2>/dev/null) || true
    echo "서버 응답: ${code:-연결 실패} (200 이면 정상)"
    ;;
  send)
    case "$DEVICE" in server1 | server2) ;; *)
      echo "DEVICE_STATS_DEVICE 는 server1 또는 server2 여야 해요" >&2
      exit 2
      ;;
    esac
    [ -n "$URL" ] || { echo "DEVICE_STATS_URL 이 없어요" >&2; exit 2; }
    send >/dev/null
    ;;
  *)
    echo "사용법: device-stats.sh [send|print|check]" >&2
    exit 2
    ;;
esac
