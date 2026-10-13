// app/admin/layout.tsx
// 관리자 화면(/admin 과 하위 모든 화면)을 .factory-ui 래퍼로 감싼다: 터미널 HUD 다크 테마(admin-ui.css 의 색 토큰).
// 사이트 라이트/다크 설정과 무관하게 관리자에서는 항상 어둡다(dark 클래스).
// 공개 사이트 네비바·푸터·채팅 버튼은 /admin 에서 숨기고(PublicChromeOnly·channelTalkManager), 대신 관리자 전용 상단바·하단 상태줄을 붙인다.
import "./admin-ui.css";

import { fontMono } from "@/config/fonts";
import AdminStatusBar from "@/components/admin/ui/AdminStatusBar";
import AdminTopBar from "@/components/admin/ui/AdminTopBar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`factory-ui dark ${fontMono.variable}`}>
      <AdminTopBar />
      <div className="fx-admin-main">{children}</div>
      <AdminStatusBar />
    </div>
  );
}
