"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { format } from "date-fns";

const STORAGE_KEY = "visitor_recorded_date";

// 방문 집계를 브라우저에서 하루 1회만 요청한다.
// JS 를 실행하지 않는 대부분의 봇/스캐너는 이 요청 자체를 보내지 못한다.
export default function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // 관리자/로그인 페이지는 집계 제외
    if (
      pathname.startsWith("/admin") ||
      pathname === "/signin" ||
      pathname === "/signup"
    ) {
      return;
    }

    // 자동화 브라우저(headless, webdriver)는 집계 제외
    if (navigator.webdriver) return;

    const today = format(new Date(), "yyyy-MM-dd");

    try {
      if (localStorage.getItem(STORAGE_KEY) === today) return;
      // 요청 전에 먼저 표시해서 Strict Mode 이중 실행/동시 호출을 막는다
      localStorage.setItem(STORAGE_KEY, today);
    } catch {
      // 저장소 접근 불가 시에도 서버 쿠키가 중복을 막아준다
    }

    fetch("/api/visitor-record", {
      method: "POST",
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
      })
      .catch(() => {
        // 실패 시 다음 방문에 다시 시도할 수 있게 표시 제거
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* noop */
        }
      });
  }, [pathname]);

  return null;
}