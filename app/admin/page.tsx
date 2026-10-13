import { Metadata } from "next";
import Link from "next/link";
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

// 처리 대기 카드: 0 이면 '없음'으로 조용하게, 1 이상이면 눈에 띄게, 못 세면 '-'
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
        className={`h-full rounded-xl p-5 border-2 transition-all hover:shadow-lg ${
          waiting
            ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500"
            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
        }`}
      >
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          {icon} {label}
        </p>
        {value === null ? (
          <p className="text-lg text-gray-400" title="숫자를 읽지 못했어요">
            -
          </p>
        ) : waiting ? (
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
            {value}건
          </p>
        ) : (
          <p className="text-lg text-gray-400">없음</p>
        )}
      </div>
    </Link>
  );
}

interface StatCardProps {
  icon: string;
  label: string;
  value: number | null;
  gradient: string;
  href?: string;
  highlight?: boolean;
}

function StatCard({ icon, label, value, gradient, href, highlight }: StatCardProps) {
  const content = (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border-2 transition-all hover:shadow-xl ${
      highlight ? 'border-yellow-500 animate-pulse' : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <div className={`text-3xl mb-2 bg-gradient-to-r ${gradient} bg-clip-text text-transparent font-bold`}>
            {icon}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</p>
          <p className="text-2xl font-bold">{value ?? "-"}</p>
        </div>
      </div>
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
        <p className="text-gray-600 dark:text-gray-400">
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
          gradient="from-blue-500 to-purple-500"
          href="/admin/projects"
        />
        <StatCard
          icon="📚"
          label="개발노트"
          value={stats.totalNotes}
          gradient="from-green-500 to-emerald-500"
          href="/admin/notes"
        />
        <StatCard
          icon="😅"
          label="스토리"
          value={stats.totalStories}
          gradient="from-orange-500 to-red-500"
          href="/admin/stories"
        />
        <StatCard
          icon="💻"
          label="전체 외주 신청"
          value={stats.totalWorkRequests}
          gradient="from-purple-500 to-pink-500"
          href="/admin/works"
        />
      </div>

      {/* 빠른 작업 */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">⚡ 빠른 작업</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Link href="/admin/projects/create">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium hover:shadow-lg transition-shadow">
              + 새 프로젝트
            </button>
          </Link>
          <Link href="/admin/write">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium hover:shadow-lg transition-shadow">
              + 새 개발노트
            </button>
          </Link>
          <Link href="/admin/drafts">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-pink-500 to-rose-500 text-white font-medium hover:shadow-lg transition-shadow">
              📥 초안함
            </button>
          </Link>
          <Link href="/admin/edu">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-medium hover:shadow-lg transition-shadow">
              🧰 특수교육 도구함 요청 게시판
            </button>
          </Link>
          <Link href="/admin/claude">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-medium hover:shadow-lg transition-shadow">
              🤖 클로드 작업 현황
            </button>
          </Link>
          <Link href="/admin/factory">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:shadow-lg transition-shadow">
              🏭 앱 공장 통제실
            </button>
          </Link>
          <Link href="/admin/stories/create">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium hover:shadow-lg transition-shadow">
              + 새 스토리
            </button>
          </Link>
          <Link href="/admin/logs/create">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-medium hover:shadow-lg transition-shadow">
              + 개발 로그
            </button>
          </Link>
          <Link href="/admin/boards">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium hover:shadow-lg transition-shadow">
              💬 앱별 공지/문의 게시판
            </button>
          </Link>
          <Link href="/admin/categories">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-teal-500 to-green-500 text-white font-medium hover:shadow-lg transition-shadow">
              🏷️ 카테고리 관리
            </button>
          </Link>
        </div>
      </div>

    </div>
  );
}