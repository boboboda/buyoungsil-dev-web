'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { $getRoot } from 'lexical';

interface AutoSavePluginProps {
  onSave: (content: string) => void;
}

export default function AutoSavePlugin({ onSave }: AutoSavePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        editorState.read(() => {
          const root = $getRoot();
          const content = JSON.stringify(editorState.toJSON());
          onSave(content);
        });
      }, 500); // 500ms 디바운스
    });

    return () => {
      clearTimeout(timeoutId);
      unregister();
    };
  }, [editor, onSave]);

  return null;
}