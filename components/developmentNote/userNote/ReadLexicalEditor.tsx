// components/developmentNote/userNote/ReadLexicalEditor.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import { Note } from "@/store/editorSotre";
import PlaygroundNodes from '@/components/editor/nodes/PlaygroundNodes';
import PlaygroundEditorTheme from '@/components/editor/theme/PlaygroundEditorTheme';
import CodeHighlightPrismPlugin from '@/components/editor/plugins/CodeHighlightPrismPlugin';
import CodeLanguageLabelPlugin from '@/components/editor/plugins/CodeLanguageLabelPlugin';
import { $prepareNoteContent } from '../noteEditorUtils';
import RelatedNotes, { RelatedNoteSummary } from './RelatedNotes';

interface ReadLexicalEditorProps {
  note?: Note;
  relatedNotes?: RelatedNoteSummary[];
  // 서버가 미리 만든 본문 HTML. 에디터가 준비될 때까지 이걸 보여준다 (크롤러는 이 HTML 을 읽는다).
  serverHtml?: string;
}

function LoadContentPlugin({ note, onLoaded }: { note?: Note; onLoaded?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!note || !note.content) {
      return;
    }

    try {
      let content = note.content;
      
      // 문자열 파싱
      if (typeof content === 'string') {
        content = JSON.parse(content);
      }

      // 🔥 TipTap Document 형식 체크 (type: "doc")
      if (content && typeof content === 'object' && content.type === 'doc') {
        editor.update(
          () => {
            $prepareNoteContent(note);
          },
          { onUpdate: () => onLoaded?.() },
        );
        return;
      }

      // 🔥 TipTap Array 형식 (이전 버전)
      if (Array.isArray(content)) {
        editor.update(
          () => {
            $prepareNoteContent(note);
          },
          { onUpdate: () => onLoaded?.() },
        );
        return;
      }

      // 🔥 Lexical JSON 형식 (root 객체)
      if (content && typeof content === 'object' && content.root) {
        const editorState = editor.parseEditorState(content);
        editor.setEditorState(editorState);
        onLoaded?.();
        return;
      }
    } catch (error) {
      // 실패하면 서버가 만든 HTML 이 계속 보인다
      console.error('LoadContentPlugin 에러:', error);
    }
  }, [editor, note, onLoaded]);

  return null;
}

export default function ReadLexicalEditor({ note, relatedNotes = [], serverHtml = "" }: ReadLexicalEditorProps) {
  // 서버 HTML 이 있으면: 서버/첫 화면에서는 그 HTML 만 보여주고, 브라우저에서 에디터가 본문을 불러온 뒤에 바꿔 끼운다.
  const [mounted, setMounted] = useState(false);
  // 에디터가 본문을 불러온 글 번호. 다른 글로 이동하면 자연스럽게 "아직 안 불러옴"이 된다.
  const [loadedId, setLoadedId] = useState<number | null | undefined>(undefined);
  const noteIdNow = note?.noteId ?? null;
  const loaded = loadedId === noteIdNow;
  const handleLoaded = useCallback(() => setLoadedId(noteIdNow), [noteIdNow]);

  useEffect(() => setMounted(true), []);

  const useServerHtml = !!serverHtml;
  const showServerHtml = useServerHtml && !loaded;
  const renderEditor = !useServerHtml || mounted;

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
      <article className="max-w-6xl mx-auto px-4 sm:px-8 py-6 lg:py-12">
        
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

        <div className="read-only-code prose prose-base lg:prose-lg dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
          {showServerHtml && (
            <div
              className="text-gray-800 dark:text-gray-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: serverHtml }}
            />
          )}
          {renderEditor && (
          <div className={showServerHtml ? "hidden" : undefined}>
          <LexicalComposer key={note.noteId} initialConfig={initialConfig}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[300px] md:min-h-[500px] outline-none focus:outline-none text-gray-800 dark:text-gray-200 leading-relaxed"
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
            <LoadContentPlugin note={note} onLoaded={handleLoaded} />
            <CodeHighlightPrismPlugin />
            <CodeLanguageLabelPlugin />
          </LexicalComposer>
          </div>
          )}
        </div>

        <RelatedNotes notes={relatedNotes} />
      </article>
    </div>
  );
}