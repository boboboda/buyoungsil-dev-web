'use client';

import { LinkPlugin as LexicalLinkPlugin } from '@lexical/react/LexicalLinkPlugin';

export default function LinkPlugin() {
  const validateUrl = (url: string) => {
    return url === 'https://' || url.startsWith('http://') || url.startsWith('https://');
  };

  return <LexicalLinkPlugin validateUrl={validateUrl} />;
}