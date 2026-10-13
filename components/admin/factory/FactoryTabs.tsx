// components/admin/factory/FactoryTabs.tsx
// 통제실 상단 탭. 링크(?tab=...)라 새로고침·링크 공유가 되고, 지금 탭은 aria-current="page" 로 표시한다.
import Link from "next/link";

import { FACTORY_TABS, type FactoryTab, factoryTabHref } from "./consoleTabs";

export default function FactoryTabs({ active }: { active: FactoryTab }) {
  return (
    <nav aria-label="통제실 메뉴" className="fx-tabs mb-6">
      {FACTORY_TABS.map((t) => (
        <Link
          key={t.key}
          aria-current={t.key === active ? "page" : undefined}
          className="fx-tab"
          href={factoryTabHref(t.key)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
