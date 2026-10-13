// app/admin/factory/settings/page.tsx
// 옛 "앱 공장 설정" 주소. 그대로 열리고 통제실 [설정] 탭을 보여 준다.
// 출시 카드의 키 파일 후보 링크(?registerPath=…#key-vault)도 이 주소로 와서 키 보관함 등록 칸을 채운다.
import { Metadata } from "next";

import FactoryConsole from "@/components/admin/factory/FactoryConsole";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "앱 공장 설정 | 관리자",
};

export default function AdminFactorySettingsPage() {
  return <FactoryConsole tab="settings" />;
}
