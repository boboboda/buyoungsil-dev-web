// components/admin/factory/consoleTabs.ts
// 통제실 상단 탭 목록과 주소(?tab=...) 해석. 모르는 값이면 [현황].
// 옛 주소 /admin/factory/release·/admin/factory/settings 는 그대로 열리고 해당 탭을 보여 준다.

export const FACTORY_TABS = [
  { key: "status", label: "현황" },
  { key: "jobs", label: "일감" },
  { key: "release", label: "출시" },
  { key: "settings", label: "설정" },
  { key: "usage", label: "사용량" },
  { key: "novels", label: "작품" },
] as const;

export type FactoryTab = (typeof FACTORY_TABS)[number]["key"];

export const DEFAULT_FACTORY_TAB: FactoryTab = "status";

export function parseFactoryTab(
  raw: string | string[] | undefined | null,
): FactoryTab {
  const v = Array.isArray(raw) ? raw[0] : raw;

  return FACTORY_TABS.some((t) => t.key === v)
    ? (v as FactoryTab)
    : DEFAULT_FACTORY_TAB;
}

// 주소의 ?history=(현황 이력 탭)·?job=(일감 상세). 모르는 값이면 무시한다
const HISTORY_TAB_KEYS = ["all", "deploys", "updates", "threads", "jobs"] as const;
export type HistoryTabKey = (typeof HISTORY_TAB_KEYS)[number];

export function parseHistoryTab(raw: string | string[] | undefined | null): HistoryTabKey | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;

  return HISTORY_TAB_KEYS.find((k) => k === v);
}

export function parseJobId(raw: string | string[] | undefined | null): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;

  return v && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null;
}

export const factoryTabHref = (tab: FactoryTab) => `/admin/factory?tab=${tab}`;
