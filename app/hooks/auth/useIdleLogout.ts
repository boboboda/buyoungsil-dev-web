"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";

// 활동으로 인정할 브라우저 이벤트 (mousemove는 너무 자주 발생해서 제외)
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

// 자동 로그아웃 사용 여부. false 면 로그인은 세션 만료(30일, lib/auth/auth.ts의 maxAge)까지 유지된다.
// 다시 켜고 싶으면 true 로 바꾸고 아래 시간을 조절한다.
const IDLE_LOGOUT_ENABLED = false;

// 여기 숫자만 바꾸면 시간 조절됨
const IDLE_TIMEOUT_MINUTES = 30; // 이 시간만큼 활동 없으면 로그아웃
const WARNING_BEFORE_MINUTES = 5; // 로그아웃 몇 분 전부터 카운트다운 보여줄지

const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
const WARNING_BEFORE_MS = WARNING_BEFORE_MINUTES * 60 * 1000;
const CHECK_INTERVAL_MS = 1000; // 1초마다 체크 (카운트다운 표시용)

/**
 * 로그인 상태에서 일정 시간 동안 실제 사용자 활동(마우스/키보드/스크롤)이
 * 없으면 자동으로 로그아웃시키는 훅.
 *
 * 반환값 remainingSeconds:
 *   - null: 평소 상태 (아직 5분 넘게 남음, 화면에 아무것도 안 보여줘도 됨)
 *   - 숫자: 로그아웃까지 남은 초 (5분 이내로 들어오면 채워짐 → 카운트다운 표시용)
 */
export function useIdleLogout() {
  const { status } = useSession();
  const lastActivityRef = useRef<number>(Date.now());
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!IDLE_LOGOUT_ENABLED || status !== "authenticated") {
      setRemainingSeconds(null);
      return;
    }

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, resetTimer, { passive: true }),
    );

    const intervalId = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      const remainingMs = IDLE_TIMEOUT_MS - idleFor;

      if (remainingMs <= 0) {
        signOut({ callbackUrl: "/signin" });
        return;
      }

      setRemainingSeconds(
        remainingMs <= WARNING_BEFORE_MS ? Math.ceil(remainingMs / 1000) : null,
      );
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, resetTimer),
      );
      window.clearInterval(intervalId);
    };
  }, [status]);

  return { remainingSeconds };
}