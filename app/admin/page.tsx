import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
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

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "admin") {
    redirect("/");
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">⚡ 빠른 작업</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionCard
            icon="📝"
            label="개발노트 작성"
            href="/admin/write"
            gradient="from-blue-500 to-purple-500"
          />
          <QuickActionCard
            icon="💼"
            label="프로젝트 추가"
            href="/admin/projects/create"
            gradient="from-green-500 to-emerald-500"
          />
          <QuickActionCard
            icon="😅"
            label="스토리 작성"
            href="/admin/stories/create"
            gradient="from-orange-500 to-red-500"
          />
          <QuickActionCard
            icon="💰"
            label="수익 입력"
            href="/admin/revenues/create"
            gradient="from-yellow-500 to-orange-500"
          />
          <QuickActionCard
            icon="📋"
            label="개발 로그 작성"
            href="/admin/logs/create"
            gradient="from-cyan-500 to-blue-500"
          />
          {/* 🔥 외주 관리 빠른 액션 추가 */}
          <QuickActionCard
            icon="💻"
            label="외주 관리"
            href="/admin/works"
            gradient="from-purple-500 to-pink-500"
            badge={stats.pendingWorkRequests > 0 ? stats.pendingWorkRequests : undefined}
          />
          <QuickActionCard
            icon="🏷️"
            label="카테고리 관리"
            href="/admin/categories"
            gradient="from-pink-500 to-rose-500"
          />
        </div>
      </div>

      {/* 최근 외주 신청 */}
      {stats.pendingWorkRequests > 0 && (
        <div className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl p-6 border-2 border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-yellow-800 dark:text-yellow-200 mb-1">
                🔔 새로운 외주 신청이 있습니다!
              </h3>
              <p className="text-yellow-700 dark:text-yellow-300">
                {stats.pendingWorkRequests}건의 대기 중인 외주 신청을 확인해주세요.
              </p>
            </div>
            <Link
              href="/admin/works"
              className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-bold rounded-lg transition-colors"
            >
              확인하기
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  gradient,
  href,
  highlight = false,
}: {
  icon: string;
  label: string;
  value: number;
  gradient: string;
  href?: string;
  highlight?: boolean;
}) {
  const CardWrapper = href ? Link : "div";
  const cardProps = href ? { href } : {};

  return (
    <CardWrapper
      {...cardProps}
      className={`relative p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 group cursor-pointer ${
        highlight ? "ring-2 ring-yellow-400 animate-pulse" : ""
      }`}
    >
      <div
        className={`absolute inset-0 rounded-xl bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-10 transition-opacity`}
      />

      <div className="relative">
        <div className="text-3xl mb-3">{icon}</div>
        <div
          className={`text-3xl font-bold bg-gradient-to-r ${gradient} bg-clip-text text-transparent mb-1`}
        >
          {value.toLocaleString()}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
          {label}
        </div>
      </div>
    </CardWrapper>
  );
}

function QuickActionCard({
  icon,
  label,
  href,
  gradient,
  badge,
}: {
  icon: string;
  label: string;
  href: string;
  gradient: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group relative p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
    >
      <div
        className={`absolute inset-0 rounded-lg bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-10 transition-opacity`}
      />

      <div className="relative flex flex-col items-center text-center">
        <div className="relative">
          <div className="text-4xl mb-2">{icon}</div>
          {badge && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">{badge}</span>
            </div>
          )}
        </div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </div>
      </div>
    </Link>
  );
}