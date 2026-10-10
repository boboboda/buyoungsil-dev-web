// app/admin/factory/settings/page.tsx
// 앱 공장 설정: 작업 PC 접속 토큰, 사용할 수 있는 키 이름. 승인 화면(/admin/factory)과 분리해 둔다.
import { Metadata } from "next";
import Link from "next/link";

import SecretNames from "@/components/admin/factory/SecretNames";
import WorkerTokens from "@/components/admin/factory/WorkerTokens";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 공장 설정 | 관리자",
};

export default function AdminFactorySettingsPage() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <Link
          className="text-sm text-default-500 hover:underline"
          href="/admin/factory"
        >
          ← 통제실로 돌아가기
        </Link>
        <h1 className="mb-2 mt-2 text-3xl font-bold">⚙️ 앱 공장 설정</h1>
        <p className="text-gray-600 dark:text-gray-400">
          작업 PC 연결 토큰과 사용할 수 있는 키 이름을 관리해요
        </p>
      </div>

      <div className="space-y-6">
        <WorkerTokens />
        <SecretNames />
      </div>
    </div>
  );
}
