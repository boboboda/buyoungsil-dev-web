// app/admin/factory/page.tsx
// 앱 공장 통제실: 기획서가 대기열에 쌓이면 여기서 승인하고, 진행 상황·스크린샷·토큰을 본다.
import { Metadata } from "next";
import Link from "next/link";

import FactoryControl from "@/components/admin/factory/FactoryControl";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 공장 통제실 | 관리자",
};

export default function AdminFactoryPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-2 text-3xl font-bold">🏭 앱 공장 통제실</h1>
          <p className="text-gray-600 dark:text-gray-400">
            기획서를 승인하면 내 PC의 감독 프로그램이 가져가서 앱을 만들어요
          </p>
        </div>
        <Link
          className="rounded-lg bg-default-100 px-3 py-2 text-sm hover:bg-default-200"
          href="/admin/factory/settings"
        >
          ⚙️ 설정 (PC 연결 토큰 · 키 이름)
        </Link>
      </div>

      <FactoryControl />
    </div>
  );
}
