import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchNoteById } from "@/serverActions/editorServerAction";

export const dynamic = 'force-dynamic';

interface NoteDetailPageProps {
  params: Promise<{
    noteId: string;
  }>;
}

export async function generateMetadata({ params }: NoteDetailPageProps): Promise<Metadata> {
  const { noteId } = await params;
  const note = await fetchNoteById(Number(noteId));

  if (!note || !note.isPublished) {
    return {
      title: "노트를 찾을 수 없습니다",
    };
  }

  return {
    title: note.metaTitle || `${note.title} | 개발노트`,
    description: note.metaDescription || note.title || "개발노트",
    keywords: [note.mainCategory, note.level].filter(Boolean),
  };
}

export default async function NoteDetailPage({ params }: NoteDetailPageProps) {
  const { noteId } = await params;
  const note = await fetchNoteById(Number(noteId));

  if (!note || !note.isPublished) {
    notFound();
  }

  // Json content를 HTML로 변환 (Tiptap 사용 시)
  const renderContent = () => {
    if (!note.content) return "";
    
    try {
      // content가 이미 HTML string이면 그대로 사용
      if (typeof note.content === 'string') {
        return note.content;
      }
      
      // Tiptap JSON인 경우 (추후 변환 로직 추가 필요)
      return JSON.stringify(note.content);
    } catch (e) {
      return "";
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* 뒤로가기 */}
      <Link 
        href="/note" 
        className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
      >
        ← 개발노트 목록
      </Link>

      {/* 헤더 */}
      <article className="prose prose-lg dark:prose-invert max-w-none">
        <div className="mb-8">
          {/* 카테고리 & 레벨 */}
          <div className="flex gap-2 mb-4">
            {note.mainCategory && (
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {note.mainCategory}
              </span>
            )}
            {note.level && (
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                {note.level}
              </span>
            )}
          </div>

          {/* 제목 */}
          <h1 className="text-4xl font-bold mb-4">{note.title}</h1>

          {/* 메타 정보 */}
          <div className="flex items-center gap-6 text-gray-600 dark:text-gray-400 text-sm">
            <span>작성일: {new Date(note.createdAt).toLocaleDateString('ko-KR')}</span>
            <span>수정일: {new Date(note.updatedAt).toLocaleDateString('ko-KR')}</span>
          </div>
        </div>

        {/* 내용 */}
        <div 
          className="mt-8 ProseMirror"
          dangerouslySetInnerHTML={{ __html: renderContent() }}
        />
      </article>
    </div>
  );
}