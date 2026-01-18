// app/admin/security/page.tsx
'use client';

export default function SecurityDashboard() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-gray-800 dark:text-gray-200">
        🛡️ 보안 모니터링
      </h1>
      
      {/* 보안 상태 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 p-6 rounded-lg">
          <h3 className="font-bold text-lg mb-2 text-red-800 dark:text-red-200">
            차단된 공격
          </h3>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400 mb-2">
            실시간 차단 중
          </p>
          <p className="text-sm text-red-600 dark:text-red-400">
            로그 확인: Docker logs
          </p>
        </div>
        
        <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 p-6 rounded-lg">
          <h3 className="font-bold text-lg mb-2 text-green-800 dark:text-green-200">
            알려진 악성 IP
          </h3>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400 mb-2">
            3개
          </p>
          <p className="text-sm text-green-700 dark:text-green-300">
            82.23.183.171<br/>
            217.144.184.100<br/>
            143.20.64.84
          </p>
        </div>
        
        <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 p-6 rounded-lg">
          <h3 className="font-bold text-lg mb-2 text-blue-800 dark:text-blue-200">
            보안 기능
          </h3>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
            ✅ 활성화
          </p>
          <p className="text-sm text-blue-600 dark:text-blue-400">
            Middleware 차단 중
          </p>
        </div>
      </div>

      {/* 차단 패턴 상세 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-200">
          🎯 차단 패턴
        </h2>
        <ul className="space-y-3">
          <li className="flex items-start">
            <span className="text-red-500 mr-3">🚫</span>
            <div>
              <p className="font-semibold text-gray-800 dark:text-gray-200">
                Shell Injection 패턴
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                curl|sh, wget|sh, bash -c 등의 악성 명령어 차단
              </p>
            </div>
          </li>
          <li className="flex items-start">
            <span className="text-orange-500 mr-3">🤖</span>
            <div>
              <p className="font-semibold text-gray-800 dark:text-gray-200">
                악성 봇 User-Agent
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                python-requests, fasthttp, curl 등의 자동화 도구 차단
              </p>
            </div>
          </li>
          <li className="flex items-start">
            <span className="text-purple-500 mr-3">📍</span>
            <div>
              <p className="font-semibold text-gray-800 dark:text-gray-200">
                알려진 공격 IP
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                10회 이상 공격 시도 시 자동 영구 차단
              </p>
            </div>
          </li>
        </ul>
      </div>

      {/* 로그 확인 안내 */}
      <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
        <h3 className="font-bold text-lg mb-2 text-yellow-800 dark:text-yellow-200">
          💡 실시간 로그 확인 방법
        </h3>
        <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
          Docker 컨테이너의 실시간 로그를 확인하려면 다음 명령어를 사용하세요:
        </p>
        <code className="block bg-gray-900 text-green-400 p-4 rounded font-mono text-sm">
          docker logs -f [컨테이너_이름]
        </code>
        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3">
          차단된 공격은 🚨 [SECURITY] 로그로 표시됩니다.
        </p>
      </div>
    </div>
  );
}