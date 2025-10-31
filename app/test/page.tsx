'use client';

import LexicalEditor from '@/components/lexical/LexicalEditor';

export default function TestLexicalPage() {
  const handleSave = (content: string) => {
    console.log('자동 저장:', content);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold mb-2 text-gray-900">
            Lexical Playground 에디터
          </h1>
          <p className="text-gray-600 mb-8">
            Rich Text Editor with Heading, Quote, List 기능
          </p>

          <LexicalEditor 
            placeholder="여기에 글을 작성하세요..."
            onSave={handleSave}
          />

          <div className="mt-8 p-6 bg-white rounded-lg border border-gray-200">
            <h2 className="text-lg font-semibold mb-3">✅ Phase 1 완료 - 테스트 항목</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
              <div>
                <h3 className="font-semibold mb-2">📝 텍스트 포맷</h3>
                <ul className="space-y-1">
                  <li>• Bold (Ctrl+B)</li>
                  <li>• Italic (Ctrl+I)</li>
                  <li>• Underline (Ctrl+U)</li>
                  <li>• Strikethrough</li>
                  <li>• ✨ Text Shadow</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">📋 블록 타입</h3>
                <ul className="space-y-1">
                  <li>• Normal 문단</li>
                  <li>• H1, H2, H3 제목</li>
                  <li>• Quote 인용구</li>
                  <li>• Bullet List</li>
                  <li>• Numbered List</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}