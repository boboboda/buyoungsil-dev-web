import { Metadata } from "next";
import WorkRequestForm from "@/components/work-request/WorkRequestForm";
import { PageHero } from "@/components/common/PageHero";

export const metadata: Metadata = {
  title: "프로젝트 의뢰 | 코딩천재 부영실",
  description: "모바일/웹 앱 개발 프로젝트를 의뢰하세요. AI 기반 빠른 개발로 합리적인 가격에 제공합니다.",
  keywords: ["프로젝트 의뢰", "앱 개발 외주", "웹 개발 외주", "Flutter 개발", "Next.js 개발"],
};

export default function WorkRequestPage() {
  return (
    <div className="w-full">
      {/* Hero 섹션 */}
      <PageHero
        icon="📋"
        title="프로젝트 의뢰"
        description="AI 기반 빠른 개발로 합리적인 가격에 제공합니다"
        gradient="from-indigo-500 to-purple-600"
      />

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* 안내 문구 */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-3 text-blue-900 dark:text-blue-100">
            💡 프로젝트 의뢰 안내
          </h2>
          <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
            <li>✅ AI를 활용한 빠른 개발 (기존 대비 50% 단축)</li>
            <li>✅ Flutter, React, Next.js 등 최신 기술 스택</li>
            <li>✅ 합리적인 가격과 투명한 견적</li>
            <li>✅ 영업일 기준 2-3일 내 회신</li>
          </ul>
        </div>

        {/* 외주 신청 폼 */}
        <WorkRequestForm />
      </div>
    </div>
  );
}