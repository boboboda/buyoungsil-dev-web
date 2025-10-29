"use client";

import { GradientCard } from "@/components/common/GradientCard";

interface Stats {
  totalProjects: number;
  totalNotes: number;
  totalStories: number;
  totalUsers: number;
  publishedNotes: number;
  publishedStories: number;
  recentProjects: number;
}

interface StatCardData {
  icon: string;
  label: string;
  value: number;
  subLabel?: string;
  gradient: string;
}

export default function DashboardStats({ stats }: { stats: Stats }) {
  const statCards: StatCardData[] = [
    {
      icon: "💼",
      label: "프로젝트",
      value: stats.totalProjects,
      subLabel: `최근 7일: ${stats.recentProjects}개`,
      gradient: "from-green-500 to-emerald-500"
    },
    {
      icon: "📚",
      label: "개발노트",
      value: stats.totalNotes,
      subLabel: `공개: ${stats.publishedNotes}개`,
      gradient: "from-blue-500 to-cyan-500"
    },
    {
      icon: "😅",
      label: "스토리",
      value: stats.totalStories,
      subLabel: `공개: ${stats.publishedStories}개`,
      gradient: "from-orange-500 to-red-500"
    },
    {
      icon: "👥",
      label: "사용자",
      value: stats.totalUsers,
      gradient: "from-purple-500 to-pink-500"
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => (
        <GradientCard
          key={index}
          gradient={stat.gradient}
          className="hover:scale-105 transition-transform"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                {stat.label}
              </p>
              <p className="text-4xl font-bold mb-2">
                {stat.value.toLocaleString()}
              </p>
              {stat.subLabel && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {stat.subLabel}
                </p>
              )}
            </div>
            <div className="text-5xl opacity-20">
              {stat.icon}
            </div>
          </div>
        </GradientCard>
      ))}
    </div>
  );
}