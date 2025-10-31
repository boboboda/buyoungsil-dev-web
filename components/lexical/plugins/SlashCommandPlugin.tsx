'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';

export default function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // TODO: 슬래시 명령어 구현
    console.log('슬래시 명령어 플러그인 로드됨');
  }, [editor]);

  return null;
}