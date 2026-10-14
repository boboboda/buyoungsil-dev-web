// tools/factory-supervisor/slots.mjs
// '동시에 만들 앱 수' 정하기. 통제실 [설정]의 값(/next 의 appSlots)이 우선이고, PC 설정 파일의 slots 는 서버 값이 없을 때의 기본값이다.
export const MIN_APP_SLOTS = 1;
export const MAX_APP_SLOTS = 4;
export const DEFAULT_APP_SLOTS = 3; // 서버에 정해 둔 값이 없을 때(예전 기본값은 2였다)
export const OLD_DEFAULT_SLOTS = 2; // `init` 이 설정 파일에 그대로 적어 둔 예전 기본값

/** 1~4 정수만 받는다(숫자 또는 정수 문자열). 그 밖(소수·범위 밖·빈 값·NaN)은 null */
export function cleanSlots(v) {
  if (typeof v === "string" && !/^\s*\d{1,3}\s*$/.test(v)) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_APP_SLOTS && n <= MAX_APP_SLOTS ? n : null;
}

/**
 * PC 설정 파일(raw)의 slots.
 * custom = 사람이 따로 정한 값(예전 기본값 2 가 아닌 유효한 값). `init` 이 적어 둔 2 는 '정한 것'으로 보지 않는다.
 */
export function pcSlots(raw) {
  const v = cleanSlots(raw?.slots);
  return { value: v ?? DEFAULT_APP_SLOTS, custom: v !== null && v !== OLD_DEFAULT_SLOTS };
}

/**
 * 지금 쓸 동시 실행 수.
 *  - 서버가 값을 정했으면(appSlots, isDefault 아님) 그 값
 *  - 서버가 '정한 적 없음'(기본 3)이면: PC 에 따로 정해 둔 값이 있으면 그 값, 없으면 3
 *  - 서버 값이 없거나 범위 밖(예전 서버·이상한 값)이면 PC 값
 */
export function effectiveSlots({ server, serverIsDefault = false, pc }) {
  const s = cleanSlots(server);
  if (s === null) return pc.value;
  if (serverIsDefault && pc.custom) return pc.value;
  return s;
}

/**
 * /next 에 slots 로 요청할 개수 = 비어 있는 자리. 정비가 대기·진행 중이어도 자리는 그대로다(정비와 앱·실험 일감은 동시에 돈다).
 * draining = 감독 프로그램 업데이트·서버 배포를 진행 중 일감이 끝나길 기다리는 중이면 0(신호·설정만 받음).
 * 값을 줄여서 돌던 일감이 한도보다 많아져도 음수 없이 0 이다(돌던 일감은 끊지 않고 끝나면서 줄어든다).
 */
export function planTake({ limit, running, draining = false }) {
  if (draining) return 0;
  return Math.max(0, Math.floor(limit) - Math.floor(running));
}
