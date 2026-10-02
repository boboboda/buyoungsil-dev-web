"use client";

import { usePathname } from "next/navigation";

import { isAppPath } from "@/lib/utils/appPath";

// 앱(WebView) 화면에서는 사이트 공통 UI를 렌더링하지 않는다.
export default function HideInApp({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isAppPath(pathname)) return null;

  return <>{children}</>;
}