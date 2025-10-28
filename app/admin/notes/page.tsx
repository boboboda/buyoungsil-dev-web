import { Metadata } from "next";
import Link from "next/link";
import NoteListTable from "@/components/admin/notes/NoteListTable";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "개발노트 관리 | 관리자",
};

export default async function AdminNotesPage() {
  // 🔥 모든 노트 가져오기 (공개/비공개 모두)
  const notes = await prisma.developNote.findMany({
    orderBy: { noteId: 'desc' }
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">📚 개발노트 관리</h1>
          <p className="text-gray-600 dark:text-gray-400">
            개발노트를 작성하고 공개/비공개를 설정합니다
          </p>
        </div>
        <Link
          href="/admin/notes/create"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          + 새 노트 작성
        </Link>
      </div>

      <NoteListTable notes={notes} />
    </div>
  );
}