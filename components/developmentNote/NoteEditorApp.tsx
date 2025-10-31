// components/developmentNote/NoteEditorApp.tsx
"use client";

import { useMemo, useEffect } from 'react';
import { defineExtension } from 'lexical';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

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

// 🔥 컨텐츠 로드 플러그인 (편집 모드용)
function LoadContentForEditPlugin({ note, editorType }: { note?: Note; editorType: NoteEditorType }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // 🔥 편집 모드일 때만 실행
    if (editorType !== 'edit' || !note || !note.content) {
      console.log("⏭️ 편집 모드 아님 또는 노트 없음");
      return;
    }

    console.log("🔍 LoadContentForEditPlugin 실행 (편집 모드)");
    console.log("📦 note:", note);
    console.log("📄 content:", note.content);

    try {
      let content = note.content;
      
      // 문자열 파싱
      if (typeof content === 'string') {
        console.log("🔄 문자열 파싱 중...");
        content = JSON.parse(content);
      }

      console.log("📋 파싱된 content:", content);
      console.log("📋 content.type:", content?.type);

      // 🔥 TipTap Document 형식 (type: "doc")
      if (content && typeof content === 'object' && content.type === 'doc') {
        console.log("✅ TipTap Document 형식 감지! 변환 후 편집 가능하게 로드");
        
        editor.update(() => {
          console.log("📝 editor.update 내부 - $prepareNoteContent 호출");
          $prepareNoteContent(note);
        });
        return;
      }

      // 🔥 TipTap Array 형식 (이전 버전)
      if (Array.isArray(content)) {
        console.log("✅ TipTap Array 형식 감지! 변환 후 편집 가능하게 로드");
        
        editor.update(() => {
          console.log("📝 editor.update 내부 - $prepareNoteContent 호출");
          $prepareNoteContent(note);
        });
        return;
      }

      // 🔥 Lexical JSON 형식 (root 객체)
      if (content && typeof content === 'object' && content.root) {
        console.log("✅ Lexical JSON 형식! 직접 로드");
        const editorState = editor.parseEditorState(content);
        editor.setEditorState(editorState);
        return;
      }

      console.log("⚠️ 알 수 없는 형식:", content);
      
    } catch (error) {
      console.error('❌ LoadContentForEditPlugin 에러:', error);
    }
  }, [editor, note, editorType]);

  return null;
}

function NoteEditorApp({ editorType, fetchNotes, note }: NoteEditorAppProps) {
  const {
    settings: { isCollab, emptyEditor },
  } = useSettings();

  const app = useMemo(
    () =>
      defineExtension({
        // 🔥 수정: 편집 모드에서는 initialEditorState를 undefined로
        $initialEditorState: isCollab
          ? null
          : emptyEditor || editorType === 'edit'
            ? undefined
            : () => $prepareNoteContent(note),
        name: '@note/editor',
        namespace: 'NoteEditor',
        nodes: PlaygroundNodes,
        theme: PlaygroundEditorTheme,
      }),
    [emptyEditor, isCollab, note, editorType],
  );

  return (
    <LexicalExtensionComposer extension={app} contentEditable={null}>
      <TableContext>
        <ToolbarContext>
          <div className="w-full">
            {/* 헤더 (제목, 카테고리, 난이도 등) */}
            <NoteEditorHeader 
              notes={fetchNotes}
              note={note}
              editType={editorType}
            />

            {/* Lexical Editor 본체 */}
            <div className="editor-shell">
              <Editor />
            </div>

            {/* 커스텀 플러그인들 (자동저장 등) */}
            <NoteEditorPlugins 
              note={note} 
              editorType={editorType}
              fetchNotes={fetchNotes}
            />

            {/* 🔥 편집 모드일 때 컨텐츠 로드 */}
            <LoadContentForEditPlugin 
              note={note} 
              editorType={editorType}
            />
          </div>
        </ToolbarContext>
      </TableContext>
    </LexicalExtensionComposer>
  );
}

export default NoteEditorApp;