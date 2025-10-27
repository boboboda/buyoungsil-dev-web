import Link from "next/link";
import type { Note } from "@/types";

interface RecentNotesProps {
  notes: Note[];
}

export default function RecentNotes({ notes }: RecentNotesProps) {
  if (notes.length === 0) return null;

  const categoryEmoji = {
    "프론트엔드": "🎨",
    "백엔드": "⚙️",
    "모바일": "📱",
    "데이터베이스": "💾",
    "인프라": "🔧",
    "기타": "📚"
  };

  return (
    <section className="w-full py-20 bg-white dark:bg-gray-900">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            📚 최근 개발 노트
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            실전 개발 과정에서 얻은 인사이트를 공유합니다
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {notes.map((note) => (
            <Link
              key={note.noteId}
              href={`/note/${note.noteId}`}
              className="group"
            >
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 h-full flex flex-col">
                {/* 카테고리 뱃지 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">
                    {categoryEmoji[note.mainCategory as keyof typeof categoryEmoji] || "📝"}
                  </span>
                  <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    {note.mainCategory}
                  </span>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                  {note.title}
                </h3>

                {/* 서브 카테고리 */}
                {note.subCategory && (
                  <div className="mt-auto pt-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      {note.subCategory.name}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/note"
            className="inline-flex items-center gap-2 px-8 py-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-600 dark:hover:border-blue-400 transition-colors font-semibold text-lg"
          >
            모든 노트 보기 →
          </Link>
        </div>
      </div>
    </section>
  );
}