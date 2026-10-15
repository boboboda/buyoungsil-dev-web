// app/admin/settings/page.tsx
// 블로그 관리자 설정 화면. 지금은 연결 키(서버끼리 쓰는 키) 만들기·폐기만 있다. API 는 /api/admin/factory/connection-keys.
import { Metadata } from "next";

import ConnectionKeys from "@/components/admin/settings/ConnectionKeys";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "설정 | 관리자",
};

export default function AdminSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">설정</h1>
      <ConnectionKeys />
    </main>
  );
}
