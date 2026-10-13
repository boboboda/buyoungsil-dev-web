// app/admin/layout.tsx
// 관리자 화면(/admin 과 하위 모든 화면)을 .factory-ui 래퍼로 감싼다: 디지털 계기판 다크 테마(admin-ui.css 의 색 토큰).
// 사이트 라이트/다크 설정과 무관하게 관리자에서는 항상 어둡다(dark 클래스). 공개 사이트에는 영향 없음.
import "./admin-ui.css";

import Link from "next/link";

import { fontMono } from "@/config/fonts";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`factory-ui dark ${fontMono.variable} rounded-xl`}>
      <div className="fx-admin-bar">
        <span className="fx-led fx-run">
          <span aria-hidden className="fx-led-dot" />
          <span className="fx-admin-bar-title">ADMIN CONSOLE</span>
        </span>
        <nav aria-label="관리자 바로가기" className="fx-admin-bar-nav">
          <Link href="/admin">대시보드</Link>
          <Link href="/admin/factory">통제실</Link>
        </nav>
      </div>
      <div className="fx-admin-main">{children}</div>
    </div>
  );
}
