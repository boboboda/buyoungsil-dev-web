"use client";

import Link from "next/link";
import { GradientButton } from "@/components/common/GradientButton";

export default function AdminProjectsHeader() {
  return (
    <div className="flex justify-between items-center mb-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">💼 프로젝트 관리</h1>
        <p className="text-gray-600 dark:text-gray-400">
          프로젝트를 생성하고 관리합니다
        </p>
      </div>
      <Link href="/admin/projects/create">
        <GradientButton size="lg" gradient="from-green-500 to-emerald-500">
          + 새 프로젝트 생성
        </GradientButton>
      </Link>
    </div>
  );
}