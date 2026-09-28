// hooks/useIdleLogout.ts
"use client";

import { useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { toast } from "react-toastify";

/**
 * 로그인 후 "활동"으로 간주할 브라우저 이벤트.
 * mousemove까지 넣으면 살짝 과할 수 있어 클릭/키입력/스크롤/터치 위주로 구성.
 */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

// 분 단위. .env에 NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES=30 식으로 값만 바꾸면 조절됨.
const IDLE_TIMEOUT_MINUTES = Number(
  process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES ?? 30,
);
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
const WARNING_BEFORE_MS = 60 * 1000; // 로그아웃 1분 전 경고 토스트
const CHECK_INTERVAL_MS = 5 * 1000;

/**
 * 로그인 상태에서 일정 시간 동안 마우스/키보드/스크롤 등 실제 사용자 활동이
 * 전혀 없으면 자동으로 로그아웃시키는 훅.
 *
 * next-auth의 SessionProvider refetchInterval은 "탭이 열려있는지"만 보고
 * 일정 주기로 세션을 갱신하기 때문에, 사용자가 실제로 아무것도 안 해도
 * 로그인이 계속 유지된다. 이 훅은 진짜 사용자 입력 이벤트를 기준으로
 * 비활동 시간을 계산해서 signOut()을 직접 호출한다.
 */
export function useIdleLogout() {
  const { status } = useSession();
  const lastActivityRef = useRef<number>(Date.now());
  const warnedRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current = false;
    };

    // 최초 마운트 시점도 활동으로 간주
    resetTimer();

    ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, resetTimer, { passive: true }),
    );

    const intervalId = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;

      if (idleFor >= IDLE_TIMEOUT_MS) {
        console.log(
          `⏱️ [useIdleLogout] ${IDLE_TIMEOUT_MINUTES}분간 활동 없음 → 자동 로그아웃`,
        );
        signOut({ callbackUrl: "/signin" });
        return;
      }

      if (!warnedRef.current && idleFor >= IDLE_TIMEOUT_MS - WARNING_BEFORE_MS) {
        warnedRef.current = true;
        toast.warn("장시간 활동이 없어 곧 자동 로그아웃됩니다.");
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) =>
        window.removeEventListener(eventName, resetTimer),
      );
      window.clearInterval(intervalId);
    };
  }, [status]);
}
