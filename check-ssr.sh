#!/usr/bin/env bash
# 사용법:
#   ./check-ssr.sh                              # 기본: http://localhost:3000
#   ./check-ssr.sh http://localhost:3000
#   ./check-ssr.sh https://www.buyoungsilcoding.com
#
# 각 페이지의 <body> 에서 <script> 를 제거한 "화면용 HTML" 길이를 잰다.
# MIN_BYTES 이상이면 PASS (서버가 본문을 그려서 내려주는 것),
# 그보다 작으면 FAIL (빈 껍데기).

BASE="${1:-http://localhost:3000}"
MIN_BYTES="${MIN_BYTES:-1500}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"

# 페이지|본문에 반드시 있어야 하는 문구(없으면 길이만 검사)
PAGES=(
  "/|"
  "/about|콘텐츠 원칙"
  "/privacy|안전성 확보 조치"
  "/contact|"
  "/project|"
  "/stories|"
  "/note|"
  "/note/flutter|"
)

pass=0
fail=0

for entry in "${PAGES[@]}"; do
  path="${entry%%|*}"
  phrase="${entry#*|}"

  result=$(curl -s -m 30 -A "$UA" -w $'\n%{http_code}' "$BASE$path" | python3 -c "
import sys, re
raw = sys.stdin.read()
html, _, code = raw.rpartition('\n')
start = html.find('<body')
end = html.find('</body>')
body = html[start:end] if start >= 0 and end > start else ''
visible = re.sub(r'<script.*?</script>', '', body, flags=re.S)
phrase = sys.argv[1]
has_phrase = ('-' if not phrase else ('Y' if phrase in visible else 'N'))
print(code.strip(), len(visible), has_phrase)
" "$phrase")

  code=$(echo "$result" | awk '{print $1}')
  size=$(echo "$result" | awk '{print $2}')
  has=$(echo "$result" | awk '{print $3}')

  ok=1
  [ "$code" != "200" ] && ok=0
  [ "${size:-0}" -lt "$MIN_BYTES" ] && ok=0
  [ "$has" = "N" ] && ok=0

  if [ $ok -eq 1 ]; then
    printf "PASS  %-14s http=%s  visible=%s bytes  phrase=%s\n" "$path" "$code" "$size" "$has"
    pass=$((pass+1))
  else
    printf "FAIL  %-14s http=%s  visible=%s bytes  phrase=%s\n" "$path" "$code" "$size" "$has"
    fail=$((fail+1))
  fi
done

echo "---- PASS $pass / FAIL $fail"
[ $fail -eq 0 ]