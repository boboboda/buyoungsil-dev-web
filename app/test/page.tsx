'use client';

import LexicalEditor from '@/components/lexical/LexicalEditor';

export default function TestLexicalPage() {
  const handleSave = (content: string) => {
    console.log('자동 저장:', content);
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-neutral-900 dark:text-neutral-100">
          Lexical 에디터 테스트
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400 mb-8">
          에디터가 정상 작동하는지 확인하세요
        </p>

        <LexicalEditor 
          placeholder="여기에 글을 작성하세요..."
          onSave={handleSave}
        />

        <div className="mt-8 p-4 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
          <h2 className="text-lg font-semibold mb-2">테스트 항목</h2>
          <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            <li>✅ 에디터가 렌더링되는가?</li>
            <li>✅ 텍스트를 입력할 수 있는가?</li>
            <li>✅ Bold (Ctrl+B) 작동하는가?</li>
            <li>✅ Italic (Ctrl+I) 작동하는가?</li>
            <li>✅ 툴바 버튼들이 작동하는가?</li>
            <li>✅ 자동 저장이 콘솔에 찍히는가? (F12 Console 확인)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}