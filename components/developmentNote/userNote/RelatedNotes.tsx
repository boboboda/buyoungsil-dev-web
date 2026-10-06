// components/developmentNote/userNote/RelatedNotes.tsx
// 글 하단 "관련 글" 카드. 진짜 <a> 링크라서 검색엔진이 글끼리의 연결을 따라갈 수 있다.
import Link from "next/link";

import { noteHref } from "@/lib/note/noteUtils";

export interface RelatedNoteSummary {
  noteId: number;
  title: string;
  mainCategory: string;
  categoryName: string;
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
}

const LEVEL_LABEL = {
  BEGINNER: { icon: "🟢", label: "초급" },
  INTERMEDIATE: { icon: "🟡", label: "중급" },
  ADVANCED: { icon: "🔴", label: "고급" },
} as const;

export default function RelatedNotes({
  notes,
}: {
  notes: RelatedNoteSummary[];
}) {
  if (!notes || notes.length === 0) return null;

  return (
    <section
      aria-labelledby="related-notes-title"
      className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-700"
    >
      <h2
        className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4"
        id="related-notes-title"
      >
        📎 함께 보면 좋은 글
      </h2>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {notes.map((note) => {
          const level = LEVEL_LABEL[note.level] ?? LEVEL_LABEL.BEGINNER;

          return (
            <li key={note.noteId}>
              <Link
                className="block h-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 transition hover:border-blue-500 hover:shadow-md dark:hover:border-blue-400"
                href={noteHref(note.mainCategory, note.noteId)}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                  <span className="rounded-md bg-blue-100 px-2 py-1 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {note.categoryName}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {level.icon} {level.label}
                  </span>
                </div>
                <p className="line-clamp-2 font-semibold text-gray-900 dark:text-gray-100">
                  {note.title}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}