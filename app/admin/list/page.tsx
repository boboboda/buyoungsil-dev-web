// app/admin/list/page.tsx
export const dynamic = "force-dynamic";

import AdminNoteList from "@/components/developmentNote/adminNoteList";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";

export default async function DevelopNoteList() {
  const noteRes = await allFetchEdtiorServer();
  const notes = JSON.parse(noteRes);

  return (
    <NoteStoreProvider>
      <div className="w-full">
        <AdminNoteList fetchNotes={notes} />
      </div>
    </NoteStoreProvider>
  );
}
