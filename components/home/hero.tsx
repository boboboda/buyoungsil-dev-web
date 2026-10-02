import Link from "next/link";
import Animation from "./animation"; // 🔥 기존 애니메이션 import

interface HeroProps {
  todayVisitors: number;
  totalVisitors: number;
  totalProjects: number;
  totalNotes: number;
  totalUsers: number;
  daysRunning: number;
}

export default function Hero({ 
  todayVisitors, 
  totalVisitors, 
  totalProjects, 
  totalNotes,
  totalUsers,
  daysRunning
}: HeroProps) {
  const stats = [
    {
      icon: "📅",
      value: daysRunning,
      label: "홈페이지 운영",
      suffix: "일째",
      color: "from-blue-500 to-cyan-500"
    },
    {
      icon: "👥",
      value: totalUsers,
      label: "가입자",
      suffix: "명",
      color: "from-purple-500 to-pink-500"
    },
    {
      icon: "👋",
      value: todayVisitors,
      label: "오늘 방문자",
      suffix: "명",
      color: "from-green-500 to-emerald-500"
    },
    {
      icon: "🌟",
      value: totalVisitors,
      label: "총 방문자",
      suffix: "명",
      color: "from-orange-500 to-red-500"
    },
    {
      icon: "💼",
      value: totalProjects,
      label: "프로젝트",
      suffix: "개",
      color: "from-blue-600 to-purple-600"
    },
    {
      icon: "📚",
      value: totalNotes,
      label: "개발노트",
      suffix: "개",
      color: "from-indigo-500 to-blue-500"
    }
  ];

  return (
    <section className="relative w-full py-6 md:py-20 overflow-hidden">
      {/* 배경 그라데이션 + 애니메이션 */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-200 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-70 animate-blob" />
        <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-purple-200 dark:bg-purple-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-70 animate-blob animation-delay-2000" />
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-pink-200 dark:bg-pink-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-70 animate-blob animation-delay-4000" />
      </div>
      
      {/* 컨텐츠 */}
      <div className="relative container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-12 items-center">
          
          {/* 왼쪽: 텍스트 & 통계 */}
          <div className="space-y-4 md:space-y-6 text-center lg:text-left order-2 lg:order-1">
            {/* 뱃지 */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900 rounded-full text-sm font-medium text-blue-800 dark:text-blue-200 animate-fade-in">
              <span className="animate-pulse">🤖</span>
              AI로 앱 만들기
            </div>

            {/* 메인 타이틀 */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight animate-fade-in-up">
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                코딩천재 부영실
              </span>
            </h1>

            {/* 서브 타이틀 */}
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 leading-relaxed animate-fade-in-up animation-delay-200">
              비개발자 출신 개발자가{" "}
              <span className="font-bold text-blue-600 dark:text-blue-400">AI</span>를 활용해
              <br />
              실제 서비스를 만들고 운영하는 과정을 공유합니다
            </p>

            {/* 실시간 통계 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-4 animate-fade-in-up animation-delay-400">
              {stats.map((stat, index) => (
                <div
                  key={index}
                  className="relative p-4 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group cursor-pointer"
                >
                  {/* 호버 그라데이션 */}
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-r ${stat.color} opacity-0 group-hover:opacity-20 transition-opacity duration-300`} />
                  
                  <div className="relative">
                    <div className="text-2xl mb-1">{stat.icon}</div>
                    <div className={`text-2xl md:text-3xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                      {stat.value.toLocaleString()}
                      <span className="text-sm ml-1">{stat.suffix}</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 font-medium">
                      {stat.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA 버튼 */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-6 animate-fade-in-up animation-delay-600">
              <Link
                href="/project"
                className="group relative px-6 py-3 md:px-8 md:py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl overflow-hidden font-semibold text-base md:text-lg shadow-lg hover:shadow-2xl transition-all duration-300"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  프로젝트 둘러보기
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </Link>
              <Link
                href="/note"
                className="px-6 py-3 md:px-8 md:py-4 border-2 border-gray-300 dark:border-gray-600 rounded-xl hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800 transition-all duration-300 font-semibold text-base md:text-lg"
              >
                개발 노트 읽기
              </Link>
            </div>
          </div>

          {/* 오른쪽: 브랜드 캐릭터 애니메이션 🔥 */}
          <div className="flex justify-center lg:justify-end order-1 lg:order-2 animate-fade-in-up animation-delay-800">
            <div className="relative w-full max-w-[220px] sm:max-w-sm lg:max-w-lg mx-auto">
              <Animation />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}