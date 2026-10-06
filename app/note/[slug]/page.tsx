// app/note/[slug]/page.tsx
// 카테고리 페이지: 그 카테고리의 공개된 글 전체 목록(사이드바)과 첫 글을 보여준다.
export const dynamic = "force-dynamic";

import { Metadata } from "next";
import { notFound } from "next/navigation";

import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";
import { fetchPublishedCategories } from "@/serverActions/noteCategoryActions";
import { Note } from "@/store/editorSotre";
import NoteItemView from "@/components/developmentNote/userNote/noteItemView";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { PageHero } from "@/components/common/PageHero";

const SITE_NAME = "코딩천재 부영실";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchPublishedCategories();
  const category = categories.find((cat) => cat.slug === slug);

  if (!category) {
    return { title: "카테고리를 찾을 수 없습니다" };
  }

  const title = `${category.metaTitle || category.name} | ${SITE_NAME}`;
  const description = category.metaDescription || category.description;
  const keywords =
    category.metaKeywords.length > 0 ? category.metaKeywords : category.tags;

  return {
    title,
    description,
    keywords,
    alternates: { canonical: `/note/${slug}` },
    openGraph: {
      title,
      description,
      url: `/note/${slug}`,
      ...(category.imageUrl ? { images: [category.imageUrl] } : {}),
    },
  };
}

const EmptyNoteMessage = () => (
  <div className="flex h-full min-h-[400px] w-full items-center justify-center">
    <div className="text-center">
      <h1 className="mb-2 text-3xl font-bold text-gray-500">
        아직 작성된 노트가 없습니다.
      </h1>
      <p className="text-gray-400">곧 새로운 개발노트가 추가될 예정입니다.</p>
    </div>
  </div>
);

export default async function NoteContentItemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 1. 카테고리가 공개되어 있는지 확인
  const publishedCategories = await fetchPublishedCategories();
  const category = publishedCategories.find((cat) => cat.slug === slug);

  if (!category) {
    notFound(); // 없는 카테고리 또는 비공개 카테고리
  }

  // 2. 해당 카테고리의 공개된 노트 가져오기
  const noteRes = await allFetchEdtiorServer();
  const notes: Note[] = JSON.parse(noteRes);
  const filterNotes = notes.filter((note) => note.mainCategory === slug);

  const hero = (
    <PageHero
      description={category.description}
      gradient="from-blue-600 to-purple-600"
      icon={category.icon}
      title={category.name}
    />
  );

  if (filterNotes.length === 0) {
    return (
      <>
        {hero}
        <EmptyNoteMessage />
      </>
    );
  }

  const initialNote = filterNotes[0];

  return (
    <NoteStoreProvider>
      {hero}

      <div className="w-full">
        <NoteItemView fetchNotes={filterNotes} initialNote={initialNote} />
      </div>
    </NoteStoreProvider>
  );
}