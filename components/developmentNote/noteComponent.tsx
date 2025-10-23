"use client";

import { useState, useEffect } from "react";

import BlockEditor from "./blockEditor";

import { NoteEditorType } from "@/types";
import { Note } from "@/store/editorSotre";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";

export default function NoteComponent({
  editNote,
  editorType,
}: {
  editNote?: Note;
  editorType: NoteEditorType;
}) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const noteRes = await allFetchEdtiorServer();
      const notes = JSON.parse(noteRes);

      setNotes(notes);
    };

    fetchData();
  }, []);

  return (
    <div className="w-full">
      <BlockEditor editorType={editorType} fetchNotes={notes} note={editNote} />
    </div>
  );
}
