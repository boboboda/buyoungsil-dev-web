// /app 으로 시작하는 경로는 앱(WebView) 전용 화면이다.
export const isAppPath = (pathname?: string | null): boolean =>
  pathname === "/app" || !!pathname?.startsWith("/app/");