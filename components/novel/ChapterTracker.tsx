// components/novel/ChapterTracker.tsx
// 소설 화 페이지 지표: 진입(chapter_view), 본문 끝까지 스크롤(chapter_complete), 다음 화 클릭(next_click).
// 기존 웹 분석 SDK(templates/analytics/web/analytics.ts)와 같은 수집 주소·형식(/api/analytics/collect, 헤더 x-analytics-key)으로 보낸다.
// 수집기는 정해진 이벤트 이름만 받아서 feature_use 에 { feature, work, ep } 로 담는다. 키가 없으면 아무것도 보내지 않는다.
"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";

const ENDPOINT = "/api/analytics/collect";
const INSTALL_KEY = "app_analytics_install"; // SDK 와 같은 설치 ID 를 쓴다

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function installId(): string {
  try {
    const saved = localStorage.getItem(INSTALL_KEY);

    if (saved) return saved;
    const id = uuid();

    localStorage.setItem(INSTALL_KEY, id);

    return id;
  } catch {
    return uuid(); // 사생활 보호 모드 등
  }
}

function send(
  key: string,
  feature: "chapter_view" | "chapter_complete" | "next_click",
  work: string,
  ep: number,
) {
  if (!key) return;
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      keepalive: true, // 다음 화로 넘어가는 중에도 보내지게
      headers: { "content-type": "application/json", "x-analytics-key": key },
      body: JSON.stringify({
        installId: installId(),
        appVersion: "novel-web",
        platform: "web",
        osVersion: "",
        events: [
          {
            id: uuid(),
            name: "feature_use",
            ts: Date.now(),
            params: { feature, work, ep },
          },
        ],
      }),
    }).catch(() => {});
  } catch {
    /* 지표 실패는 읽기에 영향 없음 */
  }
}

/** 본문 아래에 둔다. 들어오면 chapter_view, 이 표시가 화면에 들어오면 chapter_complete(한 번씩) */
export default function ChapterTracker({
  analyticsKey,
  work,
  ep,
}: {
  analyticsKey: string;
  work: string;
  ep: number;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    send(analyticsKey, "chapter_view", work, ep);
    const el = end.current;

    if (!el || typeof IntersectionObserver === "undefined") return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (!done && entries.some((e) => e.isIntersecting)) {
        done = true;
        send(analyticsKey, "chapter_complete", work, ep);
        io.disconnect();
      }
    });

    io.observe(el);

    return () => io.disconnect();
  }, [analyticsKey, work, ep]);

  return <div ref={end} aria-hidden className="h-px" />;
}

/** 다음 화 링크: 누르면 next_click 을 보내고 이동 */
export function NextChapterLink({
  analyticsKey,
  work,
  ep,
  href,
  children,
}: {
  analyticsKey: string;
  work: string;
  ep: number;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="rounded-lg px-3 py-2 font-medium hover:bg-default-100"
      href={href}
      onClick={() => send(analyticsKey, "next_click", work, ep)}
    >
      {children}
    </Link>
  );
}
