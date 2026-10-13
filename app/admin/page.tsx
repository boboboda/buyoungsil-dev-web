import { Metadata } from "next";
import Link from "next/link";

import { Digits, Led } from "@/components/admin/ui/meters";
import {
  getDashboardCounts,
  type DashboardCounts,
} from "@/lib/admin/dashboardCounts";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "관리자 대시보드",
};

// DB 가 없거나(주소 없음·접속 실패) 쿼리가 실패해도 대시보드는 빈 값으로 뜬다.
async function getStats(): Promise<DashboardCounts> {
  try {
    const { default: prisma } = await import("@/lib/prisma");

    return await getDashboardCounts(prisma);
  } catch (error) {
    console.error("관리자 대시보드 집계 실패:", error);

    return {
      pendingWorkRequests: null,
      unansweredBoardPosts: null,
      unansweredEduPosts: null,
      pendingDrafts: null,
      totalProjects: null,
      totalNotes: null,
      totalStories: null,
      totalWorkRequests: null,
    };
  }
}

// 처리 대기 카드: 0 이면 '없음'으로 조용하게, 1 이상이면 노란 LED·숫자로 눈에 띄게, 못 세면 '-'
function PendingCard({
  icon,
  label,
  value,
  href,
}: {
  icon: string;
  label: string;
  value: number | null;
  href: string;
}) {
  const waiting = value !== null && value > 0;

  return (
    <Link href={href}>
      <div
        className={`fx-panel fx-tile h-full p-5 ${waiting ? "fx-tile-alert" : ""}`}
      >
        <p className="text-sm fx-muted mb-2">
          {icon} {label}
        </p>
        {value === null ? (
          <Led tone="idle">
            <span title="숫자를 읽지 못했어요">읽기 실패 -</span>
          </Led>
        ) : waiting ? (
          <div className="flex items-end justify-between gap-2 fx-warn">
            <Digits unit="건" value={String(value)} />
            <Led tone="warn">대기</Led>
          </div>
        ) : (
          <Led tone="ok">없음</Led>
        )}
      </div>
    </Link>
  );
}

interface StatCardProps {
  icon: string;
  label: string;
  value: number | null;
  href?: string;
}

function StatCard({ icon, label, value, href }: StatCardProps) {
  const content = (
    <div className="fx-panel fx-tile p-6">
      <div className="text-3xl mb-2" aria-hidden>
        {icon}
      </div>
      <p className="text-sm fx-muted mb-1">{label}</p>
      <span className="fx-run">
        <Digits value={value === null ? "-" : String(value)} />
      </span>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export default async function AdminDashboard() {
  const stats = await getStats();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📊 관리자 대시보드</h1>
        <p className="fx-muted">
          사이트 전체 현황을 한눈에 확인하세요
        </p>
      </div>

      {/* 처리 대기 */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">🔔 처리 대기</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <PendingCard
            href="/admin/works"
            icon="💻"
            label="외주 신청 대기"
            value={stats.pendingWorkRequests}
          />
          <PendingCard
            href="/admin/boards"
            icon="💬"
            label="앱별 게시판 문의 답변 대기"
            value={stats.unansweredBoardPosts}
          />
          <PendingCard
            href="/admin/edu"
            icon="🧰"
            label="특수교육 도구함 요청 답변 대기"
            value={stats.unansweredEduPosts}
          />
          <PendingCard
            href="/admin/drafts"
            icon="📥"
            label="초안함 대기"
            value={stats.pendingDrafts}
          />
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon="💼"
          label="프로젝트"
          value={stats.totalProjects}
          href="/admin/projects"
        />
        <StatCard
          icon="📚"
          label="개발노트"
          value={stats.totalNotes}
          href="/admin/notes"
        />
        <StatCard
          icon="😅"
          label="스토리"
          value={stats.totalStories}
          href="/admin/stories"
        />
        <StatCard
          icon="💻"
          label="전체 외주 신청"
          value={stats.totalWorkRequests}
          href="/admin/works"
        />
      </div>

      {/* 빠른 작업 */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">⚡ 빠른 작업</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Link href="/admin/projects/create">
            <button className="fx-key w-full p-4">
              + 새 프로젝트
            </button>
          </Link>
          <Link href="/admin/write">
            <button className="fx-key w-full p-4">
              + 새 개발노트
            </button>
          </Link>
          <Link href="/admin/drafts">
            <button className="fx-key w-full p-4">
              📥 초안함
            </button>
          </Link>
          <Link href="/admin/edu">
            <button className="fx-key w-full p-4">
              🧰 특수교육 도구함 요청 게시판
            </button>
          </Link>
          <Link href="/admin/factory">
            <button className="fx-key w-full p-4">
              🏭 앱 공장 통제실
            </button>
          </Link>
          <Link href="/admin/stories/create">
            <button className="fx-key w-full p-4">
              + 새 스토리
            </button>
          </Link>
          <Link href="/admin/logs/create">
            <button className="fx-key w-full p-4">
              + 개발 로그
            </button>
          </Link>
          <Link href="/admin/boards">
            <button className="fx-key w-full p-4">
              💬 앱별 공지/문의 게시판
            </button>
          </Link>
          <Link href="/admin/categories">
            <button className="fx-key w-full p-4">
              🏷️ 카테고리 관리
            </button>
          </Link>
        </div>
      </div>

    </div>
  );
}