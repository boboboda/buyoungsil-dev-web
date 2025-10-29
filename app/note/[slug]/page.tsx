// app/note/[slug]/page.tsx
export const dynamic = 'force-dynamic'

import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";
import { Note } from "@/store/editorSotre";
import NoteItemView from "@/components/developmentNote/userNote/noteItemView";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublishedCategories } from "@/serverActions/noteCategoryActions";
// 🔥 새로 추가
import { PageHero } from "@/components/common/PageHero";

// 카테고리별 메타데이터
function getCategoryMetadata(slug: string) {
  const categoryMap: Record<string, { title: string; description: string; keywords: string[] }> = {
    'kotlin-compose': {
      title: 'Kotlin + Compose',
      description: 'Jetpack Compose를 활용한 안드로이드 앱 개발 경험을 공유합니다.',
      keywords: ['Kotlin', 'Jetpack Compose', 'Android', '안드로이드']
    },
    'swift-swiftui': {
      title: 'Swift + SwiftUI',
      description: 'SwiftUI를 활용한 iOS 앱 개발 노하우를 정리했습니다.',
      keywords: ['Swift', 'SwiftUI', 'iOS', 'iPhone']
    },
    'flutter': {
      title: 'Flutter',
      description: 'Flutter로 크로스플랫폼 모바일 앱 개발 방법을 공유합니다.',
      keywords: ['Flutter', 'Dart', '모바일', '앱개발']
    },
    'nextjs-heroui': {
      title: 'Next.js + HeroUI',
      description: 'Next.js와 HeroUI로 웹 애플리케이션 개발 경험을 정리했습니다.',
      keywords: ['Next.js', 'HeroUI', 'React', 'TypeScript']
    },
    'react': {
      title: 'React',
      description: 'React 컴포넌트 설계와 상태 관리 실전 경험을 공유합니다.',
      keywords: ['React', 'JavaScript', '프론트엔드', 'UI']
    },
    'nestjs-typescript': {
      title: 'NestJS + TypeScript',
      description: 'NestJS와 TypeScript로 백엔드 개발 노하우를 정리했습니다.',
      keywords: ['NestJS', 'TypeScript', 'Node.js', '백엔드']
    },
    'nodejs': {
      title: 'Node.js',
      description: 'Node.js를 활용한 백엔드 개발 경험을 공유합니다.',
      keywords: ['Node.js', 'JavaScript', '백엔드', 'API']
    },
    'python-crawling': {
      title: 'Python 크롤링',
      description: 'Python을 활용한 웹 크롤링 및 데이터 수집 방법을 정리했습니다.',
      keywords: ['Python', '크롤링', '데이터', '자동화']
    },
    'basics': {
      title: '개발 기초',
      description: '프로그래밍 입문과 기본 개념을 정리한 노트입니다.',
      keywords: ['프로그래밍', '기초', '입문', '개발']
    },
    'default': {
      title: '개발노트',
      description: '다양한 개발 기술과 경험을 정리한 개발노트입니다.',
      keywords: ['개발', '프로그래밍', '웹개발', '앱개발']
    }
  };

  return categoryMap[slug] || categoryMap['default'];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meta = getCategoryMetadata(slug);

  return {
    title: `${meta.title} | 코딩천재 부영실`,
    description: meta.description,
    keywords: meta.keywords,
  };
}

const EmptyNoteMessage = () => (
  <div className="flex h-full w-full items-center justify-center min-h-[400px]">
    <div className="text-center">
      <h1 className="text-gray-500 text-3xl font-bold mb-2">
        아직 작성된 노트가 없습니다.
      </h1>
      <p className="text-gray-400">곧 새로운 개발노트가 추가될 예정입니다.</p>
    </div>
  </div>
);

export default async function NoteContentItemPage({ 
  params 
}: { 
  params: Promise<{ slug: string }> 
}) {
  const { slug } = await params;

  // 🔥 1. 카테고리가 공개되어 있는지 확인
  const publishedCategories = await fetchPublishedCategories();
  const category = publishedCategories.find((cat) => cat.slug === slug);

  if (!category) {
    notFound(); // 비공개 카테고리
  }

  // 🔥 2. 해당 카테고리의 모든 노트 가져오기 (isPublished 무관)
  const noteRes = await allFetchEdtiorServer();
  const notes: Note[] = JSON.parse(noteRes);
  const filterNotes = notes.filter((note) => note.mainCategory === slug);

  if (!filterNotes || filterNotes.length === 0) {
    // 🔥 Hero 추가 (빈 페이지에도)
    const meta = getCategoryMetadata(slug);
    return (
      <>
        <PageHero
          icon="📚"
          title={meta.title}
          description={meta.description}
          gradient="from-blue-600 to-purple-600"
        />
        <EmptyNoteMessage />
      </>
    );
  }

  const initialNote = filterNotes[0];
  const meta = getCategoryMetadata(slug);

  return (
    <NoteStoreProvider>
      {/* 🔥 Hero 섹션 추가 */}
      <PageHero
        icon="📚"
        title={meta.title}
        description={meta.description}
        gradient="from-blue-600 to-purple-600"
      />
      
      <div className="w-full">
        <NoteItemView fetchNotes={filterNotes} initialNote={initialNote} />
      </div>
    </NoteStoreProvider>
  );
}