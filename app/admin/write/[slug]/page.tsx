import NoteComponent from "@/components/developmentNote/noteComponent";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { findOneEditorServer } from "@/serverActions/editorServerAction";
import { Note } from "@/store/editorSotre";

export default async function DevelopNoteWrite({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;

  console.log("id", resolvedParams.slug);

  const noteRes = await findOneEditorServer(resolvedParams.slug);

  const noteParsing = JSON.parse(noteRes!);

  const note: Note = noteParsing;

  console.log("editor note", note);

  return (
    <NoteStoreProvider>
      <div className="w-full">
        <NoteComponent editNote={note} editorType="edit" />
      </div>
    </NoteStoreProvider>
  );
}
