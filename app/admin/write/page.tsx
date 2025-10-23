import NoteComponent from "@/components/developmentNote/noteComponent";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
export const dynamic = "force-dynamic";

export default async function DevelopNoteWrite() {
  return (
    <NoteStoreProvider>
      <div className="w-full">
        <NoteComponent editorType="add" />
      </div>
    </NoteStoreProvider>
  );
}
