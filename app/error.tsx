// app/error.tsx
'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // returnNaN 에러는 무시
    if (error.message?.includes('returnNaN')) {
      console.log('[IGNORED] returnNaN error from malicious input');
      return;
    }
    
    // 다른 에러는 로깅
    console.error('Application error:', error);
  }, [error]);

  // returnNaN 에러는 자동 복구
  if (error.message?.includes('returnNaN')) {
    reset();
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
          문제가 발생했습니다
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          일시적인 오류가 발생했습니다. 다시 시도해주세요.
        </p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}