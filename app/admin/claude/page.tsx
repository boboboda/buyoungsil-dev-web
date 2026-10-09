// app/admin/claude/page.tsx
// 내 PC 의 Claude Code 가 지금 뭘 하는지, 토큰을 얼마나 썼는지 보는 관리자 화면.
import { Metadata } from "next";
import { Card, CardBody } from "@heroui/react";

import ClaudeStatusView from "@/components/admin/claude/ClaudeStatusView";
import { ClaudeStats, getClaudeStats } from "@/lib/claude-status/stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "클로드 작업 현황 | 관리자",
};

export default async function AdminClaudePage() {
  let initial: ClaudeStats | null = null;
  let error: string | null = null;

  try {
    initial = await getClaudeStats();
  } catch (e) {
    console.error("[claude-status] 현황 조회 실패:", e);
    error =
      "작업 현황 DB를 읽지 못했습니다. claude_sessions 테이블이 만들어졌는지(마이그레이션) 확인하세요.";
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="mb-2 text-3xl font-bold">🤖 클로드 작업 현황</h1>
        <p className="text-gray-600 dark:text-gray-400">
          내 PC의 Claude Code가 지금 하는 일과 토큰 사용량을 실시간으로 확인해요
        </p>
      </div>

      {error ? (
        <Card>
          <CardBody>
            <p className="text-sm text-default-500">{error}</p>
          </CardBody>
        </Card>
      ) : (
        <ClaudeStatusView initial={initial} />
      )}
    </div>
  );
}
