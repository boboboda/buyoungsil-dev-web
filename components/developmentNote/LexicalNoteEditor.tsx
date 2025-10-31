// components/developmentNote/NoteEditorApp.tsx 수정
"use client";

import { useMemo } from 'react';
import { defineExtension } from 'lexical';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';

import { useSettings } from '@/components/editor/context/SettingsContext';
import { ToolbarContext } from '@/components/editor/context/ToolbarContext';
import { TableContext } from '@/components/editor/plugins/TablePlugin';
import PlaygroundNodes from '@/components/editor/nodes/PlaygroundNodes';
import PlaygroundEditorTheme from '@/components/editor/theme/PlaygroundEditorTheme';
import Editor from '@/components/editor/Editor';
import { NoteEditorType } from "@/types";
import { Note } from "@/store/editorSotre";
import { $prepareNoteContent } from './noteEditorUtils';
import NoteEditorPlugins from './NoteEditorPlugins';
import NoteEditorHeader from './NoteEditorHeader';

interface NoteEditorAppProps {
  editorType: NoteEditorType;
  fetchNotes: Note[];
  note?: Note;
}

function NoteEditorApp({ editorType, fetchNotes, note }: NoteEditorAppProps) {
  const {
    settings: { isCollab, emptyEditor },
  } = useSettings();

  const app = useMemo(
    () =>
      defineExtension({
        $initialEditorState: emptyEditor
            ? undefined
            : () => $prepareNoteContent(note),
        name: '@note/editor',
        namespace: 'NoteEditor',
        nodes: PlaygroundNodes,
        theme: PlaygroundEditorTheme,
      }),
    [emptyEditor, isCollab, note],
  );

  return (
    <LexicalExtensionComposer extension={app} contentEditable={null}>
      <TableContext>
        <ToolbarContext>
          <div className="w-full">
            {/* 🔥 헤더 추가 */}
            <NoteEditorHeader 
              notes={fetchNotes}
              note={note}
              editType={editorType}
            />

            {/* Lexical Editor */}
            <div className="editor-shell">
              <Editor />
            </div>

            {/* 커스텀 플러그인들 */}
            <NoteEditorPlugins 
              note={note} 
              editorType={editorType}
              fetchNotes={fetchNotes}
            />
          </div>
        </ToolbarContext>
      </TableContext>
    </LexicalExtensionComposer>
  );
}

export default NoteEditorApp;