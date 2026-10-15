// 일감 효율 규칙(10-15 측정 실험 근거): 검사·빌드·시험·스크린샷을 편집마다 되풀이하는 낭비를 줄인다.
// ① 새 일감·정비·재개 프롬프트에 들어가는 규칙 문구 ② 일감이 실행한 횟수 집계와 상한 초과 표시. 이 모듈은 다른 모듈을 import 하지 않는다(순환 방지).
// 상한을 넘어도 일감을 멈추지 않는다(경고만). 같은 시험 반복 막기(loopguard)와 별개다.

export const WORK_LIMITS = Object.freeze({ static: 4, build: 2, fullTest: 2, partialTest: 8 });

export const WORK_RULES = `[검사·시험·스크린샷 규칙]
- 스크린샷: 화면 기능을 바꿀 때만, 바뀐 그 화면을 변경 전 1장·변경 후 1장. 화면 변경이 없는 일(서버·API·도구·정비)은 0장. 다크모드·가로·태블릿·글자 크기 변형은 지시에 있을 때만.
- 정적 검사(tsc·lint·flutter analyze): 편집마다 돌리지 말고 일감당 최대 ${WORK_LIMITS.static}회. 마지막 1회는 생략(감독 사후 검증이 한다).
- 전체 시험·빌드: 일감당 각각 최대 ${WORK_LIMITS.fullTest}회(중간 1·마지막 1). 작업 중엔 바꾼 파일과 관련된 시험만(일감당 최대 ${WORK_LIMITS.partialTest}회). 빌드와 전체 시험은 한 명령에 묶지 않는다.
- 같은 시험이 같은 이유로 2번 실패하면 멈추고 보고한다.
- 상한을 넘겨야 하면 넘기기 전에 \`echo "상한 초과: 이유"\` 로 로그에 한 줄 남긴다(감독이 결과에 "상한 초과: 이유"로 표시한다).`;

// 재개 메시지용 짧은 판(세션에는 처음 규칙이 이미 있다)
export const WORK_RULES_SHORT = `검사·시험 규칙은 그대로: 정적 검사 최대 ${WORK_LIMITS.static}회(마지막은 생략), 전체 시험·빌드 각 ${WORK_LIMITS.fullTest}회, 부분 시험 ${WORK_LIMITS.partialTest}회, 같은 실패 2번이면 멈추고 보고.`;

const SKIP = /^(?:cd|export|set|echo|mkdir|rm|ls|cat|head|tail|grep|rg|sleep|git|sed|awk|wc|find|type|printf)\b/;
const STATIC = /\btsc\b|\beslint\b|\bflutter\s+analyze\b|\bdart\s+analyze\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|typecheck|analyze)\b|\bruff\b|\bmypy\b/i;
const BUILD = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bnext\s+build\b|\bflutter\s+build\b|\bgradlew?(?:\.bat)?\s+\S*(?:assemble|bundle|build)|\bcargo\s+build\b|\bdotnet\s+build\b|\bgo\s+build\b/i;
const SHOT = /screenshots?\b|\bplaywright\b|\bcypress\b|\bdetox\b|\bmaestro\b|\be2e\b|integration_test/i;
const TEST = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnpx\s+(?:jest|vitest)\b|\b(?:jest|vitest|pytest)\b|\bflutter\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\bgo\s+test\b|\bgradlew?(?:\.bat)?\s+\S*test|\bnode\s+(?:--test\b|\S*\.test\.m?js\b)/i;
// 시험 명령에 특정 파일·이름이 붙어 있으면 부분 시험, 없으면 전체 시험
const PARTIAL_HINT = /\.(?:test|spec)\.[cm]?[jt]sx?\b|(?:^|\s)(?:test|tests|__tests__|e2e)\/\S+|_test\.(?:dart|go|py)\b|\btest\/\S+\.dart\b|\btest_\w+\.py\b|\s-t\s|--(?:grep|testNamePattern|filter|name|test-name-pattern|run|tests?)\b|\s-k\s|::|\.test\.mjs/i;

/** 한 줄 명령 → ["static" | "build" | "fullTest" | "partialTest" | "screenshot", ...] (&&, ;, || 로 이어진 조각마다 하나) */
export function classifyWork(command) {
  const out = [];
  for (const raw of String(command ?? "").replace(/\s+/g, " ").split(/\s*(?:&&|;|\|\|)\s*/)) {
    const seg = raw.split(/\s*\|\s*/)[0].trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
    if (!seg || SKIP.test(seg)) continue;
    if (SHOT.test(seg)) out.push("screenshot");
    else if (STATIC.test(seg)) out.push("static");
    else if (BUILD.test(seg)) out.push("build");
    else if (TEST.test(seg)) out.push(PARTIAL_HINT.test(seg) ? "partialTest" : "fullTest");
  }
  return out;
}

export const WORK_LABELS = { static: "정적 검사", build: "빌드", fullTest: "전체 시험", partialTest: "부분 시험", screenshot: "스크린샷" };

/** 상한 초과 이유 한 줄을 남기는 명령인가: echo "상한 초과: 이유" → 이유 */
export function overLimitReason(command) {
  const m = /^\s*(?:echo|printf)\s+(?:-\w+\s+)?["']?상한 초과:\s*([^"'\n]{1,200})/.exec(String(command ?? ""));
  return m ? m[1].trim() : null;
}

/** 일감 하나의 집계기. add(명령) 로 먹이고 summary() 로 결과 문구를 얻는다 */
export function createWorkCounter() {
  const counts = { static: 0, build: 0, fullTest: 0, partialTest: 0, screenshot: 0 };
  const reasons = [];
  const api = {
    counts,
    reasons,
    add(command) {
      const reason = overLimitReason(command);
      if (reason) { if (reasons.length < 5) reasons.push(reason); return; }
      for (const k of classifyWork(command)) counts[k]++;
    },
    feed(events) { for (const e of events) if (e.type === "start") api.add(e.command); },
    over() { return Object.keys(WORK_LIMITS).filter((k) => counts[k] > WORK_LIMITS[k]); },
    total() { return Object.values(counts).reduce((a, b) => a + b, 0); },
    /** 실행이 없으면 null. 있으면 "작업 횟수: …" 한 줄 + 상한 초과가 있으면 "상한 초과: …" 한 줄 */
    summary() {
      if (api.total() === 0 && !reasons.length) return null;
      const line = `작업 횟수: ${Object.keys(counts).map((k) => `${WORK_LABELS[k]} ${counts[k]}`).join(" · ")}`;
      const over = api.over();
      if (!over.length && !reasons.length) return line;
      const parts = over.map((k) => `${WORK_LABELS[k]} ${counts[k]}회(상한 ${WORK_LIMITS[k]})`);
      const why = reasons.length ? ` — 이유: ${reasons.join(" / ")}` : over.length ? " — 이유 기록 없음" : "";
      return `${line}\n상한 초과: ${parts.join(", ") || "이유만 기록됨"}${why}`;
    },
  };
  return api;
}
