import { Metadata } from "next";
import { allFetchEditorServerAdmin } from "@/serverActions/editorServerAction";
import { fetchAllCategories } from "@/serverActions/noteCategoryActions";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import NoteManageTable from "@/components/admin/notes/NoteManageTable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "개발노트 관리 | 관리자",
};

export default async function AdminNotesPage() {
  const noteRes = await allFetchEditorServerAdmin();
  const notes = JSON.parse(noteRes);
  // 🔥 카테고리 이름/아이콘/순서는 DB(NoteCategory)가 기준.
  //    (비공개 카테고리도 관리자는 봐야 하므로 전체 조회)
  const categories = await fetchAllCategories();

  return (
    <NoteStoreProvider>
      <div className="container mx-auto px-4 py-8">
        <NoteManageTable notes={notes} categories={categories} />
      </div>
    </NoteStoreProvider>
  );
}