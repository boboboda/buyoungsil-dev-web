import { Metadata } from "next";
import { allFetchEditorServerAdmin } from "@/serverActions/editorServerAction";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import NoteManageTable from "@/components/admin/notes/NoteManageTable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "개발노트 관리 | 관리자",
};

export default async function AdminNotesPage() {
  const noteRes = await allFetchEditorServerAdmin();
  const notes = JSON.parse(noteRes);

  return (
    <NoteStoreProvider>
      <div className="container mx-auto px-4 py-8">
        <NoteManageTable notes={notes} />
      </div>
    </NoteStoreProvider>
  );
}