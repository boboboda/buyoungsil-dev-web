"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@heroui/react";

// Dynamic import with no SSR
const Lottie = dynamic(() => import("react-lottie-player"), {
  ssr: false,
});

import lottieJson from "../../public/buyoungsil_Animation.json";

export default function Animation() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setIsMounted(true);
    }, 1000);
  }, []);

  return (
    // <img src="/antAnimation.gif" alt="Example GIF"/>
    <Skeleton className="rounded-lg m-5" isLoaded={isMounted}>
      <div className="max-w-[200px] lg:max-w-[600px] h-full">
        <Lottie loop play animationData={lottieJson} />
      </div>
    </Skeleton>
  );
}
