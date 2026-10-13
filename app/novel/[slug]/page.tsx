// app/novel/[slug]/page.tsx
// 작품 소개와 공개된 화 목록. 설정 승인 전·중단 작품이나 없는 주소는 404. lib/novel/
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SLUG_RE } from "@/lib/novel/rules";
import { publicWork } from "@/lib/novel/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  return SLUG_RE.test(slug) ? publicWork(slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const work = await load(slug).catch(() => null);

  if (!work) return { title: "작품을 찾을 수 없어요" };

  return {
    title: `${work.title} | 소설`,
    description: work.logline?.slice(0, 160) || `${work.title} 연재 목록`,
  };
}

export default async function NovelWorkPage({ params }: Props) {
  const { slug } = await params;
  const work = await load(slug);

  if (!work) notFound();

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Link className="text-sm text-default-500 hover:underline" href="/novel">
        ← 소설 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{work.title}</h1>
      {work.genre && (
        <div className="mt-1 text-sm text-default-500">{work.genre}</div>
      )}
      {work.logline && (
        <p className="mt-4 whitespace-pre-wrap break-words leading-7 text-default-700">
          {work.logline}
        </p>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">
        공개된 화 ({work.episodes.length})
      </h2>
      {work.episodes.length === 0 && (
        <p className="text-default-500">아직 공개된 화가 없어요.</p>
      )}
      <ul className="divide-y divide-default-100">
        {work.episodes.map((e) => (
          <li key={e.number}>
            <Link
              className="flex items-baseline gap-3 py-3 hover:bg-default-50"
              href={`/novel/${work.slug}/${e.number}`}
            >
              <span className="shrink-0 font-mono text-sm text-default-500">
                {e.number}화
              </span>
              <span className="min-w-0 truncate">
                {e.title ?? `${e.number}화`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
