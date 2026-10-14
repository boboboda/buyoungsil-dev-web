"use client";

import { usePathname } from "next/navigation";

import { isStudioPath } from "@/lib/studio/gate";
import { isAdminPath, isAppPath } from "@/lib/utils/appPath";

// 공개 사이트 공통 UI(네비바·푸터). 앱(WebView) 화면과 관리자 콘솔(/admin/*)·공용 스튜디오(/studio/*)에서는 그리지 않는다.
// 관리자 콘솔은 app/admin/layout.tsx 의 관리자 전용 상단바·상태바를 쓴다.
export default function PublicChromeOnly({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (isAppPath(pathname) || isAdminPath(pathname) || isStudioPath(pathname)) return null;

  return <>{children}</>;
}
