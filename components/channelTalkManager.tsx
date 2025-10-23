// components/providers/channel-provider.tsx
"use client";

import { PropsWithChildren, useEffect } from "react";
import * as ChannelService from "@channel.io/channel-web-sdk-loader";

const ChannelProvider = ({ children }: PropsWithChildren) => {
  useEffect(() => {
    ChannelService.loadScript();
    ChannelService.boot({
      pluginKey: "c904884f-0dc2-48df-b9c2-9ef002727b21",
    });
  }, []);

  return <>{children}</>;
};

export default ChannelProvider;
