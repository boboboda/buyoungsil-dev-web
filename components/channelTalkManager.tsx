// components/providers/channel-provider.tsx
"use client";

import { PropsWithChildren, useEffect } from "react";
import { usePathname } from "next/navigation";
import * as ChannelService from "@channel.io/channel-web-sdk-loader";

import { isAppPath } from "@/lib/utils/appPath";

const ChannelProvider = ({ children }: PropsWithChildren) => {
  const pathname = usePathname();
  const isApp = isAppPath(pathname);

  useEffect(() => {
    // 앱 화면에서는 채팅 위젯을 띄우지 않는다.
    if (isApp) return;

    ChannelService.loadScript();
    ChannelService.boot({
      pluginKey: "c904884f-0dc2-48df-b9c2-9ef002727b21",
    });
  }, [isApp]);

  return <>{children}</>;
};

export default ChannelProvider;