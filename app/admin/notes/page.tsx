// app/admin/notes/page.tsx
import { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import NoteManageTable from "@/components/admin/notes/NoteManageTable";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "개발노트 관리 | 관리자",
};

export default async function AdminNotesPage() {
  // 모든 노트 가져오기 (공개/비공개 모두)
  const notes = await prisma.developNote.findMany({
    orderBy: { noteId: 'desc' }
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">📚 개발노트 관리</h1>
          <p className="text-gray-600 dark:text-gray-400">
            개발노트를 작성하고 공개 여부를 관리합니다
          </p>
        </div>
        <Link
          href="/admin/write"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          ✍️ 새 노트 작성
        </Link>
      </div>

      <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
          💡 <strong>공개/비공개 vs 레벨</strong>
        </p>
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          • <strong>비공개</strong>: 작성 중이거나 품질이 낮아서 아직 공개하지 않을 노트
        </p>
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          • <strong>레벨 (🟢🟡🔴)</strong>: 공개된 노트의 접근 권한 제어
        </p>
      </div>

      <NoteManageTable notes={notes} />
    </div>
  );
}