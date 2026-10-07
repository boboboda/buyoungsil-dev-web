import { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import DashboardStats from "@/components/admin/dashboard/DashboardStats";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "관리자 대시보드",
};

async function getStats() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    totalProjects,
    totalNotes,
    totalStories,
    totalUsers,
    publishedNotes,
    publishedStories,
    recentProjects,
    totalWorkRequests,
    pendingWorkRequests,
    pendingDrafts,
  ] = await Promise.all([
    prisma.project.count(),
    prisma.developNote.count(),
    prisma.story.count(),
    prisma.user.count(),
    prisma.developNote.count({ where: { isPublished: true } }),
    prisma.story.count({ where: { isPublished: true } }),
    prisma.project.count({
      where: {
        createdAt: { gte: sevenDaysAgo }
      }
    }),
    prisma.workRequest.count(),
    prisma.workRequest.count({ where: { status: 'pending' } }),
    prisma.draft.count({ where: { status: 'pending' } }).catch(() => 0), // 초안함 테이블을 만들기 전에도 대시보드가 깨지지 않게
  ]);

  return {
    totalProjects,
    totalNotes,
    totalStories,
    totalUsers,
    publishedNotes,
    publishedStories,
    recentProjects,
    totalWorkRequests,
    pendingWorkRequests,
    pendingDrafts,
  };
}

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
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
          <p className="text-2xl font-bold">{value}</p>
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

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
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
        <StatCard
          icon="🔔"
          label="대기 중 외주"
          value={stats.pendingWorkRequests}
          gradient="from-yellow-500 to-orange-500"
          href="/admin/works"
          highlight={stats.pendingWorkRequests > 0}
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
              📥 초안함{stats.pendingDrafts > 0 ? ` (${stats.pendingDrafts})` : ""}
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
              💬 게시판 관리
            </button>
          </Link>
          <Link href="/admin/categories">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-teal-500 to-green-500 text-white font-medium hover:shadow-lg transition-shadow">
              🏷️ 카테고리 관리
            </button>
          </Link>
        </div>
      </div>

      {/* 대기 중인 외주 신청 알림 */}
      {stats.pendingWorkRequests > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-500 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">⚠️</span>
            <h2 className="text-xl font-bold">대기 중인 외주 신청이 있습니다!</h2>
          </div>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            {stats.pendingWorkRequests}건의 새로운 프로젝트 의뢰를 확인해주세요.
          </p>
          <Link href="/admin/works">
            <button className="px-6 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium">
              외주 신청 확인하기 →
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}