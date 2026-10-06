// app/note/[slug]/[noteId]/page.tsx
// 글 하나의 고유 주소 (예: /note/flutter/12)
export const dynamic = "force-dynamic";

import { Metadata } from "next";
import { notFound } from "next/navigation";

import prisma from "@/lib/prisma";
import { siteConfig } from "@/config/site";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";
import { fetchPublishedCategories } from "@/serverActions/noteCategoryActions";
import { Note } from "@/store/editorSotre";
import NoteItemView from "@/components/developmentNote/userNote/noteItemView";
import { RelatedNoteSummary } from "@/components/developmentNote/userNote/RelatedNotes";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { PageHero } from "@/components/common/PageHero";
import { extractPlainText, noteHref } from "@/lib/note/noteUtils";

interface PageProps {
  params: Promise<{ slug: string; noteId: string }>;
}

// 카테고리가 공개 상태인지, 글이 이 카테고리의 공개 글인지 확인하고 필요한 데이터를 모은다.
async function loadNotePage(slug: string, noteIdParam: string) {
  const noteId = Number(noteIdParam);

  if (!Number.isInteger(noteId)) return null;

  const categories = await fetchPublishedCategories();
  const category = categories.find((cat) => cat.slug === slug);

  if (!category) return null;

  const noteRes = await allFetchEdtiorServer();
  const notes: Note[] = JSON.parse(noteRes);
  const categoryNotes = notes.filter((note) => note.mainCategory === slug);
  const current = categoryNotes.find((note) => note.noteId === noteId);

  if (!current) return null;

  // 관련 글: 지정한 순서를 유지하고, 비공개 글/비공개 카테고리 글은 제외한다.
  const relatedIds: number[] = (current as any).relatedNoteIds ?? [];
  let related: RelatedNoteSummary[] = [];

  if (relatedIds.length > 0) {
    const rows = await prisma.developNote.findMany({
      where: { noteId: { in: relatedIds }, isPublished: true },
      select: { noteId: true, title: true, mainCategory: true, level: true },
    });

    related = relatedIds
      .map((id) => rows.find((row) => row.noteId === id))
      .flatMap((row) => {
        const cat = categories.find((c) => c.slug === row?.mainCategory);

        if (!row || !cat) return [];

        return [
          {
            noteId: row.noteId,
            title: row.title || "(제목 없음)",
            mainCategory: cat.slug,
            categoryName: cat.name,
            level: row.level as RelatedNoteSummary["level"],
          },
        ];
      });
  }

  return { category, categoryNotes, current, related };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, noteId } = await params;
  const data = await loadNotePage(slug, noteId);

  if (!data) {
    return { title: "노트를 찾을 수 없습니다" };
  }

  const { category, current } = data;
  const title = current.title || "개발노트";
  const description =
    (current as any).metaDescription ||
    extractPlainText(current.content, 150) ||
    `${category.name} 개발노트: ${title}`;
  const path = noteHref(slug, current.noteId as number);

  return {
    title: (current as any).metaTitle || `${title} | ${category.name}`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title,
      description,
      url: path,
    },
  };
}

export default async function NotePage({ params }: PageProps) {
  const { slug, noteId } = await params;
  const data = await loadNotePage(slug, noteId);

  if (!data) {
    notFound();
  }

  const { category, categoryNotes, current, related } = data;
  const path = noteHref(slug, current.noteId as number);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: current.title,
    description: extractPlainText(current.content, 150) || undefined,
    inLanguage: "ko-KR",
    url: `${siteConfig.url}${path}`,
    mainEntityOfPage: `${siteConfig.url}${path}`,
    dateModified: (current as any).updatedAt,
    datePublished: (current as any).createdAt,
    author: { "@type": "Person", name: "부영실" },
    isPartOf: { "@type": "CollectionPage", name: category.name },
  };

  return (
    <NoteStoreProvider>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <PageHero
        description={category.description || "개발노트"}
        gradient="from-blue-600 to-purple-600"
        icon={category.icon || "📚"}
        title={category.name}
      />

      <div className="w-full">
        <NoteItemView
          fetchNotes={categoryNotes}
          initialNote={current}
          relatedNotes={related}
        />
      </div>
    </NoteStoreProvider>
  );
}