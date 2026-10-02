// serverActions/analyticsStats.ts
"use server";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth";
import { getServerStats } from "@/lib/analytics/serverStats";

// 서버 액션은 외부에서 직접 호출될 수 있으므로 관리자 권한을 다시 확인한다.
export async function refreshServerStats(): Promise<{
  ok: boolean;
  message?: string;
}> {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (role !== "admin") {
    return { ok: false, message: "권한이 없습니다." };
  }

  try {
    await getServerStats(true);

    return { ok: true };
  } catch (error) {
    console.error("[analytics] 서버 현황 새로고침 실패:", error);

    return { ok: false, message: "환율 DB 조회에 실패했습니다." };
  }
}