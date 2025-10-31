// app/editor/page.tsx
"use client";

import { useMemo } from 'react';
import { defineExtension, $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import dynamic from 'next/dynamic';

import { SettingsContext, useSettings } from '@/components/editor/context/SettingsContext';
import { FlashMessageContext } from '@/components/editor/context/FlashMessageContext';
import { ToolbarContext } from '@/components/editor/context/ToolbarContext';
import { TableContext } from '@/components/editor/plugins/TablePlugin';
import Settings from '@/components/editor/Settings';
import PlaygroundNodes from '@/components/editor/nodes/PlaygroundNodes';
import PlaygroundEditorTheme from '@/components/editor/theme/PlaygroundEditorTheme';

// 동적 임포트로 SSR 방지
const Editor = dynamic(() => import('@/components/editor/Editor'), {
  ssr: false,
  loading: () => <div>에디터 로딩 중...</div>
});

// 초기 에디터 콘텐츠
function $prepopulatedRichText() {
  const root = $getRoot();
  if (root.getFirstChild() === null) {
    const heading = $createHeadingNode('h1');
    heading.append($createTextNode('에디터에 오신 것을 환영합니다'));
    root.append(heading);
    
    const quote = $createQuoteNode();
    quote.append(
      $createTextNode(
        '이것은 Lexical 에디터입니다. 다양한 기능을 테스트해보세요!'
      ),
    );
    root.append(quote);
    
    const paragraph = $createParagraphNode();
    paragraph.append(
      $createTextNode('여기에 '),
      $createTextNode('굵은 텍스트').toggleFormat('bold'),
      $createTextNode('와 '),
      $createTextNode('기울임').toggleFormat('italic'),
      $createTextNode(' 형식을 사용할 수 있습니다.'),
    );
    root.append(paragraph);
  }
}

// App 컴포넌트
function App() {
  const {
    settings: { isCollab, emptyEditor, measureTypingPerf },
  } = useSettings();

  const app = useMemo(
    () =>
      defineExtension({
        $initialEditorState: isCollab
          ? null
          : emptyEditor
            ? undefined
            : $prepopulatedRichText,
        name: '@my-app/editor',
        namespace: 'MyEditor',
        nodes: PlaygroundNodes,
        theme: PlaygroundEditorTheme,
      }),
    [emptyEditor, isCollab],
  );

  return (
    <LexicalExtensionComposer extension={app} contentEditable={null}>
      <TableContext>
        <ToolbarContext>
          <header className="mb-4">
            <a href="https://lexical.dev" target="_blank" rel="noreferrer">
              <h1 className="text-2xl font-bold">Lexical Editor</h1>
            </a>
          </header>
          <div className="editor-shell">
            <Editor />
          </div>
          <Settings />
        </ToolbarContext>
      </TableContext>
    </LexicalExtensionComposer>
  );
}

// 👇 이 부분이 누락되어 있었습니다!
export default function EditorPage() {
  return (
    <SettingsContext>
      <FlashMessageContext>
        <App />
      </FlashMessageContext>
    </SettingsContext>
  );
}