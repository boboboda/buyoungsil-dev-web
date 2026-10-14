// components/providers/channel-provider.tsx
"use client";

import { PropsWithChildren, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as ChannelService from "@channel.io/channel-web-sdk-loader";

import { isStudioPath } from "@/lib/studio/gate";
import { isAdminPath, isAppPath } from "@/lib/utils/appPath";

const ChannelProvider = ({ children }: PropsWithChildren) => {
  const pathname = usePathname();
  const isApp = isAppPath(pathname);
  const isAdmin = isAdminPath(pathname) || isStudioPath(pathname); // 공용 스튜디오도 관리자 화면처럼 채팅 버튼을 숨긴다
  const booted = useRef(false);

  useEffect(() => {
    // 앱 화면에서는 채팅 위젯을 띄우지 않는다.
    if (isApp) return;

    // 관리자 콘솔(/admin/*)에서는 채팅 버튼을 숨긴다(공개 화면으로 돌아가면 다시 보임).
    if (isAdmin) {
      if (booted.current) ChannelService.hideChannelButton();

      return;
    }

    if (!booted.current) {
      ChannelService.loadScript();
      ChannelService.boot({
        pluginKey: "c904884f-0dc2-48df-b9c2-9ef002727b21",
      });
      booted.current = true;
    } else {
      ChannelService.showChannelButton();
    }
  }, [isApp, isAdmin]);

  return <>{children}</>;
};

export default ChannelProvider;
