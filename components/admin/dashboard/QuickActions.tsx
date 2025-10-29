"use client";

import Link from "next/link";
import { GradientButton } from "@/components/common/GradientButton";

export default function QuickActions() {
  const actions = [
    {
      icon: "✍️",
      label: "노트 작성",
      href: "/admin/write",
      gradient: "from-blue-600 to-purple-600"
    },
    {
      icon: "💼",
      label: "프로젝트 생성",
      href: "/admin/projects/create",
      gradient: "from-green-500 to-emerald-500"
    },
    {
      icon: "📝",
      label: "스토리 작성",
      href: "/admin/stories/create",
      gradient: "from-orange-500 to-red-500"
    },
    {
      icon: "📋",
      label: "개발 로그",
      href: "/admin/logs/create",
      gradient: "from-cyan-500 to-blue-500"
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
      <h2 className="text-2xl font-bold mb-6">⚡ 빠른 작업</h2>
      <div className="grid grid-cols-2 gap-4">
        {actions.map((action, index) => (
          <Link key={index} href={action.href}>
            <GradientButton
              gradient={action.gradient}
              className="w-full h-20 text-lg"
            >
              <span className="text-2xl mr-2">{action.icon}</span>
              {action.label}
            </GradientButton>
          </Link>
        ))}
      </div>
    </div>
  );
}