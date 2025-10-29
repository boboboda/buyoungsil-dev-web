"use client";

import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import AdminNoteTable from "./table/noteTable";
import { Note } from "@/store/editorSotre";
import { GradientButton } from "@/components/common/GradientButton";

export default function AdminNoteList({ fetchNotes }: { fetchNotes: Note[] }) {
  noStore();

  return (
    <div className="w-full pt-3">
      <div className="w-full flex justify-between items-center px-4 mb-6">
        <h1 className="text-[40px] font-bold">관리자 노트 리스트</h1>
        <Link href="/admin/write">
          <GradientButton size="lg" gradient="from-blue-600 to-purple-600">
            ✍️ 새 노트 작성
          </GradientButton>
        </Link>
      </div>
      <AdminNoteTable notes={fetchNotes} />
    </div>
  );
}