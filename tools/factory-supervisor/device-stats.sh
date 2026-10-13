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
# 보내는 값은 숫자뿐(CPU %, RAM·디스크 GB, GPU 사용률·VRAM·온도) + 서버1은 실행 중인 Docker 컨테이너 이름.
# 호스트 이름·IP·프로세스 목록·컨테이너 이미지·포트·환경변수는 보내지 않는다.
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

build_json() {
  printf '{"device":"%s","measuredAt":%s,"cpuPct":%s,"ram":%s,"gpu":%s,"disks":%s%s}' \
    "$DEVICE" "$(date +%s)" "$(cpu_pct)" "$(ram_json)" "$(gpu_json)" "$(disks_json)" "$(containers_json)"
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
