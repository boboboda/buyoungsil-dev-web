'use client';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ParagraphNode, TextNode } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { useEffect } from 'react';

import ToolbarPlugin from './plugins/ToolbarPlugin';
import CodeHighlightPlugin from './plugins/CodeHighlightPlugin';
import LinkPlugin from './plugins/LinkPlugin';
import ImagesPlugin from './plugins/ImagePlugin';
import HorizontalRulePlugin from './plugins/HorizontalRulePlugin';
import { ImageNode } from './nodes/ImageNode';
import { HorizontalRuleNode } from './nodes/HorizontalRuleNode';
import editorTheme from './theme/EditorTheme';
import { registerStyleState, $exportNodeStyle, constructStyleImportMap } from './styleState';
import './editor.css';

interface LexicalEditorProps {
  placeholder?: string;
  onSave?: (content: string) => void;
}

function StyleStatePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerStyleState(editor), [editor]);
  return null;
}

export default function LexicalEditor({
  placeholder = 'Enter some rich text...',
  onSave,
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: 'MyEditor',
    theme: editorTheme,
    onError: (error: Error) => {
      console.error(error);
    },
    nodes: [
      ParagraphNode, 
      TextNode,
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      ImageNode,
      HorizontalRuleNode,
    ],
    html: {
      export: new Map([[TextNode, $exportNodeStyle]]),
      import: constructStyleImportMap(),
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="lexical-editor-container">
        <div className="editor-container">
          <ToolbarPlugin />
          <div className="editor-inner">
            <RichTextPlugin
              contentEditable={
                <ContentEditable className="editor-input" />
              }
              placeholder={
                <div className="editor-placeholder">{placeholder}</div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <AutoFocusPlugin />
            <ListPlugin />
            <CodeHighlightPlugin />
            <LinkPlugin />
            <ImagesPlugin />
            <HorizontalRulePlugin />
            <StyleStatePlugin />
          </div>
        </div>
      </div>
    </LexicalComposer>
  );
}