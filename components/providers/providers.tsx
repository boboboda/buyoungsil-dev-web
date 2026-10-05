"use client";

import type { ThemeProviderProps } from "next-themes";

import * as React from "react";
import { HeroUIProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";

import ChannelProvider from "../channelTalkManager";

import { ToastProvider } from "./ToastProvider";
import { QueryProvider } from "./query-provider";
import SocialLoginProvider from "./SocialLoginProvider";
import { SessionInitializer } from "./SessionInitializer";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({ children, themeProps }: ProvidersProps) {
  const router = useRouter();

  // 서버 HTML에도 본문이 들어가도록 mount 게이트를 두지 않는다.
  // (예전에는 마운트 전까지 null 을 반환해 크롤러/애드센스가 빈 페이지를 받았음)
  return (
    <SessionProvider
      refetchInterval={30 * 60} // 30분마다 갱신 (초 단위)
      refetchOnWindowFocus={false} // 윈도우 포커스 시 갱신 비활성화
      refetchWhenOffline={false}
    >
      <SessionInitializer />
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