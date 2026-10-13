// app/admin/factory/page.tsx
// 앱 공장 통제실: 상단 탭(?tab=status|jobs|release|settings|usage)으로 현황·일감·출시·설정·사용량을 나눠 본다.
import { Metadata } from "next";

import FactoryConsole from "@/components/admin/factory/FactoryConsole";
import { parseFactoryTab } from "@/components/admin/factory/consoleTabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 공장 통제실 | 관리자",
};

export default async function AdminFactoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;

  return <FactoryConsole tab={parseFactoryTab(tab)} />;
}
