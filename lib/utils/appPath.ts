// /app 으로 시작하는 경로는 앱(WebView) 전용 화면이다.
export const isAppPath = (pathname?: string | null): boolean =>
  pathname === "/app" || !!pathname?.startsWith("/app/");

// /admin 으로 시작하는 경로는 관리자 콘솔이다(공개 사이트 네비바·푸터·채팅 버튼 대신 관리자 전용 상단바·상태바).
export const isAdminPath = (pathname?: string | null): boolean =>
  pathname === "/admin" || !!pathname?.startsWith("/admin/");
