// app/admin/analytics/page.tsx
import { Metadata } from "next";
import { Card, CardBody } from "@heroui/react";

import AdsView from "@/components/admin/analytics/AdsView";
import LiveView from "@/components/admin/analytics/LiveView";
import AnalyticsNav from "@/components/admin/analytics/AnalyticsNav";
import ServerStatsView from "@/components/admin/analytics/ServerStatsView";
import UsersView from "@/components/admin/analytics/UsersView";
import { AdStats, getAdStats } from "@/lib/analytics/adStats";
import { getLiveStats, LiveStats } from "@/lib/analytics/liveStats";
import { getServerStats, ServerStats } from "@/lib/analytics/serverStats";
import { AnalyticsAppInfo, getUserStats, listApps, UserStats } from "@/lib/analytics/stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 분석 | 관리자",
};

const TAB_KEYS = ["users", "ads", "live", "server"];

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-default-500">{children}</p>
      </CardBody>
    </Card>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; app?: string; nodebug?: string }>;
}) {
  const sp = await searchParams;
  const tab = TAB_KEYS.includes(sp.tab ?? "") ? (sp.tab as string) : "users";
  const excludeDebug = sp.nodebug === "1";

  let apps: AnalyticsAppInfo[] = [];
  let appsError: string | null = null;

  try {
    apps = await listApps();
  } catch (e) {
    console.error("[analytics] 앱 목록 조회 실패:", e);
    appsError = "분석 DB를 읽지 못했습니다. 분석 테이블이 만들어졌는지 확인하세요.";
  }

  const selected = apps.find((a) => a.appId === sp.app) ?? apps[0] ?? null;

  let content: React.ReactNode = null;

  if (tab === "server") {
    let stats: ServerStats | null = null;
    let error: string | null = null;

    try {
      stats = await getServerStats();
    } catch (e) {
      console.error("[analytics] 서버 현황 조회 실패:", e);
      error = "환율 DB에 연결하지 못했습니다. MONGODB_URI와 DB 상태를 확인하세요.";
    }

    content = <ServerStatsView error={error} stats={stats} />;
  } else if (appsError) {
    content = <Notice>{appsError}</Notice>;
  } else if (!selected) {
    content = (
      <Notice>
        등록된 앱이 없습니다. scripts/create-analytics-app.ts 로 앱을 등록하세요.
      </Notice>
    );
  } else if (tab === "users") {
    let stats: UserStats | null = null;

    try {
      stats = await getUserStats(selected.id, { excludeDebug });
    } catch (e) {
      console.error("[analytics] 사용자 통계 조회 실패:", e);
    }

    content = stats ? (
      <UsersView stats={stats} />
    ) : (
      <Notice>사용자 통계를 불러오지 못했습니다. 서버 로그를 확인하세요.</Notice>
    );
  } else if (tab === "ads") {
    let stats: AdStats | null = null;

    try {
      stats = await getAdStats(selected.id, { excludeDebug });
    } catch (e) {
      console.error("[analytics] 광고 통계 조회 실패:", e);
    }

    content = stats ? (
      <AdsView stats={stats} />
    ) : (
      <Notice>광고 통계를 불러오지 못했습니다. 서버 로그를 확인하세요.</Notice>
    );
  } else if (tab === "live") {
    let stats: LiveStats | null = null;

    try {
      stats = await getLiveStats(selected.id, { excludeDebug });
    } catch (e) {
      console.error("[analytics] 실시간 조회 실패:", e);
    }

    content = (
      <LiveView
        key={`${selected.appId}-${excludeDebug}`}
        appId={selected.appId}
        excludeDebug={excludeDebug}
        initial={stats}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">📈 앱 분석</h1>
      <AnalyticsNav
        appId={selected?.appId ?? null}
        apps={apps}
        excludeDebug={excludeDebug}
        tab={tab}
      />
      {content}
    </div>
  );
}