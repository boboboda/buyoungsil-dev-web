// components/developmentNote/userNote/ReadLexicalEditor.tsx
"use client";

import { useEffect } from "react";
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import { Note } from "@/store/editorSotre";
import PlaygroundNodes from '@/components/editor/nodes/PlaygroundNodes';
import PlaygroundEditorTheme from '@/components/editor/theme/PlaygroundEditorTheme';
import { $prepareNoteContent } from '../noteEditorUtils';

interface ReadLexicalEditorProps {
  note?: Note;
}

function LoadContentPlugin({ note }: { note?: Note }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    console.log("🔍 LoadContentPlugin 실행");
    console.log("📦 note:", note);
    console.log("📄 content:", note?.content);
    
    if (!note || !note.content) {
      console.log("⚠️ note 또는 content 없음");
      return;
    }

    try {
      let content = note.content;
      
      // 문자열 파싱
      if (typeof content === 'string') {
        console.log("🔄 문자열 파싱 중...");
        content = JSON.parse(content);
      }

      console.log("📋 파싱된 content:", content);
      console.log("📋 content.type:", content?.type);

      // 🔥 TipTap Document 형식 체크 (type: "doc")
      if (content && typeof content === 'object' && content.type === 'doc') {
        console.log("✅ TipTap Document 형식 감지! 변환 시작!");
        
        editor.update(() => {
          console.log("📝 editor.update 내부 - $prepareNoteContent 호출");
          $prepareNoteContent(note);
        });
        return;
      }

      // 🔥 TipTap Array 형식 (이전 버전)
      if (Array.isArray(content)) {
        console.log("✅ TipTap Array 형식 감지! 변환 시작!");
        
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
      console.error('❌ LoadContentPlugin 에러:', error);
    }
  }, [editor, note]);

  return null;
}

export default function ReadLexicalEditor({ note }: ReadLexicalEditorProps) {
  console.log("🎨 ReadLexicalEditor 렌더링");
  console.log("📦 받은 note:", note);
  
  const initialConfig = {
    namespace: 'ReadOnlyEditor',
    theme: PlaygroundEditorTheme,
    nodes: PlaygroundNodes,
    editable: false,
    onError: (error: Error) => {
      console.error('❌ Lexical Error:', error);
    },
  };

  if (!note) {
    return (
      <div className="flex h-full w-full items-center justify-center p-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📝</div>
          <div className="text-gray-500 dark:text-gray-400">
            노트를 선택해주세요
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-full bg-white dark:bg-gray-900">
      <article className="max-w-6xl mx-auto px-8 py-8 lg:py-12">
        
        <header className="mb-10 pb-8 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6 leading-tight">
            {note.title || "제목 없음"}
          </h1>
          
          <div className="flex flex-wrap items-center gap-3">
            {note.mainCategory && (
              <span className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <span className="mr-1.5">📚</span>
                {note.mainCategory}
              </span>
            )}
            {note.level && (
              <span className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold border ${
                note.level === 'BEGINNER' 
                  ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800'
                  : note.level === 'INTERMEDIATE'
                  ? 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800'
                  : 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
              }`}>
                <span className="mr-1.5">
                  {note.level === 'BEGINNER' ? '🟢' : note.level === 'INTERMEDIATE' ? '🟡' : '🔴'}
                </span>
                {note.level === 'BEGINNER' ? '초급' : note.level === 'INTERMEDIATE' ? '중급' : '고급'}
              </span>
            )}
          </div>
        </header>

        <div className="prose prose-lg dark:prose-invert max-w-none">
          <LexicalComposer initialConfig={initialConfig}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable 
                  className="min-h-[500px] outline-none focus:outline-none text-gray-800 dark:text-gray-200 leading-relaxed"
                  style={{ caretColor: 'transparent' }}
                />
              }
              placeholder={
                <div className="text-gray-400 dark:text-gray-600 italic">
                  내용이 없습니다.
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <LoadContentPlugin note={note} />
          </LexicalComposer>
        </div>
      </article>
    </div>
  );
}