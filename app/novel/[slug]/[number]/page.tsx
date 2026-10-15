// app/novel/[slug]/[number]/page.tsx
// 화 본문. 승인되고 예약 시각이 지난 화만 보이고 나머지는 404. 본문은 일반 텍스트로만(빈 줄 기준 문단, HTML 삽입 없음).
// 지표: ChapterTracker 가 기존 분석 수집으로 chapter_view·chapter_complete·next_click 을 보낸다(수집 키는 환경변수 NOVEL_ANALYTICS_KEY).
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ChapterTracker, {
  NextChapterLink,
} from "@/components/novel/ChapterTracker";
import { SLUG_RE, paragraphs } from "@/lib/novel/rules";
import { publicEpisode } from "@/lib/novel/public";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; number: string }> };

async function load(slug: string, number: string) {
  if (!SLUG_RE.test(slug) || !/^\d{1,4}$/.test(number)) return null;
  const n = Number(number);

  return n >= 1 ? publicEpisode(slug, n) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, number } = await params;
  const data = await load(slug, number).catch(() => null);

  if (!data) return { title: "화를 찾을 수 없어요" };
  const { work, episode } = data;
  const title = `${work.title} ${episode.number}화${episode.title ? ` ${episode.title}` : ""}`;

  return {
    title: `${title} | 소설`,
    description: (episode.summary || episode.body)
      .replace(/\s+/g, " ")
      .slice(0, 160),
  };
}

export default async function NovelEpisodePage({ params }: Props) {
  const { slug, number } = await params;
  const data = await load(slug, number);

  if (!data) notFound();
  const { work, episode, prev, next } = data;
  const analyticsKey = process.env.NOVEL_ANALYTICS_KEY || "";

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Link
        className="text-sm text-default-500 hover:underline"
        href={`/novel/${work.slug}`}
      >
        ← {work.title}
      </Link>
      <h1 className="mt-3 text-xl font-bold sm:text-2xl">
        {episode.number}화{episode.title ? ` ${episode.title}` : ""}
      </h1>

      <article className="mt-8 space-y-6 break-words text-[1.05rem] leading-8">
        {paragraphs(episode.body).map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p}
          </p>
        ))}
      </article>

      <ChapterTracker
        analyticsKey={analyticsKey}
        ep={episode.number}
        work={work.slug}
      />

      <nav className="mt-12 flex items-center justify-between gap-3 border-t border-default-200 pt-6 text-sm">
        {prev ? (
          <Link
            className="rounded-lg px-3 py-2 hover:bg-default-100"
            href={`/novel/${work.slug}/${prev}`}
          >
            ← {prev}화
          </Link>
        ) : (
          <span />
        )}
        <Link
          className="text-default-500 hover:underline"
          href={`/novel/${work.slug}`}
        >
          목록
        </Link>
        {next ? (
          <NextChapterLink
            analyticsKey={analyticsKey}
            ep={episode.number}
            href={`/novel/${work.slug}/${next}`}
            work={work.slug}
          >
            {next}화 →
          </NextChapterLink>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
