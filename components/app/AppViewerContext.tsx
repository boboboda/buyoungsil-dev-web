"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import { isAppPath } from "@/lib/utils/appPath";

type AppViewerState = {
  isApp: boolean;
  viewer: { name: string } | null;
};

const AppViewerContext = createContext<AppViewerState>({
  isApp: false,
  viewer: null,
});

// /app 레이아웃에서 서버가 확인한 앱 사용자를 내려준다.
export function AppViewerProvider({
  viewer,
  children,
}: {
  viewer: { name: string } | null;
  children: ReactNode;
}) {
  return (
    <AppViewerContext.Provider value={{ isApp: true, viewer }}>
      {children}
    </AppViewerContext.Provider>
  );
}

// 웹(next-auth)과 앱(app_session) 어느 쪽이든 같은 모양으로 읽는다.
export function useViewer() {
  const app = useContext(AppViewerContext);
  const { data: session, status } = useSession();

  if (app.isApp) {
    return {
      isApp: true,
      isLoading: false,
      isLoggedIn: !!app.viewer,
      isAdmin: false,
      name: app.viewer?.name ?? "",
    };
  }

  return {
    isApp: false,
    isLoading: status === "loading",
    isLoggedIn: status === "authenticated" && !!session?.user?.email,
    isAdmin: session?.user?.role === "admin",
    name: session?.user?.name ?? "",
  };
}

// 게시판 목록 경로. 앱 화면이면 /app/board/..., 웹이면 /project/...
export function useBoardBase(appName: string, postType: string): string {
  const pathname = usePathname();

  return isAppPath(pathname)
    ? `/app/board/${appName}/${postType}`
    : `/project/${appName}/board/${postType}`;
}