// app/studio/layout.tsx
// 공용 스튜디오(/studio 와 하위 화면)를 통제실과 같은 어두운 .factory-ui 래퍼로 감싼다. 공개 사이트 네비바·푸터·채팅 버튼은 숨긴다(PublicChromeOnly·channelTalkManager).
// 접근은 middleware(lib/studio/gate.ts) + 각 화면(lib/studio/pageAccess.ts)이 지킨다: 관리자 로그인 또는 Studio 접근 키.
import type { Metadata, Viewport } from "next";

import "../admin/admin-ui.css";

import { fontMono } from "@/config/fonts";
import AdminDocumentTheme from "@/components/admin/ui/AdminDocumentTheme";
import StudioTopBar from "@/components/studio/StudioTopBar";

export const viewport: Viewport = { themeColor: "#0a0c10" };
export const metadata: Metadata = { title: "공용 스튜디오", robots: { index: false, follow: false } };

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`factory-ui dark ${fontMono.variable}`}>
      <AdminDocumentTheme />
      <StudioTopBar />
      <div className="fx-admin-main">{children}</div>
    </div>
  );
}
