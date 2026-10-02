// app/admin/analytics/page.tsx
import { Metadata } from "next";

import { getServerStats, ServerStats } from "@/lib/analytics/serverStats";
import ServerStatsView from "@/components/analytics/ServerStatsView";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 분석 | 관리자",
};

export default async function AdminAnalyticsPage() {
  let stats: ServerStats | null = null;
  let error: string | null = null;

  try {
    stats = await getServerStats();
  } catch (e) {
    console.error("[analytics] 서버 현황 조회 실패:", e);
    error = "환율 DB에 연결하지 못했습니다. MONGODB_URI와 DB 상태를 확인하세요.";
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-8">📈 앱 분석</h1>
      <ServerStatsView error={error} stats={stats} />
    </div>
  );
}