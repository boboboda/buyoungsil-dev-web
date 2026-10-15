// app/novel/page.tsx
// 소설 공개 목록: 연재 중·완결 작품(설정 승인 전·중단 작품은 안 보임). 공개된 화 = 승인되고 예약 시각이 지난 화. lib/novel/
import { Metadata } from "next";
import Link from "next/link";

import { WORK_STATUS_LABELS, type WorkStatus } from "@/lib/novel/rules";
import { publicWorks } from "@/lib/novel/public";

// 예약 시각이 지나면 바로 보이도록 매 요청 새로 읽는다
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "소설 | 부영실 개발",
  description: "연재 중인 웹소설 목록",
};

export default async function NovelListPage() {
  const works = await publicWorks().catch((e) => {
    console.error("[novel] 공개 목록 조회 실패:", e);

    return [];
  });

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold sm:text-3xl">소설</h1>
      {works.length === 0 && (
        <p className="text-default-500">아직 연재 중인 작품이 없어요.</p>
      )}
      <ul className="space-y-4">
        {works.map((w) => (
          <li key={w.slug}>
            <Link
              className="block rounded-xl border border-default-200 p-4 transition-colors hover:bg-default-50"
              href={`/novel/${w.slug}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{w.title}</span>
                <span className="text-xs text-default-500">
                  {WORK_STATUS_LABELS[w.status as WorkStatus] ?? w.status}
                </span>
              </div>
              {w.genre && (
                <div className="mt-1 text-xs text-default-500">{w.genre}</div>
              )}
              {w.logline && (
                <p className="mt-2 line-clamp-2 text-sm text-default-600">
                  {w.logline}
                </p>
              )}
              <div className="mt-2 text-xs text-default-500">
                공개 {w.published}화
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
