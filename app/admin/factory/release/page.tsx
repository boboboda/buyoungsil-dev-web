// app/admin/factory/release/page.tsx
// 옛 "출시 패키지" 주소(텔레그램 알림·문서 링크). 그대로 열리고 통제실 [출시] 탭을 보여 준다.
import { Metadata } from "next";

import FactoryConsole from "@/components/admin/factory/FactoryConsole";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "출시 패키지 | 앱 공장",
};

export default function AdminFactoryReleasePage() {
  return <FactoryConsole tab="release" />;
}
