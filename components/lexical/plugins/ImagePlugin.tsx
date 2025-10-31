'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { COMMAND_PRIORITY_LOW } from 'lexical';

export default function ImagePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // 드래그앤드롭 처리
    const removeDropListener = editor.registerCommand(
      // @ts-ignore
      'DROP',
      (event: DragEvent) => {
        event.preventDefault();
        
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const file = files[0];
        if (!file.type.startsWith('image/')) return false;

        // TODO: 이미지 업로드 로직
        console.log('이미지 업로드:', file);

        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      removeDropListener();
    };
  }, [editor]);

  return null;
}