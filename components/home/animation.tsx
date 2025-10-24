"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@heroui/react";

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
    <Skeleton className="rounded-lg" isLoaded={isMounted}>
      <div className="w-full h-full">
        <Lottie loop play animationData={lottieJson} />
      </div>
    </Skeleton>
  );
}