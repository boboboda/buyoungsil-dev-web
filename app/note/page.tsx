// app/note/page.tsx
import { Metadata } from "next";

import { getCategoryNoteCounts } from "@/serverActions/noteCategoryActions";
import NoteCategoryGrid from "@/components/note/NoteCategoryGrid";
import StoriesList from "@/components/stories/StoriesList";
import { PageTabs } from "@/components/common/PageTabs";

export const dynamic = "force-dynamic";

// 탭: 개발 노트(/note) / 이야기(/note?tab=stories). 예전 /stories 목록은 이야기 탭으로 301 된다.
const TABS = [
  { key: "notes", label: "📚 개발 노트", href: "/note" },
  { key: "stories", label: "😅 이야기", href: "/note?tab=stories" },
];

type NotePageProps = {
  searchParams: Promise<{ tab?: string | string[] }>;
};

async function activeTab(searchParams: NotePageProps["searchParams"]) {
  const { tab } = await searchParams;

  return tab === "stories" ? "stories" : "notes";
}

export async function generateMetadata({ searchParams }: NotePageProps): Promise<Metadata> {
  if ((await activeTab(searchParams)) === "stories") {
    return {
      title: "이야기 | 개발노트 | 코딩천재 부영실",
      description: "비전공자가 AI로 개발하면서 겪은 삽질기, 꿀팁, 일상 이야기를 공유합니다.",
      keywords: ["비개발자", "개발 입문", "프로그래밍 시작", "개발 삽질기", "개발 꿀팁"],
      alternates: { canonical: "/note?tab=stories" },
    };
  }

  return {
    title: "개발노트 | 코딩천재 부영실",
    description: "실전 개발 경험과 노하우를 기술 스택별로 정리한 개발노트와 비전공자 개발 이야기입니다",
    alternates: { canonical: "/note" },
  };
}

export default async function NotePage({ searchParams }: NotePageProps) {
  const tab = await activeTab(searchParams);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto max-w-7xl px-4 py-16">
        {/* 헤더 */}
        <div className="mb-10 text-center">
          <h1 className="mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-5xl font-bold text-transparent">
            📚 개발노트
          </h1>
          {tab === "stories" ? (
            <p className="text-xl text-gray-600 dark:text-gray-400">
              비전공자가 AI로 개발하면서 겪은 실제 경험담
            </p>
          ) : (
            <>
              <p className="text-xl text-gray-600 dark:text-gray-400">
                실전 개발 경험과 노하우를 기술 스택별로 정리했습니다
              </p>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
                💡 레벨별 접근: 🟢초급(전체) 🟡중급(회원) 🔴고급(회원)
              </p>
            </>
          )}
        </div>

        <PageTabs active={tab} label="개발노트 탭" tabs={TABS} />

        {tab === "stories" ? <StoriesList /> : <NoteCategories />}
      </div>
    </div>
  );
}

async function NoteCategories() {
  // 공개된 카테고리 + 각 카테고리의 공개된 글 개수
  // (카테고리 페이지에도 공개된 글만 보이므로 개수가 서로 맞는다)
  const categories = await getCategoryNoteCounts();

  if (categories.length === 0) {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-6xl">📭</div>
        <h3 className="mb-2 text-2xl font-bold text-gray-700 dark:text-gray-300">
          준비 중입니다
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          곧 유익한 개발 노트로 찾아뵙겠습니다!
        </p>
      </div>
    );
  }

  return <NoteCategoryGrid categories={categories} />;
}
