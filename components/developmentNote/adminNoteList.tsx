import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import AdminNoteTable from "./table/noteTable";

import { Note } from "@/store/editorSotre";

export default function AdminNoteList({ fetchNotes }: { fetchNotes: Note[] }) {
  noStore();

  return (
    <div className="w-full pt-3">
      <div className="w-full flex justify-between items-center px-4 mb-6">
        <h1 className="text-[40px] font-bold">관리자 노트 리스트</h1>
        <Link href="/admin/write">
          <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
            ✍️ 새 노트 작성
          </button>
        </Link>
      </div>
      <AdminNoteTable notes={fetchNotes} />
    </div>
  );
}