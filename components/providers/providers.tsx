"use client";

import type { ThemeProviderProps } from "next-themes";

import * as React from "react";
import { HeroUIProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";

import ChannelProvider from "../channelTalkManager";
import { useIdleLogout } from "@/app/hooks/auth/useIdleLogout";

import { ToastProvider } from "./ToastProvider";
import { QueryProvider } from "./query-provider";
import SocialLoginProvider from "./SocialLoginProvider";
import { SessionInitializer } from "./SessionInitializer";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

// SessionProvider 내부에서만 useSession()을 쓸 수 있어 별도 컴포넌트로 분리
function IdleLogoutWatcher() {
  useIdleLogout();
  return null;
}

export function Providers({ children, themeProps }: ProvidersProps) {
  const [isMount, setMount] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    setMount(true);
  }, []);

  if (!isMount) {
    return null;
  }

  return (
    <SessionProvider
      refetchInterval={5 * 60} // 5분마다 갱신 (초 단위) — 활동 중인 세션을 자주 롤링 갱신
      refetchOnWindowFocus={false} // 윈도우 포커스 시 갱신 비활성화
      refetchWhenOffline={false}
    >
      <SessionInitializer />
      {/* 실제 마우스/키보드 활동이 일정 시간 없으면 자동 로그아웃 */}
      <IdleLogoutWatcher />
      <SocialLoginProvider />
      <ChannelProvider>
        <QueryProvider>
          <HeroUIProvider navigate={router.push}>
            <NextThemesProvider {...themeProps}>
              <ToastProvider />
              {children}
            </NextThemesProvider>
          </HeroUIProvider>
        </QueryProvider>
      </ChannelProvider>
    </SessionProvider>
  );
}
