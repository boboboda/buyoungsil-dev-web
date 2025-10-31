'use client';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';

import ToolbarPlugin from './plugins/ToolbarPlugin';
import ImagePlugin from './plugins/ImagePlugin';
import SlashCommandPlugin from './plugins/SlashCommandPlugin';
import AutoSavePlugin from './plugins/AutoSavePlugin';
import editorTheme from './theme/EditorTheme';


interface LexicalEditorProps {
  initialContent?: string;
  onSave?: (content: string) => void;
  placeholder?: string;
}

export default function LexicalEditor({
  initialContent,
  onSave,
  placeholder = '내용을 입력하세요...',
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: 'MyEditor',
    theme: editorTheme,
    onError: (error: Error) => {
      console.error(error);
    },
    nodes: [
      HeadingNode,
      ListNode,
      ListItemNode,
      QuoteNode,
      CodeNode,
      CodeHighlightNode,
      TableNode,
      TableCellNode,
      TableRowNode,
      AutoLinkNode,
      LinkNode,
    ],
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
        {/* 툴바 */}
        <ToolbarPlugin />

        {/* 에디터 영역 */}
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="min-h-[500px] max-w-4xl mx-auto px-8 py-6 outline-none prose dark:prose-invert" />
            }
            placeholder={
              <div className="absolute top-6 left-8 text-neutral-400 pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />

          {/* 플러그인들 */}
          <HistoryPlugin />
          <AutoFocusPlugin />
          <ImagePlugin />
          <SlashCommandPlugin />
          {onSave && <AutoSavePlugin onSave={onSave} />}
        </div>
      </div>
    </LexicalComposer>
  );
}