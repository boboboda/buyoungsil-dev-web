"use client";

import Typed from "typed.js";
import { useEffect, useRef } from "react";

import { title } from "@/components/primitives";

export default function CustomTyped() {
  const el = useRef(null);

  useEffect(() => {
    const typed = new Typed(el.current, {
      strings: [
        "나만의 홈페이지 또는 어플?",
        "비전있는 아이템?",
        "충족되지 않는 앱 서비스?",
        "그 꿈 부영실이",
        "이루어드리겠습니다.",
      ], // Strings to display
      startDelay: 300,
      typeSpeed: 100,
      backSpeed: 100,
      backDelay: 300,
      loop: true,
    });

    // Destroying
    return () => {
      typed.destroy();
    };
  }, []);

  return (
    <h1 className={title({ size: "sm", color: "pink" })}>
      <span ref={el} />
    </h1>
  );
}
