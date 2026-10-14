// lib/factory/jobSize.ts
// 승인 화면의 '예상 큼' 표시(1-3): 지시문의 길이·항목 수, 측정·스크린샷 요구 여부로 일감이 오래 걸릴지 어림한다.
// 안내만 하고 막지는 않는다. 순수 함수(서버·화면 모두에서 쓴다).

export const SIZE_LONG_REVISION = 2500; // 수정 지시가 이 글자 수 이상이면 길다(새 앱 기획서는 원래 길어서 이 배수)
export const SIZE_LONG_NEW_FACTOR = 3;
export const SIZE_MANY_ITEMS = 12; // 글머리·번호 항목이 이 개수 이상이면 항목이 많다

const MEASURE = /측정|시뮬레이션|시뮬|벤치마크|벤치|시드|분포|통계|몬테카를로|simulat|benchmark|measure|monte[- ]?carlo/i;
const SHOT = /스크린\s?샷|화면\s?캡처|e2e|이투이|screenshot|playwright/i;

export interface JobSizeEstimate {
  big: boolean; // '예상 큼'
  score: number;
  reasons: string[]; // 화면에 보일 이유
  measure: boolean;
  screenshot: boolean;
  chars: number;
  items: number;
}

/** 지시문(planMarkdown)에서 항목(글머리 -, *, • 와 번호 1. 1)) 개수 */
export function countItems(plan: string): number {
  return plan.split(/\r?\n/).filter((l) => /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/.test(l)).length;
}

/**
 * 크기 어림. 점수: 측정·시뮬레이션 요구 2, 스크린샷·e2e 요구 1, 길다 1, 항목 많다 1. 2점 이상이면 '예상 큼'.
 * 실험(lab)·출시(release) 일감은 대상이 아니다(big: false).
 */
export function estimateJobSize(plan: string, kind: string): JobSizeEstimate {
  const text = String(plan ?? "");
  const chars = text.length;
  const items = countItems(text);
  const none = { big: false, score: 0, reasons: [] as string[], measure: false, screenshot: false, chars, items };

  if (kind !== "new" && kind !== "revision") return none;
  const measure = MEASURE.test(text);
  const screenshot = SHOT.test(text);
  const long = chars >= SIZE_LONG_REVISION * (kind === "new" ? SIZE_LONG_NEW_FACTOR : 1);
  const many = items >= SIZE_MANY_ITEMS;
  const reasons: string[] = [];
  let score = 0;

  if (measure) {
    score += 2;
    reasons.push("측정·시뮬레이션 요구");
  }
  if (screenshot) {
    score += 1;
    reasons.push("스크린샷·e2e 요구");
  }
  if (long) {
    score += 1;
    reasons.push(`지시문이 길어요(${chars.toLocaleString("ko-KR")}자)`);
  }
  if (many) {
    score += 1;
    reasons.push(`항목이 많아요(${items}개)`);
  }

  return { big: score >= 2, score, reasons, measure, screenshot, chars, items };
}

export const BIG_JOB_ADVICE = "측정·조사는 실험 일감으로 나누는 것을 권해요. 코드를 바꾸지 않는 측정·조사·시뮬레이션은 실험 일감으로 먼저 돌리고, 결과를 보고 이 일감에는 고칠 내용만 남기면 빨라요. (안내만 해요. 그대로 승인해도 돼요.)";
