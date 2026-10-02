// components/admin/analytics/AnalyticsNav.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectItem, Switch, Tab, Tabs } from "@heroui/react";

import type { AnalyticsAppInfo } from "@/lib/analytics/stats";

interface Props {
  apps: AnalyticsAppInfo[];
  appId: string | null;
  tab: string;
  excludeDebug: boolean;
}

const TABS = [
  { key: "users", title: "사용자" },
  { key: "ads", title: "광고" },
  { key: "live", title: "실시간" },
  { key: "server", title: "서버 현황" },
];

export default function AnalyticsNav({ apps, appId, tab, excludeDebug }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: { tab?: string; app?: string; excludeDebug?: boolean }) => {
    const q = new URLSearchParams();

    q.set("tab", next.tab ?? tab);

    const app = next.app ?? appId;

    if (app) q.set("app", app);
    if (next.excludeDebug ?? excludeDebug) q.set("nodebug", "1");

    startTransition(() => {
      router.push(`/admin/analytics?${q.toString()}`);
    });
  };

  const scoped = tab !== "server";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 mb-6 ${
        pending ? "opacity-60" : ""
      }`}
    >
      <Select
        aria-label="앱 선택"
        className="w-56"
        disallowEmptySelection
        isDisabled={!scoped || apps.length === 0}
        placeholder="앱 선택"
        selectedKeys={appId ? [appId] : []}
        size="sm"
        onSelectionChange={(keys) => {
          const v = Array.from(keys)[0];

          if (v) go({ app: String(v) });
        }}
      >
        {apps.map((a) => (
          <SelectItem key={a.appId}>{a.name}</SelectItem>
        ))}
      </Select>

      <Tabs
        aria-label="분석 탭"
        selectedKey={tab}
        variant="underlined"
        onSelectionChange={(k) => go({ tab: String(k) })}
      >
        {TABS.map((t) => (
          <Tab key={t.key} title={t.title} />
        ))}
      </Tabs>

      {scoped ? (
        <Switch
          isSelected={excludeDebug}
          size="sm"
          onValueChange={(v) => go({ excludeDebug: v })}
        >
          디버그 빌드 제외
        </Switch>
      ) : null}
    </div>
  );
}