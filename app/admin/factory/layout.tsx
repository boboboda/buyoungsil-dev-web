// app/admin/factory/layout.tsx
// 앱 공장 통제실(/admin/factory 와 하위 모든 화면)을 .factory-ui 래퍼로 감싼다.
// 사이트 라이트/다크 설정과 무관하게 항상 어둡게(dark 클래스 + factory.css 의 색 토큰). 다른 화면에는 영향 없음.
import "./factory.css";

import { fontMono } from "@/config/fonts";

export default function FactoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`factory-ui dark ${fontMono.variable} rounded-xl`}>
      {children}
    </div>
  );
}
