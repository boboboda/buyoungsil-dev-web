import { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/get-sesstion";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "관리자 대시보드 | 코딩천재 부영실",
  robots: {
    index: false,
    follow: false,
  },
};

async function getAdminStats() {
  const [
    totalProjects,
    totalNotes,
    totalStories,
    totalWorkRequests,
    pendingWorkRequests,
  ] = await Promise.all([
    prisma.project.count(),
    prisma.developNote.count({ where: { isPublished: true } }),
    prisma.story.count({ where: { isPublished: true } }),
    prisma.workRequest.count(),
    prisma.workRequest.count({ where: { status: 'pending' } }),
  ]);

  return {
    totalProjects,
    totalNotes,
    totalStories,
    totalWorkRequests,
    pendingWorkRequests,
  };
}

// 🔥 StatCard 컴포넌트 정의
interface StatCardProps {
  icon: string;
  label: string;
  value: number;
  gradient: string;
  href: string;
  highlight?: boolean;
}

function StatCard({ icon, label, value, gradient, href, highlight = false }: StatCardProps) {
  return (
    <Link href={href}>
      <div className={`group relative p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 ${highlight ? 'ring-2 ring-yellow-500 animate-pulse' : ''}`}>
        <div className={`absolute inset-0 rounded-xl bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-10 transition-opacity`} />
        
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">{icon}</span>
            {highlight && <span className="text-xs bg-yellow-500 text-white px-2 py-1 rounded-full">NEW</span>}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</p>
          <p className={`text-3xl font-bold bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
            {value}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default async function AdminDashboard() {
  // 🔥 middleware가 이미 admin 체크를 했으므로 session만 가져옴
  const session = await auth();
  
  // middleware에서 이미 체크했으므로 여기서는 session만 확인
  if (!session?.user) {
    redirect("/signin");
  }

  const stats = await getAdminStats();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          👋 환영합니다, {session.user.name}님
        </h1>
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
        {/* 🔥 외주 신청 통계 추가 */}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <Link href="/admin/stories/create">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium hover:shadow-lg transition-shadow">
              + 새 스토리
            </button>
          </Link>
          <Link href="/admin/works">
            <button className="w-full p-4 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium hover:shadow-lg transition-shadow">
              📋 외주 신청 관리
            </button>
          </Link>
        </div>
      </div>

      {/* 최근 활동 - 대기 중인 외주 신청 */}
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
            <button className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold rounded-lg hover:shadow-lg transition-shadow">
              지금 확인하기 →
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}